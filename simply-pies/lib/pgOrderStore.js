'use strict';

const { ACTIVE_STATUSES, FINISHED_VISIBLE_MS, allowedFrom, newSecrets } = require('./orderStore');

const SCHEMA = `
create sequence if not exists simply_pies_order_number start 101;

create table if not exists simply_pies_orders (
  id uuid primary key,
  token text not null,
  number integer not null unique default nextval('simply_pies_order_number'),
  status text not null check (status in ('pending_payment','paid','preparing','ready','completed','cancelled','expired')),
  items jsonb not null,
  total_pies integer not null,
  total_cents integer not null,
  currency text not null,
  customer jsonb not null,
  stripe_session_id text,
  payment_intent_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  arrived_at timestamptz,
  arrival_note text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists simply_pies_orders_kitchen_idx
  on simply_pies_orders (status, updated_at);

create table if not exists simply_pies_login_attempts (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
`;

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    number: row.number,
    status: row.status,
    items: row.items,
    totalPies: row.total_pies,
    totalCents: row.total_cents,
    currency: row.currency,
    customer: row.customer,
    stripeSessionId: row.stripe_session_id,
    paymentIntentId: row.payment_intent_id,
    createdAt: iso(row.created_at),
    paidAt: iso(row.paid_at),
    arrivedAt: iso(row.arrived_at),
    arrivalNote: row.arrival_note,
    updatedAt: iso(row.updated_at),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres-backed order store (Neon, Supabase or any Postgres). Status
// changes are single conditional UPDATEs, so two devices acting on the
// same order at once cannot both succeed.
class PgOrderStore {
  constructor(pool) {
    this.pool = pool;
    this.ready = null;
  }

  ensureSchema() {
    if (!this.ready) {
      this.ready = this.pool.query(SCHEMA).catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  async query(sql, params) {
    await this.ensureSchema();
    return this.pool.query(sql, params);
  }

  async create({ items, totalPies, totalCents, currency, customer }) {
    const { id, token } = newSecrets();
    const { rows } = await this.query(
      `insert into simply_pies_orders (id, token, status, items, total_pies, total_cents, currency, customer)
       values ($1, $2, 'pending_payment', $3, $4, $5, $6, $7) returning *`,
      [id, token, JSON.stringify(items), totalPies, totalCents, currency, JSON.stringify(customer)],
    );
    return fromRow(rows[0]);
  }

  async get(id) {
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    const { rows } = await this.query('select * from simply_pies_orders where id = $1', [id]);
    return fromRow(rows[0]);
  }

  async setStripeSession(id, sessionId) {
    const { rows } = await this.query(
      'update simply_pies_orders set stripe_session_id = $2, updated_at = now() where id = $1 returning *',
      [id, sessionId],
    );
    return fromRow(rows[0]);
  }

  async setStatus(id, next, extra = {}) {
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    const { rows } = await this.query(
      `update simply_pies_orders
          set status = $2,
              updated_at = now(),
              paid_at = case when $2 = 'paid' then now() else paid_at end,
              stripe_session_id = coalesce($4, stripe_session_id),
              payment_intent_id = coalesce($5, payment_intent_id)
        where id = $1 and status = any($3::text[])
        returning *`,
      [id, next, allowedFrom(next), extra.stripeSessionId || null, extra.paymentIntentId || null],
    );
    return fromRow(rows[0]);
  }

  async markArrived(id, note) {
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    const { rows } = await this.query(
      `update simply_pies_orders
          set arrived_at = coalesce(arrived_at, now()),
              arrival_note = case when arrived_at is null then $2 else arrival_note end,
              updated_at = case when arrived_at is null then now() else updated_at end
        where id = $1 and status = any($3::text[])
        returning *`,
      [id, note || '', ACTIVE_STATUSES],
    );
    return fromRow(rows[0]);
  }

  async kitchenOrders() {
    const { rows } = await this.query(
      `select * from simply_pies_orders
        where status = any($1::text[])
           or (status in ('completed', 'cancelled') and updated_at >= now() - ($2::bigint * interval '1 millisecond'))
        order by number`,
      [ACTIVE_STATUSES, FINISHED_VISIBLE_MS],
    );
    return rows.map(fromRow);
  }

  async recordLoginAttempt(key, windowMs) {
    const { rows } = await this.query(
      `insert into simply_pies_login_attempts (key, window_start, count)
       values ($1, now(), 1)
       on conflict (key) do update set
         count = case when simply_pies_login_attempts.window_start < now() - ($2::bigint * interval '1 millisecond')
                      then 1 else simply_pies_login_attempts.count + 1 end,
         window_start = case when simply_pies_login_attempts.window_start < now() - ($2::bigint * interval '1 millisecond')
                      then now() else simply_pies_login_attempts.window_start end
       returning count`,
      [key, windowMs],
    );
    return rows[0].count;
  }
}

module.exports = { PgOrderStore, SCHEMA };
