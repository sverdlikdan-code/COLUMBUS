// route-changes-alert.js — еженедельный алярм Юлии Дзюмак (чт 16:00 Израиль): дни и порядок визитов
// так, как они сейчас стоят в Formula Road («הגרסה שלי» + переносы дней), для внесения в Priority.
//   Лист FORMULA — ВСЕ клиенты 'משטח' по всем агентам, строка на каждый день визита (2+ визита —
//     светло-зелёная строка), клиенты без дня — строка с пустым днём. Ячейка יום/סדר הגעה, которая
//     отличается от Priority, — оранжевая, в примечании ячейки — что стоит в Priority.
//   Лист ICE משפחתי — только клиенты, у которых в приложении поменялся день (порядка в Priority у ICE нет).
// Источник правок — LIVE_DATA_DIR/route-overrides.json (index.js /api/route-order, /api/route-day-move).
// Порядок дня повторяет клиент (formula-road.html initRoute): сохранённый order[day] (mergeWithSaved),
// остальные — в порядке сервера (סדר ביקור, потом перенесённые в день). Нумерация — только среди FORMULA.
// День, который агент не трогал (нет order[day] и переносов), — номера Priority как есть, без подсветки.
// Адресаты (env из run-alert.sh): ROUTE_CHANGES_TO, ROUTE_CHANGES_CC;
//   ROUTE_CHANGES_OVERRIDE=<email> — режим проверки: всё на этот адрес, в теме — кому шло бы.
// --dry-run: письмо не шлётся, xlsx + html пишутся в LIVE_DATA_DIR/route-changes-preview.
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const ExcelJS = require('exceljs');
const { executeDax } = require('./powerbi');
const { lineFor } = require('./coverage');

const DRY_RUN = process.argv.includes('--dry-run');
const LIVE_DATA = process.env.LIVE_DATA_DIR || path.join(__dirname, 'data');
const LETTERS = ['', 'א', 'ב', 'ג', 'ד', 'ה'];
const DAY_NUM = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ראשון': 1, 'שני': 2, 'שלישי': 3, 'רביעי': 4, 'חמישי': 5 };

// Та же функция, что в client-changes-alert.js / obligo-alert.js.
const BIDI_TEST = /[‎‏‪-‮]/;
const BIDI_STRIP = /[‎‏‪-‮]/g;
function fixBiDi(raw) {
  if (!raw) return '';
  const hasBidi = BIDI_TEST.test(raw);
  const s = String(raw).replace(BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  return s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('').replace(/\d+/g, m => m.split('').reverse().join('')) : w)
    .join(' ');
}

async function fetchPbi() {
  const [clientRows, schedRows] = await Promise.all([
    executeDax(`
EVALUATE
SELECTCOLUMNS('משטח',
  "custId",    'משטח'[מס. לקוח],
  "custName",  'משטח'[שם לקוח],
  "agentCode", 'משטח'[סוכן],
  "agentName", 'משטח'[שם סוכן],
  "manager",   'משטח'[קבוצה]
)`),
    executeDax(`
EVALUATE
SELECTCOLUMNS('משטח עם כפולות',
  "custId",     'משטח עם כפולות'[מס.לקוח],
  "day",        'משטח עם כפולות'[יום],
  "visitOrder", 'משטח עם כפולות'[סדר ביקור]
)`),
  ]);
  const formula = new Map();
  for (const r of clientRows) {
    const id = String(r['[custId]'] || '');
    if (!id) continue;
    formula.set(id, { id, name: fixBiDi(r['[custName]'] || ''), agent: String(r['[agentCode]'] || ''), agentName: fixBiDi(r['[agentName]'] || ''), manager: r['[manager]'] || '', sched: [] });
  }
  for (const r of schedRows) {
    const c = formula.get(String(r['[custId]'] || ''));
    const dayNum = DAY_NUM[fixBiDi(r['[day]'] || '')];
    // שבת/שישי — не рабочий день приложения: такой клиент в приложении в «?», как и тут
    if (!c || !dayNum) continue;
    const vo = parseInt(r['[visitOrder]'], 10);
    c.sched.push({ dayNum, order: vo > 0 ? vo : null });
  }

  const ice = new Map();
  if (process.env.POWERBI_ICE_DATASET_ID) {
    const iceRows = await executeDax(`
EVALUATE
SELECTCOLUMNS(
  FILTER('MISHPAHTI ICE MISHTAH', LEN('MISHPAHTI ICE MISHTAH'[שם סוכן נוסף]) > 0),
  "custId",    'MISHPAHTI ICE MISHTAH'[מס. לקוח],
  "custName",  'MISHPAHTI ICE MISHTAH'[שם לקוח],
  "agentCode", 'MISHPAHTI ICE MISHTAH'[מס.סוכן נוסף],
  "dayLetter", 'MISHPAHTI ICE MISHTAH'[פרמטר 18]
)`, process.env.POWERBI_ICE_DATASET_ID);
    for (const r of iceRows) {
      const id = String(r['[custId]'] || '');
      const agent = String(r['[agentCode]'] || '');
      if (!id || !agent || agent === 'null' || formula.has(id)) continue; // как в кэше: FORMULA-клиент никогда не ICE-only
      if (!ice.has(id)) ice.set(id, { id, name: fixBiDi(r['[custName]'] || ''), agent, sched: [] });
      const dayNum = DAY_NUM[String(r['[dayLetter]'] || '').trim()];
      if (dayNum && !ice.get(id).sched.some(s => s.dayNum === dayNum)) ice.get(id).sched.push({ dayNum });
    }
  }
  return { formula, ice };
}

