// zikuy-report.js — ежемесячный отчёт "Списания товаров — частный рынок и небольшие сети"
// (зикуй Formula Road: −50% / השמדה). Запускается 1-го числа из /root/run-alert.sh
// (VPS cron) за прошлый месяц. Структура утверждена пользователем 2026-09-29, формат —
// только письмо (без вложений).
//
// Источники (живые, не из git — в /root/alerts-run их нет, путь через LIVE_DATA_DIR):
//   blank-history.json — сами бланки зикуя (items: sku/name/qty/option), хранится 92 дня
//   events.db          — zikuy_form_started/submitted/abandoned → время заполнения
// Из git (docs/): product-data.json + *-base.json → семья (fam) и срок годности,
//   formula-road-data.json → имена агентов.
//
// Методика времени (подтверждена 2026-09-10/29): пара = последний started для той же
// пары (агент|клиент) → submitted; abandoned сбрасывает. >30 мин — форма висела открытой,
// в статистику времени не входит. Экономия = зикуев × (10 мин − медиана) × 1.10 (+10% админ. ошибок с офисом), только медиана,
// без среднего (пользователь 2026-09-29) — 10 мин это нижняя оценка ручного бланка до приложения.
//
// Usage: node zikuy-report.js [--month=YYYY-MM] [--dry-run] [--to=a@b.com]
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const DATA = process.env.LIVE_DATA_DIR || path.join(__dirname, 'data');
const DOCS = path.join(__dirname, '..', 'docs');
const BASELINE_S = 600, LONG_S = 1800, ADMIN_BONUS = 0.10;

const NAVY = '#1C3D6B', GOLD = '#C9A227', INK = '#1F2937', MUTED = '#6B7280', LINE = '#E5E7EB', PAPER = '#F4F6FA', RED = '#B91C1C', GREEN = '#15803D';
const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const ilMonth = iso => new Date(Date.parse(iso)).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7);
function prevMonth(ym) { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const med = v => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const avg = v => v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const n0 = x => Math.round(x).toLocaleString('en-US');
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── справочники ─────────────────────────────────────────────────────────────
function loadCatalog() {
  const fam = {}, shelf = {};
  const pd = readJson(path.join(DOCS, 'product-data.json'));
  for (const [k, v] of Object.entries(pd.products || pd)) { if (v?.fam) fam[k] = v.fam; if (v?.shelfLife != null) shelf[k] = v.shelfLife; }
  for (const f of ['kapua-base', 'halavi-base', 'dagim-base', 'dagim-yavesh-base']) {
    try {
      const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.makat && o.fam && !fam[o.makat]) fam[o.makat] = o.fam; Object.values(o).forEach(walk); } };
      walk(readJson(path.join(DOCS, f + '.json')));
    } catch (_) { /* файла нет — просто меньше покрытие */ }
  }
  // ICE (502xxx/503xxx) нет в каталоге планограммы FORMULA — это мишпахти (пользователь 2026-09-29)
  const famOf = sku => fam[sku] || (/^50[23]\d{3}$/.test(sku) ? 'ICE מוצרים משפחתיים' : '—');
  return { famOf, shelf };
}
function loadAgentNames() {
  const names = {};
  const team = {};
  try { const x = readJson(path.join(DOCS, 'formula-road-data.json')); for (const [tm, arr] of Object.entries((x.data || x).agentsByManager || {})) for (const a of arr) { names[a.agentCode] = a.agentName; team[a.agentCode] = tm; } } catch (_) {}
  try {
    const mgrs = readJson(path.join(DATA, 'managers.json'));
    for (const m of mgrs) names['M:' + m.id] = m.nameHe || m.name;
    // начальник агента = менеджер, чья team совпадает с ключом agentsByManager
    for (const [code, tm] of Object.entries(team)) { const b = mgrs.find(m => m.team === tm); names['B:' + code] = b ? (b.nameHe || b.name) : tm; }
  } catch (_) {}
  return names;
}

