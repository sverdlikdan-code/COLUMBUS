// obligo-alert.js — авто-алярм топ-менеджменту, когда сеть/клиент приближается к лимиту
// облиго. Источник — таблица 'HOVOT ALL' (датасет FORMULA DASHBORD, workspace
// DASHBORDS -ICE-INTER-FORMULA, тот же что POWERBI_DATASET_ID/POWERBI_WORKSPACE_ID в .env),
// мера [% ניצול OBLIGO] — подтверждена живым запросом 2026-09-10, совпадает с DELTA-страницей
// один в один (שופרסל אקספרס 121%, טיב טעם 111%).
//
// HOVOT ALL — грануляция "компания" (מס' חברה), без разбивки на רשתות/שוק פרטי. Эта
// классификация (+ אחראי) живёт в 'לקוחות FORM+I+INT' на уровне отдельных
// клиентских счетов (несколько строк на одну компанию), с шумом на границах (обычно один
// "служебный" חנויות/שוק פרטי счёт среди множества רשתות-счетов одной сети, живая
// проверка 2026-09-10) — поэтому классификация компании берётся по большинству (mode),
// не по первому попавшемуся значению.
//
// Идентификатор алярма:
//   רשתות     -> 'HOVOT ALL'[תאור סוג לקוח] (название сети)
//   שוק פרטי  -> 'HOVOT ALL'[שם לקוח] (имя конкретного клиента, после fixBiDi)
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

