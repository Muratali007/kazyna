// Казына — SPA на ванильном JS. Hash-роутер, bottom-sheet формы, SVG-графики.
import { ring, donut, dayBars, trendChart, miniRing, animate } from './charts.js';

// ---------- утилиты ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const KIND = { card: 'Карта', cash: 'Наличные', deposit: 'Депозит', savings: 'Накопления', other: 'Другое' };
const KIND_EMOJI = { card: '💳', cash: '💵', deposit: '🏦', savings: '🐷', other: '👛' };
const COLORS = ['#17483b', '#5e8c61', '#c47a4a', '#d9a441', '#3f6e9a', '#2e8c88', '#8e5a9b', '#b4637a', '#c4553d', '#6b7f3a', '#4b5a8c', '#9a9184'];
const GOAL_EMOJI = ['🎯', '🚗', '🏠', '✈️', '💍', '📱', '💻', '🎓', '🛋️', '👶', '🏖️', '🎁'];

const state = { me: null, month: null, ref: null, txf: { type: '', category: '', q: '' }, route: '', arg: '' };
const cur = () => state.me?.family?.currency || '₸';
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
function money(n, { sign = false, c = true } = {}) {
  const v = Number(n) || 0;
  const s = (Number.isInteger(v) ? nf0 : nf2).format(Math.abs(v)).replace(/[\s\u202f]/g, '\u00a0');
  const pre = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return `${pre}${s}${c ? `\u00a0${cur()}` : ''}`;
}
function short(n) {
  const v = Math.abs(Number(n) || 0);
  const sgn = n < 0 ? '−' : '';
  if (v >= 1e6) return `${sgn}${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.0', '').replace('.', ',')} млн`;
  if (v >= 1e3) return `${sgn}${Math.round(v / 1e3)}к`;
  return `${sgn}${Math.round(v)}`;
}
const parseNum = (s) => {
  let t = String(s ?? '').trim().toLowerCase().replace(/[\s ]/g, '').replace(',', '.');
  let k = 1;
  if (/(к|k)$/.test(t)) { k = 1000; t = t.slice(0, -1); }
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * k * 100) / 100 : NaN;
};
const shiftMonth = (m, d) => {
  const [y, mm] = m.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mm - 1 + d, 1));
  return dt.toISOString().slice(0, 7);
};
const shiftDate = (d, n) => {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const today = () => state.me?.today || new Date().toISOString().slice(0, 10);
const curMonth = () => today().slice(0, 7);
function monthLabel(m, { year = 'auto' } = {}) {
  const [y, mm] = m.split('-').map(Number);
  const name = MONTHS[mm - 1];
  return year === 'auto' && String(y) === today().slice(0, 4) ? name : `${name} ${y}`;
}
const monthShort = (m) => MONTHS_SHORT[Number(m.slice(5)) - 1];
const monthIn = (m) => MONTHS_IN[Number(m.slice(5)) - 1];
function dayLabel(d) {
  if (d === today()) return 'Сегодня';
  if (d === shiftDate(today(), -1)) return 'Вчера';
  const dt = new Date(`${d}T12:00:00`);
  const opts = { day: 'numeric', month: 'long', weekday: 'short' };
  if (d.slice(0, 4) !== today().slice(0, 4)) opts.year = 'numeric';
  return dt.toLocaleDateString('ru-RU', opts);
}
const fmtDate = (d) => (d ? d.split('-').reverse().join('.') : '');
const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (u, cls = '') => `<div class="avatar ${cls}" style="background:${esc(u.color || '#8b5cf6')}" title="${esc(u.name)}">${esc(initials(u.name))}</div>`;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  home: svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  more: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.5L21 8H6"/>'),
  pie: svg('<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>'),
  wallet: svg('<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15v13H5a2 2 0 0 1-2-2V5"/><circle cx="16" cy="14" r="1.3"/>'),
  users: svg('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a6 6 0 0 0-4-5.6"/>'),
  gear: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevL: svg('<path d="m15 6-6 6 6 6"/>'),
  chevR: svg('<path d="m9 6 6 6-6 6"/>'),
  card: svg('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h3"/>'),
  cash: svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>'),
  bank: svg('<path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>'),
  piggy: svg('<path d="M5 11a6 6 0 0 1 6-5h2a6 6 0 0 1 6 5l2 1v3l-2 .5A6 6 0 0 1 16 19v2h-2.5v-1.5h-3V21H8v-2.2A6 6 0 0 1 5 14H3v-3z"/><path d="M10 6.2 9 3.5l3 1.6"/><circle cx="15.5" cy="11" r=".6" fill="currentColor"/>'),
  coins: svg('<ellipse cx="9" cy="7" rx="6" ry="2.6"/><path d="M3 7v4c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V7"/><path d="M9 13.6v3.8c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6v-4c0-1.4-2.7-2.6-6-2.6"/>'),
  trend: svg('<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>'),
  tg: svg('<path d="M21 4 3 11.2l6 2.3M21 4l-3.3 15.5L9 13.5M21 4 9 13.5m0 0v5.2l3-3"/>'),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  arrowR: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  download: svg('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
  phone: svg('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>'),
  share: svg('<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>'),
  logout: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>'),
  transfer: svg('<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>'),
};
const KIND_ICON = { card: I.card, cash: I.cash, deposit: I.bank, savings: I.piggy, other: I.coins };
// Иллюстрации для пустых экранов: линия — цвет рамок, акцент — золото.
const ill = (body) => `<svg class="illus" viewBox="0 0 120 90" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ILL = {
  receipt: ill('<path d="M38 12h44v66l-7-5-7 5-7-5-7 5-7-5-9 5z"/><path d="M47 28h26M47 38h26M47 48h14"/><circle class="acc" cx="84" cy="62" r="12"/><path class="acc" d="M79 62h10M84 57v10"/>'),
  search: ill('<circle cx="54" cy="42" r="20"/><path d="m69 57 14 14"/><path class="acc" d="M46 42h16"/>'),
  target: ill('<circle cx="56" cy="46" r="28"/><circle cx="56" cy="46" r="17"/><circle class="acc" cx="56" cy="46" r="6"/><path class="acc" d="m56 46 30-30M80 14l6 2 2 6"/>'),
  bag: ill('<path d="M32 30h56l-5 46H37z"/><path d="M46 30v-6a14 14 0 0 1 28 0v6"/><path class="acc" d="m50 52 7 7 14-14"/>'),
  link: ill('<path d="M50 54 40 64a10 10 0 0 1-14-14l10-10"/><path d="m70 36 10-10a10 10 0 0 1 14 14L84 50"/><path class="acc" d="M54 30l-4-10M66 60l4 10M44 38l-10-3M76 52l10 3"/>'),
  family: ill('<circle cx="40" cy="30" r="9"/><circle cx="80" cy="30" r="9"/><path d="M24 70c0-10 7-18 16-18s16 8 16 18M64 70c0-10 7-18 16-18s16 8 16 18"/><circle class="acc" cx="60" cy="50" r="7"/><path class="acc" d="M50 74c0-7 4.5-12 10-12s10 5 10 12"/>'),
  oops: ill('<circle cx="60" cy="45" r="28"/><path d="M48 38h.1M72 38h.1"/><path class="acc" d="M48 58c7-6 17-6 24 0"/>'),
};
const empty = (ico, title, text = '') => `<div class="empty">${ILL[ico]}<b>${title}</b>${text}</div>`;
const note = (html) => `<div class="card note">${I.tg}<div>${html}</div></div>`;

// ---------- API ----------
class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Нет связи с сервером', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth') && path !== '/me') {
    state.me = null;
    go('#/login');
  }
  if (!res.ok) throw new ApiError(data.error || 'Ошибка сервера', res.status);
  return data;
}
async function loadMe() {
  try { state.me = await api('/me'); } catch { state.me = null; }
  if (state.me && !state.month) state.month = curMonth();
  return state.me;
}
async function loadRef(force = false) {
  if (state.ref && !force && Date.now() - state.ref.at < 20000) return state.ref;
  const [c, a, g] = await Promise.all([api('/categories'), api('/accounts'), api('/goals')]);
  state.ref = { categories: c.categories, accounts: a.accounts, totals: a.totals, goals: g.goals, at: Date.now() };
  return state.ref;
}
const dropRef = () => { state.ref = null; };

// ---------- toast, sheet, confirm ----------
let toastTimer;
const toastQueue = [];
function toast(msg, kind = '', ms = 2600) {
  toastQueue.push({ msg, kind, ms });
  if (toastQueue.length === 1) showNextToast();
}
function showNextToast() {
  const t = toastQueue[0];
  if (!t) return;
  const el = $('#toast');
  el.textContent = t.msg;
  el.className = `toast show ${t.kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
    setTimeout(() => { toastQueue.shift(); showNextToast(); }, 300);
  }, t.ms);
}
const fail = (e) => toast(e?.message || 'Ошибка', 'bad', 3500);

function openSheet(title, html, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-bg"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="handle"></div>
    <div class="sheet-title"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Закрыть">${I.x}</button></div>
    <div class="sheet-body">${html}</div></div>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const sheet = $('.sheet', wrap);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (wrap.classList.contains('closing')) return;
    wrap.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      wrap.remove();
      if (!$('.sheet-wrap')) document.body.style.overflow = '';
      onClose?.();
    }, 260);
  }
  document.addEventListener('keydown', onKey);
  $('.sheet-bg', wrap).addEventListener('click', close);
  $('[data-close]', wrap).addEventListener('click', close);
  // свайп вниз закрывает шторку
  let y0 = null;
  let dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    if (sheet.scrollTop > 0 || e.target.closest('input,textarea,select,.cat-grid,.chips')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
    sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 == null) return;
    sheet.style.transition = 'transform .25s';
    if (dy > 110) close();
    else sheet.style.transform = '';
    y0 = null;
  });
  const focus = $('[autofocus]', wrap);
  if (focus && matchMedia('(pointer: fine)').matches) setTimeout(() => focus.focus(), 80);
  else if (focus) focus.focus({ preventScroll: true });
  return { el: $('.sheet-body', wrap), close };
}

function confirmSheet(text, { ok = 'Удалить', danger = true, title = 'Вы уверены?' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const s = openSheet(title, `<p class="muted" style="margin:0 0 18px">${text}</p>
      <div class="sheet-actions"><button class="btn ghost" data-no>Отмена</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button></div>`,
    { onClose: () => { if (!answered) resolve(false); } });
    $('[data-no]', s.el).onclick = () => s.close();
    $('[data-yes]', s.el).onclick = () => { answered = true; resolve(true); s.close(); };
  });
}

