// obligo-alert.js — еженедельный отчёт по облиго (четверг 09:00, VPS cron /root/run-alert.sh obligo-alert).
// Один отчёт из 3 частей (запрос מנהל כספים יובל, решения Дана 2026-10-12):
//   1. 85% <= ניצול < 100%  — מתקרבים לניצול מלא  (+ יתרה לניצול)
//   2. ניצול >= 100%        — חורגים מהמסגרת        (+ יתרה מעבר למסגרת)
//   3. חוב בפיגור > 0       — חורגים מתנאי התשלום  (корзины 1-30/31-60/61-90/90+ как в PBI, сальдо > 0 (с 27.10),
//                             независимо от того, есть ли у клиента лимит)
// Каждая часть — רשתות (блоки по אחראי) и שוק פרטי (блоки по агенту). Лимит 10,000 (дефолт Priority)
// считается обычным лимитом (Дан 2026-10-12). Excel-вложение — те же 3 части на 3 листах.
//
// Источник — датасет FORMULA DASHBORD. С 2026-10-12 'HOVOT ALL' — одна строка на ПЛАТЕЛЬЩИКА
// ([מס לקוח משלם]); справочник 'לקוחות FORM+I+INT' связан с ней по [KEY משלם]. Меры
// [% ניצול OBLIGO] / [OBLIGO מנוצל] / [OBLIGO רב חברתי] — готовые из модели (сверены с Priority 12.10).
// Рабочие дни — меры модели [ימי עבודה 1] / [ימי עבודה שעברו] (вс–чт минус праздники, тот же календарь,
// что в Formula Road).
//
// Письмо — сводка 3 частей + кнопка на ЛИЧНУЮ страницу /p/<hex> с полным списком (раскрывающиеся разделы, поиск;
// Парето снято, Дан 2026-10-13) + Excel-вложение. Безопасность ссылок (security-agent 2026-10-13): новый hex на каждое
// письмо, страницы старше LINK_DAYS удаляются (в начале запуска и cron --purge-links), CC — отдельное письмо со своей ссылкой.
//
// Сравнение с прошлой рассылкой (как в expiry-alert): OBLIGO_ALERT_STATE — список после боевой отправки,
// в письме блок נוספו / יצאו по каждой части. --to / --dry-run state не трогают.
//
// Запуск: node obligo-alert.js                 — боевая рассылка (OBLIGO_ALERT_RECIPIENTS + менеджеры)
//         OBLIGO_ALERT_OWNERS="דני=a@x;…" — אחראים сетей, каждому только его сети (Дан 2026-10-14)
//         node obligo-alert.js --dry-run       — без отправки, превью HTML+XLSX в ./out
//         node obligo-alert.js --to a@b.com    — тест: полный отчёт только на этот адрес (ссылка тоже настоящая — только на VPS)
//         node obligo-alert.js --purge-links   — только удалить просроченные страницы (ежедневный cron на VPS)
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Resend } = require('resend');
const crypto = require('crypto');
const { executeDax } = require('./powerbi');
const { query } = require('./db');

const NEAR = 0.85;
// Дни кредита — готовая мера модели, без своих расчётов (Дан 25.10)
const DSO_MEASURE = '[מספר ימי האשראי הממוצע]';
// Шапка частичного отчёта: менеджеру — частники его группы, אחראי — его сети.
const SCOPE_TEAM = 'שוק פרטי, הסוכנים של הקבוצה שלך';
const SCOPE_OWNER = 'רשתות באחריותך';
const DRY_RUN = process.argv.includes('--dry-run');
const TO_IDX = process.argv.indexOf('--to');
const TEST_TO = TO_IDX > -1 ? process.argv[TO_IDX + 1] : null;
const STATE = process.env.OBLIGO_ALERT_STATE || '';

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

const mode = map => { let best = null, bestN = -1; for (const [k, n] of map) if (n > bestN) { best = k; bestN = n; } return best; };

// Плательщик -> {market, resp, formAgent, iceAgent, interAgent} по большинству голосов среди его
// клиентских счетов (главный + филиалы). Агент — отдельно по каждой системе, приоритет
// FORMULA -> ICE -> INTER (пользователь 2026-09-10).
async function fetchPayerClassification() {
  const D = "'לקוחות FORM+I+INT'";
  const rows = await executeDax(`
    EVALUATE
    SUMMARIZE(${D}, ${D}[KEY משלם], ${D}[שוק פרטי / רשתות], ${D}[אחראי], ${D}[HEVRA], ${D}[שם סוכן],
      "n", COUNTROWS(${D}))
  `);
  const byPayer = new Map();
  for (const r of rows) {
    const key = r['לקוחות FORM+I+INT[KEY משלם]'];
    if (!key) continue;
    if (!byPayer.has(key)) byPayer.set(key, { market: new Map(), resp: new Map(), FORMULA: new Map(), ICE: new Map(), INTER: new Map() });
    const b = byPayer.get(key);
    const n = r['[n]'];
    const bump = (map, val) => { if (map && val) map.set(val, (map.get(val) || 0) + n); };
    bump(b.market, r['לקוחות FORM+I+INT[שוק פרטי / רשתות]']);
    bump(b.resp, r['לקוחות FORM+I+INT[אחראי]']);
    bump(b[r['לקוחות FORM+I+INT[HEVRA]']], fixBiDi(r['לקוחות FORM+I+INT[שם סוכן]']));
  }
  const result = new Map();
  for (const [key, b] of byPayer) {
    result.set(key, { market: mode(b.market), resp: mode(b.resp), agent: mode(b.FORMULA) || mode(b.ICE) || mode(b.INTER) });
  }
  return result;
}

async function fetchPayers() {
  // Лимит/использование/% — только готовые меры модели (никакого ручного SUM, сессия 2026-09-10).
  // Корзины просрочки — колонки HOVOT ALL (одна строка на плательщика, SUM = значение строки).
  const H = "'HOVOT ALL'";
  const rows = await executeDax(`
    EVALUATE
    SUMMARIZECOLUMNS(
      ${H}[מס לקוח משלם], ${H}[תאור סוג לקוח], ${H}[שם לקוח],
      "util", [% ניצול OBLIGO],
      "usedILS", [OBLIGO מנוצל],
      "limitILS", [OBLIGO רב חברתי],
      "dso", ${DSO_MEASURE},
      "sales3m", CALCULATE([TOTAL SALES brutto], ALL_PARTS[תאריך] >= EDATE(TODAY(), -3)),
      "b30", SUM(${H}[1-30]), "b60", SUM(${H}[31-60]), "b90", SUM(${H}[61-90]), "bOld", SUM(${H}[מעל 90]),
      "mmd", SUM(${H}[אובליגו MMD])
    )
  `);
  return rows.map(r => ({
    payer: r["HOVOT ALL[מס לקוח משלם]"],
    type: r['HOVOT ALL[תאור סוג לקוח]'],
    custName: fixBiDi(r['HOVOT ALL[שם לקוח]']),
    limitILS: r['[limitILS]'] || 0,
    usedILS: r['[usedILS]'] || 0,
    creditDays: r['[dso]'] ?? null,
    sales3m: r['[sales3m]'] || 0,
    hasMmd: !!r['[mmd]'],
    // корзины как в PBI, с минусами (Дан 27.10 отменил «только положительные» от 12.10: Шуферсаль
    // 955K у нас против 291K в PBI) — просрочка плательщика = сальдо корзин
    b30: r['[b30]'] || 0,
    b60: r['[b60]'] || 0,
    b90: r['[b90]'] || 0,
    bOld: r['[bOld]'] || 0,
  }));
}

// Рабочие дни месяца: всего / прошло — меры модели, отфильтрованные на текущий месяц
// (без фильтра мера считает по всему календарю, см. server/index.js workDaysPct).
async function fetchWorkDays() {
  const rows = await executeDax(`EVALUATE CALCULATETABLE(ROW("total", [ימי עבודה 1], "passed", [ימי עבודה שעברו]),
    MONTH(DIMCALENDAR[Date]) = MONTH(TODAY()), YEAR(DIMCALENDAR[Date]) = YEAR(TODAY()))`);
  const total = rows?.[0]?.['[total]'] || 0;
  const left = Math.max(0, total - (rows?.[0]?.['[passed]'] || 0));
  return { total, left, pct: total ? left / total : 0 };
}

// Сети — одна строка на (אחראי, название сети): несколько плательщиков одной сети суммируются
// (лимиты и использование), % пересчитан из сумм — как в отчёте PBI по תאור סוג לקוח.
// שוק פרטי — строка на плательщика (номер плательщика = מס' לקוח).
// Мера дней кредита на уровне сети (תאור סוג לקוח) — из сумм плательщиков в JS не пересчитываем
async function fetchChainDso() {
  const rows = await executeDax(`EVALUATE SUMMARIZECOLUMNS('HOVOT ALL'[תאור סוג לקוח], "dso", ${DSO_MEASURE})`);
  return new Map(rows.map(r => [r['HOVOT ALL[תאור סוג לקוח]'], r['[dso]'] ?? null]));
}

// Итог дней кредита по всей фирме — та же мера в итоговой строке PBI (Дан 27.10: в главную карточку).
// Фильтр отчёта PBI (все страницы): ALL_PARTS[מספר לקוח] без 1195002/1195003 — без него BRUTTO-365 больше и дней 46 вместо 69
async function fetchDsoTotal() {
  const rows = await executeDax(`EVALUATE ROW("dso", CALCULATE(${DSO_MEASURE}, KEEPFILTERS(NOT ALL_PARTS[מספר לקוח] IN {"1195002", "1195003"})))`);
  return rows[0] ? rows[0]['[dso]'] ?? null : null;
}

