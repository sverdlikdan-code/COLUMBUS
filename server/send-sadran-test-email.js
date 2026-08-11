// send-sadran-test-email.js — прототип executive-дайджеста SADRAN (задел под будущую
// авторассылку боссам, см. project memory / FMCG-research 2026-08-11). Разовый ручной
// запуск, не подключён к крону — тело письма собирается из уже посчитанного
// scripts/sadran_fetch_cache.json (тот же кэш, что и PPTX-генераторы).
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const {
  loadRows, loadIceBddBenchmark, loadMomentum, pctChange, aggBy, fmtILS, fmtPct, getNewCustomerSet,
} = require('../scripts/sadran-data');

if (!process.env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY не найден в .env');
  process.exit(1);
}
const resend = new Resend(process.env.RESEND_API_KEY);

const TO = process.argv[2];
if (!TO) {
  console.error('Использование: node send-sadran-test-email.js you@example.com');
  process.exit(1);
}

// Бренд-палитра — та же, что в generate-sadran-report-impeccable.js (единый визуальный язык
// PPTX + email). NO RED rule: падение = приглушённый steel-grey, не тревожный красный.
const NAVY = '1C3D6B';
const GREEN = '1A9E5C';
const DECLINE = '607080';
const GOLD = 'B8863B';
const INK = '2A2620';
const MUTED = '6B7280';
const PAPER = 'FAF7F2';
const LINE = 'E5E0D8';

const colorForPct = p => (p === null ? MUTED : p > 0.02 ? GREEN : p < -0.02 ? DECLINE : MUTED);