async function busy(btn, fn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('loading');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('loading'); }
}
const formObj = (f) => Object.fromEntries(new FormData(f).entries());

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const cols = ['#d9a441', '#17483b', '#c47a4a', '#5e8c61', '#f3e2bd'];
  box.innerHTML = Array.from({ length: 70 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-delay:${Math.random() * 0.5}s;animation-duration:${1.2 + Math.random()}s"></i>`).join('');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2800);
}

function countUp(root, instant) {
  $$('[data-count]', root).forEach((el) => {
    const to = Number(el.dataset.count);
    const sign = el.dataset.sign === '1';
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = money(to, { sign }); return; }
    const t0 = performance.now();
    const d = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / d);
      const e = 1 - (1 - k) ** 3;
      el.textContent = money(k < 1 ? Math.round(to * e) : to, { sign });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
const counted = (v, { sign = false, cls = '' } = {}) => `<span class="num ${cls}" data-count="${v}" data-sign="${sign ? 1 : 0}">${money(v, { sign })}</span>`;

function bindTips(root) {
  $$('.chart-box', root).forEach((box) => {
    const tip = $('.chart-tip', box);
    if (!tip) return;
    const def = tip.textContent;
    const show = (e) => {
      const el = e.target.closest('[data-tip]');
      $$('.on', box).forEach((x) => x !== el && x.classList.remove('on'));
      if (el) { tip.textContent = el.dataset.tip; tip.classList.add('on'); el.classList.add('on'); }
    };
    box.addEventListener('pointerover', show);
    box.addEventListener('click', show);
    box.addEventListener('pointerleave', () => { tip.textContent = def; tip.classList.remove('on'); $$('.on', box).forEach((x) => x.classList.remove('on')); });
  });
}

// ---------- роутер ----------
const go = (hash, replace = false) => {
  if (replace) history.replaceState(null, '', hash);
  else if (location.hash !== hash) { location.hash = hash; return; }
  router();
};
const PUBLIC = new Set(['login', 'register', 'join']);
const SCREENS = {};
let renderToken = 0;

async function router() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'home';
  const arg = decodeURIComponent(parts[1] || '');
  if (state.me === null && !router.tried) { router.tried = true; await loadMe(); }
  $$('.sheet-wrap').forEach((w) => w.remove());
  document.body.style.overflow = '';
  if (PUBLIC.has(name)) {
    if (state.me && name !== 'join') return go('#/', true);
    state.route = name;
    return renderPublic(name, arg);
  }
  if (!state.me) return go('#/login', true);
  const screen = SCREENS[name] ? name : 'home';
  state.route = screen;
  state.arg = arg;
  ensureShell();
  setNav(screen);
  await renderScreen(SCREENS[screen], arg);
}
window.addEventListener('hashchange', router);

async function renderScreen(fn, arg, quiet = false) {
  const my = ++renderToken;
  const view = $('#view');
  let skel;
  if (!quiet) skel = setTimeout(() => { if (my === renderToken) view.innerHTML = skeleton(); }, 140);
  try {
    const out = await fn(arg);
    clearTimeout(skel);
    if (my !== renderToken) return;
    const root = document.createElement('div');
    root.className = `view${quiet ? ' quiet' : ''}`;
    root.innerHTML = out.html;
    const y = window.scrollY;
    view.replaceChildren(root);
    if (quiet) window.scrollTo(0, y); else window.scrollTo(0, 0);
    out.mount?.(root);
    animate(root);
    countUp(root, quiet);
    bindTips(root);
  } catch (e) {
    clearTimeout(skel);
    if (my !== renderToken || e.status === 401) return;
    view.innerHTML = `<div class="view"><div class="card">${empty('oops', esc(e.message), '<br><button class="btn" onclick="location.reload()" style="margin-top:12px">Обновить</button>')}</div></div>`;
  }
}
const refresh = () => { if (state.me && SCREENS[state.route]) renderScreen(SCREENS[state.route], state.arg, true); };
const skeleton = () => `<div class="topbar"><div class="skeleton" style="width:160px;height:30px"></div></div>
  <div class="skeleton" style="height:170px;margin-bottom:14px"></div>
  <div class="tiles"><div class="skeleton" style="height:66px"></div><div class="skeleton" style="height:66px"></div></div>
  <div class="skeleton" style="height:220px"></div>`;

// ---------- каркас ----------
const NAV = [
  ['home', 'Главная', I.home],
  ['txs', 'Операции', I.list],
  ['plans', 'Покупки', I.cart],
  ['goals', 'Цели', I.target],
  ['budget', 'Бюджет', I.pie],
  ['accounts', 'Счета', I.wallet],
  ['family', 'Семья', I.users],
  ['settings', 'Настройки', I.gear],
];
const href = (k) => (k === 'home' ? '#/' : `#/${k}`);

function ensureShell() {
  if ($('#view')) { $('.side-foot').textContent = state.me.family.name; return; }
  $('#app').innerHTML = `<div class="shell">
    <aside class="side">
      <div class="brand"><img src="/icons/icon-192.png" alt="">Казына</div>
      ${NAV.map(([k, l, i]) => `<a href="${href(k)}" data-nav="${k}">${i}${l}</a>`).join('')}
      <button class="btn primary" data-add>${I.plus} Операция</button>
      <div class="side-foot">${esc(state.me.family.name)}</div>
    </aside>
    <main class="main"><div id="view"></div></main>
    <nav class="nav">
      <a href="#/" data-nav="home">${I.home}Главная</a>
      <a href="#/txs" data-nav="txs">${I.list}Операции</a>
      <div class="fab-slot"><button class="fab" data-add aria-label="Добавить операцию">${I.plus}</button></div>
      <a href="#/plans" data-nav="plans">${I.cart}Покупки</a>
      <a href="#more" data-more data-nav="more">${I.more}Ещё</a>
    </nav>
  </div>`;
  $$('[data-add]').forEach((b) => b.addEventListener('click', () => openTxSheet()));
  $('[data-more]').addEventListener('click', (e) => { e.preventDefault(); openMore(); });
}
function setNav(name) {
  const inMore = ['goals', 'budget', 'accounts', 'family', 'settings'].includes(name);
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name || (inMore && a.dataset.nav === 'more' && a.closest('.nav'))));
}
function openMore() {
  const items = [['goals', I.target, 'Цели'], ['budget', I.pie, 'Бюджет'], ['accounts', I.wallet, 'Счета'], ['family', I.users, 'Семья'], ['settings', I.gear, 'Настройки'], ['txs', I.list, 'Операции']];
  const s = openSheet('Меню', `<div class="menu-grid">${items.map(([k, e, l]) => `<a href="${href(k)}">${e}${l}</a>`).join('')}</div>`);
  $$('a', s.el).forEach((a) => a.addEventListener('click', () => s.close()));
}
const topbar = (title, sub = '', right = '', eyebrow = '') => `<div class="topbar"><div class="grow">${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}<h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</div>`;
const monthSwitch = (m) => `<div class="month-sw"><button data-mprev aria-label="Предыдущий месяц">${I.chevL}</button><span>${esc(monthLabel(m))}</span><button data-mnext aria-label="Следующий месяц">${I.chevR}</button></div>`;
function bindMonth(root, get, set) {
  $('[data-mprev]', root)?.addEventListener('click', () => { set(shiftMonth(get(), -1)); renderScreen(SCREENS[state.route], state.arg); });
  $('[data-mnext]', root)?.addEventListener('click', () => { set(shiftMonth(get(), 1)); renderScreen(SCREENS[state.route], state.arg); });
}

// ---------- строка операции ----------
function txView(t, ref) {
  const cat = ref.categories.find((c) => c.id === t.categoryId);
  const acc = ref.accounts.find((a) => a.id === t.accountId);
  const to = ref.accounts.find((a) => a.id === t.toAccountId);
  const goal = ref.goals.find((g) => g.id === t.goalId);
  switch (t.type) {
    case 'expense': return { ico: cat?.emoji || '❔', color: cat?.color || '#9a9184', title: cat?.name || 'Без категории', where: acc?.name, amt: money(-t.amount), cls: '' };
    case 'income': return { ico: cat?.emoji || '💵', color: cat?.color || '#2f7d55', title: cat?.name || 'Доход', where: acc?.name, amt: money(t.amount, { sign: true }), cls: 'inc' };
    case 'transfer': return { ico: I.transfer, color: '#3f6e9a', title: `${acc?.name || '?'} → ${to?.name || '?'}`, where: 'Перевод', amt: money(t.amount), cls: 'muted' };
    case 'goal': return { ico: goal?.emoji || '🎯', color: '#d9a441', title: `В цель «${goal?.title || '?'}»`, where: acc?.name, amt: money(t.amount), cls: 'muted' };
    case 'goal_out': return { ico: goal?.emoji || '🎯', color: '#d9a441', title: `Из цели «${goal?.title || '?'}»`, where: to?.name, amt: money(t.amount), cls: 'muted' };
    default: return { ico: '•', color: '#9a9184', title: t.type, amt: money(t.amount), cls: '' };
  }
}
function txRow(t, ref, { showDate = false } = {}) {
  const v = txView(t, ref);
  const sub = [t.note, t.userName, v.where].filter(Boolean).map(esc).join(' · ');
  return `<div class="item" data-tx="${t.id}">
    <div class="ico" style="background:color-mix(in srgb, ${esc(v.color)} 15%, var(--surface));color:${esc(v.color)}">${v.ico.startsWith('<svg') ? v.ico : esc(v.ico)}</div>
    <div class="grow"><div class="t ellipsis">${esc(v.title)}${t.source === 'telegram' ? '<span class="src-tg" title="Из Telegram">${I.tg}</span>' : ''}</div><div class="s ellipsis">${sub || '&nbsp;'}</div></div>
    <div class="amt num ${v.cls}">${v.amt}${showDate ? `<small>${esc(dayLabel(t.date))}</small>` : ''}</div>
  </div>`;
}
function bindTxRows(root, items) {
  const map = new Map(items.map((t) => [String(t.id), t]));
  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-tx]');
    if (row && map.has(row.dataset.tx)) openTxSheet({ tx: map.get(row.dataset.tx) });
  });
}

