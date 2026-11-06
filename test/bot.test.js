import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, register, linkTg, tgMsg, tgCb } from './helpers.js';
import { localDate, shiftDate } from '../server/finance.js';

let app;
let murat; // глава, tg 111
let aigerim; // жена, tg 222
const M = 111;
const A = 222;

before(async () => {
  app = await startApp();
  murat = await register(app, 'Мурат');
  const code = (await murat.get('/api/family')).data.family.inviteCode;
  aigerim = await register(app, 'Айгерим', { invite: code });
});
after(async () => { await app.close(); });

const say = async (from, text, opts) => {
  app.tg.clear();
  assert.equal(await app.update(tgMsg(from, text, opts)), 200);
  return app.tg.last(opts?.chatId ?? from);
};
const lastTx = async (c) => (await c.get('/api/txs?limit=200')).data.items.sort((a, b) => b.id - a.id)[0];
const refs = async (c) => ({ cats: (await c.get('/api/categories')).data.categories, accs: (await c.get('/api/accounts')).data.accounts });

test('запуск: getMe, команды, webhook с секретом', () => {
  const m = app.tg.calls.map((c) => c.method);
  assert.ok(m.includes('getMe'));
  assert.ok(m.includes('setMyCommands'));
  const wh = app.tg.calls.find((c) => c.method === 'setWebhook');
  assert.equal(wh.payload.url, 'http://kazyna.test/tg/webhook');
  assert.equal(wh.payload.secret_token, app.bot.webhookSecret);
  assert.equal(app.bot.username, 'kazyna_test_bot');
  assert.equal(app.bot.mode, 'webhook');
});

test('webhook отклоняет запросы без секрета', async () => {
  assert.equal(await app.update(tgMsg(M, 'привет'), 'wrong'), 403);
});

test('незнакомому пользователю бот предлагает зарегистрироваться', async () => {
  const r = await say(999, 'продукты 5000');
  assert.match(r.text, /зарегистрируйтесь на сайте: http:\/\/kazyna\.test/);
  // в группе незнакомцев молча игнорируем
  app.tg.clear();
  await app.update(tgMsg(998, 'такси 500', { chatId: -100, chatType: 'supergroup' }));
  assert.equal(app.tg.sent().length, 0);
});

test('привязка Telegram по deep-link', async () => {
  const link = await murat.post('/api/tg/link');
  assert.equal(link.status, 200);
  assert.equal(link.data.url, `https://t.me/kazyna_test_bot?start=${link.data.code}`);
  const r = await say(M, `/start ${link.data.code}`);
  assert.match(r.text, /Готово, Мурат/);
  const me = (await murat.get('/api/me')).data.user;
  assert.deepEqual(me.telegram, { linked: true, username: `u${M}` });
  // повторно код не работает
  assert.match((await say(M, `/start ${link.data.code}`)).text, /устарела/);
  await linkTg(app, aigerim, A);
  assert.equal((await aigerim.get('/api/me')).data.user.telegram.linked, true);
});

test('трата текстом: категория, счёт по умолчанию, ответ с кнопками, уведомление семье', async () => {
  const { cats, accs } = await refs(murat);
  const r = await say(M, 'продукты 5 400');
  assert.match(r.text, /−5 400 ₸/);
  assert.match(r.text, /Продукты/);
  assert.match(r.text, /Потрачено за месяц|Осталось/);
  assert.deepEqual(r.reply_markup.inline_keyboard[0].map((b) => b.text), ['🏷 Категория', '↩️ Отменить']);
  const tx = await lastTx(murat);
  assert.equal(tx.type, 'expense');
  assert.equal(tx.amount, 5400);
  assert.equal(tx.source, 'telegram');
  assert.equal(tx.categoryId, cats.find((c) => c.name === 'Продукты').id);
  assert.equal(tx.accountId, accs.find((a) => a.isDefault).id);
  assert.equal(tx.userId, murat.user.id);
  const note = app.tg.last(A);
  assert.match(note.text, /Мурат.*−5 400 ₸/s, 'жена получила уведомление');
  assert.equal(app.tg.sent(M).length, 1, 'автору — только ответ, без дубля-уведомления');
});