// תנאי תשלום + סטטוס из Priority по 3 базам (Дан 27.10; в PBI-модели их нет) — CUSTNAME -> [{co, terms, status}].
// PAYDES хранится с перевёрнутыми цифрами ("03 יום" = 30) — как в priority-db.js clientOverdueByPayer.
const PRIO_DBS = [['form', 'FORMULA'], ['icecrea', 'ICE'], ['diller', 'INTER']];
async function fetchTermsStatus() {
  const sqlText = PRIO_DBS.map(([db, co]) => `SELECT '${co}' AS co, c.CUSTNAME AS cust, pay.PAYDES AS terms, cs.STATDES AS status
    FROM ${db}.dbo.CUSTOMERS c LEFT JOIN ${db}.dbo.PAY pay ON pay.PAY = c.PAY LEFT JOIN ${db}.dbo.CUSTSTATS cs ON cs.CUSTSTAT = c.CUSTSTAT`).join('\nUNION ALL\n');
  const out = new Map();
  for (const r of (await query(sqlText)).recordset) {
    const id = String(r.cust || '').trim();
    if (!id) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push({ co: r.co, terms: String(r.terms || '').trim().replace(/\d+/g, d => [...d].reverse().join('')), status: String(r.status || '').trim() });
  }
  return out;
}
// Одна строка (Дан 27.10): везде одинаково — просто значение, иначе "FORMULA x · ICE y";
// больше 3 разных (сети с десятками плательщиков) — "יותר מ-3 … שונים" вместо простыни
const ONELINE_MANY = { terms: 'יותר מ-3 תנאי תשלום שונים', status: 'יותר מ-3 סטטוסים שונים' };
function oneLine(recs, field) {
  const all = [...new Set(recs.map(r => r[field]).filter(Boolean))];
  if (all.length <= 1) return all[0] || '';
  if (all.length > 3) return ONELINE_MANY[field];
  return PRIO_DBS.map(([, co]) => {
    const vs = [...new Set(recs.filter(r => r.co === co).map(r => r[field]).filter(Boolean))];
    return vs.length ? `${co} ${vs.join(' / ')}` : null;
  }).filter(Boolean).join(' · ');
}