// ---------- форма операции ----------
async function openTxSheet({ tx = null, type = 'expense', preset = {} } = {}) {
  let ref;
  try { ref = await loadRef(); } catch (e) { return fail(e); }
  const editing = !!tx;
  let t = tx ? tx.type : type;
  let catId = tx ? tx.categoryId : preset.categoryId ?? null;
  const isGoal = t === 'goal' || t === 'goal_out';
  const accs = ref.accounts.filter((a) => !a.archived || (tx && (a.id === tx.accountId || a.id === tx.toAccountId)));
  const defAcc = accs.find((a) => a.isDefault) || accs[0];
  let accId = tx?.accountId ?? preset.accountId ?? defAcc?.id;
  let toId = tx?.toAccountId ?? preset.toAccountId ?? (accs.find((a) => a.kind === 'deposit' && a.id !== accId) || accs.find((a) => a.id !== accId))?.id;
  if (t === 'goal_out') accId = tx.toAccountId;
  const goal = isGoal ? ref.goals.find((g) => g.id === tx.goalId) : null;
  let date = tx?.date || today();

  const s = openSheet(editing ? 'Операция' : 'Новая операция', `<form autocomplete="off" novalidate>
    ${isGoal ? `<div class="center muted small" style="margin-bottom:6px">${t === 'goal' ? 'Пополнение цели' : 'Снятие из цели'} «${esc(goal?.title || '?')}»</div>`
    : `<div class="seg">${[['expense', 'Расход', 'exp'], ['income', 'Доход', 'inc'], ['transfer', 'Перевод', '']].map(([k, l, c]) => `<button type="button" data-t="${k}" class="${c}">${l}</button>`).join('')}</div>`}
    <input class="amount-input num" name="amount" inputmode="decimal" enterkeyhint="done" placeholder="0" value="${tx ? tx.amount : preset.amount ?? ''}" ${editing ? '' : 'autofocus'} aria-label="Сумма">
    <div class="amount-cur">${esc(cur())}</div>
    <div data-cats></div>
    <div data-accs></div>
    <div class="chips" data-dates>
      <button type="button" class="chip" data-d="${today()}">Сегодня</button>
      <button type="button" class="chip" data-d="${shiftDate(today(), -1)}">Вчера</button>
      <button type="button" class="chip" data-d="${shiftDate(today(), -2)}">Позавчера</button>
      <input type="date" class="chip" name="date" value="${date}" max="${shiftDate(today(), 366)}" style="padding:5px 10px" aria-label="Дата">
    </div>
    <label class="field"><span>Комментарий</span><input class="input" name="note" maxlength="300" value="${esc(tx?.note || '')}" placeholder="Например: Magnum, на неделю"></label>
    <div class="err" data-err></div>
    <div class="sheet-actions">${editing ? '<button type="button" class="btn danger" data-del>Удалить</button>' : ''}<button class="btn primary" type="submit">${editing ? 'Сохранить' : 'Добавить'}</button></div>
    ${editing ? `<p class="tiny dim center" style="margin:12px 0 0">${tx.source === 'telegram' ? 'Из Telegram' : 'С сайта'}${tx.userName ? ` · ${esc(tx.userName)}` : ''}</p>` : ''}
  </form>`);
  const f = $('form', s.el);
  const accSelect = (name, label, val, exclude) => `<label class="field grow"><span>${label}</span><select class="input" name="${name}">${accs.filter((a) => a.id !== exclude || a.id === val).map((a) => `<option value="${a.id}" ${a.id === val ? 'selected' : ''}>${esc(a.name)} · ${money(a.balance)}</option>`).join('')}</select></label>`;

  function paint() {
    $$('[data-t]', f).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    const box = $('[data-cats]', f);
    if (t === 'expense' || t === 'income') {
      const cats = ref.categories.filter((c) => c.kind === t && (!c.archived || c.id === catId));
      if (catId && !cats.some((c) => c.id === catId)) catId = null;
      box.innerHTML = `<div class="cat-grid">${cats.map((c) => `<button type="button" class="cat-btn ${c.id === catId ? 'on' : ''}" data-cat="${c.id}" style="--c:${esc(c.color)}"><b>${esc(c.emoji || '🏷️')}</b>${esc(c.name)}</button>`).join('')}</div>`;
    } else box.innerHTML = '';
    const ab = $('[data-accs]', f);
    if (t === 'transfer') ab.innerHTML = `<div class="two">${accSelect('accountId', 'Откуда', accId)}${accSelect('toAccountId', 'Куда', toId, accId)}</div>`;
    else if (accs.length > 1 || isGoal) ab.innerHTML = accSelect('accountId', t === 'income' || t === 'goal_out' ? 'На счёт' : 'Со счёта', accId);
    else ab.innerHTML = '';
    $$('[data-d]', f).forEach((b) => b.classList.toggle('on', b.dataset.d === date));
  }
  paint();
  f.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-t]');
    if (tb) { t = tb.dataset.t; catId = null; return paint(); }
    const cb = e.target.closest('[data-cat]');
    if (cb) { catId = Number(cb.dataset.cat) === catId ? null : Number(cb.dataset.cat); return paint(); }
    const db = e.target.closest('[data-d]');
    if (db) { date = db.dataset.d; f.date.value = date; return paint(); }
  });
  f.addEventListener('change', (e) => {
    if (e.target.name === 'date') { date = e.target.value || today(); paint(); }
    if (e.target.name === 'accountId') {
      accId = Number(e.target.value);
      if (t === 'transfer') { if (toId === accId) toId = accs.find((a) => a.id !== accId)?.id; paint(); }
    }
    if (e.target.name === 'toAccountId') toId = Number(e.target.value);
  });
  $('[data-del]', f)?.addEventListener('click', async () => {
    if (!(await confirmSheet('Операция будет удалена, балансы пересчитаются.'))) return;
    try {
      await api(`/txs/${tx.id}`, { method: 'DELETE' });
      s.close(); dropRef(); toast('Удалено'); refresh();
    } catch (e) { fail(e); }
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('[data-err]', f);
    const amount = parseNum(f.amount.value);
    if (!(amount > 0)) { err.textContent = 'Введите сумму'; f.amount.focus(); return; }
    let category = catId;
    if ((t === 'expense' || t === 'income') && !category) {
      const live = ref.categories.filter((c) => c.kind === t && !c.archived);
      category = (live.find((c) => /^(другое|прочий доход)$/i.test(c.name)) || live[live.length - 1])?.id ?? null;
    }
    const body = { amount, date, note: f.note.value.trim() };
    if (isGoal) {
      if (t === 'goal') body.accountId = Number(f.accountId?.value || accId);
      else body.toAccountId = Number(f.accountId?.value || accId);
    } else {
      Object.assign(body, { type: t, categoryId: t === 'transfer' ? null : category, accountId: Number(f.accountId?.value || accId) || null });
      if (t === 'transfer') body.toAccountId = Number(f.toAccountId.value);
    }
    busy($('[type=submit]', f), async () => {
      try {
        const r = editing ? await api(`/txs/${tx.id}`, { method: 'PATCH', body }) : await api('/txs', { method: 'POST', body });
        s.close();
        dropRef();
        const v = txView(r.tx, ref);
        toast(editing ? 'Сохранено' : `✓ ${v.amt} · ${v.title}`);
        (r.alerts || []).forEach((a) => toast(a, 'bad', 4200));
        refresh();
      } catch (ex) { err.textContent = ex.message; }
    });
  });
}

// ================= ЭКРАНЫ =================

// ---------- главная ----------
SCREENS.home = async () => {
  const m = state.month;
  const s = await api(`/summary?month=${m}`);
  const ref = { categories: s.ref.categories, accounts: s.accounts, goals: s.goals };
  const me = state.me.user;
  const isCur = m === curMonth();
  const hasBudget = s.budget > 0;
  const over = hasBudget && s.spent > s.budget;
  const p = hasBudget ? s.spent / s.budget : s.income > 0 ? s.spent / s.income : 0;
  const diff = s.prevSpent > 0 ? Math.round(((s.spent - s.prevSpent) / s.prevSpent) * 100) : null;

  const hero = `<div class="card hero span">
    <div class="hero-grid">
      <div class="grow">
        <div class="label">${hasBudget ? (over ? `Перерасход в ${monthIn(m)}` : isCur ? 'Осталось на месяц' : `Осталось в ${monthIn(m)}`) : `Потрачено в ${monthIn(m)}`}</div>
        <div class="big">${hasBudget ? counted(Math.abs(s.remaining), { cls: over ? 'exp' : '' }) : counted(s.spent)}</div>
        <div class="meta">${hasBudget ? `Потрачено <b>${money(s.spent)}</b> из ${money(s.budget)}` : s.income ? `Доходы ${money(s.income, { sign: true })}` : 'Бюджет не задан · <a href="#/budget">задать</a>'}</div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:6px">
          ${isCur && hasBudget && s.perDay > 0 ? `<span class="pill">≈ ${money(Math.floor(s.perDay))} в день · ${s.daysLeft} ${plural(s.daysLeft, 'день', 'дня', 'дней')}</span>` : ''}
          ${over ? `<span class="pill bad">бюджет превышен</span>` : ''}
          ${diff !== null && s.spent > 0 && !isCur ? `<span class="pill ${diff <= 0 ? 'good' : 'warn'}">${diff <= 0 ? '↓' : '↑'} ${Math.abs(diff)}% к ${monthShort(shiftMonth(m, -1))}</span>` : ''}
        </div>
      </div>
      ${ring(p, { label: `${Math.round(p * 100)}%`, sub: hasBudget ? 'бюджета' : s.income ? 'от доходов' : 'потрачено', over })}
    </div>
  </div>`;

  const tiles = `<div class="tiles span">
    <div class="tile" data-go="#/accounts"><div class="t-label">${I.card}Доступно</div><div class="t-val">${counted(s.totals.available)}</div></div>
    <div class="tile" data-go="#/accounts"><div class="t-label">${I.bank}Депозит</div><div class="t-val">${counted(s.totals.deposit)}</div></div>
    <div class="tile" data-go="#/goals"><div class="t-label">${I.target}В целях</div><div class="t-val">${counted(s.totals.inGoals)}</div></div>
    <div class="tile" data-go="#/txs" data-type="income"><div class="t-label">${I.trend}Доходы</div><div class="t-val inc">${counted(s.income, { sign: true })}</div></div>
  </div>`;

  const tgBanner = !me.telegram.linked ? `<div class="banner span" data-go="#/family">
    <div class="b-ico">${I.tg}</div><div class="grow"><b>Пишите траты в Telegram</b><div class="small muted">«продукты 5400» — и всё посчитается само</div></div>${I.chevR.replace('<svg', '<svg class="arrow"')}</div>` : '';

  const exp = s.categories.filter((c) => c.kind === 'expense' && c.amount > 0).sort((a, b) => b.amount - a.amount);
  const top = exp.slice(0, 6);
  if (exp.length > 6) top.push({ id: 'rest', name: 'Остальное', emoji: '•••', color: '#64748b', amount: exp.slice(6).reduce((a, c) => a + c.amount, 0) });
  const donutCard = `<div class="card">
    <div class="card-head"><h2>Расходы по категориям</h2><a href="#/budget">Лимиты</a></div>
    ${top.length ? `<div class="chart-box"><div class="donut-wrap">
      ${donut(top.map((c) => ({ value: c.amount, color: c.color, name: `${c.name} — ${money(c.amount)} (${pct(c.amount, s.spent)}%)`, emoji: c.emoji })), { center: short(s.spent), sub: cur() })}
      <ul class="legend">${top.map((c) => `<li data-cat="${c.id}" style="cursor:pointer"><span class="dot" style="background:${esc(c.color)}"></span><span class="ellipsis">${esc(c.name)}</span><span class="v num">${pct(c.amount, s.spent)}%</span></li>`).join('')}</ul>
    </div><div class="chart-tip">Нажмите на сегмент</div></div>`
    : empty('receipt', 'Трат пока нет', '<span class="small">Нажмите «+» или напишите боту <span class="kbd">продукты 5000</span></span>')}
  </div>`;

  const daysPassed = isCur ? Number(today().slice(8)) : m < curMonth() ? s.daysInMonth : 0;
  const avg = daysPassed ? s.spent / daysPassed : 0;
  const barsCard = `<div class="card"><div class="card-head"><h2>По дням</h2><span class="small muted">${avg ? `в среднем ${money(Math.round(avg))}` : ''}</span></div>
    <div class="chart-box">${dayBars(s.days, { today: isCur ? today() : m < curMonth() ? '9999' : '0000', fmt: (v) => money(v), avg: Math.round(avg) })}<div class="chart-tip">Нажмите на столбик</div></div></div>`;

  const trendCard = `<div class="card"><div class="card-head"><h2>Динамика</h2><div class="chart-legend"><span class="inc">доходы</span><span class="exp">расходы</span></div></div>
    <div class="chart-box">${trendChart(s.trend, { fmtShort: short, monthName: monthShort })}<div class="chart-tip">За 6 месяцев</div></div></div>`;

  const members = s.members.length > 1 ? `<div class="card"><div class="card-head"><h2>Кто сколько потратил</h2><a href="#/family">Семья</a></div>
    ${s.members.map((x) => `<div class="row" style="margin-bottom:10px">${avatar(x, 'sm')}<div class="grow"><div class="row between small"><b>${esc(x.name)}</b><span class="num">${money(x.spent)}</span></div>
      <div class="progress" style="margin-top:5px"><i style="width:${pct(x.spent, s.spent)}%;background:${esc(x.color)}"></i></div></div></div>`).join('')}</div>` : '';

  const plansCard = `<div class="card"><div class="card-head"><h2>Покупки на месяц</h2><a href="#/plans">Список</a></div>
    ${s.plans.count ? `<div class="row between"><div><div class="small muted">Осталось купить</div><div style="font-size:24px;font-weight:600" class="num">${money(s.plans.left)}</div></div>
      <div class="pill">${s.plans.done} из ${s.plans.count}</div></div>
      <div class="progress" style="margin:10px 0 6px"><i style="width:${pct(s.plans.done, s.plans.count)}%"></i></div>
      ${hasBudget && isCur ? `<div class="small ${s.remaining - s.plans.left < 0 ? 'exp' : 'muted'}">После всех покупок останется ${money(s.remaining - s.plans.left)}</div>` : ''}`
    : `<div class="small muted">Список пуст. Добавьте, что нужно купить в этом месяце — например, в Telegram: <span class="kbd">купить пылесос 80000</span></div>`}
  </div>`;

  const goals = s.goals.filter((g) => !g.done).slice(0, 3);
  const goalsCard = `<div class="card"><div class="card-head"><h2>Цели</h2><a href="#/goals">Все</a></div>
    ${goals.length ? goals.map((g) => `<div style="margin-bottom:12px"><div class="row between small"><span><span style="margin-right:6px">${esc(g.emoji)}</span><b>${esc(g.title)}</b></span><span class="num muted">${money(g.saved)} / ${short(g.target)}</span></div>
      <div class="progress gold" style="margin-top:7px"><i style="width:${Math.min(100, pct(g.saved, g.target))}%"></i></div></div>`).join('')
    : '<div class="small muted">Поставьте цель — машина, отпуск, ремонт — и откладывайте понемногу.</div>'}
  </div>`;

  const recent = `<div class="card span"><div class="card-head"><h2>Последние операции</h2><a href="#/txs">Все</a></div>
    ${s.recent.length ? `<div class="list">${s.recent.map((t) => txRow(t, ref, { showDate: true })).join('')}</div>` : empty('receipt', 'Пока пусто')}</div>`;

  const hour = new Date().getHours();
  const hi = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const dateLine = new Date(`${today()}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return {
    html: `${topbar(`${hi}, ${esc(me.name.split(' ')[0])}`, esc(s.family.name), monthSwitch(m), dateLine)}
      <div class="grid-2">${hero}${tgBanner}${tiles}${donutCard}${barsCard}${plansCard}${goalsCard}${trendCard}${members}${recent}</div>`,
    mount(root) {
      bindMonth(root, () => state.month, (v) => { state.month = v; });
      root.addEventListener('click', (e) => {
        const g = e.target.closest('[data-go]');
        if (g) {
          if (g.dataset.type) state.txf = { type: g.dataset.type, category: '', q: '' };
          return go(g.dataset.go);
        }
        const c = e.target.closest('.legend [data-cat]');
        if (c && c.dataset.cat !== 'rest') { state.txf = { type: 'expense', category: c.dataset.cat === 'null' ? '' : c.dataset.cat, q: '' }; go('#/txs'); }
      });
      bindTxRows(root, s.recent);
    },
  };
};

// ---------- операции ----------
SCREENS.txs = async () => {
  const m = state.month;
  const f = state.txf;
  const ref = await loadRef();
  const qs = (offset) => new URLSearchParams({ month: m, limit: 60, offset, ...(f.type && { type: f.type }), ...(f.category && { category: f.category }), ...(f.q && { q: f.q }) });
  const data = await api(`/txs?${qs(0)}`);
  const items = [...data.items];
  const groups = (list, lastDate = null) => {
    let html = '';
    let prev = lastDate;
    for (const t of list) {
      if (t.date !== prev) {
        const daySum = items.filter((x) => x.date === t.date && x.type === 'expense').reduce((a, x) => a + x.amount, 0);
        html += `<div class="day-head"><span>${esc(dayLabel(t.date))}</span><span class="num">${daySum ? money(-daySum) : ''}</span></div>`;
        prev = t.date;
      }
      html += txRow(t, ref);
    }
    return html;
  };
  const types = [['', 'Все'], ['expense', 'Расходы'], ['income', 'Доходы'], ['transfer', 'Переводы'], ['goal', 'В цели']];
  const cats = ref.categories.filter((c) => !f.type || c.kind === f.type);
  return {
    html: `${topbar('Операции', `${data.total} ${plural(data.total, 'операция', 'операции', 'операций')}`, monthSwitch(m))}
      <div class="tiles"><div class="tile"><div class="t-label">Расходы</div><div class="t-val exp">${counted(-data.sums.expense)}</div></div>
        <div class="tile"><div class="t-label">Доходы</div><div class="t-val inc">${counted(data.sums.income, { sign: true })}</div></div></div>
      <div class="chips scroll">${types.map(([k, l]) => `<button class="chip ${f.type === k ? 'on' : ''}" data-ty="${k}">${l}</button>`).join('')}</div>
      <div class="two" style="margin-bottom:12px">
        <label class="search">${I.search}<input class="input" type="search" placeholder="Поиск по комментарию" value="${esc(f.q)}" data-q></label>
        <select class="input" data-cf ${f.type === 'transfer' || f.type === 'goal' ? 'disabled' : ''}><option value="">Все категории</option>${cats.map((c) => `<option value="${c.id}" ${String(c.id) === f.category ? 'selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="card">${items.length ? `<div class="list" data-list>${groups(items)}</div>
        ${data.total > items.length ? '<button class="btn block ghost" data-more style="margin-top:10px">Показать ещё</button>' : ''}`
    : empty('search', 'Ничего не найдено', '<span class="small">Попробуйте другой месяц или фильтр</span>')}</div>
      <div class="row" style="justify-content:center"><a class="link-btn" href="/api/export.csv?month=${m}" download>${I.download.replace('<svg', '<svg class="i"')} Скачать CSV за ${esc(monthLabel(m))}</a></div>`,
    mount(root) {
      bindMonth(root, () => state.month, (v) => { state.month = v; });
      bindTxRows(root, items);
      root.addEventListener('click', (e) => {
        const ty = e.target.closest('[data-ty]');
        if (ty) { f.type = ty.dataset.ty; f.category = ''; renderScreen(SCREENS.txs); }
      });
      $('[data-cf]', root).addEventListener('change', (e) => { f.category = e.target.value; renderScreen(SCREENS.txs); });
      let tmr;
      $('[data-q]', root).addEventListener('input', (e) => {
        clearTimeout(tmr);
        tmr = setTimeout(() => { f.q = e.target.value.trim(); renderScreen(SCREENS.txs, '', true).then(() => { const q = $('[data-q]'); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length); }); }, 350);
      });
      $('[data-more]', root)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const btn = e.target.closest('[data-more]');
        const next = await api(`/txs?${qs(items.length)}`);
        const last = items[items.length - 1]?.date;
        items.push(...next.items);
        $('[data-list]', root).insertAdjacentHTML('beforeend', groups(next.items, last));
        bindTxRows($('[data-list]', root), next.items);
        if (items.length >= next.total) btn.remove();
      }));
    },
  };
};

