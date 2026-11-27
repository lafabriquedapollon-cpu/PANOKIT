-- Disposable J06-B LAB only. Execute after industrial-lab.sql in the same isolated DB.
BEGIN;
CREATE ROLE j06_owner NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA j06_private AUTHORIZATION j06_owner;
REVOKE ALL ON SCHEMA j06_private FROM PUBLIC;
GRANT USAGE ON SCHEMA j03_private TO j06_owner;
GRANT SELECT ON j03_private.formats,j03_private.revisions,j03_private.events TO j06_owner;
SET ROLE j06_owner;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE j06_private.heads(format_id text PRIMARY KEY CHECK(format_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),latest bigint NOT NULL DEFAULT 0 CHECK(latest>=0));
CREATE TABLE j06_private.tariffs(
 format_id text NOT NULL REFERENCES j06_private.heads(format_id), revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 document jsonb NOT NULL, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 destinations jsonb NOT NULL, actor name NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(format_id,revision),
 CHECK(document->>'scope'='LAB' AND document->>'formatId'=format_id AND document->>'revision'=revision::text),
 CHECK(jsonb_typeof(destinations)='object')
);
CREATE TABLE j06_private.decisions(
 format_id text NOT NULL, revision bigint NOT NULL, event text NOT NULL CHECK(event IN ('approved','withdrawn')),
 digest text NOT NULL, actor name NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(format_id,revision,event), FOREIGN KEY(format_id,revision) REFERENCES j06_private.tariffs(format_id,revision)
);
CREATE TABLE j06_private.quotes(
 fingerprint text PRIMARY KEY CHECK(fingerprint ~ '^[a-f0-9]{64}$'), format_id text NOT NULL, tariff_revision bigint NOT NULL,
 document jsonb NOT NULL CHECK(document->>'scope'='LAB' AND document->'orderable'='false'::jsonb AND document->>'fingerprint'=fingerprint),
 actor name NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(format_id,tariff_revision) REFERENCES j06_private.tariffs(format_id,revision)
);
CREATE FUNCTION j06_private.save_tariff(p_id text,p_expected bigint,p_doc jsonb,p_digest text,p_dest jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE latest_revision bigint; next_revision bigint; d record;
BEGIN
 IF session_user<>'j06_editor' OR current_database()<>'panokit_j03_industrial_lab' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' OR p_expected IS NULL OR p_expected<0 OR p_expected>=9007199254740991
 OR p_doc IS NULL OR jsonb_typeof(p_doc)<>'object' OR octet_length(p_doc::text)>131072 OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
 OR p_dest IS NULL OR jsonb_typeof(p_dest)<>'object' OR octet_length(p_dest::text)>65536 THEN RAISE EXCEPTION 'invalid' USING ERRCODE='22023'; END IF;
 next_revision:=p_expected+1;
 IF p_doc->>'scope' IS DISTINCT FROM 'LAB' OR p_doc->>'modelId' IS DISTINCT FROM 'caisson-rectangulaire' OR p_doc->>'formatId' IS DISTINCT FROM p_id OR p_doc->>'revision' IS DISTINCT FROM next_revision::text THEN RAISE EXCEPTION 'identity' USING ERRCODE='22023'; END IF;
 FOR d IN SELECT key,value FROM jsonb_each(p_dest) LOOP
 IF d.key !~ '^lab-[a-z0-9-]{1,59}$' OR jsonb_typeof(d.value)<>'object' OR NOT (d.value ?& ARRAY['zoneId','depotId']) OR (d.value - 'zoneId' - 'depotId')<>'{}'::jsonb
 OR coalesce(d.value->>'zoneId','') !~ '^[a-z0-9][a-z0-9-]{0,63}$' OR coalesce(d.value->>'depotId','') !~ '^[a-z0-9][a-z0-9-]{0,63}$'
 OR jsonb_typeof(d.value->'zoneId')<>'string' OR jsonb_typeof(d.value->'depotId')<>'string' THEN RAISE EXCEPTION 'invalid destination' USING ERRCODE='22023'; END IF;
 END LOOP;
 INSERT INTO j06_private.heads(format_id) VALUES(p_id) ON CONFLICT DO NOTHING;
 SELECT latest INTO latest_revision FROM j06_private.heads WHERE format_id=p_id FOR UPDATE;
 IF latest_revision<>p_expected THEN RAISE EXCEPTION 'stale' USING ERRCODE='40001'; END IF;
 INSERT INTO j06_private.tariffs(format_id,revision,document,digest,destinations,actor) VALUES(p_id,next_revision,p_doc,p_digest,p_dest,session_user);
 UPDATE j06_private.heads SET latest=next_revision WHERE format_id=p_id;
 RETURN next_revision;
END $$;
CREATE FUNCTION j06_private.decide(p_id text,p_revision bigint,p_digest text,p_event text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE latest_revision bigint; actual_digest text;
BEGIN
 IF current_database()<>'panokit_j03_industrial_lab' OR NOT ((session_user='j06_approver' AND p_event IS NOT DISTINCT FROM 'approved') OR (session_user='j06_revoker' AND p_event IS NOT DISTINCT FROM 'withdrawn')) THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT latest INTO latest_revision FROM j06_private.heads WHERE format_id=p_id FOR UPDATE;
 IF latest_revision IS NULL OR latest_revision IS DISTINCT FROM p_revision OR p_digest IS NULL THEN RETURN false; END IF;
 SELECT digest INTO actual_digest FROM j06_private.tariffs WHERE format_id=p_id AND revision=p_revision;
 IF actual_digest IS DISTINCT FROM p_digest THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM j06_private.decisions WHERE format_id=p_id AND revision=p_revision AND event='withdrawn') THEN RETURN false; END IF;
 IF p_event='withdrawn' AND NOT EXISTS(SELECT 1 FROM j06_private.decisions WHERE format_id=p_id AND revision=p_revision AND event='approved') THEN RETURN false; END IF;
 INSERT INTO j06_private.decisions(format_id,revision,event,digest,actor) VALUES(p_id,p_revision,p_event,p_digest,session_user) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
-- Single MVCC snapshot across J03 and J06. Dedicated runtime role only; no direct table grants.
CREATE FUNCTION j06_private.read_snapshot(p_id text,p_destination text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
 'industrial',r.document,
 'industrialApproval',CASE WHEN ie.event IS NULL THEN NULL ELSE jsonb_build_object('modelId','caisson-rectangulaire','formatId',r.format_id,'revision',r.revision,'digest',ie.digest,'status',ie.event) END,
 'tariff',t.document,
 'tariffApproval',CASE WHEN te.event IS NULL THEN NULL ELSE jsonb_build_object('scope','LAB','revision',t.revision,'digest',te.digest,'status',te.event) END,
 'resolvedDelivery',CASE WHEN p_destination IS NOT NULL AND t.destinations ? p_destination THEN (t.destinations->p_destination)||jsonb_build_object('destinationRef',p_destination) ELSE NULL END)
 INTO result FROM j03_private.formats f JOIN j03_private.revisions r ON r.format_id=f.id AND r.revision=f.latest
 LEFT JOIN LATERAL (SELECT e.event,e.digest FROM j03_private.events e WHERE e.format_id=r.format_id AND e.revision=r.revision ORDER BY CASE e.event WHEN 'withdrawn' THEN 0 ELSE 1 END LIMIT 1) ie ON true
 LEFT JOIN j06_private.heads h ON h.format_id=f.id LEFT JOIN j06_private.tariffs t ON t.format_id=h.format_id AND t.revision=h.latest
 LEFT JOIN LATERAL (SELECT e.event,e.digest FROM j06_private.decisions e WHERE e.format_id=t.format_id AND e.revision=t.revision ORDER BY CASE e.event WHEN 'withdrawn' THEN 0 ELSE 1 END LIMIT 1) te ON true WHERE f.id=p_id;
 RETURN result;
END $$;
-- Trusted runtime only. Historical LAB quote, not an order capability. No updates/deletes granted.
CREATE FUNCTION j06_private.persist_quote(p_quote jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE s jsonb; fp text; saved jsonb; f text; dest text;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_quote IS NULL OR jsonb_typeof(p_quote)<>'object' OR octet_length(p_quote::text)>32768 OR p_quote->>'scope' IS DISTINCT FROM 'LAB' OR p_quote->'orderable' IS DISTINCT FROM 'false'::jsonb OR p_quote->>'modelId' IS DISTINCT FROM 'caisson-rectangulaire' THEN RETURN false; END IF;
 fp:=p_quote->>'fingerprint';f:=p_quote->>'formatId';dest:=p_quote#>>'{fulfillment,destinationRef}';
 IF fp IS NULL OR fp !~ '^[a-f0-9]{64}$' OR f IS NULL THEN RETURN false; END IF;
 s:=j06_private.read_snapshot(f,dest);
 IF s IS NULL OR s#>>'{industrialApproval,status}' IS DISTINCT FROM 'approved' OR s#>>'{tariffApproval,status}' IS DISTINCT FROM 'approved'
 OR s#>>'{industrial,revision}' IS DISTINCT FROM p_quote->>'industrialRevision' OR s#>>'{industrialApproval,digest}' IS DISTINCT FROM p_quote->>'industrialDigest'
 OR s#>>'{tariff,revision}' IS DISTINCT FROM p_quote->>'tariffRevision' OR s#>>'{tariffApproval,digest}' IS DISTINCT FROM p_quote->>'tariffDigest'
 OR s->'resolvedDelivery' IS DISTINCT FROM p_quote->'resolvedDelivery' THEN RETURN false; END IF;
 INSERT INTO j06_private.quotes(fingerprint,format_id,tariff_revision,document,actor) VALUES(fp,f,(p_quote->>'tariffRevision')::bigint,p_quote,session_user) ON CONFLICT DO NOTHING;
 SELECT document INTO saved FROM j06_private.quotes WHERE fingerprint=fp;
 RETURN saved IS NOT DISTINCT FROM p_quote;
END $$;
RESET ROLE;
REVOKE ALL ON ALL TABLES IN SCHEMA j06_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA j06_private FROM PUBLIC;
GRANT USAGE ON SCHEMA j06_private TO j06_editor,j06_approver,j06_revoker,j06_runtime;
GRANT EXECUTE ON FUNCTION j06_private.save_tariff(text,bigint,jsonb,text,jsonb) TO j06_editor;
GRANT EXECUTE ON FUNCTION j06_private.decide(text,bigint,text,text) TO j06_approver,j06_revoker;
GRANT EXECUTE ON FUNCTION j06_private.read_snapshot(text,text),j06_private.persist_quote(jsonb) TO j06_runtime;
COMMIT;