// PBI оборачивает иврит в BiDi-марки, символы/цифры идут в визуальном (обратном) порядке —
// снять марки и развернуть обратно в логический порядок. Та же функция, что в
// export-promo-no-price.js и других серверных скриптах, читающих иврит из PBI.
const BIDI_TEST = /[‎‏‪-‮]/;
const BIDI_STRIP = /[‎‏‪-‮]/g;
function fixBiDi(raw) {
  if (!raw) return '';
  const hasBidi = BIDI_TEST.test(raw);
  const s = raw.replace(BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  return s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('').replace(/\d+/g, m => m.split('').reverse().join('')) : w)
    .join(' ');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// Компания -> {market, resp} по большинству голосов среди её клиентских счетов.
async function fetchCompanyClassification() {
  const rows = await executeDax(`
    EVALUATE
    SUMMARIZE('לקוחות FORM+I+INT',
      'לקוחות FORM+I+INT'[מס חברה],
      'לקוחות FORM+I+INT'[שוק פרטי / רשתות],
      'לקוחות FORM+I+INT'[אחראי],
      "n", COUNTROWS('לקוחות FORM+I+INT')
    )
  `);

  const byCompany = new Map(); // מס חברה -> Map(key -> count), per attribute
  for (const r of rows) {
    const co = r['לקוחות FORM+I+INT[מס חברה]'];
    if (!co) continue;
    const n = r['[n]'];
    if (!byCompany.has(co)) byCompany.set(co, { market: new Map(), resp: new Map() });
    const bucket = byCompany.get(co);
    const bump = (map, val) => { if (val) map.set(val, (map.get(val) || 0) + n); };
    bump(bucket.market, r['לקוחות FORM+I+INT[שוק פרטי / רשתות]']);
    bump(bucket.resp, r['לקוחות FORM+I+INT[אחראי]']);
  }

  const mode = map => { let best = null, bestN = -1; for (const [k, n] of map) if (n > bestN) { best = k; bestN = n; } return best; };
  const result = new Map();
  for (const [co, bucket] of byCompany) {
    result.set(co, { market: mode(bucket.market), resp: mode(bucket.resp) });
  }
  return result;
}

async function fetchUtilization() {
  const rows = await executeDax(`
    EVALUATE
    FILTER(
      SUMMARIZECOLUMNS(
        'HOVOT ALL'[מס' חברה],
        'HOVOT ALL'[תאור סוג לקוח],
        'HOVOT ALL'[שם לקוח],
        "util", [% ניצול OBLIGO]
      ),
      NOT ISBLANK([util])
    )
    ORDER BY [util] DESC
  `);
  return rows.map(r => ({
    company: r["HOVOT ALL[מס' חברה]"],
    type: r['HOVOT ALL[תאור סוג לקוח]'],
    custName: fixBiDi(r['HOVOT ALL[שם לקוח]']),
    util: r['[util]'],
  }));
}

async function fetchRows() {
  const [classification, utilization] = await Promise.all([fetchCompanyClassification(), fetchUtilization()]);
  return utilization.map(row => {
    const cls = classification.get(row.company) || {};
    const isChain = cls.market === 'רשתות';
    return {
      name: isChain ? row.type : row.custName,
      market: cls.market || '—',
      resp: cls.resp || '—',
      util: row.util,
    };
  }).filter(r => r.name);
}

function pctColor(util) {
  if (util >= 1) return '#B00020';
  if (util >= THRESHOLD) return '#B8863B';
  return '#1A9E5C';
}

function buildEmailHtml(crossed) {
  const rowsHtml = crossed.map(c => `
    <tr>
      <td dir="rtl" style="padding:8px 10px;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:13px;color:#2A2620;font-weight:bold">${c.name}</td>
      <td dir="rtl" style="padding:8px 10px;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:12px;color:#6B7280">${c.market}</td>
      <td dir="rtl" style="padding:8px 10px;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:12px;color:#6B7280">${c.resp}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:${pctColor(c.util)};text-align:left">${Math.round(c.util * 100)}%</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="he"><body style="margin:0;padding:24px;background:#f0eee9;font-family:Arial,sans-serif">
<table role="presentation" align="center" width="680" cellpadding="0" cellspacing="0" style="width:680px;max-width:680px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E0D8">
  <tr><td dir="rtl" style="background:#1C3D6B;padding:26px 24px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#B8863B;font-weight:bold;text-transform:uppercase">OBLIGO ALERT</div>
    <div style="padding-top:6px;font-family:Georgia,serif;font-size:20px;color:#ffffff">${crossed.length} לקוחות/רשתות חצו סף ${Math.round(THRESHOLD * 100)}% ניצול אובליגו</div>
  </td></tr>
  <tr><td style="padding:18px 20px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr dir="rtl">
        <th style="padding:0 10px 8px;text-align:right;font-family:Arial,sans-serif;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #1C3D6B">שם</th>
        <th style="padding:0 10px 8px;text-align:right;font-family:Arial,sans-serif;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #1C3D6B">סוג שוק</th>
        <th style="padding:0 10px 8px;text-align:right;font-family:Arial,sans-serif;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #1C3D6B">אחראי</th>
        <th style="padding:0 10px 8px;text-align:left;font-family:Arial,sans-serif;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #1C3D6B">% ניצול</th>
      </tr>
      ${rowsHtml}
    </table>
  </td></tr>
  <tr><td dir="rtl" style="padding:20px 24px 28px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:12px;color:#6B7280;line-height:1.6">
      נשלח אוטומטית פעם בשבוע (ימי ראשון). כל לקוח/רשת מדווח פעם אחת בעת החצייה של הסף,
      לא נשלח שוב כל עוד הוא נשאר מעליו.
    </div>
  </td></tr>
</table>
</body></html>`;
}

async function sendAlert(crossed, recipients) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const subject = `OBLIGO ALERT: ${crossed.length} ${crossed.length === 1 ? 'חצה' : 'חצו'} סף ${Math.round(THRESHOLD * 100)}%`;
  const text = crossed.map(c => `${c.name} (${c.market}, אחראי: ${c.resp}): ${Math.round(c.util * 100)}%`).join('\n');
  return resend.emails.send({
    from: `OBLIGO Alert <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to: recipients,
    subject,
    html: buildEmailHtml(crossed),
    text,
  });
}

async function main() {
  const rows = await fetchRows();
  const state = loadState();
  const crossed = [];

  for (const row of rows) {
    const wasOver = !!state[row.name]?.overThreshold;
    const isOver = row.util >= THRESHOLD;
    if (isOver && !wasOver) crossed.push(row);
    state[row.name] = { overThreshold: isOver };
  }
  crossed.sort((a, b) => b.util - a.util);

  console.log(`Проверено ${rows.length} записей, порог ${Math.round(THRESHOLD * 100)}%, новых превышений: ${crossed.length}`);
  for (const c of crossed) console.log(`  ${c.name} (${c.market}, אחראי: ${c.resp}): ${Math.round(c.util * 100)}%`);

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
