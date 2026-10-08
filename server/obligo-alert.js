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
// Повтор — каждую неделю, пока клиент/сеть остаётся выше порога (не только при переходе).
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const { executeDax } = require('./powerbi');

const THRESHOLD = 0.85;
const DRY_RUN = process.argv.includes('--dry-run');

// Внутренние/дочерние компании — не внешний кредитный риск, не алармить.
// מ.מ.ד.אינטרנשיונל אילת — своя дочерняя компания (пользователь подтвердил 2026-09-10).
const EXCLUDED_NAMES = new Set(['מ.מ.ד.אינטרנשיונל אילת']);

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

// Компания -> {market, resp, custno, formAgent, iceAgent, interAgent} по большинству
// голосов среди её клиентских счетов. custno нужен только для שוק פרטי (пользователь
// просил номер клиента) — для רשתות он бессмысленен (несколько компаний под одним именем
// после агрегации, единого номера клиента нет). Агент — отдельно по каждой из 3 систем
// (HEVRA: FORMULA/ICE/INTER): группировка שוק פרטי по агенту с приоритетом
// FORMULA -> ICE -> INTER (пользователь 2026-09-10).
async function fetchCompanyClassification() {
  const rows = await executeDax(`
    EVALUATE
    SUMMARIZE('לקוחות FORM+I+INT',
      'לקוחות FORM+I+INT'[מס חברה],
      'לקוחות FORM+I+INT'[שוק פרטי / רשתות],
      'לקוחות FORM+I+INT'[אחראי],
      'לקוחות FORM+I+INT'[מס. לקוח],
      'לקוחות FORM+I+INT'[HEVRA],
      'לקוחות FORM+I+INT'[שם סוכן],
      "n", COUNTROWS('לקוחות FORM+I+INT')
    )
  `);

  const byCompany = new Map(); // מס חברה -> Map(key -> count), per attribute
  for (const r of rows) {
    const co = r['לקוחות FORM+I+INT[מס חברה]'];
    if (!co) continue;
    const n = r['[n]'];
    if (!byCompany.has(co)) {
      byCompany.set(co, {
        market: new Map(), resp: new Map(), custno: new Map(),
        formAgent: new Map(), iceAgent: new Map(), interAgent: new Map(),
      });
    }
    const bucket = byCompany.get(co);
    const bump = (map, val) => { if (val) map.set(val, (map.get(val) || 0) + n); };
    bump(bucket.market, r['לקוחות FORM+I+INT[שוק פרטי / רשתות]']);
    bump(bucket.resp, r['לקוחות FORM+I+INT[אחראי]']);
    bump(bucket.custno, r['לקוחות FORM+I+INT[מס. לקוח]']);
    const hevra = r['לקוחות FORM+I+INT[HEVRA]'];
    const agentName = fixBiDi(r['לקוחות FORM+I+INT[שם סוכן]']);
    if (hevra === 'FORMULA') bump(bucket.formAgent, agentName);
    else if (hevra === 'ICE') bump(bucket.iceAgent, agentName);
    else if (hevra === 'INTER') bump(bucket.interAgent, agentName);
  }

  const mode = map => { let best = null, bestN = -1; for (const [k, n] of map) if (n > bestN) { best = k; bestN = n; } return best; };
  const result = new Map();
  for (const [co, bucket] of byCompany) {
    result.set(co, {
      market: mode(bucket.market), resp: mode(bucket.resp), custno: mode(bucket.custno),
      formAgent: mode(bucket.formAgent), iceAgent: mode(bucket.iceAgent), interAgent: mode(bucket.interAgent),
    });
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
    // Группировка שוק פרטי — по агенту: приоритет FORMULA, потом ICE, потом INTER.
    const groupAgent = cls.formAgent || cls.iceAgent || cls.interAgent || 'לא מוגדר';
    return {
      name: isChain ? row.type : row.custName,
      market: cls.market || '—',
      resp: cls.resp || '—',
      agent: groupAgent,
      custno: cls.custno || '—',
      limitILS: row.limitILS,
      usedILS: row.usedILS,
    };
  }).filter(r => r.name);

  const mode = map => { let best = null, bestN = -1; for (const [k, n] of map) if (n > bestN) { best = k; bestN = n; } return best; };
  const grouped = new Map(); // "resp||name" -> aggregate
  for (const r of perCompany) {
    const key = `${r.resp}||${r.name}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        name: r.name, market: r.market, resp: r.resp, limitILS: 0, usedILS: 0,
        agentVotes: new Map(), custnoVotes: new Map(),
      });
    }
    const g = grouped.get(key);
    g.limitILS += r.limitILS;
    g.usedILS += r.usedILS;
    g.agentVotes.set(r.agent, (g.agentVotes.get(r.agent) || 0) + 1);
    g.custnoVotes.set(r.custno, (g.custnoVotes.get(r.custno) || 0) + 1);
  }

  return [...grouped.values()]
    .filter(g => g.limitILS > 0 && !EXCLUDED_NAMES.has(g.name))
    .map(g => ({
      name: g.name, market: g.market, resp: g.resp, limitILS: g.limitILS, usedILS: g.usedILS,
      util: g.usedILS / g.limitILS,
      agent: mode(g.agentVotes),
      custno: mode(g.custnoVotes),
    }));
}

// Brand — та же executive-палитра, что send-sadran-digest-he.js (навигация, золото,
// пергамент), плюс лого DILER B.M.D в шапке — официальный бланк, не голый текст.
const NAVY = '#1C3D6B';
const NAVY_DEEP = '#0F2647';
const GOLD = '#B8863B';
const INK = '#2A2620';
const MUTED = '#6B7280';
const PAPER = '#FAF7F2';
const LINE = '#E5E0D8';
const ZEBRA = '#FAFAF8';

function pctColor(util) {
  if (util >= 1) return '#B00020';
  if (util >= THRESHOLD) return GOLD;
  return '#1A9E5C';
}

function pctBg(util) {
  if (util >= 1) return '#FBEAEC';
  if (util >= THRESHOLD) return '#F7EFDF';
  return '#E9F7EF';
}

function fmtILS(n) {
  return '₪' + Math.round(n).toLocaleString('en-US');
}

// Порядок колонок (пользователь 2026-09-10): מס' לקוח (только שוק פרטי) -> שם -> אובליגו
// (лимит, רב חברתי) -> ניצול אובליגו (использовано, מנוצל) -> %.
const TH = `padding:0 10px 10px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.5px;color:${MUTED};text-transform:uppercase;border-bottom:2px solid ${NAVY}`;

// Ширина колонок с числами — фиксированная (не auto), иначе у каждого блока (своя
// <table>) ширина колонок пересчитывается от своего же содержимого и цифры "гуляют"
// по вертикали между блоками — не симметрично (пользователь 2026-09-10, скриншот).
const AMOUNT_HEAD_CELLS = `
        <th style="${TH};text-align:right;width:100px">אובליגו</th>
        <th style="${TH};text-align:right;width:100px">ניצול אובליגו</th>
        <th style="${TH};text-align:right;width:64px">%</th>`;

const TABLE_HEAD_CHAINS = `
      <tr dir="rtl">
        <th style="${TH};text-align:right">רשת</th>
        ${AMOUNT_HEAD_CELLS}
      </tr>`;

const TABLE_HEAD_PRIVATE = `
      <tr dir="rtl">
        <th style="${TH};text-align:right">מס' לקוח</th>
        <th style="${TH};text-align:right">שם</th>
        ${AMOUNT_HEAD_CELLS}
      </tr>`;

const amountCellsHtml = (c, bg) => `
      <td style="padding:10px;border-bottom:1px solid ${LINE};background:${bg};font-family:Arial,sans-serif;font-size:12px;color:${MUTED};text-align:right;width:100px" dir="ltr">${fmtILS(c.limitILS)}</td>
      <td style="padding:10px;border-bottom:1px solid ${LINE};background:${bg};font-family:Arial,sans-serif;font-size:12px;color:${MUTED};text-align:right;width:100px" dir="ltr">${fmtILS(c.usedILS)}</td>
      <td style="padding:10px;border-bottom:1px solid ${LINE};background:${bg};text-align:right;width:64px">
        <span style="display:inline-block;min-width:44px;padding:3px 9px;border-radius:20px;background:${pctBg(c.util)};font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:${pctColor(c.util)};text-align:center">${Math.round(c.util * 100)}%</span>
      </td>`;

function rowChain(c, i) {
  const bg = i % 2 ? ZEBRA : '#ffffff';
  return `
    <tr>
      <td dir="rtl" style="padding:10px;border-bottom:1px solid ${LINE};background:${bg};font-family:Arial,sans-serif;font-size:13px;color:${INK};font-weight:bold">${c.name}</td>${amountCellsHtml(c, bg)}
    </tr>`;
}

function rowPrivate(c, i) {
  const bg = i % 2 ? ZEBRA : '#ffffff';
  return `
    <tr>
      <td dir="ltr" style="padding:10px;border-bottom:1px solid ${LINE};background:${bg};font-family:Arial,sans-serif;font-size:12px;color:${MUTED};text-align:right">${c.custno}</td>
      <td dir="rtl" style="padding:10px;border-bottom:1px solid ${LINE};background:${bg};font-family:Arial,sans-serif;font-size:13px;color:${INK};font-weight:bold">${c.name}</td>${amountCellsHtml(c, bg)}
    </tr>`;
}

// Общий блок-группировщик: и רשתות (блоки по אחראי), и שוק פרטי (блоки по שם סוכן)
// делятся на отдельные под-таблицы вместо одного общего списка.
function buildGroupedBlocks(title, rows, groupField, tableHead, rowRenderer) {
  if (rows.length === 0) return '';
  const byGroup = new Map();
  for (const r of rows) {
    const key = r[groupField];
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(r);
  }
  // "לא מוגדר" / "—" — в конец, остальные по алфавиту
  const undefinedLast = k => k === 'לא מוגדר' || k === '—';
  const keys = [...byGroup.keys()].sort((a, b) => (undefinedLast(a) - undefinedLast(b)) || a.localeCompare(b, 'he'));

  const blocks = keys.map(k => `
  <tr><td dir="rtl" style="padding:16px 24px 6px;text-align:right;background:${PAPER}">
    <div style="font-family:Arial,sans-serif;font-size:13px;color:${NAVY};font-weight:bold">${k}</div>
  </td></tr>
  <tr><td style="padding:0 24px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid ${LINE}">
      ${tableHead}
      ${byGroup.get(k).map(rowRenderer).join('')}
    </table>
  </td></tr>`).join('');

  return `
  <tr><td dir="rtl" style="padding:26px 24px 0;text-align:right">
    <div style="font-family:Georgia,serif;font-size:17px;color:${NAVY};font-weight:bold;display:inline-block;border-bottom:2px solid ${GOLD};padding-bottom:4px">${title}</div>
  </td></tr>
  ${blocks}`;
}

// Кому имя известно — обращение по имени в письме (пользователь 2026-09-10: "и так не
// говорят", письмо без адресата звучит как спам-бот). Кого нет в списке — просто "שלום,".
const RECIPIENT_NAMES = {
  'yuval.e@dilerbmd.com': 'יובל',
  'yosiel@dilerbmd.com': 'יוסי',
  'dima@dilerbmd.com': 'דימה',
  'maxim@dilerbmd.com': 'מקסים',
  'd.sverdlik@dilerbmd.com': 'דן',
  'danyb@dilerbmd.com': 'דני',
  'hanan.h@dilerbmd.com': 'חנן',
  'alexander.f@dilerbmd.com': 'אלכסנדר',
  // менеджеры команд FORMULA (адреса как в CLIENT_CHANGES_MANAGERS)
  'dilerformula69@gmail.com': 'אלכסי',
  'dilerformula83@gmail.com': 'אנטולי',
  'dilerformula127@gmail.com': 'נטליה',
  'dilerformula115@gmail.com': 'סבטלנה',
  'dilerformula159@gmail.com': 'ולדיסלב',
  'dilerformula79@gmail.com': 'רומן',
  // менеджеры ICE BDD (как CLIENT_CHANGES_BDD_MANAGERS)
  'dilerformula84@gmail.com': 'טימור',
  'dilerformula99@gmail.com': 'מטביי',
  'dilerformula231@gmail.com': 'שמחה',
};

// Менеджеру команды — только שוק פרטי агентов его קבוצה (пользователь 2026-10-08).
// Агент שוק פרטי здесь = имя FORMULA-агента ('לקוחות FORM+I+INT'[שם סוכן]); его קבוצה — из
// 'משטח' (тот же источник, что client-changes-alert). У агента несколько групп — берём частую.
async function fetchAgentGroups() {
  const rows = await executeDax(`
    EVALUATE
    SUMMARIZECOLUMNS('משטח'[שם סוכן], 'משטח'[קבוצה], "n", COUNTROWS('משטח'))`);
  const best = new Map(); // agent -> {group, n}
  for (const r of rows) {
    const agent = fixBiDi(r['משטח[שם סוכן]']);
    const group = String(r['משטח[קבוצה]'] || '').trim();
    if (!agent || !group) continue;
    if (!best.has(agent) || r['[n]'] > best.get(agent).n) best.set(agent, { group, n: r['[n]'] });
  }
  const groupOf = new Map([...best].map(([a, v]) => [a, v.group]));
  // ICE BDD (пользователь 2026-10-08): ICE-агент -> группа BDD (TIMUR/MATVEY/ALMOG/SIMHA) из
  // bdd-cache.json живого сервера (как client-changes-alert). FORMULA-группа имеет приоритет.
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(process.env.LIVE_DATA_DIR || path.join(__dirname, 'data'), 'bdd-cache.json'), 'utf8'));
    for (const [, c] of cache.clientById) if (c.agentName && c.manager && !groupOf.has(c.agentName)) groupOf.set(c.agentName, c.manager);
  } catch (e) { console.error('[managers] bdd-cache не прочитан, BDD-менеджерам пусто:', e.message); }
  return groupOf;
}

function buildEmailHtml(crossed, greetName, privateOnly = false) {
  const chains = privateOnly ? [] : crossed.filter(c => c.market === 'רשתות');
  const privateMarket = crossed.filter(c => c.market !== 'רשתות');
  const greeting = greetName ? `שלום ${greetName},` : 'שלום,';
  const intro = privateOnly ? 'מצורף עדכון האובליגו השבועי — שוק פרטי, הסוכנים של הקבוצה שלך. תקבלו אותו כל יום חמישי.' : 'מצורף עדכון האובליגו השבועי — תקבלו אותו כל יום חמישי.';

  return `<!doctype html>
<html lang="he"><body style="margin:0;padding:28px 16px;background:${PAPER};font-family:Arial,sans-serif">
<table role="presentation" align="center" width="700" cellpadding="0" cellspacing="0" style="width:700px;max-width:700px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${LINE};box-shadow:0 2px 16px rgba(28,61,107,.08)">

  <tr><td dir="rtl" style="background-color:${NAVY};padding:36px 28px 30px;text-align:center">
    <img src="cid:diler-logo-white" width="100" height="100" alt="DILER B.M.D" style="display:block;margin:0 auto 18px" />
    <div style="font-family:Arial,sans-serif;font-size:24px;font-weight:900;color:#ffffff;letter-spacing:.3px">התראת אובליגו</div>
    <div style="padding-top:8px;font-family:Arial,sans-serif;font-size:13px;color:#AFC1DC">${crossed.length} ${crossed.length === 1 ? 'לקוח/רשת חצה' : 'לקוחות/רשתות חצו'} סף ${Math.round(THRESHOLD * 100)}% ניצול אובליגו</div>
    <div style="padding-top:10px;font-family:Arial,sans-serif;font-size:11px;color:${GOLD};letter-spacing:.5px">דוח שבועי &middot; ${new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
  </td></tr>

  <tr><td dir="rtl" style="padding:20px 28px 0;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:14px;color:${INK}">${greeting} ${intro}</div>
  </td></tr>

  ${buildGroupedBlocks('רשתות', chains, 'resp', TABLE_HEAD_CHAINS, rowChain)}
  ${buildGroupedBlocks('שוק פרטי', privateMarket, 'agent', TABLE_HEAD_PRIVATE, rowPrivate)}

  <tr><td dir="rtl" style="padding:24px 28px 28px;text-align:right;border-top:1px solid ${LINE}">
    <div style="font-family:Arial,sans-serif;font-size:12px;color:${MUTED};line-height:1.7;padding-top:20px">
      כל לקוח/רשת שנמצא מעל סף ${Math.round(THRESHOLD * 100)}% מדווח מחדש בכל דוח שבועי, עד שהוא יורד מתחת לסף.<br>
      הערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.
    </div>
  </td></tr>
</table>
</body></html>`;
}

async function sendAlert(crossed, recipients, privateOnly = false) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const subject = `דוח שבועי — אובליגו: ${crossed.length} ${crossed.length === 1 ? 'חצה' : 'חצו'} סף ${Math.round(THRESHOLD * 100)}%`;
  // Белая версия лого (сплошной силуэт, brightness(0)+invert(1) от оригинала — сгенерирована
  // sharp'ом 2026-09-10) — на navy-фоне шапки, как в Formula Road (референс пользователя).
  const logoPath = path.join(__dirname, '..', 'docs', 'logo-diler-bmd-white.png');
  const attachments = fs.existsSync(logoPath)
    ? [{ filename: 'logo-white.png', content: fs.readFileSync(logoPath).toString('base64'), contentId: 'diler-logo-white' }]
    : [];

  // Личное письмо на каждого получателя — с обращением по имени, а не один "to" на всех.
  const results = [];
  for (const recipient of recipients) {
    const greetName = RECIPIENT_NAMES[recipient.toLowerCase()];
    const greeting = greetName ? `שלום ${greetName},` : 'שלום,';
    const outro = '\n\nהערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.';
    const text = `${greeting} ${privateOnly ? 'מצורף עדכון האובליגו השבועי — שוק פרטי, הסוכנים של הקבוצה שלך.' : 'מצורף עדכון האובליגו השבועי — תקבלו אותו כל יום חמישי.'}\n\n`
      + crossed.map(c => `${c.name} (${c.market}, אחראי: ${c.resp}): ${fmtILS(c.usedILS)}/${fmtILS(c.limitILS)} = ${Math.round(c.util * 100)}%`).join('\n')
      + outro;
    // OBLIGO_ALERT_CC — копия на каждое личное письмо (Дан на разовой рассылке 2026-10-08)
    const cc = (process.env.OBLIGO_ALERT_CC || '').split(',').map(s => s.trim()).filter(Boolean);
    const res = await resend.emails.send({
      from: `AI Analytics Assistant <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
      to: [recipient],
      ...(cc.length ? { cc } : {}),
      subject,
      html: buildEmailHtml(crossed, greetName, privateOnly),
      text,
      attachments,
    });
    results.push(res);
  }
  return results;
}

