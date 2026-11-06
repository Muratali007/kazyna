// Разбор свободного текста из Telegram в операции.
import { toMinor, shiftDate } from './finance.js';

const COMMANDS = [
  ['help', /^(\/help|\/start|помощь|help|что умеешь\??|команды)$/],
  ['balance', /^(\/balance|баланс|остаток|сколько осталось\??|сколько денег\??|деньги)$/],
  ['month', /^(\/month|итоги|отч[её]т|статистика|месяц|за месяц)$/],
  ['today', /^(\/today|сегодня|за сегодня)$/],
  ['goals', /^(\/goals|цели|мои цели)$/],
  ['plans', /^(\/plans|\/list|список|покупки|что купить\??|список покупок)$/],
  ['undo', /^(\/undo|отмена|отменить|удали|удалить|отмени)$/],
  ['cats', /^(\/cats|категории)$/],
  ['accounts', /^(\/accounts|сч[её]та|кошельки)$/],
  ['site', /^(\/site|сайт)$/],
];

const NUM = /(^|[^\d\p{L}])([+\-−]?)\s?(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?:\s?(к|k|тыс\.?|тысяч[аи]?|млн|m)(?![\p{L}]))?/u;
const CURRENCY = /(?<![\p{L}])(тг|тенге|₸|руб\.?|р\.|₽|\$|usd|сом)(?![\p{L}])/giu;

export function parseAmount(text) {
  const m = NUM.exec(text);
  if (!m) return null;
  let value = Number(m[3].replace(/[  ]/g, '') + (m[4] ? `.${m[4]}` : ''));
  const suf = (m[5] || '').toLowerCase();
  if (/^(к|k|тыс)/.test(suf)) value *= 1000;
  else if (/^(млн|m)/.test(suf)) value *= 1_000_000;
  const sign = m[2] === '+' ? '+' : m[2] ? '-' : '';
  const start = m.index + m[1].length;
  return { value, sign, start, end: m.index + m[0].length };
}

const words = (s) => s.toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\d]+/u).filter(Boolean);
const stemsOf = (s) => words(s).map((w) => (w.length > 5 ? w.slice(0, Math.max(4, w.length - 2)) : w));

function wordMatches(word, stem) {
  if (stem.length < 2) return false;
  if (word === stem) return true;
  if (stem.length >= 3 && word.startsWith(stem)) return true;
  return word.length >= 4 && stem.startsWith(word);
}

function score(textWords, stems) {
  let best = 0;
  for (const st of stems) for (const w of textWords) if (wordMatches(w, st)) best = Math.max(best, st.length);
  return best;
}

