import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, parseAmount } from '../server/parser.js';
import { DEFAULT_CATEGORIES } from '../server/finance.js';

const categories = DEFAULT_CATEGORIES.map(([name, emoji, color, kind, keywords], i) => ({ id: i + 1, name, emoji, color, kind, keywords, archived: 0 }));
const accounts = [
  { id: 1, name: 'Карта', kind: 'card', is_default: 1, archived: 0 },
  { id: 2, name: 'Наличные', kind: 'cash', is_default: 0, archived: 0 },
  { id: 3, name: 'Депозит', kind: 'deposit', is_default: 0, archived: 0 },
];
const goals = [{ id: 7, title: 'Отпуск', done: 0 }];
const today = '2026-11-07';
const p = (t) => parseMessage(t, { categories, accounts, goals, today });
const catName = (id) => categories.find((c) => c.id === id)?.name;
const one = (t) => {
  const r = p(t);
  assert.equal(r.kind, 'txs', `«${t}» → ${JSON.stringify(r)}`);
  assert.equal(r.items.length, 1);
  return r.items[0];
};

test('суммы', () => {
  assert.equal(parseAmount('продукты 5400').value, 5400);
  assert.equal(parseAmount('такси 1 500').value, 1500);
  assert.equal(parseAmount('5к').value, 5000);
  assert.equal(parseAmount('1.5к').value, 1500);
  assert.equal(parseAmount('2,5 тыс').value, 2500);
  assert.equal(parseAmount('1,2 млн').value, 1200000);
  assert.equal(parseAmount('кофе 990.50').value, 990.5);
  assert.equal(parseAmount('+300000').sign, '+');
  assert.equal(parseAmount('без цифр'), null);
});

test('расходы и категории', () => {
  for (const [text, cat, amount] of [
    ['продукты 5к', 'Продукты', 500000],
    ['magnum 12000', 'Продукты', 1200000],
    ['такси 1 500', 'Транспорт', 150000],
    ['1.5к шаурма', 'Кафе и доставка', 150000],
    ['аптека 3400', 'Здоровье', 340000],
    ['садик 30000', 'Дети', 3000000],
    ['интернет 6000 тг', 'Дом и коммуналка', 600000],
    ['что-то 500', 'Другое', 50000],
  ]) {
    const it = one(text);
    assert.equal(it.type, 'expense', text);
    assert.equal(catName(it.categoryId), cat, text);
    assert.equal(it.amount, amount, text);
    assert.equal(it.accountId, 1, text);
  }
  assert.equal(one('кофе 1200 налом').accountId, 2);
  assert.equal(one('обед 3000 наличными').accountId, 2);
});

test('доходы', () => {
  for (const [text, cat] of [['+300000 зарплата', 'Зарплата'], ['зп 450к', 'Зарплата'], ['кешбэк 2300', 'Кэшбэк и проценты'], ['+5000', 'Прочий доход']]) {
    const it = one(text);
    assert.equal(it.type, 'income', text);
    assert.equal(catName(it.categoryId), cat, text);
  }
});

test('переводы и депозит', () => {
  assert.deepEqual(((x) => [x.type, x.accountId, x.toAccountId])(one('в депозит 50000')), ['transfer', 1, 3]);
  assert.deepEqual(((x) => [x.type, x.accountId, x.toAccountId])(one('снял с депозита 20000')), ['transfer', 3, 1]);
  assert.deepEqual(((x) => [x.type, x.accountId, x.toAccountId])(one('снял наличные 20000')), ['transfer', 1, 2]);
  assert.deepEqual(((x) => [x.type, x.accountId, x.toAccountId])(one('с карты на наличные 10000')), ['transfer', 1, 2]);
  assert.deepEqual(((x) => [x.type, x.accountId, x.toAccountId])(one('положил на депозит 100к налом')), ['transfer', 2, 3]);
});

test('цели', () => {
  const a = one('цель отпуск 20000');
  assert.deepEqual([a.type, a.goalId, a.accountId], ['goal', 7, 1]);
  const b = one('из цели отпуск 5000');
  assert.deepEqual([b.type, b.goalId, b.toAccountId], ['goal_out', 7, 1]);
  assert.equal(p('цель самолёт 100').kind, 'error');
});

test('покупки, даты, команды, несколько строк', () => {
  assert.deepEqual(p('купить пылесос 80000'), { kind: 'plan', title: 'пылесос', amount: 8000000 });
  assert.deepEqual(p('нужно купить молоко'), { kind: 'plan', title: 'молоко', amount: 0 });
  assert.equal(p('купить').kind, 'unknown');
  assert.equal(one('вчера аптека 3400').date, '2026-11-06');
  assert.equal(one('позавчера кино 4000').date, '2026-11-05');
  assert.equal(one('05.11 обед 2000').date, '2026-11-05');
  assert.equal(one('обед 2000').date, today);
  assert.equal(one('05.11 обед 2000').note, 'обед');
  assert.equal(one('05.11 обед 2000').amount, 200000, 'дата не стала суммой');
  assert.equal(one('обед 2000 03.11.2026').date, '2026-11-03');
  for (const [t, cmd] of [['/balance', 'balance'], ['баланс', 'balance'], ['итоги', 'month'], ['отмена', 'undo'], ['/start', 'help'], ['Сколько осталось?', 'balance'], ['/plans', 'plans']]) {
    assert.deepEqual(p(t), { kind: 'command', cmd }, t);
  }
  const multi = p('такси 1500\nмолоко 800; кино 4000');
  assert.equal(multi.items.length, 3);
  assert.equal(p('просто текст').kind, 'unknown');
});
