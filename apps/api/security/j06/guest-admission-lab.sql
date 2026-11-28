-- J07-D1B disposable LAB only, after quote-validity-lab.sql. No customer data or order.
BEGIN;
SET ROLE j06_owner;
ALTER TABLE j06_private.leases ADD COLUMN guest_session_hash text
 CHECK (guest_session_hash IS NULL OR (guest_session_hash ~ '^[a-f0-9]{64}$' AND guest_session_hash<>token_hash));
-- Legacy J06 lease endpoints must not expose bound J07 leases.
CREATE OR REPLACE FUNCTION j06_private.read_lease(p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('quote',q.document,'expiresAt',l.expires_at) INTO result
 FROM j06_private.leases l JOIN j06_private.quotes q ON q.fingerprint=l.fingerprint
 WHERE l.token_hash=p_hash AND l.guest_session_hash IS NULL AND l.expires_at>clock_timestamp();
 RETURN result;
END $$;
CREATE FUNCTION j06_private.issue_guest_lease(p_hash text,p_fingerprint text,p_session text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE issued timestamptz:=clock_timestamp();
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$' OR p_hash=p_session OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO j06_private.leases(token_hash,fingerprint,issued_at,expires_at,guest_session_hash)
 VALUES(p_hash,p_fingerprint,issued,issued+interval '15 minutes',p_session);
 RETURN issued+interval '15 minutes';
END $$;
CREATE FUNCTION j06_private.read_guest_lease(p_hash text,p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('quote',q.document,'expiresAt',l.expires_at) INTO result
 FROM j06_private.leases l JOIN j06_private.quotes q ON q.fingerprint=l.fingerprint
 WHERE l.token_hash=p_hash AND l.guest_session_hash=p_session AND l.expires_at>clock_timestamp();
 RETURN result;
END $$;
CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_session text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.guest_session_hash=p_session AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
CREATE TABLE j06_private.guest_visual_consents (
 receipt_id uuid PRIMARY KEY REFERENCES j06_private.guest_admissions(receipt_id),
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 visual_version text NOT NULL CHECK(visual_version ~ '^lab-[a-z0-9-]{1,59}$'),
 visual_digest text NOT NULL CHECK(visual_digest ~ '^[a-f0-9]{64}$'),
 statement_version text NOT NULL CHECK(statement_version='lab-visual-v1'),
 locale text NOT NULL CHECK(locale IN ('fr','ar')),
 recorded_at timestamptz NOT NULL
);
-- Exact served bytes for configured LAB acknowledgements only; never contact data.
CREATE TABLE j06_private.guest_visual_archive (
 receipt_id uuid PRIMARY KEY REFERENCES j06_private.guest_visual_consents(receipt_id),
 visual_digest text NOT NULL CHECK(visual_digest ~ '^[a-f0-9]{64}$'),
 svg_bytes bytea NOT NULL CHECK(octet_length(svg_bytes) BETWEEN 1 AND 2000000),
 CHECK(visual_digest=encode(sha256(svg_bytes),'hex'))
);
CREATE FUNCTION j06_private.record_guest_visual_consent(p_hash text,p_session text,p_receipt uuid,p_fingerprint text,p_version text,p_digest text,p_locale text,p_bytes bytea DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; consent_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_version IS NULL OR p_version !~ '^lab-[a-z0-9-]{1,59}$' OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' OR p_locale IS NULL OR p_locale NOT IN ('fr','ar') THEN RETURN false; END IF;
 IF p_version='lab-config-v1' THEN
  IF p_bytes IS NULL OR octet_length(p_bytes) NOT BETWEEN 1 AND 2000000 OR encode(sha256(p_bytes),'hex')<>p_digest THEN RETURN false; END IF;
 ELSIF p_bytes IS NOT NULL THEN RETURN false;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM j06_private.guest_admissions a JOIN j06_private.leases l ON l.token_hash=a.token_hash WHERE a.receipt_id=p_receipt AND a.token_hash=p_hash AND a.fingerprint=p_fingerprint AND l.guest_session_hash=p_session AND l.fingerprint=p_fingerprint AND l.expires_at>clock_timestamp()) THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 consent_at:=clock_timestamp();
 INSERT INTO j06_private.guest_visual_consents(receipt_id,fingerprint,visual_version,visual_digest,statement_version,locale,recorded_at)
 SELECT a.receipt_id,a.fingerprint,p_version,p_digest,'lab-visual-v1',p_locale,consent_at
 FROM j06_private.guest_admissions a JOIN j06_private.leases l ON l.token_hash=a.token_hash
 WHERE a.receipt_id=p_receipt AND a.token_hash=p_hash AND a.fingerprint=p_fingerprint AND l.guest_session_hash=p_session AND l.fingerprint=p_fingerprint AND l.expires_at>consent_at
 ON CONFLICT (receipt_id) DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_version='lab-config-v1' THEN
  INSERT INTO j06_private.guest_visual_archive(receipt_id,visual_digest,svg_bytes) VALUES(p_receipt,p_digest,p_bytes);
 END IF;
 RETURN true;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid),j06_private.issue_guest_lease(text,text,text),j06_private.read_guest_lease(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid),j06_private.issue_guest_lease(text,text,text),j06_private.read_guest_lease(text,text) TO j06_runtime;
REVOKE ALL ON j06_private.guest_visual_consents,j06_private.guest_visual_archive FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_visual_consent(text,text,uuid,text,text,text,text,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_visual_consent(text,text,uuid,text,text,text,text,bytea) TO j06_runtime;
COMMIT;
