-- J08 D1B.2b: disposable PG17 OTP and consent. No legal identity or manufacturing authority.
BEGIN;
DO $$ BEGIN IF current_database()<>'panokit_j03_industrial_lab' THEN RAISE EXCEPTION 'LAB only' USING ERRCODE='42501'; END IF; END $$;
SET ROLE j08_owner;
CREATE TABLE j08_private.otp_secret(
 singleton boolean PRIMARY KEY CHECK(singleton),
 key_bytes bytea NOT NULL CHECK(octet_length(key_bytes)=32)
);
INSERT INTO j08_private.otp_secret VALUES(true,sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')));
CREATE TABLE j08_private.otp_series(
 case_id uuid NOT NULL, version bigint NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 issued_count integer NOT NULL DEFAULT 0 CHECK(issued_count BETWEEN 0 AND 5),
 current_id uuid, last_issued_at timestamptz,
 PRIMARY KEY(case_id,version),
 FOREIGN KEY(case_id,version) REFERENCES j08_private.versions(case_id,version),
 CHECK((issued_count=0 AND current_id IS NULL AND last_issued_at IS NULL) OR (issued_count>0 AND current_id IS NOT NULL AND last_issued_at IS NOT NULL))
);
CREATE TABLE j08_private.otp_challenges(
 challenge_id uuid PRIMARY KEY,
 case_id uuid NOT NULL,version bigint NOT NULL,
 link_hash text NOT NULL REFERENCES j08_private.links(token_hash),
 session_hash text NOT NULL CHECK(session_hash ~ '^[a-f0-9]{64}$'),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 mac bytea NOT NULL CHECK(octet_length(mac)=32),
 issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 FOREIGN KEY(case_id,version) REFERENCES j08_private.otp_series(case_id,version),
 CHECK(expires_at=issued_at+interval '5 minutes')
);
CREATE TABLE j08_private.bat_decisions(
 case_id uuid NOT NULL,version bigint NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision IN ('approved','refused')),
 session_hash text NOT NULL CHECK(session_hash ~ '^[a-f0-9]{64}$'),
 link_hash text NOT NULL REFERENCES j08_private.links(token_hash),
 challenge_id uuid UNIQUE REFERENCES j08_private.otp_challenges(challenge_id),
 statement_version text NOT NULL CHECK(statement_version='lab-bat-v1'),
 locale text NOT NULL CHECK(locale IN ('fr','ar')),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(case_id,version),FOREIGN KEY(case_id,version) REFERENCES j08_private.versions(case_id,version),
 CHECK((decision='approved')=(challenge_id IS NOT NULL))
);
CREATE TABLE j08_private.bat_expirations(
 case_id uuid NOT NULL,version bigint NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 actor name NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(case_id,version),FOREIGN KEY(case_id,version) REFERENCES j08_private.versions(case_id,version)
);
CREATE TABLE j08_private.otp_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id uuid NOT NULL,version bigint NOT NULL,
 challenge_id uuid NOT NULL REFERENCES j08_private.otp_challenges(challenge_id),
 event text NOT NULL CHECK(event IN ('issued','wrong','locked','approved')),
 actor name NOT NULL,recorded_at timestamptz NOT NULL,
 FOREIGN KEY(case_id,version) REFERENCES j08_private.otp_series(case_id,version)
);
CREATE FUNCTION j08_private.pending(p_case uuid,p_version bigint)
RETURNS boolean LANGUAGE sql SET search_path=pg_catalog,j08_private AS $$
 SELECT NOT EXISTS(SELECT 1 FROM j08_private.bat_decisions WHERE case_id=p_case AND version=p_version)
 AND NOT EXISTS(SELECT 1 FROM j08_private.bat_expirations WHERE case_id=p_case AND version=p_version)
