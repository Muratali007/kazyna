// Общие помощники тестов: сервер на случайном порту, клиент с cookie, заглушка Telegram Bot API.
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createBot } from '../server/bot.js';
import { createServer } from '../server/index.js';

const silent = { log() {}, warn() {}, error(...a) { if (process.env.TEST_VERBOSE) console.error(...a); } };

/** Заглушка api.telegram.org: запоминает все вызовы. */
export async function fakeTelegram() {
  const calls = [];
  let msgId = 1000;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const method = req.url.split('/').pop();
      const payload = body ? JSON.parse(body) : {};
      calls.push({ method, payload });
      let result = true;
      if (method === 'getMe') result = { id: 1, is_bot: true, username: 'kazyna_test_bot' };
      if (method === 'sendMessage') result = { message_id: ++msgId, chat: { id: payload.chat_id }, text: payload.text };
      if (method === 'getUpdates') result = [];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return {
    base,
    calls,
    sent: (chatId) => calls.filter((c) => c.method === 'sendMessage' && (chatId === undefined || String(c.payload.chat_id) === String(chatId))),
    last: (chatId) => calls.filter((c) => c.method === 'sendMessage' && String(c.payload.chat_id) === String(chatId)).at(-1)?.payload,
    clear: () => { calls.length = 0; },
    close: () => new Promise((r) => srv.close(r)),
  };
}

/** Чистая база: SQLite в памяти или Postgres из TEST_DATABASE_URL (схема public пересоздаётся). */
export async function freshDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.end();
    return openDb({ url });
  }
  return openDb({ url: '', file: ':memory:' });
}

export async function startApp({ withBot = true } = {}) {
  const tg = withBot ? await fakeTelegram() : null;
  const db = await freshDb();
  const publicUrl = 'http://kazyna.test';
  const bot = createBot({ db, token: withBot ? '123:TEST' : '', publicUrl, apiBase: tg?.base, log: silent });
  const { app } = await createServer({ db, bot, secret: 'test-secret', publicUrl, log: silent });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  if (withBot) await bot.start();
  return {
    base, db, bot, tg,
    client: () => client(base),
    /** Отправить апдейт боту через webhook, как это делает Telegram. */
    async update(u, secret = bot.webhookSecret) {
      const r = await fetch(`${base}/tg/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(u) });
      return r.status;
    },
    async close() {
      bot.stop();
      await new Promise((r) => server.close(r));
      await db.close();
      await tg?.close();
    },
  };
}

export function client(base) {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(cookie && { cookie }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.getSetCookie?.() || [];
    for (const c of sc) {
      const [kv] = c.split(';');
      if (kv.startsWith('sid=')) cookie = kv === 'sid=' ? '' : kv;
    }
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
  return {
    get: (p) => req('GET', p),
    post: (p, b = {}) => req('POST', p, b),
    patch: (p, b = {}) => req('PATCH', p, b),
    del: (p) => req('DELETE', p),
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
  };
}

let seq = 0;
/** Регистрирует пользователя и возвращает клиент с сессией. */
export async function register(app, name, extra = {}) {
  const c = app.client();
  const email = `${name.toLowerCase()}${++seq}@test.kz`;
  const r = await c.post('/api/auth/register', { name, email, password: 'secret123', ...extra });
  if (r.status !== 201) throw new Error(`register ${name}: ${r.status} ${JSON.stringify(r.data)}`);
  c.user = r.data.user;
  c.email = email;
  return c;
}

let updateId = 1;
let messageId = 1;
export const tgMsg = (fromId, text, { chatId = fromId, chatType = 'private', username = `u${fromId}` } = {}) => ({
  update_id: updateId++,
  message: { message_id: messageId++, from: { id: fromId, is_bot: false, first_name: 'T', username }, chat: { id: chatId, type: chatType }, date: Math.floor(Date.now() / 1000), text },
});
export const tgCb = (fromId, data, message = { message_id: 1, chat: { id: fromId, type: 'private' }, text: 'x' }) => ({
  update_id: updateId++,
  callback_query: { id: String(updateId), from: { id: fromId, is_bot: false, first_name: 'T' }, data, message },
});

/** Привязывает Telegram (tgId) к клиенту через deep-link код. */
export async function linkTg(app, c, tgId) {
  const r = await c.post('/api/tg/link');
  if (r.status !== 200) throw new Error(`tg/link: ${r.status} ${JSON.stringify(r.data)}`);
  await app.update(tgMsg(tgId, `/start ${r.data.code}`));
  return r.data;
}
