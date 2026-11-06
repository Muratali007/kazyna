// Денежная логика: суммы хранятся в «копейках» (целые числа ×100), наружу отдаются обычными числами.
export const toMinor = (n) => Math.round(Number(n) * 100);
export const fromMinor = (n) => Math.round(Number(n || 0)) / 100;

export const TZ = process.env.APP_TZ || 'Asia/Almaty';

export function localDate(d = new Date(), tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const monthOf = (date) => date.slice(0, 7);
export function shiftDate(date, days) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function fmtMoney(minor, currency = '₸') {
  const v = fromMinor(minor);
  const s = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v);
  return `${s.replace(/ /g, ' ')} ${currency}`;
}

export const DEFAULT_CATEGORIES = [
  ['Продукты', '🛒', '#22c55e', 'expense', 'продукт магнум small смол галмарт magnum еда магазин супермаркет молоко хлеб мясо овощ фрукт базар рынок анвар'],
  ['Кафе и доставка', '🍔', '#f97316', 'expense', 'кафе ресторан кофе обед ужин завтрак доставк glovo wolt шаурм пицц бургер суши kfc макдон фастфуд чайхан'],
  ['Транспорт', '🚕', '#eab308', 'expense', 'такси яндекс бензин заправк топливо автобус метро парковк проезд indrive индрайв автомойк мойк'],
  ['Дом и коммуналка', '🏠', '#3b82f6', 'expense', 'коммунал жкх свет электричеств газ вода аренд квартплат квартир интернет ремонт мебел'],
  ['Связь и подписки', '📱', '#06b6d4', 'expense', 'телефон связь мобильн beeline билайн kcell activ tele2 подписк netflix spotify youtube icloud'],
  ['Здоровье', '💊', '#ef4444', 'expense', 'аптек лекарств врач клиник стоматолог зуб анализ больниц витамин'],
  ['Одежда', '👕', '#a855f7', 'expense', 'одежд обув кроссовк куртк платье джинс футболк'],
  ['Дети', '🧸', '#ec4899', 'expense', 'детск ребен садик сад школ игрушк памперс подгузник кружок секци'],
  ['Развлечения', '🎬', '#8b5cf6', 'expense', 'кино игр концерт театр боулинг отдых поездк путешеств отел билет'],
  ['Красота', '💅', '#f472b6', 'expense', 'салон стрижк парикмахер маникюр космет барбер'],
  ['Подарки', '🎁', '#14b8a6', 'expense', 'подарок подарк цвет той тойга праздник'],
  ['Кредиты', '🏦', '#64748b', 'expense', 'кредит рассрочк ипотек долг займ'],
  ['Другое', '📦', '#94a3b8', 'expense', ''],
  ['Зарплата', '💼', '#22c55e', 'income', 'зарплат зп аванс оклад'],
  ['Подработка', '💡', '#0ea5e9', 'income', 'фриланс подработ заказ халтур'],
  ['Кэшбэк и проценты', '💰', '#eab308', 'income', 'кешбэк кэшбэк кешбек cashback процент вознагражд бонус'],
  ['Прочий доход', '💵', '#94a3b8', 'income', 'подарили вернули возврат'],
];

export const DEFAULT_ACCOUNTS = [
  ['Карта', 'card', '💳', 1],
  ['Наличные', 'cash', '💵', 0],
  ['Депозит', 'deposit', '🏦', 0],
];

export const MEMBER_COLORS = ['#8b5cf6', '#06b6d4', '#f97316', '#22c55e', '#ec4899', '#eab308', '#3b82f6', '#ef4444'];

