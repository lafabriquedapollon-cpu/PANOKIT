-- Disposable PG17 only: persist key identities, fence login generation and bound cardinality.
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'panokit_sec01_sovereign_lab' OR session_user<>'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regprocedure('sec01_admin.write_context_pricing(uuid,bytea,uuid,integer,jsonb,text,text)') IS NULL THEN RAISE EXCEPTION 'disposable only'; END IF;
END $guard$;
SET LOCAL ROLE sec01_admin_owner;
CREATE TABLE sec01_admin.runtime_key_identity(singleton boolean PRIMARY KEY CHECK(singleton),
 login_id bytea NOT NULL CHECK(octet_length(login_id)=32),
 token_id bytea NOT NULL CHECK(octet_length(token_id)=32),
 auth_id bytea NOT NULL CHECK(octet_length(auth_id)=32));
ALTER TABLE sec01_admin.runtime_key_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE sec01_admin.runtime_key_identity FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON sec01_admin.runtime_key_identity TO sec01_admin_owner USING(true) WITH CHECK(true);
CREATE FUNCTION sec01_admin.register_runtime_keys(p_login bytea,p_token bytea,p_auth bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user<>'sec01_admin_revoker' OR p_login IS NULL OR p_token IS NULL OR p_auth IS NULL
 OR octet_length(p_login)<>32 OR octet_length(p_token)<>32 OR octet_length(p_auth)<>32
 OR p_login=p_token OR p_login=p_auth OR p_token=p_auth THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 INSERT INTO sec01_admin.runtime_key_identity VALUES(true,p_login,p_token,p_auth) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $f$;
CREATE FUNCTION sec01_admin.read_runtime_keys()
RETURNS TABLE(login_id bytea,token_id bytea,auth_id bytea,replay_id bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF session_user<>'sec01_admin_mfa_verifier' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT k.login_id,k.token_id,k.auth_id,r.key_id FROM sec01_admin.runtime_key_identity k CROSS JOIN sec01_admin.replay_key_state r WHERE k.singleton AND r.singleton;
END $f$;
CREATE FUNCTION sec01_admin.reserve_versioned_login(p_kind text,p_tag bytea,p_key bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE t timestamptz;
BEGIN
 IF session_user<>'sec01_admin_login_guard' OR p_kind IS NULL OR p_kind NOT IN('ip','account') OR p_tag IS NULL OR octet_length(p_tag)<>32
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR NOT EXISTS(SELECT 1 FROM sec01_admin.runtime_key_identity WHERE singleton AND login_id=p_key) THEN RETURN false; END IF;
 -- Serialize admission for bounded row cardinality. LAB thresholds; no production throughput claim.
 PERFORM 1 FROM sec01_admin.runtime_key_identity WHERE singleton FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM sec01_admin.login_budget WHERE kind=p_kind AND tag=p_tag) THEN
   IF (SELECT count(*) FROM sec01_admin.login_budget WHERE kind=p_kind)>=1024 THEN
     t:=clock_timestamp();
     WITH old AS (SELECT b.tag FROM sec01_admin.login_budget b WHERE b.kind=p_kind
       AND NOT EXISTS(SELECT 1 FROM unnest(b.hits) x WHERE x>t-interval '120 seconds')
       ORDER BY b.tag LIMIT 100)
     DELETE FROM sec01_admin.login_budget b USING old WHERE b.kind=p_kind AND b.tag=old.tag;
     IF (SELECT count(*) FROM sec01_admin.login_budget WHERE kind=p_kind)>=1024 THEN RETURN false; END IF;
   END IF;
 END IF;
 RETURN sec01_admin.reserve_login(p_kind,p_tag);
END $f$;
REVOKE ALL ON sec01_admin.runtime_key_identity FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.register_runtime_keys(bytea,bytea,bytea),sec01_admin.read_runtime_keys(),sec01_admin.reserve_versioned_login(text,bytea,bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.reserve_login(text,bytea) FROM sec01_admin_login_guard;
GRANT EXECUTE ON FUNCTION sec01_admin.register_runtime_keys(bytea,bytea,bytea) TO sec01_admin_revoker;
GRANT EXECUTE ON FUNCTION sec01_admin.read_runtime_keys() TO sec01_admin_mfa_verifier;
GRANT EXECUTE ON FUNCTION sec01_admin.reserve_versioned_login(text,bytea,bytea) TO sec01_admin_login_guard;
RESET ROLE;
COMMIT;
