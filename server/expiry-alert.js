// expiry-alert.js — ежедневный алярм "דוח תוקף" (סכנה + STOP SALE) из редактора махсана.
// Карточки не пересобираются на сервере — Puppeteer открывает тот же docs/planogram-editor.html
// (данные — локальные JSON из docs/, их пересобирает planogram-build.yml), включает фильтр סכנה
// в режиме מאוחד и снимает каждую карточку картинкой. Письмо = эти картинки в 2 колонки,
// поэтому выглядит как в аппе в любом почтовике и нормально печатается.
// Пробовали page.pdf() с print-раскладкой 2×2 — в headless она разваливается (2026-09-28).
// Письмо уходит только если есть хотя бы одна карточка סכנה/STOP SALE.
// Кому-то (EXPIRY_ALERT_SPLIT_TO, пока пусто — в доработке) дополнительно уходит второе письмо —
// тот же отчёт без режима מאוחד (אשדוד / צפון отдельно), как в аппе до нажатия «מחסן מאוחד» (2026-09-29).
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');
const { Resend } = require('resend');

const DRY_RUN = process.argv.includes('--dry-run');
// Разовая приписка под приветствием — workflow_dispatch input `note` (напр. при внеплановой рассылке).
const NOTE = (process.env.EXPIRY_ALERT_NOTE || '').replace(/[<>&]/g, '').trim();
// Тихая приписка — мелко в подвале, не под приветствием (пользователь 2026-10-13: «чтоб и не видел никто»).
const FOOTNOTE = (process.env.EXPIRY_ALERT_FOOTNOTE || '').replace(/[<>&]/g, '').trim();
const DOCS = path.join(__dirname, '..', 'docs');
// Ссылку на апп из письма убрали (пользователь 2026-10-14): письмо уходит 14 адресатам и пересылается дальше.
// Пока выключено (пользователь 2026-09-29: «не отправлять Максиму, нужно доработать») — вернуть 'maxim@dilerbmd.com' по умолчанию.
const SPLIT_TO = (process.env.EXPIRY_ALERT_SPLIT_TO || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// Копия задана → одно письмо: RECIPIENTS в «Кому», CC в копии, приветствие «שלום רב» (пользователь 2026-09-30).
// Без CC — как раньше, личное письмо каждому.
// --zafn-low: второй алярм Максиму (пользователь 2026-10-08) — кнопка редактора «צפון <3 ימים»
// (מלאי צפון ÷ מכירה צפון × 1.4 < 3), карточки по складам. Мера продаж — как в аппе, т.е. делится на дни
// с продажей: товар с одной крупной продажей за 45 дней (1211: 30 קרט 28.09) выглядит как 30 קרט/יום.
// Предохранитель (пользователь 2026-10-08): продажи на צפון были меньше чем в 20% рабочих дней (Вс–Чт)
// за те же 45 дней — карточку в письмо не брать. Кнопка в аппе остаётся без него.
const ZAFN_LOW = process.argv.includes('--zafn-low');
const ZAFN_MIN_SALE_DAYS_SHARE = 0.2;

// מק"ט, проданные на צפון реже чем в 20% рабочих дней за 45 дней. Сбой PBI — не валит алярм:
// письмо уходит без фильтра, причина в логе.
async function zafnRareMakats() {
  try {
    const { executeDax } = require('./powerbi');
    const rows = await executeDax(`
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
    "days", COUNTROWS(FILTER(VALUES('ALL_PARTS'[תאריך]), [TOTAL מכר בקרטונים ממוצע ביום] > 0))),
  'ALL_PARTS'[חברה] = "FORMULA",
  'ALL_PARTS'[מחסן] = "Zafn",
  FILTER(ALL('ALL_PARTS'[תאריך]), 'ALL_PARTS'[תאריך] >= TODAY() - 45)
)`);
    // те же 45 дней, что TODAY()-45 в DAX, рабочие = Вс–Чт по Израилю
    const today = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' }) + 'T12:00:00Z');
    let workDays = 0;
    for (let i = 0; i <= 45; i++) if (new Date(today - i * 86400000).getUTCDay() <= 4) workDays++;
    const rare = rows.filter(r => (r['[days]'] || 0) < workDays * ZAFN_MIN_SALE_DAYS_SHARE)
      .map(r => ({ mk: String(r["ALL_PARTS[מק'ט]"]), days: r['[days]'] || 0 }));
    return { rare, workDays };
  } catch (e) {
    console.error('[צפון <3] фильтр редких продаж не применён:', e.message);
    return { rare: [], workDays: 0 };
  }
}
// --ice / EXPIRY_ALERT_ICE=1: раздел «גלידה משפחתי — ICE» в том же письме (пользователь 2026-10-13).
// В редакторе махсана АЙС нет — данные из датасета АЙС подставляются редактору в браузере алярма
// как ещё одна секция, поэтому карточки, очередь партий и выброс — тот же код, что у FORMULA.
// Фильтры — как на странице סכנה дашборда АЙС. Темп — 365 дней без сегодня: у мороженого
// сезонность ×2.5–3, партии живут 1.5–2 года, 45 дней осенью «выбрасывают» то, что продастся летом
// (сверка с дашбордом на 365 днях: 11/11 партий).
const ICE = process.argv.includes('--ice') || process.env.EXPIRY_ALERT_ICE === '1';
const ICE_SHELF_LIFE = 90; // порог флага סכנה и меры v2 на дашборде АЙС (было 120, Дан 2026-10-13 → 90)
// 52 закрытых недели Вс–Сб без текущей (Дан 2026-10-19): незакрытая неделя занижала AVERAGEX по неделям.
// Не длиннее года: мера группирует по DIMCALENDAR[Week Number] без года — окно >52 нед склеивает годы.
const ICE_SALES_WEEKS = 52;

const _BIDI_STRIP = /[‎‏‪-‮⁦-⁩]/g;
// PBI АЙС отдаёт иврит в визуальном порядке. Как fixBiDi в build-mmd-orders.js, но скобки
// зеркалятся только в словах с ивритом, а латиница/цифры внутри них остаются как есть
// (там «(7)» → «)7(», «DADU(6)…» → «UDAD»).
function fixBiDi(raw) {
  if (!raw) return '';
  const hasBidi = /[‪-‮]/.test(raw);
  const s = raw.replace(_BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  const mirror = { '(': ')', ')': '(' };
  return s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w)
      ? w.split('').reverse().map(c => mirror[c] || c).join('').replace(/[A-Za-z0-9.,%+]+/g, m => m.split('').reverse().join(''))
      : w)
    .join(' ');
}

