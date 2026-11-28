-- J08 D1B.1: disposable PG17 provenance and technical versioning only.
-- No customer identity, OTP, commercial proof or manufacturing permission.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'panokit_j03_industrial_lab' THEN RAISE EXCEPTION 'LAB only' USING ERRCODE='42501'; END IF;
END $$;
CREATE ROLE j08_owner NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA j08_private AUTHORIZATION j08_owner;
REVOKE ALL ON SCHEMA j08_private FROM PUBLIC;
GRANT USAGE ON SCHEMA j06_private TO j08_owner;
GRANT SELECT ON j06_private.guest_admissions,j06_private.leases,j06_private.guest_visual_consents,j06_private.guest_visual_archive TO j08_owner;
SET ROLE j08_owner;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE j08_private.cases(
 case_id uuid PRIMARY KEY,
 receipt_id uuid NOT NULL UNIQUE,
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 source_bytes bytea NOT NULL CHECK(octet_length(source_bytes) BETWEEN 1 AND 2000000),
 workshop name NOT NULL CHECK(workshop IN ('j08_workshop_a','j08_workshop_b')),
 head bigint NOT NULL DEFAULT 0 CHECK(head BETWEEN 0 AND 9007199254740991),
 technical text NOT NULL DEFAULT 'review' CHECK(technical IN ('review','feasible','correction','infeasible')),
 technical_version bigint,
 technical_digest text,
 opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(source_digest=encode(sha256(source_bytes),'hex')),
 CHECK((technical='feasible' AND technical_version=head AND technical_digest IS NOT NULL) OR
       (technical<>'feasible' AND technical_version IS NULL AND technical_digest IS NULL))
);
CREATE TABLE j08_private.versions(
 case_id uuid NOT NULL REFERENCES j08_private.cases(case_id),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 bat_bytes bytea NOT NULL CHECK(octet_length(bat_bytes) BETWEEN 1 AND 2000000),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor name NOT NULL,
 PRIMARY KEY(case_id,version), CHECK(digest=encode(sha256(bat_bytes),'hex'))
);
CREATE TABLE j08_private.events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id uuid NOT NULL REFERENCES j08_private.cases(case_id),
 version bigint NOT NULL CHECK(version>=0),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 event text NOT NULL CHECK(event IN ('opened','feasible','correction','infeasible','issued','superseded')),
 actor name NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION j08_private.guard(p_role name) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,j08_private AS $$
BEGIN
 IF session_user<>p_role OR current_database()<>'panokit_j03_industrial_lab'
 OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
END $$;
-- Trusted intake supplies hash of established J07 session, not a browser claim.
-- Historical visual evidence only, never a current quote or identity proof.
CREATE FUNCTION j08_private.open_case(p_case uuid,p_receipt uuid,p_session text,p_workshop name)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE d text; b bytea;
BEGIN
 PERFORM j08_private.guard('j08_intake');
 IF p_case IS NULL OR p_receipt IS NULL OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$'
 OR p_workshop IS NULL OR p_workshop NOT IN ('j08_workshop_a','j08_workshop_b') THEN RETURN false; END IF;
 SELECT v.visual_digest,a.svg_bytes INTO d,b
 FROM j06_private.guest_admissions g
 JOIN j06_private.leases l ON l.token_hash=g.token_hash AND l.fingerprint=g.fingerprint
 JOIN j06_private.guest_visual_consents v ON v.receipt_id=g.receipt_id AND v.fingerprint=g.fingerprint
 JOIN j06_private.guest_visual_archive a ON a.receipt_id=v.receipt_id AND a.visual_digest=v.visual_digest
 WHERE g.receipt_id=p_receipt AND l.guest_session_hash=p_session AND l.expires_at>clock_timestamp()
 AND v.visual_version='lab-config-v1' AND v.statement_version='lab-visual-v1'
 AND encode(sha256(a.svg_bytes),'hex')=v.visual_digest;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO j08_private.cases(case_id,receipt_id,source_digest,source_bytes,workshop)
 VALUES(p_case,p_receipt,d,b,p_workshop) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO j08_private.events(case_id,version,digest,event,actor) VALUES(p_case,0,d,'opened',session_user);
 RETURN true;
