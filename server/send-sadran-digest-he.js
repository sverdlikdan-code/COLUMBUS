// send-sadran-digest-he.js — executive-дайджест SADRAN на иврите (для реальных боссов
// компании). Разовый ручной запуск, не подключён к крону.
//
// Тело письма — МИНИМАЛЬНОЕ (решение пользователя 2026-08-11: "в теле ничего кроме бла-бла —
// всё уже в файле"). Все цифры/momentum/company breakdown — только в приложенных PPTX,
// email — просто уведомление с логотипом и вложениями, не дублирует данные.
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const { loadPeriods, pctChange, loadRows } = require('../scripts/sadran-data');

if (!process.env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY не найден в .env');
  process.exit(1);
}
const resend = new Resend(process.env.RESEND_API_KEY);

const TO = process.argv[2];
if (!TO) {
  console.error('Использование: node send-sadran-digest-he.js you@example.com');
  process.exit(1);
}

const NAVY = '1C3D6B';
const GOLD = 'B8863B';
const MUTED = '6B7280';
const PAPER = 'FAF7F2';
const LINE = 'E5E0D8';

// periodRangeLabel — реальный период отчёта (YTD 1 января -> последний закрытый месяц),
// не "текущий месяц" (был баг 2026-08-11: письмо писало "август" при данных за январь-июль).
function periodRangeLabel(periods) {
  if (!periods) return '';
  const start = new Date(periods.now.start);
  const endInclusive = new Date(periods.now.endExclusive);
  endInclusive.setDate(endInclusive.getDate() - 1);
  const startMonth = start.toLocaleDateString('he-IL', { month: 'long' });
  const endMonth = endInclusive.toLocaleDateString('he-IL', { month: 'long' });
  const year = endInclusive.getFullYear();
  return startMonth === endMonth ? `${startMonth} ${year}` : `${startMonth}–${endMonth} ${year}`;
}

function main() {
  const periods = loadPeriods();
  const periodLabel = periodRangeLabel(periods);
  const rows = loadRows();
  const totalPct = pctChange(rows.reduce((s, r) => s + r.lastYear, 0), rows.reduce((s, r) => s + r.now, 0));
  const pctLabel = totalPct === null ? '' : (totalPct >= 0 ? '+' : '') + Math.round(totalPct * 100) + '%';

  const html = `<!doctype html>
<html lang="he"><body style="margin:0;padding:24px;background:#f0eee9;font-family:Arial,sans-serif">
<table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #${LINE}">

  <tr><td style="background:#${PAPER};padding:18px 24px;text-align:center;border-bottom:1px solid #${LINE}">
    <img src="cid:diler-logo" width="48" height="48" alt="DILER B.M.D" style="display:inline-block" />
  </td></tr>

  <tr><td dir="rtl" style="background:#${NAVY};padding:26px 24px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#${GOLD};font-weight:bold;text-transform:uppercase">SADRAN &middot; תקציר להנהלה</div>
    <div style="padding-top:6px;font-family:Georgia,serif;font-size:20px;color:#ffffff">שלום, מצורף סיכום המכירות ל<span dir="ltr">${periodLabel}</span></div>
  </td></tr>

  <tr><td dir="rtl" style="padding:24px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#2A2620;line-height:1.7">
      כל הנתונים, הגרפים והפירוט &mdash; במצגות המצורפות (עברית ורוסית).
    </div>
  </td></tr>

  <tr><td dir="rtl" style="padding:4px 24px 28px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:12px;color:#${MUTED};line-height:1.6">
      נשלח אוטומטית על ידי מערכת האנליטיקה של SADRAN.
    </div>
  </td></tr>
</table>
</body></html>`;

  const text = `SADRAN — סיכום ${periodLabel}\n\nכל הנתונים במצגות המצורפות (עברית ורוסית).\nנשלח אוטומטית על ידי מערכת האנליטיקה של SADRAN.`;

  const desktop = p => path.join('C:', 'Users', 'd.sverdlik', 'Desktop', p);
  const attachments = [];
  const logoPath = path.join(__dirname, '..', 'docs', 'logo-diler-bmd.png');
  if (fs.existsSync(logoPath)) {
    attachments.push({ filename: 'logo.png', content: fs.readFileSync(logoPath).toString('base64'), contentId: 'diler-logo' });
  }
  for (const file of ['SADRAN_REPORT_IMPECCABLE_HE.pptx', 'SADRAN_REPORT_IMPECCABLE.pptx']) {
    const p = desktop(file);
    if (fs.existsSync(p)) attachments.push({ filename: file, content: fs.readFileSync(p).toString('base64') });
    else console.warn(`  внимание: ${file} не найден на Desktop, не приложен`);
  }

  return resend.emails.send({
    from: `SADRAN Analytics <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to: [TO],
    subject: `SADRAN — סיכום ${periodLabel}${pctLabel ? `: ${pctLabel}` : ''}`,
    html,
    text,
    attachments,
  });
}

main().then(res => {
  console.log('Отправлено:', JSON.stringify(res));
}).catch(e => {
  console.error('ERR:', e.message);
  process.exit(1);
});
