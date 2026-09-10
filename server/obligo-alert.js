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
  // Только готовые меры модели — [% ניצול OBLIGO], [OBLIGO מנוצל], [OBLIGO רב חברתי].
  // Никакого ручного SUM/сложения по сырым колонкам: проверено 2026-09-10, что готовые
  // меры дают ТЕ ЖЕ числа, что отчёт (Total: 61,945,216 / 73,988,000; שופרסל אקספרס:
  // 6,638,149 / 5,500,000; טיב טעם: 3,429,626 / 3,100,000) — самодельная агрегация не нужна
  // и рискует повторить баг из OBLIGO ALL M-кода (List.Sum вместо List.Max, сессия 2026-09-09).
  const rows = await executeDax(`
    EVALUATE
    FILTER(
      SUMMARIZECOLUMNS(
        'HOVOT ALL'[מס' חברה],
        'HOVOT ALL'[תאור סוג לקוח],
        'HOVOT ALL'[שם לקוח],
        "util", [% ניצול OBLIGO],
        "usedILS", [OBLIGO מנוצל],
        "limitILS", [OBLIGO רב חברתי]
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
    limitILS: r['[limitILS]'] || 0,
    usedILS: r['[usedILS]'] || 0,
  }));
}

// HOVOT ALL — грань компании, но несколько компаний могут делить одно название
// תאור סוג לקוח (пример 2026-09-10: "דהן" — 5 разных юрлиц-франчайзи под ответственным
// מקסים, каждое со своим лимитом). Отчёт при группировке по סוג לקוח их суммирует
// (620,000 = 250k+10k+10k+200k+150k, used 1,093,016 ≈ сумма used — сверено с DELTA живьём) —
// плоский список по компаниям без агрегации давал по 5 фиктивных "דהן" с дикими %.
// Агрегируем по (אחראי, имя): сумма used, сумма limit, % пересчитан из сумм.
async function fetchRows() {
  const [classification, utilization] = await Promise.all([fetchCompanyClassification(), fetchUtilization()]);
  const perCompany = utilization.map(row => {
    const cls = classification.get(row.company) || {};
    const isChain = cls.market === 'רשתות';
    return {
      name: isChain ? row.type : row.custName,
      market: cls.market || '—',
      resp: cls.resp || '—',
      limitILS: row.limitILS,
      usedILS: row.usedILS,
    };
  }).filter(r => r.name);

  const grouped = new Map(); // "resp||name" -> aggregate
  for (const r of perCompany) {
    const key = `${r.resp}||${r.name}`;
    if (!grouped.has(key)) grouped.set(key, { name: r.name, market: r.market, resp: r.resp, limitILS: 0, usedILS: 0 });
    const g = grouped.get(key);
    g.limitILS += r.limitILS;
    g.usedILS += r.usedILS;
  }

  return [...grouped.values()]
    .filter(g => g.limitILS > 0)
    .map(g => ({ ...g, util: g.usedILS / g.limitILS }));
}

function pctColor(util) {
  if (util >= 1) return '#B00020';
  if (util >= THRESHOLD) return '#B8863B';
  return '#1A9E5C';
}

function fmtILS(n) {
  return '₪' + Math.round(n).toLocaleString('en-US');
}

const AMOUNT_HEAD_CELLS = `
        <th style="padding:0 10px 8px;text-align:left;font-family:Arial,sans-serif;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #1C3D6B">אובליגו מנוצל</th>
        <th style="padding:0 10px 8px;text-align:left;font-family:Arial,sans-serif;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #1C3D6B">אובליגו רב חברתי</th>
        <th style="padding:0 10px 8px;text-align:left;font-family:Arial,sans-serif;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #1C3D6B">% ניצול</th>`;

const TABLE_HEAD_WITH_RESP = `
      <tr dir="rtl">
        <th style="padding:0 10px 8px;text-align:right;font-family:Arial,sans-serif;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #1C3D6B">שם</th>
        <th style="padding:0 10px 8px;text-align:right;font-family:Arial,sans-serif;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #1C3D6B">אחראי</th>
        ${AMOUNT_HEAD_CELLS}
      </tr>`;

const TABLE_HEAD_NO_RESP = `
      <tr dir="rtl">
        <th style="padding:0 10px 8px;text-align:right;font-family:Arial,sans-serif;font-size:11px;color:#6B7280;text-transform:uppercase;border-bottom:2px solid #1C3D6B">שם</th>
        ${AMOUNT_HEAD_CELLS}
      </tr>`;

const amountCellsHtml = c => `
      <td style="padding:8px 10px;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:12px;color:#6B7280;text-align:left" dir="ltr">${fmtILS(c.usedILS)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:12px;color:#6B7280;text-align:left" dir="ltr">${fmtILS(c.limitILS)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:${pctColor(c.util)};text-align:left">${Math.round(c.util * 100)}%</td>`;

function rowWithResp(c) {
  return `
    <tr>
      <td dir="rtl" style="padding:8px 10px;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:13px;color:#2A2620;font-weight:bold">${c.name}</td>
      <td dir="rtl" style="padding:8px 10px;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:12px;color:#6B7280">${c.resp}</td>${amountCellsHtml(c)}
    </tr>`;
}

function rowNoResp(c) {
  return `
    <tr>
      <td dir="rtl" style="padding:8px 10px;border-bottom:1px solid #E5E0D8;font-family:Arial,sans-serif;font-size:13px;color:#2A2620;font-weight:bold">${c.name}</td>${amountCellsHtml(c)}
    </tr>`;
}

function buildTable(title, rows) {
  if (rows.length === 0) return '';
  return `
  <tr><td dir="rtl" style="padding:22px 20px 6px;text-align:right">
    <div style="font-family:Georgia,serif;font-size:16px;color:#1C3D6B;font-weight:bold">${title} (${rows.length})</div>
  </td></tr>
  <tr><td style="padding:0 20px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${TABLE_HEAD_WITH_RESP}
      ${rows.map(rowWithResp).join('')}
    </table>
  </td></tr>`;
}

// Сети (רשתות) — отдельный блок таблицы на каждого אחראי, а не общий список.
function buildGroupedByResp(title, rows) {
  if (rows.length === 0) return '';
  const byResp = new Map();
  for (const r of rows) {
    if (!byResp.has(r.resp)) byResp.set(r.resp, []);
    byResp.get(r.resp).push(r);
  }
  // "לא מוגדר" — в конец, остальные по алфавиту
  const resps = [...byResp.keys()].sort((a, b) => (a === 'לא מוגדר') - (b === 'לא מוגדר') || a.localeCompare(b, 'he'));

  const blocks = resps.map(resp => `
  <tr><td dir="rtl" style="padding:14px 20px 4px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:13px;color:#B8863B;font-weight:bold">${resp} (${byResp.get(resp).length})</div>
  </td></tr>
  <tr><td style="padding:0 20px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${TABLE_HEAD_NO_RESP}
      ${byResp.get(resp).map(rowNoResp).join('')}
    </table>
  </td></tr>`).join('');

  return `
  <tr><td dir="rtl" style="padding:22px 20px 0;text-align:right">
    <div style="font-family:Georgia,serif;font-size:16px;color:#1C3D6B;font-weight:bold">${title} (${rows.length})</div>
  </td></tr>
  ${blocks}`;
}

function buildEmailHtml(crossed) {
  const chains = crossed.filter(c => c.market === 'רשתות');
  const privateMarket = crossed.filter(c => c.market !== 'רשתות');

  return `<!doctype html>
<html lang="he"><body style="margin:0;padding:24px;background:#f0eee9;font-family:Arial,sans-serif">
<table role="presentation" align="center" width="700" cellpadding="0" cellspacing="0" style="width:700px;max-width:700px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E0D8">
  <tr><td dir="rtl" style="background:#1C3D6B;padding:26px 24px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#B8863B;font-weight:bold;text-transform:uppercase">OBLIGO ALERT</div>
    <div style="padding-top:6px;font-family:Georgia,serif;font-size:20px;color:#ffffff">${crossed.length} לקוחות/רשתות חצו סף ${Math.round(THRESHOLD * 100)}% ניצול אובליגו</div>
  </td></tr>
  ${buildGroupedByResp('רשתות', chains)}
  ${buildTable('שוק פרטי', privateMarket)}
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
  const text = crossed.map(c => `${c.name} (${c.market}, אחראי: ${c.resp}): ${fmtILS(c.usedILS)}/${fmtILS(c.limitILS)} = ${Math.round(c.util * 100)}%`).join('\n');
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
    // resp+name, не только name — один и тот же סוג לקוח может стоять под разными
    // אחראי как отдельные строки (после агрегации по компаниям внутри каждой пары).
    const key = `${row.resp}||${row.name}`;
    const wasOver = !!state[key]?.overThreshold;
    const isOver = row.util >= THRESHOLD;
    if (isOver && !wasOver) crossed.push(row);
    state[key] = { overThreshold: isOver };
  }
  crossed.sort((a, b) => b.util - a.util);

  console.log(`Проверено ${rows.length} записей, порог ${Math.round(THRESHOLD * 100)}%, новых превышений: ${crossed.length}`);
  for (const c of crossed) console.log(`  ${c.name} (${c.market}, אחראי: ${c.resp}): ${fmtILS(c.usedILS)}/${fmtILS(c.limitILS)} = ${Math.round(c.util * 100)}%`);

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
