// Единый слой БД: Postgres (если задан DATABASE_URL) или встроенный SQLite.
// SQL пишется с плейсхолдерами `?` — для Postgres они переводятся в $1, $2, ...
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id {ID},
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass TEXT NOT NULL,
  family_id INTEGER,
  tg_user_id TEXT UNIQUE,
  tg_username TEXT,
  tg_notify INTEGER NOT NULL DEFAULT 1,
  token_ver INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS families (
  id {ID},
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT '₸',
  monthly_budget BIGINT NOT NULL DEFAULT 0,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id {ID},
  family_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'card',
  emoji TEXT,
  initial BIGINT NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id {ID},
  family_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT,
  color TEXT,
  kind TEXT NOT NULL DEFAULT 'expense',
  limit_amount BIGINT NOT NULL DEFAULT 0,
  keywords TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS goals (
  id {ID},
  family_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  emoji TEXT,
  target BIGINT NOT NULL,
  deadline TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS txs (
  id {ID},
  family_id INTEGER NOT NULL,
  user_id INTEGER,
  type TEXT NOT NULL,
  amount BIGINT NOT NULL,
  account_id INTEGER,
  to_account_id INTEGER,
  category_id INTEGER,
  goal_id INTEGER,
  note TEXT,
  date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS txs_family_date ON txs(family_id, date);
CREATE TABLE IF NOT EXISTS plans (
  id {ID},
  family_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0,
  month TEXT NOT NULL,
  category_id INTEGER,
  done INTEGER NOT NULL DEFAULT 0,
  tx_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plans_family_month ON plans(family_id, month);
CREATE TABLE IF NOT EXISTS tg_links (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT
);
`;

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function makePg(url) {
  return import('pg').then(({ default: pg }) => {
    pg.types.setTypeParser(20, (v) => Number(v)); // int8 (COUNT, SUM по BIGINT)
    pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
    const local = /localhost|127\.0\.0\.1|sslmode=disable/.test(url);
    const pool = new pg.Pool({
      connectionString: url,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
    const wrap = (q) => ({
      kind: 'pg',
      all: async (sql, p = []) => (await q.query(toPg(sql), p)).rows,
      get: async (sql, p = []) => (await q.query(toPg(sql), p)).rows[0],
      run: async (sql, p = []) => {
        const r = await q.query(toPg(sql), p);
        return { changes: r.rowCount, row: r.rows[0] };
      },
    });
    const db = wrap(pool);
    db.exec = async (sql) => pool.query(sql);
    db.tx = async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn(wrap(client));
        await client.query('COMMIT');
        return res;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    };
    db.close = () => pool.end();
    return db;
  });
}

async function makeSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const s = new DatabaseSync(file);
  s.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  const plain = (r) => (r ? { ...r } : r);
  const db = {
    kind: 'sqlite',
    all: async (sql, p = []) => s.prepare(sql).all(...norm(p)).map(plain),
    get: async (sql, p = []) => plain(s.prepare(sql).get(...norm(p))),
    run: async (sql, p = []) => {
      const st = s.prepare(sql);
      if (/\breturning\b/i.test(sql)) {
        const row = plain(st.get(...norm(p)));
        return { changes: row ? 1 : 0, row };
      }
      const r = st.run(...norm(p));
      return { changes: Number(r.changes), row: undefined };
    },
    exec: async (sql) => s.exec(sql),
    close: async () => s.close(),
  };
  // Вызовы SQLite синхронные, поэтому между BEGIN и COMMIT чужие запросы не вклиниваются,
  // пока внутри fn нет ожиданий настоящего ввода-вывода.
  let depth = 0;
  db.tx = async (fn) => {
    if (depth) return fn(db);
    depth++;
    s.exec('BEGIN');
    try {
      const res = await fn(db);
      s.exec('COMMIT');
      return res;
    } catch (e) {
      s.exec('ROLLBACK');
      throw e;
    } finally {
      depth--;
    }
  };
  return db;
}

export async function openDb({ url = process.env.DATABASE_URL, file = process.env.SQLITE_FILE } = {}) {
  const db = url ? await makePg(url) : await makeSqlite(file || path.resolve('data/app.db'));
  const id = db.kind === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const ddl = SCHEMA.replace(/\{ID\}/g, id);
  if (db.kind === 'pg') await db.exec(ddl);
  else for (const stmt of ddl.split(';').map((x) => x.trim()).filter(Boolean)) await db.exec(stmt);
  return db;
}