// ---------- бюджет и лимиты ----------
SCREENS.budget = async () => {
  const m = state.month;
  const [s, ref] = await Promise.all([api(`/summary?month=${m}`), loadRef(true)]);
  const fam = state.me.family;
  const amounts = new Map(s.categories.map((c) => [c.id, c.amount]));
  const live = ref.categories.filter((c) => !c.archived);
  const exp = live.filter((c) => c.kind === 'expense');
  const inc = live.filter((c) => c.kind === 'income');
  const archived = ref.categories.filter((c) => c.archived);
  const limitsSum = exp.reduce((a, c) => a + c.limit, 0);
  const catRow = (c) => {
    const spent = amounts.get(c.id) || 0;
    const p = c.limit ? spent / c.limit : 0;
    const cls = p > 1 ? 'over' : p >= 0.8 ? 'warn' : '';
    return `<div class="item" data-cat="${c.id}" style="flex-wrap:wrap">
      <div class="ico" style="background:color-mix(in srgb, ${esc(c.color)} 15%, var(--surface))">${esc(c.emoji)}</div>
      <div class="grow"><div class="row between"><span class="t ellipsis">${esc(c.name)}</span><span class="num small"><b>${money(spent)}</b>${c.limit ? ` <span class="muted">/ ${money(c.limit)}</span>` : ''}</span></div>
        ${c.limit ? `<div class="progress ${cls}" style="margin-top:6px"><i style="width:${Math.min(100, p * 100)}%"></i></div>
          <div class="tiny ${p > 1 ? 'exp' : 'muted'}" style="margin-top:4px">${p > 1 ? `превышен на ${money(spent - c.limit)}` : `осталось ${money(c.limit - spent)}`}</div>`
    : `<div class="tiny dim">${c.kind === 'expense' ? 'без лимита · нажмите, чтобы задать' : c.keywords ? esc(c.keywords.split(' ').slice(0, 5).join(', ')) : ''}</div>`}
      </div></div>`;
  };
  const p = s.budget ? s.spent / s.budget : 0;
  return {
    html: `${topbar('Бюджет', 'Лимиты на месяц по категориям', monthSwitch(m))}
      <div class="grid-2">
      <div class="card hero">
        <div class="hero-grid"><div class="grow">
          <div class="label">Бюджет на месяц</div>
          <div class="big">${s.budget ? counted(s.budget) : '—'}</div>
          <div class="meta">${fam.monthlyBudget ? 'задан вручную' : limitsSum ? 'сумма лимитов категорий' : 'не задан'} · потрачено ${money(s.spent)}</div>
        </div>${ring(p, { size: 120, stroke: 11, label: `${Math.round(p * 100)}%`, sub: 'потрачено', over: p > 1 })}</div>
        <form class="row" style="margin-top:14px" data-bf>
          <input class="input" name="budget" inputmode="decimal" placeholder="Например, 400 000" value="${fam.monthlyBudget || ''}">
          <button class="btn primary">Сохранить</button>
        </form>
        <div class="tiny muted" style="margin-top:8px">Оставьте пустым — бюджетом станет сумма лимитов (${money(limitsSum)}).</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Расходы</h2><button class="link-btn" data-add-cat="expense">+ Категория</button></div>
        <div class="list">${exp.map(catRow).join('')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Доходы</h2><button class="link-btn" data-add-cat="income">+ Категория</button></div>
        <div class="list">${inc.map(catRow).join('')}</div>
      </div>
      ${archived.length ? `<div class="card"><div class="card-head"><h2>Архив</h2></div>${archived.map((c) => `<div class="row between small" style="padding:6px 0"><span>${esc(c.emoji)} ${esc(c.name)}</span><button class="link-btn" data-restore="${c.id}">Вернуть</button></div>`).join('')}</div>` : ''}
      ${note('Ключевые слова помогают боту угадывать категорию: если в категории «Продукты» есть слово «magnum», то сообщение <span class="kbd">magnum 7000</span> попадёт туда.')}
      </div>`,
    mount(root) {
      bindMonth(root, () => state.month, (v) => { state.month = v; });
      $('[data-bf]', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const v = e.target.budget.value.trim();
        const n = v ? parseNum(v) : 0;
        if (!(n >= 0)) return toast('Неверная сумма', 'bad');
        busy($('button', e.target), async () => {
          try {
            const r = await api('/family', { method: 'PATCH', body: { monthlyBudget: n } });
            state.me.family = r.family; toast('Бюджет сохранён'); refresh();
          } catch (ex) { fail(ex); }
        });
      });
      root.addEventListener('click', async (e) => {
        const c = e.target.closest('[data-cat]');
        if (c) return openCategorySheet(ref.categories.find((x) => x.id === Number(c.dataset.cat)));
        const a = e.target.closest('[data-add-cat]');
        if (a) return openCategorySheet(null, a.dataset.addCat);
        const r = e.target.closest('[data-restore]');
        if (r) {
          try { await api(`/categories/${r.dataset.restore}`, { method: 'PATCH', body: { archived: false } }); dropRef(); refresh(); } catch (ex) { fail(ex); }
        }
      });
    },
  };
};

