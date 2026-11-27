-- Disposable laboratory only. Durable maintenance journal, trusted recovery port.
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'panokit_sec01_sovereign_lab' OR session_user<>'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regprocedure('sec01_admin.open_credential_maintenance(uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION 'disposable lab only'; END IF;
END $guard$;
SET LOCAL ROLE sec01_admin_owner;
CREATE TABLE sec01_admin.maintenance_recovery(
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES sec01_admin.accounts,
 phase text NOT NULL CHECK(phase IN ('frozen','verified','closed')),
 opened_at timestamptz NOT NULL DEFAULT clock_timestamp(), verified_at timestamptz, closed_at timestamptz,
 CHECK((phase='frozen' AND verified_at IS NULL AND closed_at IS NULL)
 OR (phase='verified' AND verified_at IS NOT NULL AND closed_at IS NULL)
 OR (phase='closed' AND verified_at IS NOT NULL AND closed_at IS NOT NULL))
);
ALTER TABLE sec01_admin.maintenance_recovery ENABLE ROW LEVEL SECURITY;
ALTER TABLE sec01_admin.maintenance_recovery FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON sec01_admin.maintenance_recovery TO sec01_admin_owner USING(true) WITH CHECK(true);
CREATE FUNCTION sec01_admin.recovery_open(p_actor uuid,p_op uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE j sec01_admin.maintenance_recovery%ROWTYPE;
BEGIN
 IF session_user<>'sec01_admin_revoker' OR p_op IS NULL THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM sec01_admin.accounts WHERE actor_id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM sec01_admin.maintenance_recovery WHERE operation_id=p_op;
 IF FOUND THEN
 IF j.actor_id<>p_actor THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 RETURN j.phase;
 END IF;
 PERFORM sec01_admin.open_credential_maintenance(p_actor,p_op);
 INSERT INTO sec01_admin.maintenance_recovery(operation_id,actor_id,phase) VALUES(p_op,p_actor,'frozen');
 RETURN 'frozen';
END $f$;
CREATE FUNCTION sec01_admin.recovery_status(p_actor uuid,p_op uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user<>'sec01_admin_revoker' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 RETURN (SELECT phase FROM sec01_admin.maintenance_recovery WHERE actor_id=p_actor AND operation_id=p_op);
END $f$;
-- Trusted operator must establish actual new credential + MFA in native auth before calling.
-- Provider row lock first, then account lock, preserving the lifecycle ordering.
CREATE FUNCTION sec01_admin.recovery_verify(p_actor uuid,p_op uuid,p_provider text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE a sec01_admin.accounts%ROWTYPE; j sec01_admin.maintenance_recovery%ROWTYPE;
BEGIN
 IF session_user<>'sec01_admin_revoker' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM sec01_admin.accounts WHERE actor_id=p_actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM sec01_admin.lock_live_provider(p_provider,a.better_auth_subject);
 SELECT * INTO a FROM sec01_admin.accounts WHERE actor_id=p_actor FOR UPDATE;
 SELECT * INTO j FROM sec01_admin.maintenance_recovery WHERE operation_id=p_op AND actor_id=p_actor;
 IF NOT FOUND OR j.phase NOT IN ('frozen','verified') OR a.active OR NOT a.can_edit
 OR NOT EXISTS(SELECT 1 FROM sec01_admin.credential_maintenance WHERE actor_id=p_actor AND operation_id=p_op)
 OR NOT EXISTS(SELECT 1 FROM public."user" WHERE id=a.better_auth_subject AND "twoFactorEnabled"=true)
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF j.phase='verified' THEN RETURN 'verified'; END IF;
 UPDATE sec01_admin.maintenance_recovery SET phase='verified',verified_at=clock_timestamp() WHERE operation_id=p_op;
 INSERT INTO sec01_admin.security_audit(event_kind,actor_id,operation_id) VALUES('credentials_recovery_verified',p_actor,p_op);
 RETURN 'verified';
END $f$;
CREATE FUNCTION sec01_admin.recovery_close(p_actor uuid,p_op uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE j sec01_admin.maintenance_recovery%ROWTYPE;
BEGIN
 IF session_user<>'sec01_admin_revoker' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM sec01_admin.accounts WHERE actor_id=p_actor FOR UPDATE;
 SELECT * INTO j FROM sec01_admin.maintenance_recovery WHERE operation_id=p_op AND actor_id=p_actor;
 IF NOT FOUND OR j.phase NOT IN ('verified','closed') THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF j.phase='closed' THEN RETURN 'closed'; END IF;
 PERFORM sec01_admin.close_credential_maintenance(p_actor,p_op);
 UPDATE sec01_admin.maintenance_recovery SET phase='closed',closed_at=clock_timestamp() WHERE operation_id=p_op;
 RETURN 'closed';
END $f$;
REVOKE ALL ON sec01_admin.maintenance_recovery FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.open_credential_maintenance(uuid,uuid),sec01_admin.close_credential_maintenance(uuid,uuid) FROM sec01_admin_revoker;
REVOKE EXECUTE ON FUNCTION sec01_admin.recovery_open(uuid,uuid),sec01_admin.recovery_status(uuid,uuid),sec01_admin.recovery_verify(uuid,uuid,text),sec01_admin.recovery_close(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec01_admin.recovery_open(uuid,uuid),sec01_admin.recovery_status(uuid,uuid),sec01_admin.recovery_verify(uuid,uuid,text),sec01_admin.recovery_close(uuid,uuid) TO sec01_admin_revoker;
RESET ROLE;
COMMIT;