export function matchCategory(text, categories, kind) {
  const tw = words(text);
  let best = null;
  let bestScore = 0;
  for (const c of categories) {
    if (c.kind !== kind || c.archived) continue;
    const stems = [...stemsOf(c.name), ...words(c.keywords || '')];
    const s = score(tw, stems);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return best;
}

const fallbackCategory = (categories, kind) => {
  const live = categories.filter((c) => c.kind === kind && !c.archived);
  return live.find((c) => /^(другое|прочий доход|прочее)$/i.test(c.name)) || live[live.length - 1] || null;
};

const KIND_WORDS = {
  cash: ['налом', 'налич', 'наличк', 'кешем', 'кэшем', 'наликом'],
  card: ['карт', 'kaspi', 'каспи', 'безнал', 'халык', 'halyk', 'jusan', 'freedom'],
  deposit: ['депозит', 'вклад', 'копилк', 'сбережен'],
};

function matchAccount(text, accounts, { exclude } = {}) {
  const tw = words(text);
  let best = null;
  let bestScore = 0;
  for (const a of accounts) {
    if (a.archived || a.id === exclude) continue;
    const stems = [...stemsOf(a.name), ...(KIND_WORDS[a.kind] || [])];
    let s = score(tw, stems);
    if (a.kind === 'cash' && tw.some((w) => ['нал', 'кеш', 'кэш', 'кэшем'].includes(w))) s = Math.max(s, 3);
    if (s > bestScore) { best = a; bestScore = s; }
  }
  return best;
}

function parseDate(text, today) {
  const t = text.toLowerCase();
  if (/(^|\s)позавчера(\s|$)/.test(t)) return shiftDate(today, -2);
  if (/(^|\s)вчера(\s|$)/.test(t)) return shiftDate(today, -1);
  const m = /(^|\s)(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(\s|$)/.exec(t);
  if (m) {
    const y = m[4] ? (m[4].length === 2 ? `20${m[4]}` : m[4]) : today.slice(0, 4);
    const d = `${y}-${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(d))) return d;
  }
  return today;
}

const stripDateWords = (s) => s.replace(/(^|\s)(позавчера|вчера|сегодня)(?=\s|$)/gi, ' ').replace(/(^|\s)\d{1,2}\.\d{1,2}(\.\d{2,4})?(?=\s|$)/g, ' ');

const clean = (s) => s.replace(CURRENCY, ' ').replace(/\s+/g, ' ').replace(/^[\s,.:;—-]+|[\s,.:;—-]+$/g, '').trim();

function findGoal(name, goals) {
  const tw = words(name);
  let best = null;
  let bestScore = 0;
  for (const g of goals) {
    if (g.done) continue;
    const s = score(tw, stemsOf(g.title));
    if (s > bestScore) { best = g; bestScore = s; }
  }
  return best;
}

/**
 * @returns {{kind:'command', cmd:string} | {kind:'plan', title:string, amount:number} |
 *           {kind:'txs', items:object[]} | {kind:'error', message:string} | {kind:'unknown'}}
 */
export function parseMessage(raw, { categories = [], accounts = [], goals = [], today }) {
  const text = String(raw || '').trim().replace(/@\w+bot\b/i, '').trim();
  if (!text) return { kind: 'unknown' };
  const lower = text.toLowerCase().replace(/ё/g, 'е');
  for (const [cmd, re] of COMMANDS) if (re.test(lower)) return { kind: 'command', cmd };

  const planMatch = /^(?:\/buy|нужно купить|надо купить|купить|в список|список)\s*[:\-—]?\s*(.+)$/is.exec(text);
  if (planMatch) {
    const body = planMatch[1];
    const amt = parseAmount(body);
    const title = clean(amt ? body.slice(0, amt.start) + ' ' + body.slice(amt.end) : body);
    if (!title) return { kind: 'error', message: 'Напишите, что купить: «купить пылесос 80000»' };
    return { kind: 'plan', title, amount: amt ? toMinor(amt.value) : 0 };
  }

  const lines = text.split(/\n|;/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  const defaultAcc = accounts.find((a) => a.is_default && !a.archived) || accounts.find((a) => !a.archived && a.kind !== 'deposit') || accounts[0];
  const depositAcc = accounts.find((a) => !a.archived && (a.kind === 'deposit' || a.kind === 'savings'));

  for (const line of lines) {
    const date = parseDate(line, today);
    const body = stripDateWords(line).trim(); // дата «05.11» не должна стать суммой
    const amt = parseAmount(body);
    if (!amt || amt.value <= 0) {
      if (lines.length === 1) return { kind: 'unknown' };
      continue;
    }
    const rest = clean(body.slice(0, amt.start) + ' ' + body.slice(amt.end));
    const l = rest.toLowerCase().replace(/ё/g, 'е');
    const amount = toMinor(amt.value);
    const base = { amount, date, note: rest };

    // Цели: «цель машина 20000», «в цель машина», «из цели машина 5000»
    const goalM = /(?:^|\s)(из|с|в|на)?\s*цел[иья]\s+(.+)$/i.exec(l) || /^(из|с|в|на)?\s*цел[иья]$/i.exec(l);
    if (goalM) {
      const goal = goalM[2] ? findGoal(goalM[2], goals) : goals.find((g) => !g.done);
      if (!goal) return { kind: 'error', message: `Не нашёл цель «${goalM[2] || ''}». Создайте её на сайте или напишите /goals` };
      const out = /^(из|с)$/i.test(goalM[1] || '');
      const acc = matchAccount(l.replace(/цел[иья].*/i, ''), accounts) || defaultAcc;
      items.push(out
        ? { ...base, type: 'goal_out', goalId: goal.id, toAccountId: acc?.id, note: rest }
        : { ...base, type: 'goal', goalId: goal.id, accountId: acc?.id, note: rest });
      continue;
    }

    // Переводы: снять/положить на депозит, снял наличные, «с карты на наличные»
    const fromTo = /(?:^|\s)с\s+(\S+(?:\s\S+)?)\s+(?:на|в)\s+(\S+(?:\s\S+)?)/i.exec(l);
    const toDeposit = /(в|на)\s+(депозит|вклад|копилк)|(^|\s)(отложил[аи]?|положил[аи]? на депозит|пополнил[аи]? депозит|депозит|накопил[аи]?)(\s|$)/i.test(l);
    const fromDeposit = /(с|из)\s+(депозит|вклад|копилк)|снял[аи]? с депозит/i.test(l);
    const withdrawCash = /(^|\s)(снял[аи]?|снять|обналичил[аи]?)(\s+наличн\S*|\s+нал\S*|\s+кеш|\s+кэш)?(\s|$)/i.test(l) && !fromDeposit;
    if (fromTo || toDeposit || fromDeposit || withdrawCash) {
      let from, to;
      if (fromTo) {
        from = matchAccount(fromTo[1], accounts);
        to = matchAccount(fromTo[2], accounts, { exclude: from?.id });
      } else if (fromDeposit) {
        from = depositAcc;
        to = matchAccount(l.replace(/депозит\S*|вклад\S*|копилк\S*/gi, ''), accounts, { exclude: depositAcc?.id }) || defaultAcc;
      } else if (toDeposit) {
        to = depositAcc;
        from = matchAccount(l.replace(/депозит\S*|вклад\S*|копилк\S*/gi, ''), accounts, { exclude: depositAcc?.id }) || defaultAcc;
      } else {
        to = accounts.find((a) => a.kind === 'cash' && !a.archived);
        from = defaultAcc?.id !== to?.id ? defaultAcc : accounts.find((a) => a.kind === 'card' && !a.archived);
      }
      if (!from || !to || from.id === to.id) {
        if (toDeposit || fromDeposit) return { kind: 'error', message: 'Нет счёта-депозита. Добавьте его на сайте в разделе «Счета».' };
      } else {
        items.push({ ...base, type: 'transfer', accountId: from.id, toAccountId: to.id });
        continue;
      }
    }

    const incomeWords = /(^|\s)(доход|получил[аи]?|пришл[оа]|заработал[аи]?|зачислен\S*|поступлен\S*|вернули|подарили)(\s|$)/i.test(l);
    let type = amt.sign === '+' ? 'income' : 'expense';
    let cat = null;
    if (type === 'expense' && amt.sign !== '-') {
      const incCat = matchCategory(l, categories, 'income');
      const expCat = matchCategory(l, categories, 'expense');
      if (incomeWords || (incCat && !expCat)) { type = 'income'; cat = incCat; }
      else cat = expCat;
    } else {
      cat = matchCategory(l, categories, type);
    }
    cat = cat || fallbackCategory(categories, type);
    const acc = matchAccount(l, accounts) || defaultAcc;
    items.push({ ...base, type, categoryId: cat?.id ?? null, accountId: acc?.id ?? null });
  }
  return items.length ? { kind: 'txs', items } : { kind: 'unknown' };
}
