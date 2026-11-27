-- J04: DISPOSABLE PG17 CI ONLY. Never execute against Supabase.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE pk_anon NOLOGIN;
CREATE ROLE pk_authenticated NOLOGIN;
CREATE ROLE pk_j04_reader NOLOGIN NOBYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA panokit_private;
REVOKE ALL ON SCHEMA auth, panokit_private FROM PUBLIC;
CREATE TABLE auth.users(id uuid PRIMARY KEY, deleted_at timestamptz, banned_until timestamptz);
CREATE TABLE auth.sessions(
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
  not_after timestamptz, aal text NOT NULL CHECK(aal IN ('aal1','aal2'))
);
CREATE TABLE panokit_private.pricing_admin_acl(
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  can_view boolean NOT NULL, can_edit boolean NOT NULL, revoked_at timestamptz
);
ALTER TABLE panokit_private.pricing_admin_acl ENABLE ROW LEVEL SECURITY;
ALTER TABLE panokit_private.pricing_admin_acl FORCE ROW LEVEL SECURITY;
CREATE POLICY j04_reader_select ON panokit_private.pricing_admin_acl
 FOR SELECT TO pk_j04_reader USING (true);
GRANT USAGE ON SCHEMA auth, panokit_private TO pk_j04_reader;
GRANT SELECT (id,deleted_at,banned_until) ON auth.users TO pk_j04_reader;
GRANT SELECT (id,user_id,not_after,aal) ON auth.sessions TO pk_j04_reader;
GRANT SELECT (user_id,can_view,can_edit,revoked_at) ON panokit_private.pricing_admin_acl TO pk_j04_reader;
INSERT INTO auth.users(id) VALUES('c3f2036c-cace-4f0a-a0fe-45ee148e3bca');
INSERT INTO auth.sessions(id,user_id,not_after,aal)
 VALUES('4a277ba6-d999-4616-a6de-22fc28e2b1e9','c3f2036c-cace-4f0a-a0fe-45ee148e3bca',
 NOW()+interval '1 hour','aal2');
INSERT INTO panokit_private.pricing_admin_acl(user_id,can_view,can_edit)
 VALUES('c3f2036c-cace-4f0a-a0fe-45ee148e3bca',true,true);
DO $$
BEGIN
 IF has_schema_privilege('pk_anon','auth','USAGE') OR
    has_schema_privilege('pk_authenticated','panokit_private','USAGE') OR
    has_table_privilege('pk_anon','auth.sessions','SELECT') OR
    has_table_privilege('pk_authenticated','panokit_private.pricing_admin_acl','SELECT') OR
    has_table_privilege('pk_j04_reader','panokit_private.pricing_admin_acl','UPDATE') OR
    has_table_privilege('pk_j04_reader','auth.sessions','DELETE') THEN
  RAISE EXCEPTION 'J04 privilege separation failure';
 END IF;
END $$;
SET ROLE pk_j04_reader;
DO $$
DECLARE u_active boolean; s_active boolean; lvl text; can_v boolean; can_e boolean;
BEGIN
 SELECT(u.deleted_at IS NULL AND
   (u.banned_until IS NULL OR u.banned_until<=NOW())),
  (s.not_after IS NULL OR s.not_after>NOW()),s.aal::text,
  (acl.user_id IS NOT NULL AND acl.revoked_at IS NULL AND acl.can_view IS TRUE),
  (acl.user_id IS NOT NULL AND acl.revoked_at IS NULL AND acl.can_edit IS TRUE)
  INTO u_active,s_active,lvl,can_v,can_e
 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
 LEFT JOIN panokit_private.pricing_admin_acl acl ON acl.user_id=u.id
 WHERE u.id='c3f2036c-cace-4f0a-a0fe-45ee148e3bca'
   AND s.id='4a277ba6-d999-4616-a6de-22fc28e2b1e9';
 IF NOT(u_active AND s_active AND lvl='aal2' AND can_v AND can_e) THEN
  RAISE EXCEPTION 'J04 synthetic admin should be valid';
 END IF;
END $$;
RESET ROLE;
UPDATE panokit_private.pricing_admin_acl SET revoked_at=NOW();
UPDATE auth.sessions SET aal='aal1',not_after=NOW()-interval '1 minute';
UPDATE auth.users SET banned_until=NOW()+interval '1 hour';
SET ROLE pk_j04_reader;
DO $$
DECLARE user_ok boolean; session_ok boolean; lvl text; can_edit boolean;
BEGIN
 SELECT(u.deleted_at IS NULL AND
   (u.banned_until IS NULL OR u.banned_until<=NOW())),
  (s.not_after IS NULL OR s.not_after>NOW()),s.aal::text,
  (acl.user_id IS NOT NULL AND acl.revoked_at IS NULL AND acl.can_edit IS TRUE)
  INTO user_ok,session_ok,lvl,can_edit
 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
 LEFT JOIN panokit_private.pricing_admin_acl acl ON acl.user_id=u.id
 WHERE u.id='c3f2036c-cace-4f0a-a0fe-45ee148e3bca'
   AND s.id='4a277ba6-d999-4616-a6de-22fc28e2b1e9';
 IF user_ok IS DISTINCT FROM false OR session_ok IS DISTINCT FROM false
   OR lvl IS DISTINCT FROM 'aal1' OR can_edit IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'J04 stale privileges / session / AAL not denied';
 END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'J04 PostgreSQL 17 isolated privilege and session gate PASS' AS proof;
