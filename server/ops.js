// Общая бизнес-логика для сайта и Telegram-бота.
import {
  localDate, isDate, monthOf, fmtMoney, categoryMonthSpent, monthSpent, monthSummary, totals,
} from './finance.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const TX_TYPES = ['expense', 'income', 'transfer', 'goal', 'goal_out'];
export const MAX_AMOUNT = 100_000_000_000_00; // 100 млрд в копейках

export async function loadCtx(db, familyId) {
  const [categories, accounts, goals] = await Promise.all([
    db.all('SELECT * FROM categories WHERE family_id = ? ORDER BY sort, id', [familyId]),
    db.all('SELECT * FROM accounts WHERE family_id = ? ORDER BY is_default DESC, id', [familyId]),
    db.all('SELECT * FROM goals WHERE family_id = ? ORDER BY id', [familyId]),
  ]);
  return { categories, accounts, goals };
}

const nullable = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/** Проверяет и нормализует операцию. Все суммы — в копейках. */
export async function validateTx(db, familyId, input) {
  const type = input.type;
  if (!TX_TYPES.includes(type)) throw new HttpError(400, 'Неизвестный тип операции');
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new HttpError(400, 'Сумма должна быть больше нуля');
  const date = input.date || localDate();
  if (!isDate(date)) throw new HttpError(400, 'Неверная дата');
  const note = input.note == null ? null : String(input.note).slice(0, 300).trim() || null;
  const ctx = await loadCtx(db, familyId);
  const acc = (id, label) => {
    if (id == null) throw new HttpError(400, `Укажите ${label}`);
    const a = ctx.accounts.find((x) => x.id === id);
    if (!a) throw new HttpError(400, `Счёт не найден`);
    return a;
  };
  let accountId = nullable(input.accountId);
  let toAccountId = nullable(input.toAccountId);
  let categoryId = nullable(input.categoryId);
  let goalId = nullable(input.goalId);
  const defaultAcc = ctx.accounts.find((a) => a.is_default && !a.archived) || ctx.accounts.find((a) => !a.archived);

  if (type === 'expense' || type === 'income') {
    accountId = acc(accountId ?? defaultAcc?.id, 'счёт').id;
    if (categoryId != null) {
      const c = ctx.categories.find((x) => x.id === categoryId);
      if (!c) throw new HttpError(400, 'Категория не найдена');
      if (c.kind !== type) throw new HttpError(400, type === 'expense' ? 'Это категория доходов' : 'Это категория расходов');
    }
    toAccountId = null; goalId = null;
  } else if (type === 'transfer') {
    accountId = acc(accountId, 'счёт списания').id;
    toAccountId = acc(toAccountId, 'счёт зачисления').id;
    if (accountId === toAccountId) throw new HttpError(400, 'Счета должны различаться');
    categoryId = null; goalId = null;
  } else {
    const g = ctx.goals.find((x) => x.id === goalId);
    if (!g) throw new HttpError(400, 'Цель не найдена');
    if (type === 'goal') { accountId = acc(accountId ?? defaultAcc?.id, 'счёт').id; toAccountId = null; }
    else { toAccountId = acc(toAccountId ?? defaultAcc?.id, 'счёт').id; accountId = null; }
    categoryId = null;
  }
  return { type, amount, date, note, accountId, toAccountId, categoryId, goalId, ctx };
}

export async function insertTx(db, familyId, userId, v, source = 'web') {
  const { row } = await db.run(
    `INSERT INTO txs (family_id, user_id, type, amount, account_id, to_account_id, category_id, goal_id, note, date, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    [familyId, userId, v.type, v.amount, v.accountId, v.toAccountId, v.categoryId, v.goalId, v.note, v.date, source, new Date().toISOString()],
  );
  return row;
}

/** Предупреждения о лимитах, которые пересекла новая трата. */
export async function budgetAlerts(db, family, tx) {
  if (tx.type !== 'expense') return [];
  const out = [];
  const month = monthOf(tx.date);
  const cur = family.currency;
  if (tx.category_id) {
    const cat = await db.get('SELECT * FROM categories WHERE id = ?', [tx.category_id]);
    const limit = Number(cat?.limit_amount || 0);
    if (limit > 0) {
      const after = await categoryMonthSpent(db, family.id, cat.id, month);
      const before = after - Number(tx.amount);
      if (before <= limit && after > limit) out.push(`🚨 Лимит «${cat.emoji || ''} ${cat.name}» превышен: ${fmtMoney(after, cur)} из ${fmtMoney(limit, cur)}`);
      else if (before < limit * 0.8 && after >= limit * 0.8) out.push(`⚠️ «${cat.emoji || ''} ${cat.name}»: потрачено ${Math.round((after / limit) * 100)}% лимита (${fmtMoney(limit - after, cur)} осталось)`);
    }
  }
  const s = await monthSummary(db, family, month);
  if (s.budget > 0) {
    const before = s.spent - Number(tx.amount);
    if (before <= s.budget && s.spent > s.budget) out.push(`🚨 Бюджет месяца превышен на ${fmtMoney(s.spent - s.budget, cur)}`);
    else if (before < s.budget * 0.9 && s.spent >= s.budget * 0.9) out.push(`⚠️ Израсходовано ${Math.round((s.spent / s.budget) * 100)}% бюджета месяца`);
  }
  return out;
}

export function describeTx(tx, ctx, currency) {
  const cat = ctx.categories.find((c) => c.id === tx.category_id);
  const acc = ctx.accounts.find((a) => a.id === tx.account_id);
  const to = ctx.accounts.find((a) => a.id === tx.to_account_id);
  const goal = ctx.goals.find((g) => g.id === tx.goal_id);
  const m = fmtMoney(tx.amount, currency);
  switch (tx.type) {
    case 'expense': return { head: `−${m}`, what: `${cat?.emoji || '📦'} ${cat?.name || 'Без категории'}`, where: acc ? `${acc.emoji || ''} ${acc.name}`.trim() : '' };
    case 'income': return { head: `+${m}`, what: `${cat?.emoji || '💵'} ${cat?.name || 'Доход'}`, where: acc ? `${acc.emoji || ''} ${acc.name}`.trim() : '' };
    case 'transfer': return { head: `↔️ ${m}`, what: `${acc?.emoji || ''} ${acc?.name || '?'} → ${to?.emoji || ''} ${to?.name || '?'}`.replace(/\s+/g, ' ').trim(), where: '' };
    case 'goal': return { head: `🎯 ${m}`, what: `в цель «${goal?.title || '?'}»`, where: acc?.name || '' };
    case 'goal_out': return { head: `🎯 −${m}`, what: `из цели «${goal?.title || '?'}»`, where: to?.name || '' };
    default: return { head: m, what: '', where: '' };
  }
}

export async function remainingLine(db, family) {
  const s = await monthSummary(db, family, monthOf(localDate()));
  const cur = family.currency;
  if (s.budget > 0) {
    if (s.remaining >= 0) return `Осталось на месяц: ${fmtMoney(s.remaining, cur)}${s.perDay ? ` (≈${fmtMoney(s.perDay, cur)}/день)` : ''}`;
    return `Бюджет превышен на ${fmtMoney(-s.remaining, cur)}`;
  }
  const t = await totals(db, family.id);
  return `Потрачено за месяц: ${fmtMoney(s.spent, cur)} · доступно ${fmtMoney(t.available, cur)}`;
}

export { monthSpent };