// Данные АЙС в формате product-data.json редактора: { products, state, photos }.
async function fetchIceData() {
  const { executeDax } = require('./powerbi');
  const DS = process.env.POWERBI_ICE_DATASET_ID;
  if (!DS) throw new Error('POWERBI_ICE_DATASET_ID не задан');
  const PAGE = `'KARTIS PARIT'[משפחתי / בודדים] = "משפחתי", MLAY[מלאי זמין] > 0`;
  const SALES = `DATA[Custom] = "-מכר-", DIMCALENDAR[Date] >= TODAY() - WEEKDAY(TODAY(), 1) + 1 - ${ICE_SALES_WEEKS * 7}, DIMCALENDAR[Date] < TODAY() - WEEKDAY(TODAY(), 1) + 1`;
  const [batchRows, prodRows, weekRows] = await Promise.all([
    executeDax(`EVALUATE CALCULATETABLE(ADDCOLUMNS(
      SUMMARIZE('MLAY MISHPAHTI', 'MLAY MISHPAHTI'[מק'ט], 'MLAY MISHPAHTI'[מנה/פק'ע], 'MLAY MISHPAHTI'[מחסן], 'MLAY MISHPAHTI'[ת. תפוגת תוקף]),
      "ctn", CALCULATE(SUM('MLAY MISHPAHTI'[מלאי  ללא מחסן 100 KARTON])),
      "left", CALCULATE(MIN('MLAY MISHPAHTI'[כמה ימים נשארו]))), ${PAGE})`, DS),
    executeDax(`EVALUATE CALCULATETABLE(ADDCOLUMNS(VALUES('KARTIS PARIT'[מק"ט]),
      "name", CALCULATE(MAX('MLAY MISHPAHTI'[תאור מוצר])),
      "fam", CALCULATE(MAX('MLAY MISHPAHTI'[תאור משפחה])),
      "costCtn", CALCULATE(MAX('KARTIS PARIT'[עלות ש"ח]) * MAX('KARTIS PARIT'[תכולת האריזה למוצר])),
      "rate", CALCULATE([ממוצע ביום עבודה (על בסיס WEEKLY SALES) NOW], ${SALES}),
      "dyn", CALCULATE([סכנה דינמי לפי מכר NOW], ${SALES})), ${PAGE})`, DS),
    // 6 полных недель Вс–Сб, как fetchWeeklySales у FORMULA (planogram/pbi-kapua.js)
    executeDax(`EVALUATE CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(DATA, DATA[מק'ט], DATA[שבוע]),
      "wk", [ממוצע ביום עבודה (על בסיס WEEKLY SALES) NOW]),
      ${PAGE}, DATA[Custom] = "-מכר-",
      DIMCALENDAR[Date] >= TODAY() - WEEKDAY(TODAY(), 1) - 41, DIMCALENDAR[Date] < TODAY() - WEEKDAY(TODAY(), 1) + 1)`, DS),
  ]);
  const products = {};
  for (const r of prodRows) {
    const mk = String(r['KARTIS PARIT[מק"ט]'] || '');
    if (!mk) continue;
    products[mk] = { stock: 0, stockZafn: 0, daySales: +r['[rate]'] || 0, daySalesZafn: 0, daySalesAll: +r['[rate]'] || 0,
      shelfLife: ICE_SHELF_LIFE, pakuot: [], pakuotZafn: [], costCarton: Math.round((+r['[costCtn]'] || 0) * 100) / 100 || null,
      nameEn: fixBiDi(r['[name]']), fam: fixBiDi(r['[fam]']) };
    // «19/11/25 מוצר חדש» — та же метка, что в колонке דשבורד: истории продаж меньше года,
    // темп — с запуска, прогноз грубее (Дан 2026-10-13: в конец и пометить)
    const dyn = String(r['[dyn]'] || '').replace(_BIDI_STRIP, '');
    if (dyn.includes('מוצר חדש')) products[mk].newSince = (dyn.match(/\d{2}\/\d{2}\/\d{2}/) || [''])[0];
  }
  // Партия = מנה/פק'ע по всем складам (Trn/Trnz тоже — как итог дашборда). Все партии в одной
  // очереди с общим темпом — как мера v2; צפון только в «סה"כ מלאי».
  const byBatch = {};
  for (const r of batchRows) {
    const mk = String(r["MLAY MISHPAHTI[מק'ט]"] || ''), d = products[mk], ctn = +r['[ctn]'] || 0;
    if (!d || !(ctn > 0)) continue;
    if (r['MLAY MISHPAHTI[מחסן]'] === 'Zafn') d.stockZafn += ctn; else d.stock += ctn;
    const key = mk + '|' + r["MLAY MISHPAHTI[מנה/פק'ע]"];
    const b = byBatch[key] ||= { mk, date: String(r['MLAY MISHPAHTI[ת. תפוגת תוקף]'] || '').slice(0, 10), daysLeft: r['[left]'], cartons: 0 };
    b.cartons += ctn;
    if (r['[left]'] != null && (b.daysLeft == null || r['[left]'] < b.daysLeft)) b.daysLeft = r['[left]'];
  }
  for (const { mk, ...b } of Object.values(byBatch)) products[mk].pakuot.push({ ...b, cartons: Math.round(b.cartons) });
  const weeks = {};
  for (const r of weekRows) (weeks[String(r["DATA[מק'ט]"])] ||= []).push({ wk: r['DATA[שבוע]'], val: Math.round((+r['[wk]'] || 0) * 10) / 10 });
  for (const [mk, ws] of Object.entries(weeks)) {
    if (!products[mk]) continue;
    const last6 = ws.sort((a, b) => a.wk - b.wk).slice(-6);
    while (last6.length < 6) last6.unshift({ wk: 0, val: 0 });
    products[mk].weekSales = last6.map(w => w.val);
    products[mk].weekDates = last6.map(w => w.wk ? `שב${w.wk}` : '');
  }
  const mks = Object.keys(products).filter(mk => products[mk].pakuot.length);
  for (const mk of Object.keys(products)) {
    products[mk].stock = Math.round(products[mk].stock);
    products[mk].stockZafn = Math.round(products[mk].stockZafn);
  }
  // Фото — 'KARTIS PARIT ICE'[URL תמונה] в датасете FORMULA (у части товаров primail/…, не priimages).
  // Нет URL или сбой — priimages/<מק"ט>.jpg; нет и там — заглушка редактора (_expiryImgErr).
  const photos = Object.fromEntries(mks.map(mk => [mk, `https://priority.dilerbmd.com/priimages/${mk}.jpg`]));
  try {
    const rows = await executeDax(`EVALUATE SELECTCOLUMNS(FILTER('KARTIS PARIT ICE', 'KARTIS PARIT ICE'[מק"ט] IN {${mks.map(m => `"${m}"`).join(',')}}
      && 'KARTIS PARIT ICE'[URL תמונה] <> ""), "mk", 'KARTIS PARIT ICE'[מק"ט], "url", 'KARTIS PARIT ICE'[URL תמונה])`);
    for (const r of rows) photos[String(r['[mk]'])] = r['[url]'];
  } catch (e) { console.error('[ICE] URL фото не загружены:', e.message); }
  // порядок карточек — новые товары в конце, дальше по семейству и מק"ט
  const isNew = mk => products[mk].newSince != null;
  const state = {};
  mks.sort((a, b) => isNew(a) - isNew(b) || (products[a].fam || '').localeCompare(products[b].fam || '') || a.localeCompare(b))
    .forEach((mk, i) => { state[i + 1] = { makat: mk, name: products[mk].nameEn, fam: products[mk].fam, haluka: 0, printOrder: i + 1 }; });
  const newSince = Object.fromEntries(mks.filter(isNew).map(mk => [mk, products[mk].newSince]));
  return { products, state, photos, newSince, salesWeeks: ICE_SALES_WEEKS };
}

