// client-changes-alert.js — ежедневный алярм менеджерам (10:00 Израиль, после прогрева кэша
// в 06:00): что поменялось в клиентской базе с прошлого снимка.
//   новый клиент / стал неактивным / вернулся в актив / смена агента / смена дня визита
// Источники — те же, что у кэша Formula Road (index.js _loadPBICacheAttempt):
//   FORMULA: 'משטח' (+ дни из 'משטח עם כפולות')
//   ICE משפחתי: 'MISHPAHTI ICE MISHTAH' — агент FORMULA = доп. агент (מס.סוכן נוסף), день = פרמטר 18
//   ICE BDD: основной агент — из дискового кэша BDD (server/data/bdd-cache.json, bdd.js
//            loadBddCache пишет его после прогрева 06:00) — без лишних DAX-запросов.
// 'משטח' в PBI содержит только סטטוס=פעיל (проверено 05.10: 2147 строк, все פעיל), удаления
// клиентов в Priority нет (пользователь 05.10) — поэтому "пропал из таблицы" = "стал неактивным".
// "Вернулся в актив" отличаем от "новый" по everSeen — все id, когда-либо попадавшие в снимок.
// Гео-изменения сюда сознательно не входят (решение пользователя 05.10).
//
// Снимки — в LIVE_DATA_DIR/client-snapshots (клон /root/alerts-run сбрасывается каждый запуск).
// Сравнение — с последним снимком ДО сегодняшнего: пропуск дней не теряет изменений, повторный
// запуск в тот же день даёт тот же результат.
//
// Адресаты (env из run-alert.sh):
//   FORMULA + ICE משפחתי: CLIENT_CHANGES_MANAGERS ("ALEXEY=a@x;SADRAN+=b@x") — менеджеру команды его группа
//     (ICE — по группе доп. агента в FORMULA); CLIENT_CHANGES_ALL — всё; каждому агенту — только строки,
//     где он в «סוכן» или в «היה/עכשיו» (email из "EMAIL + PASSWORD.xlsx" по коду агента).
//   ICE BDD — отдельными письмами: CLIENT_CHANGES_BDD_MANAGERS ("TIMUR=a@x;MATVEY,ALMOG=b@x" — каждому
//     его группы), CLIENT_CHANGES_BDD_ALL — весь BDD. Агентам BDD не шлём (нет email).
//   CLIENT_CHANGES_OVERRIDE=<email> — режим проверки: все письма уходят на этот адрес, в теме — кому шли бы.
// --dry-run: письма не шлются, превью html пишутся рядом со снимком.
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const ExcelJS = require('exceljs');
const { executeDax } = require('./powerbi');

const DRY_RUN = process.argv.includes('--dry-run');
const LIVE_DATA = process.env.LIVE_DATA_DIR || path.join(__dirname, 'data');
const SNAP_DIR = path.join(LIVE_DATA, 'client-snapshots');
const BDD_CACHE = path.join(LIVE_DATA, 'bdd-cache.json');
const AGENT_ROSTER = path.join(LIVE_DATA, '..', '..', 'FORMULA ROADS -PASSWORDS', 'EMAIL + PASSWORD.xlsx');
const KEEP_SNAPSHOTS = 30;
const SOURCES = [['formula', 'FORMULA'], ['ice', 'ICE משפחתי'], ['bdd', 'ICE BDD']];

// Та же функция, что в obligo-alert.js / других серверных скриптах, читающих иврит из PBI.
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

// Копия DAY_HE_TO_NUM из index.js:28 (+ שבת) — только для сортировки дней в строке.
const DAY_ORDER = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ש': 7, 'ראשון': 1, 'שני': 2, 'שלישי': 3, 'רביעי': 4, 'חמישי': 5, 'שישי': 6, 'שבת': 7 };
const normDays = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => (DAY_ORDER[a] || 9) - (DAY_ORDER[b] || 9));

