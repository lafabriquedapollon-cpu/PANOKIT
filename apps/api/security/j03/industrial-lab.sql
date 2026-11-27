-- DISPOSABLE LAB ONLY. No production migration. Login roles created by harness.
BEGIN;
CREATE ROLE j03_owner NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA j03_private AUTHORIZATION j03_owner;
REVOKE ALL ON SCHEMA j03_private FROM PUBLIC;
SET ROLE j03_owner;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE j03_private.formats (
 id text PRIMARY KEY CHECK(id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
 latest bigint NOT NULL DEFAULT 0 CHECK(latest >= 0)
);
CREATE TABLE j03_private.revisions (
 format_id text NOT NULL REFERENCES j03_private.formats(id),
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 document jsonb NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 created_by name NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(format_id,revision),
 CHECK(jsonb_typeof(document)='object' AND document->>'modelId'='caisson-rectangulaire' AND document->>'formatId'=format_id AND (document->>'revision')::bigint=revision)
);
CREATE TABLE j03_private.events (
 format_id text NOT NULL,
 revision bigint NOT NULL,
 event text NOT NULL CHECK(event IN ('approved','withdrawn')),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 actor name NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(format_id,revision,event),
 FOREIGN KEY(format_id,revision) REFERENCES j03_private.revisions(format_id,revision)
);
CREATE FUNCTION j03_private.save_draft(p_id text,p_expected bigint,p_document jsonb,p_digest text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j03_private AS $$
DECLARE v_latest bigint; v_next bigint;
BEGIN
 IF session_user <> 'j03_editor' OR current_database() <> 'panokit_j03_industrial_lab' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' OR p_expected IS NULL OR p_expected<0 OR p_expected>=9007199254740991
 OR p_document IS NULL OR jsonb_typeof(p_document)<>'object' OR octet_length(p_document::text)>32768 OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='22023'; END IF;
 v_next:=p_expected+1;
 IF p_document->>'modelId' IS DISTINCT FROM 'caisson-rectangulaire' OR p_document->>'formatId' IS DISTINCT FROM p_id OR p_document->>'revision' IS DISTINCT FROM v_next::text THEN RAISE EXCEPTION 'identity mismatch' USING ERRCODE='22023'; END IF;
 INSERT INTO j03_private.formats(id) VALUES(p_id) ON CONFLICT DO NOTHING;
 SELECT latest INTO v_latest FROM j03_private.formats WHERE id=p_id FOR UPDATE;
 IF v_latest<>p_expected THEN RAISE EXCEPTION 'stale revision' USING ERRCODE='40001'; END IF;
 INSERT INTO j03_private.revisions(format_id,revision,document,digest,created_by) VALUES(p_id,v_next,p_document,p_digest,session_user);
 UPDATE j03_private.formats SET latest=v_next WHERE id=p_id;
 RETURN v_next;
END $$;
CREATE FUNCTION j03_private.record_decision(p_id text,p_revision bigint,p_digest text,p_event text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j03_private AS $$
DECLARE v_latest bigint; v_digest text;
BEGIN
 IF current_database()<>'panokit_j03_industrial_lab' OR NOT ((session_user='j03_approver' AND p_event='approved') OR (session_user='j03_revoker' AND p_event='withdrawn')) THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_event IS NULL OR p_revision IS NULL OR p_digest IS NULL THEN RAISE EXCEPTION 'invalid' USING ERRCODE='22023'; END IF;
 SELECT latest INTO v_latest FROM j03_private.formats WHERE id=p_id FOR UPDATE;
 IF v_latest IS DISTINCT FROM p_revision THEN RETURN false; END IF;
 SELECT digest INTO v_digest FROM j03_private.revisions WHERE format_id=p_id AND revision=p_revision;
 IF v_digest IS DISTINCT FROM p_digest THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM j03_private.events WHERE format_id=p_id AND revision=p_revision AND event='withdrawn') THEN RETURN false; END IF;
 IF p_event='withdrawn' AND NOT EXISTS(SELECT 1 FROM j03_private.events WHERE format_id=p_id AND revision=p_revision AND event='approved') THEN RETURN false; END IF;
 INSERT INTO j03_private.events(format_id,revision,event,digest,actor) VALUES(p_id,p_revision,p_event,p_digest,session_user) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
CREATE FUNCTION j03_private.read_snapshot(p_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,j03_private AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'j03_reader' OR current_database()<>'panokit_j03_industrial_lab' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('revision',r.document,'approval',
   CASE WHEN a.event IS NULL THEN NULL ELSE jsonb_build_object('modelId','caisson-rectangulaire','formatId',r.format_id,'revision',r.revision,'digest',a.digest,'status',a.event) END)
 INTO result FROM j03_private.formats f JOIN j03_private.revisions r ON r.format_id=f.id AND r.revision=f.latest
 LEFT JOIN LATERAL (SELECT e.event,e.digest FROM j03_private.events e WHERE e.format_id=r.format_id AND e.revision=r.revision ORDER BY CASE e.event WHEN 'withdrawn' THEN 0 ELSE 1 END LIMIT 1) a ON true WHERE f.id=p_id;
 RETURN result;
END $$;
RESET ROLE;
REVOKE ALL ON ALL TABLES IN SCHEMA j03_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA j03_private FROM PUBLIC;
GRANT USAGE ON SCHEMA j03_private TO j03_editor,j03_approver,j03_revoker,j03_reader;
GRANT EXECUTE ON FUNCTION j03_private.save_draft(text,bigint,jsonb,text) TO j03_editor;
GRANT EXECUTE ON FUNCTION j03_private.record_decision(text,bigint,text,text) TO j03_approver,j03_revoker;
GRANT EXECUTE ON FUNCTION j03_private.read_snapshot(text) TO j03_reader;
COMMIT;