async function fetchEntities() {
  const [classification, payers, chainDso] = [await fetchPayerClassification(), await fetchPayers(), await fetchChainDso()];
  const grouped = new Map();
  const byPayer = []; // для раздела DSO — строка на плательщика (Дан 25.10), без группировки сетей
  for (const p of payers) {
    const cls = classification.get(p.payer) || {};
    const isChain = cls.market === 'רשתות';
    const name = isChain ? p.type : p.custName;
    if (!name || EXCLUDED_NAMES.has(name)) continue;
    const key = isChain ? `C|${cls.resp || '—'}|${name}` : `P|${p.payer}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key, name, market: isChain ? 'רשתות' : 'שוק פרטי', resp: cls.resp || '—', agent: cls.agent || 'לא מוגדר',
        payers: new Set(), limitILS: 0, usedILS: 0, sales3m: 0, b30: 0, b60: 0, b90: 0, bOld: 0,
      });
    }
    const g = grouped.get(key);
    byPayer.push({ custno: p.payer, name: p.custName || name, market: g.market, resp: g.resp, agent: g.agent, usedILS: p.usedILS,
      creditDays: p.creditDays, sales3m: p.sales3m, hasMmd: p.hasMmd });
    g.payers.add(p.payer);
    if (!isChain) g.creditDays = p.creditDays;
    for (const f of ['limitILS', 'usedILS', 'sales3m', 'b30', 'b60', 'b90', 'bOld']) g[f] += p[f];
  }
  // מס' לקוח = מספר לקוח משלם; у сети с несколькими плательщиками — "N משלמים" (Дан 2026-10-12)
  const entities = [...grouped.values()].map(({ payers, ...g }) => ({
    ...g, payerList: [...payers],
    custno: payers.size === 1 ? [...payers][0] : `${payers.size} משלמים`,
    util: g.limitILS > 0 ? g.usedILS / g.limitILS : null,
    creditDays: g.market === 'רשתות' ? chainDso.get(g.name) ?? null : g.creditDays ?? null,
    overdue: g.b30 + g.b60 + g.b90 + g.bOld,
  }));
  entities.byPayer = byPayer;
  return entities;
}

// Брендинг — та же executive-палитра, что была (навигация, золото, пергамент) + лого DILER B.M.D.
const NAVY = '#1C3D6B';
const GOLD = '#B8863B';
const RED = '#B00020';
const INK = '#2A2620';
const MUTED = '#6B7280';
const PAPER = '#FAF7F2';
const LINE = '#E5E0D8';
const ZEBRA = '#FAFAF8';

const fmtILS = n => '₪' + Math.round(n).toLocaleString('en-US');
// Крупные суммы в карточках шапки: ₪6.98M / ₪540K
const fmtShort = n => n < 0 ? '−' + fmtShort(-n) : n >= 1e6 ? `₪${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `₪${Math.round(n / 1e3)}K` : fmtILS(n);

// Карточки шапки (Дан 27.10): суммы для топ-менеджмента вместо количества клиентов.
// Считаются по ВСЕМ клиентам охвата письма (полный / менеджер / אחראי), не только по попавшим в части.
// frozenList — плательщики с облиго без продаж 3+ мес. (второй список DSO): «старые долги».
// Суммы 1 в 1 как итоги PBI (Дан 27.10): без обнуления минусов — переплата одного клиента уменьшает итог, как в системе.
function kpiValues(list, frozenList) {
  const sum = (l, f, pred = () => true) => l.filter(pred).reduce((s, e) => s + f(e), 0);
  const chain = e => e.market === 'רשתות', priv = e => e.market !== 'רשתות';
  const over = e => (e.util !== null && e.util >= 1 ? e.usedILS - e.limitILS : 0);
  const debt = e => Math.max(0, e.overdue);
  return {
    used: sum(list, e => e.usedILS), usedPriv: sum(list, e => e.usedILS, priv), usedChain: sum(list, e => e.usedILS, chain),
    limit: sum(list, e => e.limitILS),
    late: sum(list, e => e.overdue), latePriv: sum(list, e => e.overdue, priv), lateChain: sum(list, e => e.overdue, chain),
    // без переплат (Дан 27.10): только строки с плюсом — как סה"כ части פיגור; Кешет −4.9M не гасит чужой долг
    lateDebt: sum(list, debt), lateDebtPriv: sum(list, debt, priv), lateDebtChain: sum(list, debt, chain),
    old: sum(list, e => e.bOld),
    over: sum(list, over), overPriv: sum(list, over, priv), overChain: sum(list, over, chain),
    frozen: sum(frozenList, e => e.usedILS), frozenPriv: sum(frozenList, e => e.usedILS, priv), frozenChain: sum(frozenList, e => e.usedILS, chain),
  };
}

// История сумм по охвату (полный / m:<группы> / o:<אחראי>) — для динамики к прошлому отчёту и мини-графика.
// Пишется при боевой рассылке и --save-kpi (точка отсчёта); тест/--dry-run не пишут.
const KPI_HISTORY = process.env.OBLIGO_KPI_HISTORY || (STATE ? path.join(path.dirname(STATE), 'obligo-kpi-history.json') : '');
const KPI_KEEP = 12;
const isoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
function loadKpiHistory() {
  if (!KPI_HISTORY || !fs.existsSync(KPI_HISTORY)) return {};
  try { return JSON.parse(fs.readFileSync(KPI_HISTORY, 'utf8')); } catch (e) { console.error('kpi history not read:', e.message); return {}; }
}
function saveKpiHistory(hist, scopes) {
  if (!KPI_HISTORY) return;
  const date = isoToday();
  for (const { key, vals } of scopes) {
    const list = (hist[key] || []).filter(p => p.date !== date); // повторный запуск в тот же день — заменяет точку
    hist[key] = [...list, { date, vals }].slice(-KPI_KEEP);
  }
  try { fs.writeFileSync(KPI_HISTORY, JSON.stringify(hist)); } catch (e) { console.error('kpi history not saved:', e.message); }
}

// v — текущие суммы, past — прошлые точки охвата (без сегодняшней), последняя = «прошлый отчёт»
function kpiCards(v, past) {
  const prev = past.length ? past[past.length - 1] : null;
  // строки подписи: [текст, сумма|null] — сумму рендерер изолирует от RTL (ltr() в письме, <bdi> на странице)
  const split = (p, c) => [['שוק פרטי', p], ['רשתות', c]];
  // один цвет на все карточки — без «салата» (Дан 27.10): золотая полоса, синяя сумма
  const card = (key, label, sub) => ({
    key, label, value: v[key], sub, bar: GOLD, color: NAVY,
    prev: prev && prev.vals[key] !== undefined ? { date: prev.date, value: prev.vals[key] } : null,
    series: [...past.map(p => p.vals[key]).filter(x => x !== undefined), v[key]].slice(-8),
  });
  // Главная — как итоговая строка PBI: מסגרת (אובליגו רב חברתי) и % ניצול (Дан 27.10).
  // Карточка «מעל 90 יום» и подписи «% מניצול» убраны (Дан 27.10) — под карточками разбивка שוק פרטי / רשתות.
  const util = v.limit > 0 ? `${Math.round((v.used / v.limit) * 100)}%` : null;
  // stats — отдельными ячейками (не строкой через ' · ': почтовик переставлял суммы); дни — только полный охват
  const hero = card('used', 'ניצול אובליגו כולל', split(v.usedPriv, v.usedChain));
  hero.stats = [['מסגרת אובליגו', fmtShort(v.limit)], ...(util ? [['% ניצול', util]] : []),
    ...(v.dso != null ? [['ימי אשראי ממוצע', String(Math.round(v.dso))]] : [])];
  return {
    hero,
    risks: [
      // нетто как в PBI + отдельная карточка без переплат (Дан 27.10: у сетей нетто −1.4M скрывает реальный долг)
      card('late', 'חוב בפיגור', split(v.latePriv, v.lateChain)),
      card('lateDebt', 'חוב בפיגור ללא יתרות זכות', split(v.lateDebtPriv, v.lateDebtChain)),
      card('over', 'חריגה ממסגרת', split(v.overPriv, v.overChain)),
      // «старые долги» (Дан 27.10): короткий заголовок, пояснение — первой строкой подписи
      card('frozen', 'חובות ישנים', [['לקוח לא קנה מעל 3 חודשים', null], ...split(v.frozenPriv, v.frozenChain)]),
    ],
  };
}
// Пары «подпись сумма» — каждая своей строкой: через ' · ' в одной строке почтовик Дана переставлял суммы местами (27.10)
const kpiSub = (k, iso) => k.sub.map(([t, v]) => (v === null ? t : `${t} ${iso(fmtShort(v))}`)).join('<br>');
// Динамика к прошлому отчёту: ▲ рост / ▼ снижение, серым — без красного/зелёного (Дан 27.10 «салат»)
function kpiDelta(k, iso) {
  if (!k.prev) return { text: 'השוואה לשבוע שעבר — מהדוח הבא', color: MUTED };
  const d = k.value - k.prev.value;
  if (Math.abs(d) < 1) return { text: 'ללא שינוי', color: MUTED };
  const rel = k.prev.value > 0 ? ` (${d > 0 ? '+' : '−'}${Math.abs(Math.round((d / k.prev.value) * 100))}%)` : '';
  return { text: `${d > 0 ? '▲' : '▼'} ${iso(fmtShort(Math.abs(d)) + rel)}`, color: MUTED };
}
// Дата сравнения — один раз в подзаголовке шапки, не в каждой карточке (иначе строка переносится)
const kpiCompareNote = (kp, iso) => { const p = kp && kp.hero.prev; return p ? ` &middot; שינוי לעומת ${iso(p.date.split('-').reverse().slice(0, 2).join('.'))}` : ''; };
// Мини-график недель (с 3 точек): столбики-ячейки таблицы — рисуются и в Outlook. Время слева направо, последняя — цветом карточки.
const SPARK_MIN = 3, SPARK_H = 22;
const sparkBars = series => { const max = Math.max(...series) || 1; return series.map(x => Math.max(2, Math.round((x / max) * SPARK_H))); };
function sparkEmail(series, color) {
  if (series.length < SPARK_MIN) return '';
  const hs = sparkBars(series);
  return `<table role="presentation" cellpadding="0" cellspacing="0" dir="ltr" align="center" style="margin:6px auto 0"><tr>${hs.map((h, i) => `<td valign="bottom" style="padding:0 1px;vertical-align:bottom"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="7" height="${h}" bgcolor="${i === hs.length - 1 ? color : '#D5DBE4'}" style="width:7px;height:${h}px;background-color:${i === hs.length - 1 ? color : '#D5DBE4'};font-size:0;line-height:0">&nbsp;</td></tr></table></td>`).join('')}</tr></table>`;
}
function sparkPage(series, color) {
  if (series.length < SPARK_MIN) return '';
  const hs = sparkBars(series);
  return `<span class="sp">${hs.map((h, i) => `<i style="height:${h}px${i === hs.length - 1 ? `;background:${color}` : ''}"></i>`).join('')}</span>`;
}
// Outlook игнорирует CSS direction — явные LRE…PDF держат порядок "₪1,234" в ивритском тексте
const ltr = s => `&#x202A;${s}&#x202C;`;

// Порядок = нумерация частей в письме/странице/Excel (Дан 27.10: חורגים первыми, потом מתקרבים)
const PARTS = [
  {
    id: 'over', color: RED, chip: '#E0475B', tint: '#FBEAEC', sheet: 'חורגים מעל 100%', label: `חורגים מעל ${ltr('100%')}`,
    title: 'לקוחות שחורגים ממסגרת האשראי המאושרת',
    rule: 'ניצול 100% ומעלה ממסגרת האובליגו',
    pick: e => e.util !== null && e.util >= 1,
    sort: (a, b) => b.util - a.util,
    extra: { head: 'יתרה מעבר למסגרת', val: e => e.usedILS - e.limitILS },
  },
  {
    id: 'near', color: GOLD, chip: GOLD, tint: '#F7EFDF', sheet: 'מתקרבים 85%-100%', label: `מתקרבים ${ltr('85%–100%')}`,
    title: 'לקוחות שמתקרבים לניצול מלא של המסגרת המאושרת',
    rule: 'ניצול 85% ומעלה ועד 100% ממסגרת האובליגו',
    pick: e => e.util !== null && e.util >= NEAR && e.util < 1,
    sort: (a, b) => b.util - a.util,
    extra: { head: 'יתרה לניצול', val: e => e.limitILS - e.usedILS },
  },
  {
    id: 'late', color: NAVY, chip: '#8FB3E0', tint: '#E8EEF6', sheet: 'חוב בפיגור', label: 'חוב בפיגור',
    title: 'לקוחות שחורגים מהסכם תנאי התשלום',
    rule: 'יתרת חוב בפיגור לפי ימי פיגור בפריוריטי, ללא קשר למסגרת אובליגו',
    pick: e => e.overdue >= 1,
    sort: (a, b) => b.overdue - a.overdue,
  },
];

// Колонки сумм — фиксированной ширины (иначе в каждом блоке своя auto-ширина и цифры "гуляют",
// пользователь 2026-09-10).
function amountColumns(part) {
  if (part.id === 'late') {
    return [
      ['1-30', e => e.b30, 70], ['31-60', e => e.b60, 70], ['61-90', e => e.b90, 70], ['מעל 90', e => e.bOld, 70],
      ['סה"כ בפיגור', e => e.overdue, 84, true],
    ];
  }
  return [
    ['אובליגו', e => e.limitILS, 84], ['ניצול אובליגו', e => e.usedILS, 84],
    [part.extra.head, part.extra.val, 84, true],
  ];
}

function diffHtml(diff) {
  if (!diff) return '';
  const CAP = 15;
  const list = (rows, sign, color) => rows.length
    ? rows.slice(0, CAP).map(r => `<div style="padding:2px 0;font-size:12px;color:${INK}"><b style="color:${color}">${sign}</b> ${esc(r.name)}${r.custno ? ` (${esc(r.custno)})` : ''}</div>`).join('')
      + (rows.length > CAP ? `<div style="padding:2px 0;font-size:12px;color:${MUTED}">ועוד ${rows.length - CAP}</div>` : '')
    : `<div style="padding:2px 0;font-size:12px;color:${MUTED}">אין</div>`;
  return `<tr><td dir="rtl" style="padding:12px 24px 0;text-align:right">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl"><tr>
      <td bgcolor="#F7F9FC" style="background-color:#F7F9FC;border:1px solid ${LINE};border-radius:10px;padding:10px 16px;text-align:right;font-family:Arial,sans-serif">
        <div style="font-size:13px;font-weight:900;color:${NAVY}">שינויים ברשתות מהדוח הקודם (${diff.date})</div>
        <div style="padding-top:6px;font-size:12px;font-weight:bold;color:#b71c1c">נוספו (${diff.added.length}):</div>
        ${list(diff.added, '+', '#b71c1c')}
        <div style="padding-top:6px;font-size:12px;font-weight:bold;color:#2e7d32">יצאו (${diff.removed.length}):</div>
        ${list(diff.removed, '−', '#2e7d32')}
      </td>
    </tr></table>
  </td></tr>`;
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const groupKeyOrder = k => k === 'לא מוגדר' || k === '—';
// Итог части — по жирной колонке (יתרה לניצול / מעבר למסגרת / סה"כ בפיגור)
const partTotal = (part, rows) => { const f = amountColumns(part).find(a => a[3])[1]; return rows.reduce((s, r) => s + f(r), 0); };

// ── Личная страница /p/<hex>: полный отчёт без Парето, раскрывающиеся разделы, поиск (Дан 2026-10-13).
// Почтовики режут JS и <details> (Outlook/Gmail) — поэтому интерактив только здесь, письмо — сводка + кнопка.
function pageGroups(part, rows, field, isChain) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r[field])) by.set(r[field], []); by.get(r[field]).push(r); }
  const keys = [...by.keys()].sort((a, b) => (groupKeyOrder(a) - groupKeyOrder(b)) || a.localeCompare(b, 'he'));
  // главная сумма и % — сразу после имени: на телефоне остальные колонки уходят под горизонтальный скролл
  const money = ([h, f, , strong]) => [h, e => { const v = f(e); return `<td class="m${strong ? ' s' : ''}">${v ? fmtILS(v) : '—'}</td>`; }];
  const all = amountColumns(part);
  const pct = part.id === 'late' ? [] : [['%', e => `<td><span class="pc ${e.util >= 1 ? 'r' : 'g'}">${Math.round(e.util * 100)}%</span></td>`]];
  const days = ['מספר ימי האשראי הממוצע', e => `<td>${e.creditDays === null ? '—' : Math.round(e.creditDays)}</td>`];
  const cols = [...all.filter(c => c[3]).map(money), ...pct, days, ...all.filter(c => !c[3]).map(money)];
  const head = `<tr><th>מס' לקוח</th><th>${isChain ? 'רשת' : 'שם'}</th>${cols.map(([h]) => `<th${h === days[0] ? ' class="w"' : ''}>${esc(h)}</th>`).join('')}</tr>`;
  const row = e => `<tr data-q="${esc(`${e.name} ${e.custno} ${e[field]}`.toLowerCase())}"><td class="c">${esc(e.custno)}</td><td class="n">${esc(e.name)}</td>`
    + cols.map(([, td]) => td(e)).join('') + '</tr>';
  return keys.map(k => {
    const list = by.get(k);
    return `<details class="grp"><summary><b>${esc(k)}</b><span class="cnt">${list.length} ${list.length === 1 ? 'לקוח' : 'לקוחות'} &middot; <bdi>${fmtILS(partTotal(part, list))}</bdi></span></summary>
      <div class="tw"><table>${head}${list.map(row).join('')}</table></div></details>`;
  }).join('');
}