async function fetchCurrent() {
  const [clientRows, schedRows] = await Promise.all([
    executeDax(`
EVALUATE
SELECTCOLUMNS('משטח',
  "custId",    'משטח'[מס. לקוח],
  "custName",  'משטח'[שם לקוח],
  "city",      'משטח'[עיר],
  "agentCode", 'משטח'[סוכן],
  "agentName", 'משטח'[שם סוכן],
  "manager",   'משטח'[קבוצה]
)`),
    executeDax(`
EVALUATE
SELECTCOLUMNS('משטח עם כפולות',
  "custId", 'משטח עם כפולות'[מס.לקוח],
  "day",    'משטח עם כפולות'[יום]
)`),
  ]);

  const days = new Map();
  for (const r of schedRows) {
    const id = String(r['[custId]'] || '');
    if (!id) continue;
    if (!days.has(id)) days.set(id, []);
    days.get(id).push(fixBiDi(r['[day]'] || ''));
  }

  const formula = {};
  const agentNames = {};
  for (const r of clientRows) {
    const id = String(r['[custId]'] || '');
    if (!id) continue;
    const agent = String(r['[agentCode]'] || '');
    const agentName = fixBiDi(r['[agentName]'] || '');
    if (agent && agentName) agentNames[agent] = agentName;
    formula[id] = {
      name: fixBiDi(r['[custName]'] || ''),
      city: fixBiDi(r['[city]'] || ''),
      agent, agentName,
      manager: r['[manager]'] || '',
      days: normDays(days.get(id) || []),
    };
  }

  const ice = {};
  if (process.env.POWERBI_ICE_DATASET_ID) {
    const iceRows = await executeDax(`
EVALUATE
SELECTCOLUMNS(
  FILTER('MISHPAHTI ICE MISHTAH', LEN('MISHPAHTI ICE MISHTAH'[שם סוכן נוסף]) > 0),
  "custId",    'MISHPAHTI ICE MISHTAH'[מס. לקוח],
  "custName",  'MISHPAHTI ICE MISHTAH'[שם לקוח],
  "city",      'MISHPAHTI ICE MISHTAH'[עיר],
  "agentCode", 'MISHPAHTI ICE MISHTAH'[מס.סוכן נוסף],
  "agentName", 'MISHPAHTI ICE MISHTAH'[שם סוכן נוסף],
  "dayLetter", 'MISHPAHTI ICE MISHTAH'[פרמטר 18]
)`, process.env.POWERBI_ICE_DATASET_ID);
    for (const r of iceRows) {
      const id = String(r['[custId]'] || '');
      const agent = String(r['[agentCode]'] || '');
      if (!id || !agent || agent === 'null') continue;
      const prev = ice[id];
      const day = String(r['[dayLetter]'] || '').trim();
      // строка на клиента×день — склеиваем дни, как кэш склеивает 'משטח עם כפולות'
      if (prev) { prev.days = normDays([...prev.days, day]); continue; }
      ice[id] = {
        name: fixBiDi(r['[custName]'] || ''),
        city: fixBiDi(r['[city]'] || ''),
        agent,
        agentName: agentNames[agent] || fixBiDi(r['[agentName]'] || ''),
        manager: formulaManagerOf(formula, agent),
        days: normDays([day]),
      };
    }
  }
  return { formula, ice, bdd: readBddCache() };
}

// null — кэша за сегодня нет (сервер не прогрелся) — тогда BDD-часть снимка переносится с прошлого раза.
function readBddCache() {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(BDD_CACHE, 'utf8')); } catch { return null; }
  if (obj.date !== new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })) return null;
  const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה'];
  const bdd = {};
  for (const [id, c] of obj.clientById) {
    bdd[id] = { name: c.custName, city: c.city, agent: c.agentCode, agentName: c.agentName, manager: c.manager, days: [] };
  }
  for (const [, rows] of obj.byAgent) {
    for (const r of rows) if (r.dayNum && bdd[r.custId]) bdd[r.custId].days.push(LETTERS[r.dayNum - 1]);
  }
  for (const c of Object.values(bdd)) c.days = normDays(c.days);
  return bdd;
}