function openCategorySheet(c, kind = 'expense') {
  const k = c?.kind || kind;
  let color = c?.color || COLORS[0];
  const s = openSheet(c ? 'Категория' : k === 'income' ? 'Новая категория доходов' : 'Новая категория расходов', `<form autocomplete="off">
    <div class="row" style="align-items:flex-end">
      <input type="hidden" name="emoji" value="${esc(a?.emoji || '💳')}">
      <label class="field grow"><span>Название</span><input class="input" name="name" maxlength="40" required value="${esc(c?.name || '')}" ${c ? '' : 'autofocus'}></label>
    </div>
    ${k === 'expense' ? `<label class="field"><span>Лимит на месяц, ${esc(cur())}</span><input class="input" name="limit" inputmode="decimal" placeholder="Без лимита" value="${c?.limit || ''}"></label>` : ''}
    <label class="field"><span>Ключевые слова для бота</span><textarea class="input" name="keywords" rows="2" placeholder="через пробел: magnum галмарт базар">${esc(c?.keywords || '')}</textarea></label>
    <div class="field"><span>Цвет</span><div class="color-dots">${COLORS.map((x) => `<button type="button" data-color="${x}" style="background:${x}" class="${x === color ? 'on' : ''}" aria-label="Цвет ${x}"></button>`).join('')}</div></div>
    <div class="err" data-err></div>
    <div class="sheet-actions">${c ? '<button type="button" class="btn danger" data-del>Удалить</button>' : ''}<button class="btn primary">${c ? 'Сохранить' : 'Создать'}</button></div>
  </form>`);
  const f = $('form', s.el);
  f.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (b) { color = b.dataset.color; $$('[data-color]', f).forEach((x) => x.classList.toggle('on', x === b)); }
  });
  $('[data-del]', f)?.addEventListener('click', async () => {
    if (!(await confirmSheet('Если по категории уже были операции, она уйдёт в архив, а операции сохранятся.'))) return;
    try {
      const r = await api(`/categories/${c.id}`, { method: 'DELETE' });
      s.close(); dropRef(); toast(r.archived ? 'Категория в архиве' : 'Удалено'); refresh();
    } catch (ex) { fail(ex); }
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formObj(f);
    const body = { name: d.name.trim(), emoji: d.emoji.trim(), keywords: d.keywords.trim(), color, kind: k };
    if (k === 'expense') {
      body.limit = d.limit.trim() ? parseNum(d.limit) : 0;
      if (!(body.limit >= 0)) { $('[data-err]', f).textContent = 'Неверный лимит'; return; }
    }
    if (!body.name) { $('[data-err]', f).textContent = 'Укажите название'; return; }
    busy($('.btn.primary', f), async () => {
      try {
        await api(c ? `/categories/${c.id}` : '/categories', { method: c ? 'PATCH' : 'POST', body });
        s.close(); dropRef(); toast('Сохранено'); refresh();
      } catch (ex) { $('[data-err]', f).textContent = ex.message; }
    });
  });
}

// ---------- цели ----------
SCREENS.goals = async () => {
  const ref = await loadRef(true);
  const active = ref.goals.filter((g) => !g.done);
  const done = ref.goals.filter((g) => g.done);
  const card = (g) => {
    const p = g.target ? g.saved / g.target : 0;
    let need = '';
    if (!g.done && g.deadline && g.saved < g.target) {
      const [y, mm] = g.deadline.split('-').map(Number);
      const [cy, cm] = today().split('-').map(Number);
      const months = Math.max(1, (y - cy) * 12 + (mm - cm));
      need = g.deadline < today() ? '<span class="exp">срок прошёл</span>' : `≈ ${money(Math.ceil((g.target - g.saved) / months))} в месяц`;
    }
    return `<div class="card goal-card" data-goal="${g.id}">
      ${miniRing(p, { text: `${Math.min(999, Math.round(p * 100))}%` })}
      <div class="grow">
        <div class="row between"><span class="g-title ellipsis">${esc(g.emoji)} ${esc(g.title)}</span>${g.done ? '<span class="pill gold">достигнута</span>' : ''}</div>
        <div style="margin:3px 0"><b class="num" style="font-size:16px">${money(g.saved)}</b> <span class="muted small">из ${money(g.target)}</span></div>
        <div class="tiny muted">${[g.deadline ? `до ${fmtDate(g.deadline)}` : '', need, !g.done && g.saved < g.target ? `осталось ${money(g.target - g.saved)}` : ''].filter(Boolean).join(' · ')}</div>
        <div class="row" style="margin-top:10px;gap:8px">
          ${g.done ? '' : `<button class="btn sm primary" data-in="${g.id}">+ Пополнить</button>`}
          ${g.saved > 0 ? `<button class="btn sm" data-out="${g.id}">Снять</button>` : ''}
          <button class="btn sm ghost" data-edit="${g.id}" aria-label="Изменить">${I.pencil}</button>
        </div>
      </div></div>`;
  };
  return {
    html: `${topbar('Цели', `В целях: ${money(ref.totals.inGoals)}`, '<button class="btn primary sm" data-new>+ Цель</button>')}
      ${active.length ? `<div class="grid-2">${active.map(card).join('')}</div>` : `<div class="card">${empty('target', 'Целей пока нет', '<span class="small">Машина, отпуск, ремонт — поставьте цель и откладывайте понемногу.</span><br><button class="btn primary" data-new style="margin-top:14px">Создать цель</button>')}</div>`}
      ${done.length ? `<div class="day-head" style="padding:18px 2px 8px">Достигнутые</div><div class="grid-2">${done.map(card).join('')}</div>` : ''}
      ${note('В Telegram: <span class="kbd">цель машина 20000</span> — пополнить, <span class="kbd">из цели машина 5000</span> — снять.')}`,
    mount(root) {
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-new]')) return openGoalSheet();
        const ed = e.target.closest('[data-edit]');
        if (ed) return openGoalSheet(ref.goals.find((g) => g.id === Number(ed.dataset.edit)));
        const inn = e.target.closest('[data-in]');
        if (inn) return openContribute(ref.goals.find((g) => g.id === Number(inn.dataset.in)), 'in');
        const out = e.target.closest('[data-out]');
        if (out) return openContribute(ref.goals.find((g) => g.id === Number(out.dataset.out)), 'out');
      });
    },
  };
};

async function openGoalSheet(g = null) {
  const ref = await loadRef();
  let emoji = g?.emoji || '🎯';
  const accs = ref.accounts.filter((a) => !a.archived);
  const s = openSheet(g ? 'Цель' : 'Новая цель', `<form autocomplete="off">
    <div class="chips">${GOAL_EMOJI.map((x) => `<button type="button" class="chip ${x === emoji ? 'on' : ''}" data-e="${x}" style="font-size:18px;padding:5px 10px">${x}</button>`).join('')}</div>
    <label class="field"><span>Название</span><input class="input" name="title" maxlength="60" required value="${esc(g?.title || '')}" placeholder="Машина, отпуск, ремонт…" ${g ? '' : 'autofocus'}></label>
    <div class="two">
      <label class="field"><span>Сумма цели, ${esc(cur())}</span><input class="input" name="target" inputmode="decimal" required value="${g?.target || ''}" placeholder="2 000 000"></label>
      <label class="field"><span>Срок (необязательно)</span><input class="input" type="date" name="deadline" value="${g?.deadline || ''}"></label>
    </div>
    ${g ? '' : `<div class="two"><label class="field"><span>Уже отложено</span><input class="input" name="initial" inputmode="decimal" placeholder="0"></label>
      <label class="field"><span>Со счёта</span><select class="input" name="accountId">${accs.map((a) => `<option value="${a.id}" ${a.isDefault ? 'selected' : ''}>${esc(a.emoji || '')} ${esc(a.name)}</option>`).join('')}</select></label></div>`}
    ${g ? `<label class="row" style="margin:4px 0 14px"><span class="grow">Цель достигнута</span><span class="switch"><input type="checkbox" name="done" ${g.done ? 'checked' : ''}><i></i></span></label>` : ''}
    <div class="err" data-err></div>
    <div class="sheet-actions">${g ? '<button type="button" class="btn danger" data-del>Удалить</button>' : ''}<button class="btn primary">${g ? 'Сохранить' : 'Создать'}</button></div>
  </form>`);
  const f = $('form', s.el);
  f.addEventListener('click', (e) => {
    const b = e.target.closest('[data-e]');
    if (b) { emoji = b.dataset.e; $$('[data-e]', f).forEach((x) => x.classList.toggle('on', x === b)); }
  });
  $('[data-del]', f)?.addEventListener('click', async () => {
    if (!(await confirmSheet(`Цель «${esc(g.title)}» будет удалена. Отложенные ${money(g.saved)} вернутся на счета, с которых откладывались.`))) return;
    try { await api(`/goals/${g.id}`, { method: 'DELETE' }); s.close(); dropRef(); toast('Цель удалена'); refresh(); } catch (ex) { fail(ex); }
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formObj(f);
    const target = parseNum(d.target);
    if (!d.title.trim()) { $('[data-err]', f).textContent = 'Назовите цель'; return; }
    if (!(target > 0)) { $('[data-err]', f).textContent = 'Укажите сумму цели'; return; }
    const body = { title: d.title.trim(), emoji, target, deadline: d.deadline || null };
    if (g) body.done = !!f.done?.checked;
    else if (d.initial) { body.initial = parseNum(d.initial) || 0; body.accountId = Number(d.accountId); }
    busy($('.btn.primary', f), async () => {
      try {
        await api(g ? `/goals/${g.id}` : '/goals', { method: g ? 'PATCH' : 'POST', body });
        s.close(); dropRef(); toast(g ? 'Сохранено' : 'Цель создана'); refresh();
      } catch (ex) { $('[data-err]', f).textContent = ex.message; }
    });
  });
}

async function openContribute(g, dir) {
  const ref = await loadRef();
  const accs = ref.accounts.filter((a) => !a.archived);
  const s = openSheet(dir === 'in' ? `Пополнить «${g.title}»` : `Снять из «${g.title}»`, `<form autocomplete="off">
    <input class="amount-input num" name="amount" inputmode="decimal" placeholder="0" autofocus aria-label="Сумма">
    <div class="amount-cur">${dir === 'in' ? `осталось накопить ${money(Math.max(0, g.target - g.saved))}` : `в цели ${money(g.saved)}`}</div>
    ${dir === 'in' && g.target > g.saved ? `<div class="chips" style="justify-content:center">${[10000, 20000, 50000].filter((x) => x < g.target - g.saved).map((x) => `<button type="button" class="chip" data-q="${x}">${short(x)}</button>`).join('')}<button type="button" class="chip" data-q="${g.target - g.saved}">всё (${short(g.target - g.saved)})</button></div>` : ''}
    <label class="field"><span>${dir === 'in' ? 'Со счёта' : 'На счёт'}</span><select class="input" name="accountId">${accs.map((a) => `<option value="${a.id}" ${a.isDefault ? 'selected' : ''}>${esc(a.emoji || '')} ${esc(a.name)} · ${money(a.balance)}</option>`).join('')}</select></label>
    <div class="err" data-err></div>
    <button class="btn primary block">${dir === 'in' ? 'Отложить' : 'Снять'}</button>
  </form>`);
  const f = $('form', s.el);
  f.addEventListener('click', (e) => { const q = e.target.closest('[data-q]'); if (q) f.amount.value = q.dataset.q; });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseNum(f.amount.value);
    if (!(amount > 0)) { $('[data-err]', f).textContent = 'Введите сумму'; return; }
    busy($('.btn.primary', f), async () => {
      try {
        const r = await api(`/goals/${g.id}/contribute`, { method: 'POST', body: { amount, accountId: Number(f.accountId.value), direction: dir } });
        s.close(); dropRef();
        if (r.goal.done && !g.done) { confetti(); toast(`Цель «${g.title}» достигнута!`, '', 4000); } else toast(dir === 'in' ? `Отложено ${money(amount)}` : `Снято ${money(amount)}`);
        refresh();
      } catch (ex) { $('[data-err]', f).textContent = ex.message; }
    });
  });
}

