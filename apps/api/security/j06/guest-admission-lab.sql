-- J07-D1B disposable LAB only, after quote-validity-lab.sql. No customer data or order.
BEGIN;
SET ROLE j06_owner;
ALTER TABLE j06_private.leases ADD COLUMN guest_session_hash text
 CHECK (guest_session_hash IS NULL OR (guest_session_hash ~ '^[a-f0-9]{64}CREATE TABLE j06_private.guest_admissions (
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
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64} THEN RETURN false; END IF;
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
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
REVOKE ALL ON FUNCTION j06_private.issue_guest_lease(text,text,text),j06_private.read_guest_lease(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.issue_guest_lease(text,text,text),j06_private.read_guest_lease(text,text) TO j06_runtime;
COMMIT;
 AND guest_session_hash<>token_hash));
-- Legacy J06 lease endpoints must not expose bound J07 leases.
CREATE OR REPLACE FUNCTION j06_private.read_lease(p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $
DECLARE result jsonb;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('quote',q.document,'expiresAt',l.expires_at) INTO result
 FROM j06_private.leases l JOIN j06_private.quotes q ON q.fingerprint=l.fingerprint
 WHERE l.token_hash=p_hash AND l.guest_session_hash IS NULL AND l.expires_at>clock_timestamp();
 RETURN result;
END $;
CREATE FUNCTION j06_private.issue_guest_lease(p_hash text,p_fingerprint text,p_session text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $
DECLARE issued timestamptz:=clock_timestamp();
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 OR p_hash=p_session OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 THEN RAISE EXCEPTION 'invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO j06_private.leases(token_hash,fingerprint,issued_at,expires_at,guest_session_hash)
 VALUES(p_hash,p_fingerprint,issued,issued+interval '15 minutes',p_session);
 RETURN issued+interval '15 minutes';
END $;
CREATE FUNCTION j06_private.read_guest_lease(p_hash text,p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $
DECLARE result jsonb;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('quote',q.document,'expiresAt',l.expires_at) INTO result
 FROM j06_private.leases l JOIN j06_private.quotes q ON q.fingerprint=l.fingerprint
 WHERE l.token_hash=p_hash AND l.guest_session_hash=p_session AND l.expires_at>clock_timestamp();
 RETURN result;
END $;
CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64} THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 AND guest_session_hash<>token_hash));
-- Legacy J06 lease endpoints must not expose bound J07 leases.
CREATE OR REPLACE FUNCTION j06_private.read_lease(p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $
DECLARE result jsonb;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('quote',q.document,'expiresAt',l.expires_at) INTO result
 FROM j06_private.leases l JOIN j06_private.quotes q ON q.fingerprint=l.fingerprint
 WHERE l.token_hash=p_hash AND l.guest_session_hash IS NULL AND l.expires_at>clock_timestamp();
 RETURN result;
END $;
CREATE FUNCTION j06_private.issue_guest_lease(p_hash text,p_fingerprint text,p_session text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $
DECLARE issued timestamptz:=clock_timestamp();
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 OR p_hash=p_session OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 THEN RAISE EXCEPTION 'invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO j06_private.leases(token_hash,fingerprint,issued_at,expires_at,guest_session_hash)
 VALUES(p_hash,p_fingerprint,issued,issued+interval '15 minutes',p_session);
 RETURN issued+interval '15 minutes';
END $;
CREATE FUNCTION j06_private.read_guest_lease(p_hash text,p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $
DECLARE result jsonb;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('quote',q.document,'expiresAt',l.expires_at) INTO result
 FROM j06_private.leases l JOIN j06_private.quotes q ON q.fingerprint=l.fingerprint
 WHERE l.token_hash=p_hash AND l.guest_session_hash=p_session AND l.expires_at>clock_timestamp();
 RETURN result;
END $;
CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 AND guest_session_hash<>token_hash));
-- Legacy J06 lease endpoints must not expose bound J07 leases.
CREATE OR REPLACE FUNCTION j06_private.read_lease(p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $
DECLARE result jsonb;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('quote',q.document,'expiresAt',l.expires_at) INTO result
 FROM j06_private.leases l JOIN j06_private.quotes q ON q.fingerprint=l.fingerprint
 WHERE l.token_hash=p_hash AND l.guest_session_hash IS NULL AND l.expires_at>clock_timestamp();
 RETURN result;
END $;
CREATE FUNCTION j06_private.issue_guest_lease(p_hash text,p_fingerprint text,p_session text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $
DECLARE issued timestamptz:=clock_timestamp();
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 OR p_hash=p_session OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
 THEN RAISE EXCEPTION 'invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO j06_private.leases(token_hash,fingerprint,issued_at,expires_at,guest_session_hash)
 VALUES(p_hash,p_fingerprint,issued,issued+interval '15 minutes',p_session);
 RETURN issued+interval '15 minutes';
END $;
CREATE FUNCTION j06_private.read_guest_lease(p_hash text,p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $
DECLARE result jsonb;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('quote',q.document,'expiresAt',l.expires_at) INTO result
 FROM j06_private.leases l JOIN j06_private.quotes q ON q.fingerprint=l.fingerprint
 WHERE l.token_hash=p_hash AND l.guest_session_hash=p_session AND l.expires_at>clock_timestamp();
 RETURN result;
END $;
CREATE TABLE j06_private.guest_admissions (
 token_hash text PRIMARY KEY REFERENCES j06_private.leases(token_hash),
 receipt_id uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 recorded_at timestamptz NOT NULL
);
CREATE FUNCTION j06_private.record_guest_admission(p_hash text,p_fingerprint text,p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE q jsonb; admitted_at timestamptz;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL THEN RETURN false; END IF;
 SELECT document INTO q FROM j06_private.quotes WHERE fingerprint=p_fingerprint;
 IF q IS NULL OR NOT j06_private.persist_quote(q) THEN RETURN false; END IF;
 admitted_at:=clock_timestamp();
 INSERT INTO j06_private.guest_admissions(token_hash,receipt_id,fingerprint,recorded_at)
 SELECT l.token_hash,p_receipt,l.fingerprint,admitted_at
 FROM j06_private.leases l
 WHERE l.token_hash=p_hash AND l.fingerprint=p_fingerprint AND l.expires_at>admitted_at
 ON CONFLICT (token_hash) DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.guest_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,text,uuid) TO j06_runtime;
COMMIT;