function main() {
  const rows = loadRows();
  const totalLY = rows.reduce((s, r) => s + r.lastYear, 0);
  const totalNow = rows.reduce((s, r) => s + r.now, 0);
  const totalPct = pctChange(totalLY, totalNow);

  const byCompany = aggBy(rows, r => r.company).sort((a, b) => b.now - a.now);

  const rowsExBdd = rows.filter(r => r.company !== 'ICE BDD');
  const newCustSet = getNewCustomerSet(rowsExBdd);
  const custTotals = new Map();
  for (const r of rows) {
    if (!custTotals.has(r.custno)) custTotals.set(r.custno, { lastYear: 0, now: 0 });
    const c = custTotals.get(r.custno);
    c.lastYear += r.lastYear;
    c.now += r.now;
  }
  const sameStore = [...custTotals.values()].filter(v => v.lastYear > 0);
  const sameLY = sameStore.reduce((s, v) => s + v.lastYear, 0);
  const sameNow = sameStore.reduce((s, v) => s + v.now, 0);
  const samePct = pctChange(sameLY, sameNow);

  const momentum = loadMomentum();
  const iceBdd = loadIceBddBenchmark();
  const iceBddPct = iceBdd ? pctChange(iceBdd.lastYear, iceBdd.now) : null;
  let pct3 = null, pct6 = null, accelerating = null;
  if (momentum) {
    pct3 = pctChange(momentum.window3.lastYear, momentum.window3.now);
    pct6 = pctChange(momentum.window6.lastYear, momentum.window6.now);
    accelerating = (pct3 !== null && pct6 !== null) ? pct3 >= pct6 : null;
  }

  const periodLabel = new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  // ---------- HTML (табличная вёрстка, инлайн-стили — совместимо с Outlook desktop) ----------
  const companyRowsHtml = byCompany.map(b => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #${LINE};font-family:Georgia,serif;font-size:16px;color:#${INK};font-weight:bold">${b.key}</td>
      <td style="padding:14px 0;border-bottom:1px solid #${LINE};font-family:Arial,sans-serif;font-size:13px;color:#${MUTED};text-align:right">${fmtILS(b.lastYear)} &rarr; ${fmtILS(b.now)}</td>
      <td style="padding:14px 0;border-bottom:1px solid #${LINE};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#${colorForPct(b.pct)};text-align:right;width:70px">${fmtPct(b.pct)}</td>
    </tr>`).join('');

  const momentumBadge = (pct3 !== null && pct6 !== null) ? `
    <tr><td style="padding:0 24px 20px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#${PAPER};border-radius:6px">
        <tr><td style="padding:14px 16px;font-family:Arial,sans-serif;font-size:13px;color:#${INK}">
          <strong>Momentum:</strong> последние 3&nbsp;мес <strong style="color:#${colorForPct(pct3)}">${fmtPct(pct3)}</strong>
          &nbsp;vs&nbsp; последние 6&nbsp;мес <strong style="color:#${colorForPct(pct6)}">${fmtPct(pct6)}</strong>
          &mdash; ${accelerating ? 'рост ускоряется' : 'рост тормозит'}
        </td></tr>
      </table>
    </td></tr>` : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f0eee9;font-family:Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #${LINE}">
  <tr><td style="background:#${NAVY};padding:28px 24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#${GOLD};font-weight:bold;text-transform:uppercase">SADRAN &middot; EXECUTIVE DIGEST</td>
    </tr><tr><td style="padding-top:6px;font-family:Georgia,serif;font-size:22px;color:#ffffff">Итог за ${periodLabel}</td></tr></table>
  </td></tr>

  <tr><td style="padding:28px 24px 4px">
    <div style="font-family:Georgia,serif;font-size:44px;font-weight:bold;color:#${colorForPct(totalPct)};line-height:1">${fmtPct(totalPct)}</div>
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#${MUTED};padding-top:6px">${fmtILS(totalLY)} &rarr; ${fmtILS(totalNow)}</div>
  </td></tr>

  <tr><td style="padding:20px 24px 4px"></td></tr>
  ${momentumBadge}

  <tr><td style="padding:0 24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${companyRowsHtml}</table>
  </td></tr>

  <tr><td style="padding:20px 24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#${PAPER};border-radius:6px">
      <tr><td style="padding:16px 18px;font-family:Arial,sans-serif;font-size:13px;color:#${INK};line-height:1.7">
        &bull; Same-store (клиенты с историей): <strong style="color:#${colorForPct(samePct)}">${fmtPct(samePct)}</strong>, ${sameStore.length} клиентов<br>
        ${iceBdd ? `&bull; Для сравнения &mdash; ICE BDD (канал без сдарана): <strong style="color:#${colorForPct(iceBddPct)}">${fmtPct(iceBddPct)}</strong>` : ''}
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:4px 24px 28px">
    <div style="font-family:Arial,sans-serif;font-size:12px;color:#${MUTED};line-height:1.6">
      Полная колода &mdash; во вложении (SADRAN_REPORT_IMPECCABLE.pptx).<br>
      Это тестовое письмо-прототип авторассылки, сгенерировано автоматически.
    </div>
  </td></tr>
</table>
</body></html>`;

  // ---------- Plain-text fallback — без него письма чаще уходят в спам ----------
  const text = [
    `SADRAN — итог за ${periodLabel}`,
    `${fmtPct(totalPct)}  (${fmtILS(totalLY)} -> ${fmtILS(totalNow)})`,
    (pct3 !== null && pct6 !== null) ? `Momentum: 3 мес ${fmtPct(pct3)} vs 6 мес ${fmtPct(pct6)} — ${accelerating ? 'ускоряется' : 'тормозит'}` : '',
    '',
    ...byCompany.map(b => `${b.key}: ${fmtILS(b.lastYear)} -> ${fmtILS(b.now)} (${fmtPct(b.pct)})`),
    '',
    `Same-store: ${fmtPct(samePct)}, ${sameStore.length} клиентов`,
    iceBdd ? `ICE BDD (без сдарана, для сравнения): ${fmtPct(iceBddPct)}` : '',
    '',
    'Полная колода — во вложении. Тестовое письмо-прототип.',
  ].filter(Boolean).join('\n');

  const pptxPath = path.join('C:', 'Users', 'd.sverdlik', 'Desktop', 'SADRAN_REPORT_IMPECCABLE.pptx');
  const attachments = fs.existsSync(pptxPath)
    ? [{ filename: 'SADRAN_REPORT_IMPECCABLE.pptx', content: fs.readFileSync(pptxPath).toString('base64') }]
    : [];

  return resend.emails.send({
    from: `SADRAN Analytics <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to: [TO],
    subject: `SADRAN — итог за ${periodLabel}: ${fmtPct(totalPct)}`,
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
