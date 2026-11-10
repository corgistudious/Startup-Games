-- Stock exchange, community, reviewer system, support.

CREATE TABLE instruments (
  symbol        text PRIMARY KEY,
  company_id    uuid NOT NULL UNIQUE REFERENCES companies(id),
  status        text NOT NULL DEFAULT 'listed' CHECK (status IN ('listed', 'halted', 'delisted')),
  ipo_price     bigint NOT NULL,
  last_price    bigint,
  halt_reason   text,
  listed_minute bigint NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE holdings (
  symbol      text NOT NULL REFERENCES instruments(symbol),
  holder_type text NOT NULL CHECK (holder_type IN ('user', 'company')),
  holder_id   text NOT NULL,
  qty         bigint NOT NULL DEFAULT 0 CHECK (qty >= 0),
  locked      bigint NOT NULL DEFAULT 0 CHECK (locked >= 0),
  cost        bigint NOT NULL DEFAULT 0 CHECK (cost >= 0),   -- total cost basis
  PRIMARY KEY (symbol, holder_type, holder_id),
  CHECK (locked <= qty)
);

CREATE TABLE orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq         bigserial NOT NULL UNIQUE,          -- time priority
  symbol      text NOT NULL REFERENCES instruments(symbol),
  owner_type  text NOT NULL CHECK (owner_type IN ('user', 'company')),
  owner_id    text NOT NULL,
  side        text NOT NULL CHECK (side IN ('buy', 'sell')),
  type        text NOT NULL CHECK (type IN ('limit', 'market')),
  price       bigint CHECK (price > 0),
  qty         bigint NOT NULL CHECK (qty > 0),
  filled      bigint NOT NULL DEFAULT 0 CHECK (filled >= 0),
  locked_cash bigint NOT NULL DEFAULT 0 CHECK (locked_cash >= 0),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  is_ipo      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (filled <= qty),
  CHECK (type = 'market' OR price IS NOT NULL)
);
CREATE INDEX orders_book ON orders(symbol, side, price, seq) WHERE status = 'open';
CREATE INDEX orders_owner ON orders(owner_type, owner_id, created_at DESC);

CREATE TABLE trades (
  id            bigserial PRIMARY KEY,
  symbol        text NOT NULL REFERENCES instruments(symbol),
  buy_order_id  uuid NOT NULL REFERENCES orders(id),
  sell_order_id uuid NOT NULL REFERENCES orders(id),
  price         bigint NOT NULL,
  qty           bigint NOT NULL,
  game_minute   bigint NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trades_symbol ON trades(symbol, id DESC);

CREATE TABLE dividends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol      text NOT NULL REFERENCES instruments(symbol),
  per_share   bigint NOT NULL,
  total       bigint NOT NULL,
  game_minute bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE disclosures (
  id          bigserial PRIMARY KEY,
  symbol      text NOT NULL REFERENCES instruments(symbol),
  title       text NOT NULL,
  body        text NOT NULL,
  game_minute bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Community ----------
CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        text NOT NULL,
  by_reviewer boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  hidden_reason text,
  owner_reply text,
  replied_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, author_id)
);
CREATE INDEX reviews_company ON reviews(company_id, created_at DESC);

CREATE TABLE review_reports (
  id          bigserial PRIMARY KEY,
  review_id   uuid NOT NULL REFERENCES reviews(id),
  reporter_id uuid NOT NULL REFERENCES users(id),
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, reporter_id)
);

CREATE TABLE reviewers (
  user_id              uuid PRIMARY KEY REFERENCES users(id),
  status               text NOT NULL CHECK (status IN ('invited', 'accepted', 'active', 'declined', 'revoked')),
  reputation           int NOT NULL DEFAULT 0 CHECK (reputation >= 0),
  eval_points          int NOT NULL DEFAULT 0 CHECK (eval_points >= 0),
  invited_by           uuid REFERENCES users(id),
  invite_note          text,
  invited_at           timestamptz NOT NULL DEFAULT now(),
  activated_at         timestamptz,
  last_valid_review_at timestamptz,
  revoked_at           timestamptz,
  revoke_reason        text
);

-- (user, period_key) unique => a 7-day inactivity period can never be penalised twice.
CREATE TABLE reviewer_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  kind       text NOT NULL CHECK (kind IN ('reputation', 'points', 'status')),
  delta      int NOT NULL DEFAULT 0,
  reason     text NOT NULL,
  period_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_key)
);

CREATE TABLE recommendations (
  company_id  uuid NOT NULL REFERENCES companies(id),
  reviewer_id uuid NOT NULL REFERENCES users(id),
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  PRIMARY KEY (company_id, reviewer_id)
);

CREATE TABLE company_titles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  title       text NOT NULL CHECK (title IN ('tuyen_chon', 'yeu_thich')),
  granted_by  uuid REFERENCES users(id),    -- null = automatic selection
  reason      text NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  revoke_reason text,
  cycle_key   text
);
CREATE UNIQUE INDEX company_titles_active ON company_titles(company_id, title) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX company_titles_cycle ON company_titles(company_id, cycle_key) WHERE cycle_key IS NOT NULL;

CREATE TABLE favorite_cycles (
  cycle_key   text PRIMARY KEY,
  eligible    int NOT NULL,
  selected    jsonb NOT NULL,
  params      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE follows (
  user_id    uuid NOT NULL REFERENCES users(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

-- ---------- Support ----------
CREATE TABLE tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  subject    text NOT NULL,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ticket_messages (
  id         bigserial PRIMARY KEY,
  ticket_id  uuid NOT NULL REFERENCES tickets(id),
  author_id  uuid NOT NULL REFERENCES users(id),
  is_staff   boolean NOT NULL DEFAULT false,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
