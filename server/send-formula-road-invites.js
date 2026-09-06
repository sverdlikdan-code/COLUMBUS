// Bulk-send Formula Road invite links from the "EMAIL + PASSWORD.xlsx" roster.
// Preserved as a real script (unlike the 2026-08-16 one-off, which wasn't saved
// and left no record of what was actually sent) — safe to re-run for new hires
// or a resend, reads whatever the current xlsx has.
//
// Dry-run by default — prints what would be sent, sends nothing. Pass --send to
// actually email. Pass --to=someone@example.com to send only to that one address
// (useful for a test pass before a real batch).
//
// Usage (from server/):
//   node send-formula-road-invites.js                # dry run, all rows
//   node send-formula-road-invites.js --send          # real send, all rows
//   node send-formula-road-invites.js --send --to=x@y.com

require('dotenv').config({ path: '../.env' });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { Resend } = require('resend');

const SHOULD_SEND = process.argv.includes('--send');
const ONLY_TO = (process.argv.find(a => a.startsWith('--to=')) || '').slice(5) || null;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const SHORT_INVITE_FILE = path.join(__dirname, 'data', 'short-invites.json');

function loadShortInvites() {
  try { return JSON.parse(fs.readFileSync(SHORT_INVITE_FILE, 'utf8')); } catch { return {}; }
}
function saveShortInvites(map) {
  fs.mkdirSync(path.dirname(SHORT_INVITE_FILE), { recursive: true });
  fs.writeFileSync(SHORT_INVITE_FILE, JSON.stringify(map, null, 2), 'utf8');
}
function makeShortInvite(code, name, days, isManager) {
  const map = loadShortInvites();
  const short = crypto.randomBytes(5).toString('base64url');
  map[short] = { code, name, exp: Date.now() + days * 24 * 60 * 60 * 1000, isManager };
  saveShortInvites(map);
  return `https://api.sverdlik-apps.site/i/${short}`;
}

function emailHtml({ name, link, isManager }) {
  const scopeLine = isManager
    ? 'הקישור למטה בשבילך — נכנס אוטומטית עם הרשאת מנהל, גישה לכל הסוכנים והמסלולים.'
    : 'הקישור למטה בשבילך — נכנס אוטומטית ומציג רק את הלקוחות שלך.';
  return `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f5f7fa;padding:24px 16px">
<div style="background:linear-gradient(135deg,#1A3F7C,#2E6FAD);color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
  <div style="font-size:22px;font-weight:900;letter-spacing:1px">FORMULA ROAD 🗺</div>
  <div style="font-size:13px;opacity:.85;margin-top:4px">כלי עבודה חדש לסוכני השטח</div>
</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px">
  <p style="font-size:15px;margin:0 0 14px">שלום ${escEmail(name)},</p>
  <p style="font-size:14px;line-height:1.7;color:#333;margin:0 0 14px">
    נבנה עבורך כלי עבודה חדש שעונד על העבודה היומיומית:
  </p>
  <ul style="font-size:14px;line-height:1.9;color:#333;padding-inline-start:20px;margin:0 0 16px">
    <li><b>מנתב מסלולים חכם</b> — סדר ביקורים אופטימלי, מפה, ניווט ב-Waze/Google</li>
    <li><b>אנליטיקאי AI</b> — ניתוח לקוחות, מגמות מכירה, TOP לקוחות להיום</li>
    <li><b>בקשת זיכוי מהירה</b> — בחירת מוצרים בתמונות, ושליחה ישירה לוואטסאפ כבלנק מוכן</li>
  </ul>
  <p style="font-size:14px;line-height:1.7;color:#333;margin:0 0 6px">
    ${scopeLine}
  </p>
  <p style="font-size:13px;line-height:1.6;color:#666;margin:0 0 20px">
    <b>אין צורך בסיסמה</b> — פשוט ללחוץ על הכפתור.
  </p>
  <div style="text-align:center;margin:22px 0">
    <a href="${link}" style="display:inline-block;background:#1A3F7C;color:#fff;font-size:16px;font-weight:800;padding:14px 32px;border-radius:10px;text-decoration:none">
      פתח את FORMULA ROAD ←
    </a>
  </div>
  <p style="font-size:11px;color:#999;text-align:center;margin:0 0 14px">
    הקישור בתוקף 30 יום — מומלץ לשמור במועדפים לגישה מהירה
  </p>
  <p style="font-size:11px;line-height:1.6;color:#999;text-align:center;background:#F8FBFF;border-radius:8px;padding:10px 12px;margin:0">
    📱 <b>שמירה על מסך הבית:</b> יש לפתוח את הקישור דווקא ב-<b>Chrome</b> (לא בדפדפן Samsung Internet) — אחרת מכשירי Samsung מסוימים עלולים להציג התראת "אפליקציה חשודה נחסמה" של Google Play Protect. זו לא בעיה באפליקציה עצמה, רק דרישה של הדפדפן.
  </p>
</div>
</div>`;
}
function escEmail(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(__dirname, '..', 'FORMULA ROADS -PASSWORDS', 'EMAIL + PASSWORD.xlsx'));
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const v = row.values;
    const email = String(v[5] ?? '').trim();
    if (!email) return;
    rows.push({
      agentCode: String(v[1] ?? '').trim(),
      agentName: String(v[2] ?? '').trim(),
      email,
      isManager: String(v[6] ?? '').trim().toUpperCase() === 'YES',
    });
  });

  // Skip rows sharing an email with another row — sending both means neither agent
  // reliably gets their own invite, and the roster (EMAIL + PASSWORD.xlsx) currently
  // has 2 such pairs from what looks like copy-paste errors. Print them so they don't
  // silently go missing from the batch.
  const emailCounts = new Map();
  for (const r of rows) emailCounts.set(r.email.toLowerCase(), (emailCounts.get(r.email.toLowerCase()) || 0) + 1);
  const duplicates = rows.filter(r => emailCounts.get(r.email.toLowerCase()) > 1);
  if (duplicates.length) {
    console.log(`SKIPPING ${duplicates.length} row(s) with duplicate emails in the roster:`);
    duplicates.forEach(r => console.log(`  ${r.agentName} <${r.email}>`));
  }
  const deduped = rows.filter(r => emailCounts.get(r.email.toLowerCase()) === 1);

  const targets = ONLY_TO ? deduped.filter(r => r.email.toLowerCase() === ONLY_TO.toLowerCase()) : deduped;
  console.log(`${SHOULD_SEND ? 'SENDING' : 'DRY RUN'} — ${targets.length} recipient(s) (${deduped.filter(r=>r.isManager).length} managers, ${deduped.filter(r=>!r.isManager).length} agents after dedup)`);

  for (const r of targets) {
    const link = makeShortInvite(r.agentCode, r.agentName, 30, r.isManager);
    console.log(`${r.isManager ? '[MANAGER]' : '[AGENT]  '} ${r.agentName} <${r.email}> -> ${link}`);
    if (SHOULD_SEND) {
      if (!resend) { console.error('  RESEND_API_KEY not configured, skipping send'); continue; }
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM || 'orders@sverdlik-apps.site',
          to: r.email,
          cc: 'd.sverdlik@DilerBMD.com',
          subject: 'FORMULA ROAD — כלי עבודה חדש לסוכני השטח',
          html: emailHtml({ name: r.agentName, link, isManager: r.isManager }),
        });
        console.log('  sent.');
      } catch (e) {
        console.error('  SEND FAILED:', e.message);
      }
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