export async function seedFamily(db, familyId) {
  const now = new Date().toISOString();
  let i = 0;
  for (const [name, emoji, color, kind, kw] of DEFAULT_CATEGORIES) {
    await db.run('INSERT INTO categories (family_id, name, emoji, color, kind, keywords, sort) VALUES (?,?,?,?,?,?,?)', [
      familyId, name, emoji, color, kind, kw, i++,
    ]);
  }
  for (const [name, kind, emoji, def] of DEFAULT_ACCOUNTS) {
    await db.run('INSERT INTO accounts (family_id, name, kind, emoji, is_default, rate, created_at) VALUES (?,?,?,?,?,?,?)', [
      familyId, name, kind, emoji, def, kind === 'deposit' ? 14 : 0, now,
    ]);
  }
}

const SAVING_KINDS = new Set(['deposit', 'savings']);

export async function accountBalances(db, familyId) {
  const rows = await db.all(
    `SELECT a.*,
       a.initial
       + COALESCE((SELECT SUM(t.amount) FROM txs t WHERE t.account_id = a.id AND t.type = 'income'), 0)
       - COALESCE((SELECT SUM(t.amount) FROM txs t WHERE t.account_id = a.id AND t.type IN ('expense','transfer','goal')), 0)
       + COALESCE((SELECT SUM(t.amount) FROM txs t WHERE t.to_account_id = a.id AND t.type IN ('transfer','goal_out')), 0)
       AS balance
     FROM accounts a WHERE a.family_id = ? ORDER BY a.archived, a.is_default DESC, a.id`,
    [familyId],
  );
  return rows.map((r) => ({ ...r, balance: Number(r.balance) }));
}

export async function goalsWithProgress(db, familyId) {
  const rows = await db.all(
    `SELECT g.*,
       COALESCE((SELECT SUM(t.amount) FROM txs t WHERE t.goal_id = g.id AND t.type = 'goal'), 0)
       - COALESCE((SELECT SUM(t.amount) FROM txs t WHERE t.goal_id = g.id AND t.type = 'goal_out'), 0) AS saved
     FROM goals g WHERE g.family_id = ? ORDER BY g.done, g.id`,
    [familyId],
  );
  return rows.map((r) => ({ ...r, saved: Number(r.saved) }));
}

export async function totals(db, familyId) {
  const accounts = await accountBalances(db, familyId);
  const goals = await goalsWithProgress(db, familyId);
  const live = accounts.filter((a) => !a.archived);
  const available = live.filter((a) => !SAVING_KINDS.has(a.kind)).reduce((s, a) => s + a.balance, 0);
  const deposit = live.filter((a) => SAVING_KINDS.has(a.kind)).reduce((s, a) => s + a.balance, 0);
  const inGoals = goals.reduce((s, g) => s + Math.max(0, g.saved), 0);
  return { accounts, goals, available, deposit, inGoals, net: available + deposit + inGoals };
}

