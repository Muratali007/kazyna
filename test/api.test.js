import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, register } from './helpers.js';

let app;
before(async () => { app = await startApp({ withBot: false }); });
after(async () => { await app.close(); });

const cat = (cats, name) => cats.find((c) => c.name === name);
const acc = (accs, kind) => accs.find((a) => a.kind === kind);

test('регистрация, вход, сессии', async () => {
  const c = app.client();
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await c.post('/api/auth/register', { name: '', email: 'x@x.kz', password: 'secret1' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { name: 'A', email: 'bad', password: 'secret1' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { name: 'A', email: 'a@x.kz', password: '123' })).status, 400);
  const r = await c.post('/api/auth/register', { name: 'Айдар', email: 'Aidar@X.kz', password: 'secret1', familyName: 'Семья Т' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'aidar@x.kz');
  assert.equal((await c.post('/api/auth/register', { name: 'B', email: 'aidar@x.kz', password: 'secret1' })).status, 409);

  const me = await c.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.family.name, 'Семья Т');
  assert.equal(me.data.isOwner, true);
  assert.equal(me.data.bot.enabled, false);

  const c2 = app.client();
  assert.equal((await c2.post('/api/auth/login', { email: 'aidar@x.kz', password: 'wrong' })).status, 401);
  assert.equal((await c2.post('/api/auth/login', { email: 'AIDAR@x.kz', password: 'secret1' })).status, 200);
  assert.equal((await c2.get('/api/me')).status, 200);

  // смена пароля выкидывает другие сессии
  assert.equal((await c.post('/api/me/password', { oldPassword: 'nope', newPassword: 'secret2' })).status, 400);
  assert.equal((await c.post('/api/me/password', { oldPassword: 'secret1', newPassword: 'secret2' })).status, 200);
  assert.equal((await c.get('/api/me')).status, 200, 'текущая сессия продлена');
  assert.equal((await c2.get('/api/me')).status, 401, 'старая сессия недействительна');

  await c.post('/api/auth/logout-all');
  assert.equal((await c.get('/api/me')).status, 401);
});

test('лимит попыток входа', async () => {
  const c = app.client();
  for (let i = 0; i < 10; i++) assert.equal((await c.post('/api/auth/login', { email: 'brute@x.kz', password: 'x' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'brute@x.kz', password: 'x' })).status, 429);
});

