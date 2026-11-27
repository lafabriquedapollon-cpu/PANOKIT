-- J07-D1B disposable LAB only, after quote-validity-lab.sql. No customer data or order.
BEGIN;
SET ROLE j06_owner;
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
REVOKE ALL ON FUNCTION j06_private.record_guest_admission(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION j06_private.record_guest_admission(text,text,uuid) TO j06_runtime;
COMMIT;