const ENV = ZAFN_LOW ? 'ZAFN_LOW_ALERT' : 'EXPIRY_ALERT';
const CC = (process.env[ENV + '_CC'] || '').split(',').map(s => s.trim()).filter(Boolean);
// Список прошлой рассылки (מק"ט + имя) — для блока «נוספו / יצאו מהדוח» (пользователь 2026-10-08).
// Пишется только после реальной отправки (или с --save-state). Не задан — блока нет.
const STATE = process.env.EXPIRY_ALERT_STATE || '';

const NAVY = '#1C3D6B';
const GOLD = '#B8863B';
const INK = '#2A2620';
const MUTED = '#6B7280';
const PAPER = '#FAF7F2';
const LINE = '#E5E0D8';

const RECIPIENT_NAMES = {
  'lena@dilerbmd.com': 'לנה',
  'polina.k@dilerbmd.com': 'פולינה',
  'yosiel@dilerbmd.com': 'יוסי',
  'dima@dilerbmd.com': 'דימה',
  'maxim@dilerbmd.com': 'מקסים',
  'd.sverdlik@dilerbmd.com': 'דן',
};

const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };

async function shootCards(split, zafnLow, hide = [], ice = null) {
  const srv = http.createServer((req, res) => {
    const p = path.join(DOCS, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(DOCS) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => srv.listen(0, r));
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    // Обычный Chrome UA — HeadlessChrome внешние сервисы (фото Priority) могут резать.
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36');
    await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${srv.address().port}/planogram-editor.html`, { waitUntil: 'networkidle0', timeout: 90000 });
    await page.evaluate((split, zafnLow, hide, ice) => {
      document.getElementById('app-splash')?.remove();
      document.getElementById('mahsan-login-modal')?.remove();
      hide.forEach(mk => window._hiddenExpiryMakats.add(mk)); // как «×» на карточке в аппе
      if (ice) { // АЙС — отдельная секция только в этом браузере; файлы редактора не трогаем
        _SECTIONS.push('ice');
        state.ice = ice.state;
        Object.assign(productData, ice.products);
        Object.assign(productPhotos, ice.photos);
        window._expirySecFilter = 'ice';
      }
      toggleExpiryPage();
      if (split && window._expiryMauchad) toggleCombinedWh();
      if (zafnLow) { if (!window._expiryZafnLow) toggleZafnLowFilter(); }
      else if (!window._expiryOnlySakana) toggleSakanaFilter();
      document.querySelectorAll('#expiry-grid button').forEach(b => b.remove()); // "×" скрыть карточку
      // подпись темпа в редакторе вшита под FORMULA (45 дней)
      if (ice) document.querySelectorAll('#expiry-grid span').forEach(sp => {
        if (sp.textContent === '(45 יום אחורה)') sp.textContent = `(${ice.salesWeeks} שבועות סגורים)`;
      });
      // бирка новинки под מק"ט — отдельным div, сам div מק"ט не трогаем (по нему ищется מק"ט ниже)
      if (ice) document.querySelectorAll('#expiry-grid div[style*="color:#1565C0;font-weight:bold"]').forEach(el => {
        const since = ice.newSince[el.textContent.trim()];
        if (since !== undefined) el.insertAdjacentHTML('afterend', `<div style="display:inline-block;font-size:8px;font-weight:bold;color:#fff;background:#00897b;border-radius:3px;padding:1px 4px;margin-top:2px;line-height:1.3;text-align:center;">🆕 מוצר חדש${since ? `<br>מ-${since}` : ''}</div>`);
      });
      // порядок АЙС — по עלות לזריקה (сумма считается редактором при отрисовке), новинки в конце
      // (Дан 2026-10-13). В מאוחד в сетке только карточки, без заголовков секций.
      if (ice) {
        const grid = document.getElementById('expiry-grid');
        const key = c => {
          const mk = c.querySelector('div[style*="color:#1565C0;font-weight:bold"]')?.textContent.trim();
          const costDiv = [...c.querySelectorAll('div')].find(d => d.textContent.trim().startsWith('עלות לזריקה'));
          return { isNew: mk in ice.newSince, cost: costDiv ? +costDiv.textContent.replace(/[^\d]/g, '') : 0 };
        };
        [...grid.children].map(c => [c, key(c)])
          .sort((a, b) => a[1].isNew - b[1].isNew || b[1].cost - a[1].cost)
          .forEach(([c]) => grid.appendChild(c));
      }
    }, split, zafnLow, hide, ice);
    // צפון <3 — сортировка по шансу, что Ашдод поделится (Дан 2026-10-14; блоки «מספיק/לא מספיק» отменены):
    // дни запаса Ашдода = остаток ÷ его продажи в день × 1.4 (тот же ×1.4 что у צפון), по убыванию;
    // остаток без продаж — первым.
    if (zafnLow) await page.evaluate(() => {
      const grid = document.getElementById('expiry-grid');
      const days = c => {
        const d = productData[c.querySelector('div[style*="color:#1565C0;font-weight:bold"]')?.textContent.trim()] || {};
        const sales = d.daySales ?? d.daySalesAll ?? 0;
        return !(d.stock > 0) ? 0 : sales > 0 ? d.stock / sales * 1.4 : Infinity;
      };
      [...grid.children].filter(c => c.querySelector('div[style*="color:#1565C0;font-weight:bold"]'))
        .map(c => [c, days(c)]).sort((a, b) => b[1] - a[1]).forEach(([c]) => grid.appendChild(c));
    });
    await page.evaluate(() => new Promise(r => {
      const imgs = [...document.images].filter(i => !i.complete);
      if (!imgs.length) return r();
      let n = imgs.length;
      // addEventListener, не onerror=: тот перезаписывал _expiryImgErr редактора — вместо заглушки 📷 была битая картинка
      const done = () => { if (--n === 0) r(); };
      imgs.forEach(i => { i.addEventListener('load', done); i.addEventListener('error', done); });
      setTimeout(r, 20000);
    }));
    // Спарклайн продаж по неделям в аппе виден только при печати (.spark-only-print) — включить
    // его и в экранном режиме. Print-медиа целиком не эмулируем: она растягивает карточку на всю ширину.
    // .sales-stale («מכירות לא נטענו») — только в аппе, не в письме (Дан 2026-10-25); Дану — отдельное DANGER DATA.
    await page.addStyleTag({ content: '.spark-only-print{display:block!important}.sales-stale{display:none!important}' });
    const SEL = '#expiry-grid > div:not(.expiry-sec-hdr):not(.grid-page-break):not(.expiry-haluka-sep)';
    // В письме карточки идут парами (строка из 2) — выровнять высоту пары, иначе низ строки
    // рваный (пользователь 2026-09-28).
    await page.evaluate(sel => {
      const cs = [...document.querySelectorAll(sel)];
      for (let i = 0; i < cs.length; i += 2) {
        const pair = cs.slice(i, i + 2);
        const h = Math.max(...pair.map(c => c.offsetHeight));
        pair.forEach(c => { c.style.boxSizing = 'border-box'; c.style.minHeight = h + 'px'; });
      }
    }, SEL);
    // Имя + "עלות לזריקה" каждой карточки — прямо из DOM, те же числа что на картинке.
    const risks = await page.$$eval(SEL, cs => cs.map(c => {
      const costDiv = [...c.querySelectorAll('div')].find(d => d.textContent.trim().startsWith('עלות לזריקה'));
      const nameDiv = c.querySelector('div[style*="font-size:10px;font-weight:bold"]');
      const mkDiv = c.querySelector('div[style*="color:#1565C0;font-weight:bold"]');
      const name = nameDiv ? nameDiv.textContent.trim() : '';
      return { mk: (mkDiv ? mkDiv.textContent.trim() : '') || name, name, cost: costDiv ? +costDiv.textContent.replace(/[^\d]/g, '') : 0 };
    }));
    const cards = await page.$$(SEL);
    const shots = [];
    for (const c of cards) shots.push(Buffer.from(await c.screenshot({ type: 'png' })));
    if (shots.length === 0) return { shots, pdf: null, risks };

    // PDF для печати — из тех же картинок, 4 карточки на A4 (2×2). Своя простая вёрстка,
    // не print-CSS редактора: тот в headless разваливается.
    const date = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' });
    const pages = [];
    for (let i = 0; i < shots.length; i += 4) {
      const cells = shots.slice(i, i + 4).map(b => `<div><img src="data:image/png;base64,${b.toString('base64')}"></div>`).join('');
      pages.push(`<section><header>${zafnLow ? 'מלאי צפון פחות מ-3 ימים' : 'דוח תוקף' + (split ? ' לפי מחסן' : '')} — ${ice ? 'גלידה משפחתי ICE' : 'FORMULA'} &middot; ${date}</header><main>${cells}</main></section>`);
    }
    await page.emulateMediaType('print');
    await page.setContent(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
      @page{size:A4;margin:8mm} body{margin:0;font-family:Arial,sans-serif}
      section{height:280mm;display:flex;flex-direction:column;page-break-after:always}
      section:last-child{page-break-after:auto}
      header{font-size:11pt;font-weight:bold;color:#1C3D6B;padding-bottom:3mm}
      main{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto auto;align-content:start;gap:6mm;min-height:0}
      img{display:block;width:100%;height:auto}
    </style></head><body>${pages.join('')}</body></html>`, { waitUntil: 'load' });
    const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    return { shots, pdf, risks };
  } finally {
    await browser.close();
    srv.close();
  }
}