const byAgentOf = map => {
  const by = new Map();
  for (const c of map.values()) {
    if (!c.agent) continue;
    if (!by.has(c.agent)) by.set(c.agent, []);
    by.get(c.agent).push(c);
  }
  return by;
};
const daysStr = nums => nums.length ? [...nums].sort().map(d => LETTERS[d]).join(', ') : 'ללא יום';

// id, перенесённые в день (нет в этом дне Priority), + id вне самой длинной неубывающей
// подпоследовательности номеров Priority (O(n²), n<50 в дне). Стоит в дне без номера — не «передвинут».
function movedIds(ids, prioOf, inPrioDay) {
  const p = ids.map(prioOf);
  const len = p.map(() => 0), prev = p.map(() => -1);
  let best = -1;
  p.forEach((v, i) => {
    if (v == null) return;
    len[i] = 1;
    for (let j = 0; j < i; j++) if (p[j] != null && p[j] <= v && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    if (best < 0 || len[i] > len[best]) best = i;
  });
  const keep = new Set();
  for (let i = best; i >= 0; i = prev[i]) keep.add(i);
  return new Set(ids.filter((id, i) => !inPrioDay(id) || (p[i] != null && !keep.has(i))));
}

function buildFormulaRows(formula, overrides) {
  const rows = [];
  for (const [agent, clients] of byAgentOf(formula)) {
    const ov = overrides[agent] || {};
    const moves = ov.dayMoves || {};
    const mine = id => formula.get(id)?.agent === agent;
    const scheduled = clients.flatMap(c => c.sched.map(s => ({ custId: c.id, dayNum: s.dayNum })));
    const appDays = new Map(clients.map(c => [c.id, []]));
    for (let d = 1; d <= 5; d++) {
      const line = lineFor({ scheduled, dayMoves: moves, dayNum: d, movedInOk: mine });
      const prioOf = id => formula.get(id).sched.find(s => s.dayNum === d)?.order ?? null;
      // порядок сервера (/customers): по סדר ביקור, без номера — в конце, перенесённые в день — последними
      const serverOrder = [...line].sort((a, b) =>
        ((prioOf(a) ?? (formula.get(a).sched.some(s => s.dayNum === d) ? 999 : 9500)) - (prioOf(b) ?? (formula.get(b).sched.some(s => s.dayNum === d) ? 999 : 9500)))
        || a.localeCompare(b));
      const saved = (ov.order?.[d] || []).map(String).filter(id => line.has(id));
      const ordered = [...saved, ...serverOrder.filter(id => !saved.includes(id))];
      // Номера Priority с пропусками и повторами (1,1,2,…,15,15,17) — перенумерация сама по себе не
      // изменение. «Передвинут» = нет номера в Priority (перенесён в день) или вне самой длинной
      // неубывающей подпоследовательности номеров Priority. Есть такие — день нумеруется 1..N,
      // нет — номера Priority как есть (уход клиента из дня Priority не мешает: пропуски там норма).
      const inPrioDay = id => formula.get(id).sched.some(s => s.dayNum === d);
      const moved = movedIds(ordered, prioOf, inPrioDay);
      ordered.forEach((id, i) => {
        const prio = prioOf(id);
        appDays.get(id).push({ dayNum: d, order: moved.size ? i + 1 : prio, prio, moved: moved.has(id), inPrio: formula.get(id).sched.some(s => s.dayNum === d) });
      });
    }
    for (const c of clients) {
      const visits = appDays.get(c.id);
      const prioDays = daysStr(c.sched.map(s => s.dayNum));
      const multi = visits.length > 1;
      if (!visits.length) {
        rows.push({ c, day: '', order: null, multi, dayChanged: c.sched.length > 0, orderChanged: false, prioDays });
        continue;
      }
      for (const v of visits) {
        rows.push({ c, day: LETTERS[v.dayNum], dayNum: v.dayNum, order: v.order, multi, prioDays, prio: v.prio,
          dayChanged: !v.inPrio || visits.length !== c.sched.length,
          orderChanged: v.moved });
      }
    }
  }
  return rows.sort((a, b) => (Number(a.c.agent) - Number(b.c.agent)) || ((a.dayNum || 9) - (b.dayNum || 9)) || ((a.order ?? 9999) - (b.order ?? 9999)) || a.c.id.localeCompare(b.c.id));
}

function buildIceRows(ice, overrides) {
  const rows = [];
  for (const [agent, clients] of byAgentOf(ice)) {
    const moves = overrides[agent]?.dayMoves || {};
    const scheduled = clients.flatMap(c => c.sched.map(s => ({ custId: c.id, dayNum: s.dayNum })));
    const appDays = new Map(clients.map(c => [c.id, []]));
    for (let d = 1; d <= 5; d++) {
      for (const id of lineFor({ scheduled, dayMoves: moves, dayNum: d, movedInOk: id => ice.get(id)?.agent === agent })) appDays.get(id).push(d);
    }
    for (const c of clients) {
      const app = appDays.get(c.id), prio = c.sched.map(s => s.dayNum);
      if (daysStr(app) === daysStr(prio)) continue;
      const prioDays = daysStr(prio);
      if (!app.length) { rows.push({ c, day: '', dayChanged: true, prioDays }); continue; }
      for (const d of app) rows.push({ c, day: LETTERS[d], dayNum: d, multi: app.length > 1, dayChanged: true, prioDays });
    }
  }
  return rows.sort((a, b) => (Number(a.c.agent) - Number(b.c.agent)) || ((a.dayNum || 9) - (b.dayNum || 9)) || a.c.id.localeCompare(b.c.id));
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const C = { header: '1F4E79', yellow: 'FFFF00', yellowHead: 'FFFF00', red: 'C00000', green: 'E2EFDA', orange: 'F4B183' };
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + argb } });
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const border = { top: thin, bottom: thin, left: thin, right: thin };

