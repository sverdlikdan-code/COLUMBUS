// mekarer-daily.js — ежедневный Excel заказов מקרר для יוסי (Вс–Чт 16:00 Israel).
// Запускается cron-ом на VPS (не GitHub Actions: живые заказы только на VPS, docs/mekarer-orders.json
// в .gitignore). Cron 13:00 и 14:00 UTC, скрипт сам отсекает всё кроме 16:xx Israel — так
// переход летнее/зимнее время не сдвигает отправку.
// В файле все заказы, свежие сверху, + колонка "אישור יוסי" (выпадающий כן/לא).
// Письмо уходит только если с прошлой отправки появился новый заказ (state: server/mekarer-daily-state.json).
// Флаги: --dry-run (xlsx на диск, без письма), --force (без проверки времени и новых заказов).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Resend } = require('resend');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const ORDERS = path.join(__dirname, '..', 'docs', 'mekarer-orders.json');
const STATE = path.join(__dirname, 'mekarer-daily-state.json');
const TZ = 'Asia/Jerusalem';

// Часть старых заказов сохранена в визуальном порядке внутри LRO..PDF — развернуть обратно.
function fixBiDi(s) {
  if (!s || !s.startsWith('‭')) return s || '';
  return s.replace(/[‬‭]/g, '').split('').reverse().join('')
    .replace(/\d+/g, m => m.split('').reverse().join('')).trim();
}

// Israel wall-clock -> Date с теми же "часами" (Excel не знает про таймзоны).
function ilDate(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute));
}

function ilNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23',
    weekday: 'short', hour: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: p.weekday, hour: +p.hour };
}

const COLS = [
  ['אישור יוסי', 12], ['תאריך ושעת הגשה', 18], ["מס' לקוח", 11], ['שם לקוח', 42], ['עיר', 12],
  ['שם סוכן', 18], ['מנהל', 10], ['איש קשר', 14], ['טלפון', 13], ['מיקום', 9], ['פעולה', 10],
  ['דגם לספק', 38], ['דגם לאסוף', 38], ['שלות', 7], ['עגלה', 7], ['תאריך אספקה', 13],
  ['תקלה / הערה', 22], ["מס' הזמנה", 15],
];

function modelLabel(code, names) {
  return code ? (names[code] ? `${code} — ${names[code]}` : code) : '';
}

async function buildXlsx(orders) {
  const names = {};
  for (const o of orders) for (const m of o.mekarerim || []) for (const k of ['newModelName', 'returnModelName']) {
    const v = m[k] || '';
    if (v.includes(' — ') && !v.startsWith('—')) { const [c, n] = v.split(' — '); names[c.trim()] = n.trim(); }
  }
  const rows = [];
  for (const o of [...orders].sort((a, b) => b.id - a.id)) {
    for (const m of (o.mekarerim && o.mekarerim.length ? o.mekarerim : [{}])) {
      rows.push(['', ilDate(o.submittedAt), o.custId, fixBiDi(o.custName), o.city, o.agentName, o.manager,
        o.contactName, o.phone, o.location, m.action || '', modelLabel(m.newModel, names),
        modelLabel(m.returnModel, names), m.salot === '' || m.salot == null ? '' : Number(m.salot),
        String(m.agala) === 'true' ? 'כן' : 'לא', m.supplyDate ? new Date(m.supplyDate + 'T00:00:00Z') : '',
        m.fault || '', String(o.id)]);
    }
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('הזמנות מקררים', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.addTable({
    name: 'MekarerOrders', ref: 'A1', headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: COLS.map(([name]) => ({ name, filterButton: true })),
    rows,
  });
  COLS.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
  ws.getColumn(2).numFmt = 'dd/mm/yyyy hh:mm';
  ws.getColumn(16).numFmt = 'dd/mm/yyyy';
  const yellow = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  for (let r = 2; r <= rows.length + 1; r++) {
    const c = ws.getCell(r, 1);
    c.dataValidation = { type: 'list', allowBlank: true, formulae: ['"כן,לא"'], showErrorMessage: true,
      errorTitle: 'אישור יוסי', error: 'לבחור כן או לא' };
    c.fill = yellow;
    c.alignment = { horizontal: 'center' };
  }
  return { buf: await wb.xlsx.writeBuffer(), rows: rows.length };
}

async function main() {
  const now = ilNow();
  if (!FORCE && !(['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(now.day) && now.hour === 16)) {
    console.log(`skip: Israel ${now.day} ${now.hour}:xx`);
    return;
  }
  const orders = JSON.parse(fs.readFileSync(ORDERS, 'utf8'));
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { lastMaxId: 0 };
  const maxId = Math.max(0, ...orders.map(o => o.id));
  const fresh = orders.filter(o => o.id > state.lastMaxId).length;
  if (!FORCE && fresh === 0) {
    console.log(`skip: no new orders since ${state.lastMaxId}`);
    return;
  }

  const { buf, rows } = await buildXlsx(orders);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: TZ }).format(new Date()).replace(/\//g, '-');
  const filename = `mekarer-orders-${date}.xlsx`;
  if (DRY_RUN) {
    fs.writeFileSync(path.join(__dirname, filename), Buffer.from(buf));
    console.log(`dry-run: ${filename}, ${orders.length} orders / ${rows} rows, new: ${fresh}`);
    return;
  }

  const to = (process.env.MEKARER_DAILY_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!to.length) throw new Error('MEKARER_DAILY_RECIPIENTS не задан');
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const res = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: `Formula Road <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to,
    subject: `הזמנות מקררים — ${date} (${fresh} חדשות)`,
    html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px">שלום יוסי,<br><br>
      מצורף קובץ הזמנות המקררים מ-Formula Road — ${orders.length} הזמנות, החדשות למעלה (${fresh} חדשות מאז הדיווח הקודם).<br>
      בעמודה <b>אישור יוסי</b> אפשר לבחור כן / לא.</div>`,
    attachments: [{ filename, content: Buffer.from(buf).toString('base64') }],
  });
  if (res.error) throw new Error(JSON.stringify(res.error));
  fs.writeFileSync(STATE, JSON.stringify({ lastMaxId: maxId, sentAt: new Date().toISOString() }));
  console.log('sent', to.join(','), JSON.stringify(res.data));
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