function loadPrev() {
  try { return STATE ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null; } catch { return null; }
}

// Сравнение с прошлой рассылкой по מק"ט. null — сравнивать не с чем (первый запуск).
function diffWithPrev(prev, risks) {
  if (!prev || !Array.isArray(prev.items)) return null;
  const was = new Set(prev.items.map(r => r.mk));
  const now = new Set(risks.map(r => r.mk));
  return { date: prev.date, added: risks.filter(r => !was.has(r.mk)), removed: prev.items.filter(r => !now.has(r.mk)) };
}

function saveState(risks) {
  if (!STATE) return;
  const date = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' });
  // сбой записи не должен ронять уже отправленный алярм
  try { fs.writeFileSync(STATE, JSON.stringify({ date, items: risks.map(({ mk, name, cost }) => ({ mk, name, cost })) }, null, 1)); }
  catch (e) { console.error('state not saved:', e.message); }
}

const fmtILS = v => '₪' + Math.round(v).toLocaleString('en-US');

// Общая сумма риска + Парето: топ товаров, дающих первые 70% потерь (товар, пересекающий
// порог, включается). Пользователь 2026-09-28.
function riskSummary(risks) {
  const withCost = risks.filter(r => r.cost > 0).sort((a, b) => b.cost - a.cost);
  const total = withCost.reduce((s, r) => s + r.cost, 0);
  const top = [];
  let acc = 0;
  for (const r of withCost) { if (acc >= total * 0.7) break; top.push(r); acc += r.cost; }
  return { total, top, topSum: acc, noCost: risks.length - withCost.length };
}

