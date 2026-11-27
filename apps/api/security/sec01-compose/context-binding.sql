-- Disposable PG17 composition only. Bind each privileged request to its native session.
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'panokit_sec01_sovereign_lab' OR session_user<>'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regprocedure('sec01_admin.sweep_expiry_batch(uuid,integer)') IS NULL THEN RAISE EXCEPTION 'disposable only'; END IF;
END $guard$;
SET LOCAL ROLE sec01_admin_owner;
CREATE FUNCTION sec01_admin.write_context_pricing(p_session uuid,p_digest bytea,p_operation uuid,p_expected integer,p_config jsonb,p_subject text,p_provider text)
RETURNS TABLE(revision integer,replayed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user<>'sec01_admin_writer' OR NOT EXISTS(SELECT 1 FROM sec01_admin.provider_proof_binding WHERE privileged_session_id=p_session AND subject=p_subject AND provider_session_id=p_provider)
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM sec01_admin.write_bound_pricing(p_session,p_digest,p_operation,p_expected,p_config);
END $f$;
CREATE FUNCTION sec01_admin.logout_context(p_session uuid,p_digest bytea,p_subject text,p_provider text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user<>'sec01_admin_logout' OR NOT EXISTS(SELECT 1 FROM sec01_admin.provider_proof_binding WHERE privileged_session_id=p_session AND subject=p_subject AND provider_session_id=p_provider)
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM sec01_admin.lock_live_provider(p_provider,p_subject);
 RETURN sec01_admin.revoke_own_session(p_session,p_digest);
END $f$;
REVOKE EXECUTE ON FUNCTION sec01_admin.write_context_pricing(uuid,bytea,uuid,integer,jsonb,text,text),sec01_admin.logout_context(uuid,bytea,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.write_bound_pricing(uuid,bytea,uuid,integer,jsonb) FROM sec01_admin_writer;
REVOKE EXECUTE ON FUNCTION sec01_admin.revoke_own_session(uuid,bytea) FROM sec01_admin_logout;
GRANT EXECUTE ON FUNCTION sec01_admin.write_context_pricing(uuid,bytea,uuid,integer,jsonb,text,text) TO sec01_admin_writer;
GRANT EXECUTE ON FUNCTION sec01_admin.logout_context(uuid,bytea,text,text) TO sec01_admin_logout;
RESET ROLE;
COMMIT;
