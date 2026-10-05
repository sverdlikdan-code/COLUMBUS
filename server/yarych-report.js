// yarych-report.js — ежемесячный отчёт продаж поставщика YARYCH (KARTIS PARIT[ספק] = 2110171),
// только חברה = INTER (пользователь 2026-10-05; адресаты — в run-alert.sh на VPS, репо публичный).
// Источник — датасет INTERNATIONAL CONTROL DESK (workspace CONTROL), те же меры, что на страницах
// YARICH / INTER +: штуки = [TOTAL UNITS _מכר_], кг = [WEIGHT KG.], картоны = SUM(KARTON).
// Сверено 2026-10-05: помесячные штуки совпали с визуалом SALES UNITS до единицы (Apr-25 75,003 … Sep-26 16,410).
//
// Письмо = короткая сводка + кнопка на личную страницу /p/<hex> (тумблер штуки/картоны/кг работает
// только на странице: почтовики режут JS). Страница пишется в /root/private-share/<YARYCH_SHARE>.html,
// трекинг чтения — тот же POST /p/<hex>/ev, что у Diler Intelligence.
//
// Usage: node yarych-report.js [--month=YYYY-MM] [--dry-run] [--page-only] [--to=a@b.com]
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
  const vals = `"u", [TOTAL UNITS _מכר_], "krt", SUM(${F}[KARTON]), "kg", [WEIGHT KG.]`;
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
  const photos = await executeDax(`EVALUATE SELECTCOLUMNS(FILTER(${K}, ${K}[ספק] = "${SUPPLIER}"), "sku", ${K}[מק"ט], "url", ${K}[URL תמונה])`, DS, WS);
  return { sku, chan, priv, stock: withTot(stock, stockTot), photos };
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
  return {
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
.ym{display:flex;gap:10px;align-items:flex-start;margin:0 0 10px;direction:ltr;flex-wrap:wrap}.ms{display:flex;gap:4px;flex-wrap:wrap;direction:ltr}.mg{display:grid;grid-template-columns:repeat(6,minmax(64px,1fr));flex:1;max-width:620px}
.ms button[disabled]{opacity:.35;cursor:default}.kpi b.up{color:var(--green)}.kpi b.dn{color:var(--red)}
@media(max-width:600px){.mg{grid-template-columns:repeat(4,minmax(0,1fr))}.ms button{padding:6px 4px}}.ms button{flex:0 0 auto;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:6px;padding:5px 8px;font:600 13.5px Arial;cursor:pointer}
.ms button.on{background:var(--navy);border-color:var(--navy);color:#fff}td.sel,th.sel{background:#FFF6DC}
main{max-width:1180px;margin:0 auto;padding:14px 16px 40px}
section{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 14px}
h2{margin:0 0 10px;font-size:19px;color:var(--navy)}
.kt{display:flex;gap:10px;align-items:center;justify-content:center;margin:0 0 12px}.tg.sm{border-width:2px}.tg.sm button{padding:7px 18px;font-size:14px}
.un{display:inline-block;vertical-align:middle;margin-right:8px;background:var(--gold);color:#fff;font-size:13px;font-weight:700;padding:3px 10px;border-radius:999px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
#kpis .kpi{text-align:right}.kpi{border:1px solid var(--line);border-radius:8px;padding:10px}.kpi b{display:block;font-size:26px;color:var(--navy)}.kpi span{color:var(--muted);font-size:14px}
.up{color:var(--green)}.dn{color:var(--red)}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:14.5px}th,td{padding:5px 7px;border-bottom:1px solid var(--line);white-space:nowrap}
th{background:var(--paper);color:var(--muted);font-weight:600;position:sticky;top:0}
td.n,th.n{text-align:left;direction:ltr;font-variant-numeric:tabular-nums}
tr.fam td{background:#EEF2F8;font-weight:700;color:var(--navy)}tr.tot td{font-weight:700;border-top:2px solid var(--navy)}
td.en{text-align:left}#tSku th,#tSku td{text-align:right}#tSku .st{position:sticky;background:#fff;z-index:1}#tSku .s1{left:0;min-width:58px;text-align:left}#tSku .s2{left:58px;border-right:1px solid var(--line);text-align:left}#tSku tr.fam .st{background:#EEF2F8}#tSku th.st{background:var(--paper);z-index:2}
@media(max-width:600px){#tSku .s1{display:none}#tSku .s2{left:0;white-space:normal;min-width:130px;max-width:140px;font-size:11.5px;line-height:1.25}}
button.x{border:0;background:none;color:#B0B7C3;cursor:pointer;font-size:11px;padding:0 4px;margin:0 2px}button.x:hover{color:var(--red)}
button.rs{margin-top:8px;border:1px solid var(--navy);background:#fff;color:var(--navy);border-radius:6px;padding:5px 10px;font:600 13.5px Arial;cursor:pointer}
#tSt th,#tSt td,table.lt th,table.lt td{text-align:right}table.lt td:first-child,table.lt th:first-child{text-align:left}#tSt td:nth-child(-n+2),#tSt th:nth-child(-n+2){text-align:left}#tSt th,#tSt td{padding:5px 6px}
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
<section id="sku"><h2>מכירות לפי מוצר <span class="un"></span></h2><div class="ym"><div class="ms" id="ys"></div><div class="ms mg" id="ms"></div></div><div class="scroll" id="skuWrap" dir="ltr"><table id="tSku" dir="ltr"></table></div><div id="skuX"></div></section>
<section id="chains"><div class="kt" id="kt"><span class="sh">כשרות לקוח:</span><div class="tg sm"><button class="kb on" data-kos="all">הכל</button><button class="kb" data-kos="כן">כשר</button><button class="kb" data-kos="לא">לא כשר</button></div></div><h2>רשתות — כמה לקחה כל רשת ומשקלה מהסה"כ <span class="un"></span></h2><div class="scroll" dir="ltr"><table id="tCh" dir="ltr" class="lt"></table></div><div id="tChX"></div><div id="tChR"></div></section>
<section id="private"><h2>שוק פרטי — ${TOP_PRIVATE} הלקוחות הגדולים בתקופה הנבחרת <span class="un"></span></h2><div class="scroll" dir="ltr"><table id="tPr" dir="ltr" class="lt"></table></div><div id="tPrX"></div></section>
<section id="stock"><h2>מלאי והזמנה מומלצת — ${label(d.stockFrom)}–${label(d.month)}</h2><p class="sh" style="margin:-4px 0 10px;font-size:12px">מכר — 3 החודשים האחרונים · מלאי נכון ל-${d.asOf} · כמו בדף YARICH מלאי ב-Power BI · לא תלוי במתג היחידות</p><div class="kpis" id="sKpi"></div><div class="scroll" style="margin-top:10px" dir="ltr"><table id="tSt" dir="ltr"></table></div><div id="tStX"></div></section>
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
var HID={sku:{},st:{},ch:{},pr:{}};
function vis(t,a,key){return a.filter(function(x){return !HID[t][key(x)]})}
function xb(t,k){return '<button class="x" data-t="'+t+'" data-k="'+esc(k)+'" title="הסתר שורה">✕</button>'}
function rb(t){var n=Object.keys(HID[t]).length;return n?'<button class="rs" data-t="'+t+'">↺ החזר '+n+' שורות מוסתרות</button>':''}
function skuK(x){return x.sku}function nmK(x){return x.name}
function render(){selState();
  document.querySelectorAll('.un').forEach(function(e){e.textContent=['יחידות','קרטונים','ק"ג'][U]});
  document.getElementById('ys').innerHTML=YEARS.map(function(y){return '<button data-y="'+y+'"'+(YS.indexOf(y)>=0?' class="on"':'')+'>'+y+'</button>'}).join('');
  document.getElementById('ms').innerHTML=MN.map(function(n,j){var m=j+1,has=D.months.some(function(p){return +p.slice(5)===m&&YS.indexOf(+p.slice(0,4))>=0});
    return '<button data-mo="'+m+'"'+(MS.indexOf(m)>=0?' class="on"':'')+(has?'':' disabled')+'>'+(window.innerWidth<600?n.slice(0,3):n)+'</button>'}).join('');
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
    var h='<tr><th>'+nameHd+'</th><th class="n">'+(lyL||'שנה שעברה')+'</th><th class="n">'+SL+'</th><th class="n">'+(lyL?'מול '+lyL:'שינוי')+'</th><th class="n">% מסה"כ</th></tr>';
    function row(x){return '<tr><td>'+xb(t,x.name)+esc(x.name)+'</td>'+lyc(lyv(x))+'<td class="n">'+f(cur(x))+'</td>'+ch(HL?pc(cur(x),lyv(x)):null)+sh(cur(x),TF)+'</tr>'}
    var act=keepAll?a:a.filter(function(x){return cur(x)}),rest=[] /* сети без продаж в периоде не показываем (пользователь 2026-10-05) */,b=act.map(row).join('');
    if(total){var c=sum(a,cur),cl=sum(a,lyv);b+='<tr class="tot"><td>'+total+'</td>'+lyc(cl)+'<td class="n">'+f(c)+'</td>'+ch(HL?pc(c,cl):null)+sh(c,TF)+'</tr>'}
    document.getElementById(id).innerHTML=h+b;document.getElementById(id+'X').innerHTML=rb(t);
    var r=document.getElementById(id+'R');if(r)r.innerHTML=rest.length?'<details><summary>עוד '+rest.length+' רשתות בלי מכירות ב-'+SL+(HL?' ('+f(sum(rest,lyv))+' ב-'+lyL+')':'')+'</summary><div class="scroll" dir="ltr"><table dir="ltr" class="lt">'+h+rest.map(row).join('')+'</table></div></details>':''}
  tbl('tCh','ch',chainsFor().filter(function(x){return cur(x)||lyv(x)}),'רשת','סה"כ רשתות');
  tbl('tPr','pr',D.priv,'לקוח',null,true,D.topN);
  renderStock();
}
function renderStock(){var S=D.stock,all=S.filter(function(x){return !x.total}),rows=vis('st',all,skuK),T=S.filter(function(x){return x.total})[0]||{};
  // пока ничего не скрыто — итог из PBI; иначе суммы видимых, дни запаса и % זיכויים — «—» (формулы PBI не суммируются)
  if(rows.length<all.length){var A=['mU','mK','mOK','avgK','sK','rec','nis'];T={safe:T.safe,days:null,zik:null,mP:null,safeP:null,palDay:null,partial:true,
    wK:rows.length?sum(rows,function(x){return x.wK||0})/rows.length:null,cnt:rows.filter(function(x){return x.mU>0}).length};
    A.forEach(function(k){T[k]=sum(rows,function(x){return x[k]||0})})}
  function n(v,d){return v==null?'—':(d?(Math.round(v*10)/10).toLocaleString('en-US'):f(v))}
  var k=[['מלאי KARTON',n(T.mK)],['מלאי PALLET',n(T.mP)],['מלאי בטחון PALLETS',n(T.safeP)],['PALLETS מכר ממוצע ביום',n(T.palDay,1)],['מכר בקרטונים ממוצע ביום',n(T.avgK)],['WEIGHT KARTON ממוצע',n(T.wK,1)],['מוצרים במלאי',n(T.cnt)]];
  document.getElementById('sKpi').innerHTML=k.map(function(x){return '<div class="kpi"><span>'+x[0]+'</span><b dir="ltr">'+x[1]+'</b></div>'}).join('');
  var C=[['mU','מלאי UNITS'],['mK','מלאי KARTON'],['mP','מלאי PALLET'],['mOK','מלאי + הזמנות פתוחות קרטונים'],['avgK','מכר בקרטונים ממוצע ביום'],['sK','מכר בקרטונים בתקופה'],['days','לכמה ימים יספיק המלאי'],['safe','מלאי ביטחון (בימי מכר)'],['rec','הזמנה מומלצת KARTON'],['zik','% זיכויים'],['nis','שווי מלאי NIS']];
  function cell(x,c){var v=x[c];if(v==null)return '<td class="n'+(x.partial?' sh':'')+'">'+(x.partial?'—':'')+'</td>';
    if(c==='zik')return '<td class="n">'+Math.round(v*100)+'%</td>';
    if(c==='nis')return '<td class="n">₪ '+f(v)+'</td>';
    if(c==='days'){var low=x.safe!=null&&v>0&&v<x.safe,hi=x.safe!=null&&v>x.safe*2;return '<td class="n" style="'+(low?'background:#FDE2E2;color:#B91C1C;font-weight:700':hi?'background:#FCE9DD':'')+'">'+f(v)+'</td>'}
    return '<td class="n">'+f(v)+'</td>'}
  var h='<tr><th>מק"ט</th><th>ENG</th>'+C.map(function(c){return '<th class="n" style="white-space:normal;min-width:56px">'+c[1]+'</th>'}).join('')+'</tr>',b='',fam=null,nc=C.length+2;
  rows.forEach(function(x){if(x.fam!==fam)b+='<tr class="fam"><td colspan="'+nc+'" dir="rtl" style="text-align:left">'+esc(x.fam)+'</td></tr>';fam=x.fam;
    b+='<tr><td class="n" style="white-space:nowrap">'+xb('st',x.sku)+x.sku+'</td><td class="en" style="white-space:normal;min-width:170px;max-width:240px">'+esc(x.name)+'</td>'+C.map(function(c){return cell(x,c[0])}).join('')+'</tr>'});
  b+='<tr class="tot"><td colspan="2">סה"כ</td>'+C.map(function(c){return cell(T,c[0])}).join('')+'</tr>';
  document.getElementById('tSt').innerHTML=h+b;document.getElementById('tStX').innerHTML=rb('st')+(T.partial?'<span class="sh" style="font-size:12px;margin-right:8px">PALLET, ימי מלאי ו-% זיכויים בסה"כ — רק בלי שורות מוסתרות (נוסחת Power BI)</span>':'')}
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

// ── Excel: листы Штуки / Картоны / Кг, фото товара, месяцы с первого месяца продаж ──
const RU_M = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const RU_MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const ruShort = p => `${RU_M[+p.slice(5) - 1]} ${p.slice(0, 4)}`;
const RU_INS = ['январём', 'февралём', 'мартом', 'апрелем', 'маем', 'июнем', 'июлем', 'августом', 'сентябрём', 'октябрём', 'ноябрём', 'декабрём'];
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
  return { buffer: await wb.xlsx.writeBuffer(), photos: Object.keys(photos).length };
}

// ── письмо ──────────────────────────────────────────────────────────────────
function buildEmail(d, t, link) {
  const ch = v => v == null ? '—' : `<span style="color:${v >= 0 ? GREEN : RED};font-weight:bold">${v > 0 ? '+' : ''}${v}%</span>`;
  const byName = {}; for (const x of d.chains) { const y = byName[x.name] = byName[x.name] || { name: x.name, u: 0, ly: 0 }; y.u += x.v.at(-1)[0]; y.ly += x.l.at(-1)?.[0] || 0; }
  const top = Object.values(byName).filter(x => x.u).sort((a, b) => b.u - a.u).slice(0, 5);
  const F = 'font-family:Arial,Helvetica,sans-serif;', ly = d.ly, M = ruLong(d.month), MS = ruShort(d.month), LS = ly ? ruShort(ly) : null;
  const kpi = (lab, val, extra = '') => `<td width="33%" align="center" valign="top" bgcolor="${PAPER}" style="${F}padding:14px 6px;border:1px solid ${LINE}"><div style="${F}font-size:13px;color:${MUTED}">${lab}</div><div style="${F}font-size:24px;font-weight:bold;color:${NAVY};padding-top:4px">${val}</div>${extra}</td>`;
  const th = (txt, al = 'right') => `<th align="${al}" style="${F}font-size:13px;color:${MUTED};font-weight:bold;padding:8px 10px;border-bottom:2px solid ${NAVY}">${txt}</th>`;
  const td = (txt, al = 'right', ex = '') => `<td align="${al}" style="${F}font-size:14px;color:${INK};padding:8px 10px;border-bottom:1px solid ${LINE}"${ex}>${txt}</td>`;
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
<tr><td style="${F}padding:26px 28px 6px;font-size:16px;color:${INK};line-height:1.5">
  <p style="margin:0 0 12px;font-size:17px;font-weight:bold">Дмитрий, добрый день!</p>
  <p style="margin:0">Направляю итоги продаж YARYCH по каналу INTER за ${M}${ly ? ` в сравнении с ${ruIns(ly)}` : ''}.</p>
</td></tr>
<tr><td style="padding:16px 22px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0"><tr>
  ${ly ? kpi(`${LS}, шт`, n0(t.lyU)) : ''}${kpi(`${MS}, шт`, n0(t.u))}${ly ? kpi('Изменение', ch(yoy(t.u, t.lyU))) : ''}
</tr></table></td></tr>
<tr><td style="${F}padding:6px 28px 18px;font-size:14px;color:${MUTED}">${MS}: картоны <b style="color:${INK}">${n0(t.krt)}</b> · кг <b style="color:${INK}">${n0(t.kg)}</b> · сети <b style="color:${INK}">${share}%</b> объёма, частный рынок <b style="color:${INK}">${100 - share}%</b></td></tr>
<tr><td style="${F}padding:0 28px 6px;font-size:15px;font-weight:bold;color:${NAVY}">Топ-5 сетей, штуки</td></tr>
<tr><td style="padding:0 28px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>${th('Сеть', 'left')}${ly ? th(LS) : ''}${th(MS)}${ly ? th('Изм.') : ''}${th('Доля')}</tr>
  ${top.map(x => `<tr>${td(esc(x.name), 'left', ' dir="rtl"')}${ly ? td(n0(x.ly)) : ''}${td('<b>' + n0(x.u) + '</b>')}${ly ? td(ch(yoy(x.u, x.ly))) : ''}${td((t.u ? Math.round(1000 * x.u / t.u) / 10 : 0) + '%')}</tr>`).join('')}
</table></td></tr>
${link ? `<tr><td align="center" style="padding:22px 28px 8px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${NAVY}" style="padding:15px 40px;border-radius:8px;border:1px solid ${NAVY};mso-padding-alt:15px 40px">
  <a href="${link}" target="_blank" style="${F}display:block;font-size:17px;font-weight:bold;color:#ffffff;text-decoration:none;line-height:20px">Открыть полный отчёт&nbsp;&nbsp;→</a>
  </td></tr></table>
  <div style="${F}font-size:13px;color:${MUTED};padding-top:10px">Штуки / картоны / кг, все сети, топ частного рынка, остатки и рекомендация к заказу</div>
</td></tr>` : ''}
<tr><td style="${F}padding:14px 28px 24px;font-size:14px;color:${INK};line-height:1.5">📎 Во вложении — Excel с продажами по месяцам (${ruShort(d.xl.months[0])} – ${MS}) и фото товаров.</td></tr>
<tr><td bgcolor="${PAPER}" style="${F}padding:14px 28px;font-size:12px;color:${MUTED};border-top:1px solid ${LINE}">Отчёт сформирован автоматически из Power BI (INTERNATIONAL CONTROL DESK) · только INTER · поставщик YARYCH LLC</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

async function main() {
  const now = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7);
  const month = arg('month') || addMonths(now, -1);
  const raw = await fetchData(addMonths(month, -(SHOW_MONTHS + 11)), month);
  const d = shape(raw, month);
  if (!d.skus.length) throw new Error(`нет продаж YARYCH/INTER за окно до ${month} — проверить датасет`);
  const t = totals(d);
  console.log(`YARYCH ${month}: ${n0(t.u)} шт / ${n0(t.krt)} крт / ${n0(t.kg)} кг, SKU ${d.skus.length}, сетей ${d.chains.length}`);
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
