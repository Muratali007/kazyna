import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { openDb } from './db.js';
import { createBot } from './bot.js';
import { matchCategory } from './parser.js';
import {
  toMinor, fromMinor, localDate, monthOf, isMonth, isDate, seedFamily, totals, monthSummary, trend, MEMBER_COLORS,
} from './finance.js';
import { HttpError, validateTx, insertTx, loadCtx } from './ops.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const ACCOUNT_KINDS = ['card', 'cash', 'deposit', 'savings', 'other'];
const now = () => new Date().toISOString();
const str = (v, max = 100) => (v == null ? '' : String(v).trim().slice(0, max));
const money = (v, field = 'Сумма') => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e11) throw new HttpError(400, `${field}: неверное значение`);
  return toMinor(n);
};
const randomCode = (n = 8) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n).toUpperCase();

// ---------- сериализация (копейки → обычные числа) ----------
const sUser = (u) => u && {
  id: u.id, name: u.name, email: u.email, color: u.color, familyId: u.family_id,
  telegram: u.tg_user_id ? { linked: true, username: u.tg_username } : { linked: false }, tgNotify: !!u.tg_notify,
};
const sFamily = (f) => f && { id: f.id, name: f.name, currency: f.currency, monthlyBudget: fromMinor(f.monthly_budget), ownerId: f.owner_id, inviteCode: f.invite_code };
const sAccount = (a) => ({ id: a.id, name: a.name, kind: a.kind, emoji: a.emoji, initial: fromMinor(a.initial), balance: fromMinor(a.balance ?? a.initial), rate: Number(a.rate), isDefault: !!a.is_default, archived: !!a.archived });
const sCategory = (c) => ({ id: c.id, name: c.name, emoji: c.emoji, color: c.color, kind: c.kind, limit: fromMinor(c.limit_amount), keywords: c.keywords, archived: !!c.archived });
const sGoal = (g) => ({ id: g.id, title: g.title, emoji: g.emoji, target: fromMinor(g.target), saved: fromMinor(g.saved || 0), deadline: g.deadline, done: !!g.done });
const sTx = (t) => ({
  id: t.id, type: t.type, amount: fromMinor(t.amount), date: t.date, note: t.note, source: t.source,
  accountId: t.account_id, toAccountId: t.to_account_id, categoryId: t.category_id, goalId: t.goal_id,
  userId: t.user_id, userName: t.user_name, createdAt: t.created_at,
});
const sPlan = (p) => ({ id: p.id, title: p.title, amount: fromMinor(p.amount), month: p.month, categoryId: p.category_id, done: !!p.done, txId: p.tx_id, createdBy: p.created_by });