// Outlook (Word-движок) игнорирует CSS direction/unicode-bidi — "₪149,458" внутри ивритской
// строки разворачивался в "458₪149,". Явные LRE…PDF вокруг суммы держат порядок везде.
const ltr = s => `&#x202A;${s}&#x202C;`;

// Рамка/фон — на ячейке таблицы, не на div: Outlook рисует фон div только частично
// (список выпадал из розового блока, 2026-09-28).
function buildRiskHtml({ total, top, topSum, noCost }) {
  if (!total) return '';
  const items = top.map((r, i) => `<tr>
      <td style="padding:5px 0;font-size:14px;color:${INK};width:24px;vertical-align:top">${i + 1}.</td>
      <td style="padding:5px 0;font-size:14px;color:${INK}">${r.name}</td>
      <td align="left" style="padding:5px 0 5px 4px;font-size:14px;font-weight:bold;color:#b71c1c;text-align:left;white-space:nowrap">${ltr(fmtILS(r.cost))}</td>
    </tr>`).join('');
  return `<tr><td dir="rtl" style="padding:8px 28px 6px;text-align:right">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl"><tr>
      <td bgcolor="#FFF5F5" style="background-color:#FFF5F5;border:2px solid #c62828;border-radius:10px;padding:14px 18px;text-align:right">
        <div style="font-size:16px;font-weight:900;color:${INK}">סה"כ סיכון (עלות לזריקה צפויה): <span style="color:#b71c1c">${ltr(fmtILS(total))}</span></div>
        <div style="padding-top:8px;font-size:13px;color:${MUTED}">מתוכם ${ltr(Math.round(topSum / total * 100) + '%')} — ${ltr(fmtILS(topSum))} — ב-${top.length} ${top.length === 1 ? 'מוצר' : 'מוצרים'}:</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="margin-top:4px">${items}</table>
        ${noCost ? `<div style="padding-top:6px;font-size:11px;color:${MUTED}">${noCost} מוצרים ללא נתוני עלות — לא נכללו בסכום.</div>` : ''}
      </td>
    </tr></table>
  </td></tr>`;
}

function buildDiffHtml(diff) {
  if (!diff) return '';
  const list = (rows, sign, color) => rows.length
    ? rows.map(r => `<div style="padding:3px 0;font-size:13px;color:${INK}"><b style="color:${color}">${sign}</b> ${r.name}${r.cost > 0 ? ` — ${ltr(fmtILS(r.cost))}` : ''}</div>`).join('')
    : `<div style="padding:3px 0;font-size:13px;color:${MUTED}">אין</div>`;
  return `<tr><td dir="rtl" style="padding:8px 28px 6px;text-align:right">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl"><tr>
      <td bgcolor="#F7F9FC" style="background-color:#F7F9FC;border:1px solid ${LINE};border-radius:10px;padding:12px 18px;text-align:right">
        <div style="font-size:14px;font-weight:900;color:${NAVY}">שינויים מהדוח הקודם (${diff.date})</div>
        <div style="padding-top:8px;font-size:13px;font-weight:bold;color:#b71c1c">נוספו לדוח (${diff.added.length}):</div>
        ${list(diff.added, '+', '#b71c1c')}
        <div style="padding-top:8px;font-size:13px;font-weight:bold;color:#2e7d32">יצאו מהדוח (${diff.removed.length}):</div>
        ${list(diff.removed, '−', '#2e7d32')}
      </td>
    </tr></table>
  </td></tr>`;
}

// Карточки [from, to) парами — строка из 2 картинок cid:<prefix>-<i>.
function cardRows(prefix, from, to) {
  if (to <= from) return '';
  const rows = [];
  for (let i = from; i < to; i += 2) {
    const cell = j => j < to
      ? `<td width="50%" valign="top" style="padding:6px"><img src="cid:${prefix}-${j}" width="322" alt="" style="display:block;width:100%;max-width:322px;height:auto;border:0"></td>`
      : '<td width="50%"></td>';
    rows.push(`<tr style="page-break-inside:avoid">${cell(i)}${cell(i + 1)}</tr>`);
  }
  return `<tr><td style="padding:4px 12px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl">${rows.join('')}</table></td></tr>`;
}