test('разные форматы сообщений', async () => {
  const { cats, accs } = await refs(murat);
  const cid = (n) => cats.find((c) => c.name === n).id;
  const aid = (k) => accs.find((a) => a.kind === k).id;

  await say(M, 'кофе 1200 налом');
  let t = await lastTx(murat);
  assert.equal(t.accountId, aid('cash'));
  assert.equal(t.categoryId, cid('Кафе и доставка'));

  await say(M, '1.5к шаурма');
  t = await lastTx(murat);
  assert.equal(t.amount, 1500);

  await say(M, '+300000 зарплата');
  t = await lastTx(murat);
  assert.equal(t.type, 'income');
  assert.equal(t.categoryId, cid('Зарплата'));

  await say(M, 'зп 450к');
  t = await lastTx(murat);
  assert.equal(t.type, 'income');
  assert.equal(t.amount, 450000);

  await say(M, 'в депозит 50000');
  t = await lastTx(murat);
  assert.equal(t.type, 'transfer');
  assert.equal(t.toAccountId, aid('deposit'));

  await say(M, 'снял с депозита 20000');
  t = await lastTx(murat);
  assert.equal(t.type, 'transfer');
  assert.equal(t.accountId, aid('deposit'));

  await say(M, 'с карты на наличные 10000');
  t = await lastTx(murat);
  assert.deepEqual([t.type, t.accountId, t.toAccountId], ['transfer', aid('card'), aid('cash')]);

  await say(M, 'вчера аптека 3400');
  t = await lastTx(murat);
  assert.equal(t.date, shiftDate(localDate(), -1));
  assert.equal(t.categoryId, cid('Здоровье'));

  const before = (await murat.get('/api/txs')).data.total;
  const r = await say(M, 'такси 1500\nмолоко 800\nкино 4000');
  assert.equal((await murat.get('/api/txs')).data.total, before + 3);
  assert.equal(r.reply_markup.inline_keyboard[0].length, 1, 'для нескольких операций — только «Отменить»');
  assert.match(r.reply_markup.inline_keyboard[0][0].callback_data, /^u:\d+,\d+,\d+$/);

  const unk = await say(M, 'привет как дела');
  assert.match(unk.text, /Не понял/);
});

test('цели и покупки через бота', async () => {
  const g = await murat.post('/api/goals', { title: 'Машина', target: 1000000 });
  await say(M, 'цель машина 20000');
  let goal = (await murat.get('/api/goals')).data.goals.find((x) => x.id === g.data.goal.id);
  assert.equal(goal.saved, 20000);
  await say(M, 'из цели машина 5000');
  goal = (await murat.get('/api/goals')).data.goals.find((x) => x.id === g.data.goal.id);
  assert.equal(goal.saved, 15000);
  assert.match((await say(M, 'цель яхта 100')).text, /Не нашёл цель/);
  assert.match((await say(M, '/goals')).text, /Машина/);

  const r = await say(M, 'купить пылесос 80000');
  assert.match(r.text, /Добавил в список покупок: <b>пылесос<\/b> — 80 000 ₸/);
  await say(M, 'нужно купить молоко');
  const plans = (await murat.get('/api/plans')).data.plans;
  assert.deepEqual(plans.map((p) => [p.title, p.amount]), [['пылесос', 80000], ['молоко', 0]]);

  const list = await say(M, '/plans');
  assert.match(list.text, /Покупки на месяц/);
  const btn = list.reply_markup.inline_keyboard[0][0];
  assert.match(btn.text, /Купили: пылесос/);
  const before = (await murat.get('/api/summary')).data.spent;
  app.tg.clear();
  await app.update(tgCb(M, btn.callback_data));
  assert.ok(app.tg.calls.some((c) => c.method === 'editMessageText'));
  assert.match(app.tg.calls.find((c) => c.method === 'answerCallbackQuery').payload.text, /Записал трату 80000/);
  assert.equal((await murat.get('/api/summary')).data.spent, before + 80000);
  assert.equal((await murat.get('/api/plans')).data.plans.find((p) => p.title === 'пылесос').done, true);
});