// Легенда над таблицей («в шапке описать всё», пользователь 06.10), таблица с её строки заголовков.
function addSheet(wb, name, cols, legend, rows, cellsOf) {
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: legend.length + 1 }] });
  ws.columns = cols.map(c => ({ key: c.key, width: c.width }));
  legend.forEach(([text, argb], i) => {
    const r = ws.getRow(i + 1);
    r.getCell(1).value = text;
    ws.mergeCells(i + 1, 1, i + 1, cols.length);
    r.getCell(1).font = { bold: i === 0, size: i === 0 ? 13 : 11 };
    if (argb) r.getCell(1).fill = fill(argb);
  });
  const hr = legend.length + 1;
  const head = ws.getRow(hr);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: c.yellow ? 'FF' + C.red : 'FFFFFFFF' } };
    cell.fill = fill(c.yellow ? C.yellowHead : C.header);
    cell.border = border;
    cell.alignment = { horizontal: 'center' };
  });
  for (const r of rows) {
    const row = ws.addRow(cellsOf(r));
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.border = border;
      cell.alignment = { horizontal: c.key === 'name' ? 'right' : 'center' };
      if (c.yellow) cell.fill = fill(C.yellow);
      else if (r.multi) cell.fill = fill(C.green);
      const changed = (c.key === 'day' && r.dayChanged) || (c.key === 'order' && r.orderChanged);
      if (changed) {
        cell.fill = fill(C.orange);
        cell.font = { bold: true };
        cell.note = c.key === 'day' ? `בפריוריטי: ${r.prioDays}` : `בפריוריטי: ${r.prio ?? 'ללא סדר'}`;
      }
    });
  }
  ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr, column: cols.length } };
  return ws;
}