export async function monthSummary(db, family, month, today = localDate()) {
  const fid = family.id;
  const like = `${month}-%`;
  const cats = await db.all('SELECT * FROM categories WHERE family_id = ? ORDER BY sort, id', [fid]);
  const byCat = await db.all(
    `SELECT category_id, type, SUM(amount) AS sum, COUNT(*) AS n FROM txs
     WHERE family_id = ? AND date LIKE ? AND type IN ('expense','income') GROUP BY category_id, type`,
    [fid, like],
  );
  const byDay = await db.all(
    `SELECT date, type, SUM(amount) AS sum FROM txs
     WHERE family_id = ? AND date LIKE ? AND type IN ('expense','income') GROUP BY date, type ORDER BY date`,
    [fid, like],
  );
  const byMember = await db.all(
    `SELECT u.id, u.name, u.color, COALESCE(SUM(t.amount), 0) AS spent FROM users u
     LEFT JOIN txs t ON t.user_id = u.id AND t.family_id = ? AND t.date LIKE ? AND t.type = 'expense'
     WHERE u.family_id = ? GROUP BY u.id, u.name, u.color ORDER BY spent DESC`,
    [fid, like, fid],
  );
  const prev = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM txs WHERE family_id = ? AND date LIKE ? AND type = 'expense'`,
    [fid, `${shiftMonth(month, -1)}-%`],
  );
  const planRow = await db.get(
    `SELECT COALESCE(SUM(CASE WHEN done = 0 THEN amount ELSE 0 END), 0) AS left_sum,
            COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END), 0) AS done_n
     FROM plans WHERE family_id = ? AND month = ?`,
    [fid, month],
  );

  const spentBy = new Map();
  const incomeBy = new Map();
  let spent = 0;
  let income = 0;
  for (const r of byCat) {
    const v = Number(r.sum);
    if (r.type === 'expense') { spentBy.set(r.category_id, v); spent += v; }
    else { incomeBy.set(r.category_id, v); income += v; }
  }
  const categories = cats
    .filter((c) => !c.archived || spentBy.has(c.id) || incomeBy.has(c.id))
    .map((c) => ({
      id: c.id, name: c.name, emoji: c.emoji, color: c.color, kind: c.kind,
      limit: Number(c.limit_amount),
      amount: c.kind === 'income' ? incomeBy.get(c.id) || 0 : spentBy.get(c.id) || 0,
    }));
  const uncategorized = spentBy.get(null) || 0;
  if (uncategorized) categories.push({ id: null, name: 'Без категории', emoji: '❔', color: '#64748b', kind: 'expense', limit: 0, amount: uncategorized });

  const limitsSum = cats.filter((c) => c.kind === 'expense' && !c.archived).reduce((s, c) => s + Number(c.limit_amount), 0);
  const budget = Number(family.monthly_budget) || limitsSum;
  const dim = daysInMonth(month);
  const curMonth = monthOf(today);
  const daysLeft = month === curMonth ? dim - Number(today.slice(8, 10)) + 1 : month > curMonth ? dim : 0;
  const remaining = budget - spent;

  const days = [];
  const dayMap = new Map(byDay.map((r) => [`${r.date}|${r.type}`, Number(r.sum)]));
  for (let d = 1; d <= dim; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    days.push({ date, expense: dayMap.get(`${date}|expense`) || 0, income: dayMap.get(`${date}|income`) || 0 });
  }

  return {
    month, budget, spent, income, remaining, daysLeft, daysInMonth: dim,
    perDay: daysLeft > 0 && remaining > 0 ? Math.floor(remaining / daysLeft) : 0,
    prevSpent: Number(prev.s),
    categories, days,
    members: byMember.map((m) => ({ ...m, spent: Number(m.spent) })),
    plans: { total: Number(planRow.total), left: Number(planRow.left_sum), count: Number(planRow.n), done: Number(planRow.done_n) },
  };
}

export async function trend(db, familyId, month, n = 6) {
  const from = shiftMonth(month, -(n - 1));
  const rows = await db.all(
    `SELECT substr(date, 1, 7) AS m, type, SUM(amount) AS sum FROM txs
     WHERE family_id = ? AND date >= ? AND date < ? AND type IN ('expense','income')
     GROUP BY substr(date, 1, 7), type`,
    [familyId, `${from}-01`, `${shiftMonth(month, 1)}-01`],
  );
  const map = new Map(rows.map((r) => [`${r.m}|${r.type}`, Number(r.sum)]));
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = shiftMonth(from, i);
    out.push({ month: m, expense: map.get(`${m}|expense`) || 0, income: map.get(`${m}|income`) || 0 });
  }
  return out;
}

export async function categoryMonthSpent(db, familyId, categoryId, month) {
  const r = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM txs WHERE family_id = ? AND category_id = ? AND type = 'expense' AND date LIKE ?`,
    [familyId, categoryId, `${month}-%`],
  );
  return Number(r.s);
}

export async function monthSpent(db, familyId, month) {
  const r = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM txs WHERE family_id = ? AND type = 'expense' AND date LIKE ?`,
    [familyId, `${month}-%`],
  );
  return Number(r.s);
}
