-- Disposable PG17 lab, no LIVE use.
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'panokit_sec01_sovereign_lab' OR session_user<>'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regprocedure('sec01_admin.reserve_totp(text,bytea,bytea)') IS NULL
 THEN RAISE EXCEPTION 'disposable lab only'; END IF;
END $guard$;
CREATE ROLE sec01_admin_login_guard LOGIN NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA sec01_admin TO sec01_admin_login_guard;
SET LOCAL ROLE sec01_admin_owner;
CREATE TABLE sec01_admin.login_budget(
 kind text NOT NULL CHECK(kind IN ('ip','account')), tag bytea NOT NULL CHECK(octet_length(tag)=32),
 hits timestamptz[] NOT NULL DEFAULT '{}', PRIMARY KEY(kind,tag),
 CHECK(cardinality(hits)<=20)
);
ALTER TABLE sec01_admin.login_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE sec01_admin.login_budget FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON sec01_admin.login_budget TO sec01_admin_owner USING(true) WITH CHECK(true);
CREATE FUNCTION sec01_admin.reserve_login(p_kind text,p_tag bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE h timestamptz[]; t timestamptz; cap integer;
BEGIN
 IF session_user<>'sec01_admin_login_guard' OR p_kind IS NULL OR p_kind NOT IN ('ip','account') OR p_tag IS NULL OR octet_length(p_tag)<>32
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 cap:=CASE WHEN p_kind='ip' THEN 20 ELSE 5 END;
 INSERT INTO sec01_admin.login_budget(kind,tag) VALUES(p_kind,p_tag) ON CONFLICT DO NOTHING;
 SELECT hits INTO h FROM sec01_admin.login_budget WHERE kind=p_kind AND tag=p_tag FOR UPDATE;
 t:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM unnest(h) x WHERE x>t) THEN RETURN false; END IF;
 SELECT coalesce(array_agg(x ORDER BY x),'{}'::timestamptz[]) INTO h FROM unnest(h) x WHERE x>t-interval '120 seconds';
 IF cardinality(h)>=cap THEN RETURN false; END IF;
 UPDATE sec01_admin.login_budget SET hits=array_append(h,t) WHERE kind=p_kind AND tag=p_tag;
 RETURN true;
END $f$;
REVOKE ALL ON sec01_admin.login_budget FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.reserve_login(text,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec01_admin.reserve_login(text,bytea) TO sec01_admin_login_guard;
RESET ROLE;
COMMIT;