END $$;
CREATE FUNCTION j08_private.decide(p_case uuid,p_expected bigint,p_digest text,p_decision text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE c j08_private.cases%ROWTYPE; d text;
BEGIN
 IF session_user NOT IN ('j08_workshop_a','j08_workshop_b') THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM j08_private.guard(session_user);
 IF p_expected IS NULL OR p_digest IS NULL OR p_decision IS NULL OR p_decision NOT IN ('feasible','correction','infeasible') THEN RETURN false; END IF;
 SELECT * INTO c FROM j08_private.cases WHERE case_id=p_case AND workshop=session_user FOR UPDATE;
 IF NOT FOUND OR c.head<>p_expected OR c.technical<>'review' THEN RETURN false; END IF;
 IF c.head=0 THEN d:=c.source_digest;
 ELSE SELECT digest INTO d FROM j08_private.versions WHERE case_id=p_case AND version=c.head; END IF;
 IF d IS NULL OR d<>p_digest THEN RETURN false; END IF;
 UPDATE j08_private.cases SET technical=p_decision,
 technical_version=CASE WHEN p_decision='feasible' THEN c.head ELSE NULL END,
 technical_digest=CASE WHEN p_decision='feasible' THEN d ELSE NULL END WHERE case_id=p_case;
 INSERT INTO j08_private.events(case_id,version,digest,event,actor) VALUES(p_case,c.head,d,p_decision,session_user);
 RETURN true;
END $$;
-- Trusted issuer supplies vetted synthetic bytes. No renderer or public delivery here.
CREATE FUNCTION j08_private.issue(p_case uuid,p_expected bigint,p_bytes bytea)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE c j08_private.cases%ROWTYPE; d text; prior text; n bigint;
BEGIN
 PERFORM j08_private.guard('j08_issuer');
 IF p_expected IS NULL OR p_bytes IS NULL OR octet_length(p_bytes) NOT BETWEEN 1 AND 2000000 THEN RETURN NULL; END IF;
 SELECT * INTO c FROM j08_private.cases WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND OR c.head<>p_expected OR c.head>=9007199254740991 OR c.technical NOT IN ('feasible','correction') THEN RETURN NULL; END IF;
 IF c.head>0 THEN
  SELECT digest INTO prior FROM j08_private.versions WHERE case_id=p_case AND version=c.head;
  INSERT INTO j08_private.events(case_id,version,digest,event,actor) VALUES(p_case,c.head,prior,'superseded',session_user);
 END IF;
 n:=c.head+1; d:=encode(sha256(p_bytes),'hex');
 INSERT INTO j08_private.versions(case_id,version,digest,bat_bytes,actor) VALUES(p_case,n,d,p_bytes,session_user);
 UPDATE j08_private.cases SET head=n,technical='review',technical_version=NULL,technical_digest=NULL WHERE case_id=p_case;
 INSERT INTO j08_private.events(case_id,version,digest,event,actor) VALUES(p_case,n,d,'issued',session_user);
 RETURN n;
END $$;
RESET ROLE;
REVOKE ALL ON ALL TABLES IN SCHEMA j08_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA j08_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA j08_private FROM PUBLIC;
GRANT USAGE ON SCHEMA j08_private TO j08_intake,j08_issuer,j08_workshop_a,j08_workshop_b;
GRANT EXECUTE ON FUNCTION j08_private.open_case(uuid,uuid,text,name) TO j08_intake;
GRANT EXECUTE ON FUNCTION j08_private.issue(uuid,bigint,bytea) TO j08_issuer;
GRANT EXECUTE ON FUNCTION j08_private.decide(uuid,bigint,text,text) TO j08_workshop_a,j08_workshop_b;
COMMIT;
