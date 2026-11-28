-- J08 D1B.2a: disposable private BAT access; no OTP or manufacturing authority.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'panokit_j03_industrial_lab' THEN RAISE EXCEPTION 'LAB only' USING ERRCODE='42501'; END IF;
END $$;
SET ROLE j08_owner;
CREATE TABLE j08_private.links(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 case_id uuid NOT NULL,
 version bigint NOT NULL,
 session_hash text NOT NULL CHECK(session_hash ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 FOREIGN KEY(case_id,version) REFERENCES j08_private.versions(case_id,version),
 CHECK(token_hash<>session_hash),
 CHECK(expires_at=issued_at+interval '168 hours'),
 CHECK(revoked_at IS NULL OR revoked_at>=issued_at)
);
CREATE UNIQUE INDEX j08_one_current_link ON j08_private.links(case_id,version) WHERE revoked_at IS NULL;
CREATE TABLE j08_private.link_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 token_hash text NOT NULL REFERENCES j08_private.links(token_hash),
 event text NOT NULL CHECK(event IN ('issued','revoked')),
 actor name NOT NULL,
 recorded_at timestamptz NOT NULL
);
-- Authorization uses the original J07 session binding, not the browser's chosen identity.
-- The original quote lease need not remain current: this is historical visual review only.
CREATE FUNCTION j08_private.matches_source_session(p_receipt uuid,p_session text)
RETURNS boolean LANGUAGE sql SET search_path=pg_catalog,j08_private AS $$
 SELECT EXISTS(SELECT 1 FROM j06_private.guest_admissions a
 JOIN j06_private.leases l ON l.token_hash=a.token_hash AND l.fingerprint=a.fingerprint
 WHERE a.receipt_id=p_receipt AND l.guest_session_hash=p_session)
$$;
-- Lock order is case then link. Token generation and delivery are adapter duties.
-- Return only success; a newly generated random token may be delivered after confirmed commit.
CREATE FUNCTION j08_private.rotate_link(p_case uuid,p_version bigint,p_digest text,p_session text,p_hash text)
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
-- Internal lock/validation helper. No execution grant to callers.
CREATE FUNCTION j08_private.lock_valid_link(p_case uuid,p_version bigint,p_session text,p_hash text)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,j08_private AS $$
DECLARE c j08_private.cases%ROWTYPE; l j08_private.links%ROWTYPE; t timestamptz;
BEGIN
 IF p_case IS NULL OR p_version IS NULL OR p_version<1 OR p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$'
 OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 SELECT * INTO c FROM j08_private.cases WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND OR c.head<>p_version OR c.technical<>'feasible' OR c.technical_version IS DISTINCT FROM p_version
 OR c.technical_digest IS DISTINCT FROM (SELECT digest FROM j08_private.versions WHERE case_id=p_case AND version=p_version)
 OR NOT j08_private.matches_source_session(c.receipt_id,p_session) THEN RETURN false; END IF;
 SELECT * INTO l FROM j08_private.links WHERE token_hash=p_hash AND case_id=p_case AND version=p_version
 AND session_hash=p_session FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 t:=clock_timestamp();
 RETURN l.revoked_at IS NULL AND t>=l.issued_at AND t<l.expires_at;
END $$;
CREATE FUNCTION j08_private.read_bat(p_case uuid,p_version bigint,p_session text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE result jsonb;
BEGIN
 PERFORM j08_private.guard('j08_client');
 IF NOT j08_private.lock_valid_link(p_case,p_version,p_session,p_hash) THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('scope','LAB','manufacturable',false,'version',version,'digest',digest,
 'bytesBase64',encode(bat_bytes,'base64')) INTO result FROM j08_private.versions WHERE case_id=p_case AND version=p_version;
 RETURN result;
END $$;
CREATE FUNCTION j08_private.revoke_link(p_case uuid,p_version bigint,p_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,j08_private AS $$
DECLARE t timestamptz;
BEGIN
 PERFORM j08_private.guard('j08_issuer');
 PERFORM 1 FROM j08_private.cases WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 t:=clock_timestamp();
 UPDATE j08_private.links SET revoked_at=t WHERE token_hash=p_hash AND case_id=p_case AND version=p_version AND revoked_at IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO j08_private.link_events(token_hash,event,actor,recorded_at) VALUES(p_hash,'revoked',session_user,t);
 RETURN true;
END $$;
RESET ROLE;
REVOKE ALL ON j08_private.links,j08_private.link_events FROM PUBLIC;
REVOKE ALL ON FUNCTION j08_private.matches_source_session(uuid,text),j08_private.lock_valid_link(uuid,bigint,text,text),
j08_private.rotate_link(uuid,bigint,text,text,text),j08_private.read_bat(uuid,bigint,text,text),j08_private.revoke_link(uuid,bigint,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA j08_private TO j08_client;
GRANT EXECUTE ON FUNCTION j08_private.rotate_link(uuid,bigint,text,text,text),j08_private.revoke_link(uuid,bigint,text) TO j08_issuer;
GRANT EXECUTE ON FUNCTION j08_private.read_bat(uuid,bigint,text,text) TO j08_client;
COMMIT;
