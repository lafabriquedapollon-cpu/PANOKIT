-- Disposable PG17 LAB only. No production retention policy.
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'panokit_sec01_sovereign_lab' OR session_user<>'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regprocedure('sec01_admin.recovery_open(uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION 'disposable lab only'; END IF;
END $guard$;
SET LOCAL ROLE sec01_admin_owner;
CREATE TABLE sec01_admin.expiry_worker_runs(
 run_id uuid PRIMARY KEY, finished_at timestamptz NOT NULL, expired integer NOT NULL CHECK(expired>=0),
 purged_attempts integer NOT NULL CHECK(purged_attempts>=0), purged_proofs integer NOT NULL CHECK(purged_proofs>=0),
 complete boolean NOT NULL);
ALTER TABLE sec01_admin.expiry_worker_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sec01_admin.expiry_worker_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON sec01_admin.expiry_worker_runs TO sec01_admin_owner USING(true) WITH CHECK(true);
CREATE INDEX lab_attempt_retention ON sec01_admin.totp_attempts(attempted_at,proof_digest);
CREATE INDEX lab_proof_retention ON sec01_admin.mfa_proofs(expires_at,proof_digest);
CREATE FUNCTION sec01_admin.sweep_expiry_batch(p_run uuid,p_limit integer)
RETURNS TABLE(expired integer,purged_attempts integer,purged_proofs integer,complete boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE d record; prior sec01_admin.expiry_worker_runs%ROWTYPE; checked timestamptz; n integer:=0; na integer:=0; np integer:=0; done boolean;
BEGIN
 IF session_user<>'sec01_admin_sweeper' OR p_run IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 -- Single transaction: serialization, revocations, audit, purge, heartbeat and idempotence record.
 PERFORM 1 FROM sec01_admin.expiry_scheduler_state WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM sec01_admin.expiry_worker_runs WHERE run_id=p_run;
 IF FOUND THEN RETURN QUERY SELECT prior.expired,prior.purged_attempts,prior.purged_proofs,prior.complete; RETURN; END IF;
 -- Acquire replay-generation lock before any account lock, matching reservation ordering.
 LOCK TABLE sec01_admin.replay_key_state IN SHARE MODE;
 FOR d IN SELECT * FROM sec01_admin.list_due_expiry(p_limit) LOOP
   IF sec01_admin.expire_due_session(d.session_id) THEN n:=n+1; END IF;
 END LOOP;
 -- Fixed conservative LAB retention, no caller-controlled cutoff. Preserve bindings, sessions, ledger and audit.
 -- Lock replay generation against rotation and avoid deleting an active proof. Retain a 24h margin over 120s replay window.
 checked:=clock_timestamp();
 WITH old AS (SELECT t.proof_digest FROM sec01_admin.totp_attempts t JOIN sec01_admin.mfa_proofs p USING(proof_digest)
 WHERE t.attempted_at<=checked-interval '24 hours' AND p.expires_at<=checked-interval '24 hours'
 ORDER BY t.attempted_at,t.proof_digest LIMIT p_limit FOR UPDATE OF t SKIP LOCKED)
 DELETE FROM sec01_admin.totp_attempts t USING old WHERE t.proof_digest=old.proof_digest;
 GET DIAGNOSTICS na=ROW_COUNT;
 WITH old AS (SELECT p.proof_digest FROM sec01_admin.mfa_proofs p WHERE p.expires_at<=checked-interval '24 hours'
 AND NOT EXISTS(SELECT 1 FROM sec01_admin.totp_attempts t WHERE t.proof_digest=p.proof_digest)
 AND NOT EXISTS(SELECT 1 FROM sec01_admin.provider_proof_binding b WHERE b.proof_digest=p.proof_digest)
 ORDER BY p.expires_at,p.proof_digest LIMIT p_limit FOR UPDATE OF p SKIP LOCKED)
 DELETE FROM sec01_admin.mfa_proofs p USING old WHERE p.proof_digest=old.proof_digest;
 GET DIAGNOSTICS np=ROW_COUNT;
 checked:=clock_timestamp();
 done:=NOT EXISTS(SELECT 1 FROM sec01_admin.sessions s WHERE s.revoked_at IS NULL AND s.expires_at<=checked);
 UPDATE sec01_admin.expiry_scheduler_state SET last_complete=CASE WHEN done THEN checked ELSE NULL END WHERE singleton;
 INSERT INTO sec01_admin.expiry_worker_runs VALUES(p_run,checked,n,na,np,done);
 RETURN QUERY SELECT n,na,np,done;
END $f$;
REVOKE ALL ON sec01_admin.expiry_worker_runs FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.sweep_expiry_batch(uuid,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sec01_admin.list_due_expiry(integer),sec01_admin.expire_due_session(uuid),sec01_admin.finish_expiry_sweep() FROM sec01_admin_sweeper;
GRANT EXECUTE ON FUNCTION sec01_admin.sweep_expiry_batch(uuid,integer) TO sec01_admin_sweeper;
RESET ROLE;
COMMIT;