function pageDiff(diff) {
  if (!diff || !(diff.added.length + diff.removed.length)) return '';
  const li = (rows, sign) => rows.map(r => `<li>${sign} ${esc(r.name)}${r.custno ? ` (${esc(r.custno)})` : ''}</li>`).join('') || '<li class="mu">אין</li>';
  return `<div class="diff"><b>שינויים ברשתות מהדוח הקודם (${esc(diff.date)})</b>
    <div class="add">נוספו (${diff.added.length}):</div><ul>${li(diff.added, '+')}</ul>
    <div class="rem">יצאו (${diff.removed.length}):</div><ul>${li(diff.removed, '−')}</ul></div>`;
}

// Раздел DSO (Дан 25.10): топ по [מספר ימי האשראי הממוצע] общим списком, без разбивки по фирмам.
// Список — parts.dso (у менеджера/אחראי — топ из его клиентов). Один details.grp — чтобы работал поиск страницы.
const DSO_TOP = 50; // Дан 25.10
// Пометка «חדש» у раздела DSO — до 12.11 включительно (рассылки 29.10, 05.11, 12.11), потом исчезает сама
const DSO_NEW_UNTIL = '2026-11-12';
const dsoIsNew = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }) <= DSO_NEW_UNTIL;
const DSO_FROZEN_TITLE = 'חובות ישנים — לקוחות שלא קנו מעל 3 חודשים (לפי גובה החוב)';
const DSO_LINE = 'DSO — מספר ימי האשראי הממוצע: כמה ימים בממוצע עובר עד שהלקוח משלם';
function pageDso(list, frozen, n) {
  if (!(list && list.length) && !(frozen && frozen.length)) return '';
  const tr = (e, days) => `<tr data-q="${esc(`${e.name} ${e.custno} ${e.agent} ${e.resp}`.toLowerCase())}"><td class="c">${esc(e.custno)}</td><td class="n">${esc(e.name)}</td>`
    + (days ? `<td><b>${Math.round(e.creditDays)}</b></td>` : '') + `<td class="m">${fmtILS(e.usedILS)}</td><td>${esc(e.market)}</td><td>${esc(e.market === 'רשתות' ? e.resp : e.agent)}</td></tr>`;
  const grp = (title, rows, days, open) => rows && rows.length ? `<details class="grp"${open ? ' open' : ''}><summary><b>${title}</b><span class="cnt">${rows.length} לקוחות</span></summary><div class="tw"><table>
      <tr><th>מס' לקוח משלם</th><th>שם</th>${days ? '<th class="w">מספר ימי האשראי הממוצע</th>' : ''}<th>ניצול אובליגו</th><th>שוק</th><th>אחראי / סוכן</th></tr>${rows.map(e => tr(e, days)).join('')}</table></div></details>` : '';
  return `<details class="part${dsoIsNew() ? ' new' : ''}" id="dso" style="--c:${NAVY}"><summary>
      <span class="t">${n}. לקוחות עם DSO הגבוה ביותר</span>${dsoIsNew() ? '<span class="nb">🆕 חדש</span>' : ''}
      <span class="meta">${esc(DSO_LINE)}</span></summary>
      <div class="body">${grp(`TOP ${DSO_TOP} — עם מכירות ב-3 החודשים האחרונים`, list, true, true)}${grp(DSO_FROZEN_TITLE, frozen, false, false)}</div></details>`;
}