// ── время заполнения из events.db ───────────────────────────────────────────
function loadTimings(month) {
  const D = require('better-sqlite3');
  const db = new D(path.join(DATA, 'events.db'), { readonly: true });
  const rows = db.prepare(`select ts, event_type e, agent_code a, manager_id m, cust_id c, json_extract(props,'$.itemCount') ic
    from events where event_type in ('zikuy_form_started','zikuy_form_submitted','zikuy_form_abandoned') order by ts`).all();
  db.close();
  const open = {}, pairs = [];
  let submitted = 0, unattributed = 0, unpaired = 0;
  for (const r of rows) {
    const who = r.a || (r.m ? 'M:' + r.m : null);
    const inMonth = ilMonth(r.ts) === month;
    if (!who) { if (inMonth && r.e === 'zikuy_form_submitted') unattributed++; continue; }
    const k = who + '|' + r.c;
    if (r.e === 'zikuy_form_started') open[k] = r.ts;
    else if (r.e === 'zikuy_form_abandoned') delete open[k];
    else {
      if (inMonth) submitted++;
      if (open[k]) { if (inMonth) pairs.push({ who, s: (Date.parse(r.ts) - Date.parse(open[k])) / 1000, items: r.ic }); delete open[k]; }
      else if (inMonth) unpaired++;
    }
  }
  return { pairs, submitted, unattributed, unpaired };
}

// ── фактический % возвратов (Power BI, 90 дней) ────────────────────────────
// Та же формула, что % זיכויים в форме зикуя (/api/client-returns zikuyDax, index.js):
// |SUM ₪ השמדות| / SUM ₪ -מכר-, те же исключения SKU и агентов, окно today-90..today.
// Один запрос: по SKU, только по клиентам с зикуем в этом месяце → в семьи через famOf.
const RET_EXCLUDED_SKUS = ['0', '915001', '915002', '916000', '916001', '916002', '916003', '916004', '916005', '916006', '916007', '916008', '916009', '916010', '916011'];
async function fetchReturnRates(custIds) {
  const { executeDax } = require('./powerbi');
  const d90 = new Date(Date.now() - 90 * 86400000), t = new Date();
  const rows = await executeDax(`
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח], ALL_PARTS[מק'ט], ALL_PARTS[תאור משפחת מוצר]),
    "machlaka", LOOKUPVALUE(ADIFUT[מחלקה], ADIFUT[תאור משפחה], ALL_PARTS[תאור משפחת מוצר]),
    "zikuy", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]), ALL_PARTS[ASHMADOT] = "השמדות", NOT(ALL_PARTS[שם סוכן] IN {"‭באילא יסוי‬", "‭יללכ‬"}), NOT(ISBLANK(ALL_PARTS[שם סוכן]))),
    "brutto", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]), ALL_PARTS[ASHMADOT] = "-מכר-")
  ),
  ALL_PARTS[מספר לקוח] IN {${custIds.map(c => `"${c}"`).join(', ')}},
  NOT(ALL_PARTS[מק'ט] IN {${RET_EXCLUDED_SKUS.map(s => `"${s}"`).join(', ')}}),
  ALL_PARTS[תאריך] >= DATE(${d90.getFullYear()},${d90.getMonth() + 1},${d90.getDate()}),
  ALL_PARTS[תאריך] <= DATE(${t.getFullYear()},${t.getMonth() + 1},${t.getDate()})
)`);
  // клиент × SKU → суммируем в обе стороны (по SKU для семей/топа, по клиенту для блока клиентов)
  const bySku = {}, byCust = {}, skuDept = {};
  const add = (m, k, z, b) => { const x = m[k] = m[k] || { z: 0, b: 0 }; x.z += z; x.b += b; };
  for (const r of rows) {
    const z = Math.abs(r['[zikuy]'] || 0), b = r['[brutto]'] || 0, s = String(r["ALL_PARTS[מק'ט]"]);
    add(bySku, s, z, b);
    add(byCust, String(r['ALL_PARTS[מספר לקוח]']), z, b);
    if (r['[machlaka]']) skuDept[s] = String(r['[machlaka]']).trim();
  }
  return { bySku, byCust, skuDept };
}
const RET_ALERT = 10; // % возвратов от которого подсвечиваем красным (пользователь 2026-09-29)
// "12.3%" или "—"; ≥ порога — красным жирным
function retCell(x) {
  if (!x || !x.b) return '—';
  const p = 100 * x.z / x.b;
  return p >= RET_ALERT ? `<b style="color:${RED}">${p.toFixed(1)}%</b>` : `${p.toFixed(1)}%`;
}