// ---------- покупки на месяц ----------
SCREENS.plans = async () => {
  const m = state.month;
  const [p, s, ref] = await Promise.all([api(`/plans?month=${m}`), api(`/summary?month=${m}`), loadRef()]);
  const left = p.plans.filter((x) => !x.done);
  const done = p.plans.filter((x) => x.done);
  const leftSum = left.reduce((a, x) => a + x.amount, 0);
  const catOf = (id) => ref.categories.find((c) => c.id === id);
  const row = (x) => {
    const c = catOf(x.categoryId);
    return `<div class="item" data-plan="${x.id}">
      <button class="check ${x.done ? 'on' : ''}" data-check="${x.id}" aria-label="${x.done ? 'Вернуть в список' : 'Купили'}">${x.done ? I.check : ''}</button>
      <div class="grow"><div class="t ellipsis ${x.done ? 'done-t' : ''}">${esc(x.title)}</div><div class="s">${c ? `${esc(c.emoji)} ${esc(c.name)}` : 'без категории'}</div></div>
      <div class="amt num ${x.done ? 'dim' : ''}">${x.amount ? money(x.amount) : '—'}</div></div>`;
  };
  const isCur = m === curMonth();
  const after = s.budget ? s.remaining - leftSum : null;
  return {
    html: `${topbar('Покупки на месяц', 'Что нужно купить', monthSwitch(m))}
      <div class="card hero">
        <div class="row between"><div><div class="label">Осталось купить</div><div class="big">${counted(leftSum)}</div>
          <div class="meta">${done.length} из ${p.plans.length} куплено${after !== null && (isCur || m > curMonth()) ? ` · после покупок останется <b class="${after < 0 ? 'exp' : ''}">${money(after)}</b>` : ''}</div></div>
          ${miniRing(p.plans.length ? done.length / p.plans.length : 0, { size: 72, stroke: 8, text: `${done.length}/${p.plans.length}` })}</div>
      </div>
      <form class="card row" data-add style="gap:8px">
        <input class="input grow" name="title" maxlength="120" placeholder="Что купить?" required>
        <input class="input" name="amount" inputmode="decimal" placeholder="Сумма" style="width:110px">
        <button class="btn primary" aria-label="Добавить">${I.plus.replace('<svg', '<svg width="20" height="20"')}</button>
      </form>
      <div class="card">${p.plans.length ? `<div class="list">${left.map(row).join('')}${done.map(row).join('')}</div>` : empty('bag', 'Список пуст', '<span class="small">Добавьте, что нужно купить в этом месяце</span>')}</div>
      ${note('В Telegram: <span class="kbd">купить пылесос 80000</span>, <span class="kbd">нужно купить молоко</span>, а <span class="kbd">/plans</span> покажет список с кнопками «Купили».')}`,
    mount(root) {
      bindMonth(root, () => state.month, (v) => { state.month = v; });
      $('[data-add]', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target;
        const amount = f.amount.value.trim() ? parseNum(f.amount.value) : 0;
        if (!(amount >= 0)) return toast('Неверная сумма', 'bad');
        busy($('button', f), async () => {
          try {
            await api('/plans', { method: 'POST', body: { title: f.title.value.trim(), amount, month: m } });
            toast('Добавлено в список');
            await renderScreen(SCREENS.plans, '', true);
            $('[data-add] [name=title]')?.focus();
          } catch (ex) { fail(ex); }
        });
      });
      root.addEventListener('click', async (e) => {
        const ch = e.target.closest('[data-check]');
        if (ch) {
          e.stopPropagation();
          const x = p.plans.find((y) => y.id === Number(ch.dataset.check));
          if (x.done) {
            if (!(await confirmSheet(x.txId ? 'Вернуть в список? Записанная трата будет удалена.' : 'Вернуть в список?', { ok: 'Вернуть', danger: false, title: x.title }))) return;
            try { await api(`/plans/${x.id}`, { method: 'PATCH', body: { done: false } }); dropRef(); refresh(); } catch (ex) { fail(ex); }
            return;
          }
          return openBuySheet(x, ref);
        }
        const it = e.target.closest('[data-plan]');
        if (it) openPlanSheet(p.plans.find((y) => y.id === Number(it.dataset.plan)), ref);
      });
    },
  };
};

function openBuySheet(x, ref) {
  const accs = ref.accounts.filter((a) => !a.archived);
  const cats = ref.categories.filter((c) => c.kind === 'expense' && !c.archived);
  const selCat = x.categoryId ?? (cats.find((c) => /^другое$/i.test(c.name)) || cats[cats.length - 1])?.id;
  const s = openSheet(`Купили «${x.title}»?`, `<form autocomplete="off">
    <input class="amount-input num" name="amount" inputmode="decimal" placeholder="0" value="${x.amount || ''}" aria-label="Сколько заплатили">
    <div class="amount-cur">сколько заплатили, ${esc(cur())}</div>
    <div class="two">
      <label class="field"><span>Категория</span><select class="input" name="categoryId">${cats.map((c) => `<option value="${c.id}" ${c.id === selCat ? 'selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Со счёта</span><select class="input" name="accountId">${accs.map((a) => `<option value="${a.id}" ${a.isDefault ? 'selected' : ''}>${esc(a.emoji || '')} ${esc(a.name)}</option>`).join('')}</select></label>
    </div>
    <div class="err" data-err></div>
    <div class="sheet-actions"><button type="button" class="btn ghost" data-skip>Без траты</button><button class="btn primary">${I.check} Записать трату</button></div>
  </form>`);
  const f = $('form', s.el);
  const send = (body, btn) => busy(btn, async () => {
    try {
      await api(`/plans/${x.id}/buy`, { method: 'POST', body });
      s.close(); dropRef(); toast(body.amount ? `Куплено · ${money(-body.amount)}` : 'Отмечено'); refresh();
    } catch (ex) { $('[data-err]', f).textContent = ex.message; }
  });
  $('[data-skip]', f).addEventListener('click', (e) => send({ amount: 0 }, e.currentTarget));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseNum(f.amount.value);
    if (!(amount > 0)) { $('[data-err]', f).textContent = 'Введите сумму или нажмите «Без траты»'; return; }
    send({ amount, categoryId: Number(f.categoryId.value), accountId: Number(f.accountId.value) }, $('.btn.primary', f));
  });
}

function openPlanSheet(x, ref) {
  const cats = ref.categories.filter((c) => c.kind === 'expense' && !c.archived);
  const s = openSheet('Покупка', `<form autocomplete="off">
    <label class="field"><span>Что купить</span><input class="input" name="title" maxlength="120" value="${esc(x.title)}"></label>
    <div class="two">
      <label class="field"><span>Сумма</span><input class="input" name="amount" inputmode="decimal" value="${x.amount || ''}"></label>
      <label class="field"><span>Категория</span><select class="input" name="categoryId"><option value="">—</option>${cats.map((c) => `<option value="${c.id}" ${c.id === x.categoryId ? 'selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('')}</select></label>
    </div>
    <div class="err" data-err></div>
    <div class="sheet-actions"><button type="button" class="btn danger" data-del>Удалить</button><button class="btn primary">Сохранить</button></div>
  </form>`);
  const f = $('form', s.el);
  $('[data-del]', f).addEventListener('click', async () => {
    try { await api(`/plans/${x.id}`, { method: 'DELETE' }); s.close(); toast('Удалено'); refresh(); } catch (ex) { fail(ex); }
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = f.amount.value.trim() ? parseNum(f.amount.value) : 0;
    if (!(amount >= 0)) { $('[data-err]', f).textContent = 'Неверная сумма'; return; }
    busy($('.btn.primary', f), async () => {
      try {
        await api(`/plans/${x.id}`, { method: 'PATCH', body: { title: f.title.value.trim(), amount, categoryId: f.categoryId.value ? Number(f.categoryId.value) : null } });
        s.close(); toast('Сохранено'); refresh();
      } catch (ex) { $('[data-err]', f).textContent = ex.message; }
    });
  });
}

// ---------- счета и депозит ----------
SCREENS.accounts = async () => {
  const ref = await loadRef(true);
  const t = ref.totals;
  const live = ref.accounts.filter((a) => !a.archived);
  const arch = ref.accounts.filter((a) => a.archived);
  const accCard = (a) => {
    const saving = a.kind === 'deposit' || a.kind === 'savings';
    return `<div class="item" data-acc="${a.id}">
      <div class="ico">${KIND_ICON[a.kind] || I.coins}</div>
      <div class="grow"><div class="t">${esc(a.name)} ${a.isDefault ? '<span class="pill gold" style="font-size:10.5px;padding:2px 8px;margin-left:4px">основной</span>' : ''}</div>
        <div class="s">${KIND[a.kind]}${saving && a.rate ? ` · ${a.rate}% годовых · ≈ ${money(Math.round((Math.max(0, a.balance) * a.rate) / 100 / 12))}/мес` : ''}</div></div>
      <div class="amt num ${a.balance < 0 ? 'exp' : ''}">${money(a.balance)}</div></div>`;
  };
  return {
    html: `${topbar('Счета', 'Карты, наличные и депозит', '<button class="btn primary sm" data-new>+ Счёт</button>')}
      <div class="card hero"><div class="label">Всего денег у семьи</div><div class="big">${counted(t.net)}</div>
        <div class="meta">карты и наличные + депозит + цели</div></div>
      <div class="tiles">
        <div class="tile"><div class="t-label">${I.card}Доступно</div><div class="t-val">${counted(t.available)}</div></div>
        <div class="tile"><div class="t-label">${I.bank}Депозит</div><div class="t-val">${counted(t.deposit)}</div></div>
        <div class="tile" data-go="#/goals"><div class="t-label">${I.target}В целях</div><div class="t-val">${counted(t.inGoals)}</div></div>
        <div class="tile" data-transfer><div class="t-label">${I.transfer}Перевод</div><div class="t-val" style="font-size:15px;padding-top:5px;font-family:var(--sans)">между счетами</div></div>
      </div>
      <div class="card"><div class="list">${live.map(accCard).join('')}</div></div>
      ${arch.length ? `<div class="card"><div class="card-head"><h2 class="muted">Архив</h2></div><div class="list">${arch.map(accCard).join('')}</div></div>` : ''}
      ${note('В Telegram: <span class="kbd">в депозит 50000</span>, <span class="kbd">снял с депозита 20000</span>, <span class="kbd">снял наличные 10000</span>, <span class="kbd">кофе 1200 налом</span>.')}`,
    mount(root) {
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-new]')) return openAccountSheet();
        if (e.target.closest('[data-transfer]')) return openTxSheet({ type: 'transfer' });
        const g = e.target.closest('[data-go]');
        if (g) return go(g.dataset.go);
        const a = e.target.closest('[data-acc]');
        if (a) openAccountSheet(ref.accounts.find((x) => x.id === Number(a.dataset.acc)));
      });
    },
  };
};