// Без внешних ресурсов; CSP meta сужает глобальную CSP сервера для этой страницы (общий роут /p не трогаем).
// <title> нейтральный — виден в истории браузера.
function buildPageHtml(parts, workDays, scope, expires) {
  const date = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' });
  const sections = parts.map(({ part, rows, diff }, i) => {
    const chains = rows.filter(r => r.market === 'רשתות'), priv = rows.filter(r => r.market !== 'רשתות');
    const sub = (t, list, field, isChain) => list.length ? `<h3>${t} (${list.length})</h3>${pageGroups(part, list, field, isChain)}` : '';
    return `<details class="part" id="${part.id}" style="--c:${part.color}"><summary>
      <span class="t">${i + 1}. ${esc(part.title)}</span>
      <span class="meta">${esc(part.rule)} &middot; ${rows.length} לקוחות &middot; סה"כ ${fmtILS(partTotal(part, rows))}</span></summary>
      <div class="body">${pageDiff(diff)}${rows.length ? sub('רשתות', chains, 'resp', true) + sub('שוק פרטי', priv, 'agent', false) : '<p class="mu">אין לקוחות בקטגוריה זו.</p>'}</div></details>`;
  }).join('');
  const bdi = s => `<bdi>${s}</bdi>`;
  const chip = (k, cls) => { const dl = kpiDelta(k, bdi); return `<div class="chip${cls}" style="--c:${k.bar}"><span class="l">${k.label}</span><b style="color:${k.color}">${bdi(fmtShort(k.value))}</b><span class="dl" style="color:${dl.color}">${dl.text}</span>${sparkPage(k.series, k.color)}${k.stats ? `<span class="st">${k.stats.map(([l, x]) => `<span><i>${l}</i><b>${bdi(x)}</b></span>`).join('')}</span>` : ''}<span class="s">${kpiSub(k, bdi)}</span></div>`; };
  const chips = parts.kpi ? chip(parts.kpi.hero, ' hero') + parts.kpi.risks.map(k => chip(k, '')).join('') : '';
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'">
<title>דוח שבועי</title>
<style>
*{box-sizing:border-box}body{margin:0;background:${PAPER};font-family:Arial,sans-serif;color:${INK}}
header{background:${NAVY};color:#fff;text-align:center;padding:22px 16px 18px}
header h1{margin:0;font-size:22px}header .d{color:${GOLD};font-size:12px;margin-top:6px}
.chips{display:grid;grid-template-columns:repeat(2,minmax(0,320px));gap:14px;justify-content:center;margin:20px auto 22px;max-width:820px}
.chip{background:#fff;border-top:5px solid var(--c);padding:12px 8px;display:flex;flex-direction:column;align-items:center;gap:3px}
.chip.hero{grid-column:1/-1}.chip.hero>b{font-size:36px}
.chip .st{display:flex;gap:10px;justify-content:center;margin:6px 0 2px;flex-wrap:wrap}.chip .st>span{display:flex;flex-direction:column;align-items:center;min-width:92px;padding:4px 10px}.chip .st i{font-style:normal;font-size:11px;color:${MUTED}}.chip .st b{font-size:18px;color:${NAVY}}
.chip .l{font-size:12px;font-weight:bold;color:${INK}}.chip b{font-size:26px;line-height:1.15}.chip .s{font-size:11px;color:${MUTED};line-height:1.35}
.chip .dl{font-size:11px;font-weight:bold}
.sp{display:flex;align-items:flex-end;gap:2px;height:${SPARK_H}px;margin:4px 0 2px;direction:ltr}.sp i{display:block;width:7px;background:#D5DBE4;border-radius:1px}
@media(max-width:600px){.chips{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.chip b{font-size:22px}.chip.hero>b{font-size:30px}}
main{max-width:960px;margin:0 auto;padding:12px 16px 48px}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 4px}
.tools input{flex:1 1 100%;padding:10px 12px;font-size:15px;border:1px solid ${LINE};border-radius:8px}
.tools button{flex:1;padding:10px 14px;font-size:14px;border:1px solid ${LINE};border-radius:8px;background:#fff;cursor:pointer}
.intro{font-size:14px;line-height:1.6;margin:8px 0}
details.part{background:#fff;border:1px solid ${LINE};border-right:5px solid var(--c);border-radius:8px;margin:14px 0}
details.part>summary{padding:14px 16px;cursor:pointer;list-style-position:inside}
details.part>summary .t{font-size:17px;font-weight:bold;color:var(--c)}
details.part>summary .meta{display:block;font-size:12px;color:${MUTED};margin-top:4px}
.body{padding:0 12px 12px}
details.part.new{box-shadow:0 0 0 2px ${GOLD}}.nb{display:inline-block;margin-right:8px;padding:2px 9px;border-radius:12px;background:${GOLD};color:#fff;font-size:12px;font-weight:bold;vertical-align:middle}
h3{font-size:14px;margin:16px 4px 6px}
details.grp{border:1px solid ${LINE};border-radius:6px;margin:6px 0}
details.grp>summary{padding:9px 12px;cursor:pointer;color:${NAVY};font-size:13px}
details.grp>summary .cnt{color:${MUTED};font-weight:normal;margin-right:10px}
.tw{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}
th{font-size:11px;color:${MUTED};font-weight:normal;border-bottom:2px solid ${NAVY};padding:6px 8px;text-align:right;white-space:nowrap}
th.w{white-space:normal;width:52px;min-width:52px;line-height:1.25}
td{padding:7px 8px;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap}
tr:nth-child(odd) td{background:${ZEBRA}}
td.n{font-weight:bold;white-space:normal;min-width:150px}td.c{color:${MUTED};font-size:12px}
td.m{direction:ltr;unicode-bidi:isolate;color:${MUTED};font-size:12px}td.s{font-weight:bold;color:var(--c)}
.pc{display:inline-block;min-width:44px;text-align:center;padding:3px 7px;border-radius:20px;font-weight:bold;font-size:12px;direction:ltr}
.pc.r{background:#FBEAEC;color:${RED}}.pc.g{background:#F7EFDF;color:${GOLD}}
.diff{background:#F7F9FC;border:1px solid ${LINE};border-radius:8px;padding:10px 14px;margin:4px 0 8px;font-size:13px}
.diff ul{margin:2px 0;padding-right:18px}.add{color:#b71c1c;margin-top:6px;font-weight:bold}.rem{color:#2e7d32;margin-top:6px;font-weight:bold}
.mu{color:${MUTED}}[hidden]{display:none!important}
@media(max-width:600px){main{padding:8px 10px 40px}.body{padding:0 6px 10px}th,td{padding:6px 5px}table{font-size:12px}td.n{min-width:110px}}
footer{font-size:12px;color:${MUTED};line-height:1.7;margin-top:24px}
</style></head><body>
<header><h1>דוח אובליגו ותנאי תשלום</h1><div class="d">דוח שבועי &middot; ${date}${scope ? ` &middot; ${scope}` : ''}${kpiCompareNote(parts.kpi, s => `<bdi>${s}</bdi>`)}</div>
<div class="chips">${chips}</div></header>
<main>
<p class="intro">לחצו על חלק כדי לפתוח אותו, ובתוכו על אחראי / סוכן. החיפוש מוצא לקוח לפי שם, מספר או סוכן בכל החלקים.</p>
<div class="tools"><input id="q" type="search" placeholder="חיפוש לקוח / מספר / סוכן" autocomplete="off"><button id="all">פתח הכל</button><button id="none">סגור הכל</button></div>
${sections}
${pageDso(parts.dso, parts.dsoFrozen, parts.length + 1)}
<footer><b>סודי — קישור אישי, נא לא להעביר. בתוקף עד ${expires}.</b><br>כל לקוח מדווח מחדש בכל דוח שבועי, כל עוד הוא עומד בתנאי החלק. סכומי הפיגור — לפי ימי פיגור בפריוריטי, כמו ב-Power BI: יתרה שלילית בעמודה היא תשלום או זיכוי שעוד לא שויכו לחשבונית; סה"כ בפיגור — היתרה נטו.<br>הערות והצעות — לדן סברדליק, <!--email_off-->d.sverdlik@DilerBMD.com<!--/email_off-->.</footer>
</main>
<script>
(function(){
var parts=[].slice.call(document.querySelectorAll('details.part')),grps=[].slice.call(document.querySelectorAll('details.grp'));
var track=function(){};
function setAll(o){parts.concat(grps).forEach(function(d){d.open=o})}
document.getElementById('all').onclick=function(){setAll(true);track('open-all')};
document.getElementById('none').onclick=function(){setAll(false)};
// раскрытия считаем по клику человека — toggle стреляет и от поиска / "פתח הכל"
parts.forEach(function(p){p.querySelector('summary').addEventListener('click',function(){if(!p.open)track('o-'+p.id)})});
grps.forEach(function(g){g.querySelector('summary').addEventListener('click',function(){if(!g.open)track('grp')})});
var searched=false;
document.getElementById('q').addEventListener('input',function(){
  var q=this.value.trim().toLowerCase();
  if(q&&!searched){searched=true;track('search')}
  grps.forEach(function(g){var hit=0;[].forEach.call(g.querySelectorAll('tr[data-q]'),function(tr){var m=!q||tr.dataset.q.indexOf(q)>-1;tr.hidden=!m;hit+=m});g.hidden=!hit;g.open=!!q&&hit>0});
  parts.forEach(function(p){var any=!q||p.querySelector('details.grp:not([hidden])');p.hidden=!any;p.open=!!q&&!!any;
    [].forEach.call(p.querySelectorAll('h3'),function(h){var n=h.nextElementSibling,vis=false;while(n&&n.tagName!=='H3'){if(!n.hidden)vis=true;n=n.nextElementSibling}h.hidden=!vis})});
});
// трекинг (как в yarych-report): секунды по частям + раскрытия — только по личной ссылке /p/<hex>
(function(){
  if(!/^\\/p\\/[0-9a-f]{48}$/.test(location.pathname)||!navigator.sendBeacon)return;
  var url=location.pathname+'/ev',sid=Math.random().toString(36).slice(2,12),acc={},n=0;
  function send(extra){var b={sid:sid,w:window.innerWidth,d:acc};for(var k in extra)b[k]=extra[k];navigator.sendBeacon(url,new Blob([JSON.stringify(b)],{type:'application/json'}));acc={};n=0}
  track=function(k){acc[k]=(acc[k]||0)+1;send({})};
  send({open:true});
  setInterval(function(){if(document.visibilityState!=='visible')return;var y=window.innerHeight*.45;
    for(var i=0;i<parts.length;i++){var r=parts[i].getBoundingClientRect();if(parts[i].open&&r.top<=y&&r.bottom>y){var k=parts[i].id;acc[k]=(acc[k]||0)+1;n++;break}}
    if(n>=15)send({})},1000);
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'&&n)send({})});
  window.addEventListener('pagehide',function(){if(n)send({})});
})();
})();
</script></body></html>`;
}

// ── Письмо: сводка по частям (кол-во, итог, נוספו/יצאו по сетям) + кнопка на личную страницу.
// Полные списки в теле не помещаются: Gmail обрезает HTML > ~102KB (было 149KB уже с Парето).
function emailPartHtml(part, rows, diff, num) {
  return `
  <tr><td dir="rtl" style="padding:24px 24px 0;text-align:right">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl"><tr>
      <td width="5" bgcolor="${part.color}" style="width:5px;background-color:${part.color};font-size:0;line-height:0">&nbsp;</td>
      <td dir="rtl" style="padding:2px 12px 2px 0;text-align:right">
        <div style="font-family:Arial,sans-serif;font-size:17px;color:${part.color};font-weight:bold;line-height:24px">${num}. ${part.title}</div>
        <div style="font-family:Arial,sans-serif;font-size:12px;color:${MUTED};line-height:18px">${part.rule} &middot; ${rows.length} ${rows.length === 1 ? 'לקוח' : 'לקוחות'} &middot; סה"כ ${ltr(fmtILS(partTotal(part, rows)))}</div>
      </td>
    </tr></table>
  </td></tr>
  ${diffHtml(diff)}`;
}

// Строка-сводка раздела DSO в письме (сам список — на странице и в листе DSO)
function emailDsoHtml(list, frozenN, num) {
  if (!list || !list.length) return '';
  return `
  <tr><td dir="rtl" style="padding:24px 24px 0;text-align:right">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl"${dsoIsNew() ? ' bgcolor="#F7EFDF" style="background-color:#F7EFDF"' : ''}><tr>
      <td width="5" bgcolor="${NAVY}" style="width:5px;background-color:${NAVY};font-size:0;line-height:0">&nbsp;</td>
      <td dir="rtl" style="padding:${dsoIsNew() ? '10px 12px 10px 0' : '2px 12px 2px 0'};text-align:right">
        <div style="font-family:Arial,sans-serif;font-size:17px;color:${NAVY};font-weight:bold;line-height:24px">${num}. לקוחות עם DSO הגבוה ביותר${dsoIsNew() ? `&nbsp;<span style="background-color:${GOLD};color:#ffffff;font-size:12px;padding:2px 8px">🆕 חדש</span>` : ''}</div>
        <div style="font-family:Arial,sans-serif;font-size:12px;color:${MUTED};line-height:18px">${esc(DSO_LINE)}<br>${list.length} הלקוחות עם ה-DSO הגבוה ביותר (קנו ב-3 החודשים האחרונים)${frozenN ? ` &middot; ועוד ${frozenN} חובות ישנים (לא קנו מעל 3 חודשים) — ברשימה נפרדת` : ''}</div>
      </td>
    </tr></table>
  </td></tr>`;
}

function buttonHtml(link) {
  const label = 'לדוח המלא — כל הלקוחות';
  return `<tr><td align="center" style="padding:28px 24px 0">
    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${link}" style="height:50px;v-text-anchor:middle;width:320px" arcsize="16%" stroke="f" fillcolor="${NAVY}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:17px;font-weight:bold">${label}</center></v:roundrect><![endif]-->
    <!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${NAVY}" style="background-color:${NAVY};border-radius:8px;padding:15px 30px">
      <a href="${link}" target="_blank" style="font-family:Arial,sans-serif;display:block;font-size:17px;font-weight:bold;color:#ffffff !important;text-decoration:none"><span style="color:#ffffff">${label}&nbsp;&nbsp;&larr;</span></a>
    </td></tr></table><!--<![endif]-->
    <div style="padding-top:8px;font-family:Arial,sans-serif;font-size:11px;color:${MUTED}" dir="rtl">קישור אישי — נא לא להעביר. כל הלקוחות גם בקובץ האקסל המצורף.</div>
  </td></tr>`;
}

function buildEmailHtml(parts, workDays, greetName, scope, link) {
  const greeting = greetName ? `שלום ${greetName},` : 'שלום,';
  const n = parts.length + (parts.dso && parts.dso.length ? 1 : 0);
  const intro = `דוח האובליגו השבועי${scope ? ` — ${scope}` : ''}. למטה סיכום ${n} החלקים; הרשימה המלאה של כל הלקוחות — בקישור האישי ובקובץ האקסל המצורף (${n} גיליונות).`;
  // Outlook (Word-движок) не рисует border/radius/margin у div — плашки только таблицами:
  // цветная полоска отдельной строкой с bgcolor, отступы — padding ячеек (тест 12.10 в Outlook развалился).
  // Карточки риска — пустыми строками до одной высоты: в письме это отдельные таблицы, сами не выравниваются (27.10).
  // Карточки сумм (Дан 27.10) — плоские, как до «выпуклых»: без теней/скруглений/полос-теней (рябило), сеткой 2×2.
  const F = 'font-family:Arial,sans-serif;';
  const cell = (k, w, big, lines = 0) => {
    const dl = kpiDelta(k, ltr);
    return `<table role="presentation" width="${w}" cellpadding="0" cellspacing="0" style="width:${w}px">
          <tr><td height="5" bgcolor="${k.bar}" style="height:5px;background-color:${k.bar};font-size:0;line-height:0">&nbsp;</td></tr>
          <tr><td bgcolor="#ffffff" align="center" dir="rtl" style="background-color:#ffffff;padding:12px 6px 2px;text-align:center;${F}font-size:12px;font-weight:bold;color:${INK};line-height:16px">${k.label}</td></tr>
          <tr><td bgcolor="#ffffff" align="center" style="background-color:#ffffff;padding:2px 6px 0;text-align:center;${F}font-size:${big ? 34 : 24}px;font-weight:900;color:${k.color};line-height:${big ? 40 : 30}px">${ltr(fmtShort(k.value))}</td></tr>
          <tr><td bgcolor="#ffffff" align="center" dir="rtl" style="background-color:#ffffff;padding:3px 6px 0;text-align:center;${F}font-size:11px;font-weight:bold;color:${dl.color};line-height:15px">${dl.text}</td></tr>
          <tr><td bgcolor="#ffffff" align="center" style="background-color:#ffffff;padding:0 6px">${sparkEmail(k.series, k.color)}</td></tr>
          ${k.stats ? `<tr><td bgcolor="#ffffff" align="center" style="background-color:#ffffff;padding:8px 6px 2px"><table role="presentation" cellpadding="0" cellspacing="0" dir="rtl" align="center"><tr>${k.stats.map(([l, x], i) => `${i ? '<td width="10" style="width:10px;font-size:0">&nbsp;</td>' : ''}<td align="center" style="padding:4px 14px;text-align:center;${F}"><div style="font-size:11px;color:${MUTED};line-height:15px">${l}</div><div style="font-size:18px;font-weight:bold;color:${NAVY};line-height:22px">${ltr(x)}</div></td>`).join('')}</tr></table></td></tr>` : ''}
          <tr><td bgcolor="#ffffff" align="center" dir="rtl" style="background-color:#ffffff;padding:4px 8px 12px;text-align:center;${F}font-size:10px;color:${MUTED};line-height:15px">${kpiSub(k, ltr) + '<br>&nbsp;'.repeat(Math.max(0, lines - k.sub.length))}</td></tr>
        </table>`;
  };
  const kp = parts.kpi;
  const gap = '<td width="14" style="width:14px;font-size:0;line-height:0">&nbsp;</td>';
  const riskRows = risks => {
    const lines = Math.max(2, ...risks.map(x => x.sub.length)), w = 320, rows = [];
    for (let i = 0; i < risks.length; i += 2) rows.push(risks.slice(i, i + 2));
    return rows.map((r, ri) => `${ri ? '<tr><td height="14" style="height:14px;font-size:0;line-height:0">&nbsp;</td></tr>' : ''}<tr><td><table role="presentation" width="654" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:654px;border-collapse:collapse"><tr>${r.map((k, i) => `${i ? gap : ''}<td width="${w}" valign="top" style="width:${w}px">${cell(k, w, false, lines)}</td>`).join('')}</tr></table></td></tr>`).join('');
  };
  const chips = kp ? `<tr><td>${cell(kp.hero, 654, true)}</td></tr>
      <tr><td height="14" style="height:14px;font-size:0;line-height:0">&nbsp;</td></tr>
      ${riskRows(kp.risks)}` : '';
  const date = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' });
  return `<!doctype html>
<html lang="he"><body style="margin:0;padding:28px 16px;background:${PAPER};font-family:Arial,sans-serif">
<table role="presentation" align="center" width="700" cellpadding="0" cellspacing="0" style="width:700px;max-width:700px;margin:0 auto;background:#ffffff;border:1px solid ${LINE}">

  <tr><td bgcolor="${NAVY}" align="center" style="background-color:${NAVY};padding:32px 28px 0;text-align:center">
    <img src="cid:diler-logo-white" width="100" height="100" alt="DILER B.M.D" style="display:block;margin:0 auto" />
  </td></tr>
  <tr><td bgcolor="${NAVY}" align="center" dir="rtl" style="background-color:${NAVY};padding:14px 28px 0;text-align:center;font-family:Arial,sans-serif;font-size:24px;font-weight:900;color:#ffffff">דוח אובליגו ותנאי תשלום</td></tr>
  <tr><td bgcolor="${NAVY}" align="center" dir="rtl" style="background-color:${NAVY};padding:8px 28px 0;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:${GOLD}">דוח שבועי &middot; ${date}${kpiCompareNote(parts.kpi, ltr)}</td></tr>
  <tr><td bgcolor="${NAVY}" style="background-color:${NAVY};padding:20px 23px 0">
    <table role="presentation" width="654" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:654px;border-collapse:collapse">${chips}</table>
  </td></tr>
  <tr><td bgcolor="${NAVY}" height="26" style="background-color:${NAVY};height:26px;font-size:0;line-height:0">&nbsp;</td></tr>

  <tr><td dir="rtl" style="padding:20px 28px 0;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:14px;color:${INK}">${greeting} ${intro}</div>
  </td></tr>

  ${parts.map(({ part, rows, diff }, i) => emailPartHtml(part, rows, diff, i + 1)).join('')}
  ${emailDsoHtml(parts.dso, (parts.dsoFrozen || []).length, parts.length + 1)}
  ${buttonHtml(link)}

  <tr><td style="padding:28px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="1" bgcolor="${LINE}" style="height:1px;background-color:${LINE};font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>
  <tr><td dir="rtl" style="padding:16px 28px 28px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:12px;color:${MUTED};line-height:1.7">
      כל לקוח מדווח מחדש בכל דוח שבועי, כל עוד הוא עומד בתנאי החלק. סכומי הפיגור — לפי ימי פיגור בפריוריטי, כמו ב-Power BI: יתרה שלילית בעמודה היא תשלום או זיכוי שעוד לא שויכו לחשבונית; סה"כ בפיגור — היתרה נטו.<br>
      הערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.
    </div>
  </td></tr>
</table>
</body></html>`;
}

// Excel (Дан 25.10): каждый лист — «умная» таблица Excel со строкой итогов. Лист DSO — две таблицы рядом.
// Дан 26.10: без «салата» — тело таблицы белое без полос, заливка только в шапке (одна, NAVY как в письме).
const XLSX_TAB = { near: 'F79646', over: 'C0504D', late: '4F81BD', dso: '8064A2' }; // только ярлыки листов
const XLSX_TABLE_STYLE = { theme: 'TableStyleLight1', showRowStripes: false };
const XLSX_NAVY = 'FF' + NAVY.slice(1);
// Вторая таблица листа DSO — на тон светлее, чтобы две таблицы рядом не сливались (Дан 27.10)
const XLSX_NAVY_LIGHT = 'FF4A6C9B';
function paintHeader(ws, row, fromCol, n, argb = XLSX_NAVY) {
  for (let c = fromCol; c < fromCol + n; c++) {
    const cell = ws.getCell(row, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  }
}
const TOTAL_LABEL = 'סה"כ';
async function buildXlsx(parts, workDays) {
  const wb = new ExcelJS.Workbook();
  for (const { part, rows } of parts) {
    // Дан 26.10: DSO-колонка только на листе DSO; «% ימי עבודה שנותרו» — не колонкой с одним и тем же
    // числом в каждой строке, а одной строкой над таблицей (та же фраза, что в шапке страницы/письма).
    const late = part.id === 'late';
    const head = late ? 1 : 2; // строка шапки таблицы
    const ws = wb.addWorksheet(part.sheet, { properties: { tabColor: { argb: 'FF' + XLSX_TAB[part.id] } }, views: [{ rightToLeft: true, state: 'frozen', ySplit: head }] });
    const amounts = amountColumns(part);
    const cols = [
      ['שוק', 11, { totalsRowLabel: TOTAL_LABEL }], ['אחראי / סוכן', 20], ["מס' לקוח", 11], ['שם', 36],
      ...amounts.map(([h, f]) => [h, 15, { totalsRowFunction: 'sum', totalsRowResult: rows.reduce((t, e) => t + Math.round(f(e)), 0) }]),
      ...(late ? [['תנאי תשלום', 26], ['סטטוס', 14]] : [['%', 9]]),
    ];
    cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
    const ordered = [...rows.filter(r => r.market === 'רשתות'), ...rows.filter(r => r.market !== 'רשתות')];
    if (!ordered.length) { ws.getCell('A1').value = 'אין לקוחות בקטגוריה זו.'; continue; }
    if (!late) {
      ws.getCell('A1').value = `נותרו ${workDays.left} ימי עבודה עד סוף החודש מתוך ${workDays.total} · ${Math.round(workDays.pct * 100)}% מימי העבודה בחודש`;
      ws.getCell('A1').font = { bold: true };
    }
    ws.addTable({
      name: 'T_' + part.id, ref: 'A' + head, headerRow: true, totalsRow: true, style: XLSX_TABLE_STYLE,
      columns: cols.map(([name, , extra]) => ({ name, filterButton: true, ...extra })),
      rows: ordered.map(e => [
        e.market, e.market === 'רשתות' ? e.resp : e.agent, e.custno || '', e.name,
        ...amounts.map(([, f]) => Math.round(f(e))),
        ...(late ? [e.terms || '', e.status || ''] : [e.util]),
      ]),
    });
    // формат ячеек (включая строку итогов) — после addTable
    paintHeader(ws, head, 1, cols.length);
    for (let r = head + 1; r <= head + ordered.length + 1; r++) {
      amounts.forEach((a, i) => {
        const cell = ws.getCell(r, 5 + i);
        cell.numFmt = '#,##0';
        if (a[3]) cell.font = { bold: true };
      });
      if (!late && r <= head + ordered.length) {
        const cell = ws.getCell(r, cols.length);
        cell.numFmt = '0%';
        cell.font = { bold: true };
      }
    }
  }

  // Лист DSO: две «умные» таблицы рядом — TOP с продажами за 3 месяца (A) и без продаж (H)
  if ((parts.dso && parts.dso.length) || (parts.dsoFrozen && parts.dsoFrozen.length)) {
    const ws = wb.addWorksheet('DSO', { properties: { tabColor: { argb: 'FF' + XLSX_TAB.dso } }, views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });
    [14, 36, 14, 15, 11, 20, 4, 14, 36, 15, 11, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getCell('A1').value = DSO_LINE; ws.getCell('A1').font = { italic: true };
    const owner = e => e.market === 'רשתות' ? e.resp : e.agent;
    const table = (name, col, title, list, days, argb = XLSX_NAVY) => {
      if (!list || !list.length) return;
      const at = n => ws.getCell(n, col);
      at(2).value = title; at(2).font = { bold: true, size: 12, color: { argb } };
      const cols = [["מס' לקוח משלם", { totalsRowLabel: TOTAL_LABEL }], ['שם'], ...(days ? [['מספר ימי האשראי הממוצע']] : []),
        ['ניצול אובליגו', { totalsRowFunction: 'sum', totalsRowResult: list.reduce((t, e) => t + Math.round(e.usedILS), 0) }], ['שוק'], ['אחראי / סוכן']];
      ws.addTable({ name, ref: ws.getCell(3, col).address, headerRow: true, totalsRow: true, style: XLSX_TABLE_STYLE,
        columns: cols.map(([n, extra]) => ({ name: n, filterButton: true, ...extra })),
        rows: list.map(e => [e.custno, e.name, ...(days ? [Math.round(e.creditDays)] : []), Math.round(e.usedILS), e.market, owner(e)]) });
      paintHeader(ws, 3, col, cols.length, argb);
      const usedCol = col + (days ? 3 : 2);
      for (let r = 4; r <= list.length + 4; r++) ws.getCell(r, usedCol).numFmt = '#,##0';
    };
    table('DSO_TOP', 1, `TOP ${DSO_TOP} — עם מכירות ב-3 החודשים האחרונים`, parts.dso, true);
    table('DSO_NO_SALES', 8, DSO_FROZEN_TITLE, parts.dsoFrozen, false, XLSX_NAVY_LIGHT);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Личные ссылки: файлы в /root/private-share (вне публичного репо), отдаёт роут /p/:name в index.js.
// Маппинг кто-какой-hex — obligo-links.json: не <hex>.html, поэтому роут его не отдаёт; по нему отчёт реакции из views.jsonl.
const SHARE_DIR = '/root/private-share', PUBLIC = 'https://columbus-api.sverdlik-apps.site', LINK_DAYS = 14;
const LINKS = path.join(SHARE_DIR, 'obligo-links.json');
// битый файл — падаем, а не начинаем с [] (иначе старые страницы осиротеют и не удалятся)
const loadLinks = () => { try { return JSON.parse(fs.readFileSync(LINKS, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
const saveLinks = links => fs.writeFileSync(LINKS, JSON.stringify(links, null, 1), { mode: 0o600 });
function purgeLinks() {
  const cut = Date.now() - LINK_DAYS * 864e5;
  const links = loadLinks();
  const old = links.filter(l => Date.parse(l.ts) < cut);
  for (const l of old) { try { fs.unlinkSync(path.join(SHARE_DIR, l.hex + '.html')); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  if (old.length) saveLinks(links.filter(l => !old.includes(l)));
  console.log(`ссылки облиго: удалено ${old.length}, активных ${links.length - old.length}`);
}
function publishPage(email, html) {
  const hex = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(path.join(SHARE_DIR, hex + '.html'), html, { mode: 0o600 });
  saveLinks([...loadLinks(), { ts: new Date().toISOString(), email, hex }]);
  return `${PUBLIC}/p/${hex}`;
}
const expiryDate = () => new Date(Date.now() + LINK_DAYS * 864e5).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' });

// Сравнение с прошлой боевой рассылкой — по ключу (сеть: אחראי+название, частник: номер плательщика).
function loadState() {
  if (!STATE || !fs.existsSync(STATE)) return null;
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { console.error('state not read:', e.message); return null; }
}

// Только сети (Дан 2026-10-12): частники в блок נוספו / יצאו не попадают. State хранит всех.
function diffFor(prev, partId, rows) {
  const was = prev?.parts?.[partId];
  if (!Array.isArray(was)) return null;
  const chain = r => r.market === 'רשתות';
  const wasKeys = new Set(was.map(r => r.key));
  const nowKeys = new Set(rows.map(r => r.key));
  return { date: prev.date, added: rows.filter(r => chain(r) && !wasKeys.has(r.key)), removed: was.filter(r => chain(r) && !nowKeys.has(r.key)) };
}

function saveState(parts) {
  if (!STATE) return;
  const date = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' });
  const data = { date, parts: Object.fromEntries(parts.map(({ part, rows }) => [part.id, rows.map(({ key, name, custno, market, agent }) => ({ key, name, custno, market, agent }))])) };
  // сбой записи не должен ронять уже отправленный алярм
  try { fs.writeFileSync(STATE, JSON.stringify(data, null, 1)); } catch (e) { console.error('state not saved:', e.message); }
}

// Кому имя известно — обращение по имени в письме (пользователь 2026-09-10). Кого нет в списке — "שלום,".
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
  'alexey.b@dilerbmd.com': 'אלכסי', // было dilerformula69@gmail.com (Дан 11.10: правильный адрес)
  'a.rusanovski@dilerbmd.com': 'אנטולי', // было dilerformula83@gmail.com (Дан 11.10)
  'natalia.r@dilerbmd.com': 'נטליה', // было dilerformula127@gmail.com (Дан 11.10)
  'svetlana.p@dilerbmd.com': 'סבטלנה', // было dilerformula115@gmail.com (Дан 11.10)
  'vladyslav.h@dilerbmd.com': 'ולדיסלב', // было dilerformula159@gmail.com (Дан 11.10)
  'dilerformula79@gmail.com': 'רומן',
  // менеджеры ICE BDD (как CLIENT_CHANGES_BDD_MANAGERS)
  'timur@dilerbmd.com': 'טימור', // было dilerformula84@gmail.com (Дан 11.10)
  'matvey@dilerbmd.com': 'מטביי', // было dilerformula99@gmail.com (Дан 11.10)
  'dilerformula231@gmail.com': 'שמחה',
};

// Менеджеру команды — только שוק פרטי агентов его קבוצה (пользователь 2026-10-08).
// Агент -> קבוצה из 'משטח' (тот же источник, что client-changes-alert). У агента несколько групп — частая.
async function fetchAgentGroups() {
  const rows = await executeDax(`
    EVALUATE
    SUMMARIZECOLUMNS('משטח'[שם סוכן], 'משטח'[קבוצה], "n", COUNTROWS('משטח'))`);
  const best = new Map();
  for (const r of rows) {
    const agent = fixBiDi(r['משטח[שם סוכן]']);
    const group = String(r['משטח[קבוצה]'] || '').trim();
    if (!agent || !group) continue;
    if (!best.has(agent) || r['[n]'] > best.get(agent).n) best.set(agent, { group, n: r['[n]'] });
  }
  const groupOf = new Map([...best].map(([a, v]) => [a, v.group]));
  // ICE BDD (пользователь 2026-10-08): ICE-агент -> группа BDD из bdd-cache.json живого сервера.
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(process.env.LIVE_DATA_DIR || path.join(__dirname, 'data'), 'bdd-cache.json'), 'utf8'));
    for (const [, c] of cache.clientById) if (c.agentName && c.manager && !groupOf.has(c.agentName)) groupOf.set(c.agentName, c.manager);
  } catch (e) { console.error('[managers] bdd-cache не прочитан, BDD-менеджерам пусто:', e.message); }
  return groupOf;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendReport(resend, recipient, parts, workDays, scope) {
  const greetName = RECIPIENT_NAMES[recipient.toLowerCase()];
  const logoPath = path.join(__dirname, '..', 'docs', 'logo-diler-bmd-white.png');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const attachments = [
    ...(fs.existsSync(logoPath) ? [{ filename: 'logo-white.png', content: fs.readFileSync(logoPath).toString('base64'), contentId: 'diler-logo-white' }] : []),
    { filename: `obligo-${today}.xlsx`, content: (await buildXlsx(parts, workDays)).toString('base64') },
  ];
  const counts = parts.map(p => p.rows.length);
  // страница на каждое письмо своя (новый hex) — до отправки; не записалась — письмо не уходит
  const link = publishPage(recipient, buildPageHtml(parts, workDays, scope, expiryDate()));
  const text = `${greetName ? `שלום ${greetName},` : 'שלום,'} דוח האובליגו השבועי.\n\n`
    + parts.map(({ part, rows }, i) => `${i + 1}. ${part.title}: ${rows.length}`).join('\n')
    + `\n\nהדוח המלא (קישור אישי, בתוקף ${LINK_DAYS} ימים, נא לא להעביר): ${link}\nכל הלקוחות גם בקובץ האקסל המצורף.`
    + '\n\nהערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.';
  const payload = {
    from: `Diler Intelligence <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to: [recipient],
    subject: `דוח אובליגו שבועי — מתקרבים: ${counts[0]} · חורגים: ${counts[1]} · בפיגור: ${counts[2]}`,
    html: buildEmailHtml(parts, workDays, greetName, scope, link),
    text,
    attachments,
  };
  // Resend отдаёт сетевой сбой в res.error, не исключением (26.10 09:00 DNS — expiry-alert не ушёл молча).
  // Нет statusCode = запрос не дошёл, дубля не будет → повтор 3× через 30 с.
  let res;
  for (let i = 1; i <= 3; i++) {
    res = await resend.emails.send(payload);
    if (!res.error || res.error.statusCode) break;
    console.error(`  ${recipient} попытка ${i}/3:`, JSON.stringify(res.error));
    if (i < 3) await sleep(30000);
  }
  await sleep(600); // Resend: не больше ~2 писем в секунду
  return res;
}

let failed = 0; // не ушедшие письма → exit 1 в конце, Healthchecks пишет Дану

// OBLIGO_ALERT_CC — копия каждого письма (Дан 2026-10-08). Не cc-полем, а отдельным письмом со своей ссылкой:
// общая ссылка смешала бы трекинг и отдала бы CC чужую страницу (security-agent 2026-10-13).
async function sendWithCopies(resend, to, parts, workDays, scope, label) {
  const cc = (process.env.OBLIGO_ALERT_CC || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const addr of [to, ...cc]) {
    const r = await sendReport(resend, addr, parts, workDays, scope);
    if (r?.error) failed++;
    console.log(`${label} ${addr}${addr === to ? '' : ` (копия ${to})`}:`, JSON.stringify(r?.error ?? r?.data));
  }
}

async function main() {
  if (process.argv.includes('--purge-links')) return purgeLinks();
  if (!DRY_RUN) {
    if (!fs.existsSync(SHARE_DIR)) throw new Error(`${SHARE_DIR} нет — боевая рассылка/тест только на VPS (ссылки на страницы)`);
    purgeLinks();
  }
  const entities = await fetchEntities();
  // Priority недоступен — отчёт уходит без двух колонок, а не падает
  try {
    const ts = await fetchTermsStatus();
    for (const e of entities) {
      const recs = e.payerList.flatMap(p => ts.get(String(p)) || []);
      e.terms = oneLine(recs, 'terms'); e.status = oneLine(recs, 'status');
    }
  } catch (err) { console.error('[Priority] תנאי תשלום/סטטוס не получены:', err.message); }
  const workDays = await fetchWorkDays();
  const prev = loadState();
  const parts = PARTS.map(part => {
    const rows = entities.filter(part.pick).sort(part.sort);
    return { part, rows, diff: diffFor(prev, part.id, rows) };
  });
  // DSO: основная таблица — только с продажами за 3 месяца; без продаж — отдельно, по долгу (Дан 25.10)
  // Плательщики с облиго в MMD — вне раздела DSO (Дан 26.10): продаж MMD нет в ALL_PARTS, поэтому DSO пустой/кривой,
  // а активный покупатель Эйлата (1113001 שופרסל שלי אילת) падал в «ללא מכירות». Вернуть, когда MMD будет в модели.
  const dsoBase = entities.byPayer.filter(e => e.usedILS > 0 && !e.hasMmd);
  const dsoRank = dsoBase.filter(e => e.creditDays !== null && e.sales3m > 0).sort((a, b) => b.creditDays - a.creditDays);
  const frozen = dsoBase.filter(e => !(e.sales3m > 0)).sort((a, b) => b.usedILS - a.usedILS);
  // + карточки сумм шапки по всем клиентам того же охвата и их динамика к прошлому отчёту (Дан 27.10)
  const kpiHist = loadKpiHistory(), kpiScopes = [];
  const setDso = (target, pred, key, extra = {}) => {
    target.dso = dsoRank.filter(pred).slice(0, DSO_TOP); target.dsoFrozen = frozen.filter(pred);
    const vals = { ...kpiValues(entities.filter(pred), frozen.filter(pred)), ...extra };
    target.kpi = kpiCards(vals, (kpiHist[key] || []).filter(p => p.date < isoToday()));
    kpiScopes.push({ key, vals });
  };
  let dsoTotal = null;
  try { dsoTotal = await fetchDsoTotal(); } catch (err) { console.error('[PBI] итог дней кредита не получен:', err.message); }
  setDso(parts, () => true, 'all', { dso: dsoTotal });

  console.log(`Плательщиков/сетей: ${entities.length}; рабочих дней осталось ${workDays.left}/${workDays.total}`);
  for (const { part, rows, diff } of parts) {
    console.log(`  [${part.id}] ${part.title}: ${rows.length} (сетей ${rows.filter(r => r.market === 'רשתות').length})`
      + (diff ? ` | vs ${diff.date}: +${diff.added.length} / -${diff.removed.length}` : ''));
  }

  // Менеджеры: "ALEXEY=a@x;MATVEY,ALMOG=b@x" — каждому שוק פרטי агентов его קבוצה, все 3 части.
  // Сбой карты групп не должен сорвать полный отчёт — менеджерские письма тогда пропускаются.
  const managers = TEST_TO ? [] : (process.env.OBLIGO_ALERT_MANAGERS || '').split(';').map(s => s.split('=').map(x => x.trim())).filter(([g, e]) => g && e);
  const perManager = [];
  if (managers.length) {
    try {
      const groupOf = await fetchAgentGroups();
      const noGroup = [...new Set(entities.filter(e => e.market !== 'רשתות' && !groupOf.has(e.agent)).map(e => e.agent))];
      if (noGroup.length) console.log('  агенты שוק פרטי без קבוצה (только в полном отчёте):', noGroup.join(', '));
      for (const [groups, email] of managers) {
        const gs = new Set(groups.split(',').map(s => s.trim()));
        const mineFn = r => r.market !== 'רשתות' && gs.has(groupOf.get(r.agent));
        const mine = parts.map(({ part, rows }) => {
          const own = rows.filter(mineFn);
          return { part, rows: own, diff: null }; // у менеджера только частники — сравнения нет (оно только по сетям)
        });
        setDso(mine, mineFn, `m:${groups}`);
        const n = mine.reduce((s, p) => s + p.rows.length, 0);
        console.log(`  [${groups}] ${email}: ${mine.map(p => p.rows.length).join('/')}`);
        if (n) perManager.push({ email, mine });
      }
    } catch (e) {
      console.error('[managers] карта קבוצה не получена, менеджерам не отправлено:', e.message);
    }
  }

  // אחראים сетей: "דני=a@x;חנן=b@x" — имя как в PBI [אחראי]; каждому только сети, где он אחראי, все 3 части
  // + נוספו / יצאו только по его сетям (Дан 2026-10-14). Пусто во всех частях — письма нет.
  const owners = TEST_TO ? [] : (process.env.OBLIGO_ALERT_OWNERS || '').split(';').map(s => s.split('=').map(x => x.trim())).filter(([n, e]) => n && e);
  const perOwner = [];
  for (const [name, email] of owners) {
    const own = r => r.market === 'רשתות' && r.resp === name;
    const mine = parts.map(({ part, rows, diff }) => ({
      part, rows: rows.filter(own),
      diff: diff && { ...diff, added: diff.added.filter(own), removed: diff.removed.filter(r => r.key.startsWith(`C|${name}|`)) },
    }));
    setDso(mine, own, `o:${name}`);
    console.log(`  [אחראי ${name}] ${email}: ${mine.map(p => p.rows.length).join('/')}`);
    if (mine.some(p => p.rows.length)) perOwner.push({ email, mine });
  }

  // --save-kpi: только записать сегодняшние суммы всех охватов как точку отсчёта динамики, без писем (Дан 27.10)
  if (process.argv.includes('--save-kpi')) {
    saveKpiHistory(kpiHist, kpiScopes);
    console.log(`kpi history: ${kpiScopes.length} охватов -> ${KPI_HISTORY || '(OBLIGO_ALERT_STATE не задан — не сохранено)'}`);
    return;
  }

  if (DRY_RUN) {
    const out = path.join(__dirname, 'out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'obligo-alert-preview.html'), buildEmailHtml(parts, workDays, 'דן', null, 'obligo-alert-page.html'));
    fs.writeFileSync(path.join(out, 'obligo-alert-page.html'), buildPageHtml(parts, workDays, null, expiryDate()));
    if (perOwner[0]) fs.writeFileSync(path.join(out, 'obligo-alert-page-owner.html'), buildPageHtml(perOwner[0].mine, workDays, SCOPE_OWNER, expiryDate()));
    if (perManager[0]) fs.writeFileSync(path.join(out, 'obligo-alert-page-manager.html'), buildPageHtml(perManager[0].mine, workDays, SCOPE_TEAM, expiryDate()));
    fs.writeFileSync(path.join(out, 'obligo-alert-preview.xlsx'), await buildXlsx(parts, workDays));
    console.log(`\n--dry-run — письмо не отправлено, превью: ${out}`);
    return;
  }

  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const resend = new Resend(process.env.RESEND_API_KEY);

  if (TEST_TO) {
    const r = await sendReport(resend, TEST_TO, parts, workDays, null);
    console.log(`Тест на ${TEST_TO}:`, JSON.stringify(r?.error ?? r?.data));
    return; // тест не пишет state — иначе сравнение в боевой рассылке собьётся
  }

  const recipients = (process.env.OBLIGO_ALERT_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (recipients.length === 0) throw new Error('OBLIGO_ALERT_RECIPIENTS не задан в .env');
  for (const to of recipients) await sendWithCopies(resend, to, parts, workDays, false, 'Отправлено');
  for (const { email, mine } of perManager) await sendWithCopies(resend, email, mine, workDays, SCOPE_TEAM, 'Менеджеру');
  for (const { email, mine } of perOwner) await sendWithCopies(resend, email, mine, workDays, SCOPE_OWNER, 'אחראי');
  saveState(parts); // state пишем и при частичном сбое: остальные адресаты своё получили
  saveKpiHistory(kpiHist, kpiScopes);
  if (failed) throw new Error(`${failed} писем не ушли`);
}

// exit(0): пул mssql (db.js, min 1) держит процесс — без выхода run-alert.sh ждал бы timeout 600
main().then(() => process.exit(0), e => { console.error('ERR:', e.message); process.exit(1); });
