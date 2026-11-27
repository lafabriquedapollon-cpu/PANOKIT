-- LAB ONLY. Install only after exact R2 + native Better Auth migrations in same fresh PG17 DB.
BEGIN;
DO $guard$ BEGIN
 IF current_database() <> 'panokit_sec01_sovereign_lab' OR session_user <> 'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'disposable lab only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND c.relname='session' AND r.rolname='panokit_mfa_lab') THEN RAISE EXCEPTION 'unexpected provider session table owner'; END IF;
END $guard$;
-- No public table access for the six client roles. Only the NOLOGIN definer can inspect/lock provider rows.
GRANT SELECT (id,"userId","expiresAt"), UPDATE (id) ON public."session" TO sec01_admin_owner;
SET LOCAL ROLE sec01_admin_owner;
CREATE TABLE sec01_admin.provider_proof_binding (
 proof_digest bytea PRIMARY KEY REFERENCES sec01_admin.mfa_proofs(proof_digest),
 provider_session_id text NOT NULL UNIQUE CHECK(length(provider_session_id) BETWEEN 1 AND 256),
 subject text NOT NULL CHECK(length(subject) BETWEEN 6 AND 150),
 privileged_session_id uuid UNIQUE REFERENCES sec01_admin.sessions(session_id)
);
ALTER TABLE sec01_admin.provider_proof_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE sec01_admin.provider_proof_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON sec01_admin.provider_proof_binding TO sec01_admin_owner USING (true) WITH CHECK (true);
-- Lock provider row FIRST. Its DELETE/UPDATE cannot commit during a privileged operation.
CREATE FUNCTION sec01_admin.lock_live_provider(p_id text,p_subject text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 PERFORM 1 FROM public."session" s WHERE s.id=p_id AND s."userId"=p_subject AND s."expiresAt">clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
END $f$;
CREATE FUNCTION sec01_admin.mark_bound_mfa(p_subject text,p_proof bytea,p_provider text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user<>'sec01_admin_mfa_verifier' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM sec01_admin.lock_live_provider(p_provider,p_subject);
 PERFORM sec01_admin.mark_mfa_verified(p_subject,p_proof);
 INSERT INTO sec01_admin.provider_proof_binding(proof_digest,provider_session_id,subject) VALUES(p_proof,p_provider,p_subject);
 RETURN true;
END $f$;
CREATE FUNCTION sec01_admin.issue_bound_session(p_subject text,p_proof bytea,p_session uuid,p_digest bytea,p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE b sec01_admin.provider_proof_binding%ROWTYPE; a uuid;
BEGIN
 IF session_user<>'sec01_admin_issuer' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM sec01_admin.provider_proof_binding WHERE proof_digest=p_proof AND subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM sec01_admin.lock_live_provider(b.provider_session_id,b.subject);
 a:=sec01_admin.issue_privileged_session(p_subject,p_proof,p_session,p_digest,p_expires);
 UPDATE sec01_admin.provider_proof_binding SET privileged_session_id=p_session WHERE proof_digest=p_proof AND privileged_session_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 RETURN a;
END $f$;
CREATE FUNCTION sec01_admin.write_bound_pricing(p_session uuid,p_digest bytea,p_operation uuid,p_expected integer,p_config jsonb)
RETURNS TABLE(revision integer,replayed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE b sec01_admin.provider_proof_binding%ROWTYPE;
BEGIN
 IF session_user<>'sec01_admin_writer' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM sec01_admin.provider_proof_binding WHERE privileged_session_id=p_session;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM sec01_admin.lock_live_provider(b.provider_session_id,b.subject);
 RETURN QUERY SELECT * FROM sec01_admin.write_pricing(p_session,p_digest,p_operation,p_expected,p_config);
END $f$;
-- Native session deletion revokes already-issued privileges in the same transaction.
-- Correctness of subsequent reads/writes does not depend on audit trigger alone: live-row lock is mandatory.
CREATE FUNCTION sec01_admin.on_provider_session_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE sid uuid; aid uuid;
BEGIN
 SELECT b.privileged_session_id INTO sid FROM sec01_admin.provider_proof_binding b WHERE b.provider_session_id=OLD.id AND b.subject=OLD."userId";
 IF sid IS NULL THEN RETURN OLD; END IF;
 SELECT actor_id INTO aid FROM sec01_admin.sessions WHERE session_id=sid;
 PERFORM 1 FROM sec01_admin.accounts WHERE actor_id=aid FOR UPDATE;
 UPDATE sec01_admin.sessions SET revoked_at=clock_timestamp() WHERE session_id=sid AND revoked_at IS NULL;
 IF FOUND THEN INSERT INTO sec01_admin.security_audit(event_kind,actor_id,session_id) VALUES('provider_session_logout',aid,sid); END IF;
 RETURN OLD;
END $f$;
REVOKE ALL ON sec01_admin.provider_proof_binding FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.lock_live_provider(text,text),sec01_admin.on_provider_session_delete(),sec01_admin.mark_bound_mfa(text,bytea,text),sec01_admin.issue_bound_session(text,bytea,uuid,bytea,timestamptz),sec01_admin.write_bound_pricing(uuid,bytea,uuid,integer,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.mark_mfa_verified(text,bytea) FROM sec01_admin_mfa_verifier;
REVOKE EXECUTE ON FUNCTION sec01_admin.issue_privileged_session(text,bytea,uuid,bytea,timestamptz) FROM sec01_admin_issuer;
REVOKE EXECUTE ON FUNCTION sec01_admin.write_pricing(uuid,bytea,uuid,integer,jsonb) FROM sec01_admin_writer;
GRANT EXECUTE ON FUNCTION sec01_admin.mark_bound_mfa(text,bytea,text) TO sec01_admin_mfa_verifier;
GRANT EXECUTE ON FUNCTION sec01_admin.issue_bound_session(text,bytea,uuid,bytea,timestamptz) TO sec01_admin_issuer;
GRANT EXECUTE ON FUNCTION sec01_admin.write_bound_pricing(uuid,bytea,uuid,integer,jsonb) TO sec01_admin_writer;
RESET ROLE;
CREATE TRIGGER sec01_provider_session_delete AFTER DELETE ON public."session" FOR EACH ROW EXECUTE FUNCTION sec01_admin.on_provider_session_delete();
COMMIT;
