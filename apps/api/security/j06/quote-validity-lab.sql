-- Disposable LAB only, applied after quote-lab.sql. Never a LIVE migration.
BEGIN;
SET ROLE j06_owner;
CREATE TABLE j06_private.leases (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 fingerprint text NOT NULL REFERENCES j06_private.quotes(fingerprint),
 issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 CHECK(expires_at=issued_at+interval '15 minutes')
);
CREATE FUNCTION j06_private.issue_lease(p_hash text,p_fingerprint text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE issued timestamptz:=clock_timestamp();
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO j06_private.leases(token_hash,fingerprint,issued_at,expires_at) VALUES(p_hash,p_fingerprint,issued,issued+interval '15 minutes');
 RETURN issued+interval '15 minutes';
END $$;
CREATE FUNCTION j06_private.read_lease(p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j06_private AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'j06_runtime' OR current_database()<>'panokit_j03_industrial_lab' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('quote',q.document,'expiresAt',l.expires_at) INTO result
 FROM j06_private.leases l JOIN j06_private.quotes q ON q.fingerprint=l.fingerprint
 WHERE l.token_hash=p_hash AND l.expires_at>clock_timestamp();
 RETURN result;
END $$;
RESET ROLE;
REVOKE ALL ON j06_private.leases FROM PUBLIC;
REVOKE ALL ON FUNCTION j06_private.issue_lease(text,text),j06_private.read_lease(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.issue_lease(text,text),j06_private.read_lease(text) TO j06_runtime;
COMMIT;
