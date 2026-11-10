-- Expansion: HR policies, long-term supply contracts, group structure & M&A,
-- bank deposits & collateral, delisting & market surveillance.

-- ---------- HR ----------
ALTER TABLE companies ADD COLUMN benefit_level int NOT NULL DEFAULT 0 CHECK (benefit_level BETWEEN 0 AND 3);
ALTER TABLE companies ADD COLUMN overtime_hours int NOT NULL DEFAULT 0 CHECK (overtime_hours BETWEEN 0 AND 3);
ALTER TABLE people ADD COLUMN leave_until_minute bigint;
ALTER TABLE people ADD COLUMN leave_year int NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN leave_days_used int NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN ot_hours_this_day numeric NOT NULL DEFAULT 0;

-- ---------- Group structure ----------
ALTER TABLE companies ADD COLUMN parent_company_id uuid REFERENCES companies(id);
ALTER TABLE companies ADD CONSTRAINT companies_not_own_parent CHECK (parent_company_id IS NULL OR parent_company_id <> id);
CREATE INDEX companies_parent ON companies(parent_company_id);

CREATE TABLE branches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  location_code text NOT NULL REFERENCES locations(code),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  opened_minute bigint NOT NULL,
  closed_minute bigint
);
CREATE UNIQUE INDEX branches_active ON branches(company_id, location_code) WHERE status = 'active';

CREATE TABLE acquisition_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acquirer_company_id uuid NOT NULL REFERENCES companies(id),
  target_company_id   uuid NOT NULL REFERENCES companies(id),
  price               bigint NOT NULL CHECK (price > 0),
  note                text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  created_minute      bigint NOT NULL,
  expires_minute      bigint NOT NULL,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (acquirer_company_id <> target_company_id)
);
CREATE UNIQUE INDEX acquisition_offers_pending ON acquisition_offers(acquirer_company_id, target_company_id) WHERE status = 'pending';

CREATE TABLE ownership_events (
  id          bigserial PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies(id),
  kind        text NOT NULL,
  from_owner  uuid,
  to_owner    uuid,
  parent_company_id uuid,
  detail      jsonb NOT NULL DEFAULT '{}',
  game_minute bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Long-term supply contracts ----------
CREATE TABLE supply_contracts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_company_id     uuid NOT NULL REFERENCES companies(id),
  seller_company_id    uuid NOT NULL REFERENCES companies(id),
  good_code            text NOT NULL REFERENCES goods(code),
  qty_per_delivery     bigint NOT NULL CHECK (qty_per_delivery > 0),
  unit_price           bigint NOT NULL CHECK (unit_price > 0),
  deliveries_total     int NOT NULL CHECK (deliveries_total BETWEEN 1 AND 60),
  deliveries_done      int NOT NULL DEFAULT 0,
  interval_days        int NOT NULL CHECK (interval_days BETWEEN 1 AND 14),
  deposit              bigint NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  penalty_rate         numeric NOT NULL CHECK (penalty_rate BETWEEN 0 AND 0.5),
  status               text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'completed', 'rejected', 'cancelled', 'breached')),
  seller_misses        int NOT NULL DEFAULT 0,
  buyer_misses         int NOT NULL DEFAULT 0,
  next_delivery_minute bigint,
  created_minute       bigint NOT NULL,
  ended_reason         text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_company_id <> seller_company_id)
);
CREATE INDEX supply_contracts_due ON supply_contracts(next_delivery_minute) WHERE status = 'active';

CREATE TABLE contract_deliveries (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id            uuid NOT NULL REFERENCES supply_contracts(id),
  seq                    int NOT NULL,
  shipment_id            uuid REFERENCES shipments(id),
  status                 text NOT NULL CHECK (status IN ('shipped', 'delivered', 'accepted', 'disputed', 'resolved', 'missed_seller', 'missed_buyer')),
  value                  bigint NOT NULL DEFAULT 0,
  penalty                bigint NOT NULL DEFAULT 0,
  accept_deadline_minute bigint,
  dispute_reason         text,
  resolution             text,
  refund                 bigint NOT NULL DEFAULT 0,
  created_minute         bigint NOT NULL,
  UNIQUE (contract_id, seq)
);

-- ---------- Bank deposits & collateral ----------
CREATE TABLE deposits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type      text NOT NULL CHECK (owner_type IN ('user', 'company')),
  owner_id        text NOT NULL,
  amount          bigint NOT NULL CHECK (amount > 0),
  rate_daily_bp   int NOT NULL,
  term_days       int NOT NULL CHECK (term_days IN (0, 7, 14, 28)),
  accrued         bigint NOT NULL DEFAULT 0,
  start_minute    bigint NOT NULL,
  maturity_minute bigint,
  last_accrual_day int,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'matured')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deposits_owner ON deposits(owner_type, owner_id);

ALTER TABLE equipment ADD COLUMN pledged_loan_id uuid REFERENCES loans(id);
ALTER TABLE loans ADD COLUMN collateral_value bigint NOT NULL DEFAULT 0;

-- ---------- Exchange ----------
ALTER TABLE instruments ADD COLUMN halted_minute bigint;
ALTER TABLE instruments ADD COLUMN delisted_at timestamptz;
ALTER TABLE instruments ADD COLUMN delist_reason text;

CREATE TABLE surveillance_alerts (
  id          bigserial PRIMARY KEY,
  symbol      text NOT NULL REFERENCES instruments(symbol),
  kind        text NOT NULL CHECK (kind IN ('price_spike', 'wash_trading', 'concentration')),
  severity    text NOT NULL CHECK (severity IN ('medium', 'high')),
  dedupe_key  text NOT NULL UNIQUE,
  detail      jsonb NOT NULL DEFAULT '{}',
  auto_halted boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution  text,
  resolved_by uuid REFERENCES users(id),
  game_minute bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
