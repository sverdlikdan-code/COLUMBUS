// One-off (but preserved, re-runnable): email each 'team' manager in
// server/data/managers.json their new personal login code — replaces the
// shared "1999" password retired 2026-09-07 (server/index.js /auth).
//
// Dry-run by default — prints what would be sent, sends nothing. Pass --send
// to actually email. Pass --to=someone@example.com to send only that one.
//
// Usage (from server/):
//   node send-manager-codes.js                # dry run
//   node send-manager-codes.js --send          # real send, all team managers
//   node send-manager-codes.js --send --to=x@y.com

require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

const SHOULD_SEND = process.argv.includes('--send');
const ONLY_TO = (process.argv.find(a => a.startsWith('--to=')) || '').slice(5) || null;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// name -> email, pulled from FORMULA ROADS -PASSWORDS/EMAIL + PASSWORD.xlsx
// (not re-read here to avoid an exceljs dependency for a 5-row lookup).
const EMAILS = {
  'Alexey Berilov': 'dilerformula69@gmail.com',
  'Anatoli Rusanovski': 'dilerformula83@gmail.com',
  'Natalia Rubin': 'dilerformula127@gmail.com',
  'Svetlana Perelman': 'dilerformula115@gmail.com',
  'Vladyslav Hlushchenko': 'dilerformula159@gmail.com',
};

function escEmail(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function emailHtml({ name, code }) {
  return `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f5f7fa;padding:24px 16px">
<div style="background:linear-gradient(135deg,#1A3F7C,#2E6FAD);color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
  <div style="font-size:22px;font-weight:900;letter-spacing:1px">FORMULA ROAD 🗺</div>
  <div style="font-size:13px;opacity:.85;margin-top:4px">עדכון קוד כניסה אישי</div>
</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px">
  <p style="font-size:15px;margin:0 0 14px">שלום ${escEmail(name)},</p>
  <p style="font-size:14px;line-height:1.7;color:#333;margin:0 0 14px">
    הסיסמה הכללית הישנה ("1999") בוטלה. מעכשיו לכל מנהל יש קוד אישי משלו.
  </p>
  <p style="font-size:13px;line-height:1.6;color:#666;margin:0 0 20px">
    אם את/ה נכנס/ת דרך הקיצור השמור על מסך הבית — לא צריך לעשות כלום, זה ימשיך לעבוד.
    הקוד הבא נחוץ רק אם נכנסים ידנית (מכשיר חדש, קישור אבד וכו').
  </p>
  <div style="text-align:center;margin:22px 0">
    <div style="display:inline-block;background:#f0f4fa;border:2px dashed #1A3F7C;color:#1A3F7C;font-size:28px;font-weight:900;letter-spacing:4px;padding:14px 36px;border-radius:10px">
      ${escEmail(code)}
    </div>
  </div>
</div>
</div>`;
}

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'managers.json'), 'utf8'));
  const targets = roster
    .filter(m => m.role === 'team' && m.code)
    .map(m => ({ name: m.name, code: m.code, email: EMAILS[m.name] }))
    .filter(m => m.email && (!ONLY_TO || m.email.toLowerCase() === ONLY_TO.toLowerCase()));

  console.log(`${SHOULD_SEND ? 'SENDING' : 'DRY RUN'} — ${targets.length} recipient(s)`);
  for (const t of targets) {
    console.log(`  ${t.name} <${t.email}> -> code ${t.code}`);
    if (SHOULD_SEND) {
      if (!resend) { console.error('  RESEND_API_KEY not configured, skipping send'); continue; }
      try {
        await resend.emails.send({
          from: `ИИ ассистент аналитика <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
          to: t.email,
          cc: 'd.sverdlik@DilerBMD.com',
          subject: 'FORMULA ROAD — הקוד האישי החדש שלך',
          html: emailHtml(t),
        });
        console.log('  sent.');
      } catch (e) {
        console.error('  SEND FAILED:', e.message);
      }
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
