-- LAB only. Overlay for trusted maintenance and versioned replay keys.
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'panokit_sec01_sovereign_lab' OR session_user<>'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regprocedure('sec01_admin.reserve_totp(text,bytea,bytea)') IS NULL THEN RAISE EXCEPTION 'disposable lab only'; END IF;
END $guard$;
GRANT SELECT (id,"twoFactorEnabled") ON public."user" TO sec01_admin_owner;
SET LOCAL ROLE sec01_admin_owner;
CREATE TABLE sec01_admin.credential_maintenance(actor_id uuid PRIMARY KEY REFERENCES sec01_admin.accounts, operation_id uuid UNIQUE NOT NULL, opened_at timestamptz NOT NULL);
CREATE TABLE sec01_admin.replay_key_state(singleton boolean PRIMARY KEY CHECK(singleton), key_id bytea NOT NULL CHECK(octet_length(key_id)=32), generation bigint NOT NULL CHECK(generation>=1));
CREATE TABLE sec01_admin.replay_key_history(key_id bytea PRIMARY KEY CHECK(octet_length(key_id)=32));
DO $rls$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['credential_maintenance','replay_key_state','replay_key_history'] LOOP
 EXECUTE format('ALTER TABLE sec01_admin.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE sec01_admin.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY owner_only ON sec01_admin.%I TO sec01_admin_owner USING(true) WITH CHECK(true)',t);
 END LOOP;
END $rls$;
CREATE FUNCTION sec01_admin.open_credential_maintenance(p_actor uuid,p_operation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user<>'sec01_admin_revoker' OR p_operation IS NULL THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 UPDATE sec01_admin.accounts SET active=false,mfa_epoch=mfa_epoch+1,credential_epoch=credential_epoch+1 WHERE actor_id=p_actor AND active AND can_edit;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 INSERT INTO sec01_admin.credential_maintenance VALUES(p_actor,p_operation,clock_timestamp());
 INSERT INTO sec01_admin.security_audit(event_kind,actor_id,operation_id) VALUES('credentials_maintenance_open',p_actor,p_operation);
 RETURN true;
END $f$;
CREATE FUNCTION sec01_admin.close_credential_maintenance(p_actor uuid,p_operation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE a sec01_admin.accounts%ROWTYPE;
BEGIN
 IF session_user<>'sec01_admin_revoker' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM sec01_admin.accounts WHERE actor_id=p_actor FOR UPDATE;
 IF NOT FOUND OR a.active OR NOT a.can_edit OR NOT EXISTS(SELECT 1 FROM sec01_admin.credential_maintenance WHERE actor_id=p_actor AND operation_id=p_operation)
 OR NOT EXISTS(SELECT 1 FROM public."user" WHERE id=a.better_auth_subject AND "twoFactorEnabled"=true)
 OR EXISTS(SELECT 1 FROM public."session" WHERE "userId"=a.better_auth_subject) THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 UPDATE sec01_admin.accounts SET active=true WHERE actor_id=p_actor;
 DELETE FROM sec01_admin.credential_maintenance WHERE actor_id=p_actor AND operation_id=p_operation;
 INSERT INTO sec01_admin.security_audit(event_kind,actor_id,operation_id) VALUES('credentials_maintenance_close',p_actor,p_operation);
 RETURN true;
END $f$;
-- Serialized with all reservations. Old key IDs never become current again.
CREATE FUNCTION sec01_admin.rotate_replay_key(p_key bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE t timestamptz;
BEGIN
 IF session_user<>'sec01_admin_revoker' OR p_key IS NULL OR octet_length(p_key)<>32 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 LOCK TABLE sec01_admin.replay_key_state IN EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM sec01_admin.replay_key_history WHERE key_id=p_key) THEN RETURN false; END IF;
 t:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM sec01_admin.totp_attempts WHERE attempted_at>t-interval '120 seconds') THEN RETURN false; END IF;
 INSERT INTO sec01_admin.replay_key_history VALUES(p_key);
 INSERT INTO sec01_admin.replay_key_state VALUES(true,p_key,1)
 ON CONFLICT(singleton) DO UPDATE SET key_id=excluded.key_id,generation=sec01_admin.replay_key_state.generation+1;
 RETURN true;
END $f$;
CREATE FUNCTION sec01_admin.reserve_versioned_totp(p_subject text,p_proof bytea,p_tag bytea,p_key bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user<>'sec01_admin_mfa_verifier' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 LOCK TABLE sec01_admin.replay_key_state IN SHARE MODE;
 IF p_key IS NULL OR NOT EXISTS(SELECT 1 FROM sec01_admin.replay_key_state WHERE singleton AND key_id=p_key) THEN RETURN false; END IF;
 RETURN sec01_admin.reserve_totp(p_subject,p_proof,p_tag);
END $f$;
REVOKE EXECUTE ON FUNCTION sec01_admin.reserve_totp(text,bytea,bytea) FROM sec01_admin_mfa_verifier;
REVOKE ALL ON sec01_admin.credential_maintenance,sec01_admin.replay_key_state,sec01_admin.replay_key_history FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.open_credential_maintenance(uuid,uuid),sec01_admin.close_credential_maintenance(uuid,uuid),sec01_admin.rotate_replay_key(bytea),sec01_admin.reserve_versioned_totp(text,bytea,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec01_admin.open_credential_maintenance(uuid,uuid),sec01_admin.close_credential_maintenance(uuid,uuid),sec01_admin.rotate_replay_key(bytea) TO sec01_admin_revoker;
GRANT EXECUTE ON FUNCTION sec01_admin.reserve_versioned_totp(text,bytea,bytea,bytea) TO sec01_admin_mfa_verifier;
RESET ROLE;
COMMIT;
