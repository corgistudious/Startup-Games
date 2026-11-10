-- Economy: catalogue, companies, workforce, production, logistics, market, bank.

CREATE TABLE goods (
  code              text PRIMARY KEY,
  name              text NOT NULL,
  unit              text NOT NULL,
  category          text NOT NULL CHECK (category IN ('raw', 'consumer')),
  ref_price         bigint NOT NULL CHECK (ref_price > 0),   -- households' reference price
  elasticity        numeric NOT NULL DEFAULT 1.6,
  demand_weight     numeric NOT NULL DEFAULT 0,             -- share of household budget (consumer goods)
  spoil_per_day     numeric NOT NULL DEFAULT 0 CHECK (spoil_per_day BETWEEN 0 AND 1)
);

CREATE TABLE industries (
  code           text PRIMARY KEY,
  name           text NOT NULL,
  description    text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('producer', 'manufacturer_retail')),
  tax_rate       numeric NOT NULL CHECK (tax_rate BETWEEN 0 AND 0.5),
  register_fee   bigint NOT NULL,
  min_capital    bigint NOT NULL,
  license_hours  int NOT NULL,
  open_hour      int NOT NULL,
  close_hour     int NOT NULL,
  days_mask      int NOT NULL DEFAULT 127,
  icon           text NOT NULL
);

CREATE TABLE equipment_types (
  code             text PRIMARY KEY,
  name             text NOT NULL,
  price            bigint NOT NULL,
  batches_per_hour numeric NOT NULL,      -- capacity of one unit while staffed
  maintenance_day  bigint NOT NULL,
  wear_per_day     numeric NOT NULL       -- condition points lost per game day
);

CREATE TABLE recipes (
  code          text PRIMARY KEY,
  industry_code text NOT NULL REFERENCES industries(code),
  name          text NOT NULL,
  output_good   text NOT NULL REFERENCES goods(code),
  output_qty    int NOT NULL CHECK (output_qty > 0),
  labor_hours   numeric NOT NULL CHECK (labor_hours > 0),
  equipment     text NOT NULL REFERENCES equipment_types(code),
  inputs        jsonb NOT NULL DEFAULT '[]'   -- [{good, qty}]
);

CREATE TABLE locations (
  code         text PRIMARY KEY,
  name         text NOT NULL,
  region       text NOT NULL,
  rent_day     bigint NOT NULL,
  traffic      numeric NOT NULL,     -- relative foot traffic multiplier
  logistics_km int NOT NULL          -- distance to the central logistics hub
);

CREATE TABLE companies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    uuid REFERENCES users(id),
  is_npc           boolean NOT NULL DEFAULT false,
  name             citext NOT NULL UNIQUE,
  slug             text NOT NULL UNIQUE,
  industry_code    text NOT NULL REFERENCES industries(code),
  location_code    text NOT NULL REFERENCES locations(code),
  status           text NOT NULL DEFAULT 'licensing' CHECK (status IN ('licensing', 'active', 'insolvent', 'bankrupt', 'closed')),
  license_ready_at bigint NOT NULL,                 -- game minute
  founded_minute   bigint NOT NULL,
  founded_at       timestamptz NOT NULL DEFAULT now(),
  reputation       numeric NOT NULL DEFAULT 50 CHECK (reputation BETWEEN 0 AND 100),
  brand            numeric NOT NULL DEFAULT 0 CHECK (brand >= 0),
  description      text NOT NULL DEFAULT '',
  logo_hue         int NOT NULL DEFAULT 200,
  verified         boolean NOT NULL DEFAULT false,
  shares_total     bigint NOT NULL DEFAULT 0,
  npc_profile      jsonb NOT NULL DEFAULT '{}',
  insolvent_days   int NOT NULL DEFAULT 0,
  CHECK (is_npc OR owner_user_id IS NOT NULL)
);
CREATE INDEX companies_owner ON companies(owner_user_id);

CREATE TABLE inventory (
  company_id uuid NOT NULL REFERENCES companies(id),
  good_code  text NOT NULL REFERENCES goods(code),
  qty        bigint NOT NULL DEFAULT 0 CHECK (qty >= 0),
  reserved   bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  value      bigint NOT NULL DEFAULT 0 CHECK (value >= 0),   -- total cost basis, matches ledger 'inventory'
  PRIMARY KEY (company_id, good_code),
  CHECK (reserved <= qty)
);

-- What a company offers. Consumer listings sell to households; b2b listings to other companies.
CREATE TABLE listings (
  company_id uuid NOT NULL REFERENCES companies(id),
  good_code  text NOT NULL REFERENCES goods(code),
  price      bigint NOT NULL CHECK (price > 0),
  active     boolean NOT NULL DEFAULT true,
  b2b        boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, good_code, b2b)
);

CREATE TABLE equipment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  type_code   text NOT NULL REFERENCES equipment_types(code),
  condition   numeric NOT NULL DEFAULT 100 CHECK (condition BETWEEN 0 AND 100),
  book_value  bigint NOT NULL,
  bought_minute bigint NOT NULL
);
CREATE INDEX equipment_company ON equipment(company_id);