export async function createServer({ db, bot, secret = process.env.JWT_SECRET, publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL, log = console } = {}) {
  db = db || (await openDb());
  if (!secret) {
    const row = await db.get('SELECT v FROM kv WHERE k = ?', ['jwt_secret']);
    secret = row?.v;
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      await db.run('INSERT INTO kv (k, v) VALUES (?, ?)', ['jwt_secret', secret]);
    }
  }
  publicUrl = publicUrl ? publicUrl.replace(/\/$/, '') : '';
  bot = bot || createBot({ db, token: process.env.TELEGRAM_BOT_TOKEN, publicUrl, log });
  const prod = process.env.NODE_ENV === 'production';

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---------- auth ----------
  const setSession = (res, user) => {
    const token = jwt.sign({ uid: user.id, v: user.token_ver }, secret, { expiresIn: '90d' });
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: prod, maxAge: 90 * 864e5, path: '/' });
  };
  const auth = wrap(async (req, res, next) => {
    let payload;
    try { payload = jwt.verify(req.cookies.sid || '', secret); } catch { throw new HttpError(401, 'Нужно войти'); }
    const user = await db.get('SELECT * FROM users WHERE id = ?', [payload.uid]);
    if (!user || user.token_ver !== payload.v) throw new HttpError(401, 'Нужно войти');
    const family = user.family_id ? await db.get('SELECT * FROM families WHERE id = ?', [user.family_id]) : null;
    if (!family) throw new HttpError(409, 'Нет семьи');
    req.user = user;
    req.family = family;
    next();
  });
  const ownerOnly = (req) => { if (req.family.owner_id !== req.user.id) throw new HttpError(403, 'Только глава семьи может это сделать'); };

  const attempts = new Map();
  const limited = (key) => {
    const t = Date.now();
    const list = (attempts.get(key) || []).filter((x) => t - x < 15 * 60e3);
    attempts.set(key, list);
    return list.length >= 10;
  };

  async function createFamilyFor(t, user, name) {
    const { row: fam } = await t.run('INSERT INTO families (name, owner_id, invite_code, created_at) VALUES (?,?,?,?) RETURNING *', [
      name || `Семья ${user.name}`, user.id, randomCode(8), now(),
    ]);
    await seedFamily(t, fam.id);
    await t.run('UPDATE users SET family_id = ? WHERE id = ?', [fam.id, user.id]);
    return fam;
  }
  async function pickColor(t, familyId) {
    const used = (await t.all('SELECT color FROM users WHERE family_id = ?', [familyId])).map((r) => r.color);
    return MEMBER_COLORS.find((c) => !used.includes(c)) || MEMBER_COLORS[used.length % MEMBER_COLORS.length];
  }

  app.post('/api/auth/register', wrap(async (req, res) => {
    const name = str(req.body.name, 60);
    const email = str(req.body.email, 120).toLowerCase();
    const password = String(req.body.password || '');
    const invite = str(req.body.invite, 20).toUpperCase();
    if (!name) throw new HttpError(400, 'Укажите имя');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Неверный email');
    if (password.length < 6) throw new HttpError(400, 'Пароль — минимум 6 символов');
    if (await db.get('SELECT id FROM users WHERE email = ?', [email])) throw new HttpError(409, 'Этот email уже зарегистрирован');
    const invFam = invite ? await db.get('SELECT * FROM families WHERE invite_code = ?', [invite]) : null;
    if (invite && !invFam) throw new HttpError(404, 'Приглашение не найдено или устарело');
    const hash = await bcrypt.hash(password, 10);
    const user = await db.tx(async (t) => {
      const color = invFam ? await pickColor(t, invFam.id) : MEMBER_COLORS[0];
      const { row: u } = await t.run('INSERT INTO users (email, name, pass, family_id, color, created_at) VALUES (?,?,?,?,?,?) RETURNING *', [
        email, name, hash, invFam?.id ?? null, color, now(),
      ]);
      if (!invFam) await createFamilyFor(t, u, str(req.body.familyName, 60));
      return t.get('SELECT * FROM users WHERE id = ?', [u.id]);
    });
    setSession(res, user);
    res.status(201).json({ user: sUser(user) });
  }));

  app.post('/api/auth/login', wrap(async (req, res) => {
    const email = str(req.body.email, 120).toLowerCase();
    if (limited(email)) throw new HttpError(429, 'Слишком много попыток. Подождите 15 минут.');
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.pass))) {
      attempts.get(email).push(Date.now());
      throw new HttpError(401, 'Неверный email или пароль');
    }
    attempts.delete(email);
    setSession(res, user);
    res.json({ user: sUser(user) });
  }));

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('sid', { path: '/' });
    res.json({ ok: true });
  });

  app.post('/api/auth/logout-all', auth, wrap(async (req, res) => {
    await db.run('UPDATE users SET token_ver = token_ver + 1 WHERE id = ?', [req.user.id]);
    res.clearCookie('sid', { path: '/' });
    res.json({ ok: true });
  }));

  // ---------- профиль ----------
  app.get('/api/me', auth, wrap(async (req, res) => {
    res.json({ user: sUser(req.user), family: sFamily(req.family), isOwner: req.family.owner_id === req.user.id, bot: { enabled: bot.enabled, username: bot.username }, today: localDate() });
  }));

  app.patch('/api/me', auth, wrap(async (req, res) => {
    const u = req.user;
    const name = req.body.name !== undefined ? str(req.body.name, 60) : u.name;
    if (!name) throw new HttpError(400, 'Укажите имя');
    const color = req.body.color !== undefined && /^#[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : u.color;
    const notify = req.body.tgNotify !== undefined ? (req.body.tgNotify ? 1 : 0) : u.tg_notify;
    await db.run('UPDATE users SET name = ?, color = ?, tg_notify = ? WHERE id = ?', [name, color, notify, u.id]);
    res.json({ user: sUser(await db.get('SELECT * FROM users WHERE id = ?', [u.id])) });
  }));

  app.post('/api/me/password', auth, wrap(async (req, res) => {
    if (!(await bcrypt.compare(String(req.body.oldPassword || ''), req.user.pass))) throw new HttpError(400, 'Старый пароль неверный');
    const p = String(req.body.newPassword || '');
    if (p.length < 6) throw new HttpError(400, 'Пароль — минимум 6 символов');
    await db.run('UPDATE users SET pass = ?, token_ver = token_ver + 1 WHERE id = ?', [await bcrypt.hash(p, 10), req.user.id]);
    setSession(res, await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]));
    res.json({ ok: true });
  }));

  // ---------- Telegram привязка ----------
  app.post('/api/tg/link', auth, wrap(async (req, res) => {
    if (!bot.enabled) throw new HttpError(503, 'Telegram-бот ещё не настроен на сервере');
    await db.run('DELETE FROM tg_links WHERE user_id = ? OR expires_at < ?', [req.user.id, now()]);
    const code = randomCode(12);
    await db.run('INSERT INTO tg_links (code, user_id, expires_at) VALUES (?,?,?)', [code, req.user.id, new Date(Date.now() + 30 * 60e3).toISOString()]);
    res.json({ code, url: bot.deepLink(code), username: bot.username });
  }));
  app.delete('/api/tg/link', auth, wrap(async (req, res) => {
    await db.run('UPDATE users SET tg_user_id = NULL, tg_username = NULL WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  }));

  // ---------- семья и приглашения ----------
  app.get('/api/invite/:code', wrap(async (req, res) => {
    const f = await db.get('SELECT f.name, u.name AS owner FROM families f JOIN users u ON u.id = f.owner_id WHERE f.invite_code = ?', [str(req.params.code, 20).toUpperCase()]);
    if (!f) throw new HttpError(404, 'Приглашение не найдено или устарело');
    const n = await db.get('SELECT COUNT(*) AS n FROM users u JOIN families f ON f.id = u.family_id WHERE f.invite_code = ?', [str(req.params.code, 20).toUpperCase()]);
    res.json({ family: f.name, owner: f.owner, members: Number(n.n) });
  }));

  app.get('/api/family', auth, wrap(async (req, res) => {
    const month = monthOf(localDate());
    const members = await db.all(
      `SELECT u.id, u.name, u.email, u.color, u.tg_user_id, u.tg_username, u.created_at,
         COALESCE((SELECT SUM(t.amount) FROM txs t WHERE t.user_id = u.id AND t.family_id = u.family_id AND t.type = 'expense' AND t.date LIKE ?), 0) AS spent
       FROM users u WHERE u.family_id = ? ORDER BY u.id`, [`${month}-%`, req.family.id]);
    res.json({
      family: sFamily(req.family),
      isOwner: req.family.owner_id === req.user.id,
      inviteUrl: `${publicUrl || `${req.protocol}://${req.get('host')}`}/#/join/${req.family.invite_code}`,
      members: members.map((m) => ({ id: m.id, name: m.name, email: m.email, color: m.color, telegram: !!m.tg_user_id, tgUsername: m.tg_username, isOwner: m.id === req.family.owner_id, spent: fromMinor(m.spent), joinedAt: m.created_at })),
    });
  }));

  app.patch('/api/family', auth, wrap(async (req, res) => {
    const f = req.family;
    const name = req.body.name !== undefined ? str(req.body.name, 60) || f.name : f.name;
    const currency = req.body.currency !== undefined ? str(req.body.currency, 5) || f.currency : f.currency;
    const budget = req.body.monthlyBudget !== undefined ? money(req.body.monthlyBudget, 'Бюджет') : f.monthly_budget;
    await db.run('UPDATE families SET name = ?, currency = ?, monthly_budget = ? WHERE id = ?', [name, currency, budget, f.id]);
    res.json({ family: sFamily(await db.get('SELECT * FROM families WHERE id = ?', [f.id])) });
  }));

  app.post('/api/family/invite/reset', auth, wrap(async (req, res) => {
    ownerOnly(req);
    const code = randomCode(8);
    await db.run('UPDATE families SET invite_code = ? WHERE id = ?', [code, req.family.id]);
    res.json({ inviteCode: code });
  }));

  async function memberCount(familyId) {
    return Number((await db.get('SELECT COUNT(*) AS n FROM users WHERE family_id = ?', [familyId])).n);
  }

  app.post('/api/family/join', auth, wrap(async (req, res) => {
    const target = await db.get('SELECT * FROM families WHERE invite_code = ?', [str(req.body.code, 20).toUpperCase()]);
    if (!target) throw new HttpError(404, 'Приглашение не найдено или устарело');
    if (target.id === req.family.id) return res.json({ family: sFamily(target) });
    if (req.family.owner_id === req.user.id && (await memberCount(req.family.id)) > 1) {
      throw new HttpError(409, 'Вы глава текущей семьи. Сначала передайте главенство другому участнику.');
    }
    const color = await pickColor(db, target.id);
    const oldId = req.family.id;
    await db.tx(async (t) => {
      await t.run('UPDATE users SET family_id = ?, color = ? WHERE id = ?', [target.id, color, req.user.id]);
      // Старая семья опустела и в ней нет операций — удаляем пустую заготовку
      const left = Number((await t.get('SELECT COUNT(*) AS n FROM users WHERE family_id = ?', [oldId])).n);
      const used = Number((await t.get('SELECT COUNT(*) AS n FROM txs WHERE family_id = ?', [oldId])).n);
      if (!left && !used) {
        for (const tbl of ['txs', 'plans', 'goals', 'categories', 'accounts']) await t.run(`DELETE FROM ${tbl} WHERE family_id = ?`, [oldId]);
        await t.run('DELETE FROM families WHERE id = ?', [oldId]);
      }
    });
    await bot.notifyFamily?.(target.id, req.user.id, `👋 <b>${req.user.name.replace(/</g, '&lt;')}</b> присоединился(-лась) к семье «${target.name.replace(/</g, '&lt;')}»`);
    res.json({ family: sFamily(target) });
  }));

  app.post('/api/family/leave', auth, wrap(async (req, res) => {
    const n = await memberCount(req.family.id);
    if (n <= 1) throw new HttpError(400, 'Вы единственный участник этой семьи');
    if (req.family.owner_id === req.user.id) throw new HttpError(409, 'Сначала передайте главенство другому участнику');
    const fam = await db.tx((t) => createFamilyFor(t, req.user));
    res.json({ family: sFamily(fam) });
  }));

  app.post('/api/family/owner', auth, wrap(async (req, res) => {
    ownerOnly(req);
    const target = await db.get('SELECT * FROM users WHERE id = ? AND family_id = ?', [Number(req.body.userId), req.family.id]);
    if (!target) throw new HttpError(404, 'Участник не найден');
    await db.run('UPDATE families SET owner_id = ? WHERE id = ?', [target.id, req.family.id]);
    res.json({ ok: true });
  }));

  app.delete('/api/family/members/:id', auth, wrap(async (req, res) => {
    ownerOnly(req);
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'Нельзя исключить себя');
    const target = await db.get('SELECT * FROM users WHERE id = ? AND family_id = ?', [id, req.family.id]);
    if (!target) throw new HttpError(404, 'Участник не найден');
    await db.tx((t) => createFamilyFor(t, target));
    res.json({ ok: true });
  }));

  // ---------- счета ----------
  app.get('/api/accounts', auth, wrap(async (req, res) => {
    const t = await totals(db, req.family.id);
    res.json({ accounts: t.accounts.map(sAccount), totals: { available: fromMinor(t.available), deposit: fromMinor(t.deposit), inGoals: fromMinor(t.inGoals), net: fromMinor(t.net) } });
  }));
  app.post('/api/accounts', auth, wrap(async (req, res) => {
    const name = str(req.body.name, 40);
    if (!name) throw new HttpError(400, 'Укажите название');
    const kind = ACCOUNT_KINDS.includes(req.body.kind) ? req.body.kind : 'card';
    const { row } = await db.run('INSERT INTO accounts (family_id, name, kind, emoji, initial, rate, created_at) VALUES (?,?,?,?,?,?,?) RETURNING *', [
      req.family.id, name, kind, str(req.body.emoji, 8) || null, money(req.body.balance ?? req.body.initial ?? 0, 'Баланс'), Math.max(0, Math.min(100, Number(req.body.rate) || 0)), now(),
    ]);
    res.status(201).json({ account: sAccount(row) });
  }));
  app.patch('/api/accounts/:id', auth, wrap(async (req, res) => {
    const fid = req.family.id;
    const a = (await totals(db, fid)).accounts.find((x) => x.id === Number(req.params.id));
    if (!a) throw new HttpError(404, 'Счёт не найден');
    const name = req.body.name !== undefined ? str(req.body.name, 40) || a.name : a.name;
    const kind = ACCOUNT_KINDS.includes(req.body.kind) ? req.body.kind : a.kind;
    const emoji = req.body.emoji !== undefined ? str(req.body.emoji, 8) || null : a.emoji;
    const rate = req.body.rate !== undefined ? Math.max(0, Math.min(100, Number(req.body.rate) || 0)) : a.rate;
    const archived = req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : a.archived;
    let initial = Number(a.initial);
    if (req.body.balance !== undefined) {
      const sign = Number(req.body.balance) < 0 ? -1 : 1;
      initial += sign * money(Math.abs(Number(req.body.balance)), 'Баланс') - a.balance; // корректировка до фактического остатка
    }
    await db.run('UPDATE accounts SET name = ?, kind = ?, emoji = ?, rate = ?, archived = ?, initial = ? WHERE id = ?', [name, kind, emoji, rate, archived, initial, a.id]);
    if (req.body.isDefault) {
      await db.run('UPDATE accounts SET is_default = 0 WHERE family_id = ?', [fid]);
      await db.run('UPDATE accounts SET is_default = 1, archived = 0 WHERE id = ?', [a.id]);
    }
    const upd = (await totals(db, fid)).accounts.find((x) => x.id === a.id);
    res.json({ account: sAccount(upd) });
  }));
  app.delete('/api/accounts/:id', auth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const a = await db.get('SELECT * FROM accounts WHERE id = ? AND family_id = ?', [id, req.family.id]);
    if (!a) throw new HttpError(404, 'Счёт не найден');
    if (a.is_default) throw new HttpError(400, 'Нельзя удалить основной счёт — сначала сделайте основным другой');
    const used = await db.get('SELECT COUNT(*) AS n FROM txs WHERE account_id = ? OR to_account_id = ?', [id, id]);
    if (Number(used.n) > 0) {
      await db.run('UPDATE accounts SET archived = 1 WHERE id = ?', [id]);
      return res.json({ archived: true });
    }
    await db.run('DELETE FROM accounts WHERE id = ?', [id]);
    res.json({ deleted: true });
  }));

  // ---------- категории ----------
  app.get('/api/categories', auth, wrap(async (req, res) => {
    const rows = await db.all('SELECT * FROM categories WHERE family_id = ? ORDER BY sort, id', [req.family.id]);
    res.json({ categories: rows.map(sCategory) });
  }));
  app.post('/api/categories', auth, wrap(async (req, res) => {
    const name = str(req.body.name, 40);
    if (!name) throw new HttpError(400, 'Укажите название');
    const kind = req.body.kind === 'income' ? 'income' : 'expense';
    const max = await db.get('SELECT COALESCE(MAX(sort), 0) AS m FROM categories WHERE family_id = ?', [req.family.id]);
    const { row } = await db.run('INSERT INTO categories (family_id, name, emoji, color, kind, limit_amount, keywords, sort) VALUES (?,?,?,?,?,?,?,?) RETURNING *', [
      req.family.id, name, str(req.body.emoji, 8) || '🏷️', /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : '#8b5cf6', kind,
      money(req.body.limit || 0, 'Лимит'), str(req.body.keywords, 300).toLowerCase(), Number(max.m) + 1,
    ]);
    res.status(201).json({ category: sCategory(row) });
  }));
  app.patch('/api/categories/:id', auth, wrap(async (req, res) => {
    const c = await db.get('SELECT * FROM categories WHERE id = ? AND family_id = ?', [Number(req.params.id), req.family.id]);
    if (!c) throw new HttpError(404, 'Категория не найдена');
    const b = req.body;
    await db.run('UPDATE categories SET name = ?, emoji = ?, color = ?, limit_amount = ?, keywords = ?, archived = ? WHERE id = ?', [
      b.name !== undefined ? str(b.name, 40) || c.name : c.name,
      b.emoji !== undefined ? str(b.emoji, 8) || c.emoji : c.emoji,
      b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : c.color,
      b.limit !== undefined ? money(b.limit || 0, 'Лимит') : c.limit_amount,
      b.keywords !== undefined ? str(b.keywords, 300).toLowerCase() : c.keywords,
      b.archived !== undefined ? (b.archived ? 1 : 0) : c.archived,
      c.id,
    ]);
    res.json({ category: sCategory(await db.get('SELECT * FROM categories WHERE id = ?', [c.id])) });
  }));
  app.delete('/api/categories/:id', auth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const c = await db.get('SELECT * FROM categories WHERE id = ? AND family_id = ?', [id, req.family.id]);
    if (!c) throw new HttpError(404, 'Категория не найдена');
    const used = await db.get('SELECT COUNT(*) AS n FROM txs WHERE category_id = ?', [id]);
    if (Number(used.n) > 0) {
      await db.run('UPDATE categories SET archived = 1 WHERE id = ?', [id]);
      return res.json({ archived: true });
    }
    await db.run('DELETE FROM categories WHERE id = ?', [id]);
    await db.run('UPDATE plans SET category_id = NULL WHERE category_id = ?', [id]);
    res.json({ deleted: true });
  }));

  // ---------- операции ----------
  const txInput = (b) => ({
    type: b.type, amount: b.amount !== undefined ? money(b.amount) : undefined, date: b.date, note: b.note,
    accountId: b.accountId, toAccountId: b.toAccountId, categoryId: b.categoryId, goalId: b.goalId,
  });

  app.get('/api/txs', auth, wrap(async (req, res) => {
    const q = req.query;
    const where = ['t.family_id = ?'];
    const p = [req.family.id];
    if (isMonth(q.month)) { where.push('t.date LIKE ?'); p.push(`${q.month}-%`); }
    if (isDate(q.from)) { where.push('t.date >= ?'); p.push(q.from); }
    if (isDate(q.to)) { where.push('t.date <= ?'); p.push(q.to); }
    if (q.type && ['expense', 'income', 'transfer', 'goal', 'goal_out'].includes(q.type)) { where.push('t.type = ?'); p.push(q.type); }
    if (q.category) { where.push('t.category_id = ?'); p.push(Number(q.category)); }
    if (q.account) { where.push('(t.account_id = ? OR t.to_account_id = ?)'); p.push(Number(q.account), Number(q.account)); }
    if (q.user) { where.push('t.user_id = ?'); p.push(Number(q.user)); }
    if (q.q) { where.push('LOWER(t.note) LIKE ?'); p.push(`%${str(q.q, 50).toLowerCase()}%`); }
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const offset = Math.max(0, Number(q.offset) || 0);
    const w = where.join(' AND ');
    const rows = await db.all(`SELECT t.*, u.name AS user_name FROM txs t LEFT JOIN users u ON u.id = t.user_id WHERE ${w} ORDER BY t.date DESC, t.id DESC LIMIT ${limit} OFFSET ${offset}`, p);
    const agg = await db.get(`SELECT COUNT(*) AS n,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income
      FROM txs t WHERE ${w}`, p);
    res.json({ items: rows.map(sTx), total: Number(agg.n), sums: { expense: fromMinor(agg.expense), income: fromMinor(agg.income) } });
  }));

  app.post('/api/txs', auth, wrap(async (req, res) => {
    const v = await validateTx(db, req.family.id, txInput(req.body));
    const tx = await insertTx(db, req.family.id, req.user.id, v, 'web');
    const alerts = bot.txNotice ? await bot.txNotice(req.family, req.user, tx).catch((e) => { log.warn(e.message); return []; }) : [];
    res.status(201).json({ tx: sTx({ ...tx, user_name: req.user.name }), alerts });
  }));

  app.patch('/api/txs/:id', auth, wrap(async (req, res) => {
    const t = await db.get('SELECT * FROM txs WHERE id = ? AND family_id = ?', [Number(req.params.id), req.family.id]);
    if (!t) throw new HttpError(404, 'Операция не найдена');
    const b = req.body;
    const merged = {
      type: b.type ?? t.type,
      amount: b.amount !== undefined ? money(b.amount) : Number(t.amount),
      date: b.date ?? t.date,
      note: b.note !== undefined ? b.note : t.note,
      accountId: b.accountId !== undefined ? b.accountId : t.account_id,
      toAccountId: b.toAccountId !== undefined ? b.toAccountId : t.to_account_id,
      categoryId: b.categoryId !== undefined ? b.categoryId : t.category_id,
      goalId: b.goalId !== undefined ? b.goalId : t.goal_id,
    };
    if (b.type && b.type !== t.type && b.categoryId === undefined) merged.categoryId = null;
    const v = await validateTx(db, req.family.id, merged);
    await db.run('UPDATE txs SET type = ?, amount = ?, date = ?, note = ?, account_id = ?, to_account_id = ?, category_id = ?, goal_id = ? WHERE id = ?', [
      v.type, v.amount, v.date, v.note, v.accountId, v.toAccountId, v.categoryId, v.goalId, t.id,
    ]);
    const row = await db.get('SELECT t.*, u.name AS user_name FROM txs t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?', [t.id]);
    res.json({ tx: sTx(row) });
  }));

  app.delete('/api/txs/:id', auth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const r = await db.run('DELETE FROM txs WHERE id = ? AND family_id = ?', [id, req.family.id]);
    if (!r.changes) throw new HttpError(404, 'Операция не найдена');
    await db.run('UPDATE plans SET done = 0, tx_id = NULL WHERE tx_id = ?', [id]);
    res.json({ ok: true });
  }));

  app.get('/api/export.csv', auth, wrap(async (req, res) => {
    const ctx = await loadCtx(db, req.family.id);
    const where = isMonth(req.query.month) ? ' AND t.date LIKE ?' : '';
    const rows = await db.all(`SELECT t.*, u.name AS user_name FROM txs t LEFT JOIN users u ON u.id = t.user_id WHERE t.family_id = ?${where} ORDER BY t.date, t.id`,
      where ? [req.family.id, `${req.query.month}-%`] : [req.family.id]);
    const name = (list, id, key = 'name') => list.find((x) => x.id === id)?.[key] || '';
    const TYPES = { expense: 'Расход', income: 'Доход', transfer: 'Перевод', goal: 'В цель', goal_out: 'Из цели' };
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Дата', 'Тип', 'Сумма', 'Категория', 'Счёт', 'На счёт', 'Цель', 'Комментарий', 'Кто'].map(cell).join(';')];
    for (const t of rows) {
      lines.push([t.date, TYPES[t.type], String(fromMinor(t.amount)).replace('.', ','), name(ctx.categories, t.category_id), name(ctx.accounts, t.account_id),
        name(ctx.accounts, t.to_account_id), name(ctx.goals, t.goal_id, 'title'), t.note, t.user_name].map(cell).join(';'));
    }
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="budget-${isMonth(req.query.month) ? req.query.month : 'all'}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  }));

  // ---------- цели ----------
  app.get('/api/goals', auth, wrap(async (req, res) => {
    const t = await totals(db, req.family.id);
    res.json({ goals: t.goals.map(sGoal) });
  }));
  app.post('/api/goals', auth, wrap(async (req, res) => {
    const title = str(req.body.title, 60);
    if (!title) throw new HttpError(400, 'Назовите цель');
    const target = money(req.body.target, 'Сумма цели');
    if (target <= 0) throw new HttpError(400, 'Сумма цели должна быть больше нуля');
    const deadline = isDate(req.body.deadline) ? req.body.deadline : null;
    const { row } = await db.run('INSERT INTO goals (family_id, title, emoji, target, deadline, created_at) VALUES (?,?,?,?,?,?) RETURNING *', [
      req.family.id, title, str(req.body.emoji, 8) || '🎯', target, deadline, now(),
    ]);
    if (Number(req.body.initial) > 0) {
      const v = await validateTx(db, req.family.id, { type: 'goal', goalId: row.id, amount: money(req.body.initial), accountId: req.body.accountId, note: 'Начальная сумма' });
      await insertTx(db, req.family.id, req.user.id, v, 'web');
    }
    const g = (await totals(db, req.family.id)).goals.find((x) => x.id === row.id);
    res.status(201).json({ goal: sGoal(g) });
  }));
  app.patch('/api/goals/:id', auth, wrap(async (req, res) => {
    const g = await db.get('SELECT * FROM goals WHERE id = ? AND family_id = ?', [Number(req.params.id), req.family.id]);
    if (!g) throw new HttpError(404, 'Цель не найдена');
    const b = req.body;
    const target = b.target !== undefined ? money(b.target, 'Сумма цели') : g.target;
    if (target <= 0) throw new HttpError(400, 'Сумма цели должна быть больше нуля');
    await db.run('UPDATE goals SET title = ?, emoji = ?, target = ?, deadline = ?, done = ? WHERE id = ?', [
      b.title !== undefined ? str(b.title, 60) || g.title : g.title,
      b.emoji !== undefined ? str(b.emoji, 8) || g.emoji : g.emoji,
      target,
      b.deadline !== undefined ? (isDate(b.deadline) ? b.deadline : null) : g.deadline,
      b.done !== undefined ? (b.done ? 1 : 0) : g.done,
      g.id,
    ]);
    res.json({ goal: sGoal((await totals(db, req.family.id)).goals.find((x) => x.id === g.id)) });
  }));
  app.delete('/api/goals/:id', auth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const g = await db.get('SELECT * FROM goals WHERE id = ? AND family_id = ?', [id, req.family.id]);
    if (!g) throw new HttpError(404, 'Цель не найдена');
    // Удаляем пополнения — деньги «возвращаются» на счета, с которых откладывались
    await db.tx(async (t) => {
      await t.run('DELETE FROM txs WHERE goal_id = ?', [id]);
      await t.run('DELETE FROM goals WHERE id = ?', [id]);
    });
    res.json({ ok: true });
  }));
  app.post('/api/goals/:id/contribute', auth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const out = req.body.direction === 'out';
    const v = await validateTx(db, req.family.id, {
      type: out ? 'goal_out' : 'goal', goalId: id, amount: money(req.body.amount),
      accountId: out ? null : req.body.accountId, toAccountId: out ? req.body.accountId : null, note: req.body.note, date: req.body.date,
    });
    const goalNow = (await totals(db, req.family.id)).goals.find((x) => x.id === id);
    if (out && v.amount > goalNow.saved) throw new HttpError(400, 'В цели нет столько денег');
    const tx = await insertTx(db, req.family.id, req.user.id, v, 'web');
    bot.txNotice?.(req.family, req.user, tx).catch(() => {});
    const g = (await totals(db, req.family.id)).goals.find((x) => x.id === id);
    if (!g.done && g.saved >= g.target) await db.run('UPDATE goals SET done = 1 WHERE id = ?', [id]);
    res.status(201).json({ goal: sGoal({ ...g, done: g.done || g.saved >= g.target }), tx: sTx(tx) });
  }));

  // ---------- покупки на месяц ----------
  app.get('/api/plans', auth, wrap(async (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : monthOf(localDate());
    const rows = await db.all('SELECT * FROM plans WHERE family_id = ? AND month = ? ORDER BY done, id', [req.family.id, month]);
    res.json({ month, plans: rows.map(sPlan) });
  }));
  app.post('/api/plans', auth, wrap(async (req, res) => {
    const title = str(req.body.title, 120);
    if (!title) throw new HttpError(400, 'Что нужно купить?');
    const month = isMonth(req.body.month) ? req.body.month : monthOf(localDate());
    let categoryId = req.body.categoryId ? Number(req.body.categoryId) : null;
    if (categoryId && !(await db.get("SELECT id FROM categories WHERE id = ? AND family_id = ? AND kind = 'expense'", [categoryId, req.family.id]))) categoryId = null;
    if (!categoryId) categoryId = matchCategory(title, (await loadCtx(db, req.family.id)).categories, 'expense')?.id ?? null;
    const { row } = await db.run('INSERT INTO plans (family_id, title, amount, month, category_id, created_by, created_at) VALUES (?,?,?,?,?,?,?) RETURNING *', [
      req.family.id, title, money(req.body.amount || 0), month, categoryId, req.user.id, now(),
    ]);
    res.status(201).json({ plan: sPlan(row) });
  }));
  app.patch('/api/plans/:id', auth, wrap(async (req, res) => {
    const p = await db.get('SELECT * FROM plans WHERE id = ? AND family_id = ?', [Number(req.params.id), req.family.id]);
    if (!p) throw new HttpError(404, 'Не найдено');
    const b = req.body;
    let done = p.done;
    let txId = p.tx_id;
    if (b.done === false && p.done) {
      if (p.tx_id) await db.run('DELETE FROM txs WHERE id = ? AND family_id = ?', [p.tx_id, req.family.id]);
      done = 0; txId = null;
    } else if (b.done === true && !p.done) done = 1;
    let categoryId = b.categoryId !== undefined ? (b.categoryId ? Number(b.categoryId) : null) : p.category_id;
    if (categoryId && !(await db.get("SELECT id FROM categories WHERE id = ? AND family_id = ? AND kind = 'expense'", [categoryId, req.family.id]))) categoryId = p.category_id;
    await db.run('UPDATE plans SET title = ?, amount = ?, month = ?, category_id = ?, done = ?, tx_id = ? WHERE id = ?', [
      b.title !== undefined ? str(b.title, 120) || p.title : p.title,
      b.amount !== undefined ? money(b.amount || 0) : p.amount,
      isMonth(b.month) ? b.month : p.month,
      categoryId, done, txId, p.id,
    ]);
    res.json({ plan: sPlan(await db.get('SELECT * FROM plans WHERE id = ?', [p.id])) });
  }));
  app.delete('/api/plans/:id', auth, wrap(async (req, res) => {
    const r = await db.run('DELETE FROM plans WHERE id = ? AND family_id = ?', [Number(req.params.id), req.family.id]);
    if (!r.changes) throw new HttpError(404, 'Не найдено');
    res.json({ ok: true });
  }));
  app.post('/api/plans/:id/buy', auth, wrap(async (req, res) => {
    const p = await db.get('SELECT * FROM plans WHERE id = ? AND family_id = ?', [Number(req.params.id), req.family.id]);
    if (!p) throw new HttpError(404, 'Не найдено');
    if (p.done) throw new HttpError(409, 'Уже куплено');
    const amount = req.body.amount !== undefined ? money(req.body.amount) : Number(p.amount);
    let tx = null;
    if (amount > 0) {
      const v = await validateTx(db, req.family.id, { type: 'expense', amount, categoryId: req.body.categoryId ?? p.category_id, accountId: req.body.accountId, note: p.title, date: req.body.date });
      tx = await insertTx(db, req.family.id, req.user.id, v, 'web');
      bot.txNotice?.(req.family, req.user, tx).catch(() => {});
    }
    await db.run('UPDATE plans SET done = 1, tx_id = ?, amount = ? WHERE id = ?', [tx?.id ?? null, amount, p.id]);
    res.json({ plan: sPlan(await db.get('SELECT * FROM plans WHERE id = ?', [p.id])), tx: tx && sTx(tx) });
  }));

  // ---------- сводка ----------
  app.get('/api/summary', auth, wrap(async (req, res) => {
    const today = localDate();
    const month = isMonth(req.query.month) ? req.query.month : monthOf(today);
    const [s, t, tr, recent, ctx] = await Promise.all([
      monthSummary(db, req.family, month, today),
      totals(db, req.family.id),
      trend(db, req.family.id, month, 6),
      db.all('SELECT t.*, u.name AS user_name FROM txs t LEFT JOIN users u ON u.id = t.user_id WHERE t.family_id = ? ORDER BY t.date DESC, t.id DESC LIMIT 8', [req.family.id]),
      loadCtx(db, req.family.id),
    ]);
    const m = fromMinor;
    res.json({
      today, month,
      family: sFamily(req.family),
      budget: m(s.budget), spent: m(s.spent), income: m(s.income), remaining: m(s.remaining), perDay: m(s.perDay),
      daysLeft: s.daysLeft, daysInMonth: s.daysInMonth, prevSpent: m(s.prevSpent),
      categories: s.categories.map((c) => ({ ...c, limit: m(c.limit), amount: m(c.amount) })),
      days: s.days.map((d) => ({ date: d.date, expense: m(d.expense), income: m(d.income) })),
      members: s.members.map((x) => ({ id: x.id, name: x.name, color: x.color, spent: m(x.spent) })),
      plans: { total: m(s.plans.total), left: m(s.plans.left), count: s.plans.count, done: s.plans.done },
      totals: { available: m(t.available), deposit: m(t.deposit), inGoals: m(t.inGoals), net: m(t.net) },
      accounts: t.accounts.map(sAccount),
      goals: t.goals.map(sGoal),
      trend: tr.map((x) => ({ month: x.month, expense: m(x.expense), income: m(x.income) })),
      recent: recent.map(sTx),
      ref: { categories: ctx.categories.map(sCategory) },
    });
  }));

  // ---------- Telegram webhook ----------
  app.post('/tg/webhook', wrap(async (req, res) => {
    if (!bot.enabled || req.get('x-telegram-bot-api-secret-token') !== bot.webhookSecret) return res.sendStatus(403);
    await bot.handleUpdate(req.body || {});
    res.json({ ok: true });
  }));

  app.get('/healthz', wrap(async (req, res) => {
    await db.get('SELECT 1 AS ok');
    res.json({ ok: true, db: db.kind, bot: bot.mode || 'off' });
  }));

  // ---------- статика ----------
  app.use(express.static(PUBLIC_DIR, {
    setHeaders: (res, file) => {
      if (/\.(html|webmanifest)$|sw\.js$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Неверный JSON' });
    log.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  });

  return { app, db, bot };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const { app, db, bot } = await createServer();
  const server = app.listen(port, () => {
    console.log(`Казына запущена: http://localhost:${port} (БД: ${db.kind})`);
    bot.start();
  });
  const shutdown = () => { bot.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