// ── агрегация ───────────────────────────────────────────────────────────────
function summarize(blanks, famOf, shelf, weighted) {
  const w = { z: 0, h: 0, sku: {} };
  const t = { blanks: blanks.length, z: 0, h: 0, lines: 0, skuPerBlank: [], onlyZ: 0, onlyH: 0, mixed: 0 };
  const fam = {}, sku = {}, cust = {}, agent = {};
  for (const e of blanks) {
    let hz = false, hh = false;
    t.skuPerBlank.push(new Set(e.items.map(i => i.sku)).size);
    const a = agent[e.agentCode] = agent[e.agentCode] || { name: e.agentName, blanks: 0, skus: [], qty: 0 };
    a.blanks++; a.skus.push(new Set(e.items.map(i => i.sku)).size);
    const c = cust[e.custId] = cust[e.custId] || { name: e.custName, city: e.city, qty: 0, blanks: 0, agentCode: e.agentCode, agentName: e.agentName };
    c.blanks++;
    for (const it of e.items) {
      const q = Number(it.qty) || 0, isZ = it.option === '-50%';
      if (isZ) hz = true; else hh = true;
      // весовой товар (кг) не складываем со штуками — отдельный блок (пользователь 2026-09-29)
      if (weighted.has(it.sku)) {
        w[isZ ? 'z' : 'h'] += q;
        const ws = w.sku[it.sku] = w.sku[it.sku] || { name: it.name, fam: famOf(it.sku), z: 0, h: 0, custs: new Set() };
        ws[isZ ? 'z' : 'h'] += q; ws.custs.add(e.custId);
        continue;
      }
      t[isZ ? 'z' : 'h'] += q;
      t.lines++; a.qty += q; c.qty += q;
      const f = fam[famOf(it.sku)] = fam[famOf(it.sku)] || { z: 0, h: 0, custs: new Set() };
      f[isZ ? 'z' : 'h'] += q; f.custs.add(e.custId);
      const s = sku[it.sku] = sku[it.sku] || { name: it.name, fam: famOf(it.sku), shelf: shelf[it.sku], z: 0, h: 0, custs: new Set() };
      s[isZ ? 'z' : 'h'] += q; s.custs.add(e.custId);
    }
    if (hz && hh) t.mixed++; else if (hz) t.onlyZ++; else t.onlyH++;
  }
  t.total = t.z + t.h;
  return { t, fam, sku, cust, agent, w };
}
// Весовой = SKU, у которого во всей истории зикуя хоть раз было дробное кол-во (кг).
// ponytail: эвристика по данным, апгрейд когда появится признак "весовой" в каталоге.
const weightedSkus = all => new Set(all.flatMap(e => e.items).filter(i => !Number.isInteger(Number(i.qty))).map(i => i.sku));

// ── HTML ────────────────────────────────────────────────────────────────────
const H = (title, sub = '') => `
  <tr><td style="padding:26px 14px 8px">
    <div style="font-family:Georgia,serif;font-size:17px;color:${NAVY};font-weight:bold;display:inline-block;border-bottom:2px solid ${GOLD};padding-bottom:4px">${title}</div>
    ${sub ? `<div style="font-size:12px;color:${MUTED};padding-top:6px">${sub}</div>` : ''}
  </td></tr>`;
function table(head, rows, alignRight = []) {
  const th = head.map((h, i) => `<th style="padding:7px 4px;background:${NAVY};color:#fff;font-size:10px;font-weight:bold;text-align:${alignRight.includes(i) ? 'right' : 'left'}">${h}</th>`).join('');
  const tr = rows.map((r, ri) => `<tr>${r.map((c, i) => `<td ${i === 0 ? 'dir="auto"' : ''} style="padding:6px 4px;border-bottom:1px solid ${LINE};background:${ri % 2 ? '#FAFBFD' : '#fff'};font-size:11px;color:${INK};text-align:${alignRight.includes(i) ? 'right' : 'left'}">${c}</td>`).join('')}</tr>`).join('');
  return `<tr><td style="padding:0 14px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${LINE};border-radius:8px;overflow:hidden;font-family:Arial,sans-serif">${th}${tr}</table></td></tr>`;
}
const P = html => `<tr><td style="padding:4px 14px;font-size:13px;color:${INK};line-height:1.6">${html}</td></tr>`;
const kpi = (label, value, sub = '') => `<td style="padding:12px 8px;text-align:center;border:1px solid ${LINE};background:#fff;width:25%">
  <div style="font-size:11px;color:${MUTED}">${label}</div><div style="font-size:20px;font-weight:900;color:${NAVY};padding-top:4px">${value}</div>${sub ? `<div style="font-size:11px;color:${MUTED};padding-top:2px">${sub}</div>` : ''}</td>`;