-- Persistent NPC people: job seekers and employees of every company.
CREATE TABLE people (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        text NOT NULL,
  age              int NOT NULL,
  skill            int NOT NULL CHECK (skill BETWEEN 1 AND 100),
  wage_expectation bigint NOT NULL,      -- per worked day
  status           text NOT NULL DEFAULT 'seeking' CHECK (status IN ('seeking', 'employed', 'retired')),
  company_id       uuid REFERENCES companies(id),
  wage             bigint,
  shift            text CHECK (shift IN ('day', 'night', 'part', 'rotating')),
  department       text,
  title            text,
  morale           int NOT NULL DEFAULT 70 CHECK (morale BETWEEN 0 AND 100),
  hours_this_day   numeric NOT NULL DEFAULT 0,   -- hours worked since last payroll
  unpaid_days      int NOT NULL DEFAULT 0,
  hired_minute     bigint,
  experience       numeric NOT NULL DEFAULT 0,
  CHECK ((status = 'employed') = (company_id IS NOT NULL))
);
CREATE INDEX people_company ON people(company_id);
CREATE INDEX people_seeking ON people(status) WHERE status = 'seeking';

CREATE TABLE production_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  recipe_code      text NOT NULL REFERENCES recipes(code),
  batches          int NOT NULL CHECK (batches > 0),
  batches_done     int NOT NULL DEFAULT 0,
  labor_required   numeric NOT NULL,
  labor_done       numeric NOT NULL DEFAULT 0,
  input_cost       bigint NOT NULL DEFAULT 0,   -- cost basis moved out of input inventory
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'cancelled')),
  created_minute   bigint NOT NULL,
  completed_minute bigint
);
CREATE INDEX production_running ON production_orders(company_id) WHERE status = 'running';

CREATE TABLE shipments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_company_id uuid NOT NULL REFERENCES companies(id),
  seller_company_id uuid NOT NULL REFERENCES companies(id),
  good_code        text NOT NULL REFERENCES goods(code),
  qty              bigint NOT NULL CHECK (qty > 0),
  unit_price       bigint NOT NULL,
  goods_total      bigint NOT NULL,
  freight          bigint NOT NULL,
  cost_basis       bigint NOT NULL,             -- seller's inventory value shipped
  status           text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'delivered')),
  ordered_minute   bigint NOT NULL,
  quoted_eta_minute bigint NOT NULL,
  eta_minute       bigint NOT NULL,
  delivered_minute bigint,
  CHECK (buyer_company_id <> seller_company_id)
);
CREATE INDEX shipments_due ON shipments(eta_minute) WHERE status = 'in_transit';

CREATE TABLE campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  channel      text NOT NULL,
  budget       bigint NOT NULL,
  start_minute bigint NOT NULL,   -- effect starts after a channel-specific delay
  end_minute   bigint NOT NULL,
  strength     numeric NOT NULL,  -- brand points gained per day while running
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Daily sales stats per company/good for the dashboard and market share.
CREATE TABLE sales_daily (
  company_id uuid NOT NULL REFERENCES companies(id),
  day        int NOT NULL,
  good_code  text NOT NULL,
  qty        bigint NOT NULL DEFAULT 0,
  revenue    bigint NOT NULL DEFAULT 0,
  customers  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, day, good_code)
);

CREATE TABLE loans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_type   text NOT NULL CHECK (borrower_type IN ('user', 'company')),
  borrower_id     text NOT NULL,
  principal       bigint NOT NULL CHECK (principal > 0),
  outstanding     bigint NOT NULL CHECK (outstanding >= 0),
  interest_due    bigint NOT NULL DEFAULT 0,
  rate_daily_bp   int NOT NULL,                -- basis points per game day
  term_days       int NOT NULL,
  installment     bigint NOT NULL,             -- principal due each 7 days
  start_minute    bigint NOT NULL,
  next_due_minute bigint NOT NULL,
  missed          int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'overdue', 'repaid', 'defaulted')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loans_borrower ON loans(borrower_type, borrower_id);

CREATE TABLE monthly_reports (
  id          bigserial PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies(id),
  month       int NOT NULL,
  revenue     bigint NOT NULL,
  cogs        bigint NOT NULL,
  wages       bigint NOT NULL,
  marketing   bigint NOT NULL,
  operating   bigint NOT NULL,      -- rent, maintenance, freight, fees, depreciation
  interest    bigint NOT NULL,
  profit_before_tax bigint NOT NULL,
  tax         bigint NOT NULL,
  net_profit  bigint NOT NULL,
  cash_end    bigint NOT NULL,
  inventory_end bigint NOT NULL,
  debt_end    bigint NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, month)
);

CREATE TABLE tax_bills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  month       int NOT NULL,
  amount      bigint NOT NULL CHECK (amount >= 0),
  paid        bigint NOT NULL DEFAULT 0,
  due_minute  bigint NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'overdue')),
  UNIQUE (company_id, month)
);