// Раздел АЙС — после карточек FORMULA, своя сумма риска (ice = { n, nNew, risk } или null).
// Новинки (nNew) идут последними карточками — отдельной подсекцией.
function buildIceHtml(ice) {
  if (!ice?.n) return '';
  const firstNew = ice.n - (ice.nNew || 0);
  return `<tr><td dir="rtl" style="padding:22px 28px 4px;text-align:right;border-top:3px solid ${NAVY}">
    <div style="font-size:20px;font-weight:900;color:${NAVY}">גלידה משפחתי — ICE</div>
    <div style="padding-top:4px;font-size:13px;color:${MUTED}">${ice.n} ${ice.n === 1 ? 'מוצר בסכנה' : 'מוצרים בסכנה'} / STOP SALE · מכר ממוצע ${ICE_SALES_WEEKS} שבועות סגורים · חיי מדף מינ' ${ICE_SHELF_LIFE} יום</div>
  </td></tr>
  ${buildRiskHtml(ice.risk)}
  ${cardRows('ice-card', 0, firstNew)}
  ${ice.nNew ? `<tr><td dir="rtl" style="padding:10px 28px 2px;text-align:right">
    <div style="font-size:15px;font-weight:900;color:#00897b">🆕 מוצרים חדשים (${ice.nNew})</div>
    <div style="padding-top:3px;font-size:12px;color:${MUTED}">פחות משנה של מכירות — הקצב מחושב מיום ההשקה, והתחזית פחות מדויקת.</div>
  </td></tr>` : ''}
  ${cardRows('ice-card', firstNew, ice.n)}`;
}

function buildEmailHtml(n, greetName, risk, split, diff, ice = null) {
  const greeting = greetName ? `שלום ${greetName},` : 'שלום,';
  return `<!doctype html>
<html lang="he"><body style="margin:0;padding:28px 16px;background:${PAPER};font-family:Arial,sans-serif">
<table role="presentation" align="center" width="700" cellpadding="0" cellspacing="0" style="width:700px;max-width:700px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${LINE}">
  <tr><td dir="rtl" style="background-color:${NAVY};padding:30px 28px 26px;text-align:center">
    <img src="cid:diler-logo-white" width="84" height="84" alt="DILER B.M.D" style="display:block;margin:0 auto 14px" />
    <div style="font-size:24px;font-weight:900;color:#ffffff">${ZAFN_LOW ? 'מלאי נמוך — מחסן צפון' : 'התראת תוקף — מחסן FORMULA'}</div>
    ${split && !ZAFN_LOW ? '<div style="padding-top:6px;font-size:15px;font-weight:bold;color:#ffffff">לפי מחסן — אשדוד / צפון</div>' : ''}
    <div style="padding-top:8px;font-size:13px;color:#AFC1DC">${ZAFN_LOW ? `${n} ${n === 1 ? 'מוצר' : 'מוצרים'} — מלאי פחות מ-3 ימי מכירה` : `${n} ${n === 1 ? 'מוצר בסכנה' : 'מוצרים בסכנה'} / STOP SALE`}</div>
    ${ice?.n ? `<div style="padding-top:4px;font-size:13px;color:#AFC1DC">+ גלידה משפחתי ICE — ${ice.n} ${ice.n === 1 ? 'מוצר' : 'מוצרים'}</div>` : ''}
    <div style="padding-top:10px;font-size:11px;color:${GOLD}">${new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
  </td></tr>
  <tr><td dir="rtl" style="padding:20px 28px 8px;text-align:right;font-size:14px;color:${INK}">${greeting} ${ZAFN_LOW ? 'מצורפים מוצרים שהמלאי שלהם במחסן צפון מספיק פחות מ-3 ימי מכירה — כמו במסך דוח התוקף, כפתור «צפון &lt;3 ימים».<br><b>ממוין לפי מלאי אשדוד:</b> קודם המוצרים שאשדוד יכול להעביר מהם לצפון (הכי הרבה ימי מכירה במלאי).' : split ? 'מצורף דוח תוקף לפי מחסן (אשדוד / צפון בנפרד, ללא איחוד מחסנים) — מוצרים בסכנה ו-STOP SALE.' : 'מצורף דוח תוקף — מוצרים בסכנה ו-STOP SALE, כמו במסך דוח התוקף של המחסן.'}</td></tr>
  ${NOTE ? `<tr><td dir="rtl" style="padding:4px 28px 8px;text-align:right;font-size:14px;font-weight:bold;color:${NAVY}">${NOTE}</td></tr>` : ''}
  ${buildRiskHtml(risk)}
  ${buildDiffHtml(diff)}
  <tr><td dir="rtl" style="padding:4px 28px 10px;text-align:right">
    <div style="display:inline-block;padding:9px 16px;border:1.5px solid ${NAVY};border-radius:8px;background:#EEF3FA;font-size:13px;font-weight:bold;color:${NAVY}">🖨 להדפסה — פתחו את ${ice?.n ? 'קבצי ה-PDF המצורפים' : 'קובץ ה-PDF המצורף'} (4 מוצרים בעמוד A4)</div>
  </td></tr>
  ${cardRows('card', 0, n)}
  ${buildIceHtml(ice)}
  <tr><td dir="rtl" style="padding:16px 28px 24px;text-align:right;border-top:1px solid ${LINE};font-size:12px;color:${MUTED};line-height:1.7">
    ${FOOTNOTE ? `${FOOTNOTE}<br>` : ''}הדוח נשלח רק בימים שיש ${ZAFN_LOW ? 'מוצרים עם מלאי נמוך בצפון' : 'מוצרים בסכנה'}.<br>הערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.
  </td></tr>
</table>
</body></html>`;
}