// У ICE-таблицы нет קבוצה — берём группу того же агента из FORMULA (нужно для будущих фильтров по менеджеру).
function formulaManagerOf(formula, agent) {
  for (const c of Object.values(formula)) if (c.agent === agent && c.manager) return c.manager;
  return '';
}

function diff(prev, cur, everSeen) {
  const out = [];
  for (const [src, hevra] of SOURCES) {
    // источник впервые в снимке (напр. BDD добавлен 05.10) — это baseline, а не «все новые»
    if (!prev[src]) continue;
    const p = prev[src], c = cur[src];
    for (const [id, now] of Object.entries(c)) {
      const was = p[id];
      if (!was) {
        out.push({ type: everSeen.has(`${src}:${id}`) ? 'reactivated' : 'new', hevra, id, ...now });
        continue;
      }
      if (was.agent !== now.agent) {
        out.push({ type: 'agent', hevra, id, ...now, fromAgent: was.agent, fromManager: was.manager, from: was.agentName || was.agent, to: now.agentName || now.agent });
      }
      if (was.days.join(',') !== now.days.join(',')) {
        out.push({ type: 'day', hevra, id, ...now, from: was.days.join(', ') || '—', to: now.days.join(', ') || '—' });
      }
    }
    for (const [id, was] of Object.entries(p)) {
      if (!c[id]) out.push({ type: 'inactive', hevra, id, ...was });
    }
  }
  return out;
}

// «Новый» vs «вернулся в актив» — по дате заведения в Priority (CUSTOMERS.CREATEDDATE), а не по everSeen:
// история снимков короткая (с 05.10), и давний клиент, которого вернули в פעיל, выглядел «новым»
// (06.10: 1168510/1168516 заведены в 2024, 75–97 счетов). Заведён в день прошлого снимка или позже — новый.
// Если Priority недоступен — остаётся классификация по everSeen.
const PRIORITY_DB = { formula: 'form', ice: 'icecrea', bdd: 'icecrea' };
const SRC_BY_HEVRA = Object.fromEntries(SOURCES.map(([s, he]) => [he, s]));
async function classifyByCreatedDate(changes, prevDate) {
  const rows = changes.filter(c => c.type === 'new' || c.type === 'reactivated');
  if (!rows.length) return;
  const prevMin = (Date.UTC(...prevDate.split('-').map((v, i) => +v - (i === 1 ? 1 : 0))) - Date.UTC(1988, 0, 1)) / 60000;
  try {
    const { query } = require('./db');
    for (const db of new Set(rows.map(c => PRIORITY_DB[SRC_BY_HEVRA[c.hevra]]))) {
      const mine = rows.filter(c => PRIORITY_DB[SRC_BY_HEVRA[c.hevra]] === db);
      const ids = [...new Set(mine.map(c => c.id))].filter(id => /^\d+$/.test(id)); // в IN — только цифры
      if (!ids.length) continue;
      const { recordset } = await query(`SELECT CUSTNAME, CREATEDDATE FROM ${db}.dbo.CUSTOMERS WHERE CUSTNAME IN (${ids.map(i => `'${i}'`).join(',')})`);
      const created = new Map(recordset.map(r => [String(r.CUSTNAME), r.CREATEDDATE]));
      for (const c of mine) if (created.get(c.id)) c.type = created.get(c.id) >= prevMin ? 'new' : 'reactivated';
    }
  } catch (e) {
    console.error(`[Priority] CREATEDDATE недоступен — новый/вернулся по истории снимков: ${e.message}`);
  }
}

