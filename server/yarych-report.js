// yarych-report.js — ежемесячный отчёт продаж поставщика YARYCH (KARTIS PARIT[ספק] = 2110171),
// только חברה = INTER (пользователь 2026-10-05; адресаты — в run-alert.sh на VPS, репо публичный).
// Источник — датасет INTERNATIONAL CONTROL DESK (workspace CONTROL), те же меры, что на страницах
// YARICH / INTER +: штуки = [TOTAL UNITS _מכר_], кг = [WEIGHT KG.], картоны = [מכר בקרטונים] — все три только -מכר-
// (SUM(KARTON) включал השמדות: Sep-26 1,021 вместо 1,225 — исправлено 2026-10-05).
// Сверено 2026-10-05: помесячные штуки совпали с визуалом SALES UNITS до единицы (Apr-25 75,003 … Sep-26 16,410).
//
// Письмо = короткая сводка + кнопка на личную страницу /p/<hex> (тумблер штуки/картоны/кг работает
// только на странице: почтовики режут JS). Страница пишется в /root/private-share/<YARYCH_SHARE>.html,
// трекинг чтения — тот же POST /p/<hex>/ev, что у Diler Intelligence.
//
// Usage: node yarych-report.js [--month=YYYY-MM] [--dry-run] [--page-only] [--test-notice] [--snapshot] [--to=a@b.com]
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const DOCS = path.join(__dirname, '..', 'docs');
const WS = 'ee9e5fc6-bc10-4e7d-a8f3-b23c08d150ed', DS = 'fb6691a0-9b2f-413b-b438-78d2982c4e70'; // CONTROL / INTERNATIONAL CONTROL DESK
const SUPPLIER = '2110171', SHOW_MONTHS = 18, TOP_PRIVATE = 10, STOCK_MONTHS = 3;
const SHARE_DIR = '/root/private-share', PUBLIC = 'https://api.sverdlik-apps.site';

const NAVY = '#1C3D6B', GOLD = '#C9A227', INK = '#1F2937', MUTED = '#6B7280', LINE = '#E5E7EB', PAPER = '#F4F6FA', RED = '#B91C1C', GREEN = '#15803D';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const addMonths = (s, k) => { const [y, m] = s.split('-').map(Number), t = y * 12 + m - 1 + k; return ym(Math.floor(t / 12), t % 12 + 1); };
const label = s => `${MON[+s.slice(5) - 1]}-${s.slice(2, 4)}`;
const n0 = x => Math.round(x).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const yoy = (a, b) => b > 0 ? Math.round(100 * (a - b) / b) : null;

// ponytail: общего модуля нет, 8-я копия (как в zikuy-report.js); апгрейд когда вынесут fixBiDi в общий файл.
const _BIDI_TEST = /[‎‏‪-‮]/, _BIDI_STRIP = /[‎‏‪-‮]/g;
function fixBiDi(raw) {
  if (!raw) return '';
  const hasBidi = _BIDI_TEST.test(raw);
  const s = raw.replace(_BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  const fixed = s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('').replace(/\d+/g, m => m.split('').reverse().join('')) : w)
    .join(' ');
  return fixed.replace(/\(/g, '\x01').replace(/\)/g, '(').replace(/\x01/g, ')');
}

// ── данные ──────────────────────────────────────────────────────────────────
async function fetchData(from, to) {
  const { executeDax } = require('./powerbi');
  const F = "'DataIINא+F+I+MMD 25-23-24-22'", K = "'KARTIS PARIT'", C = "'לקוחות רב חברתי'";
  const [fy, fm] = from.split('-').map(Number), [ty, tm] = to.split('-').map(Number);
  const filters = `FILTER(ALL(${K}[ספק]), ${K}[ספק] = "${SUPPLIER}"), TREATAS({"INTER"}, ${F}[חברה]),
  FILTER(ALL(DIMCALENDAR[Date]), DIMCALENDAR[Date] >= DATE(${fy},${fm},1) && DIMCALENDAR[Date] <= EOMONTH(DATE(${ty},${tm},1),0))`;
  const vals = `"u", [TOTAL UNITS _מכר_], "krt", [מכר בקרטונים], "kg", [WEIGHT KG.]`;
  const q = cols => executeDax(`EVALUATE SUMMARIZECOLUMNS(DIMCALENDAR[Year], DIMCALENDAR[Month], ${cols}, ${filters}, ${vals})`, DS, WS);
  // последовательно — не бить квоту параллельными DAX
  const sku = await q(`${K}[מק"ט], ${K}[תאור לועזי], ${K}[תאור פרמטר 2 למוצר]`);
  const chan = await q(`${C}[רשתות / שוק פרטי], ${C}[תאור סוג לקוח], ${C}[כשרות]`);
  const priv = await executeDax(`EVALUATE SUMMARIZECOLUMNS(DIMCALENDAR[Year], DIMCALENDAR[Month], ${C}[מס. לקוח], ${C}[שם לקוח],
  TREATAS({"שוק פרטי"}, ${C}[רשתות / שוק פרטי]), ${filters}, ${vals})`, DS, WS);
  // блок מלאי (страница YARICH מלאי): меры модели как есть, период = 3 последних месяца (пользователь 2026-10-05);
  // сверено с PBI на Jan–Sep 2026 до единицы (21,417 крт, 174/день, 30 дней, рек. 6,271 крт, שווי 141,340)
  const [sy, sm] = addMonths(to, -(STOCK_MONTHS - 1)).split('-').map(Number);
  const stockQ = by => `EVALUATE SUMMARIZECOLUMNS(${by}
  FILTER(ALL(${K}[ספק]), ${K}[ספק] = "${SUPPLIER}"), TREATAS({"INTER"}, ${F}[חברה]),
  FILTER(ALL(DIMCALENDAR[Date]), DIMCALENDAR[Date] >= DATE(${sy},${sm},1) && DIMCALENDAR[Date] <= EOMONTH(DATE(${ty},${tm},1),0)),
  "mU", [מלאי זמין UNITS], "mK", [מלאי בקרטונים], "mP", [מלאי PALLET], "mOK", [מלאי +הזמנות פתוחות קרטונים 🚛],
  "avgK", [מכר בקרטונים ממוצע ביום 🛒], "sK", [מכר בקרטונים], "days", [לכמה ימים יספיק המלאי 📆], "safe", [מלאי ביטחון  (בימי מכר)],
  "rec", [הזמנה מומלצת  🚢 - KARTON], "zik", [% זיכויים], "nis", [NIS שווי מלאי],
  "safeP", [מלאי בטחון PALLETS], "palDay", [PALLETS מכר ממוצע ביום], "wK", [WEIGHT KARTON average per מק"ט], "cnt", [כמות מוצרים במלאי])`;
  const stock = await executeDax(stockQ(`${K}[מק"ט], ${K}[תאור לועזי], ${K}[תאור פרמטר 2 למוצר],`), DS, WS);
  const stockTot = await executeDax(stockQ(''), DS, WS);
  const withTot = (rows, tot) => rows.concat(tot.map(r => ({ ...r, '[isTotal]': true })));
  // блок מלאי по выбранным месяцам (пользователь 2026-10-05). Формулы PBI восстановлены из помесячных данных и сверены:
  // avgK = ΣsK / Σдней (дни = sK/avgK по месяцу, аддитивны), zik = Σזיכויים / Σbrutto, days = mOK / avgK × 7/5,
  // rec = avgK × safe × 5/7 − max(mOK, 0) (если > 0; отрицательный остаток PBI не добавляет), palDay = avgK / KIP, safeP = palDay × safe
  const stockM = await executeDax(`EVALUATE SUMMARIZECOLUMNS(DIMCALENDAR[Year], DIMCALENDAR[Month], ${K}[מק"ט], ${filters},
  "sK", [מכר בקרטונים], "avgK", [מכר בקרטונים ממוצע ביום 🛒], "zk", [זיכויים], "br", [TOTAL  brutto])`, DS, WS);
  const kip = await executeDax(`EVALUATE SUMMARIZECOLUMNS(${K}[מק"ט], FILTER(ALL(${K}[ספק]), ${K}[ספק] = "${SUPPLIER}"), "kip", [KARTON IN PALLET average per מק"ט])`, DS, WS);
  // פיזור: активные клиенты INTER (не зависят от дат) + кто из клиентов INTER какой SKU в каком месяце заказал (только -מכר-)
  const act = await executeDax(`EVALUATE ROW("act", CALCULATE([DIST לקוחות פעילים], TREATAS({"INTER"}, ${C}[HEVRA])))`, DS, WS);
  const dist = await executeDax(`EVALUATE SUMMARIZECOLUMNS(DIMCALENDAR[Year], DIMCALENDAR[Month], ${K}[מק"ט], ${C}[מס. לקוח], ${filters},
  TREATAS({"INTER"}, ${C}[HEVRA]), "o", [כמות לקוחות שהזמנינו for -מכר-])`, DS, WS);
  const photos = await executeDax(`EVALUATE SELECTCOLUMNS(FILTER(${K}, ${K}[ספק] = "${SUPPLIER}"), "sku", ${K}[מק"ט], "url", ${K}[URL תמונה])`, DS, WS);
  return { sku, chan, priv, stock: withTot(stock, stockTot), photos, stockM, kip, act: act[0]?.['[act]'] || 0, dist };
}