// ── кольцевые диаграммы долей (пользователь 2026-09-29) ─────────────────────
// Почтовики (Gmail/Outlook) вырезают SVG → рисуем SVG, sharp делает PNG, в письмо идёт
// как inline cid-вложение (как лого). Текста на картинке нет — подписи HTML-легендой рядом
// (иврит в librsvg ненадёжен). Цвета — слоты dataviz-палитры по порядку, валидированы.
const C_Z = '#2a78d6', C_H = '#eb6834', C_OTHER = '#c9c8c3';
const FAM_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
function donutSvg(parts, px) {
  const r = px / 2, ri = r * 0.58, tot = parts.reduce((a, p) => a + p.v, 0);
  const pt = (rad, a) => `${(r + rad * Math.cos(a)).toFixed(2)},${(r + rad * Math.sin(a)).toFixed(2)}`;
  let a0 = -Math.PI / 2;
  const paths = parts.filter(p => p.v > 0).map(p => {
    const a1 = a0 + 2 * Math.PI * Math.min(p.v / tot, 0.99999), large = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M${pt(r, a0)} A${r},${r} 0 ${large} 1 ${pt(r, a1)} L${pt(ri, a1)} A${ri},${ri} 0 ${large} 0 ${pt(ri, a0)} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${p.color}" stroke="#ffffff" stroke-width="${(px / 80).toFixed(1)}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${paths.join('')}</svg>`;
}
// Диаграмма + легенда одной строкой-таблицей; картинка регистрируется в charts для вложения.
function donutBlock(charts, id, parts, unit = 'шт.') {
  charts.push({ id, svg: donutSvg(parts, 320) });
  const tot = parts.reduce((a, p) => a + p.v, 0);
  const legend = parts.map(p => `<tr><td style="padding:4px 8px 4px 0;vertical-align:middle"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${p.color}"></span></td>
    <td dir="auto" style="padding:4px 8px 4px 0;font-size:12px;color:${INK}"><bdi>${esc(p.label)}</bdi></td>
    <td style="padding:4px 0;font-size:13px;font-weight:bold;color:${INK};text-align:right;white-space:nowrap">${pct(p.v, tot)}%</td>
    <td style="padding:4px 0 4px 8px;font-size:11px;color:${MUTED};text-align:right;white-space:nowrap">${n0(p.v)} ${unit}</td></tr>`).join('');
  return `<tr><td style="padding:6px 14px 10px"><table role="presentation" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif"><tr>
    <td style="padding-right:12px;vertical-align:middle"><img src="cid:${id}" width="110" height="110" alt="" style="display:block" /></td>
    <td style="vertical-align:middle"><table role="presentation" cellpadding="0" cellspacing="0">${legend}</table></td>
  </tr></table></td></tr>`;
}

// "64% / 36%" — внутренний раздел штук (уценка / השמדה), в сумме 100%; השמדה ≥70% красным
const split = x => { const tot = x.z + x.h, hp = pct(x.h, tot); return `<span style="white-space:nowrap">${100 - hp}% / <b style="color:${hp >= 70 ? RED : INK}">${hp}%</b></span>`; };
const delta = (cur, prev) => { if (!prev) return ''; const d = Math.round(100 * (cur - prev) / prev); return `<span style="color:${d > 0 ? RED : GREEN}">${d > 0 ? '+' : ''}${d}% к пр. месяцу</span>`; };

function buildHtml(month, cur, prev, tm, names, ret) {
  const { t, fam, sku, cust, agent, w } = cur;
  const [y, m] = month.split('-').map(Number);
  const title = `${MONTHS_RU[m - 1]} ${y}`;

  // 1. итог
  const charts = [];
  // что это за статистика — пользователь 2026-09-29: чтобы не путали с общими возвратами
  let html = `<tr><td style="padding:18px 14px 0"><div style="background:#FFF8E6;border:1px solid #F1D48A;border-radius:8px;padding:10px 12px;font-size:12px;color:${INK};line-height:1.6">
    <b>Что в этом отчёте:</b> только статистика <b>заявок на зикуй</b> из Formula Road — частный рынок и небольшой сетевой формат, то есть клиенты, где зикуй <b>не</b> делается документом самого клиента. Крупные сети со своими документами сюда не входят.<br>
    <b>% возвратов</b> — фактический, из Power BI: השמדות ₪ / продажи брутто ₪ за последние 90 дней, по клиентам этого отчёта (та же формула, что в форме зикуя). От ${RET_ALERT}% — красным.${ret ? '' : ` <b style="color:${RED}">В этот раз Power BI не ответил — % возвратов в отчёте нет.</b>`}
  </div></td></tr>`;
  html += H('1. Итог месяца') + `<tr><td style="padding:0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif"><tr>
    ${kpi('Бланков зикуя', n0(t.blanks), delta(t.blanks, prev?.t.blanks))}
    ${kpi('Штук (без весового)', n0(t.total), delta(t.total, prev?.t.total))}
    ${kpi('Уценка −50%', n0(t.z), `${pct(t.z, t.total)}% всех списаний`)}
    ${kpi('השמדה', n0(t.h), `${pct(t.h, t.total)}% всех списаний`)}
  </tr></table></td></tr>`;
  html += donutBlock(charts, 'pie-split', [{ label: 'Уценка −50%', v: t.z, color: C_Z }, { label: 'השמדה', v: t.h, color: C_H }]);
  html += P(`<b>Проще говоря:</b> из каждых 10 списанных штук ≈${Math.round(t.z / t.total * 10)} ушли с уценкой 50% и ≈${Math.round(t.h / t.total * 10)} уничтожены. Все штуки и доли в отчёте — только штучный товар; весовой (${(w.z + w.h).toFixed(1)} кг) — отдельным блоком после топа артикулов.`);
  html += P(`В среднем <b>${avg(t.skuPerBlank).toFixed(1)}</b> артикула на бланк (медиана ${med(t.skuPerBlank)}), ${avg(blanksQty(cur)).toFixed(0)} шт. на бланк. Состав бланков: только −50% — ${t.onlyZ}, только השמדה — ${t.onlyH}, смешанные — ${t.mixed}.`
    + (prev ? ` Прошлый месяц: ${n0(prev.t.total)} шт., из них в השמדה ${pct(prev.t.h, prev.t.total)}%.` : ''));

  // 2. семьи
  const fams = Object.entries(fam).sort((a, b) => (b[1].z + b[1].h) - (a[1].z + a[1].h));
  html += H('2. Семьи товаров', `<b>Доля в списаниях</b> — какая часть всех списанных штук месяца приходится на семью (все семьи вместе = 100%).<br><b>Уценка / השמדה</b> — как делятся штуки самой семьи (в каждой строке вместе = 100%). השמדה от 70% — красным: уценка не спасает.`);
  const top5 = fams.slice(0, 5), restQ = fams.slice(5).reduce((a, [, f]) => a + f.z + f.h, 0);
  html += donutBlock(charts, 'pie-fam', [...top5.map(([k, f], i) => ({ label: k, v: f.z + f.h, color: FAM_COLORS[i] })), ...(restQ ? [{ label: 'Прочие семьи', v: restQ, color: C_OTHER }] : [])]);
  // % возвратов семьи = Σ по её SKU (из того же PBI-запроса)
  const famRet = {};
  if (ret) for (const [k, s] of Object.entries(sku)) { const r = ret.bySku[k]; if (!r) continue; const x = famRet[s.fam] = famRet[s.fam] || { z: 0, b: 0 }; x.z += r.z; x.b += r.b; }
  const retHead = ret ? ['% возвр. 90 дн'] : [];
  html += table(['Семья', 'Штук', 'Доля в списаниях', 'Уценка / השמדה', ...retHead],
    fams.slice(0, 15).map(([k, f]) => [esc(k), n0(f.z + f.h), pct(f.z + f.h, t.total) + '%', split(f), ...(ret ? [retCell(famRet[k])] : [])]), [1, 2, 3, 4]);

  // 3. SKU — топ-5 по каждой מחלקה (пользователь 2026-09-29); без PBI отдела не знаем → общий топ-7
  const skus = Object.entries(sku).sort((a, b) => (b[1].z + b[1].h) - (a[1].z + a[1].h));
  const skuRow = ([k, s]) => [`${k} · ${esc(s.name.slice(0, 32))}`, n0(s.z + s.h), split(s), ...(ret ? [retCell(ret.bySku[k])] : []), s.shelf ?? '—'];
  const skuHead = ['Артикул', 'Штук', 'Уценка / השמדה', ...retHead, 'Срок, дн'];
  const skuAlign = ret ? [1, 2, 3, 4] : [1, 2, 3];
  if (ret) {
    const byDept = {};
    for (const e of skus) (byDept[ret.skuDept[e[0]] || 'לא מוגדר'] = byDept[ret.skuDept[e[0]] || 'לא מוגדר'] || []).push(e);
    const depts = Object.entries(byDept).map(([d, list]) => [d, list, list.reduce((a, [, s]) => a + s.z + s.h, 0)]).sort((a, b) => b[2] - a[2]);
    html += H('3. Топ-5 артикулов по каждой מחלקה', 'отделы по убыванию списанных штук. «Уценка / השמדה» — как делятся штуки самого артикула.');
    for (const [d, list, q] of depts) {
      html += P(`<b><bdi>${esc(d)}</bdi></b> — ${n0(q)} шт. (${pct(q, t.total)}% всех списаний)`);
      html += table(skuHead, list.slice(0, 5).map(skuRow), skuAlign);
    }
  } else {
    html += H('3. Топ-7 артикулов', '«Уценка / השמדה» — как делятся штуки самого артикула.');
    html += table(skuHead, skus.slice(0, 7).map(skuRow), skuAlign);
  }

  // 3а. весовой товар — отдельно, в кг
  const wskus = Object.entries(w.sku).sort((a, b) => (b[1].z + b[1].h) - (a[1].z + a[1].h));
  if (wskus.length) {
    html += H('Весовой товар — отдельно, кг', `всего ${(w.z + w.h).toFixed(1)} кг: уценка ${w.z.toFixed(1)} кг / השמדה ${w.h.toFixed(1)} кг (${split(w)}). В штуки и доли выше не входит.`);
    html += table(['Артикул', 'Семья', 'Кг', 'Уценка / השמדה', 'Клиентов'],
      wskus.map(([k, s]) => [`${k} · ${esc(s.name.slice(0, 32))}`, esc(s.fam), (s.z + s.h).toFixed(1), split(s), s.custs.size]), [2, 3, 4]);
  }

  // 4. закономерности
  const bucket = {}; for (const [, s] of skus) { const k = s.shelf == null ? 'нет данных' : s.shelf <= 30 ? 'до 30 дн' : s.shelf <= 60 ? '31–60 дн' : 'больше 60 дн'; const b = bucket[k] = bucket[k] || { z: 0, h: 0, n: 0 }; b.z += s.z; b.h += s.h; b.n++; }
  // иврит внутри русской фразы переставляет слова (BiDi) — каждая семья отдельной строкой в <bdi>
  const famLines = list => list.length ? list.map(([k, f]) => `<br>• <bdi>${esc(k)}</bdi> — ${pct(f.h, f.z + f.h)}% штук этой семьи уничтожено (из ${n0(f.z + f.h)} шт.)`).join('') : '<br>• нет';
  html += H('4. Закономерности');
  html += P(`<b>Уценка не спасает</b> — больше 70% уходит в уничтожение (от 20 шт.):${famLines(fams.filter(([, f]) => f.z + f.h >= 20 && pct(f.h, f.z + f.h) >= 70))}`);
  html += P(`<b>Уценка работает</b> — не больше 30% в уничтожение (от 100 шт.):${famLines(fams.filter(([, f]) => f.z + f.h >= 100 && pct(f.h, f.z + f.h) <= 30))}`);
  html += P('<b>Срок годности:</b> как делятся штуки товаров с разным сроком — уценка против השמדה.');
  html += table(['Срок годности', 'Артикулов', 'Штук', 'Уценка / השמדה'],
    ['до 30 дн', '31–60 дн', 'больше 60 дн', 'нет данных'].filter(k => bucket[k]).map(k => [k, bucket[k].n, n0(bucket[k].z + bucket[k].h), split(bucket[k])]), [1, 2, 3]);

  // 5. клиенты
  const cs = Object.values(cust).sort((a, b) => b.qty - a.qty);
  const share = k => pct(cs.slice(0, k).reduce((a, c) => a + c.qty, 0), t.total);
  html += H('5. Клиенты', `всего ${cs.length} клиентов · топ-10 = ${share(10)}% штук · топ-50 = ${share(50)}%`);
  // клиенты с фактическим % возвратов от порога — с агентом и начальником (пользователь 2026-09-29)
  if (ret) {
    const hot = Object.entries(cust).map(([id, c]) => ({ ...c, r: ret.byCust[id] })).filter(c => c.r && c.r.b > 0 && 100 * c.r.z / c.r.b >= RET_ALERT)
      .sort((a, b) => b.r.z / b.r.b - a.r.z / a.r.b);
    html += P(`<b>Клиенты с возвратами от ${RET_ALERT}%</b> — ${hot.length} из ${cs.length}. Возвраты / продажи — ₪ за 90 дней; штук — в заявках на зикуй за месяц.`);
    if (hot.length) html += table(['Клиент', '% возвр.', 'Возвр. / продажи ₪', 'Штук', 'Агент', 'Начальник'],
      hot.map(c => [esc(c.name), retCell(c.r), `${n0(c.r.z)} / ${n0(c.r.b)}`, n0(c.qty), `<bdi>${esc(c.agentName || names[c.agentCode] || c.agentCode || '—')}</bdi>`, `<bdi>${esc(names['B:' + c.agentCode] || '—')}</bdi>`]), [1, 2, 3]);
  }
  html += P('<b>Топ-10 по штукам в заявках</b>');
  html += table(['Клиент', 'Штук', 'Бланков'], cs.slice(0, 10).map(c => [esc(c.name), n0(c.qty), c.blanks]), [1, 2]);

  // 6. агенты + время
  const short = tm.pairs.filter(p => p.s <= LONG_S), long = tm.pairs.length - short.length;
  // Экономия только по медиане (решение пользователя 2026-09-29): зикуев × (10 мин − медиана).
  const byWho = {}; for (const p of short) (byWho[p.who] = byWho[p.who] || []).push(p.s);
  // +10% — администрирование ошибок/неточностей с офисом, которых с приложением на порядок меньше (пользователь 2026-09-29)
  const savedS = v => v.length * Math.max(0, BASELINE_S - med(v)) * (1 + ADMIN_BONUS);
  const savedH = savedS(short.map(p => p.s)) / 3600;
  html += H('6. Агенты и время', `экономия = зикуев × (10 мин на ручной бланк − медиана) + ${ADMIN_BONUS * 100}% на администрирование ошибок и неточностей с офисом (из них ${(savedH - savedH / (1 + ADMIN_BONUS)).toFixed(1)} ч); ${long} зикуев дольше 30 мин (форма висела открытой) не учтены`);
  html += `<tr><td style="padding:0 14px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif"><tr>
    ${kpi('Сэкономлено', savedH.toFixed(1) + ' ч')}
    ${kpi('Медиана зикуя', mmss(med(short.map(p => p.s))))}
    ${kpi('Зикуев со временем', short.length)}
    ${kpi('Агентов', Object.keys(agent).length)}
  </tr></table></td></tr>`;
  html += table(['Агент', 'Бланков', 'Артикулов ⌀', 'Штук', 'Медиана', 'Сэкономлено'],
    Object.entries(agent).sort((a, b) => b[1].blanks - a[1].blanks).map(([code, a]) => [esc(a.name || names[code] || code), a.blanks, avg(a.skus).toFixed(1), n0(a.qty), byWho[code] ? mmss(med(byWho[code])) : '—', byWho[code] ? (savedS(byWho[code]) / 3600).toFixed(1) + ' ч' : '—']), [1, 2, 3, 4, 5]);
  const buckets = [[1, 1], [2, 3], [4, 6], [7, 10], [11, 999]].map(([a, b]) => { const s = short.filter(p => p.items >= a && p.items <= b).map(p => p.s); return s.length ? [b === 999 ? `${a}+` : a === b ? `${a}` : `${a}–${b}`, s.length, mmss(med(s))] : null; }).filter(Boolean);
  html += P('<span style="font-size:12px;color:' + MUTED + '">Время по размеру бланка:</span>');
  html += table(['Артикулов в бланке', 'Зикуев', 'Медиана времени'], buckets, [1, 2]);

  // 7. качество данных
  html += H('7. Качество данных');
  html += P(`<span style="font-size:12px;color:${MUTED}">Отправлено по журналу событий: ${tm.submitted}; со временем: ${tm.pairs.length}; без записи об открытии формы: ${tm.unpaired}; без привязки к агенту: ${tm.unattributed}. Бланков в истории: ${t.blanks}, из них без времени заполнения: ${Math.max(0, t.blanks - tm.pairs.length)} (время пишется с 07.09.2026). Семья не найдена: ${n0((fam['—']?.z || 0) + (fam['—']?.h || 0))} шт.</span>`);

  return { charts, subject: `Списания товаров — частный рынок и небольшие сети · ${title}`, html: `<!doctype html>
<html lang="ru"><body style="margin:0;padding:16px 0;background:${PAPER};font-family:Arial,sans-serif">
<table role="presentation" align="center" width="720" cellpadding="0" cellspacing="0" style="width:100%;max-width:720px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${LINE}">
  <tr><td style="background:${NAVY};padding:30px 14px 24px;text-align:center">
    <img src="cid:diler-logo-white" width="72" height="72" alt="DILER B.M.D" style="display:block;margin:0 auto 14px" />
    <div style="font-size:22px;font-weight:900;color:#fff">Списания товаров</div>
    <div style="padding-top:6px;font-size:13px;color:#AFC1DC">частный рынок и небольшие сети · зикуй Formula Road</div>
    <div style="padding-top:10px;font-size:12px;color:${GOLD};letter-spacing:.5px">ежемесячный отчёт · ${title}</div>
  </td></tr>
  ${html}
  <tr><td style="padding:20px 14px 24px;font-size:11px;color:${MUTED};border-top:1px solid ${LINE}">Автоотчёт COLUMBUS · 1-го числа каждого месяца за прошлый месяц.</td></tr>
</table></body></html>`.replace(/השמדה/g, '<bdi>השמדה</bdi>') }; // слово на иврите в русской фразе переставляет соседние числа (BiDi)
}
function blanksQty(cur) { return cur._blanks.map(e => e.items.filter(i => !cur._weighted.has(i.sku)).reduce((a, i) => a + (Number(i.qty) || 0), 0)); }

async function main() {
  const month = arg('month') || prevMonth(ilMonth(new Date().toISOString()));
  const { famOf, shelf } = loadCatalog();
  const names = loadAgentNames();
  const all = readJson(path.join(DATA, 'blank-history.json'));
  const pick = ym => all.filter(e => ilMonth(e.ts) === ym);
  const curBlanks = pick(month), prevBlanks = pick(prevMonth(month));
  if (!curBlanks.length) { console.log(`Нет бланков за ${month} — письмо не отправлено.`); return; }
  const weighted = weightedSkus(all);
  const cur = Object.assign(summarize(curBlanks, famOf, shelf, weighted), { _blanks: curBlanks, _weighted: weighted });
  // blank-history хранит 92 дня — прошлый месяц сравниваем, только если он в истории целиком
  const prev = prevBlanks.length && all[0] && ilMonth(all[0].ts) < prevMonth(month) ? summarize(prevBlanks, famOf, shelf, weighted) : null;
  const tm = loadTimings(month);
  // PBI может ответить 429 — отчёт всё равно уходит, только без % возвратов (пометка в шапке)
  let ret = null;
  try { ret = await fetchReturnRates([...new Set(curBlanks.map(e => String(e.custId)))]); }
  catch (e) { console.error('[zikuy-report] % возвратов из PBI не получен:', e.message); }
  const { subject, html, charts } = buildHtml(month, cur, prev, tm, names, ret);
  const sharp = require('sharp');
  const pngs = await Promise.all(charts.map(async c => ({ id: c.id, png: await sharp(Buffer.from(c.svg)).png().toBuffer() })));
  console.log(`${subject}: бланков ${cur.t.blanks}, штук ${Math.round(cur.t.total)}, пар со временем ${tm.pairs.length}`);

  if (DRY_RUN) {
    const out = path.join(__dirname, '..', '.scratch', `zikuy-report-${month}.html`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let preview = html.replace('cid:diler-logo-white', path.join(DOCS, 'logo-diler-bmd-white.png'));
    for (const p of pngs) { const f = out.replace('.html', `-${p.id}.png`); fs.writeFileSync(f, p.png); preview = preview.replace(`cid:${p.id}`, path.basename(f)); }
    fs.writeFileSync(out, preview);
    console.log('--dry-run — письмо не отправлено, превью:', out);
    return;
  }
  const to = (arg('to') || process.env.ZIKUY_REPORT_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!to.length) throw new Error('ZIKUY_REPORT_RECIPIENTS не задан');
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const { Resend } = require('resend');
  const logo = path.join(DOCS, 'logo-diler-bmd-white.png');
  const res = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: `AI Analytics Assistant <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to, subject, html,
    attachments: [
      ...(fs.existsSync(logo) ? [{ filename: 'logo-white.png', content: fs.readFileSync(logo).toString('base64'), contentId: 'diler-logo-white' }] : []),
      ...pngs.map(p => ({ filename: `${p.id}.png`, content: p.png.toString('base64'), contentId: p.id })),
    ],
  });
  console.log('Отправлено:', JSON.stringify(res));
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