// Сборка планограммы подставила прошлые продажи (PBI вернул пустые) — карточки посчитаны по ним.
// Письмо только Дану, с алярмом תוקף (Дан 2026-10-25: не каждый час). Сбой не валит алярм.
async function dangerDataMail() {
  try {
    const pd = JSON.parse(fs.readFileSync(path.join(DOCS, 'product-data.json'), 'utf8'));
    const stale = Object.entries(pd).filter(([, v]) => v?.salesStale)
      .sort((a, b) => a[1].salesStale.localeCompare(b[1].salesStale) || a[0].localeCompare(b[0]));
    if (!stale.length) return;
    const fmtD = s => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
    const lines = stale.map(([mk, v]) => `${mk} — ${v.nameEn || v.desc || v.fam || ''} — מאז ${fmtD(v.salesStale)}`);
    console.log('[DANGER DATA]', stale.length, stale.map(([mk]) => mk).join(','));
    if (DRY_RUN) return;
    const to = (process.env.EXPIRY_ALERT_DANGER_TO || 'd.sverdlik@DilerBMD.com').split(',').map(s => s.trim()).filter(Boolean);
    const res = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: `Diler Intelligence <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
      to,
      subject: `DANGER DATA⛔ — ${stale.length} מק"טים בלי מכירות עדכניות`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px">
<p>מכירות לא נטענו מ-PBI — בדוח התוקף ובאפליקציה מוצגות מכירות מהטעינה הקודמת:</p>
<ul>${lines.map(l => `<li>${l.replace(/[<>&]/g, '')}</li>`).join('')}</ul></div>`,
      text: ['מכירות לא נטענו מ-PBI — בדוח התוקף ובאפליקציה מוצגות מכירות מהטעינה הקודמת:', ...lines].join('\n'),
    });
    console.log('[DANGER DATA]', to.join(','), JSON.stringify(res));
  } catch (e) { console.error('[DANGER DATA] не отправлено:', e.message); }
}

async function main() {
  const recipients = (process.env[ENV + '_RECIPIENTS'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const splitRecipients = recipients.filter(r => SPLIT_TO.includes(r.toLowerCase()));
  if (ZAFN_LOW) return runVariant({ split: true, to: recipients });
  await dangerDataMail();
  const variants = [{ split: false, to: recipients }];
  if (DRY_RUN || splitRecipients.length) variants.push({ split: true, to: splitRecipients });
  for (const v of variants) await runVariant(v);
}

async function runVariant({ split, to }) {
  const tag = ZAFN_LOW ? '[צפון <3]' : split ? '[по складам]' : '[מאוחד]';
  let hide = [];
  if (ZAFN_LOW) {
    const { rare, workDays } = await zafnRareMakats();
    hide = rare.map(r => r.mk);
    console.log(tag, `редкие продажи на צפון (<${ZAFN_MIN_SALE_DAYS_SHARE * 100}% из ${workDays} раб. дней) — не в письме: ${rare.length}`);
  }
  const { shots, pdf, risks } = await shootCards(split, ZAFN_LOW, hide);  // сумма риска / сравнение / состояние — только у основного письма תוקף
  const main = !split && !ZAFN_LOW;
  // раздел АЙС — только в основном письме; сбой АЙС не валит письмо FORMULA
  let ice = null;
  if (ICE && main) {
    try {
      const data = await fetchIceData();
      const r = await shootCards(false, false, [], data);
      // סה"כ סיכון — без новинок (Дан 2026-10-13): прогноз по ним грубый, их ₪ — только на карточках
      ice = { ...r, n: r.shots.length, nNew: r.risks.filter(x => x.mk in data.newSince).length,
        risk: riskSummary(r.risks.filter(x => !(x.mk in data.newSince))) };
      console.log('[ICE]', `Карточек: ${ice.n}`, r.risks.map(x => x.mk).join(','), `Риск: ${fmtILS(ice.risk.total)}`);
    } catch (e) {
      console.error('[ICE] раздел пропущен:', e.message);
      process.exitCode = 2;  // FORMULA всё равно уходит, но Healthchecks получает ≠0 → письмо Дану (19.10 выпал молча)
    }
  }
  const iceN = ice?.n || 0;
  const risk = ZAFN_LOW ? { total: 0, top: [], topSum: 0, noCost: 0 } : riskSummary(risks);
  if (risk.noCost) console.log(tag, 'Без суммы:', risks.filter(r => !(r.cost > 0)).map(r => r.name).join(' ; '));
  console.log(tag, `Риск: ${fmtILS(risk.total)}, топ-70%: ${risk.top.map(r => r.name + ' ' + fmtILS(r.cost)).join('; ')}`);
  console.log(tag, `Карточек: ${shots.length}`, risks.map(r => r.mk).join(','));
  // сравнение — только для основного письма (מאוחד); у варианта по складам другой набор карточек
  const diff = main ? diffWithPrev(loadPrev(), risks) : null;
  if (diff) console.log(tag, `vs ${diff.date}: +${diff.added.map(r => r.mk).join(',') || '-'} / -${diff.removed.map(r => r.mk).join(',') || '-'}`);
  // пустой отчёт = все вышли; запомнить, чтобы следующее письмо сравнивалось с ним
  if (shots.length === 0 && !iceN) { if (!DRY_RUN && main) saveState(risks); return; }

  if (DRY_RUN) {
    const out = path.join(__dirname, '..', '.scratch');
    const base = 'expiry-alert-preview' + (ZAFN_LOW ? '-zafn-low' : split ? '-split' : '');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, base + '.html'),
      buildEmailHtml(shots.length, 'דן', risk, split, diff, ice).replace(/cid:card-(\d+)/g, (_, i) => `data:image/png;base64,${shots[i].toString('base64')}`)
        .replace(/cid:ice-card-(\d+)/g, (_, i) => `data:image/png;base64,${ice.shots[i].toString('base64')}`)
        .replace('cid:diler-logo-white', 'data:image/png;base64,' + fs.readFileSync(path.join(DOCS, 'logo-diler-bmd-white.png')).toString('base64')));
    if (pdf) fs.writeFileSync(path.join(out, base + '.pdf'), pdf);
    if (iceN) fs.writeFileSync(path.join(out, base + '-ice.pdf'), ice.pdf);
    console.log(tag, `--dry-run — письмо не отправлено, превью в .scratch/${base}.html/.pdf`);
    if (main && process.argv.includes('--save-state')) saveState(risks);
    return;
  }

  if (to.length === 0) throw new Error(ENV + '_RECIPIENTS не задан');
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const logoPath = path.join(DOCS, 'logo-diler-bmd-white.png');
  const attachments = shots.map((b, i) => ({ filename: `card-${i}.png`, content: b.toString('base64'), contentId: `card-${i}` }));
  const isoDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
  if (pdf) attachments.push({ filename: `${ZAFN_LOW ? 'zafn-low-stock' : 'expiry-report' + (split ? '-by-warehouse' : '')}-${isoDate}.pdf`, content: pdf.toString('base64') });
  if (iceN) {
    ice.shots.forEach((b, i) => attachments.push({ filename: `ice-card-${i}.png`, content: b.toString('base64'), contentId: `ice-card-${i}` }));
    attachments.push({ filename: `expiry-report-ice-${isoDate}.pdf`, content: ice.pdf.toString('base64') });
  }
  if (fs.existsSync(logoPath)) attachments.push({ filename: 'logo-white.png', content: fs.readFileSync(logoPath).toString('base64'), contentId: 'diler-logo-white' });
  const subject = ZAFN_LOW
    ? `מלאי נמוך בצפון — ${shots.length} ${shots.length === 1 ? 'מוצר' : 'מוצרים'} פחות מ-3 ימים`
    : `התראת תוקף${split ? ' לפי מחסן' : ''} — ${shots.length} ${shots.length === 1 ? 'מוצר בסכנה' : 'מוצרים בסכנה'}${iceN ? ` + ICE ${iceN}` : ''}`;

  // С копией — одно письмо; без неё — личное письмо на каждого получателя, как obligo-alert.
  const sends = CC.length ? [{ to, cc: CC }] : to.map(r => ({ to: [r] }));
  for (const snd of sends) {
    // общее письмо — «שלום רב,» вместо перечня имён (пользователь 2026-09-30)
    const greetName = snd.to.length > 1 ? 'רב' : RECIPIENT_NAMES[snd.to[0].toLowerCase()] || (snd.cc ? 'רב' : '');
    const res = await sendWithRetry(resend, tag, {
      from: `Diler Intelligence <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
      ...snd,
      subject,
      html: buildEmailHtml(shots.length, greetName, risk, split, diff, ice),
      text: ZAFN_LOW ? [
        `${greetName ? `שלום ${greetName},` : 'שלום,'} ${shots.length} מוצרים — מלאי במחסן צפון פחות מ-3 ימי מכירה:`,
        'ממוין לפי מלאי אשדוד — קודם מה שאשדוד יכול להעביר:',
        ...risks.map(r => `• ${r.name} (${r.mk})`),
        '',
        'להדפסה — קובץ PDF מצורף.',
      ].join('\n') : [
        `${greetName ? `שלום ${greetName},` : 'שלום,'} ${shots.length} מוצרים בסכנה / STOP SALE במחסן FORMULA${split ? ' — לפי מחסן (אשדוד / צפון)' : ''}.`,
        ...(NOTE ? ['', NOTE] : []),
        '',
        `סה"כ סיכון (עלות לזריקה צפויה): ${fmtILS(risk.total)}`,
        `מתוכם ${risk.total ? Math.round(risk.topSum / risk.total * 100) : 0}%:`,
        ...risk.top.map((r, i) => `${i + 1}. ${r.name} — ${fmtILS(r.cost)}`),
        ...(diff ? ['', `שינויים מהדוח הקודם (${diff.date}):`,
          `נוספו (${diff.added.length}): ${diff.added.map(r => r.name).join('; ') || 'אין'}`,
          `יצאו (${diff.removed.length}): ${diff.removed.map(r => r.name).join('; ') || 'אין'}`] : []),
        ...(iceN ? ['', `גלידה משפחתי — ICE: ${iceN} מוצרים בסכנה / STOP SALE${ice.nNew ? ` (מתוכם ${ice.nNew} מוצרים חדשים — פחות משנה של מכירות)` : ''}`,
          `סה"כ סיכון: ${fmtILS(ice.risk.total)}`,
          ...ice.risk.top.map((r, i) => `${i + 1}. ${r.name} — ${fmtILS(r.cost)}`)] : []),
        '',
        'להדפסה — קובץ PDF מצורף.',
        ...(FOOTNOTE ? ['', FOOTNOTE] : []),
      ].join('\n'),
      attachments,
    });
    console.log(tag, snd.to.join(','), snd.cc ? 'cc ' + snd.cc.join(',') : '', JSON.stringify(res));
  }
  if (main) saveState(risks);
}

// Resend отдаёт сетевой сбой в res.error, а не исключением: 26.10 в 09:00 DNS → письмо не ушло, exit 0,
// Healthchecks зелёный, state записан как отправленный. Сетевой сбой (нет statusCode — запрос не дошёл,
// дубля не будет) повторяем 3× через 30 с; не ушло — бросаем: exit 1 → HC пишет Дану, state не трогаем.
async function sendWithRetry(resend, tag, payload) {
  for (let i = 1; ; i++) {
    const res = await resend.emails.send(payload);
    if (!res.error) return res;
    console.error(tag, `попытка ${i}/3:`, JSON.stringify(res.error));
    if (res.error.statusCode || i === 3) throw new Error(`письмо не ушло: ${res.error.message}`);
    await new Promise(r => setTimeout(r, 30000));
  }
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