function openAccountSheet(a = null) {
  const s = openSheet(a ? a.name : 'Новый счёт', `<form autocomplete="off">
    <div class="row" style="align-items:flex-end">
      <label class="field" style="width:76px"><span>Значок</span><input class="input center" name="emoji" maxlength="4" value="${esc(a?.emoji || '💳')}" style="font-size:22px;padding:8px"></label>
      <label class="field grow"><span>Название</span><input class="input" name="name" maxlength="40" value="${esc(a?.name || '')}" placeholder="Kaspi Gold, Halyk депозит…" ${a ? '' : 'autofocus'}></label>
    </div>
    <div class="two">
      <label class="field"><span>Тип</span><select class="input" name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === (a?.kind || 'card') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" data-rate><span>Ставка, % годовых</span><input class="input" name="rate" inputmode="decimal" value="${a?.rate || ''}" placeholder="14"></label>
    </div>
    <label class="field"><span>${a ? 'Фактический остаток сейчас' : 'Остаток сейчас'}, ${esc(cur())}</span><input class="input" name="balance" inputmode="decimal" value="${a ? a.balance : ''}" placeholder="0"></label>
    ${a ? '<p class="tiny muted" style="margin:-6px 0 12px">Если остаток в банке отличается — впишите реальный, Казына поправит баланс.</p>' : ''}
    ${a && !a.isDefault ? '<label class="row" style="margin:4px 0 14px"><span class="grow">Основной счёт (по умолчанию для трат)</span><span class="switch"><input type="checkbox" name="isDefault"><i></i></span></label>' : ''}
    <div class="err" data-err></div>
    <div class="sheet-actions">${a && !a.isDefault ? `<button type="button" class="btn danger" data-del>${a.archived ? 'Удалить' : 'В архив'}</button>` : ''}${a?.archived ? '<button type="button" class="btn" data-unarch>Вернуть</button>' : ''}<button class="btn primary">${a ? 'Сохранить' : 'Создать'}</button></div>
  </form>`);
  const f = $('form', s.el);
  const syncRate = () => { $('[data-rate]', f).style.visibility = ['deposit', 'savings'].includes(f.kind.value) ? 'visible' : 'hidden'; };
  syncRate();
  f.kind.addEventListener('change', () => {
    syncRate();
    if (!a && (!f.emoji.value || Object.values(KIND_EMOJI).includes(f.emoji.value))) f.emoji.value = KIND_EMOJI[f.kind.value];
  });
  $('[data-del]', f)?.addEventListener('click', async () => {
    if (!(await confirmSheet('Если по счёту были операции, он уйдёт в архив — история сохранится.', { ok: 'Да' }))) return;
    try { const r = await api(`/accounts/${a.id}`, { method: 'DELETE' }); s.close(); dropRef(); toast(r.archived ? 'Счёт в архиве' : 'Удалено'); refresh(); } catch (ex) { fail(ex); }
  });
  $('[data-unarch]', f)?.addEventListener('click', async () => {
    try { await api(`/accounts/${a.id}`, { method: 'PATCH', body: { archived: false } }); s.close(); dropRef(); refresh(); } catch (ex) { fail(ex); }
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formObj(f);
    const balance = d.balance.trim() ? parseNum(d.balance.replace('−', '-')) : 0;
    if (!d.name.trim()) { $('[data-err]', f).textContent = 'Укажите название'; return; }
    if (Number.isNaN(balance) || (!a && balance < 0)) { $('[data-err]', f).textContent = 'Неверный остаток'; return; }
    const body = { name: d.name.trim(), emoji: d.emoji.trim(), kind: d.kind, rate: parseNum(d.rate) || 0 };
    if (!a || balance !== a.balance) body.balance = balance;
    if (f.isDefault?.checked) body.isDefault = true;
    busy($('.btn.primary', f), async () => {
      try {
        await api(a ? `/accounts/${a.id}` : '/accounts', { method: a ? 'PATCH' : 'POST', body });
        s.close(); dropRef(); toast('Сохранено'); refresh();
      } catch (ex) { $('[data-err]', f).textContent = ex.message; }
    });
  });
}

// ---------- семья ----------
let tgPoll = null;
SCREENS.family = async () => {
  const [d] = await Promise.all([api('/family'), loadMe()]);
  const me = state.me;
  const bot = me.bot;
  const tg = me.user.telegram;
  const owner = d.isOwner;
  const tgCard = `<div class="card">
    <div class="card-head"><h2>Telegram</h2>${tg.linked ? '<span class="pill good">привязан</span>' : ''}</div>
    ${!bot.enabled ? '<div class="small muted">Бот ещё не подключён на сервере. Как только администратор добавит токен бота, здесь появится кнопка привязки.</div>'
    : tg.linked ? `<div class="small" style="margin-bottom:12px">Аккаунт ${tg.username ? `<b>@${esc(tg.username)}</b>` : ''} привязан. Пишите траты боту ${bot.username ? `<a href="https://t.me/${esc(bot.username)}" target="_blank" rel="noopener">@${esc(bot.username)}</a>` : ''} или в семейный чат с ботом.</div>
        <label class="row" style="margin-bottom:12px"><span class="grow small">Уведомлять о тратах семьи</span><span class="switch"><input type="checkbox" data-notify ${me.user.tgNotify ? 'checked' : ''}><i></i></span></label>
        <div class="row"><a class="btn sm primary" href="https://t.me/${esc(bot.username || '')}" target="_blank" rel="noopener">Открыть бота</a><button class="btn sm ghost" data-unlink>Отвязать</button></div>`
      : `<div class="small muted" style="margin-bottom:12px">Привяжите Telegram — и пишите траты прямо в чат: «продукты 5400», «такси 1500». Бот сам поймёт категорию и посчитает остаток.</div>
        <button class="btn primary block" data-link>${I.tg} Привязать Telegram</button><div data-link-box></div>`}
    <div style="margin-top:14px" class="tg-examples">${['продукты 5к', 'такси 1 500', 'кофе 1200 налом', '+300000 зарплата', 'в депозит 50000', 'цель машина 20000', 'купить пылесос 80000', 'вчера аптека 3400', '/balance'].map((x) => `<span class="kbd">${esc(x)}</span>`).join('')}</div>
    ${bot.enabled ? '<p class="tiny muted" style="margin:12px 0 0">Бота можно добавить в общий семейный чат — он запишет траты каждого, кто привязал аккаунт.</p>' : ''}
  </div>`;
  return {
    html: `${topbar('Семья', esc(d.family.name), `<div class="avatars">${d.members.slice(0, 4).map((m) => avatar(m, 'sm')).join('')}</div>`)}
      <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Участники · ${d.members.length}</h2></div>
        <div class="list">${d.members.map((m) => `<div class="item" ${owner && m.id !== me.user.id ? `data-member="${m.id}"` : ''} style="${owner && m.id !== me.user.id ? '' : 'cursor:default'}">
          ${avatar(m)}<div class="grow"><div class="t">${esc(m.name)}${m.id === me.user.id ? ' <span class="dim">(вы)</span>' : ''}${m.isOwner ? ' <span class="pill gold" style="font-size:10.5px;padding:2px 8px;margin-left:2px">глава</span>' : ''}</div>
          <div class="s ellipsis">${esc(m.email)}${m.telegram ? ` · ${m.tgUsername ? `@${esc(m.tgUsername)}` : 'Telegram'}` : ''}</div></div>
          <div class="amt num small">${money(m.spent)}<small>в этом месяце</small></div></div>`).join('')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Пригласить в семью</h2></div>
        <div class="small muted" style="margin-bottom:10px">Отправьте ссылку мужу, жене, родителям — после регистрации они сразу попадут в ваш общий бюджет.</div>
        <div class="code-box"><span class="grow" data-url>${esc(d.inviteUrl)}</span></div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap">
          <button class="btn sm primary" data-copy>${I.copy} Скопировать</button>
          ${navigator.share ? `<button class="btn sm" data-share>${I.share} Поделиться</button>` : ''}
          <a class="btn sm" href="https://t.me/share/url?url=${encodeURIComponent(d.inviteUrl)}&text=${encodeURIComponent('Присоединяйся к нашему семейному бюджету в Казыне')}" target="_blank" rel="noopener">${I.tg} Telegram</a>
          ${owner ? '<button class="btn sm ghost" data-reset>Новая ссылка</button>' : ''}
        </div>
      </div>
      ${tgCard}
      ${!owner && d.members.length > 1 ? '<div class="card"><button class="btn danger block" data-leave>Выйти из семьи</button><p class="tiny muted center" style="margin:8px 0 0">Для вас создастся новый пустой бюджет.</p></div>' : ''}
      </div>`,
    mount(root) {
      const url = d.inviteUrl;
      $('[data-copy]', root).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); } catch { toast(url, '', 5000); }
      });
      $('[data-share]', root)?.addEventListener('click', () => navigator.share({ title: 'Казына', text: 'Присоединяйся к нашему семейному бюджету', url }).catch(() => {}));
      $('[data-reset]', root)?.addEventListener('click', async () => {
        if (!(await confirmSheet('Старая ссылка перестанет работать.', { ok: 'Создать новую', danger: false }))) return;
        try { await api('/family/invite/reset', { method: 'POST' }); await loadMe(); refresh(); toast('Новая ссылка готова'); } catch (ex) { fail(ex); }
      });
      $('[data-notify]', root)?.addEventListener('change', async (e) => {
        try { const r = await api('/me', { method: 'PATCH', body: { tgNotify: e.target.checked } }); state.me.user = r.user; toast(e.target.checked ? 'Уведомления включены' : 'Уведомления выключены'); } catch (ex) { fail(ex); }
      });
      $('[data-unlink]', root)?.addEventListener('click', async () => {
        if (!(await confirmSheet('Бот перестанет принимать от вас траты.', { ok: 'Отвязать' }))) return;
        try { await api('/tg/link', { method: 'DELETE' }); await loadMe(); refresh(); } catch (ex) { fail(ex); }
      });
      $('[data-link]', root)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        try {
          const r = await api('/tg/link', { method: 'POST' });
          const box = $('[data-link-box]', root);
          if (r.url) window.open(r.url, '_blank', 'noopener');
          box.innerHTML = `<div class="small" style="margin-top:12px">${r.url ? `Если Telegram не открылся — <a href="${esc(r.url)}" target="_blank" rel="noopener">нажмите сюда</a> и нажмите «Запустить».` : ''}
            Или отправьте боту${r.username ? ` <b>@${esc(r.username)}</b>` : ''} команду:</div><div class="code-box" style="margin-top:8px"><span class="grow">/start ${esc(r.code)}</span></div>
            <div class="tiny muted" style="margin-top:8px"><span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:-2px"></span> Жду подтверждения от бота…</div>`;
          clearInterval(tgPoll);
          const started = Date.now();
          tgPoll = setInterval(async () => {
            if (state.route !== 'family' || Date.now() - started > 30 * 60e3) return clearInterval(tgPoll);
            const me2 = await api('/me').catch(() => null);
            if (me2?.user.telegram.linked) {
              clearInterval(tgPoll); state.me = me2; confetti(); toast('Telegram привязан'); refresh();
            }
          }, 3000);
        } catch (ex) { fail(ex); }
      }));
      $('[data-leave]', root)?.addEventListener('click', async () => {
        if (!(await confirmSheet('Вы выйдете из общего бюджета. Ваши прошлые операции останутся в семье.', { ok: 'Выйти' }))) return;
        try { await api('/family/leave', { method: 'POST' }); await loadMe(); dropRef(); go('#/'); toast('Вы вышли из семьи'); } catch (ex) { fail(ex); }
      });
      root.addEventListener('click', (e) => {
        const m = e.target.closest('[data-member]');
        if (!m) return;
        const mem = d.members.find((x) => x.id === Number(m.dataset.member));
        const s = openSheet(mem.name, `<div class="stack"><button class="btn block" data-owner>Сделать главой семьи</button><button class="btn block danger" data-kick>Исключить из семьи</button></div>`);
        $('[data-owner]', s.el).onclick = async () => {
          s.close();
          if (!(await confirmSheet(`${esc(mem.name)} станет главой семьи. Вы останетесь участником.`, { ok: 'Передать', danger: false }))) return;
          try { await api('/family/owner', { method: 'POST', body: { userId: mem.id } }); await loadMe(); refresh(); } catch (ex) { fail(ex); }
        };
        $('[data-kick]', s.el).onclick = async () => {
          s.close();
          if (!(await confirmSheet(`${esc(mem.name)} больше не увидит общий бюджет. Его прошлые операции останутся.`, { ok: 'Исключить' }))) return;
          try { await api(`/family/members/${mem.id}`, { method: 'DELETE' }); refresh(); toast('Участник исключён'); } catch (ex) { fail(ex); }
        };
      });
    },
  };
};

