// Telegram-бот на чистом Bot API (без библиотек). Webhook в проде, long polling локально.
import crypto from 'node:crypto';
import { parseMessage, matchCategory } from './parser.js';
import { fmtMoney, localDate, monthOf, monthSummary, totals, fromMinor } from './finance.js';
import { loadCtx, validateTx, insertTx, budgetAlerts, describeTx, remainingLine, HttpError } from './ops.js';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bar = (part, whole, n = 10) => {
  const k = whole > 0 ? Math.min(n, Math.round((part / whole) * n)) : 0;
  return '▰'.repeat(k) + '▱'.repeat(n - k);
};

export const HELP = (site) => `<b>Как пользоваться</b>

Просто пишите трату — я сам пойму категорию:
• <code>продукты 5400</code>
• <code>такси 1 500</code>, <code>кофе 1200 налом</code>
• <code>вчера аптека 3400</code>
• несколько строк — несколько операций

Доходы: <code>+300000 зарплата</code> или <code>зп 450к</code>
Депозит: <code>в депозит 50000</code>, <code>с депозита 20000</code>
Перевод: <code>с карты на наличные 10000</code>
Цели: <code>цель машина 20000</code>, <code>из цели отпуск 5000</code>
Список покупок: <code>купить пылесос 80000</code>

/balance — сколько денег и сколько осталось
/month — итоги месяца по категориям
/today — траты за сегодня
/goals — цели · /plans — покупки на месяц
/undo — отменить последнюю операцию
${site ? `\n🌐 Сайт: ${site}` : ''}`;

