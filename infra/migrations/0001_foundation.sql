-- Foundation: identity, world clock, double-entry ledger, jobs, audit.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------- World ----------
CREATE TABLE world_config (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  epoch        timestamptz NOT NULL,
  time_scale   int NOT NULL DEFAULT 30 CHECK (time_scale = 30),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per processed 30-game-minute tick. The PK makes tick processing idempotent.
CREATE TABLE world_ticks (
  tick         bigint PRIMARY KEY,           -- game_minute / 30
  game_minute  bigint NOT NULL,
  jobs_enqueued int NOT NULL DEFAULT 0,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Identity ----------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      citext NOT NULL UNIQUE,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
  lock_reason   text,
  stage         int NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 5),
  bio           text NOT NULL DEFAULT '',
  avatar_hue    int NOT NULL DEFAULT 200,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  ip          text,
  user_agent  text
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  target_type text,
  target_id   text,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created ON audit_log(created_at DESC);

-- ---------- Double-entry ledger ----------
-- balance is stored debit-positive. Asset/expense accounts are normally >= 0,
-- liability/equity/revenue accounts are normally <= 0.
-- no_overdraft = true makes the DATABASE refuse any posting that would push a
-- cash account below zero, so concurrent double-spending is impossible.
CREATE TABLE accounts (
  id           bigserial PRIMARY KEY,
  owner_type   text NOT NULL CHECK (owner_type IN ('system', 'user', 'company')),
  owner_id     text NOT NULL,
  code         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  no_overdraft boolean NOT NULL DEFAULT false,
  balance      bigint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id, code),
  CONSTRAINT accounts_no_overdraft CHECK (NOT no_overdraft OR balance >= 0)
);

CREATE TABLE journal_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  kind            text NOT NULL,
  memo            text NOT NULL,
  game_minute     bigint NOT NULL,
  actor_id        uuid REFERENCES users(id),
  ref_type        text,
  ref_id          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_entries_ref ON journal_entries(ref_type, ref_id);
CREATE INDEX journal_entries_game ON journal_entries(game_minute);

CREATE TABLE postings (
  id         bigserial PRIMARY KEY,
  entry_id   uuid NOT NULL REFERENCES journal_entries(id),
  account_id bigint NOT NULL REFERENCES accounts(id),
  amount     bigint NOT NULL CHECK (amount <> 0)
);
CREATE INDEX postings_account ON postings(account_id, id);
CREATE INDEX postings_entry ON postings(entry_id);

-- Every journal entry must balance to zero at commit time.
CREATE FUNCTION check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO s FROM postings WHERE entry_id = NEW.entry_id;
  IF s <> 0 THEN
    RAISE EXCEPTION 'unbalanced journal entry % (sum %)', NEW.entry_id, s USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER postings_balanced AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- Ledger rows are append-only.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger rows are append-only'; END $$;
CREATE TRIGGER postings_append_only BEFORE UPDATE OR DELETE ON postings FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER entries_append_only BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------- Jobs ----------
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  dedupe_key  text NOT NULL UNIQUE,
  payload     jsonb NOT NULL DEFAULT '{}',
  game_minute bigint NOT NULL,
  run_after   timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  locked_by   text,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX jobs_pending ON jobs(run_after, id) WHERE status = 'pending';

CREATE TABLE worker_heartbeats (
  worker_id  text PRIMARY KEY,
  role       text NOT NULL,
  last_beat  timestamptz NOT NULL DEFAULT now(),
  info       jsonb NOT NULL DEFAULT '{}'
);

-- ---------- Notifications ----------
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  data       jsonb NOT NULL DEFAULT '{}',
  dedupe_key text UNIQUE,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