const TYPES = [
  { key: 'new',         he: 'לקוחות חדשים',           color: '1E8E3E' },
  { key: 'inactive',    he: 'הפכו ללא פעילים',        color: 'C5221F' },
  { key: 'reactivated', he: 'חזרו לפעילות',           color: '1A73E8' },
  { key: 'agent',       he: 'העברה לסוכן אחר',        color: 'E37400', tint: 'FFF3E0' },
  { key: 'day',         he: 'שינוי יום ביקור',         color: '8430CE', tint: 'F3E8FD' },
];
// Колонки по типу — одни и те же для письма и Excel. Смена агента: קודם (до даты отчёта) / נוכחי
// вместо колонки סוכן; смена дня — дни как в Priority (FORMULA: משטח עם כפולות, ICE: פרמטר 18).
// prev — приглушённо серым, cur — жирным в цвете раздела на бледной подложке (пользователь 05.10).
const BASE_COLS = [
  { header: "מס' לקוח", key: 'id', width: 12 },
  { header: 'שם לקוח', key: 'name', width: 34 },
  { header: 'עיר', key: 'city', width: 16 },
  { header: 'חברה', key: 'hevra', width: 12 },
];
const AGENT_COL = { header: 'סוכן', key: 'agentName', width: 20 };
const GROUP_COL = { header: 'קבוצה', key: 'manager', width: 12 };
function columnsFor(type, dateStr) {
  const until = dateStr.slice(0, 5); // день запуска (плавает), "05.10" — без скобок: в RTL они переворачиваются
  if (type === 'agent') return [...BASE_COLS, { header: `סוכן קודם · עד ${until}`, key: 'from', width: 22, prev: true }, { header: 'סוכן נוכחי', key: 'to', width: 20, cur: true }, GROUP_COL];
  if (type === 'day') return [...BASE_COLS, AGENT_COL, { header: `יום קודם בפריוריטי · עד ${until}`, key: 'from', width: 24, prev: true }, { header: 'יום נוכחי בפריוריטי', key: 'to', width: 20, cur: true }, GROUP_COL];
  return [...BASE_COLS, AGENT_COL, GROUP_COL];
}
const cellValue = (r, key) => key === 'agentName' ? (r.agentName || r.agent) : r[key];
// Строки — по группам (קבוצה), внутри по имени: общий отчёт без фильтра читается по группам (пользователь 05.10).
const byGroup = rows => [...rows].sort((a, b) => String(a.manager || '').localeCompare(String(b.manager || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'he'));
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function buildHtml(changes, dateStr, greeting = '', title = 'שינויים בלקוחות', sources = 'FORMULA · ICE משפחתי', intro = null) {
  const counts = TYPES.map(t => ({ ...t, n: changes.filter(c => c.type === t.key).length })).filter(t => t.n);
  const th = 'style="background:#1f2a44;color:#fff;padding:6px 8px;text-align:right;font-weight:600"';
  const td = 'style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right"';
  const sections = counts.map(t => {
    const cols = columnsFor(t.key, dateStr);
    const rows = byGroup(changes.filter(c => c.type === t.key));
    // подзаголовок группы — только если в разделе больше одной группы (общий отчёт)
    const multi = new Set(rows.map(r => r.manager || '')).size > 1;
    const groupHead = (r, i) => multi && (i === 0 || rows[i - 1].manager !== r.manager)
      ? `<tr><td colspan="${cols.length}" style="padding:8px 8px 4px;background:#f3f4f6;font-weight:700;text-align:right">קבוצה: <bdi>${esc(r.manager || '—')}</bdi> (${rows.filter(x => x.manager === r.manager).length})</td></tr>\n`
      : '';
    const cell = (c, r) => {
      const v = esc(cellValue(r, c.key));
      if (c.prev) return `<td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#8a8f98">${v}</td>`;
      if (c.cur) return `<td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right;background:#${t.tint};color:#${t.color};font-weight:700">${v}</td>`;
      // имя клиента — крупнее (пользователь 06.10); min-width не ставить — на телефоне 390px таблица вылезает
      if (c.key === 'name') return `<td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:15px;font-weight:600">${v}</td>`;
      return `<td ${td}>${v}</td>`;
    };
    return `<h3 style="color:#${t.color};margin:22px 0 6px">${t.he} (${t.n})</h3>
<table style="border-collapse:collapse;width:100%;font-size:13px">
<tr>${cols.map(c => `<th ${th}>${c.header}</th>`).join('')}</tr>
${rows.map((r, i) => groupHead(r, i) + `<tr>${cols.map(c => cell(c, r)).join('')}</tr>`).join('\n')}
</table>`;
  }).join('\n');
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0"><div dir="rtl" style="font-family:Arial,sans-serif;color:#111;max-width:900px;margin:0 auto;padding:16px;box-sizing:border-box">
<h2 style="margin:0 0 4px">${esc(title)} — ${dateStr}</h2>
${greeting ? `<p style="margin:0 0 6px">${esc(greeting)}</p>` : ''}
${intro ? `<div style="background:#f5f7fb;border-right:4px solid #1f2a44;padding:8px 12px;margin:6px 0 10px;font-size:13px;line-height:1.5">
<p dir="rtl" style="margin:0 0 6px;text-align:right">${esc(intro.he)}</p>
<p dir="ltr" style="margin:0;text-align:left;color:#444">${esc(intro.ru)}</p></div>` : ''}
<div style="color:#555;font-size:13px;margin-bottom:10px">${sources.split(' · ').map(s => `<bdi>${esc(s)}</bdi>`).join(' · ')}</div>
<table cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 0"><tr>${counts.map(t => `<td style="background:#${t.color};color:#fff;font-size:13px;padding:4px 10px;border-radius:12px;white-space:nowrap">${t.he}: ${t.n}</td><td style="width:8px">&nbsp;</td>`).join('')}</tr></table>
${sections}
<p style="color:#777;font-size:12px;margin-top:24px">הערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.</p>
</div></body></html>`;
}

async function buildXlsx(changes, dateStr) {
  const wb = new ExcelJS.Workbook();
  for (const t of TYPES) {
    const rows = byGroup(changes.filter(c => c.type === t.key));
    if (!rows.length) continue;
    const ws = wb.addWorksheet(t.he.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    const cols = columnsFor(t.key, dateStr);
    ws.columns = cols.map(({ header, key, width }) => ({ header, key, width }));
    rows.forEach(r => {
      const row = ws.addRow(Object.fromEntries(cols.map(c => [c.key, cellValue(r, c.key)])));
      cols.forEach((c, i) => {
        if (c.prev) row.getCell(i + 1).font = { color: { argb: 'FF8A8F98' } };
        if (c.cur) {
          row.getCell(i + 1).font = { bold: true, color: { argb: 'FF' + t.color } };
          row.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + t.tint } };
        }
      });
    });
    // красим только ячейки шапки: fill на всю строку тянется до последней колонки листа
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + t.color } };
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }
  return wb.xlsx.writeBuffer();
}

// Код агента -> email. Та же логика, что loadAgentEmailRoster() в index.js:978 (менеджерские
// строки с общим кодом 1999 пропускаем — у менеджеров своё письмо).
async function loadAgentEmails() {
  const map = {};
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(AGENT_ROSTER);
    wb.worksheets[0].eachRow((row, i) => {
      if (i === 1) return;
      const v = row.values;
      const code = String(v[1] ?? '').trim();
      const email = String(v[5] ?? '').trim();
      const isManager = String(v[6] ?? '').trim().toUpperCase() === 'YES';
      if (code && email && !isManager) map[code] = email;
    });
  } catch (e) { console.error('[agent-roster]', e.message); }
  return map;
}

// Агент -> его изменения. Смена агента касается обоих: и старого, и нового.
function changesByAgent(changes) {
  const by = new Map();
  const add = (code, c) => { if (!code) return; if (!by.has(code)) by.set(code, []); by.get(code).push(c); };
  for (const c of changes) {
    add(c.agent, c);
    if (c.type === 'agent' && c.fromAgent !== c.agent) add(c.fromAgent, c);
  }
  return by;
}

async function main() {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
  const snapFiles = fs.readdirSync(SNAP_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const prevFile = snapFiles.filter(f => f < `${today}.json`).pop();
  const prev = prevFile ? JSON.parse(fs.readFileSync(path.join(SNAP_DIR, prevFile), 'utf8')) : null;

  const cur = await fetchCurrent();
  if (!cur.bdd) {
    // сервер не записал BDD-кэш за сегодня — BDD не сравниваем, переносим прошлый, чтобы не потерять базу
    console.error(`[BDD] нет кэша за ${today} в ${BDD_CACHE} — BDD-часть пропущена`);
    if (prev?.bdd) cur.bdd = prev.bdd; else delete cur.bdd;
  }
  console.log(`Сейчас: ${SOURCES.map(([s, he]) => `${he} ${Object.keys(cur[s] || {}).length}`).join(', ')}; прошлый снимок: ${prevFile || 'нет'}`);

  const everSeen = new Set(prev?.everSeen || []);
  const changes = prev ? diff(prev, cur, everSeen) : [];
  if (prev) await classifyByCreatedDate(changes, prevFile.slice(0, 10));
  for (const [src] of SOURCES) for (const id of Object.keys(cur[src] || {})) everSeen.add(`${src}:${id}`);

  fs.writeFileSync(path.join(SNAP_DIR, `${today}.json`), JSON.stringify({ ...cur, everSeen: [...everSeen] }));
  for (const f of snapFiles.filter(f => f !== `${today}.json`).slice(0, -KEEP_SNAPSHOTS)) fs.unlinkSync(path.join(SNAP_DIR, f));

  if (!prev) { console.log('Первый запуск — сохранён базовый снимок, письма нет.'); return; }
  // Всплывающее окно менеджерам в Formula Road (GET /api/manager/client-changes фильтрует по группе).
  // Пишется и при 0 изменений — чтобы вчерашний список не висел.
  fs.writeFileSync(path.join(LIVE_DATA, 'client-changes-latest.json'), JSON.stringify({ date: today, changes }));
  for (const t of TYPES) console.log(`  ${t.key}: ${changes.filter(c => c.type === t.key).length}`);
  if (!changes.length) { console.log('Изменений нет — письма не отправляются.'); return; }

  const dateStr = today.split('-').reverse().join('.');
  // пояснение в начале каждого письма, иврит + русский (пользователь 06.10): что это и с чем сравниваем
  const prevDate = prevFile.slice(0, 10), prevStr = prevDate.split('-').reverse().join('.');
  const wasYesterday = prevDate === new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const intro = {
    he: `בדוח: שינויים בכרטיסי הלקוחות בפריוריטי ${wasYesterday ? `בהשוואה לאתמול (${prevStr})` : `בהשוואה לדוח הקודם (${prevStr})`} — לקוחות חדשים, לקוחות שהפכו ללא פעילים, לקוחות שחזרו לפעילות, העברות בין סוכנים ושינויי יום ביקור. הרשימה המלאה בקובץ Excel המצורף.`,
    ru: `В письме: изменения в карточках клиентов в Priority ${wasYesterday ? `по сравнению со вчерашним днём (${prevStr})` : `по сравнению с прошлым отчётом (${prevStr})`} — новые клиенты, ставшие неактивными, вернувшиеся в актив, переводы между агентами и смена дня визита. Полный список — в приложенном Excel.`,
  };
  const override = (process.env.CLIENT_CHANGES_OVERRIDE || '').trim();
  const list = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
  const mails = [];
  // в режиме проверки всё, кроме адресов Дана, уходит на override; тема помечена, кому шло бы
  const addMail = (tag, to, cc, subject, rows, opts = {}) => {
    if (!rows.length || !to.length) return;
    mails.push(override
      ? { tag, to: [override], cc: [], subject: `[לבדיקה → ${[...to, ...cc].join(', ')}] ${subject}`, rows, intro, ...opts }
      : { tag, to, cc, subject, rows, intro, ...opts });
  };

  // Менеджеру группы — только его группа (при смене агента — и группа «היה»).
  // Формат spec: "ALEXEY=a@x;MATVEY,ALMOG=b@x" (CLIENT_CHANGES_MANAGERS / CLIENT_CHANGES_BDD_MANAGERS).
  const perGroup = (spec, rows, tag, subject, opts) => {
    for (const part of (spec || '').split(';').filter(Boolean)) {
      const [groups, email] = part.split('=').map(s => s.trim());
      const gs = new Set(groups.split(',').map(s => s.trim()));
      const mine = rows.filter(c => gs.has(c.manager) || (c.type === 'agent' && gs.has(c.fromManager)));
      addMail(`${tag} ${groups}`, [email], [], `${subject}: ${mine.length}`, mine, opts);
    }
  };

  // FORMULA + ICE משפחתי: менеджеру команды — его группа, общий список (CLIENT_CHANGES_ALL) — всё,
  // агенту — строки, где он в «סוכן» или в «היה/עכשיו»
  const main = changes.filter(c => c.hevra !== 'ICE BDD');
  perGroup(process.env.CLIENT_CHANGES_MANAGERS, main, 'manager', `שינויים בלקוחות בפריוריטי ${dateStr}`);
  addMail('all', list(process.env.CLIENT_CHANGES_ALL), [], `שינויים בלקוחות בפריוריטי ${dateStr}: ${main.length}`, main);

  const emails = await loadAgentEmails();
  const noEmail = [];
  for (const [code, rows] of changesByAgent(main)) {
    const name = rows.find(r => r.agent === code)?.agentName || rows.find(r => r.fromAgent === code)?.from || code;
    if (!emails[code]) { noEmail.push(`${name} (${code})`); continue; }
    addMail(`agent ${code} ${name}`, [emails[code]], [], `שינויים בלקוחות שלך בפריוריטי ${dateStr}: ${rows.length}`, rows,
      { greeting: `שלום ${name}, אלה השינויים בלקוחות שלך מאז הדוח הקודם.` });
  }
  if (noEmail.length) console.log(`Агенты без email в ростере (письмо не ушло): ${noEmail.join(', ')}`);

  // ICE BDD — отдельно: менеджеру ICE его группы, общий список (CLIENT_CHANGES_BDD_ALL) — весь BDD.
  // Агентам BDD не шлём — у них нет email.
  const bdd = changes.filter(c => c.hevra === 'ICE BDD');
  const bddOpts = { title: 'ICE BDD — שינויים בלקוחות', sources: 'ICE BDD' };
  perGroup(process.env.CLIENT_CHANGES_BDD_MANAGERS, bdd, 'bdd', `ICE BDD — שינויים בלקוחות בפריוריטי ${dateStr}`, bddOpts);
  addMail('bdd all', list(process.env.CLIENT_CHANGES_BDD_ALL), [], `ICE BDD — שינויים בלקוחות בפריוריטי ${dateStr}: ${bdd.length}`, bdd, bddOpts);

  if (DRY_RUN) {
    for (const [i, m] of mails.entries()) {
      fs.writeFileSync(path.join(SNAP_DIR, `preview-${today}-${i}.html`), buildHtml(m.rows, dateStr, m.greeting, m.title, m.sources, m.intro));
      console.log(`  [dry ${i}] ${m.tag}: ${m.rows.length} строк -> ${m.to.join(',')} | ${m.subject}`);
    }
    console.log(`--dry-run — письма не отправлены, превью в ${SNAP_DIR}`);
    return;
  }

  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const resend = new Resend(process.env.RESEND_API_KEY);
  let failed = 0;
  for (const m of mails) {
    const xlsx = Buffer.from(await buildXlsx(m.rows, dateStr));
    const res = await resend.emails.send({
      from: `AI Analytics Assistant <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
      to: m.to,
      ...(m.cc.length ? { cc: m.cc } : {}),
      subject: m.subject,
      html: buildHtml(m.rows, dateStr, m.greeting, m.title, m.sources, m.intro),
      attachments: [{ filename: `client-changes-${today}.xlsx`, content: xlsx.toString('base64') }],
    });
    if (res.error) { failed++; console.error(`  FAIL ${m.tag}:`, JSON.stringify(res.error)); }
    else console.log(`  OK ${m.tag}: ${m.rows.length} -> ${m.to.join(',')}`);
    await new Promise(r => setTimeout(r, 600)); // Resend: 2 req/s
  }
  if (failed) throw new Error(`${failed} из ${mails.length} писем не ушли`);
}

// exit явно: пул mssql (db.js) держит event loop
main().then(() => process.exit(0), e => { console.error('ERR:', e.message); process.exit(1); });