export function createBot({ db, token, publicUrl, apiBase = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org', log = console }) {
  const enabled = Boolean(token);
  const webhookSecret = token ? crypto.createHash('sha256').update(`wh:${token}`).digest('hex').slice(0, 48) : '';
  const bot = { enabled, username: process.env.TELEGRAM_BOT_USERNAME || null, webhookSecret, mode: 'off' };
  let polling = false;
  let pollAbort = null;

  async function call(method, { __signal, ...body } = {}) {
    if (!enabled) return null;
    const res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: __signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
    return data.result;
  }
  bot.call = call;

  const send = (chatId, text, extra = {}) =>
    call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }).catch((e) => log.warn(e.message));

  async function userByTg(tgId) {
    return db.get('SELECT * FROM users WHERE tg_user_id = ?', [String(tgId)]);
  }
  const familyOf = (u) => db.get('SELECT * FROM families WHERE id = ?', [u.family_id]);

  /** Уведомить членов семьи в личке (кроме автора). */
  bot.notifyFamily = async (familyId, exceptUserId, text) => {
    if (!enabled) return;
    const members = await db.all('SELECT tg_user_id FROM users WHERE family_id = ? AND id <> ? AND tg_user_id IS NOT NULL AND tg_notify = 1', [familyId, exceptUserId ?? -1]);
    await Promise.all(members.map((m) => send(m.tg_user_id, text)));
  };

  bot.txNotice = async (family, user, tx, { skipNotify = false } = {}) => {
    const ctx = await loadCtx(db, family.id);
    const d = describeTx(tx, ctx, family.currency);
    const alerts = await budgetAlerts(db, family, tx);
    if (!skipNotify) {
      const text = `👤 <b>${esc(user.name)}</b>: ${esc(d.head)} · ${esc(d.what)}${tx.note ? `\n<i>${esc(tx.note)}</i>` : ''}${alerts.length ? `\n\n${alerts.map(esc).join('\n')}` : ''}`;
      await bot.notifyFamily(family.id, user.id, text);
    }
    return alerts;
  };

  function categoryKeyboard(ctx, txId, kind) {
    const cats = ctx.categories.filter((c) => c.kind === kind && !c.archived);
    const rows = [];
    for (let i = 0; i < cats.length; i += 2) {
      rows.push(cats.slice(i, i + 2).map((c) => ({ text: `${c.emoji || ''} ${c.name}`.trim(), callback_data: `s:${txId}:${c.id}` })));
    }
    rows.push([{ text: '« Назад', callback_data: `b:${txId}` }]);
    return { inline_keyboard: rows };
  }
  const txKeyboard = (ids, single) => ({
    inline_keyboard: [[
      ...(single ? [{ text: '🏷 Категория', callback_data: `c:${ids[0]}` }] : []),
      { text: '↩️ Отменить', callback_data: `u:${ids.join(',')}` },
    ]],
  });

  async function txReply(family, txs, ctx) {
    const lines = txs.map((tx) => {
      const d = describeTx(tx, ctx, family.currency);
      return `✅ <b>${esc(d.head)}</b> · ${esc(d.what)}${d.where ? `\n<i>${esc(d.where)}${tx.note ? ` · ${esc(tx.note)}` : ''}${tx.date !== localDate() ? ` · ${tx.date.split('-').reverse().join('.')}` : ''}</i>` : ''}`;
    });
    return `${lines.join('\n\n')}\n\n${esc(await remainingLine(db, family))}`;
  }

  async function balanceText(family) {
    const t = await totals(db, family.id);
    const cur = family.currency;
    const s = await monthSummary(db, family, monthOf(localDate()));
    const accs = t.accounts.filter((a) => !a.archived).map((a) => `${a.emoji || '•'} ${esc(a.name)}: <b>${fmtMoney(a.balance, cur)}</b>`);
    const mName = MONTHS[Number(s.month.slice(5)) - 1];
    let txt = `💰 <b>${esc(family.name)}</b>\n\n${accs.join('\n')}\n\n💵 Доступно: <b>${fmtMoney(t.available, cur)}</b>\n🏦 На депозите: <b>${fmtMoney(t.deposit, cur)}</b>\n🎯 В целях: <b>${fmtMoney(t.inGoals, cur)}</b>\n📊 Всего: <b>${fmtMoney(t.net, cur)}</b>\n\n📅 <b>${mName[0].toUpperCase() + mName.slice(1)}</b>: потрачено ${fmtMoney(s.spent, cur)}`;
    if (s.budget > 0) {
      txt += ` из ${fmtMoney(s.budget, cur)}\n${bar(s.spent, s.budget)} ${Math.round((s.spent / s.budget) * 100)}%\n`;
      txt += s.remaining >= 0 ? `Осталось <b>${fmtMoney(s.remaining, cur)}</b> на ${s.daysLeft} дн. (≈${fmtMoney(s.perDay, cur)}/день)` : `🚨 Превышение: <b>${fmtMoney(-s.remaining, cur)}</b>`;
    }
    if (s.income) txt += `\nДоходы: +${fmtMoney(s.income, cur)}`;
    if (s.plans.left) txt += `\n🛍 Запланировано покупок: ${fmtMoney(s.plans.left, cur)}`;
    return txt;
  }

  async function monthText(family) {
    const s = await monthSummary(db, family, monthOf(localDate()));
    const cur = family.currency;
    const exp = s.categories.filter((c) => c.kind === 'expense' && c.amount > 0).sort((a, b) => b.amount - a.amount);
    const mName = MONTHS[Number(s.month.slice(5)) - 1];
    let txt = `📊 <b>Итоги: ${mName}</b>\n\nРасходы: <b>${fmtMoney(s.spent, cur)}</b>${s.prevSpent ? ` (прошлый месяц ${fmtMoney(s.prevSpent, cur)})` : ''}\nДоходы: <b>${fmtMoney(s.income, cur)}</b>\nБаланс месяца: <b>${s.income - s.spent >= 0 ? '+' : '−'}${fmtMoney(Math.abs(s.income - s.spent), cur)}</b>\n`;
    if (exp.length) {
      txt += '\n' + exp.map((c) => {
        const lim = c.limit ? ` / ${fmtMoney(c.limit, cur)}${c.amount > c.limit ? ' 🚨' : ''}` : '';
        return `${c.emoji || '•'} ${esc(c.name)} — <b>${fmtMoney(c.amount, cur)}</b>${lim}\n${bar(c.amount, s.spent)} ${Math.round((c.amount / s.spent) * 100)}%`;
      }).join('\n');
    } else txt += '\nПока трат нет.';
    const mem = s.members.filter((m) => m.spent > 0);
    if (mem.length > 1) txt += `\n\n👨‍👩‍👧 Кто сколько:\n${mem.map((m) => `${esc(m.name)} — ${fmtMoney(m.spent, cur)}`).join('\n')}`;
    return txt;
  }

  async function todayText(family) {
    const today = localDate();
    const rows = await db.all(
      `SELECT t.*, u.name AS user_name FROM txs t LEFT JOIN users u ON u.id = t.user_id
       WHERE t.family_id = ? AND t.date = ? ORDER BY t.id`, [family.id, today]);
    if (!rows.length) return 'Сегодня операций не было 🙂';
    const ctx = await loadCtx(db, family.id);
    const spent = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
    return `📅 <b>Сегодня</b> · потрачено ${fmtMoney(spent, family.currency)}\n\n${rows.map((r) => {
      const d = describeTx(r, ctx, family.currency);
      return `${esc(d.head)} · ${esc(d.what)}${r.note ? ` · <i>${esc(r.note)}</i>` : ''} — ${esc(r.user_name || '')}`;
    }).join('\n')}`;
  }

  async function goalsText(family) {
    const t = await totals(db, family.id);
    if (!t.goals.length) return 'Целей пока нет. Создайте их на сайте 🎯';
    return `🎯 <b>Цели</b>\n\n${t.goals.map((g) => {
      const pct = g.target ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
      return `${g.emoji || '🎯'} <b>${esc(g.title)}</b>${g.done ? ' ✅' : ''}\n${bar(g.saved, g.target)} ${pct}%\n${fmtMoney(g.saved, family.currency)} из ${fmtMoney(g.target, family.currency)}${g.deadline ? ` · до ${g.deadline.split('-').reverse().join('.')}` : ''}`;
    }).join('\n\n')}\n\nПополнить: <code>цель ${esc(t.goals.find((g) => !g.done)?.title?.toLowerCase() || 'машина')} 20000</code>`;
  }

  async function plansMessage(family) {
    const month = monthOf(localDate());
    const rows = await db.all('SELECT * FROM plans WHERE family_id = ? AND month = ? ORDER BY done, id', [family.id, month]);
    if (!rows.length) return { text: '🛍 Список покупок на месяц пуст.\nДобавить: <code>купить пылесос 80000</code>' };
    const left = rows.filter((r) => !r.done);
    const sum = left.reduce((s, r) => s + Number(r.amount), 0);
    const text = `🛍 <b>Покупки на месяц</b>\n\n${rows.map((r) => `${r.done ? '✅' : '▫️'} ${r.done ? `<s>${esc(r.title)}</s>` : esc(r.title)}${Number(r.amount) ? ` — ${fmtMoney(r.amount, family.currency)}` : ''}`).join('\n')}\n\nОсталось купить: <b>${fmtMoney(sum, family.currency)}</b>`;
    const kb = left.slice(0, 10).map((r) => [{ text: `✅ Купили: ${r.title}`.slice(0, 60), callback_data: `p:${r.id}` }]);
    return { text, extra: kb.length ? { reply_markup: { inline_keyboard: kb } } : {} };
  }

  async function linkAccount(msg, code) {
    const row = await db.get('SELECT * FROM tg_links WHERE code = ?', [code]);
    if (!row || row.expires_at < new Date().toISOString()) {
      return send(msg.chat.id, 'Ссылка устарела. Откройте сайт → «Семья» → «Привязать Telegram» ещё раз.');
    }
    const tgId = String(msg.from.id);
    await db.run('UPDATE users SET tg_user_id = NULL WHERE tg_user_id = ?', [tgId]);
    await db.run('UPDATE users SET tg_user_id = ?, tg_username = ? WHERE id = ?', [tgId, msg.from.username || null, row.user_id]);
    await db.run('DELETE FROM tg_links WHERE user_id = ?', [row.user_id]);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [row.user_id]);
    const fam = await familyOf(user);
    await send(msg.chat.id, `🎉 Готово, ${esc(user.name)}! Telegram привязан к семье «${esc(fam.name)}».\n\n${HELP(publicUrl)}`);
  }

  async function handleMessage(msg) {
    const text = (msg.text || msg.caption || '').trim();
    const chatId = msg.chat.id;
    const isGroup = msg.chat.type !== 'private';
    if (!text || !msg.from || msg.from.is_bot) return;

    const start = /^\/start(?:@\w+)?\s+(\S+)/.exec(text);
    if (start) return linkAccount(msg, start[1]);

    const user = await userByTg(msg.from.id);
    if (!user) {
      if (isGroup && !/^\//.test(text)) return;
      return send(chatId, `👋 Привет! Я веду семейный бюджет.\n\nЧтобы начать, зарегистрируйтесь на сайте${publicUrl ? `: ${publicUrl}` : ''} и нажмите «Привязать Telegram» в разделе «Семья».`);
    }
    const family = await familyOf(user);
    if (!family) return send(chatId, 'Вы пока не состоите в семье. Откройте сайт, чтобы создать или вступить.');
    const ctx = await loadCtx(db, family.id);
    const reply = isGroup ? { reply_to_message_id: msg.message_id } : {};
    const parsed = parseMessage(text, { ...ctx, today: localDate() });

    if (parsed.kind === 'command') {
      switch (parsed.cmd) {
        case 'help': return send(chatId, HELP(publicUrl), reply);
        case 'balance': return send(chatId, await balanceText(family), reply);
        case 'month': return send(chatId, await monthText(family), reply);
        case 'today': return send(chatId, await todayText(family), reply);
        case 'goals': return send(chatId, await goalsText(family), reply);
        case 'site': return send(chatId, publicUrl ? `🌐 ${publicUrl}` : 'Адрес сайта не настроен', reply);
        case 'plans': {
          const p = await plansMessage(family);
          return send(chatId, p.text, { ...reply, ...p.extra });
        }
        case 'cats': {
          const c = (kind) => ctx.categories.filter((x) => x.kind === kind && !x.archived).map((x) => `${x.emoji || '•'} ${esc(x.name)}${Number(x.limit_amount) ? ` (лимит ${fmtMoney(x.limit_amount, family.currency)})` : ''}`).join('\n');
          return send(chatId, `<b>Расходы</b>\n${c('expense')}\n\n<b>Доходы</b>\n${c('income')}`, reply);
        }
        case 'accounts': return send(chatId, await balanceText(family), reply);
        case 'undo': {
          const last = await db.get('SELECT * FROM txs WHERE user_id = ? AND family_id = ? ORDER BY id DESC LIMIT 1', [user.id, family.id]);
          if (!last) return send(chatId, 'Нечего отменять', reply);
          await db.run('DELETE FROM txs WHERE id = ?', [last.id]);
          await db.run('UPDATE plans SET done = 0, tx_id = NULL WHERE tx_id = ?', [last.id]);
          const d = describeTx(last, ctx, family.currency);
          return send(chatId, `↩️ Отменено: ${esc(d.head)} · ${esc(d.what)}\n\n${esc(await remainingLine(db, family))}`, reply);
        }
        default: return;
      }
    }
    if (parsed.kind === 'error') return send(chatId, esc(parsed.message), reply);
    if (parsed.kind === 'plan') {
      const cat = matchCategory(parsed.title, ctx.categories, 'expense');
      await db.run('INSERT INTO plans (family_id, title, amount, month, category_id, created_by, created_at) VALUES (?,?,?,?,?,?,?)', [
        family.id, parsed.title.slice(0, 120), parsed.amount, monthOf(localDate()), cat?.id ?? null, user.id, new Date().toISOString(),
      ]);
      const s = await monthSummary(db, family, monthOf(localDate()));
      const after = s.budget ? `\nПосле всех покупок останется: ${fmtMoney(s.remaining - s.plans.left, family.currency)}` : '';
      if (!isGroup) await bot.notifyFamily(family.id, user.id, `🛍 <b>${esc(user.name)}</b> добавил(а) в покупки: ${esc(parsed.title)}${parsed.amount ? ` — ${fmtMoney(parsed.amount, family.currency)}` : ''}`);
      return send(chatId, `🛍 Добавил в список покупок: <b>${esc(parsed.title)}</b>${parsed.amount ? ` — ${fmtMoney(parsed.amount, family.currency)}` : ''}\nВсего запланировано: ${fmtMoney(s.plans.left, family.currency)}${after}`, reply);
    }
    if (parsed.kind === 'unknown') {
      if (isGroup) return;
      return send(chatId, 'Не понял 🤔 Напишите сумму и на что: <code>продукты 5000</code>\nИли /help — все команды.');
    }

    const created = [];
    try {
      await db.tx(async (t) => {
        for (const it of parsed.items) {
          const v = await validateTx(t, family.id, it);
          created.push(await insertTx(t, family.id, user.id, v, 'telegram'));
        }
      });
    } catch (e) {
      if (e instanceof HttpError) return send(chatId, `⚠️ ${esc(e.message)}`, reply);
      throw e;
    }
    const alerts = [];
    for (const tx of created) alerts.push(...(await bot.txNotice(family, user, tx, { skipNotify: isGroup })));
    const body = await txReply(family, created, ctx);
    return send(chatId, body + (alerts.length ? `\n\n${alerts.map(esc).join('\n')}` : ''), {
      ...reply,
      reply_markup: txKeyboard(created.map((t) => t.id), created.length === 1 && ['expense', 'income'].includes(created[0].type)),
    });
  }

  async function handleCallback(cq) {
    const answer = (text) => call('answerCallbackQuery', { callback_query_id: cq.id, text }).catch(() => {});
    const user = await userByTg(cq.from.id);
    if (!user) return answer('Сначала привяжите Telegram на сайте');
    const family = await familyOf(user);
    const ctx = await loadCtx(db, family.id);
    const msg = cq.message;
    const edit = (text, markup) => call('editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(markup ? { reply_markup: markup } : {}),
    }).catch((e) => log.warn(e.message));
    const [kind, a, b] = String(cq.data || '').split(':');
    const getTx = async (id) => db.get('SELECT * FROM txs WHERE id = ? AND family_id = ?', [Number(id), family.id]);

    if (kind === 'u') {
      const ids = a.split(',').map(Number).filter(Boolean);
      let n = 0;
      for (const id of ids) {
        const tx = await getTx(id);
        if (!tx) continue;
        await db.run('DELETE FROM txs WHERE id = ?', [id]);
        await db.run('UPDATE plans SET done = 0, tx_id = NULL WHERE tx_id = ?', [id]);
        n++;
      }
      await edit(`↩️ <s>${esc(msg.text || '')}</s>\n\nОтменено${n > 1 ? ` (${n})` : ''}. ${esc(await remainingLine(db, family))}`.slice(0, 4000));
      return answer('Отменено');
    }
    if (kind === 'c' || kind === 'b') {
      const tx = await getTx(a);
      if (!tx) return answer('Операция не найдена');
      if (kind === 'c') await call('editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: categoryKeyboard(ctx, tx.id, tx.type) }).catch(() => {});
      else await call('editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: txKeyboard([tx.id], true) }).catch(() => {});
      return answer();
    }
    if (kind === 's') {
      const tx = await getTx(a);
      const cat = ctx.categories.find((c) => c.id === Number(b));
      if (!tx || !cat || cat.kind !== tx.type) return answer('Не получилось');
      await db.run('UPDATE txs SET category_id = ? WHERE id = ?', [cat.id, tx.id]);
      const upd = await getTx(tx.id);
      await edit(await txReply(family, [upd], ctx), txKeyboard([tx.id], true));
      return answer(`${cat.emoji || ''} ${cat.name}`);
    }
    if (kind === 'p') {
      const plan = await db.get('SELECT * FROM plans WHERE id = ? AND family_id = ?', [Number(a), family.id]);
      if (!plan || plan.done) return answer('Уже отмечено');
      let txId = null;
      if (Number(plan.amount) > 0) {
        const v = await validateTx(db, family.id, { type: 'expense', amount: Number(plan.amount), categoryId: plan.category_id, note: plan.title });
        const tx = await insertTx(db, family.id, user.id, v, 'telegram');
        txId = tx.id;
        await bot.txNotice(family, user, tx, { skipNotify: msg.chat.type !== 'private' });
      }
      await db.run('UPDATE plans SET done = 1, tx_id = ? WHERE id = ?', [txId, plan.id]);
      const p = await plansMessage(family);
      await edit(p.text, p.extra.reply_markup || { inline_keyboard: [] });
      return answer(txId ? `Записал трату ${fromMinor(plan.amount)} ${family.currency}` : 'Отмечено');
    }
    return answer();
  }

  bot.handleUpdate = async (update) => {
    try {
      if (update.message) await handleMessage(update.message);
      else if (update.callback_query) await handleCallback(update.callback_query);
    } catch (e) {
      log.error('bot update failed:', e);
      const chatId = update.message?.chat?.id;
      if (chatId) await send(chatId, '😵 Что-то пошло не так. Попробуйте ещё раз.');
    }
  };

  bot.deepLink = (code) => (bot.username ? `https://t.me/${bot.username}?start=${code}` : null);

  bot.start = async () => {
    if (!enabled) { log.log('[bot] TELEGRAM_BOT_TOKEN не задан — бот выключен'); return; }
    try {
      const me = await call('getMe');
      bot.username = me.username;
      await call('setMyCommands', {
        commands: [
          { command: 'balance', description: 'Сколько денег и сколько осталось' },
          { command: 'month', description: 'Итоги месяца' },
          { command: 'today', description: 'Траты за сегодня' },
          { command: 'goals', description: 'Цели' },
          { command: 'plans', description: 'Покупки на месяц' },
          { command: 'undo', description: 'Отменить последнюю операцию' },
          { command: 'help', description: 'Как пользоваться' },
        ],
      }).catch(() => {});
      if (publicUrl && process.env.TELEGRAM_MODE !== 'polling') {
        await call('setWebhook', { url: `${publicUrl}/tg/webhook`, secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
        bot.mode = 'webhook';
        log.log(`[bot] @${bot.username} · webhook ${publicUrl}/tg/webhook`);
      } else {
        await call('deleteWebhook', {});
        bot.mode = 'polling';
        log.log(`[bot] @${bot.username} · long polling`);
        poll();
      }
    } catch (e) {
      log.error('[bot] не удалось запустить:', e.message);
    }
  };

  async function poll() {
    polling = true;
    let offset = 0;
    while (polling) {
      try {
        pollAbort = new AbortController();
        const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'], __signal: pollAbort.signal });
        for (const u of updates || []) {
          offset = u.update_id + 1;
          await bot.handleUpdate(u);
        }
      } catch (e) {
        if (!polling) break;
        log.warn('[bot] polling:', e.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  bot.stop = () => {
    polling = false;
    pollAbort?.abort();
  };

  return bot;
}