async function buildXlsx(fRows, iRows, dateStr) {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, 'FORMULA', [
    { header: 'מס.לקוח', key: 'id', width: 11 },
    { header: "מס' סוכן", key: 'agent', width: 9 },
    { header: 'יום', key: 'day', width: 6 },
    { header: 'תדירות', key: 'freq', width: 8, yellow: true },
    { header: 'שבוע 1', key: 'w1', width: 8, yellow: true },
    { header: 'שבוע 2', key: 'w2', width: 8, yellow: true },
    { header: 'שבוע 3', key: 'w3', width: 8, yellow: true },
    { header: 'שבוע 4', key: 'w4', width: 8, yellow: true },
    { header: 'סדר הגעה', key: 'order', width: 10 },
    { header: 'שם לקוח', key: 'name', width: 40 },
  ], [
    [`FORMULA — ימים וסדר ביקור כפי שהם באפליקציה Formula Road · ${dateStr}`],
    ['כל הלקוחות של כל הסוכנים. יום וסדר הגעה — מהאפליקציה ("הגרסה שלי"), כולל העברות ימים.'],
    ['ירוק בהיר — ללקוח יותר מביקור אחד בשבוע (שורה לכל יום ביקור)', C.green],
    ['כתום — שונה מפריוריטי: יום חדש / לקוח שהסוכן הזיז בסדר; מה שרשום בפריוריטי — בהערה של התא', C.orange],
    ['ביום שיש בו כתום בסדר הגעה — כל היום ממוספר מחדש 1, 2, 3… לפי האפליקציה; ימים בלי שינוי — המספרים מפריוריטי'],
    ['יום ריק — ללקוח אין יום ביקור'],
  ], fRows, r => ({ id: r.c.id, agent: r.c.agent, day: r.day, freq: 4, w1: 'Y', w2: 'Y', w3: 'Y', w4: 'Y', order: r.order ?? '', name: r.c.name }));
  addSheet(wb, 'ICE משפחתי', [
    { header: 'מס.לקוח', key: 'id', width: 11 },
    { header: "מס' סוכן", key: 'agent', width: 9 },
    { header: 'יום', key: 'day', width: 6 },
    { header: 'שם לקוח', key: 'name', width: 40 },
  ], [
    [`ICE משפחתי — שינויי יום ביקור באפליקציה · ${dateStr}`],
    ['רק לקוחות שיום הביקור שלהם באפליקציה שונה מפריוריטי (פרמטר 18). מס\' סוכן — הסוכן של FORMULA.'],
    ['ירוק בהיר — יותר מביקור אחד בשבוע (שורה לכל יום)', C.green],
    ['כתום — היום החדש; מה שרשום בפריוריטי — בהערה של התא', C.orange],
  ], iRows, r => ({ id: r.c.id, agent: r.c.agent, day: r.day, name: r.c.name }));
  return wb.xlsx.writeBuffer();
}

