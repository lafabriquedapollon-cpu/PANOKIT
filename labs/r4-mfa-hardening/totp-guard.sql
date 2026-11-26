-- LAB ONLY: install after exact R2 + lifecycle + native migrations. No LIVE use.
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'panokit_sec01_sovereign_lab' OR session_user<>'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regprocedure('sec01_admin.mark_bound_mfa(text,bytea,text)') IS NULL
 THEN RAISE EXCEPTION 'disposable lab only'; END IF;
END $guard$;
SET LOCAL ROLE sec01_admin_owner;
CREATE TABLE sec01_admin.totp_attempts (
 proof_digest bytea PRIMARY KEY REFERENCES sec01_admin.mfa_proofs(proof_digest),
 actor_id uuid NOT NULL REFERENCES sec01_admin.accounts(actor_id),
 code_tag bytea NOT NULL CHECK(octet_length(code_tag)=32),
 attempted_at timestamptz NOT NULL,
 admitted boolean NOT NULL,
 verified_at timestamptz
);
CREATE INDEX totp_attempt_actor_time ON sec01_admin.totp_attempts(actor_id,attempted_at);
CREATE INDEX totp_attempt_actor_tag_time ON sec01_admin.totp_attempts(actor_id,code_tag,attempted_at) WHERE admitted;
ALTER TABLE sec01_admin.totp_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sec01_admin.totp_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON sec01_admin.totp_attempts TO sec01_admin_owner USING(true) WITH CHECK(true);
-- All callers must commit reservation before invoking native MFA. Same stable secret across brokers.
-- Sliding window 5 attempts/120 seconds, including failed verification and admitted replay denials.
-- Reserve before verification; fail closed after a crash. No raw OTP or unkeyed digest.
CREATE FUNCTION sec01_admin.reserve_totp(p_subject text,p_proof bytea,p_tag bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE a sec01_admin.accounts%ROWTYPE; t timestamptz; allowed boolean;
BEGIN
 IF session_user<>'sec01_admin_mfa_verifier' OR p_proof IS NULL OR octet_length(p_proof)<>32
 OR p_tag IS NULL OR octet_length(p_tag)<>32 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM sec01_admin.accounts WHERE better_auth_subject=p_subject FOR UPDATE;
 IF NOT FOUND OR NOT a.active OR NOT a.can_edit THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 t:=clock_timestamp();
 IF NOT EXISTS(SELECT 1 FROM sec01_admin.mfa_proofs WHERE proof_digest=p_proof AND actor_id=a.actor_id
 AND mfa_epoch=a.mfa_epoch AND credential_epoch=a.credential_epoch AND expires_at>t
 AND verified_at IS NULL AND consumed_at IS NULL) THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM sec01_admin.totp_attempts WHERE proof_digest=p_proof) THEN RETURN false; END IF;
 -- Reject backwards clock relative to any previous reservation.
 IF EXISTS(SELECT 1 FROM sec01_admin.totp_attempts WHERE actor_id=a.actor_id AND attempted_at>t) THEN RETURN false; END IF;
 IF (SELECT count(*) FROM sec01_admin.totp_attempts WHERE actor_id=a.actor_id AND attempted_at>t-interval '120 seconds')>=5 THEN RETURN false; END IF;
 allowed:=NOT EXISTS(SELECT 1 FROM sec01_admin.totp_attempts WHERE actor_id=a.actor_id AND code_tag=p_tag AND admitted AND attempted_at>t-interval '120 seconds');
 INSERT INTO sec01_admin.totp_attempts(proof_digest,actor_id,code_tag,attempted_at,admitted) VALUES(p_proof,a.actor_id,p_tag,t,allowed);
 RETURN allowed;
END $f$;
-- Provider lock FIRST, as in lifecycle. Mark and reservation consumption share a transaction.
CREATE FUNCTION sec01_admin.mark_reserved_totp(p_subject text,p_proof bytea,p_provider text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE a sec01_admin.accounts%ROWTYPE;
BEGIN
 IF session_user<>'sec01_admin_mfa_verifier' THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM sec01_admin.lock_live_provider(p_provider,p_subject);
 SELECT * INTO a FROM sec01_admin.accounts WHERE better_auth_subject=p_subject FOR UPDATE;
 IF NOT FOUND OR NOT a.active OR NOT a.can_edit THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 UPDATE sec01_admin.totp_attempts SET verified_at=clock_timestamp()
 WHERE proof_digest=p_proof AND actor_id=a.actor_id AND admitted AND verified_at IS NULL
 AND attempted_at>clock_timestamp()-interval '120 seconds' AND attempted_at<=clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM sec01_admin.mark_bound_mfa(p_subject,p_proof,p_provider);
 RETURN true;
END $f$;
REVOKE ALL ON sec01_admin.totp_attempts FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.reserve_totp(text,bytea,bytea),sec01_admin.mark_reserved_totp(text,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.mark_bound_mfa(text,bytea,text) FROM sec01_admin_mfa_verifier;
GRANT EXECUTE ON FUNCTION sec01_admin.reserve_totp(text,bytea,bytea),sec01_admin.mark_reserved_totp(text,bytea,text) TO sec01_admin_mfa_verifier;
RESET ROLE;
COMMIT;