$$;
-- Standard HMAC-SHA256 using core SHA256 (no extension); private 32-byte LAB key.
CREATE FUNCTION j08_private.otp_mac(p_id uuid,p_case uuid,p_version bigint,p_digest text,p_link text,p_session text,p_code text)
RETURNS bytea LANGUAGE plpgsql SET search_path=pg_catalog,j08_private AS $$
DECLARE k bytea; ip bytea:=decode(repeat('36',64),'hex'); op bytea:=decode(repeat('5c',64),'hex'); i integer; msg bytea;
BEGIN
 SELECT key_bytes INTO STRICT k FROM j08_private.otp_secret WHERE singleton;
 FOR i IN 0..31 LOOP ip:=set_byte(ip,i,get_byte(ip,i)#get_byte(k,i));op:=set_byte(op,i,get_byte(op,i)#get_byte(k,i));END LOOP;
 msg:=convert_to(concat_ws('|','panokit-lab-otp-v1',p_id::text,p_case::text,p_version::text,p_digest,p_link,p_session,p_code),'UTF8');
 RETURN sha256(op||sha256(ip||msg));
END $$;
-- Both operands fixed 32 bytes, no early exit. Timing guarantees require independent review.
CREATE FUNCTION j08_private.equal_mac(a bytea,b bytea) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,j08_private AS $$
DECLARE diff integer:=0; i integer;
BEGIN
 IF a IS NULL OR b IS NULL OR octet_length(a)<>32 OR octet_length(b)<>32 THEN RETURN false;END IF;
 FOR i IN 0..31 LOOP diff:=diff|(get_byte(a,i)#get_byte(b,i));END LOOP;
 RETURN diff=0;
END $$;
CREATE OR REPLACE FUNCTION j08_private.rotate_link(p_case uuid,p_version bigint,p_digest text,p_session text,p_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE c j08_private.cases%ROWTYPE; old_hash text; t timestamptz;
BEGIN
 PERFORM j08_private.guard('j08_issuer');
 IF p_case IS NULL OR p_version IS NULL OR p_version<1 OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
 OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$' OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
 OR p_hash=p_session THEN RETURN false; END IF;
 SELECT * INTO c FROM j08_private.cases WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND OR c.head<>p_version OR c.technical<>'feasible' OR c.technical_version IS DISTINCT FROM p_version
 OR c.technical_digest IS DISTINCT FROM p_digest OR NOT j08_private.matches_source_session(c.receipt_id,p_session)
 OR NOT j08_private.pending(p_case,p_version)
 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM j08_private.links WHERE token_hash=p_hash) THEN RETURN false; END IF;
 -- Bound issuance to 10 links per version in this LAB. No renewal extends the previous token.
 IF (SELECT count(*) FROM j08_private.links WHERE case_id=p_case AND version=p_version)>=10 THEN RETURN false; END IF;
 t:=clock_timestamp();
 FOR old_hash IN UPDATE j08_private.links SET revoked_at=t
 WHERE case_id=p_case AND version=p_version AND revoked_at IS NULL RETURNING token_hash LOOP
 INSERT INTO j08_private.link_events(token_hash,event,actor,recorded_at) VALUES(old_hash,'revoked',session_user,t);
 END LOOP;
 INSERT INTO j08_private.links(token_hash,case_id,version,session_hash,issued_at,expires_at)
 VALUES(p_hash,p_case,p_version,p_session,t,t+interval '168 hours');
 INSERT INTO j08_private.link_events(token_hash,event,actor,recorded_at) VALUES(p_hash,'issued',session_user,t);
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION j08_private.lock_valid_link(p_case uuid,p_version bigint,p_session text,p_hash text)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,j08_private AS $$
DECLARE c j08_private.cases%ROWTYPE; l j08_private.links%ROWTYPE; t timestamptz;
BEGIN
 IF p_case IS NULL OR p_version IS NULL OR p_version<1 OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$'
 OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 SELECT * INTO c FROM j08_private.cases WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND OR c.head<>p_version OR c.technical<>'feasible' OR c.technical_version IS DISTINCT FROM p_version
 OR c.technical_digest IS DISTINCT FROM (SELECT digest FROM j08_private.versions WHERE case_id=p_case AND version=p_version)
 OR NOT j08_private.matches_source_session(c.receipt_id,p_session) OR NOT j08_private.pending(p_case,p_version) THEN RETURN false; END IF;
 SELECT * INTO l FROM j08_private.links WHERE token_hash=p_hash AND case_id=p_case AND version=p_version
 AND session_hash=p_session FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 t:=clock_timestamp();
 RETURN l.revoked_at IS NULL AND t>=l.issued_at AND t<l.expires_at;
END $$;
CREATE OR REPLACE FUNCTION j08_private.decide(p_case uuid,p_expected bigint,p_digest text,p_decision text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE c j08_private.cases%ROWTYPE; d text;
BEGIN
 IF session_user NOT IN ('j08_workshop_a','j08_workshop_b') THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM j08_private.guard(session_user);
 IF p_expected IS NULL OR p_digest IS NULL OR p_decision IS NULL OR p_decision NOT IN ('feasible','correction','infeasible') THEN RETURN false; END IF;
 SELECT * INTO c FROM j08_private.cases WHERE case_id=p_case AND workshop=session_user FOR UPDATE;
 IF NOT FOUND OR c.head<>p_expected OR NOT (c.technical='review' OR (c.technical='feasible' AND p_decision IN ('correction','infeasible'))) THEN RETURN false; END IF;
 IF c.head=0 THEN d:=c.source_digest;
 ELSE SELECT digest INTO d FROM j08_private.versions WHERE case_id=p_case AND version=c.head; END IF;
 IF d IS NULL OR d<>p_digest THEN RETURN false; END IF;
 UPDATE j08_private.cases SET technical=p_decision,
 technical_version=CASE WHEN p_decision='feasible' THEN c.head ELSE NULL END,
 technical_digest=CASE WHEN p_decision='feasible' THEN d ELSE NULL END WHERE case_id=p_case;
 INSERT INTO j08_private.events(case_id,version,digest,event,actor) VALUES(p_case,c.head,d,p_decision,session_user);
 RETURN true;
END $$;
-- Trusted fake delivery role supplies CSPRNG six-digit code, never client JSON.
-- Deliver only after confirmed COMMIT. No plaintext persisted or returned by SQL.
CREATE FUNCTION j08_private.issue_otp(p_case uuid,p_version bigint,p_session text,p_hash text,p_digest text,p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE s j08_private.otp_series%ROWTYPE; t timestamptz; q uuid;
BEGIN
 PERFORM j08_private.guard('j08_otp_sender');
 IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 IF NOT j08_private.lock_valid_link(p_case,p_version,p_session,p_hash) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM j08_private.versions WHERE case_id=p_case AND version=p_version AND digest=p_digest) THEN RETURN NULL; END IF;
 INSERT INTO j08_private.otp_series(case_id,version) VALUES(p_case,p_version) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT s FROM j08_private.otp_series WHERE case_id=p_case AND version=p_version FOR UPDATE;
 t:=clock_timestamp();
 IF s.attempts>=5 OR s.issued_count>=5 OR (s.last_issued_at IS NOT NULL AND t<s.last_issued_at+interval '30 seconds') THEN RETURN NULL;END IF;
 IF NOT j08_private.lock_valid_link(p_case,p_version,p_session,p_hash) THEN RETURN NULL; END IF;
 q:=gen_random_uuid();t:=clock_timestamp();
 INSERT INTO j08_private.otp_challenges VALUES(q,p_case,p_version,p_hash,p_session,p_digest,j08_private.otp_mac(q,p_case,p_version,p_digest,p_hash,p_session,p_code),t,t+interval '5 minutes');
 UPDATE j08_private.otp_series SET issued_count=issued_count+1,current_id=q,last_issued_at=t WHERE case_id=p_case AND version=p_version;
 INSERT INTO j08_private.otp_events(case_id,version,challenge_id,event,actor,recorded_at) VALUES(p_case,p_version,q,'issued',session_user,t);
 RETURN q;
END $$;
CREATE FUNCTION j08_private.confirm_otp(p_case uuid,p_version bigint,p_session text,p_hash text,p_digest text,p_challenge uuid,p_code text,p_statement text,p_locale text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE s j08_private.otp_series%ROWTYPE;q j08_private.otp_challenges%ROWTYPE;t timestamptz;ok boolean;n integer;
BEGIN
 PERFORM j08_private.guard('j08_client');
 IF p_statement IS DISTINCT FROM 'lab-bat-v1' OR p_locale IS NULL OR p_locale NOT IN ('fr','ar') OR p_challenge IS NULL THEN RETURN 'denied';END IF;
 IF NOT j08_private.lock_valid_link(p_case,p_version,p_session,p_hash) THEN RETURN 'denied';END IF;
 SELECT * INTO s FROM j08_private.otp_series WHERE case_id=p_case AND version=p_version FOR UPDATE;
 IF NOT FOUND THEN RETURN 'denied'; END IF;
 IF s.attempts>=5 THEN RETURN 'locked'; END IF;
 IF s.current_id IS DISTINCT FROM p_challenge THEN RETURN 'denied'; END IF;
 SELECT * INTO q FROM j08_private.otp_challenges WHERE challenge_id=p_challenge AND case_id=p_case AND version=p_version
 AND link_hash=p_hash AND session_hash=p_session AND digest=p_digest;
 IF NOT FOUND THEN RETURN 'denied'; END IF;
 t:=clock_timestamp();
 IF t<q.issued_at OR t>=q.expires_at THEN RETURN 'denied'; END IF;
 ok:=j08_private.equal_mac(q.mac,j08_private.otp_mac(p_challenge,p_case,p_version,p_digest,p_hash,p_session,
 CASE WHEN p_code ~ '^[0-9]{6}$' THEN p_code ELSE 'invalid' END)) AND COALESCE(p_code ~ '^[0-9]{6}$',false);
 IF NOT j08_private.lock_valid_link(p_case,p_version,p_session,p_hash) THEN RETURN 'denied'; END IF;
 t:=clock_timestamp();
 IF t<q.issued_at OR t>=q.expires_at THEN RETURN 'denied'; END IF;
 IF NOT ok THEN
  UPDATE j08_private.otp_series SET attempts=attempts+1 WHERE case_id=p_case AND version=p_version RETURNING attempts INTO n;
  INSERT INTO j08_private.otp_events(case_id,version,challenge_id,event,actor,recorded_at) VALUES(p_case,p_version,p_challenge,CASE WHEN n=5 THEN 'locked' ELSE 'wrong' END,session_user,t);
  RETURN CASE WHEN n=5 THEN 'locked' ELSE 'wrong' END;
 END IF;
 INSERT INTO j08_private.bat_decisions VALUES(p_case,p_version,p_digest,'approved',p_session,p_hash,p_challenge,p_statement,p_locale,t);
 INSERT INTO j08_private.otp_events(case_id,version,challenge_id,event,actor,recorded_at) VALUES(p_case,p_version,p_challenge,'approved',session_user,t);
 RETURN 'approved';
END $$;
CREATE FUNCTION j08_private.refuse_bat(p_case uuid,p_version bigint,p_session text,p_hash text,p_digest text,p_explicit boolean,p_locale text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
BEGIN
 PERFORM j08_private.guard('j08_client');
 IF p_explicit IS DISTINCT FROM true OR p_locale IS NULL OR p_locale NOT IN ('fr','ar') THEN RETURN false;END IF;
 IF NOT j08_private.lock_valid_link(p_case,p_version,p_session,p_hash) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM j08_private.versions WHERE case_id=p_case AND version=p_version AND digest=p_digest) THEN RETURN false;END IF;
 INSERT INTO j08_private.bat_decisions VALUES(p_case,p_version,p_digest,'refused',p_session,p_hash,NULL,'lab-bat-v1',p_locale,clock_timestamp());
 RETURN true;
END $$;
-- Business expiry is independent of access TTL; trusted issuer decision only.
CREATE FUNCTION j08_private.expire_bat(p_case uuid,p_version bigint,p_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE c j08_private.cases%ROWTYPE;
BEGIN
 PERFORM j08_private.guard('j08_issuer');
 SELECT * INTO c FROM j08_private.cases WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND OR c.head<>p_version OR NOT EXISTS(SELECT 1 FROM j08_private.versions WHERE case_id=p_case AND version=p_version AND digest=p_digest) THEN RETURN false;END IF;
 INSERT INTO j08_private.bat_expirations VALUES(p_case,p_version,p_digest,session_user,clock_timestamp()) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
RESET ROLE;
REVOKE ALL ON j08_private.otp_secret,j08_private.otp_series,j08_private.otp_challenges,j08_private.otp_events,j08_private.bat_decisions,j08_private.bat_expirations FROM PUBLIC;
GRANT USAGE ON SCHEMA j08_private TO j08_otp_sender;
GRANT EXECUTE ON FUNCTION j08_private.issue_otp(uuid,bigint,text,text,text,text) TO j08_otp_sender;
GRANT EXECUTE ON FUNCTION j08_private.confirm_otp(uuid,bigint,text,text,text,uuid,text,text,text),j08_private.refuse_bat(uuid,bigint,text,text,text,boolean,text) TO j08_client;
GRANT EXECUTE ON FUNCTION j08_private.expire_bat(uuid,bigint,text) TO j08_issuer;
COMMIT;