// ---------- настройки ----------
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
SCREENS.settings = async () => {
  const me = state.me;
  const u = me.user;
  const f = me.family;
  let color = u.color;
  const CUR = ['₸', '₽', '$', '€', 'сом', '₴'];
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return {
    html: `${topbar('Настройки')}
      <div class="grid-2">
      <form class="card" data-profile>
        <div class="card-head"><h2>Профиль</h2></div>
        <label class="field"><span>Имя</span><input class="input" name="name" maxlength="60" value="${esc(u.name)}"></label>
        <div class="field"><span>Ваш цвет на графиках</span><div class="color-dots">${COLORS.slice(0, 8).map((x) => `<button type="button" data-color="${x}" style="background:${x}" class="${x === color ? 'on' : ''}" aria-label="Цвет"></button>`).join('')}</div></div>
        <div class="small muted" style="margin-bottom:12px">${esc(u.email)}</div>
        <button class="btn primary">Сохранить</button>
      </form>
      <form class="card" data-fam>
        <div class="card-head"><h2>Семья</h2></div>
        <label class="field"><span>Название бюджета</span><input class="input" name="name" maxlength="60" value="${esc(f.name)}"></label>
        <label class="field"><span>Валюта</span><select class="input" name="currency">${CUR.map((c) => `<option ${c === f.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <button class="btn primary">Сохранить</button>
      </form>
      <form class="card" data-pass>
        <div class="card-head"><h2>Пароль</h2></div>
        <label class="field"><span>Текущий пароль</span><input class="input" type="password" name="oldPassword" autocomplete="current-password" required></label>
        <label class="field"><span>Новый пароль</span><input class="input" type="password" name="newPassword" autocomplete="new-password" minlength="6" required></label>
        <button class="btn">Сменить пароль</button>
      </form>
      <div class="card">
        <div class="card-head"><h2>Данные и приложение</h2></div>
        <div class="stack">
          <a class="btn block ghost" href="/api/export.csv" download>${I.download} Экспорт всех операций (CSV)</a>
          ${!standalone ? `<button class="btn block ghost" data-install>${I.phone} Установить на телефон</button>` : ''}
          <button class="btn block ghost" data-logout-all>${I.refresh} Выйти на всех устройствах</button>
          <button class="btn block danger" data-logout>${I.logout} Выйти</button>
        </div>
      </div>
      </div>
      <p class="tiny dim center">Казына · семейный бюджет</p>`,
    mount(root) {
      const pf = $('[data-profile]', root);
      pf.addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (b) { color = b.dataset.color; $$('[data-color]', pf).forEach((x) => x.classList.toggle('on', x === b)); }
      });
      pf.addEventListener('submit', (e) => {
        e.preventDefault();
        busy($('.btn', pf), async () => {
          try { const r = await api('/me', { method: 'PATCH', body: { name: pf.name.value.trim(), color } }); state.me.user = r.user; toast('Сохранено'); } catch (ex) { fail(ex); }
        });
      });
      const ff = $('[data-fam]', root);
      ff.addEventListener('submit', (e) => {
        e.preventDefault();
        busy($('.btn', ff), async () => {
          try { const r = await api('/family', { method: 'PATCH', body: { name: ff.name.value.trim(), currency: ff.currency.value } }); state.me.family = r.family; ensureShell(); toast('Сохранено'); } catch (ex) { fail(ex); }
        });
      });
      const pw = $('[data-pass]', root);
      pw.addEventListener('submit', (e) => {
        e.preventDefault();
        busy($('.btn', pw), async () => {
          try { await api('/me/password', { method: 'POST', body: formObj(pw) }); pw.reset(); toast('Пароль изменён. Другие устройства вышли из аккаунта.'); } catch (ex) { fail(ex); }
        });
      });
      $('[data-install]', root)?.addEventListener('click', async () => {
        if (installPrompt) { installPrompt.prompt(); installPrompt = null; return; }
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        openSheet('Установить Казыну', `<p class="muted">${ios ? 'В Safari нажмите «Поделиться» <b>⎋</b> внизу экрана → «На экран „Домой“».' : 'Откройте меню браузера (⋮) → «Установить приложение» или «Добавить на главный экран».'}</p>`);
      });
      $('[data-logout]', root).addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); logoutLocal(); });
      $('[data-logout-all]', root).addEventListener('click', async () => {
        if (!(await confirmSheet('Вы выйдете на всех телефонах и компьютерах.', { ok: 'Выйти везде' }))) return;
        await api('/auth/logout-all', { method: 'POST' }).catch(() => {}); logoutLocal();
      });
    },
  };
};
function logoutLocal() {
  state.me = null; state.ref = null; state.month = null;
  $('#app').innerHTML = '';
  go('#/login');
}

// ================= ВХОД / РЕГИСТРАЦИЯ / ПРИГЛАШЕНИЕ =================
function authLayout(inner) {
  $('#app').innerHTML = `<div class="auth"><div class="auth-box">
    <div class="auth-head"><img class="auth-logo" src="/icons/icon-192.png" alt=""><h1>Казына</h1><p class="tagline">Семейный бюджет, который считает сам</p></div>${inner}</div></div>`;
  return $('.auth-box');
}
const loginForm = (email = '') => `<form class="card" data-login autocomplete="on">
  <label class="field"><span>Email</span><input class="input" type="email" name="email" autocomplete="email" required value="${esc(email)}" inputmode="email"></label>
  <label class="field"><span>Пароль</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
  <div class="err" data-err></div><button class="btn primary block">Войти</button></form>`;
const registerForm = (invite = '') => `<form class="card" data-register autocomplete="on">
  <label class="field"><span>Ваше имя</span><input class="input" name="name" autocomplete="given-name" maxlength="60" required placeholder="Айгерим"></label>
  <label class="field"><span>Email</span><input class="input" type="email" name="email" autocomplete="email" required inputmode="email"></label>
  <label class="field"><span>Пароль</span><input class="input" type="password" name="password" autocomplete="new-password" minlength="6" required placeholder="минимум 6 символов"></label>
  ${invite ? `<input type="hidden" name="invite" value="${esc(invite)}">` : '<label class="field"><span>Название бюджета (необязательно)</span><input class="input" name="familyName" maxlength="60" placeholder="Семья Ахметовых"></label>'}
  <div class="err" data-err></div><button class="btn primary block">${invite ? 'Присоединиться' : 'Создать аккаунт'}</button></form>`;

async function afterAuth() {
  await loadMe();
  state.month = curMonth();
  $('#app').innerHTML = '';
  const pending = sessionStorage.getItem('pendingInvite');
  if (pending) { sessionStorage.removeItem('pendingInvite'); return go(`#/join/${pending}`); }
  go('#/');
}
function bindAuthForms(box) {
  $('[data-login]', box)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    busy($('.btn', f), async () => {
      try { await api('/auth/login', { method: 'POST', body: formObj(f) }); await afterAuth(); } catch (ex) { $('[data-err]', f).textContent = ex.message; }
    });
  });
  $('[data-register]', box)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    busy($('.btn', f), async () => {
      try {
        await api('/auth/register', { method: 'POST', body: formObj(f) });
        sessionStorage.removeItem('pendingInvite');
        await afterAuth();
        toast('Добро пожаловать в Казыну');
      } catch (ex) { $('[data-err]', f).textContent = ex.message; }
    });
  });
}

async function renderPublic(name, arg) {
  if (name === 'login') {
    const box = authLayout(`${loginForm()}<div class="switch-link">Нет аккаунта? <a href="#/register">Зарегистрироваться</a></div>`);
    bindAuthForms(box);
  } else if (name === 'register') {
    const box = authLayout(`<div class="features"><div>${I.tg}Траты через Telegram</div><div>${I.pie}Графики и лимиты</div><div>${I.users}Общий бюджет</div></div>
      ${registerForm()}<div class="switch-link">Уже есть аккаунт? <a href="#/login">Войти</a></div>`);
    bindAuthForms(box);
  } else if (name === 'join') {
    const code = arg.toUpperCase();
    let info;
    try { info = await api(`/invite/${encodeURIComponent(code)}`); } catch (e) {
      authLayout(`<div class="card center">${empty('link', esc(e.message), '<span class="small">Попросите прислать новую ссылку.</span>')}
        <a class="btn primary block" href="${state.me ? '#/' : '#/login'}">${state.me ? 'На главную' : 'Войти'}</a></div>`);
      return;
    }
    const head = `<div class="card invite-card"><div class="empty" style="padding:4px 0 0">${ILL.family}</div><div class="muted small">${esc(info.owner)} приглашает вас в общий бюджет</div>
      <div class="fam">«${esc(info.family)}»</div><div class="tiny muted">${info.members} ${plural(info.members, 'участник', 'участника', 'участников')}</div></div>`;
    if (state.me) {
      if (state.me.family.inviteCode === code) {
        const box = authLayout(`${head}<div class="card center small muted">Вы уже в этой семье</div><a class="btn primary block" href="#/">На главную</a>`);
        return box;
      }
      const box = authLayout(`${head}<div class="card small muted">Вы войдёте в общий бюджет и будете видеть траты всей семьи. ${state.me.isOwner ? 'Если вы глава текущей семьи и в ней есть другие участники, сначала передайте главенство.' : ''}</div>
        <div class="err center" data-err></div><button class="btn primary block" data-join>Присоединиться</button><div class="switch-link"><a href="#/">Не сейчас</a></div>`);
      $('[data-join]', box).addEventListener('click', (e) => busy(e.currentTarget, async () => {
        try {
          await api('/family/join', { method: 'POST', body: { code } });
          dropRef(); await loadMe(); $('#app').innerHTML = ''; go('#/'); confetti(); toast(`Вы в семье «${info.family}»`);
        } catch (ex) { $('[data-err]', box).textContent = ex.message; }
      }));
      return;
    }
    sessionStorage.setItem('pendingInvite', code);
    let mode = 'register';
    const paint = () => {
      const box = authLayout(`${head}${mode === 'register' ? registerForm(code) : loginForm()}
        <div class="switch-link">${mode === 'register' ? 'Уже есть аккаунт? <a href="#" data-sw>Войти</a>' : 'Нет аккаунта? <a href="#" data-sw>Зарегистрироваться</a>'}</div>`);
      bindAuthForms(box);
      $('[data-sw]', box).addEventListener('click', (e) => { e.preventDefault(); mode = mode === 'register' ? 'login' : 'register'; paint(); });
    };
    paint();
  }
}

// ---------- автообновление (траты из Telegram появляются сами) ----------
const canAutoRefresh = () => state.me && !$('.sheet-wrap') && document.visibilityState === 'visible' && !document.activeElement?.matches('input,textarea,select') && SCREENS[state.route];
document.addEventListener('visibilitychange', () => { if (canAutoRefresh()) { dropRef(); refresh(); } });
setInterval(() => { if (canAutoRefresh()) refresh(); }, 45000);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
router();
