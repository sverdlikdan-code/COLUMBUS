// obligo-alert.js — авто-алярм топ-менеджменту, когда сеть/клиент приближается к лимиту
// облиго. Источник — таблица 'HOVOT ALL' (датасет FORMULA DASHBORD, workspace
// DASHBORDS -ICE-INTER-FORMULA, тот же что POWERBI_DATASET_ID/POWERBI_WORKSPACE_ID в .env),
// мера [% ניצול OBLIGO] — подтверждена живым запросом 2026-09-10, совпадает с DELTA-страницей
// один в один (שופרסל אקספרס 121%, טיב טעם 111%).
//
// Группировка — 'HOVOT ALL'[תאור סוג לקוח] напрямую: в этом поле уже ~140 конкретных
// значений (и названия сетей типа שופרסל אקספרס, и отдельные клиенты типа דהן/אויגו) —
// отдельного бакета "שוק פרטי" нет, поле само по себе даёт нужную гранулярность,
// двухуровневая логика רשת/שם לקוח не понадобилась.
//
// Повтор — один раз при переходе через порог (edge-trigger), state в obligo-alert-state.json.
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const { executeDax } = require('./powerbi');

const THRESHOLD = 0.90;
const STATE_PATH = path.join(__dirname, 'data', 'obligo-alert-state.json');
const DRY_RUN = process.argv.includes('--dry-run');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function fetchUtilization() {
  const rows = await executeDax(`
    EVALUATE
    FILTER(
      SUMMARIZECOLUMNS(
        'HOVOT ALL'[תאור סוג לקוח],
        "util", [% ניצול OBLIGO]
      ),
      NOT ISBLANK([util])
    )
    ORDER BY [util] DESC
  `);
  return rows.map(r => ({
    name: r['HOVOT ALL[תאור סוג לקוח]'],
    util: r['[util]'],
  }));
}

function buildEmailHtml(crossed) {
  const rowsHtml = crossed.map(c => `
    <tr>
      <td dir="rtl" style="padding:10px 0;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:14px;color:#2A2620">${c.name}</td>
      <td style="padding:10px 0;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:${c.util >= 1 ? '#B00020' : '#B8863B'};text-align:left">${Math.round(c.util * 100)}%</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="he"><body style="margin:0;padding:24px;background:#f0eee9;font-family:Arial,sans-serif">
<table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E0D8">
  <tr><td dir="rtl" style="background:#1C3D6B;padding:26px 24px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#B8863B;font-weight:bold;text-transform:uppercase">OBLIGO ALERT</div>
    <div style="padding-top:6px;font-family:Georgia,serif;font-size:20px;color:#ffffff">לקוחות שחצו את סף ${Math.round(THRESHOLD * 100)}% ניצול אובליגו</div>
  </td></tr>
  <tr><td style="padding:20px 24px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
  </td></tr>
  <tr><td dir="rtl" style="padding:20px 24px 28px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:12px;color:#6B7280;line-height:1.6">
      נשלח אוטומטית פעם אחת בעת החצייה של הסף (לא נשלח שוב כל עוד הרשת נשארת מעל הסף).
    </div>
  </td></tr>
</table>
</body></html>`;
}

async function sendAlert(crossed, recipients) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const subject = `OBLIGO ALERT: ${crossed.length} ${crossed.length === 1 ? 'לקוח חצה' : 'לקוחות חצו'} סף ${Math.round(THRESHOLD * 100)}%`;
  const text = crossed.map(c => `${c.name}: ${Math.round(c.util * 100)}%`).join('\n');
  return resend.emails.send({
    from: `OBLIGO Alert <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to: recipients,
    subject,
    html: buildEmailHtml(crossed),
    text,
  });
}

async function main() {
  const rows = await fetchUtilization();
  const state = loadState();
  const crossed = [];

  for (const row of rows) {
    const wasOver = !!state[row.name]?.overThreshold;
    const isOver = row.util >= THRESHOLD;
    if (isOver && !wasOver) crossed.push(row);
    state[row.name] = { overThreshold: isOver };
  }

  console.log(`Проверено ${rows.length} записей, порог ${Math.round(THRESHOLD * 100)}%, новых превышений: ${crossed.length}`);
  for (const c of crossed) console.log(`  ${c.name}: ${Math.round(c.util * 100)}%`);

  if (crossed.length === 0) {
    saveState(state);
    return;
  }

  if (DRY_RUN) {
    console.log('\n--dry-run — письмо не отправлено.');
    return; // не сохраняем state в dry-run, чтобы можно было гонять повторно
  }

  const recipients = (process.env.OBLIGO_ALERT_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (recipients.length === 0) throw new Error('OBLIGO_ALERT_RECIPIENTS не задан в .env');

  const res = await sendAlert(crossed, recipients);
  console.log('Отправлено:', JSON.stringify(res));
  saveState(state);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
