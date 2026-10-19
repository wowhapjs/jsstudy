CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS api;

CREATE TABLE IF NOT EXISTS private.progress (
  token_hash bytea PRIMARY KEY,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE ROLE web_anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE authenticator NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT web_anon TO authenticator;
GRANT USAGE ON SCHEMA api TO web_anon;
REVOKE ALL ON SCHEMA private FROM PUBLIC, web_anon;
REVOKE ALL ON private.progress FROM PUBLIC, web_anon;

CREATE OR REPLACE FUNCTION api.sync_get(p_token text)
RETURNS TABLE(state jsonb, updated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $$
  SELECT p.state, p.updated_at
  FROM private.progress p
  WHERE p.token_hash = public.digest(p_token, 'sha256');
$$;

CREATE OR REPLACE FUNCTION api.sync_put(p_token text, p_state jsonb)
RETURNS TABLE(updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $$
DECLARE v_updated timestamptz;
BEGIN
  IF length(p_token) < 32 OR length(p_token) > 256 THEN
    RAISE EXCEPTION 'invalid sync token';
  END IF;
  IF pg_column_size(p_state) > 3145728 THEN
    RAISE EXCEPTION 'state too large';
  END IF;
  INSERT INTO private.progress(token_hash, state)
  VALUES (public.digest(p_token, 'sha256'), p_state)
  ON CONFLICT (token_hash) DO UPDATE
    SET state = EXCLUDED.state, updated_at = now()
  RETURNING private.progress.updated_at INTO v_updated;
  RETURN QUERY SELECT v_updated;
END;
$$;

REVOKE ALL ON FUNCTION api.sync_get(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api.sync_put(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.sync_get(text) TO web_anon;
GRANT EXECUTE ON FUNCTION api.sync_put(text,jsonb) TO web_anon;