async function main() {
  const rows = await fetchRows();
  const crossed = rows.filter(r => r.util >= THRESHOLD).sort((a, b) => b.util - a.util);

  console.log(`Проверено ${rows.length} записей, порог ${Math.round(THRESHOLD * 100)}%, выше порога: ${crossed.length}`);
  for (const c of crossed) console.log(`  ${c.name} (${c.market}, אחראי: ${c.resp}): ${fmtILS(c.usedILS)}/${fmtILS(c.limitILS)} = ${Math.round(c.util * 100)}%`);

  if (crossed.length === 0) return;

  // Менеджеры команд: "ALEXEY=a@x;SADRAN+=b@x" — каждому שוק פרטי агентов его קבוצה.
  // Сбой карты групп не должен сорвать полный отчёт — менеджерские письма тогда пропускаются.
  const managers = (process.env.OBLIGO_ALERT_MANAGERS || '').split(';').map(s => s.split('=').map(x => x.trim())).filter(([g, e]) => g && e);
  const perManager = [];
  if (managers.length) {
    try {
      const groupOf = await fetchAgentGroups();
      const priv = crossed.filter(c => c.market !== 'רשתות');
      const noGroup = [...new Set(priv.filter(c => !groupOf.has(c.agent)).map(c => c.agent))];
      if (noGroup.length) console.log('  агенты שוק פרטי без קבוצה (только в полном отчёте):', noGroup.join(', '));
      for (const [groups, email] of managers) {
        const gs = new Set(groups.split(',').map(s => s.trim())); // "MATVEY,ALMOG=..." — несколько групп
        const mine = priv.filter(c => gs.has(groupOf.get(c.agent)));
        console.log(`  [${groups}] ${email}: ${mine.length}`);
        if (mine.length) perManager.push({ email, mine });
      }
    } catch (e) {
      console.error('[managers] карта קבוצה не получена, менеджерам не отправлено:', e.message);
    }
  }

  if (DRY_RUN) {
    console.log('\n--dry-run — письмо не отправлено.');
    return;
  }

  const recipients = (process.env.OBLIGO_ALERT_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (recipients.length === 0) throw new Error('OBLIGO_ALERT_RECIPIENTS не задан в .env');

  const res = await sendAlert(crossed, recipients);
  console.log('Отправлено:', JSON.stringify(res));
  for (const { email, mine } of perManager) {
    const r = await sendAlert(mine, [email], true);
    console.log(`Менеджеру ${email}:`, JSON.stringify(r[0]?.error ?? r[0]?.data));
  }
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
