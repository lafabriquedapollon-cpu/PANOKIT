-- PANOKIT SEC-01 recovery R2: reconstructed candidate, NOT original PR #34.
-- Run only in a NEW disposable database with a NEW cluster. Never migrate LIVE.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'panokit_sec01_sovereign_lab'
 OR session_user <> 'postgres'
 OR current_setting('server_version_num')::int < 170000
 OR current_setting('server_version_num')::int >= 180000
 THEN RAISE EXCEPTION 'disposable PostgreSQL 17 lab only'; END IF;
END $guard$;
-- Fail on existing roles/schema; never reuse or modify existing principals.
CREATE ROLE sec01_admin_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE sec01_admin_mfa_verifier LOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE sec01_admin_issuer LOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE sec01_admin_writer LOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE sec01_admin_revoker LOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE sec01_admin_logout LOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE sec01_admin_sweeper LOGIN NOINHERIT NOBYPASSRLS;
CREATE SCHEMA sec01_admin AUTHORIZATION sec01_admin_owner;
REVOKE ALL ON SCHEMA sec01_admin FROM PUBLIC;
SET LOCAL ROLE sec01_admin_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA sec01_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE sec01_admin.accounts (
 actor_id uuid PRIMARY KEY,
 better_auth_subject text UNIQUE NOT NULL CHECK(length(better_auth_subject) BETWEEN 6 AND 150),
 active boolean NOT NULL DEFAULT true,
 can_edit boolean NOT NULL DEFAULT false,
 mfa_epoch bigint NOT NULL DEFAULT 1,
 credential_epoch bigint NOT NULL DEFAULT 1
);
CREATE TABLE sec01_admin.mfa_proofs (
 proof_digest bytea PRIMARY KEY CHECK(octet_length(proof_digest)=32),
 actor_id uuid NOT NULL REFERENCES sec01_admin.accounts,
 mfa_epoch bigint NOT NULL, credential_epoch bigint NOT NULL,
 expires_at timestamptz NOT NULL, verified_at timestamptz,
 consumed_at timestamptz
);
CREATE TABLE sec01_admin.sessions (
 session_id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES sec01_admin.accounts,
 token_digest bytea UNIQUE NOT NULL CHECK(octet_length(token_digest)=32),
 mfa_epoch bigint NOT NULL, credential_epoch bigint NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX due_sessions ON sec01_admin.sessions(expires_at,session_id) WHERE revoked_at IS NULL;
CREATE TABLE sec01_admin.pricing (
 id integer PRIMARY KEY CHECK(id=1), revision integer NOT NULL CHECK(revision>=1),
 config jsonb NOT NULL CHECK(jsonb_typeof(config)='object')
);
INSERT INTO sec01_admin.pricing VALUES(1,1,'{}');
CREATE TABLE sec01_admin.operation_ledger (
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES sec01_admin.accounts,
 session_id uuid NOT NULL REFERENCES sec01_admin.sessions,
 expected_revision integer NOT NULL, config jsonb NOT NULL,
 committed_revision integer NOT NULL
);
CREATE TABLE sec01_admin.security_audit (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_kind text NOT NULL, actor_id uuid NOT NULL REFERENCES sec01_admin.accounts,
 session_id uuid REFERENCES sec01_admin.sessions,
 operation_id uuid, event_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX unique_session_expiry_audit ON sec01_admin.security_audit(session_id)
 WHERE event_kind='session_expire_event';
CREATE TABLE sec01_admin.expiry_scheduler_state (
 singleton boolean PRIMARY KEY CHECK(singleton), last_complete timestamptz
);
INSERT INTO sec01_admin.expiry_scheduler_state VALUES(true,NULL);
DO $rls$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['accounts','mfa_proofs','sessions','pricing','operation_ledger','security_audit','expiry_scheduler_state'] LOOP
  EXECUTE format('ALTER TABLE sec01_admin.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sec01_admin.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_only ON sec01_admin.%I TO sec01_admin_owner USING (true) WITH CHECK (true)',t);
 END LOOP;
END $rls$;
-- This verifier role is trusted ONLY by an eventual isolated actual TOTP ceremony.
-- Begin before MFA verification, bind subject and both epochs, never accept
-- client-supplied identity as proof. No real Better Auth hook is implemented here.
CREATE FUNCTION sec01_admin.begin_mfa_proof(p_subject text,p_proof bytea,p_expires timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE a sec01_admin.accounts%ROWTYPE;
BEGIN
 IF session_user <> 'sec01_admin_mfa_verifier' OR p_proof IS NULL OR octet_length(p_proof)<>32
 OR p_expires IS NULL OR p_expires<=clock_timestamp() OR p_expires>clock_timestamp()+interval '120 seconds'
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM sec01_admin.accounts WHERE better_auth_subject=p_subject FOR UPDATE;
 IF NOT FOUND OR NOT a.active OR NOT a.can_edit THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 INSERT INTO sec01_admin.mfa_proofs(proof_digest,actor_id,mfa_epoch,credential_epoch,expires_at)
 VALUES(p_proof,a.actor_id,a.mfa_epoch,a.credential_epoch,p_expires);
 RETURN true;
END $f$;
CREATE FUNCTION sec01_admin.mark_mfa_verified(p_subject text,p_proof bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE a sec01_admin.accounts%ROWTYPE;
BEGIN
 IF session_user <> 'sec01_admin_mfa_verifier' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM sec01_admin.accounts WHERE better_auth_subject=p_subject FOR UPDATE;
 IF NOT FOUND OR NOT a.active OR NOT a.can_edit THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 UPDATE sec01_admin.mfa_proofs SET verified_at=clock_timestamp()
 WHERE proof_digest=p_proof AND actor_id=a.actor_id AND mfa_epoch=a.mfa_epoch
 AND credential_epoch=a.credential_epoch AND expires_at>clock_timestamp()
 AND verified_at IS NULL AND consumed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 INSERT INTO sec01_admin.security_audit(event_kind,actor_id) VALUES('mfa_verified',a.actor_id);
 RETURN true;
END $f$;
CREATE FUNCTION sec01_admin.issue_privileged_session(p_subject text,p_proof bytea,p_session uuid,p_digest bytea,p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE a sec01_admin.accounts%ROWTYPE;
BEGIN
 IF session_user <> 'sec01_admin_issuer' OR p_session IS NULL OR p_digest IS NULL OR octet_length(p_digest)<>32
 OR p_expires IS NULL OR p_expires<=clock_timestamp() OR p_expires>clock_timestamp()+interval '15 minutes'
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM sec01_admin.accounts WHERE better_auth_subject=p_subject FOR UPDATE;
 IF NOT FOUND OR NOT a.active OR NOT a.can_edit THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 UPDATE sec01_admin.mfa_proofs SET consumed_at=clock_timestamp()
 WHERE proof_digest=p_proof AND actor_id=a.actor_id AND mfa_epoch=a.mfa_epoch
 AND credential_epoch=a.credential_epoch AND expires_at>clock_timestamp()
 AND verified_at IS NOT NULL AND consumed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 INSERT INTO sec01_admin.sessions VALUES(p_session,a.actor_id,p_digest,a.mfa_epoch,a.credential_epoch,p_expires,NULL);
 INSERT INTO sec01_admin.security_audit(event_kind,actor_id,session_id) VALUES('session_issue_after_mfa',a.actor_id,p_session);
 RETURN a.actor_id;
END $f$;
CREATE FUNCTION sec01_admin.write_pricing(p_session uuid,p_digest bytea,p_operation uuid,p_expected integer,p_config jsonb)
RETURNS TABLE(revision integer,replayed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE aid uuid; a sec01_admin.accounts%ROWTYPE; s sec01_admin.sessions%ROWTYPE;
 v_current integer; v_old sec01_admin.operation_ledger%ROWTYPE;
BEGIN
 IF session_user <> 'sec01_admin_writer' OR p_digest IS NULL OR octet_length(p_digest)<>32
 OR p_operation IS NULL OR p_expected IS NULL OR p_expected<1 OR p_config IS NULL
 OR jsonb_typeof(p_config)<>'object' OR octet_length(p_config::text)>65536
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT actor_id INTO aid FROM sec01_admin.sessions WHERE session_id=p_session;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM sec01_admin.accounts WHERE actor_id=aid FOR UPDATE;
 SELECT * INTO s FROM sec01_admin.sessions WHERE session_id=p_session FOR UPDATE;
 IF NOT FOUND OR NOT a.active OR NOT a.can_edit OR s.token_digest<>p_digest OR s.revoked_at IS NOT NULL
 OR s.mfa_epoch<>a.mfa_epoch OR s.credential_epoch<>a.credential_epoch OR s.expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT p.revision INTO v_current FROM sec01_admin.pricing p WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR s.expires_at<=clock_timestamp() OR NOT EXISTS (
 SELECT 1 FROM sec01_admin.expiry_scheduler_state h WHERE h.singleton AND
 h.last_complete>clock_timestamp()-interval '120 seconds' AND h.last_complete<=clock_timestamp())
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_old FROM sec01_admin.operation_ledger WHERE operation_id=p_operation;
 IF FOUND THEN
  IF v_old.actor_id<>aid OR v_old.session_id<>p_session OR v_old.expected_revision<>p_expected OR v_old.config<>p_config
  THEN RAISE EXCEPTION 'operation conflict' USING ERRCODE='23505'; END IF;
  RETURN QUERY SELECT v_old.committed_revision,true; RETURN;
 END IF;
 IF v_current<>p_expected THEN RAISE EXCEPTION 'revision conflict' USING ERRCODE='40001'; END IF;
 UPDATE sec01_admin.pricing p SET revision=v_current+1,config=p_config WHERE id=1;
 INSERT INTO sec01_admin.operation_ledger VALUES(p_operation,aid,p_session,p_expected,p_config,v_current+1);
 INSERT INTO sec01_admin.security_audit(event_kind,actor_id,session_id,operation_id) VALUES('pricing_write',aid,p_session,p_operation);
 RETURN QUERY SELECT v_current+1,false;
END $f$;
-- Separate browser logout from trusted administrative revoke. Verify digest
-- while holding the same account/session locks as writer; never revoke by UUID alone.
CREATE FUNCTION sec01_admin.revoke_own_session(p_session uuid,p_digest bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE aid uuid; s sec01_admin.sessions%ROWTYPE;
BEGIN
 IF session_user <> 'sec01_admin_logout' OR p_digest IS NULL OR octet_length(p_digest)<>32
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT actor_id INTO aid FROM sec01_admin.sessions WHERE session_id=p_session;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM sec01_admin.accounts WHERE actor_id=aid FOR UPDATE;
 SELECT * INTO s FROM sec01_admin.sessions WHERE session_id=p_session FOR UPDATE;
 IF NOT FOUND OR s.token_digest<>p_digest THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF s.revoked_at IS NULL THEN
  UPDATE sec01_admin.sessions SET revoked_at=clock_timestamp() WHERE session_id=p_session;
  INSERT INTO sec01_admin.security_audit(event_kind,actor_id,session_id) VALUES('session_logout',aid,p_session);
 END IF;
 RETURN true;
END $f$;
CREATE FUNCTION sec01_admin.revoke_session(p_session uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE aid uuid;
BEGIN
 IF session_user <> 'sec01_admin_revoker' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT actor_id INTO aid FROM sec01_admin.sessions WHERE session_id=p_session;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM sec01_admin.accounts WHERE actor_id=aid FOR UPDATE;
 UPDATE sec01_admin.sessions SET revoked_at=clock_timestamp() WHERE session_id=p_session AND revoked_at IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO sec01_admin.security_audit(event_kind,actor_id,session_id) VALUES('session_admin_revoke',aid,p_session);
 RETURN true;
END $f$;
CREATE FUNCTION sec01_admin.revoke_factor(p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user <> 'sec01_admin_revoker' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 UPDATE sec01_admin.accounts SET mfa_epoch=mfa_epoch+1 WHERE actor_id=p_actor;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO sec01_admin.security_audit(event_kind,actor_id) VALUES('factor_revoke',p_actor);
 RETURN true;
END $f$;
CREATE FUNCTION sec01_admin.disable_actor(p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user <> 'sec01_admin_revoker' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 UPDATE sec01_admin.accounts SET active=false,can_edit=false,credential_epoch=credential_epoch+1 WHERE actor_id=p_actor;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO sec01_admin.security_audit(event_kind,actor_id) VALUES('actor_disable',p_actor);
 RETURN true;
END $f$;
CREATE FUNCTION sec01_admin.expire_due_session(p_session uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE aid uuid;
BEGIN
 IF session_user NOT IN ('sec01_admin_revoker','sec01_admin_sweeper') THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT actor_id INTO aid FROM sec01_admin.sessions WHERE session_id=p_session;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM sec01_admin.accounts WHERE actor_id=aid FOR UPDATE;
 UPDATE sec01_admin.sessions SET revoked_at=clock_timestamp()
 WHERE session_id=p_session AND revoked_at IS NULL AND expires_at<=clock_timestamp();
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO sec01_admin.security_audit(event_kind,actor_id,session_id) VALUES('session_expire_event',aid,p_session);
 RETURN true;
END $f$;
CREATE FUNCTION sec01_admin.list_due_expiry(p_limit integer)
RETURNS TABLE(session_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user <> 'sec01_admin_sweeper' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT s.session_id FROM sec01_admin.sessions s WHERE s.revoked_at IS NULL
 AND s.expires_at<=clock_timestamp() ORDER BY s.expires_at,s.session_id LIMIT p_limit;
END $f$;
CREATE FUNCTION sec01_admin.finish_expiry_sweep()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE checked_at timestamptz;
BEGIN
 IF session_user <> 'sec01_admin_sweeper' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM sec01_admin.expiry_scheduler_state WHERE singleton FOR UPDATE;
 checked_at:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM sec01_admin.sessions WHERE revoked_at IS NULL AND expires_at<=checked_at)
 THEN RAISE EXCEPTION 'backlog' USING ERRCODE='42501'; END IF;
 UPDATE sec01_admin.expiry_scheduler_state SET last_complete=checked_at WHERE singleton;
 RETURN true;
END $f$;
REVOKE ALL ON ALL TABLES IN SCHEMA sec01_admin FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sec01_admin FROM PUBLIC;
GRANT USAGE ON SCHEMA sec01_admin TO sec01_admin_mfa_verifier,sec01_admin_issuer,sec01_admin_writer,sec01_admin_revoker,sec01_admin_logout,sec01_admin_sweeper;
GRANT EXECUTE ON FUNCTION sec01_admin.begin_mfa_proof(text,bytea,timestamptz),sec01_admin.mark_mfa_verified(text,bytea) TO sec01_admin_mfa_verifier;
GRANT EXECUTE ON FUNCTION sec01_admin.issue_privileged_session(text,bytea,uuid,bytea,timestamptz) TO sec01_admin_issuer;
GRANT EXECUTE ON FUNCTION sec01_admin.write_pricing(uuid,bytea,uuid,integer,jsonb) TO sec01_admin_writer;
GRANT EXECUTE ON FUNCTION sec01_admin.revoke_own_session(uuid,bytea) TO sec01_admin_logout;
GRANT EXECUTE ON FUNCTION sec01_admin.revoke_session(uuid),sec01_admin.revoke_factor(uuid),sec01_admin.disable_actor(uuid),sec01_admin.expire_due_session(uuid) TO sec01_admin_revoker;
GRANT EXECUTE ON FUNCTION sec01_admin.expire_due_session(uuid),sec01_admin.list_due_expiry(integer),sec01_admin.finish_expiry_sweep() TO sec01_admin_sweeper;
RESET ROLE;
COMMIT;