// строки DAX → { key: { meta, m: { 'YYYY-MM': [u, krt, kg] } } }
function pivot(rows, keyOf, metaOf) {
  const out = {};
  for (const r of rows) {
    const k = keyOf(r); if (k == null) continue;
    const x = out[k] = out[k] || { ...metaOf(r), m: {} };
    const p = ym(r['DIMCALENDAR[Year]'], r['DIMCALENDAR[Month]']);
    const v = x.m[p] = x.m[p] || [0, 0, 0];
    v[0] += r['[u]'] || 0; v[1] += r['[krt]'] || 0; v[2] += r['[kg]'] || 0;
  }
  return out;
}
const sumM = (m, months, i) => months.reduce((a, p) => a + (m[p]?.[i] || 0), 0);

function shape(raw, month) {
  const photoUrl = Object.fromEntries((raw.photos || []).map(r => [String(r['[sku]']), r['[url]']]));
  const sku = pivot(raw.sku, r => String(r['KARTIS PARIT[מק"ט]']), r => ({
    sku: String(r['KARTIS PARIT[מק"ט]']), name: String(r['KARTIS PARIT[תאור לועזי]'] || '').trim(),
    fam: fixBiDi(String(r['KARTIS PARIT[תאור פרמטר 2 למוצר]'] || '')) || '—',
  }));
  const chan = pivot(raw.chan, r => `${r['לקוחות רב חברתי[רשתות / שוק פרטי]']}|${r['לקוחות רב חברתי[תאור סוג לקוח]']}|${r['לקוחות רב חברתי[כשרות]']}`, r => ({
    kos: String(r['לקוחות רב חברתי[כשרות]'] || ''),
    ch: String(r['לקוחות רב חברתי[רשתות / שוק פרטי]'] || ''), name: fixBiDi(String(r['לקוחות רב חברתי[תאור סוג לקוח]'] || '')) || '—',
  }));
  const priv = pivot(raw.priv, r => String(r['לקוחות רב חברתי[מס. לקוח]']), r => ({
    id: String(r['לקוחות רב חברתי[מס. לקוח]']), name: fixBiDi(String(r['לקוחות רב חברתי[שם לקוח]'] || '')),
  }));
  // окно: последние SHOW_MONTHS месяцев до отчётного, но не раньше первого месяца с данными
  const all = new Set(); for (const x of Object.values(sku)) Object.keys(x.m).forEach(p => all.add(p));
  const first = [...all].sort()[0] || month;
  const months = []; for (let p = addMonths(month, -(SHOW_MONTHS - 1)); p <= month; p = addMonths(p, 1)) if (p >= first) months.push(p);
  const last12 = months.slice(-12);
  const xlMonths = []; for (let p = first; p <= month; p = addMonths(p, 1)) xlMonths.push(p); // Excel: с первого месяца продаж (пользователь 2026-10-05)
  const ly = addMonths(month, -12);
  const chains = Object.values(chan).filter(x => x.ch === 'רשתות');
  const privTotal = Object.values(chan).filter(x => x.ch === 'שוק פרטי');
  // плоский вид для страницы: m → массив по months (+ прошлый год отчётного месяца)
  const flat = x => ({ ...x, m: undefined, v: months.map(p => x.m[p] || [0, 0, 0]), l: months.map(p => x.m[addMonths(p, -12)] || null) });
  const famOrder = {}; for (const x of Object.values(sku)) famOrder[x.fam] = (famOrder[x.fam] || 0) + sumM(x.m, last12, 0);
  const out = {
    month, ly: all.has(ly) ? ly : null, months, n12: last12.length, lyOk: months.map(p => all.has(addMonths(p, -12))),
    skus: Object.values(sku).filter(x => months.some(p => x.m[p])).map(flat)
      .sort((a, b) => famOrder[b.fam] - famOrder[a.fam] || a.fam.localeCompare(b.fam) || b.v.at(-1)[0] - a.v.at(-1)[0]),
    chains: chains.map(flat), priv: Object.values(priv).filter(x => months.some(p => x.m[p]) || months.some(p => x.m[addMonths(p, -12)])).map(flat), topN: TOP_PRIVATE, privAll: privTotal.map(flat),
    photoUrl, xl: { months: xlMonths, rows: Object.values(sku).filter(x => xlMonths.some(p => x.m[p])).map(x => ({ sku: x.sku, name: x.name, fam: x.fam, v: xlMonths.map(p => x.m[p] || [0, 0, 0]) }))
      .sort((a, b) => (famOrder[b.fam] || 0) - (famOrder[a.fam] || 0) || a.sku.localeCompare(b.sku)) },
    stockFrom: addMonths(month, -(STOCK_MONTHS - 1)), asOf: new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Jerusalem' }),
    stock: raw.stock.map(r => ({
      total: r['[isTotal]'] === true, sku: String(r['KARTIS PARIT[מק"ט]'] ?? ''), name: String(r['KARTIS PARIT[תאור לועזי]'] || '').trim(),
      fam: fixBiDi(String(r['KARTIS PARIT[תאור פרמטר 2 למוצר]'] || '')),
      ...Object.fromEntries(['mU', 'mK', 'mP', 'mOK', 'avgK', 'sK', 'days', 'safe', 'rec', 'zik', 'nis', 'safeP', 'palDay', 'wK', 'cnt'].map(k => [k, r[`[${k}]`] ?? null])),
    })).sort((a, b) => a.total - b.total || (famOrder[b.fam] || 0) - (famOrder[a.fam] || 0) || a.sku.localeCompare(b.sku)),
  };
  const kipOf = Object.fromEntries((raw.kip || []).map(r => [String(r['KARTIS PARIT[מק"ט]']), r['[kip]'] || null]));
  const sm = {}; for (const r of raw.stockM || []) {
    const k = String(r['KARTIS PARIT[מק"ט]']), p = ym(r['DIMCALENDAR[Year]'], r['DIMCALENDAR[Month]']), sK = r['[sK]'] || 0, a = r['[avgK]'];
    (sm[k] = sm[k] || {})[p] = [sK, a ? sK / a : 0, r['[zk]'] || 0, r['[br]'] || 0];
  }
  for (const x of out.stock) if (!x.total) { x.kip = kipOf[x.sku] || null; x.sm = months.map(p => (sm[x.sku] || {})[p] || [0, 0, 0, 0]); }
  // клиенты → индексы; по SKU: { 'YYYY-MM': [индексы клиентов] }
  const cIdx = {}, dm = {}; let nc = 0;
  for (const r of raw.dist || []) {
    if (!(r['[o]'] > 0)) continue;
    const c = String(r['לקוחות רב חברתי[מס. לקוח]']), k = String(r['KARTIS PARIT[מק"ט]']), p = ym(r['DIMCALENDAR[Year]'], r['DIMCALENDAR[Month]']);
    const i = cIdx[c] ?? (cIdx[c] = nc++);
    ((dm[k] = dm[k] || {})[p] = dm[k][p] || []).push(i);
  }
  out.dist = { act: raw.act, rows: out.stock.filter(x => !x.total).map(x => ({ sku: x.sku, name: x.name, fam: x.fam, m: dm[x.sku] || {} })) };
  const stTot = out.stock.find(x => x.total);
  if (stTot) stTot.mP = out.stock.filter(x => !x.total).reduce((a, x) => a + (x.mP || 0), 0);
  return out;
}

// ── итоги для письма (в штуках) ─────────────────────────────────────────────
function totals(d) {
  const tot = i => d.skus.reduce((a, x) => a + x.v.at(-1)[i], 0);
  const lyU = d.ly ? d.skus.reduce((a, x) => a + (x.l.at(-1)?.[0] || 0), 0) : null;
  const m12 = d.skus.reduce((a, x) => a + x.v.slice(-12).reduce((s, v) => s + v[0], 0), 0);
  const chainsU = d.chains.reduce((a, x) => a + x.v.at(-1)[0], 0);
  return { u: tot(0), krt: tot(1), kg: tot(2), lyU, m12, chainsU };
}