test('кнопки: смена категории и отмена', async () => {
  const { cats } = await refs(murat);
  const r = await say(M, 'магазин 2500');
  const tx = await lastTx(murat);
  app.tg.clear();
  await app.update(tgCb(M, `c:${tx.id}`));
  const kb = app.tg.calls.find((c) => c.method === 'editMessageReplyMarkup').payload.reply_markup.inline_keyboard;
  assert.ok(kb.flat().some((b) => b.text.includes('Одежда')));
  const clothes = cats.find((c) => c.name === 'Одежда');
  await app.update(tgCb(M, `s:${tx.id}:${clothes.id}`));
  assert.equal((await lastTx(murat)).categoryId, clothes.id);

  const undoBtn = r.reply_markup.inline_keyboard[0].find((b) => b.text.includes('Отменить'));
  await app.update(tgCb(M, undoBtn.callback_data));
  assert.notEqual((await lastTx(murat))?.id, tx.id, 'операция удалена');
  // чужая семья не может отменить
  const stranger = await register(app, 'Чужой');
  await linkTg(app, stranger, 333);
  const t2 = (await say(M, 'хлеб 300')) && (await lastTx(murat));
  await app.update(tgCb(333, `u:${t2.id}`));
  assert.equal((await lastTx(murat)).id, t2.id, 'чужой не удалил операцию');
});

test('команды: /balance /month /today /undo /cats /help', async () => {
  assert.match((await say(M, '/balance')).text, /Доступно[\s\S]*На депозите[\s\S]*В целях/);
  assert.match((await say(M, 'баланс')).text, /Доступно/);
  assert.match((await say(M, '/month')).text, /Итоги[\s\S]*Расходы/);
  assert.match((await say(M, '/today')).text, /Сегодня/);
  assert.match((await say(M, '/cats')).text, /Продукты[\s\S]*Доходы/);
  assert.match((await say(M, '/help')).text, /Как пользоваться/);
  await say(M, 'одежда 7777');
  const last = await lastTx(murat);
  assert.match((await say(M, '/undo')).text, /Отменено.*7 777/);
  assert.notEqual((await lastTx(murat)).id, last.id);
});

test('предупреждения о лимитах', async () => {
  const { cats } = await refs(murat);
  const kids = cats.find((c) => c.name === 'Дети');
  await murat.patch(`/api/categories/${kids.id}`, { limit: 10000 });
  let r = await say(M, 'садик 8500');
  assert.match(r.text, /⚠️ «🧸 Дети»: потрачено 85% лимита/);
  assert.match(app.tg.last(A).text, /85% лимита/, 'жена тоже видит предупреждение');
  r = await say(M, 'игрушки 2000');
  assert.match(r.text, /🚨 Лимит «🧸 Дети» превышен/);
  r = await say(M, 'игрушки 100');
  assert.doesNotMatch(r.text, /Лимит/, 'повторно не спамим');

  await murat.patch('/api/family', { monthlyBudget: 1 });
  r = await say(M, 'хлеб 300');
  assert.match(r.text, /Бюджет месяца превышен|Бюджет превышен/);
  await murat.patch('/api/family', { monthlyBudget: 0 });
});

test('семейный чат: ответ реплаем, без лишних уведомлений, привязка к автору', async () => {
  const G = -100500;
  app.tg.clear();
  await app.update(tgMsg(A, 'такси 1800', { chatId: G, chatType: 'supergroup' }));
  const r = app.tg.last(G);
  assert.ok(r.reply_to_message_id, 'ответ реплаем');
  assert.match(r.text, /1 800/);
  assert.equal(app.tg.sent(M).length, 0, 'в группе все и так видят — в личку не дублируем');
  const t = await lastTx(aigerim);
  assert.equal(t.userId, aigerim.user.id);
  // болтовню в группе бот игнорирует
  app.tg.clear();
  await app.update(tgMsg(A, 'всем привет', { chatId: G, chatType: 'supergroup' }));
  assert.equal(app.tg.sent().length, 0);
});

test('уведомления можно выключить; трата с сайта тоже приходит в Telegram', async () => {
  await aigerim.patch('/api/me', { tgNotify: false });
  app.tg.clear();
  await say(M, 'бензин 15000');
  assert.equal(app.tg.sent(A).length, 0);
  await aigerim.patch('/api/me', { tgNotify: true });
  app.tg.clear();
  await murat.post('/api/txs', { type: 'expense', amount: 999 });
  assert.match(app.tg.last(A).text, /Мурат.*999/s);
});

test('отвязка Telegram', async () => {
  await murat.del('/api/tg/link');
  assert.match((await say(M, 'продукты 100')).text, /зарегистрируйтесь/);
});