test('операции, балансы, сводка за месяц', async () => {
  const c = await register(app, 'Мурат');
  const { categories } = (await c.get('/api/categories')).data;
  const { accounts } = (await c.get('/api/accounts')).data;
  assert.equal(accounts.length, 3);
  const card = acc(accounts, 'card');
  const cash = acc(accounts, 'cash');
  const dep = acc(accounts, 'deposit');
  assert.equal(card.isDefault, true);
  assert.equal(dep.rate, 14);
  const food = cat(categories, 'Продукты');
  const salary = cat(categories, 'Зарплата');

  assert.equal((await c.patch('/api/family', { monthlyBudget: 200000 })).data.family.monthlyBudget, 200000);
  await c.patch(`/api/categories/${food.id}`, { limit: 50000 });

  const inc = await c.post('/api/txs', { type: 'income', amount: 300000, categoryId: salary.id });
  assert.equal(inc.status, 201);
  const e1 = await c.post('/api/txs', { type: 'expense', amount: 45000.5, categoryId: food.id, note: 'Magnum' });
  assert.equal(e1.status, 201);
  assert.equal(e1.data.tx.amount, 45000.5);
  assert.equal(e1.data.tx.accountId, card.id, 'по умолчанию — основной счёт');
  assert.equal(e1.data.alerts.length, 1, 'сайт получает предупреждение о лимите');
  assert.match(e1.data.alerts[0], /Продукты.*90% лимита/);
  await c.post('/api/txs', { type: 'expense', amount: 2000, categoryId: food.id, accountId: cash.id });
  await c.post('/api/txs', { type: 'transfer', amount: 100000, accountId: card.id, toAccountId: dep.id });

  // валидация
  assert.equal((await c.post('/api/txs', { type: 'expense', amount: 0 })).status, 400);
  assert.equal((await c.post('/api/txs', { type: 'expense', amount: -5 })).status, 400);
  assert.equal((await c.post('/api/txs', { type: 'nope', amount: 5 })).status, 400);
  assert.equal((await c.post('/api/txs', { type: 'expense', amount: 5, categoryId: salary.id })).status, 400, 'категория доходов для расхода');
  assert.equal((await c.post('/api/txs', { type: 'transfer', amount: 5, accountId: card.id, toAccountId: card.id })).status, 400);
  assert.equal((await c.post('/api/txs', { type: 'expense', amount: 5, date: '2026-13-45' })).status, 400);

  const a = (await c.get('/api/accounts')).data;
  const bal = (k) => acc(a.accounts, k).balance;
  assert.equal(bal('card'), 300000 - 45000.5 - 100000);
  assert.equal(bal('cash'), -2000);
  assert.equal(bal('deposit'), 100000);
  assert.equal(a.totals.available, 300000 - 45000.5 - 100000 - 2000);
  assert.equal(a.totals.deposit, 100000);

  // корректировка остатка наличных до фактических 15 000
  const fix = await c.patch(`/api/accounts/${cash.id}`, { balance: 15000 });
  assert.equal(fix.data.account.balance, 15000);

  const s = (await c.get('/api/summary')).data;
  assert.equal(s.budget, 200000);
  assert.equal(s.spent, 47000.5);
  assert.equal(s.income, 300000);
  assert.equal(s.remaining, 200000 - 47000.5);
  assert.equal(cat(s.categories, 'Продукты').amount, 47000.5);
  assert.equal(cat(s.categories, 'Продукты').limit, 50000);
  assert.equal(s.days.length, s.daysInMonth);
  assert.equal(s.trend.length, 6);
  assert.equal(s.trend.at(-1).expense, 47000.5);
  assert.equal(s.recent.length, 4);
  assert.equal(s.members[0].spent, 47000.5);

  // фильтры списка
  const list = (await c.get(`/api/txs?type=expense&category=${food.id}`)).data;
  assert.equal(list.total, 2);
  assert.equal(list.sums.expense, 47000.5);
  assert.equal((await c.get('/api/txs?q=magn')).data.total, 1);

  // правка и удаление
  const id = e1.data.tx.id;
  const p = await c.patch(`/api/txs/${id}`, { amount: 40000 });
  assert.equal(p.data.tx.amount, 40000);
  assert.equal(p.data.tx.categoryId, food.id);
  const asIncome = await c.patch(`/api/txs/${id}`, { type: 'income' });
  assert.equal(asIncome.data.tx.categoryId, null, 'при смене типа категория сбрасывается');
  assert.equal((await c.del(`/api/txs/${id}`)).status, 200);
  assert.equal((await c.del(`/api/txs/${id}`)).status, 404);

  // CSV
  const csv = await c.get('/api/export.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.data, /"Дата";"Тип";"Сумма"/);
  assert.match(csv.data, /"Перевод";"100000"/);
});

test('счета и категории: создание, архив, удаление', async () => {
  const c = await register(app, 'Сауле');
  const r = await c.post('/api/accounts', { name: 'Kaspi Депозит', kind: 'deposit', rate: 15.5, balance: 500000 });
  assert.equal(r.status, 201);
  assert.equal(r.data.account.balance, 500000);
  const t = (await c.get('/api/accounts')).data.totals;
  assert.equal(t.deposit, 500000);

  const newAcc = r.data.account.id;
  assert.equal((await c.del(`/api/accounts/${newAcc}`)).data.deleted, true);
  const { accounts } = (await c.get('/api/accounts')).data;
  const card = acc(accounts, 'card');
  const cash = acc(accounts, 'cash');
  assert.equal((await c.del(`/api/accounts/${card.id}`)).status, 400, 'основной нельзя удалить');
  await c.post('/api/txs', { type: 'expense', amount: 100, accountId: cash.id });
  assert.equal((await c.del(`/api/accounts/${cash.id}`)).data.archived, true, 'с операциями — в архив');
  await c.patch(`/api/accounts/${cash.id}`, { isDefault: true });
  const after2 = (await c.get('/api/accounts')).data.accounts;
  assert.equal(after2.find((a) => a.id === cash.id).isDefault, true);
  assert.equal(after2.find((a) => a.id === cash.id).archived, false, 'основной разархивируется');

  const nc = await c.post('/api/categories', { name: 'Собака', emoji: '🐶', limit: 20000, keywords: 'корм ВЕТЕРИНАР' });
  assert.equal(nc.status, 201);
  assert.equal(nc.data.category.keywords, 'корм ветеринар');
  assert.equal(nc.data.category.kind, 'expense');
  assert.equal((await c.del(`/api/categories/${nc.data.category.id}`)).data.deleted, true);
});

test('цели: пополнение, снятие, достижение, удаление', async () => {
  const c = await register(app, 'Ернар');
  await c.post('/api/txs', { type: 'income', amount: 1000000 });
  const g = await c.post('/api/goals', { title: 'Отпуск', target: 500000, initial: 100000, deadline: '2027-06-01' });
  assert.equal(g.status, 201);
  assert.equal(g.data.goal.saved, 100000);
  const id = g.data.goal.id;
  assert.equal((await c.post('/api/goals', { title: 'X', target: 0 })).status, 400);

  let r = await c.post(`/api/goals/${id}/contribute`, { amount: 150000 });
  assert.equal(r.data.goal.saved, 250000);
  assert.equal((await c.post(`/api/goals/${id}/contribute`, { amount: 300000, direction: 'out' })).status, 400, 'нельзя снять больше, чем есть');
  r = await c.post(`/api/goals/${id}/contribute`, { amount: 50000, direction: 'out' });
  assert.equal(r.data.goal.saved, 200000);
  r = await c.post(`/api/goals/${id}/contribute`, { amount: 300000 });
  assert.equal(r.data.goal.done, true);

  let t = (await c.get('/api/accounts')).data.totals;
  assert.equal(t.inGoals, 500000);
  assert.equal(t.available, 500000);
  assert.equal(t.net, 1000000, 'деньги в целях не теряются');

  assert.equal((await c.del(`/api/goals/${id}`)).status, 200);
  t = (await c.get('/api/accounts')).data.totals;
  assert.equal(t.available, 1000000, 'после удаления цели деньги вернулись на счёт');
  assert.equal(t.inGoals, 0);
});

test('покупки на месяц: авто-категория, купили, вернуть', async () => {
  const c = await register(app, 'Дана');
  const { categories } = (await c.get('/api/categories')).data;
  const p = await c.post('/api/plans', { title: 'Молоко и хлеб', amount: 3000 });
  assert.equal(p.status, 201);
  assert.equal(p.data.plan.categoryId, cat(categories, 'Продукты').id, 'категория угадана по ключевым словам');
  const p2 = await c.post('/api/plans', { title: 'Пылесос', amount: 80000 });
  assert.equal((await c.post('/api/plans', { title: '' })).status, 400);

  const list = (await c.get('/api/plans')).data;
  assert.equal(list.plans.length, 2);
  let s = (await c.get('/api/summary')).data;
  assert.equal(s.plans.left, 83000);

  const b = await c.post(`/api/plans/${p2.data.plan.id}/buy`, { amount: 75000 });
  assert.equal(b.data.plan.done, true);
  assert.equal(b.data.tx.amount, 75000);
  assert.equal((await c.post(`/api/plans/${p2.data.plan.id}/buy`, {})).status, 409);
  s = (await c.get('/api/summary')).data;
  assert.equal(s.spent, 75000);
  assert.equal(s.plans.left, 3000);
  assert.equal(s.plans.done, 1);

  await c.patch(`/api/plans/${p2.data.plan.id}`, { done: false });
  s = (await c.get('/api/summary')).data;
  assert.equal(s.spent, 0, 'трата удалена вместе с отметкой');

  // удаление траты с сайта возвращает покупку в список
  const b2 = await c.post(`/api/plans/${p.data.plan.id}/buy`, {});
  await c.del(`/api/txs/${b2.data.tx.id}`);
  const back = (await c.get('/api/plans')).data.plans.find((x) => x.id === p.data.plan.id);
  assert.equal(back.done, false);
  assert.equal((await c.del(`/api/plans/${p.data.plan.id}`)).status, 200);
});

test('семья: приглашение, изоляция, вступление, главенство, исключение, выход', async () => {
  const owner = await register(app, 'Алия');
  const fam = (await owner.get('/api/family')).data;
  const code = fam.family.inviteCode;
  assert.match(fam.inviteUrl, new RegExp(`/#/join/${code}$`));
  await owner.post('/api/txs', { type: 'expense', amount: 1000 });

  const info = await app.client().get(`/api/invite/${code.toLowerCase()}`);
  assert.deepEqual(info.data, { family: fam.family.name, owner: 'Алия', members: 1 });
  assert.equal((await app.client().get('/api/invite/NOPE1234')).status, 404);

  // второй регистрируется по ссылке — сразу в семье
  const wife = await register(app, 'Жанна', { invite: code });
  assert.equal(wife.user.familyId, fam.family.id);
  assert.notEqual(wife.user.color, owner.user.color, 'у участников разные цвета');
  assert.equal((await wife.get('/api/summary')).data.spent, 1000);
  assert.equal((await app.client().post('/api/auth/register', { name: 'X', email: 'xx@x.kz', password: 'secret1', invite: 'BADCODE1' })).status, 404);

  // чужая семья не видит и не трогает данные
  const stranger = await register(app, 'Чужой');
  const ownerTx = (await owner.get('/api/txs')).data.items[0];
  assert.equal((await stranger.get('/api/txs')).data.total, 0);
  assert.equal((await stranger.patch(`/api/txs/${ownerTx.id}`, { amount: 1 })).status, 404);
  assert.equal((await stranger.del(`/api/txs/${ownerTx.id}`)).status, 404);
  const ownerAcc = (await owner.get('/api/accounts')).data.accounts[0];
  assert.equal((await stranger.post('/api/txs', { type: 'expense', amount: 5, accountId: ownerAcc.id })).status, 400);

  // стал участником через join — пустая старая семья удаляется
  const oldFamily = stranger.user.familyId;
  const j = await stranger.post('/api/family/join', { code });
  assert.equal(j.data.family.id, fam.family.id);
  assert.equal(await app.db.get('SELECT id FROM families WHERE id = ?', [oldFamily]), undefined);
  assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM categories WHERE family_id = ?', [oldFamily])).n, 0);
  assert.equal((await owner.get('/api/family')).data.members.length, 3);

  // только глава управляет
  assert.equal((await wife.post('/api/family/invite/reset')).status, 403);
  assert.equal((await wife.del(`/api/family/members/${stranger.user.id}`)).status, 403);
  assert.equal((await owner.post('/api/family/leave')).status, 409, 'глава не может просто уйти');

  // исключение: участник получает новую пустую семью
  assert.equal((await owner.del(`/api/family/members/${stranger.user.id}`)).status, 200);
  const sMe = (await stranger.get('/api/me')).data;
  assert.notEqual(sMe.family.id, fam.family.id);
  assert.equal(sMe.isOwner, true);

  // передача главенства и выход бывшего главы
  assert.equal((await owner.post('/api/family/owner', { userId: wife.user.id })).status, 200);
  assert.equal((await wife.get('/api/me')).data.isOwner, true);
  assert.equal((await owner.post('/api/family/leave')).status, 200);
  const left = (await owner.get('/api/me')).data;
  assert.notEqual(left.family.id, fam.family.id);
  assert.equal((await wife.get('/api/family')).data.members.length, 1);
  assert.equal((await wife.get('/api/summary')).data.spent, 1000, 'операции ушедшего остались в семье');

  // новая ссылка — старая перестаёт работать
  const reset = await wife.post('/api/family/invite/reset');
  assert.notEqual(reset.data.inviteCode, code);
  assert.equal((await app.client().get(`/api/invite/${code}`)).status, 404);
});

test('служебное: healthz, 404, статика, неверный JSON, привязка TG без бота', async () => {
  const c = await register(app, 'Тест');
  assert.deepEqual((await app.client().get('/healthz')).data.ok, true);
  assert.equal((await c.get('/api/nope')).status, 404);
  const html = await app.client().get('/');
  assert.equal(html.status, 200);
  assert.match(html.data, /Казына/);
  const bad = await fetch(`${app.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(bad.status, 400);
  assert.equal((await c.post('/api/tg/link')).status, 503);
  assert.equal(await app.update({}), 403, 'webhook закрыт, когда бот выключен');
});
