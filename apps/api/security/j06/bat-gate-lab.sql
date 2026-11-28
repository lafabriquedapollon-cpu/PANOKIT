-- J08 D1B.3a: LAB projections and explicitly simulated eligibility, never authorization.
BEGIN;
DO $$ BEGIN IF current_database()<>'panokit_j03_industrial_lab' THEN RAISE EXCEPTION 'LAB only' USING ERRCODE='42501'; END IF; END $$;
SET ROLE j08_owner;
-- Force a new case tuple for security-relevant events. A stale serializable
-- transaction trying to lock the changed case must fail rather than use its old snapshot.
ALTER TABLE j08_private.cases ADD COLUMN security_revision bigint NOT NULL DEFAULT 0 CHECK(security_revision>=0);
CREATE TABLE j08_private.commercial_fixture_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id uuid NOT NULL,version bigint NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 event text NOT NULL CHECK(event IN ('verified_fixture','withdrawn_fixture')),
 actor name NOT NULL,recorded_at timestamptz NOT NULL,
 FOREIGN KEY(case_id,version) REFERENCES j08_private.versions(case_id,version),
 UNIQUE(case_id,version,event)
);
CREATE FUNCTION j08_private.bump_security_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,j08_private AS $$
DECLARE c uuid;
BEGIN
 IF TG_TABLE_NAME='link_events' THEN SELECT case_id INTO STRICT c FROM j08_private.links WHERE token_hash=NEW.token_hash;
 ELSE c:=NEW.case_id; END IF;
 UPDATE j08_private.cases SET security_revision=security_revision+1 WHERE case_id=c;
 IF NOT FOUND THEN RAISE EXCEPTION 'case missing'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER link_revision AFTER INSERT ON j08_private.link_events FOR EACH ROW EXECUTE FUNCTION j08_private.bump_security_revision();
