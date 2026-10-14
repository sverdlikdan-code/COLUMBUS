// mekarer-ashdod.js — заказы מקרר с אישור יוסי = כן для офиса Ашдод (Татьяна Бегун, Марьяна Йофик), Вс–Чт.
// Cron на VPS: 0,40 13,14 UTC; скрипт сам пропускает всё кроме 16:00 и 16:40 Israel (летнее/зимнее время).
// Письмо уходит, только если с прошлой отправки Йоси поставил новый אישור (approveAt > lastSentAt) —
// 16:40 = повторная, если после 16:00 появились новые אישורים. Каналы FORMULA + ICE BDD.
// Каждой — своё письмо со своей ссылкой /i/<code> (target 'mekarer', вход только в ניהול מקררים);
// Дан в копии только в первом письме, чтобы не получать дубль.
// .env: MEKARER_ASHDOD_RECIPIENTS="email|link,email|link", MEKARER_ASHDOD_CC.
// Флаги: --dry-run (xlsx на диск, без письма), --force (без проверки времени и новых אישורים).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Resend } = require('resend');
const { flatRows, readMarks } = require('./mekarer-daily');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const STATE = path.join(__dirname, 'mekarer-ashdod-state.json');
const TZ = 'Asia/Jerusalem';

function ilDate(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute));
}

function ilNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23',
    weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: p.weekday, hour: +p.hour, min: +p.minute };
}

const COLS = [
  ['סטטוס אספקה', 12], ['הערות אשדוד', 30], ['הערות יוסי', 30], ['תאריך אישור', 16], ['תאריך ושעת הגשה', 18],
  ['ערוץ', 10], ["מס' לקוח", 11], ['שם לקוח', 36], ['עיר', 12], ['שם סוכן', 18], ['מנהל', 10], ['איש קשר', 14],
  ['טלפון', 13], ['מיקום', 9], ['פעולה', 10], ['דגם לספק', 34], ['דגם לאסוף', 34], ['סלסלאות', 9], ['עגלה', 7],
  ['תאריך אספקה', 13], ['תקלה / הערה', 28], ["מס' הזמנה", 15],
];

function readOrders(f) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8')); } catch { return []; }
}

// Same rows/keys as /mekarer-admin.html (server/index.js mekarerAdminRows), only approved ones.
function approvedRows(marks) {
  return [
    ...flatRows(readOrders('mekarer-orders.json'), 'F').map(r => ({ ...r, channel: 'FORMULA' })),
    ...flatRows(readOrders('mekarer-orders-bdd.json'), 'B').map(r => ({ ...r, channel: 'ICE BDD' })),
  ].filter(r => marks[r.key]?.approve === 'כן').sort((a, b) => b.id - a.id);
}

async function buildXlsx(rows, marks) {
  const m = (r, f) => marks[r.key]?.[f] || '';
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('מקררים מאושרים', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.addTable({
    name: 'MekarerAshdod', ref: 'A1', headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: COLS.map(([name]) => ({ name, filterButton: true })),
    rows: rows.map(r => [m(r, 'supply'), m(r, 'natashaNote'), m(r, 'yossiNote'),
      m(r, 'approveAt') ? ilDate(m(r, 'approveAt')) : '', r.submittedAt ? ilDate(r.submittedAt) : '', r.channel,
      r.custId, r.custName, r.city, r.agentName, r.manager, r.contactName, r.phone, r.location, r.action,
      r.newModel, r.returnModel, r.salot, r.agala, r.supplyDate ? new Date(r.supplyDate + 'T00:00:00Z') : '',
      r.fault, r.id]),
  });
  COLS.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
  ws.getColumn(4).numFmt = 'dd/mm/yyyy hh:mm';
  ws.getColumn(5).numFmt = 'dd/mm/yyyy hh:mm';
  ws.getColumn(20).numFmt = 'dd/mm/yyyy';
  rows.forEach((r, i) => {
    const c = ws.getCell(i + 2, 1), v = m(r, 'supply');
    c.alignment = { horizontal: 'center' };
    if (v) c.font = { bold: true, color: { argb: v === 'סופק' ? 'FF2E7D32' : 'FFC62828' } };
    [2, 3, 21].forEach(col => { ws.getCell(i + 2, col).alignment = { wrapText: true, vertical: 'top' }; });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  const now = ilNow();
  const slot = now.hour === 16 && (now.min < 10 || (now.min >= 40 && now.min < 50));
  if (!FORCE && !(['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(now.day) && slot)) {
    console.log(`skip: Israel ${now.day} ${now.hour}:${String(now.min).padStart(2, '0')}`);
    return;
  }
  const marks = readMarks();
  const rows = approvedRows(marks);
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { lastSentAt: '' };
  const fresh = rows.filter(r => (marks[r.key].approveAt || '') > state.lastSentAt).length;
  if (!FORCE && fresh === 0) {
    console.log(`skip: no new approvals since ${state.lastSentAt || 'never'}`);
    return;
  }
  const startedAt = new Date().toISOString();
  const buf = await buildXlsx(rows, marks);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: TZ }).format(new Date()).replace(/\//g, '-');
  const filename = `mekarer-approved-${date}.xlsx`;
  if (DRY_RUN) {
    fs.writeFileSync(path.join(__dirname, filename), buf);
    console.log(`dry-run: ${filename}, ${rows.length} approved rows, new: ${fresh}`);
    return;
  }

  const recips = (process.env.MEKARER_ASHDOD_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(s => { const [email, link] = s.split('|').map(x => x.trim()); return { email, link }; });
  if (!recips.length) throw new Error('MEKARER_ASHDOD_RECIPIENTS не задан');
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const cc = (process.env.MEKARER_ASHDOD_CC || '').split(',').map(s => s.trim()).filter(Boolean);
  const resend = new Resend(process.env.RESEND_API_KEY);
  for (const [i, { email, link }] of recips.entries()) {
    const res = await resend.emails.send({
      from: `Diler Intelligence <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
      to: [email],
      ...(i === 0 && cc.length ? { cc } : {}),
      subject: `מקררים מאושרים לאספקה — ${date} (${fresh} חדשים)`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px">שלום,<br><br>
        מצורף קובץ הזמנות המקררים שיוסי אישר — ${rows.length} שורות, ${fresh} אישורים חדשים מאז הדיווח הקודם.<br><br>
        ${link ? `לעדכון <b>סטטוס אספקה</b> (סופק / לא סופק) ו<b>הערות אשדוד</b>:<br>
        <a href="${link}" style="display:inline-block;margin-top:8px;background:#1565C0;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">🧊 פתיחת ניהול מקררים</a><br><br>
        הקישור אישי — לא להעביר.` : ''}</div>`,
      attachments: [{ filename, content: buf.toString('base64') }],
    });
    if (res.error) throw new Error(`${email}: ${JSON.stringify(res.error)}`);
    console.log('sent', email, i === 0 ? `cc ${cc.join(',')}` : '', JSON.stringify(res.data));
  }
  fs.writeFileSync(STATE, JSON.stringify({ lastSentAt: startedAt, rows: rows.length, fresh }));
}

if (require.main === module) main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