// ── страница ────────────────────────────────────────────────────────────────
function buildPage(d) {
  const data = JSON.stringify({ ...d, xl: undefined, photoUrl: undefined }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html dir="rtl" lang="he"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>YARYCH · INTER · ${label(d.month)}</title>
<style>
:root{--navy:${NAVY};--gold:${GOLD};--ink:${INK};--muted:${MUTED};--line:${LINE};--paper:${PAPER};--red:${RED};--green:${GREEN}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.45 Arial,'Segoe UI',sans-serif}
header{background:var(--navy);color:#fff;padding:18px 16px 14px}header h1{margin:0;font-size:20px}header p{margin:4px 0 0;color:#cfd8e6;font-size:13px}
.bar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;box-shadow:0 2px 8px rgba(28,61,107,.08)}
.tg{display:inline-flex;border:2px solid var(--navy);border-radius:999px;overflow:hidden;box-shadow:0 2px 10px rgba(28,61,107,.18)}.tg button{border:0;background:#fff;color:var(--navy);padding:10px 26px;font:700 16px Arial;cursor:pointer}.tg button:hover{background:#EEF2F8}.tg button.on,.tg button.on:hover{background:var(--navy);color:#fff}
.tg button.on{background:var(--navy);color:#fff}
.ym{display:flex;gap:12px;align-items:stretch;margin:0 0 10px;direction:ltr}.ms{display:flex;gap:4px;direction:ltr}.ms:not(.mg){order:2}.mg{display:flex;flex:1;gap:4px}.ym .mg button{flex:1 1 auto;padding:6px 6px;white-space:nowrap;font-size:13px}
.ms button[disabled]{opacity:.35;cursor:default}.kpi b.up{color:var(--green)}.kpi b.dn{color:var(--red)}
@media(max-width:900px){.ym{flex-wrap:wrap}.ms:not(.mg){order:0;width:100%;justify-content:flex-end}.mg{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))}}
@media(max-width:600px){.mg{grid-template-columns:repeat(4,minmax(0,1fr))}.ms button{padding:6px 4px}}.ms button{flex:0 0 auto;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:6px;padding:5px 8px;font:600 13.5px Arial;cursor:pointer}
.ms button.on{background:var(--navy);border-color:var(--navy);color:#fff}td.sel,th.sel{background:#FFF6DC}
main{max-width:1180px;margin:0 auto;padding:14px 16px 40px}
section{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 14px}
h2{margin:0 0 10px;font-size:19px;color:var(--navy)}
.kt{display:flex;gap:10px;align-items:center;justify-content:center;margin:0 0 12px}.tg.sm{border-width:2px}.tg.sm button{padding:7px 18px;font-size:14px}
.pd{display:inline-block;vertical-align:middle;margin-right:8px;background:var(--navy);color:#fff;font-size:13px;font-weight:700;padding:3px 10px;border-radius:999px}.ymbox{margin:0 0 10px}
.lh{margin:22px 0 10px;font-size:17px;color:var(--red)}
.un{display:inline-block;vertical-align:middle;margin-right:8px;background:var(--gold);color:#fff;font-size:13px;font-weight:700;padding:3px 10px;border-radius:999px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}#sKpi{grid-template-columns:repeat(7,minmax(0,1fr))}
@media(max-width:900px){#sKpi{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}}
#tSt{table-layout:fixed}#tSt th:nth-child(1){width:82px}#tSt th:nth-child(2){width:200px}
#kpis .kpi{text-align:right}.kpi{border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;justify-content:space-between;min-height:84px}.kpi span{line-height:1.3}.kpi b{display:block;font-size:26px;color:var(--navy)}.kpi span{color:var(--muted);font-size:14px}
.up{color:var(--green)}.dn{color:var(--red)}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:14.5px}th,td{padding:5px 7px;border-bottom:1px solid var(--line);white-space:nowrap}
th{background:var(--paper);color:var(--muted);font-weight:600;position:sticky;top:0;font-size:12px;line-height:1.3;vertical-align:bottom}
td.n,th.n{text-align:left;direction:ltr;font-variant-numeric:tabular-nums}
tr.fam td{background:#EEF2F8;font-weight:700;color:var(--navy)}tr.tot td{font-weight:700;border-top:2px solid var(--navy)}
td.en{text-align:left}#tSku th,#tSku td{text-align:right}#tSku .st{position:sticky;background:#fff;z-index:1}#tSku .s1{left:0;min-width:58px;text-align:left}#tSku .s2{left:58px;border-right:1px solid var(--line);text-align:left}#tSku tr.fam .st{background:#EEF2F8}#tSku th.st{background:var(--paper);z-index:2}
@media(max-width:600px){#tSku .s1{display:none}#tSku .s2{left:0;white-space:normal;min-width:130px;max-width:140px;font-size:11.5px;line-height:1.25}}
button.x{border:0;background:none;color:#B0B7C3;cursor:pointer;font-size:11px;padding:0 4px;margin:0 2px}button.x:hover{color:var(--red)}
button.rs{margin-top:8px;border:1px solid var(--navy);background:#fff;color:var(--navy);border-radius:6px;padding:5px 10px;font:600 13.5px Arial;cursor:pointer}
#tDi td:nth-child(-n+3),#tDi th:nth-child(-n+3){text-align:left!important}#tDi td.en{width:45%}#tSt th,#tSt td,table.lt th,table.lt td{text-align:right}table.lt td:first-child,table.lt th:first-child{text-align:left}#tSt td:nth-child(-n+2),#tSt th:nth-child(-n+2){text-align:left}#tSt th,#tSt td{padding:5px 6px}
details summary{cursor:pointer;color:var(--navy);font-size:13px;margin:10px 0 6px}.sh{color:var(--muted)}
.chart{width:100%;height:auto;display:block}
.leg{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:6px}.leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-left:4px;vertical-align:-1px}
footer{color:var(--muted);font-size:11.5px;text-align:center;padding:6px 16px 20px}
</style></head><body>
<header><h1>YARYCH — מכירות INTER</h1><p>דוח חודשי · ${label(d.month)} · מקור: Power BI INTERNATIONAL CONTROL DESK</p></header>
<div class="bar"><span class="sh">יחידות מידה:</span><div class="tg" id="tg"><button data-i="0" class="on">יחידות</button><button data-i="1">קרטונים</button><button data-i="2">ק"ג</button></div></div>
<main>
<section id="kpi"><h2>${label(d.month)} — סיכום <span class="un"></span></h2><div class="kpis" id="kpis" dir="ltr"></div></section>
<section id="trend"><h2>מכירות לפי חודש <span class="un"></span></h2><div id="chart"></div><div class="leg" id="leg"></div></section>
<section id="sku"><div class="ymbox"></div><h2>מכירות לפי מוצר <span class="pd"></span> <span class="un"></span></h2><div class="scroll" id="skuWrap" dir="ltr"><table id="tSku" dir="ltr"></table></div><div id="skuX"></div></section>
<section id="chains"><div class="ymbox"></div><div class="kt" id="kt"><span class="sh">כשרות לקוח:</span><div class="tg sm"><button class="kb on" data-kos="all">הכל</button><button class="kb" data-kos="כן">כשר</button><button class="kb" data-kos="לא">לא כשר</button></div></div><h2>רשתות — כמה לקחה כל רשת ומשקלה מהסה"כ <span class="pd"></span> <span class="un"></span></h2><div class="scroll" dir="ltr"><table id="tCh" dir="ltr" class="lt"></table></div><div id="tChX"></div><div id="tChR"></div><div id="lost"></div></section>
<section id="private"><div class="ymbox"></div><h2>שוק פרטי — ${TOP_PRIVATE} הלקוחות הגדולים בתקופה הנבחרת <span class="pd"></span> <span class="un"></span></h2><div class="scroll" dir="ltr"><table id="tPr" dir="ltr" class="lt"></table></div><div id="tPrX"></div></section>
<section id="dist"><div class="ymbox"></div><h2>פיזור — כמה לקוחות הזמינו כל מוצר <span class="pd"></span></h2><p class="sh" style="margin:-4px 0 10px;font-size:12px">לקוחות INTER פעילים · לקוח נספר פעם אחת בתקופה · מכר בלבד (בלי החזרות/השמדות) · כמו ב-Power BI</p><div class="kpis" id="dKpi" dir="ltr"></div><div class="scroll" style="margin-top:10px" dir="ltr"><table id="tDi" dir="ltr" class="lt"></table></div><div id="tDiX"></div></section>
<section id="stock"><div class="ymbox"></div><h2>מלאי והזמנה מומלצת <span class="pd"></span></h2><p class="sh" style="margin:-4px 0 10px;font-size:12px">מכר, ימי מלאי והזמנה מומלצת — לפי החודשים הנבחרים · מלאי נכון ל-${d.asOf} · כמו בדף YARICH מלאי ב-Power BI · לא תלוי במתג היחידות · כמו בדף YARICH מלאי</p><div class="kpis" id="sKpi"></div><div class="scroll" style="margin-top:10px" dir="ltr"><table id="tSt" dir="ltr"></table></div><div id="tStX"></div></section>
</main>
<footer>INTER בלבד · ספק YARYCH LLC (2110171) · חודשים שלמים</footer>
<script>
var D=${data};
(function(){
var U=0,MON=${JSON.stringify(MON)},COL=['#1C3D6B','#E8743B','#3B82F6','#C9A227','#15803D','#8B5CF6','#0EA5E9','#B91C1C'];
function lb(p){return MON[+p.slice(5)-1]+'-'+p.slice(2,4)}
function f(x){return (Math.round(x)||0).toLocaleString('en-US')}
function pc(a,b){return b>0?Math.round(100*(a-b)/b):null}
function ch(v){return v==null?'<td class="n sh">—</td>':'<td class="n '+(v>=0?'up':'dn')+'">'+(v>0?'+':'')+v+'%</td>'}
function sh(a,b){return '<td class="n sh">'+(b?Math.round(1000*a/b)/10:0)+'%</td>'}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
var L=D.months.length,last=L-1,SEL=[last],HL,SL,lyL,MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
var YS=[+D.months[last].slice(0,4)],MS=[+D.months[last].slice(5)],YEARS=[];D.months.forEach(function(p){var y=+p.slice(0,4);if(YEARS.indexOf(y)<0)YEARS.push(y)});
function pickSel(){var a=[];D.months.forEach(function(p,i){if(YS.indexOf(+p.slice(0,4))>=0&&MS.indexOf(+p.slice(5))>=0)a.push(i)});return a}
function span(ps){return ps.length===1?lb(ps[0]):(ps.length===SEL.length&&SEL[SEL.length-1]-SEL[0]===SEL.length-1?lb(ps[0])+'–'+lb(ps[ps.length-1]):ps.map(lb).join(', '))}
function ly12(p){var y=+p.slice(0,4),m=+p.slice(5);return (y-1)+'-'+(m<10?'0':'')+m}
function selState(){SEL.sort(function(a,b){return a-b});HL=SEL.every(function(i){return D.lyOk[i]});
  var ps=SEL.map(function(i){return D.months[i]});SL=span(ps);lyL=HL?span(ps.map(ly12)):null}
function cur(x){var s=0;SEL.forEach(function(i){s+=x.v[i][U]});return s}function lyc(v){return '<td class="n">'+(HL?f(v):'—')+'</td>'}
function lyv(x){var s=0;SEL.forEach(function(i){s+=x.l[i]?x.l[i][U]:0});return s}
function selV(v){var s=0;SEL.forEach(function(i){s+=v[i]});return s}
function sum(a,fn){var s=0;a.forEach(function(x){s+=fn(x)});return s}
// скрытые строки по таблицам: ✕ прячет строку, итоги пересчитываются; ↺ возвращает
var KOS='all';
function chainsFor(){var by={},o=[];D.chains.forEach(function(c){if(KOS!=='all'&&c.kos!==KOS)return;var x=by[c.name];
  if(!x){x=by[c.name]={name:c.name,v:D.months.map(function(){return [0,0,0]}),l:D.months.map(function(){return null})};o.push(x)}
  c.v.forEach(function(v,i){for(var j=0;j<3;j++)x.v[i][j]+=v[j]});c.l.forEach(function(v,i){if(v){x.l[i]=x.l[i]||[0,0,0];for(var j=0;j<3;j++)x.l[i][j]+=v[j]}})});return o}
function ldist(x,ly){var set={},n=0;SEL.forEach(function(i){var p=D.months[i];if(ly)p=ly12(p);(x.m[p]||[]).forEach(function(c){if(!set[c]){set[c]=1;n++}})});return {n:n,set:set}}
var HID={sku:{},st:{},ch:{},pr:{},di:{}};
function vis(t,a,key){return a.filter(function(x){return !HID[t][key(x)]})}
function xb(t,k){return '<button class="x" data-t="'+t+'" data-k="'+esc(k)+'" title="הסתר שורה">✕</button>'}
function rb(t){var n=Object.keys(HID[t]).length;return n?'<button class="rs" data-t="'+t+'">↺ החזר '+n+' שורות מוסתרות</button>':''}
function skuK(x){return x.sku}function nmK(x){return x.name}
function render(){selState();
  document.querySelectorAll('.un').forEach(function(e){e.textContent=['יחידות','קרטונים','ק"ג'][U]});
  var ysH=YEARS.map(function(y){return '<button data-y="'+y+'"'+(YS.indexOf(y)>=0?' class="on"':'')+'>'+y+'</button>'}).join('');
  var msH=MN.map(function(n,j){var m=j+1,has=D.months.some(function(p){return +p.slice(5)===m&&YS.indexOf(+p.slice(0,4))>=0});
    return '<button data-mo="'+m+'"'+(MS.indexOf(m)>=0?' class="on"':'')+(has?'':' disabled')+'>'+(window.innerWidth<600?n.slice(0,3):n)+'</button>'}).join('');
  document.querySelectorAll('.ymbox').forEach(function(e){e.innerHTML='<div class="ym"><div class="ms">'+ysH+'</div><div class="ms mg">'+msH+'</div></div>'});
  document.querySelectorAll('.pd').forEach(function(e){e.textContent=SL});
  var SK=vis('sku',D.skus,skuK),T=sum(SK,cur),TL=HL?sum(SK,lyv):null,CH=sum(D.chains,cur),PR=sum(D.privAll,cur),TF=sum(D.skus,cur);
  var k=[['סה"כ '+(HL?lyL:'שנה שעברה'),HL?f(TL):'אין נתונים'],['סה"כ '+SL,f(T)],[HL?'מול '+lyL:'מול שנה שעברה',HL?((pc(T,TL)>0?'+':'')+pc(T,TL)+'%'):'אין נתונים',HL&&pc(T,TL)!=null?(pc(T,TL)>=0?'up':'dn'):''],['רשתות',f(CH)+' · '+(TF?Math.round(100*CH/TF):0)+'%'],['שוק פרטי',f(PR)+' · '+(TF?Math.round(100*PR/TF):0)+'%']];
  document.getElementById('kpis').innerHTML=k.map(function(x){return '<div class="kpi"><span>'+x[0]+'</span><b dir="ltr" class="'+(x[2]||'')+'">'+x[1]+'</b></div>'}).join('');
  // график: столбики по месяцам, стек по семьям
  var fams=[];SK.forEach(function(x){if(fams.indexOf(x.fam)<0)fams.push(x.fam)});
  var W=Math.max(640,L*46),H=260,pad=28,bw=(W-pad*2)/L,mx=0,tot=D.months.map(function(_,i){mx=Math.max(mx,sum(SK,function(x){return Math.max(0,x.v[i][U])}));return sum(SK,function(x){return x.v[i][U]})});
  var svg='<svg class="chart" viewBox="0 0 '+W+' '+(H+40)+'" direction="ltr">';
  D.months.forEach(function(p,i){var y=H,x=pad+i*bw+4;svg+='<g>';fams.forEach(function(fm,j){var v=sum(SK.filter(function(s){return s.fam===fm}),function(s){return Math.max(0,s.v[i][U])}),h=mx?v/mx*(H-30):0;y-=h;svg+='<rect x="'+x+'" y="'+y+'" width="'+(bw-8)+'" height="'+h+'" fill="'+COL[j%COL.length]+'"/>'});
    svg+='<text x="'+(x+(bw-8)/2)+'" y="'+(y-5)+'" font-size="11" text-anchor="middle" fill="#1F2937" font-weight="700">'+(tot[i]>=10000?Math.round(tot[i]/1000)+'K':f(tot[i]))+'</text><text x="'+(x+(bw-8)/2)+'" y="'+(H+16)+'" font-size="11" text-anchor="middle" fill="#6B7280">'+lb(p)+'</text></g>'});
  document.getElementById('chart').innerHTML='<div class="scroll">'+svg+'</svg></div>';
  document.getElementById('leg').innerHTML=fams.map(function(fm,j){return '<span><i style="background:'+COL[j%COL.length]+'"></i>'+esc(fm)+'</span>'}).join('');
  // таблица SKU: семья → SKU × месяцы, итог, % к прошлому году
  // таблица SKU: только выбранные кнопками месяцы (+ סה"כ выбора, если их несколько), 12 мес, % к прошлому году; график от выбора не зависит
  var multi=SEL.length>1;function mc(v,blank){var c=SEL.map(function(i){return '<td class="n">'+(blank&&!v[i]?'':f(v[i]))+'</td>'}).join('');return c+(multi?'<td class="n sel">'+f(selV(v))+'</td>':'')}
  var hd='<tr><th class="st s1">מק"ט</th><th class="st s2">ENG</th><th class="n">'+(lyL||'שנה שעברה')+'</th>'+SEL.map(function(i){return '<th class="n">'+lb(D.months[i])+'</th>'}).join('')+(multi?'<th class="n sel">סה"כ</th>':'')+'<th class="n">'+(lyL?'מול '+lyL:'שינוי')+'</th></tr>';
  var grand=D.months.map(function(_,i){return sum(SK,function(x){return x.v[i][U]})}),g={},ord=[],body='';
  SK.forEach(function(x){if(!g[x.fam]){g[x.fam]=[];ord.push(x.fam)}g[x.fam].push(x)});
  ord.forEach(function(fm){var a=g[fm],v=D.months.map(function(_,i){return sum(a,function(x){return x.v[i][U]})}),l=sum(a,lyv);
    body+='<tr class="fam"><td class="st s1"></td><td class="st s2" dir="rtl">'+esc(fm)+'</td>'+lyc(l)+mc(v)+ch(HL?pc(selV(v),l):null)+'</tr>';
    a.forEach(function(x){body+='<tr><td class="st s1">'+xb('sku',x.sku)+x.sku+'</td><td class="st s2 en">'+esc(x.name)+'</td>'+lyc(lyv(x))+mc(x.v.map(function(z){return z[U]}),true)+ch(HL?pc(cur(x),lyv(x)):null)+'</tr>'})});
  body+='<tr class="tot"><td class="st s1"></td><td class="st s2">TOTAL</td>'+lyc(TL)+mc(grand)+ch(HL?pc(T,TL):null)+'</tr>';
  document.getElementById('tSku').innerHTML=hd+body;document.getElementById('skuX').innerHTML=rb('sku');var w=document.getElementById('skuWrap');w.scrollLeft=w.scrollWidth;
  // сети и частники: отчётный месяц, доля от общего итога, к прошлому году, 12 месяцев и доля
  function tbl(id,t,list,nameHd,total,keepAll,limit){var a=vis(t,list,nmK).slice().sort(function(p,q){return cur(q)-cur(p)||lyv(q)-lyv(p)});if(limit)a=a.filter(function(x){return cur(x)>0}).slice(0,limit);
    var h='<tr><th>'+nameHd+'</th><th class="n">'+(lyL||'שנה שעברה')+'</th><th class="n">'+SL+'</th><th class="n">'+(lyL?'מול '+lyL:'שינוי')+'</th>'+(limit?'':'<th class="n">% מסה"כ</th>')+'</tr>';
    function row(x){return '<tr><td>'+xb(t,x.name)+esc(x.name)+'</td>'+lyc(lyv(x))+'<td class="n">'+f(cur(x))+'</td>'+ch(HL?pc(cur(x),lyv(x)):null)+(limit?'':sh(cur(x),TF))+'</tr>'}
    var act=keepAll?a:a.filter(function(x){return cur(x)}),rest=[] /* сети без продаж в периоде не показываем (пользователь 2026-10-05) */,b=act.map(row).join('');
    if(total){var c=sum(a,cur),cl=sum(a,lyv);b+='<tr class="tot"><td>'+total+'</td>'+lyc(cl)+'<td class="n">'+f(c)+'</td>'+ch(HL?pc(c,cl):null)+sh(c,TF)+'</tr>'}
    document.getElementById(id).innerHTML=h+b;document.getElementById(id+'X').innerHTML=rb(t);
    var r=document.getElementById(id+'R');if(r)r.innerHTML=rest.length?'<details><summary>עוד '+rest.length+' רשתות בלי מכירות ב-'+SL+(HL?' ('+f(sum(rest,lyv))+' ב-'+lyL+')':'')+'</summary><div class="scroll" dir="ltr"><table dir="ltr" class="lt">'+h+rest.map(row).join('')+'</table></div></details>':''}
  tbl('tCh','ch',chainsFor().filter(function(x){return cur(x)||lyv(x)}),'רשת','סה"כ רשתות');
  var lost=HL?chainsFor().filter(function(x){return lyv(x)>0&&cur(x)<=0}).sort(function(p,q){return lyv(q)-lyv(p)}):[];
  function lastBuy(x){for(var i=SEL[SEL.length-1];i>=0;i--)if(x.v[i][0]>0)return lb(D.months[i]);return 'לפני '+lb(D.months[0])}
  document.getElementById('lost').innerHTML=!HL?'':'<h3 class="lh">רשתות שהפסיקו לקנות YARYCH <span class="pd">'+SL+' מול '+lyL+'</span> <span class="un">'+['יחידות','קרטונים','ק"ג'][U]+'</span></h3>'+
    (lost.length?'<div class="scroll" dir="ltr"><table dir="ltr" class="lt"><tr><th>רשת</th><th class="n">'+lyL+'</th><th class="n">'+SL+'</th><th class="n">קנייה אחרונה</th></tr>'+
    lost.map(function(x){return '<tr><td>'+esc(x.name)+'</td><td class="n">'+f(lyv(x))+'</td><td class="n dn">0</td><td class="n">'+lastBuy(x)+'</td></tr>'}).join('')+
    '<tr class="tot"><td>סה"כ '+lost.length+' רשתות</td><td class="n">'+f(sum(lost,lyv))+'</td><td class="n">0</td><td></td></tr></table></div>':'<p class="sh" style="margin:6px 0 0">אין — כל הרשתות שקנו בשנה שעברה קנו גם בתקופה הנבחרת</p>');
  tbl('tPr','pr',D.priv,'לקוח',null,true,D.topN);
  renderStock();renderDist();
}
function stockCalc(x){var sK=0,dd=0,zk=0,br=0;SEL.forEach(function(i){var m=x.sm[i];sK+=m[0];dd+=m[1];zk+=m[2];br+=m[3]});
  var avgK=dd?sK/dd:null,safe=x.safe==null?60:x.safe,r={sK:sK||null,avgK:avgK,zk:zk,br:br,zik:br?zk/br:null,
    days:avgK?x.mOK/avgK*7/5:0,rec:avgK&&avgK*safe*5/7-Math.max(x.mOK,0)>0?avgK*safe*5/7-Math.max(x.mOK,0):null,palDay:avgK&&x.kip?avgK/x.kip:null};
  r.safeP=r.palDay!=null?r.palDay*safe:null;return r}
function renderDist(){var X=D.dist,A=X.act,all=X.rows,rows=vis('di',all,skuK),U0={},UL={},nu=0,nl=0;
  rows.forEach(function(x){var c=ldist(x),l=ldist(x,true);x.o=c.n;x.ol=l.n;for(var k in c.set)if(!U0[k]){U0[k]=1;nu++}for(var k2 in l.set)if(!UL[k2]){UL[k2]=1;nl++}});
  function pz(v){return A?Math.round(1000*v/A)/10+'%':'—'}
  var k=[['לקוחות INTER פעילים',f(A)],[HL?'הזמינו '+lyL:'הזמינו שנה שעברה',HL?f(nl):'אין נתונים'],['הזמינו '+SL,f(nu)],[HL?'מול '+lyL:'שינוי',HL&&pc(nu,nl)!=null?(pc(nu,nl)>0?'+':'')+pc(nu,nl)+'%':'—',HL&&pc(nu,nl)!=null?(pc(nu,nl)>=0?'up':'dn'):''],['פיזור '+SL,pz(nu)]];
  document.getElementById('dKpi').innerHTML=k.map(function(x){return '<div class="kpi"><span>'+x[0]+'</span><b dir="ltr" class="'+(x[2]||'')+'">'+x[1]+'</b></div>'}).join('');
  var h='<tr><th style="width:64px"></th><th>מק"ט</th><th>ENG</th><th class="n">'+(lyL||'שנה שעברה')+'<br>הזמינו</th><th class="n">'+SL+'<br>הזמינו</th><th class="n">'+(lyL?'מול '+lyL:'שינוי')+'</th><th class="n">פיזור %</th></tr>',b='',fam=null;
  rows.slice().sort(function(p,q){return p.fam===q.fam?q.o-p.o:0}).forEach(function(x){if(x.fam!==fam)b+='<tr class="fam"><td colspan="7" dir="rtl" style="text-align:left">'+esc(x.fam)+'</td></tr>';fam=x.fam;
    var im=(D.thumbs||{})[x.sku];b+='<tr><td>'+(im?'<img src="'+im+'" alt="" width="48" height="48" style="display:block;border-radius:4px">':'')+'</td><td class="n" style="white-space:nowrap">'+xb('di',x.sku)+x.sku+'</td><td class="en">'+esc(x.name)+'</td>'+lyc(x.ol)+'<td class="n">'+(x.o?f(x.o):'')+'</td>'+ch(HL&&x.ol?pc(x.o,x.ol):null)+'<td class="n">'+(x.o?pz(x.o):'')+'</td></tr>'});
  b+='<tr class="tot"><td></td><td colspan="2">סה"כ (לקוחות שונים)</td>'+lyc(nl)+'<td class="n">'+f(nu)+'</td>'+ch(HL?pc(nu,nl):null)+'<td class="n">'+pz(nu)+'</td></tr>';
  document.getElementById('tDi').innerHTML=h+b;document.getElementById('tDiX').innerHTML=rb('di')}
function renderStock(){var S=D.stock,all=S.filter(function(x){return !x.total}),T0=S.filter(function(x){return x.total})[0]||{};
  all.forEach(function(x){var c=stockCalc(x);for(var k in c)x[k]=c[k]});var rows=vis('st',all,skuK);
  // итог: остатки и продажи — суммы видимых строк; дни запаса и % זיכויים — та же формула PBI от сумм
  var T={safe:T0.safe,partial:rows.length<all.length,wK:rows.length?sum(rows,function(x){return x.wK||0})/rows.length:null,cnt:rows.filter(function(x){return x.mU>0}).length};
  ['mU','mK','mP','mOK','avgK','sK','rec','nis','safeP','palDay','zk','br'].forEach(function(k){T[k]=sum(rows,function(x){return x[k]||0})});
  T.days=T.avgK?T.mOK/T.avgK*7/5:0;T.zik=T.br?T.zk/T.br:null;if(!T.partial)T.wK=T0.wK;
  function n(v,d){return v==null?'—':(d?(Math.round(v*10)/10).toLocaleString('en-US'):f(v))}
  var k=[['מלאי KARTON',n(T.mK)],['מלאי PALLET',n(T.mP)],['מלאי בטחון PALLETS',n(T.safeP)],['PALLETS מכר ממוצע ביום',n(T.palDay,1)],['מכר בקרטונים ממוצע ביום',n(T.avgK)],['WEIGHT KARTON ממוצע',n(T.wK,1)],['מוצרים במלאי',n(T.cnt)]];
  document.getElementById('sKpi').innerHTML=k.map(function(x){return '<div class="kpi"><span>'+x[0]+'</span><b dir="ltr">'+x[1]+'</b></div>'}).join('');
  var C=[['mU','מלאי UNITS'],['mK','מלאי KARTON'],['mP','מלאי PALLET'],['mOK','מלאי + הזמנות פתוחות קרטונים'],['avgK','מכר בקרטונים ממוצע ביום'],['sK','מכר בקרטונים בתקופה'],['days','לכמה ימים יספיק המלאי'],['safe','מלאי ביטחון (בימי מכר)'],['rec','הזמנה מומלצת KARTON'],['zik','% זיכויים'],['nis','שווי מלאי NIS']];
  function cell(x,c){var v=x[c];if(v==null)return '<td class="n"></td>';
    if(c==='zik')return '<td class="n">'+Math.round(v*100)+'%</td>';
    if(c==='nis')return '<td class="n">₪ '+f(v)+'</td>';
    if(c==='days'){var low=x.safe!=null&&v>0&&v<x.safe,hi=x.safe!=null&&v>x.safe*2;return '<td class="n" style="'+(low?'background:#FDE2E2;color:#B91C1C;font-weight:700':hi?'background:#FCE9DD':'')+'">'+f(v)+'</td>'}
    return '<td class="n">'+f(v)+'</td>'}
  var h='<tr><th>מק"ט</th><th>ENG</th>'+C.map(function(c){return '<th class="n" style="white-space:normal">'+c[1]+'</th>'}).join('')+'</tr>',b='',fam=null,nc=C.length+2;
  rows.forEach(function(x){if(x.fam!==fam)b+='<tr class="fam"><td colspan="'+nc+'" dir="rtl" style="text-align:left">'+esc(x.fam)+'</td></tr>';fam=x.fam;
    b+='<tr><td class="n" style="white-space:nowrap">'+xb('st',x.sku)+x.sku+'</td><td class="en" style="white-space:normal;min-width:170px;max-width:240px">'+esc(x.name)+'</td>'+C.map(function(c){return cell(x,c[0])}).join('')+'</tr>'});
  b+='<tr class="tot"><td colspan="2">סה"כ</td>'+C.map(function(c){return cell(T,c[0])}).join('')+'</tr>';
  document.getElementById('tSt').innerHTML=h+b;document.getElementById('tStX').innerHTML=rb('st')}
document.addEventListener('click',function(e){var kb=e.target.closest('button.kb');if(kb){KOS=kb.dataset.kos;document.querySelectorAll('button.kb').forEach(function(x){x.classList.toggle('on',x===kb)});HID.ch={};render();track('kos-'+(KOS==='all'?'all':KOS==='כן'?'yes':'no'));return}
  var yb=e.target.closest('[data-y],[data-mo]');if(yb&&!yb.disabled){var isY=yb.hasAttribute('data-y'),A=isY?YS:MS,v=+(isY?yb.dataset.y:yb.dataset.mo),k=A.indexOf(v);
    if(k<0)A.push(v);else A.splice(k,1);var ns=pickSel();if(!ns.length){if(k<0)A.splice(A.indexOf(v),1);else A.push(v);return}
    SEL=ns;render();track(isY?'y-sel':'m-sel');return}
  var b=e.target.closest('button.x,button.rs');if(!b)return;var t=b.dataset.t,hide=b.classList.contains('x');
  if(hide)HID[t][b.dataset.k]=1;else HID[t]={};render();track(hide?'row-hide':'row-restore')});
var btn=document.querySelectorAll('#tg button');
btn.forEach(function(b){b.onclick=function(){U=+b.dataset.i;btn.forEach(function(x){x.classList.toggle('on',x===b)});render();track(['tg-u','tg-krt','tg-kg'][U])}});
render();
// трекинг: секунды по разделам + переключения тумблера — только по личной ссылке /p/<hex>
var track=function(){};
(function(){
  if(!/^\\/p\\/[0-9a-f]{48}$/.test(location.pathname)||!navigator.sendBeacon)return;
  var url=location.pathname+'/ev',sid=Math.random().toString(36).slice(2,12),acc={},n=0,secs=[].slice.call(document.querySelectorAll('section'));
  function send(extra){var b={sid:sid,w:window.innerWidth,d:acc};for(var k in extra)b[k]=extra[k];navigator.sendBeacon(url,new Blob([JSON.stringify(b)],{type:'application/json'}));acc={};n=0}
  track=function(k){acc[k]=(acc[k]||0)+1;send({})};
  send({open:true});
  setInterval(function(){if(document.visibilityState!=='visible')return;var y=window.innerHeight*.45;
    for(var i=0;i<secs.length;i++){var r=secs[i].getBoundingClientRect();if(r.top<=y&&r.bottom>y){var k=secs[i].id;acc[k]=(acc[k]||0)+1;n++;break}}
    if(n>=15)send({})},1000);
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'&&n)send({})});
  window.addEventListener('pagehide',function(){if(n)send({})});
})();
})();
</script></body></html>`;
}

// ── остатки на 1-е число месяца (лист «Остатки» в Excel, пользователь 2026-10-05) ──
// Источник: Priority diller, склад Main = PBI מלאי INTER[מלאי זמין] (306202: 58,629 — совпало до штуки).
// Остаток на дату = текущий WARHSBAL − движения TRANSORDER с этой даты (каждая строка переносит QUANT
// со склада WARHS на TOWARHS). Снимки хранятся в файле: записанная дата больше не пересчитывается;
// cron 1-го в 00:05 дописывает фактический снимок (--snapshot).
const STOCK_HIST_FROM = '2026-01';
const SNAP_FILE = process.env.YARYCH_SNAP_FILE || path.join(require('os').homedir(), '.yarych-stock-snapshots.json');
const pcd = s2 => { const [y, m, dd] = s2.split('-').map(Number); return (Date.UTC(y, m - 1, dd) - Date.UTC(1988, 0, 1)) / 86400000 * 1440; };
async function priorityPool() {
  const sql = require('mssql');
  return new sql.ConnectionPool({ server: process.env.DB_SERVER, port: +process.env.DB_PORT || 1433, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: 'diller', options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 120000 }).connect();
}
async function stockAt(dates, skus) {
  const pool = await priorityPool();
  try {
    const inList = skus.map(p => `'${String(p).replace(/\D/g, '')}'`).join(',');
    const main = (await pool.request().query("SELECT WARHS FROM WAREHOUSES WHERE WARHSNAME = 'Main'")).recordset.map(r => r.WARHS);
    if (!main.length) throw new Error('склад Main не найден');
    const cur = (await pool.request().query(`SELECT P.PARTNAME, SUM(B.BALANCE) / 1000.0 AS bal FROM WARHSBAL B JOIN PART P ON P.PART = B.PART
      WHERE P.PARTNAME IN (${inList}) AND B.WARHS IN (${main}) GROUP BY P.PARTNAME`)).recordset;
    const from = dates.length ? Math.min(...dates.map(pcd)) : pcd(new Date().toISOString().slice(0, 10));
    const mv = (await pool.request().query(`SELECT P.PARTNAME, T.CURDATE,
      SUM(CASE WHEN T.TOWARHS IN (${main}) AND T.WARHS NOT IN (${main}) THEN T.QUANT WHEN T.WARHS IN (${main}) AND T.TOWARHS NOT IN (${main}) THEN -T.QUANT ELSE 0 END) / 1000.0 AS eff
      FROM TRANSORDER T JOIN PART P ON P.PART = T.PART WHERE P.PARTNAME IN (${inList}) AND T.CURDATE >= ${from} GROUP BY P.PARTNAME, T.CURDATE`)).recordset;
    const out = {};
    for (const dt of dates) {
      out[dt] = {};
      for (const p of skus) {
        const now = +(cur.find(r => String(r.PARTNAME).trim() === p)?.bal || 0);
        out[dt][p] = Math.round(now - mv.filter(r => String(r.PARTNAME).trim() === p && +r.CURDATE >= pcd(dt)).reduce((a, r) => a + r.eff, 0));
      }
    }
    return out;
  } finally { await pool.close(); }
}
async function stockHistory(skus, month) {
  const dates = []; for (let p = STOCK_HIST_FROM; p <= addMonths(month, 1); p = addMonths(p, 1)) dates.push(p + '-01');
  let snap = {}; try { snap = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8')); } catch (_) { /* первый запуск */ }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const missing = dates.filter(dt => !snap[dt] && dt <= today);
  if (missing.length) {
    const calc = await stockAt(missing, skus);
    for (const dt of missing) snap[dt] = calc[dt];
    if (!DRY_RUN) fs.writeFileSync(SNAP_FILE, JSON.stringify(snap, null, 1));
  }
  const ds = dates.filter(dt => snap[dt]);
  return { dates: ds, v: Object.fromEntries(skus.map(p => [p, ds.map(dt => snap[dt][p] ?? null)])) };
}

// ── Excel: листы Штуки / Картоны / Кг, фото товара, месяцы с первого месяца продаж ──
const RU_M = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const RU_MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const ruShort = p => `${RU_M[+p.slice(5) - 1]} ${p.slice(0, 4)}`;
const RU_INS = ['январём', 'февралём', 'мартом', 'апрелем', 'маем', 'июнем', 'июлем', 'августом', 'сентябрём', 'октябрём', 'ноябрём', 'декабрём'];
const TEST_NOTICE = process.argv.includes('--test-notice');
const RU_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function nextFirst() { const n = addMonths(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7), 1); return `1 ${RU_GEN[+n.slice(5) - 1]} ${n.slice(0, 4)} года`; }
const ruIns = p => `${RU_INS[+p.slice(5) - 1]} ${p.slice(0, 4)}`;
const ruLong = p => `${RU_MONTH[+p.slice(5) - 1]} ${p.slice(0, 4)}`;
const PHOTO_DIR = process.env.YARYCH_PHOTO_DIR || path.join(require('os').homedir(), '.yarych-photos');
async function loadPhotos(urls) {
  const sharp = require('sharp'), out = {};
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  for (const [sku, url] of Object.entries(urls)) {
    const f = path.join(PHOTO_DIR, sku.replace(/W/g, '') + '.png');
    if (fs.existsSync(f)) { out[sku] = fs.readFileSync(f); continue; }
    if (!url) continue;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      out[sku] = await sharp(Buffer.from(await r.arrayBuffer())).resize(120, 120, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
      fs.writeFileSync(f, out[sku]);
    } catch (e) { console.error('[yarych] фото', sku, e.message); } // без фото строка всё равно есть
  }
  return out;
}
async function buildExcel(d) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); wb.creator = 'AI Analytics Assistant';
  const photos = await loadPhotos(d.photoUrl || {});
  const imgId = {}; for (const [k, b] of Object.entries(photos)) imgId[k] = wb.addImage({ buffer: b, extension: 'png' });
  const { months, rows } = d.xl, N = months.length, FIRST = 5, HDR = 4;
  const colL = c => { let s = ''; for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s; return s; };
  const NAVY_X = 'FF1C3D6B', ZEBRA = 'FFF4F6FA', THIN = { style: 'thin', color: { argb: 'FFE5E7EB' } };
  [['Штуки', 0], ['Картоны', 1], ['Кг', 2]].forEach(([title, ui]) => {
    const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', xSplit: 4, ySplit: HDR }] });
    ws.columns = [{ width: 11 }, { width: 10 }, { width: 46 }, { width: 24 }, ...months.map(() => ({ width: 10 })), { width: 12 }];
    ws.getCell('A1').value = `YARYCH · продажи INTER по месяцам · ${title.toLowerCase()}`; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: NAVY_X } };
    ws.getCell('A2').value = `${ruShort(months[0])} – ${ruShort(months[N - 1])}, закрытые месяцы · источник: Power BI INTERNATIONAL CONTROL DESK`; ws.getCell('A2').font = { size: 10, color: { argb: 'FF6B7280' } };
    const hdr = ws.getRow(HDR); hdr.values = ['Фото', 'Код', 'Товар', 'Семья', ...months.map(ruShort), 'Итого']; hdr.height = 22;
    hdr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_X } }; c.alignment = { vertical: 'middle', horizontal: 'center' }; });
    rows.forEach((x, i) => {
      const r = ws.getRow(HDR + 1 + i), tot = x.v.reduce((a, v) => a + v[ui], 0);
      r.values = ['', +x.sku || x.sku, x.name, x.fam, ...x.v.map(v => Math.round(v[ui]) || null), Math.round(tot)];
      r.height = 48;
      r.eachCell({ includeEmpty: true }, (c, n) => {
        c.alignment = { vertical: 'middle', horizontal: n <= 4 ? 'left' : 'right', wrapText: n === 3 };
        if (n > 4) c.numFmt = '#,##0';
        if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        c.border = { bottom: THIN };
      });
      r.getCell(N + FIRST).font = { bold: true };
      if (imgId[x.sku] != null) ws.addImage(imgId[x.sku], { tl: { col: 0.12, row: HDR + i + 0.06 }, ext: { width: 60, height: 60 }, editAs: 'oneCell' });
    });
    // итог через SUBTOTAL — пересчитывается при фильтре
    const tr = ws.getRow(HDR + rows.length + 1), a = HDR + 1, b = HDR + rows.length;
    tr.getCell(3).value = 'ИТОГО';
    for (let c = FIRST; c <= N + FIRST; c++) {
      const L = colL(c - 1), val = c <= N + 4 ? rows.reduce((s2, x) => s2 + x.v[c - FIRST][ui], 0) : rows.reduce((s2, x) => s2 + x.v.reduce((q, v) => q + v[ui], 0), 0);
      tr.getCell(c).value = { formula: `SUBTOTAL(109,${L}${a}:${L}${b})`, result: Math.round(val) }; tr.getCell(c).numFmt = '#,##0';
    }
    tr.height = 24;
    tr.eachCell({ includeEmpty: true }, c => { c.font = { bold: true, color: { argb: NAVY_X } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; c.border = { top: { style: 'medium', color: { argb: NAVY_X } } }; });
    ws.autoFilter = { from: { row: HDR, column: 2 }, to: { row: HDR + rows.length, column: N + FIRST } };
  });
  // остатки на 1-е число месяца, штуки, склад Main
  if (d.stockHist && d.stockHist.dates.length) {
    const H = d.stockHist, M2 = H.dates.length, ruDate = dt => `1 ${RU_GEN[+dt.slice(5, 7) - 1]} ${dt.slice(0, 4)}`;
    const ws = wb.addWorksheet('Остатки, шт', { views: [{ state: 'frozen', xSplit: 4, ySplit: HDR }] });
    ws.columns = [{ width: 11 }, { width: 10 }, { width: 46 }, { width: 24 }, ...H.dates.map(() => ({ width: 12 }))];
    ws.getCell('A1').value = 'YARYCH · остатки на складе INTER на 1-е число месяца · штуки'; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: NAVY_X } };
    ws.getCell('A2').value = `${ruDate(H.dates[0])} – ${ruDate(H.dates[M2 - 1])} · склад Main (как מלאי זמין в Power BI) · источник: Priority`; ws.getCell('A2').font = { size: 10, color: { argb: 'FF6B7280' } };
    const hdr = ws.getRow(HDR); hdr.values = ['Фото', 'Код', 'Товар', 'Семья', ...H.dates.map(ruDate)]; hdr.height = 22;
    hdr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_X } }; c.alignment = { vertical: 'middle', horizontal: 'center' }; });
    rows.forEach((x, i) => {
      const r = ws.getRow(HDR + 1 + i), vs = H.v[x.sku] || [];
      r.values = ['', +x.sku || x.sku, x.name, x.fam, ...H.dates.map((_, j) => vs[j] ?? null)];
      r.height = 48;
      r.eachCell({ includeEmpty: true }, (c, n) => {
        c.alignment = { vertical: 'middle', horizontal: n <= 4 ? 'left' : 'right', wrapText: n === 3 };
        if (n > 4) { c.numFmt = '#,##0'; if (typeof c.value === 'number' && c.value < 0) c.font = { color: { argb: 'FFB91C1C' } }; }
        if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        c.border = { bottom: THIN };
      });
      if (imgId[x.sku] != null) ws.addImage(imgId[x.sku], { tl: { col: 0.12, row: HDR + i + 0.06 }, ext: { width: 60, height: 60 }, editAs: 'oneCell' });
    });
    const tr = ws.getRow(HDR + rows.length + 1), a = HDR + 1, b = HDR + rows.length;
    tr.getCell(3).value = 'ИТОГО';
    H.dates.forEach((_, j) => { const L = colL(FIRST - 1 + j); tr.getCell(FIRST + j).value = { formula: `SUBTOTAL(109,${L}${a}:${L}${b})`, result: rows.reduce((q, x) => q + ((H.v[x.sku] || [])[j] || 0), 0) }; tr.getCell(FIRST + j).numFmt = '#,##0'; });
    tr.height = 24;
    tr.eachCell({ includeEmpty: true }, c => { c.font = { bold: true, color: { argb: NAVY_X } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; c.border = { top: { style: 'medium', color: { argb: NAVY_X } } }; });
    ws.autoFilter = { from: { row: HDR, column: 2 }, to: { row: HDR + rows.length, column: M2 + 4 } };
  }
  return { buffer: await wb.xlsx.writeBuffer(), photos: Object.keys(photos).length };
}

// ── письмо ──────────────────────────────────────────────────────────────────
function buildEmail(d, t, link) {
  const ch = v => v == null ? '—' : `<span style="color:${v >= 0 ? GREEN : RED};font-weight:bold">${v > 0 ? '+' : ''}${v}%</span>`;
  const F = 'font-family:Arial,Helvetica,sans-serif;', ly = d.ly, M = ruLong(d.month), MS = ruShort(d.month), LS = ly ? ruShort(ly) : null;
  const kpi = (lab, val, extra = '') => `<td width="33%" align="center" valign="top" bgcolor="${PAPER}" style="${F}padding:14px 6px;border:1px solid ${LINE}"><div style="${F}font-size:13px;color:${MUTED}">${lab}</div><div style="${F}font-size:24px;font-weight:bold;color:${NAVY};padding-top:4px">${val}</div>${extra}</td>`;
  const share = t.u ? Math.round(100 * t.chainsU / t.u) : 0;
  const subject = `YARYCH · продажи INTER · ${M}`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:${PAPER}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:640px;max-width:640px;border:1px solid ${LINE}">
<tr><td bgcolor="${NAVY}" style="${F}padding:20px 28px">
  <img src="cid:diler-logo-white" alt="Diler BMD" height="34" style="display:block;height:34px;border:0">
  <div style="${F}font-size:22px;font-weight:bold;color:#ffffff;padding-top:12px">YARYCH · продажи INTER</div>
  <div style="${F}font-size:14px;color:#C9D5E8;padding-top:4px">Ежемесячный отчёт · ${M}</div>
</td></tr>
${TEST_NOTICE ? `<tr><td style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#FFF4D6" style="${F}padding:12px 16px;border:1px solid #E8C766;font-size:14px;line-height:1.5;color:#5C4400"><b>Это тестовое письмо.</b> Начиная с ${nextFirst()} этот отчёт будет приходить вам автоматически каждое 1-е число месяца — с итогами за прошедший месяц.</td></tr></table></td></tr>` : ''}
<tr><td style="${F}padding:26px 28px 6px;font-size:16px;color:${INK};line-height:1.5">
  <p style="margin:0 0 12px;font-size:17px;font-weight:bold">Дмитрий, добрый день!</p>
  <p style="margin:0">Направляю итоги продаж YARYCH по каналу INTER за ${M}${ly ? ` в сравнении с ${ruIns(ly)}` : ''}.</p>
</td></tr>
<tr><td style="padding:16px 22px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0"><tr>
  ${ly ? kpi(`${LS}, шт`, n0(t.lyU)) : ''}${kpi(`${MS}, шт`, n0(t.u))}${ly ? kpi('Изменение', ch(yoy(t.u, t.lyU))) : ''}
</tr></table></td></tr>
<tr><td style="${F}padding:6px 28px 18px;font-size:14px;color:${MUTED}">${MS}: картоны <b style="color:${INK}">${n0(t.krt)}</b> · кг <b style="color:${INK}">${n0(t.kg)}</b> · сети <b style="color:${INK}">${share}%</b> объёма, частный рынок <b style="color:${INK}">${100 - share}%</b></td></tr>
${link ? `<tr><td align="center" style="padding:22px 28px 8px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${NAVY}" style="padding:15px 40px;border-radius:8px;border:1px solid ${NAVY};mso-padding-alt:15px 40px">
  <a href="${link}" target="_blank" style="${F}display:block;font-size:17px;font-weight:bold;color:#ffffff !important;text-decoration:none;line-height:20px"><font color="#ffffff"><span style="color:#ffffff">Открыть полный отчёт&nbsp;&nbsp;→</span></font></a>
  </td></tr></table>
  <div style="${F}font-size:13px;color:${MUTED};padding-top:10px">Штуки / картоны / кг, все сети, топ частного рынка, остатки и рекомендация к заказу</div>
</td></tr>` : ''}
<tr><td style="${F}padding:14px 28px 24px;font-size:14px;color:${INK};line-height:1.5">📎 Во вложении — Excel с продажами по месяцам (${ruShort(d.xl.months[0])} – ${MS}) и фото товаров.</td></tr>
<tr><td bgcolor="${PAPER}" style="${F}padding:14px 28px;font-size:12px;color:${MUTED};border-top:1px solid ${LINE}">Отчёт сформирован автоматически из Power BI (INTERNATIONAL CONTROL DESK) · только INTER · поставщик YARYCH LLC</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

async function main() {
  if (process.argv.includes('--snapshot')) { // cron 1-го в 00:05: фактический снимок остатков на сегодня
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const { executeDax } = require('./powerbi');
    const skus = (await executeDax(`EVALUATE SELECTCOLUMNS(FILTER('KARTIS PARIT', 'KARTIS PARIT'[ספק] = "${SUPPLIER}"), "sku", 'KARTIS PARIT'[מק"ט])`, DS, WS)).map(r => String(r['[sku]']));
    let snap = {}; try { snap = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8')); } catch (_) {}
    snap[today] = (await stockAt([today], skus))[today];
    fs.writeFileSync(SNAP_FILE, JSON.stringify(snap, null, 1));
    console.log('снимок остатков', today, Object.values(snap[today]).reduce((a, b) => a + b, 0), 'шт ->', SNAP_FILE);
    return;
  }
  const now = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7);
  const month = arg('month') || addMonths(now, -1);
  const raw = await fetchData(addMonths(month, -(SHOW_MONTHS + 11)), month);
  const d = shape(raw, month);
  if (!d.skus.length) throw new Error(`нет продаж YARYCH/INTER за окно до ${month} — проверить датасет`);
  const t = totals(d);
  console.log(`YARYCH ${month}: ${n0(t.u)} шт / ${n0(t.krt)} крт / ${n0(t.kg)} кг, SKU ${d.skus.length}, сетей ${d.chains.length}`);
  try { const sharp = require('sharp'), ph = await loadPhotos(d.photoUrl || {}); d.thumbs = {};
    for (const [k, b] of Object.entries(ph)) d.thumbs[k] = 'data:image/jpeg;base64,' + (await sharp(b).resize(64, 64).jpeg({ quality: 78 }).toBuffer()).toString('base64');
  } catch (e) { console.error('[yarych] миниатюры', e.message); }
  try { d.stockHist = await stockHistory(Object.keys(d.photoUrl || {}), month); console.log('остатки на 1-е:', d.stockHist.dates.join(', ')); }
  catch (e) { console.error('[yarych] остатки на 1-е число не получены:', e.message); } // письмо уходит и без листа
  const page = buildPage(d);

  if (DRY_RUN) {
    const out = path.join(__dirname, '..', '.scratch', `yarych-${month}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out + '-page.html', page);
    const xl = await buildExcel(d); fs.writeFileSync(out + '.xlsx', Buffer.from(xl.buffer)); console.log('Excel:', out + '.xlsx', 'фото', xl.photos);
    const { html } = buildEmail(d, t, 'page.html');
    fs.writeFileSync(out + '-email.html', html.replace('cid:diler-logo-white', path.join(DOCS, 'logo-diler-bmd-white.png')).replace('href="page.html"', `href="${path.basename(out)}-page.html"`));
    console.log('--dry-run — ничего не отправлено, превью:', out + '-email.html', out + '-page.html');
    return;
  }
  // страница → /root/private-share/<hex>.html; hex генерируется на VPS и лежит вне репо (run-alert.sh читает файл)
  const share = process.env.YARYCH_SHARE;
  if (!/^[0-9a-f]{48}$/.test(share || '')) throw new Error('YARYCH_SHARE не задан (48 hex)');
  fs.writeFileSync(path.join(SHARE_DIR, share + '.html'), page);
  if (process.argv.includes('--page-only')) { console.log('--page-only — страница обновлена, письмо не отправлялось'); return; }
  const { subject, html } = buildEmail(d, t, `${PUBLIC}/p/${share}`);
  const xl = await buildExcel(d); console.log('Excel: фото', xl.photos, 'из', Object.keys(d.photoUrl).length);
  const list = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
  const to = list(arg('to') || process.env.YARYCH_REPORT_RECIPIENTS);
  const cc = arg('to') ? [] : list(process.env.YARYCH_REPORT_CC);
  if (!to.length) throw new Error('YARYCH_REPORT_RECIPIENTS не задан');
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const { Resend } = require('resend');
  const logo = path.join(DOCS, 'logo-diler-bmd-white.png');
  const res = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: `AI Analytics Assistant <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to, ...(cc.length ? { cc } : {}), subject, html,
    attachments: [
      ...(fs.existsSync(logo) ? [{ filename: 'logo-white.png', content: fs.readFileSync(logo).toString('base64'), contentId: 'diler-logo-white' }] : []),
      { filename: `YARYCH_INTER_${month}.xlsx`, content: Buffer.from(xl.buffer).toString('base64') },
    ],
  });
  console.log('Отправлено:', JSON.stringify(res));
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