function buildHtml(fRows, iRows, dateStr, agentNames) {
  const stat = new Map(); // агент -> {days, orders, ice}
  const s = a => { if (!stat.has(a)) stat.set(a, { days: new Set(), orders: new Set(), ice: new Set() }); return stat.get(a); };
  for (const r of fRows) { if (r.dayChanged) s(r.c.agent).days.add(r.c.id); if (r.orderChanged) s(r.c.agent).orders.add(r.c.id); }
  for (const r of iRows) s(r.c.agent).ice.add(r.c.id);
  const agents = [...stat.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  const sum = k => agents.reduce((n, [, v]) => n + v[k].size, 0);
  const th = 'style="background:#1f4e79;color:#fff;padding:6px 10px;text-align:center"';
  const td = 'style="padding:5px 10px;border-bottom:1px solid #e5e7eb;text-align:center"';
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0"><div dir="rtl" style="font-family:Arial,sans-serif;color:#111;max-width:700px;margin:0 auto;padding:16px;box-sizing:border-box">
<h2 style="margin:0 0 8px">שינויים שבוצעו ע"י סוכנים באפליקציה — ${dateStr}</h2>
<p style="margin:0 0 6px">שלום יוליה,</p>
<p style="margin:0 0 12px">מצורפים ימי וסדר הביקורים ב-<bdi>FORMULA</bdi> וב-<bdi>ICE</bdi> משפחתי כפי שהם באפליקציה, להזנה בפריוריטי. דוח שבועי אוטומטי.</p>
<p style="margin:0 0 12px;font-size:13px;color:#555">לשונית <bdi>FORMULA</bdi> — כל הלקוחות (${new Set(fRows.map(r => r.c.id)).size}), השינויים בכתום · לשונית <bdi>ICE</bdi> משפחתי — רק שינויי יום (${new Set(iRows.map(r => r.c.id)).size} לקוחות)</p>
${agents.length ? `<table style="border-collapse:collapse;font-size:13px">
<tr><th ${th} rowspan="2">סוכן</th><th ${th} rowspan="2">מס'</th><th ${th} colspan="2"><bdi>FORMULA</bdi></th><th ${th}><bdi>ICE</bdi> משפחתי</th></tr>
<tr><th ${th}>שינוי יום</th><th ${th}>שינוי סדר</th><th ${th}>שינוי יום</th></tr>
${agents.map(([a, v]) => `<tr><td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${esc(agentNames.get(a) || '')}</td><td ${td}><bdi>${a}</bdi></td><td ${td}>${v.days.size || ''}</td><td ${td}>${v.orders.size || ''}</td><td ${td}>${v.ice.size || ''}</td></tr>`).join('\n')}
<tr><td ${td} colspan="2"><b>סה"כ</b></td><td ${td}><b>${sum('days')}</b></td><td ${td}><b>${sum('orders')}</b></td><td ${td}><b>${sum('ice')}</b></td></tr>
</table>` : '<p>אין שינויים לעומת פריוריטי.</p>'}
<p style="color:#777;font-size:12px;margin-top:24px">מספרי לקוחות — מספר הלקוחות שהשתנו. הערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.</p>
</div></body></html>`;
}

async function main() {
  const overrides = JSON.parse(fs.readFileSync(path.join(LIVE_DATA, 'route-overrides.json'), 'utf8'));
  const { formula, ice } = await fetchPbi();
  const fRows = buildFormulaRows(formula, overrides);
  const iRows = buildIceRows(ice, overrides);
  console.log(`FORMULA: ${formula.size} клиентов, ${fRows.length} строк, день≠Priority ${fRows.filter(r => r.dayChanged).length}, порядок≠Priority ${fRows.filter(r => r.orderChanged).length}; ICE: ${iRows.length} строк`);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const dateStr = today.split('-').reverse().join('.');
  const xlsx = Buffer.from(await buildXlsx(fRows, iRows, dateStr));
  const html = buildHtml(fRows, iRows, dateStr, new Map([...formula.values()].map(c => [c.agent, c.agentName])));
  const filename = `route-changes-${today}.xlsx`;
  if (DRY_RUN) {
    const dir = path.join(LIVE_DATA, 'route-changes-preview');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), xlsx);
    fs.writeFileSync(path.join(dir, `route-changes-${today}.html`), html);
    console.log(`--dry-run — письмо не отправлено, превью в ${dir}`);
    return;
  }

  const list = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
  let to = list(process.env.ROUTE_CHANGES_TO), cc = list(process.env.ROUTE_CHANGES_CC);
  // иврит + русский (пользователь 06.10): что внести в Priority, кем исправлено
  let subject = `לעדכון בפריוריטי: ימי ביקור וסדר הגעה שתוקנו ע"י סוכנים ומנהלים | Внести в Priority: дни и порядок визитов, исправленные агентами и менеджерами — ${dateStr}`;
  const override = (process.env.ROUTE_CHANGES_OVERRIDE || '').trim();
  if (override) { subject = `[לבדיקה → ${[...to, ...cc].join(', ')}] ${subject}`; to = [override]; cc = []; }
  if (!to.length) throw new Error('ROUTE_CHANGES_TO пуст');
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const res = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: `AI Analytics Assistant <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to, ...(cc.length ? { cc } : {}), subject, html,
    attachments: [{ filename, content: xlsx.toString('base64') }],
  });
  if (res.error) throw new Error(JSON.stringify(res.error));
  console.log(`OK -> ${to.join(',')}${cc.length ? ' cc ' + cc.join(',') : ''}`);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
