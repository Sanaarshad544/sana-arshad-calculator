// Versioned database schema. Each migration runs once, in order, when the
// server starts. Never edit a released migration: add a new one instead.

export interface Migration {
  version: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: '001_initial',
    sql: `
CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'device' CHECK (theme IN ('device', 'light', 'dark')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account_idx ON sessions(account_id);

CREATE TABLE solo_bills (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bill_date DATE NOT NULL,
  currency TEXT NOT NULL,
  tax_mode TEXT NOT NULL CHECK (tax_mode IN ('percent', 'amount')),
  tax_value BIGINT NOT NULL,
  other_mode TEXT NOT NULL CHECK (other_mode IN ('percent', 'amount')),
  other_value BIGINT NOT NULL,
  tip_mode TEXT NOT NULL CHECK (tip_mode IN ('percent', 'amount')),
  tip_value BIGINT NOT NULL,
  tip_on TEXT NOT NULL CHECK (tip_on IN ('food', 'food_tax')),
  food_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  other_cents BIGINT NOT NULL,
  tip_cents BIGINT NOT NULL,
  total_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX solo_bills_account_idx ON solo_bills(account_id, created_at DESC);

CREATE TABLE solo_bill_items (
  id BIGSERIAL PRIMARY KEY,
  bill_id BIGINT NOT NULL REFERENCES solo_bills(id) ON DELETE CASCADE,
  position INT NOT NULL,
  name TEXT NOT NULL,
  price_cents BIGINT NOT NULL
);
CREATE INDEX solo_bill_items_bill_idx ON solo_bill_items(bill_id);

CREATE TABLE groups (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, name_key),
  UNIQUE (group_id, account_id)
);
CREATE INDEX members_account_idx ON members(account_id);

CREATE TABLE group_bills (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bill_date DATE NOT NULL,
  split_mode TEXT NOT NULL CHECK (split_mode IN ('equal', 'itemized')),
  payer_member_id BIGINT NOT NULL REFERENCES members(id),
  tax_mode TEXT NOT NULL CHECK (tax_mode IN ('percent', 'amount')),
  tax_value BIGINT NOT NULL,
  other_mode TEXT NOT NULL CHECK (other_mode IN ('percent', 'amount')),
  other_value BIGINT NOT NULL,
  tip_mode TEXT NOT NULL CHECK (tip_mode IN ('percent', 'amount')),
  tip_value BIGINT NOT NULL,
  tip_on TEXT NOT NULL CHECK (tip_on IN ('food', 'food_tax')),
  food_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  other_cents BIGINT NOT NULL,
  tip_cents BIGINT NOT NULL,
  total_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX group_bills_group_idx ON group_bills(group_id, created_at DESC);

CREATE TABLE group_bill_items (
  id BIGSERIAL PRIMARY KEY,
  bill_id BIGINT NOT NULL REFERENCES group_bills(id) ON DELETE CASCADE,
  position INT NOT NULL,
  name TEXT NOT NULL,
  price_cents BIGINT NOT NULL,
  sharer_ids BIGINT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX group_bill_items_bill_idx ON group_bill_items(bill_id);

CREATE TABLE group_bill_shares (
  bill_id BIGINT NOT NULL REFERENCES group_bills(id) ON DELETE CASCADE,
  member_id BIGINT NOT NULL REFERENCES members(id),
  position INT NOT NULL,
  food_cents BIGINT,
  tax_cents BIGINT,
  other_cents BIGINT,
  tip_cents BIGINT,
  total_cents BIGINT NOT NULL,
  extra_cents INT NOT NULL,
  PRIMARY KEY (bill_id, member_id)
);
CREATE INDEX group_bill_shares_member_idx ON group_bill_shares(member_id);

CREATE TABLE settle_ups (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_member_id BIGINT NOT NULL REFERENCES members(id),
  to_member_id BIGINT NOT NULL REFERENCES members(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_member_id <> to_member_id)
);
CREATE INDEX settle_ups_group_idx ON settle_ups(group_id, created_at DESC);

CREATE TABLE activity (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX activity_group_idx ON activity(group_id, id DESC);
`,
  },
  {
    // Bills aren't always for food, so the item total is called "items".
    version: '002_rename_food_to_items',
    sql: `
ALTER TABLE solo_bills RENAME COLUMN food_cents TO items_cents;
ALTER TABLE group_bills RENAME COLUMN food_cents TO items_cents;
ALTER TABLE group_bill_shares RENAME COLUMN food_cents TO items_cents;

ALTER TABLE solo_bills DROP CONSTRAINT solo_bills_tip_on_check;
UPDATE solo_bills SET tip_on = CASE tip_on WHEN 'food_tax' THEN 'items_tax' ELSE 'items' END;
ALTER TABLE solo_bills ALTER COLUMN tip_on TYPE TEXT,
  ADD CONSTRAINT solo_bills_tip_on_check CHECK (tip_on IN ('items', 'items_tax'));

ALTER TABLE group_bills DROP CONSTRAINT group_bills_tip_on_check;
UPDATE group_bills SET tip_on = CASE tip_on WHEN 'food_tax' THEN 'items_tax' ELSE 'items' END;
ALTER TABLE group_bills ALTER COLUMN tip_on TYPE TEXT,
  ADD CONSTRAINT group_bills_tip_on_check CHECK (tip_on IN ('items', 'items_tax'));
`,
  },
  {
    // Balances look bills and payments up by member, so those lookups need indexes.
    version: '003_balance_indexes',
    sql: `
CREATE INDEX group_bills_payer_idx ON group_bills(payer_member_id);
CREATE INDEX settle_ups_from_idx ON settle_ups(from_member_id);
CREATE INDEX settle_ups_to_idx ON settle_ups(to_member_id);
`,
  },
  {
    // Wrong password and recovery-code tries per username, for the growing wait.
    version: '004_attempt_limits',
    sql: `
CREATE TABLE attempt_limits (
  username_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'reset')),
  failures INT NOT NULL DEFAULT 0,
  next_allowed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (username_key, kind)
);
CREATE INDEX attempt_limits_updated_idx ON attempt_limits(updated_at);
`,
  },
];