CREATE TRIGGER otp_revision AFTER INSERT ON j08_private.otp_events FOR EACH ROW EXECUTE FUNCTION j08_private.bump_security_revision();
CREATE TRIGGER decision_revision AFTER INSERT ON j08_private.bat_decisions FOR EACH ROW EXECUTE FUNCTION j08_private.bump_security_revision();
CREATE TRIGGER expiration_revision AFTER INSERT ON j08_private.bat_expirations FOR EACH ROW EXECUTE FUNCTION j08_private.bump_security_revision();
CREATE TRIGGER commercial_revision AFTER INSERT ON j08_private.commercial_fixture_events FOR EACH ROW EXECUTE FUNCTION j08_private.bump_security_revision();
-- Status-only, even for terminal/replaced BAT. No bytes, personal data, digest,
-- challenge, receipt or commercial detail. Unknown/revoked/expired access is generic.
CREATE FUNCTION j08_private.read_status(p_case uuid,p_version bigint,p_session text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE c j08_private.cases%ROWTYPE;l j08_private.links%ROWTYPE;t timestamptz;s text;d text; a integer;
BEGIN
 PERFORM j08_private.guard('j08_client');
 IF p_case IS NULL OR p_version IS NULL OR p_version<1 OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$'
 OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RETURN NULL;END IF;
 SELECT * INTO c FROM j08_private.cases WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND OR NOT j08_private.matches_source_session(c.receipt_id,p_session) THEN RETURN NULL;END IF;
 SELECT * INTO l FROM j08_private.links WHERE token_hash=p_hash AND case_id=p_case AND version=p_version AND session_hash=p_session FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 t:=clock_timestamp();
 IF l.revoked_at IS NOT NULL OR t<l.issued_at OR t>=l.expires_at THEN RETURN NULL;END IF;
 IF c.head<>p_version OR c.technical IN ('correction','infeasible') THEN s:='replaced';
 ELSIF EXISTS(SELECT 1 FROM j08_private.bat_expirations WHERE case_id=p_case AND version=p_version) THEN s:='expired';
 ELSE
 SELECT decision INTO d FROM j08_private.bat_decisions WHERE case_id=p_case AND version=p_version;
 IF FOUND THEN s:=d;
 ELSIF c.technical<>'feasible' OR c.technical_version IS DISTINCT FROM p_version THEN s:='waiting';
 ELSE
 SELECT attempts INTO a FROM j08_private.otp_series WHERE case_id=p_case AND version=p_version;
 s:=CASE WHEN COALESCE(a,0)>=5 THEN 'locked' ELSE 'review' END;
 END IF; END IF;
 END IF;
 RETURN jsonb_build_object('scope','LAB','manufacturable',false,'version',p_version,'status',s);
END $$;
-- Independent commercial fixture role can record only a synthetic assertion
-- on the exact already-approved version. No amount, PSP, invoice or order.
CREATE FUNCTION j08_private.record_commercial_fixture(p_case uuid,p_version bigint,p_digest text,p_event text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE c j08_private.cases%ROWTYPE;
BEGIN
 PERFORM j08_private.guard('j08_commercial_fixture');
 IF p_case IS NULL OR p_version IS NULL OR p_version<1 OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
 OR p_event IS NULL OR p_event NOT IN ('verified_fixture','withdrawn_fixture') THEN RETURN false;END IF;
 SELECT * INTO c FROM j08_private.cases WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND OR c.head<>p_version OR NOT EXISTS(SELECT 1 FROM j08_private.versions WHERE case_id=p_case AND version=p_version AND digest=p_digest) THEN RETURN false;END IF;
 IF p_event='verified_fixture' THEN
  IF c.technical<>'feasible' OR c.technical_version IS DISTINCT FROM p_version OR c.technical_digest IS DISTINCT FROM p_digest
  OR NOT EXISTS(SELECT 1 FROM j08_private.bat_decisions WHERE case_id=p_case AND version=p_version AND digest=p_digest AND decision='approved')
  OR EXISTS(SELECT 1 FROM j08_private.bat_expirations WHERE case_id=p_case AND version=p_version)
  OR EXISTS(SELECT 1 FROM j08_private.commercial_fixture_events WHERE case_id=p_case AND version=p_version AND event='withdrawn_fixture') THEN RETURN false;END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM j08_private.commercial_fixture_events WHERE case_id=p_case AND version=p_version AND digest=p_digest AND event='verified_fixture') THEN RETURN false;END IF;
 END IF;
 INSERT INTO j08_private.commercial_fixture_events(case_id,version,digest,event,actor,recorded_at)
 VALUES(p_case,p_version,p_digest,p_event,session_user,clock_timestamp()) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
-- Independent gate reader: test-only projection, no positive manufacturing grant.
-- Missing commercial fixture, expired BAT or changed technical binding = false.
CREATE FUNCTION j08_private.read_fixture_eligibility(p_case uuid,p_version bigint,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE c j08_private.cases%ROWTYPE;ok boolean:=false;
BEGIN
 PERFORM j08_private.guard('j08_gate_reader');
 IF p_case IS NOT NULL AND p_version IS NOT NULL AND p_version>0 AND p_digest IS NOT NULL AND p_digest ~ '^[a-f0-9]{64}$' THEN
 SELECT * INTO c FROM j08_private.cases WHERE case_id=p_case FOR UPDATE;
 IF FOUND AND c.head=p_version AND c.technical='feasible' AND c.technical_version=p_version AND c.technical_digest=p_digest THEN
  ok:=EXISTS(SELECT 1 FROM j08_private.versions WHERE case_id=p_case AND version=p_version AND digest=p_digest AND encode(sha256(bat_bytes),'hex')=p_digest)
  AND EXISTS(SELECT 1 FROM j08_private.bat_decisions WHERE case_id=p_case AND version=p_version AND digest=p_digest AND decision='approved' AND challenge_id IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM j08_private.bat_expirations WHERE case_id=p_case AND version=p_version)
  AND EXISTS(SELECT 1 FROM j08_private.commercial_fixture_events WHERE case_id=p_case AND version=p_version AND digest=p_digest AND event='verified_fixture')
  AND NOT EXISTS(SELECT 1 FROM j08_private.commercial_fixture_events WHERE case_id=p_case AND version=p_version AND event='withdrawn_fixture');
 END IF;END IF;
 RETURN jsonb_build_object('scope','LAB','fixtureEligible',COALESCE(ok,false),'manufacturable',false);
END $$;
RESET ROLE;
REVOKE ALL ON j08_private.commercial_fixture_events FROM PUBLIC;
GRANT USAGE ON SCHEMA j08_private TO j08_commercial_fixture,j08_gate_reader;
GRANT EXECUTE ON FUNCTION j08_private.read_status(uuid,bigint,text,text) TO j08_client;
GRANT EXECUTE ON FUNCTION j08_private.record_commercial_fixture(uuid,bigint,text,text) TO j08_commercial_fixture;
GRANT EXECUTE ON FUNCTION j08_private.read_fixture_eligibility(uuid,bigint,text) TO j08_gate_reader;
COMMIT;
