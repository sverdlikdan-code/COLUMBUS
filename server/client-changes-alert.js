// client-changes-alert.js — ежедневный алярм менеджерам (09:30 Израиль, после прогрева кэша
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
// Адресаты: менеджерам (CLIENT_CHANGES_RECIPIENTS) — всё целиком; каждому агенту — только его
// клиенты (при смене агента — и старому, и новому), email из "EMAIL + PASSWORD.xlsx" по коду агента.
// CLIENT_CHANGES_AGENT_OVERRIDE=<email> — все агентские письма уходят на этот адрес (режим
// проверки до одобрения пользователем); пусто — реальным агентам.
// --dry-run: письма не шлются, превью html/xlsx пишутся рядом со снимком.
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
        out.push({ type: 'agent', hevra, id, ...now, fromAgent: was.agent, from: was.agentName || was.agent, to: now.agentName || now.agent });
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

const TYPES = [
  { key: 'new',         he: 'לקוחות חדשים',           color: '1E8E3E' },
  { key: 'inactive',    he: 'הפכו ללא פעילים',        color: 'C5221F' },
  { key: 'reactivated', he: 'חזרו לפעילות',           color: '1A73E8' },
  { key: 'agent',       he: 'העברה לסוכן אחר',        color: 'E37400' },
  { key: 'day',         he: 'שינוי יום ביקור',         color: '8430CE' },
];
const hasFromTo = t => t === 'agent' || t === 'day';
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function buildHtml(changes, dateStr, greeting = '') {
  const counts = TYPES.map(t => ({ ...t, n: changes.filter(c => c.type === t.key).length })).filter(t => t.n);
  const th = 'style="background:#1f2a44;color:#fff;padding:6px 8px;text-align:right;font-weight:600"';
  const td = 'style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right"';
  const sections = counts.map(t => {
    const rows = changes.filter(c => c.type === t.key);
    return `<h3 style="color:#${t.color};margin:22px 0 6px">${t.he} (${t.n})</h3>
<table style="border-collapse:collapse;width:100%;font-size:13px">
<tr><th ${th}>מס' לקוח</th><th ${th}>שם לקוח</th><th ${th}>עיר</th><th ${th}>חברה</th><th ${th}>סוכן</th>${hasFromTo(t.key) ? `<th ${th}>היה</th><th ${th}>עכשיו</th>` : ''}</tr>
${rows.map(c => `<tr><td ${td}>${esc(c.id)}</td><td ${td}>${esc(c.name)}</td><td ${td}>${esc(c.city)}</td><td ${td}>${c.hevra}</td><td ${td}>${esc(c.agentName || c.agent)}</td>${hasFromTo(t.key) ? `<td ${td}>${esc(c.from)}</td><td ${td}><b>${esc(c.to)}</b></td>` : ''}</tr>`).join('\n')}
</table>`;
  }).join('\n');
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0"><div dir="rtl" style="font-family:Arial,sans-serif;color:#111;max-width:900px;margin:0 auto;padding:16px;box-sizing:border-box">
<h2 style="margin:0 0 4px">שינויים בלקוחות — ${dateStr}</h2>
${greeting ? `<p style="margin:0 0 6px">${esc(greeting)}</p>` : ''}
<div style="color:#555;font-size:13px;margin-bottom:10px">לעומת הדוח הקודם · <bdi>FORMULA</bdi> · <bdi>ICE משפחתי</bdi> · <bdi>ICE BDD</bdi> · רשימה מלאה בקובץ המצורף</div>
<div>${counts.map(t => `<span style="display:inline-block;margin:0 0 6px 8px;padding:4px 10px;border-radius:12px;background:#${t.color};color:#fff;font-size:13px">${t.he}: ${t.n}</span>`).join('')}</div>
${sections}
<p style="color:#777;font-size:12px;margin-top:24px">הערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.</p>
</div></body></html>`;
}

async function buildXlsx(changes) {
  const wb = new ExcelJS.Workbook();
  for (const t of TYPES) {
    const rows = changes.filter(c => c.type === t.key);
    if (!rows.length) continue;
    const ws = wb.addWorksheet(t.he.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: "מס' לקוח", key: 'id', width: 12 },
      { header: 'שם לקוח', key: 'name', width: 34 },
      { header: 'עיר', key: 'city', width: 16 },
      { header: 'חברה', key: 'hevra', width: 10 },
      { header: 'סוכן', key: 'agentName', width: 20 },
      { header: 'קבוצה', key: 'manager', width: 14 },
      ...(hasFromTo(t.key) ? [{ header: 'היה', key: 'from', width: 20 }, { header: 'עכשיו', key: 'to', width: 20 }] : []),
    ];
    rows.forEach(r => ws.addRow({ ...r, agentName: r.agentName || r.agent }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + t.color } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
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
  for (const [src] of SOURCES) for (const id of Object.keys(cur[src] || {})) everSeen.add(`${src}:${id}`);

  fs.writeFileSync(path.join(SNAP_DIR, `${today}.json`), JSON.stringify({ ...cur, everSeen: [...everSeen] }));
  for (const f of snapFiles.filter(f => f !== `${today}.json`).slice(0, -KEEP_SNAPSHOTS)) fs.unlinkSync(path.join(SNAP_DIR, f));

  if (!prev) { console.log('Первый запуск — сохранён базовый снимок, письма нет.'); return; }
  for (const t of TYPES) console.log(`  ${t.key}: ${changes.filter(c => c.type === t.key).length}`);
  if (!changes.length) { console.log('Изменений нет — письма не отправляются.'); return; }

  const dateStr = today.split('-').reverse().join('.');
  const mails = [];

  // менеджерам — всё целиком
  // ponytail: один список на всех менеджеров; фильтры по группе — когда пользователь назовёт адресатов
  const managers = (process.env.CLIENT_CHANGES_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  mails.push({ tag: 'managers', to: managers, subject: `שינויים בלקוחות ${dateStr}: ${changes.length}`, rows: changes, greeting: '' });

  // агентам — только своё
  const emails = await loadAgentEmails();
  const override = (process.env.CLIENT_CHANGES_AGENT_OVERRIDE || '').trim();
  const noEmail = [];
  for (const [code, rows] of changesByAgent(changes)) {
    const name = rows.find(r => r.agent === code)?.agentName || (rows.find(r => r.fromAgent === code)?.from) || code;
    const email = emails[code];
    if (!email) { noEmail.push(`${name} (${code})`); continue; }
    mails.push({
      tag: `agent ${code} ${name} <${email}>`,
      to: [override || email],
      subject: `${override ? `[לבדיקה → ${name}] ` : ''}שינויים בלקוחות שלך ${dateStr}: ${rows.length}`,
      rows,
      greeting: `שלום ${name}, אלה השינויים בלקוחות שלך מאז הדוח הקודם.`,
    });
  }
  if (noEmail.length) console.log(`Агенты без email в ростере (письмо не ушло): ${noEmail.join(', ')}`);

  if (DRY_RUN) {
    const m = mails[0];
    fs.writeFileSync(path.join(SNAP_DIR, `preview-${today}.html`), buildHtml(m.rows, dateStr));
    fs.writeFileSync(path.join(SNAP_DIR, `preview-${today}.xlsx`), Buffer.from(await buildXlsx(m.rows)));
    if (mails[1]) fs.writeFileSync(path.join(SNAP_DIR, `preview-${today}-agent.html`), buildHtml(mails[1].rows, dateStr, mails[1].greeting));
    for (const m of mails) console.log(`  [dry] ${m.tag}: ${m.rows.length} строк -> ${m.to.join(',') || '(нет адресатов)'}`);
    console.log(`--dry-run — письма не отправлены, превью в ${SNAP_DIR}`);
    return;
  }

  if (!managers.length) throw new Error('CLIENT_CHANGES_RECIPIENTS не задан');
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const resend = new Resend(process.env.RESEND_API_KEY);
  let failed = 0;
  for (const m of mails) {
    const xlsx = Buffer.from(await buildXlsx(m.rows));
    const res = await resend.emails.send({
      from: `AI Analytics Assistant <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
      to: m.to,
      subject: m.subject,
      html: buildHtml(m.rows, dateStr, m.greeting),
      attachments: [{ filename: `client-changes-${today}.xlsx`, content: xlsx.toString('base64') }],
    });
    if (res.error) { failed++; console.error(`  FAIL ${m.tag}:`, JSON.stringify(res.error)); }
    else console.log(`  OK ${m.tag}: ${m.rows.length} -> ${m.to.join(',')}`);
    await new Promise(r => setTimeout(r, 600)); // Resend: 2 req/s
  }
  if (failed) throw new Error(`${failed} из ${mails.length} писем не ушли`);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
