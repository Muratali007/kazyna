// Самописные SVG-графики. Функции возвращают строку SVG; анимация запускается через animate(root).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Кольцо прогресса бюджета. pct — 0..∞ (больше 1 — перерасход). */
export function ring(pct, { size = 168, stroke = 14, label = '', sub = '', over = false } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  const off = c * (1 - p);
  return `<svg class="chart ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label)} ${esc(sub)}">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="ring-val${over ? ' over' : ''}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="49%" text-anchor="middle" class="ring-label">${esc(label)}</text>
    <text x="50%" y="63%" text-anchor="middle" class="ring-sub">${esc(sub)}</text>
  </svg>`;
}

/** Donut по категориям. items: [{value, color, name, emoji}] */
export function donut(items, { size = 180, stroke = 22, center = '', sub = '' } = {}) {
  const total = items.reduce((s, x) => s + x.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = items.length > 1 ? Math.min(4, c * 0.01) : 0;
  let acc = 0;
  const segs = total > 0 ? items.map((x, i) => {
    const len = (x.value / total) * c;
    const seg = `<circle class="donut-seg" data-tip="${esc(`${x.emoji || ''} ${x.name}`)}" data-i="${i}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      stroke="${esc(x.color)}" stroke-width="${stroke}" data-dash="${Math.max(0.01, len - gap)} ${c}"
      stroke-dashoffset="${-acc}" transform="rotate(-90 ${size / 2} ${size / 2})" style="stroke-dasharray:0 ${c};transition-delay:${i * 60}ms"/>`;
    acc += len;
    return seg;
  }).join('') : '';
  return `<svg class="chart donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Расходы по категориям">
    <circle class="donut-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    ${segs}
    <text x="50%" y="48%" text-anchor="middle" class="donut-center">${esc(center)}</text>
    <text x="50%" y="61%" text-anchor="middle" class="donut-sub">${esc(sub)}</text>
  </svg>`;
}

/** Столбики трат по дням. days: [{date, expense}], today — 'YYYY-MM-DD'. */
export function dayBars(days, { today = '', height = 150, fmt = String, avg = 0 } = {}) {
  const W = 340;
  const H = height;
  const pad = { t: 12, b: 20, l: 4, r: 4 };
  const max = Math.max(1, ...days.map((d) => d.expense), avg);
  const n = days.length;
  const bw = (W - pad.l - pad.r) / n;
  const ih = H - pad.t - pad.b;
  const bars = days.map((d, i) => {
    const h = d.expense > 0 ? Math.max(2, (d.expense / max) * ih) : 0;
    const x = pad.l + i * bw + bw * 0.18;
    const day = Number(d.date.slice(8));
    const cls = d.date === today ? 'bar today' : d.date > today ? 'bar future' : 'bar';
    return `<g data-tip="${esc(`${day}: ${fmt(d.expense)}`)}">
      <rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${ih}" fill="transparent"/>
      ${h ? `<rect class="${cls}" x="${x}" y="${pad.t + ih - h}" width="${bw * 0.64}" height="${h}" rx="${Math.min(3, bw * 0.3)}" style="animation-delay:${i * 14}ms"/>` : `<rect class="bar-empty" x="${x}" y="${pad.t + ih - 2}" width="${bw * 0.64}" height="2" rx="1"/>`}
    </g>`;
  }).join('');
  const labels = days.map((d, i) => {
    const day = Number(d.date.slice(8));
    if (![1, 8, 15, 22].includes(day) && i !== n - 1) return '';
    return `<text x="${pad.l + i * bw + bw / 2}" y="${H - 5}" text-anchor="middle" class="axis">${day}</text>`;
  }).join('');
  const avgY = pad.t + ih - (avg / max) * ih;
  const avgLine = avg > 0 ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${avgY}" y2="${avgY}" class="avg-line"/>
    <text x="${W - pad.r}" y="${avgY - 4}" text-anchor="end" class="axis">≈ ${esc(fmt(avg))}/день</text>` : '';
  return `<svg class="chart bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Траты по дням">${avgLine}${bars}${labels}</svg>`;
}

/** Тренд доходов и расходов по месяцам. rows: [{month, income, expense}] */
export function trendChart(rows, { height = 170, fmtShort = String, monthName = (m) => m } = {}) {
  const W = 340;
  const H = height;
  const pad = { t: 16, b: 22, l: 8, r: 8 };
  const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.expense]));
  const n = rows.length;
  const step = (W - pad.l - pad.r) / Math.max(1, n - 1);
  const ih = H - pad.t - pad.b;
  const pt = (i, v) => [pad.l + i * step, pad.t + ih - (v / max) * ih];
  const line = (key) => rows.map((r, i) => pt(i, r[key])).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = (key) => `${line(key)} L${pt(n - 1, 0)[0]},${pad.t + ih} L${pad.l},${pad.t + ih} Z`;
  const dots = (key, cls) => rows.map((r, i) => {
    const [x, y] = pt(i, r[key]);
    return `<circle class="dot ${cls}" cx="${x}" cy="${y}" r="3.5" style="animation-delay:${400 + i * 60}ms"/>`;
  }).join('');
  const hits = rows.map((r, i) => {
    const [x] = pt(i, 0);
    return `<rect x="${x - step / 2}" y="0" width="${step}" height="${H}" fill="transparent" data-tip="${esc(`${monthName(r.month)}: +${fmtShort(r.income)} / −${fmtShort(r.expense)}`)}"/>`;
  }).join('');
  const labels = rows.map((r, i) => `<text x="${pt(i, 0)[0]}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" class="axis">${esc(monthName(r.month))}</text>`).join('');
  const grid = [0.25, 0.5, 0.75, 1].map((k) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih * (1 - k)}" y2="${pad.t + ih * (1 - k)}" class="grid"/>`).join('');
  return `<svg class="chart trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Доходы и расходы по месяцам">
    <defs>
      <linearGradient id="trInc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="st-inc" stop-opacity=".22"/><stop offset="1" class="st-inc" stop-opacity="0"/></linearGradient>
      <linearGradient id="trExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="st-exp" stop-opacity=".18"/><stop offset="1" class="st-exp" stop-opacity="0"/></linearGradient>
    </defs>
    ${grid}
    <path class="area" d="${area('income')}" fill="url(#trInc)"/>
    <path class="area" d="${area('expense')}" fill="url(#trExp)"/>
    <path class="tline inc" d="${line('income')}" pathLength="1"/>
    <path class="tline exp" d="${line('expense')}" pathLength="1"/>
    ${dots('income', 'inc')}${dots('expense', 'exp')}${labels}${hits}
  </svg>`;
}

/** Мини-кольцо для целей и покупок. tone: '' (золото) | 'green'. */
export function miniRing(pct, { size = 64, stroke = 7, tone = '', text = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return `<svg class="chart mini-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="ring-val ${tone}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dy=".35em" text-anchor="middle" class="mini-ring-text">${esc(text)}</text>
  </svg>`;
}

/** Запускает анимацию всех графиков внутри root (после вставки в DOM). */
export function animate(root) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const go = () => {
    root.querySelectorAll('[data-off]').forEach((el) => { el.style.strokeDashoffset = el.dataset.off; });
    root.querySelectorAll('[data-dash]').forEach((el) => { el.style.strokeDasharray = el.dataset.dash; });
  };
  if (reduce) return go();
  requestAnimationFrame(() => requestAnimationFrame(go));
}
