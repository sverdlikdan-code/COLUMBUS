const path    = require('path');
const ExcelJS = require(path.join(__dirname, 'planogram', 'node_modules', 'exceljs'));

const wb = new ExcelJS.Workbook();
wb.creator = 'COLUMBUS';
wb.created = new Date();

// ─── THEME ───────────────────────────────────────────────────────────────────
const T = {
  navy:    'FF1B2A4A',
  blue:    'FF1F4E79',
  lblue:   'FF2E75B6',
  sky:     'FFDEEAF1',
  green:   'FF375623',
  lgreen:  'FFE2EFDA',
  gold:    'FF7B5C00',
  lgold:   'FFFFF2CC',
  red:     'FF7B0000',
  lred:    'FFFFD7D7',
  gray:    'FF595959',
  lgray:   'FFF2F2F2',
  white:   'FFFFFFFF',
  text:    'FF1A1A1A',
};

function cell(ws, r, c) { return ws.getCell(r, c); }

function style(cl, {
  v, bold, size, color, bg, align, halign, wrap, border, numFmt, italic, merge
} = {}) {
  if (v !== undefined) cl.value = v;
  cl.font = {
    name: 'Calibri',
    size: size || 11,
    bold: !!bold,
    italic: !!italic,
    color: { argb: color || T.text },
  };
  if (bg) cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cl.alignment = {
    vertical: align || 'middle',
    horizontal: halign || 'left',
    wrapText: !!wrap,
    readingOrder: 2,
  };
  if (numFmt) cl.numFmt = numFmt;
  if (border) {
    const b = { style: 'thin', color: { argb: 'FFB0B0B0' } };
    cl.border = { top: b, bottom: b, left: b, right: b };
  }
  return cl;
}

function hdr(ws, r, c, v, opts = {}) {
  return style(cell(ws, r, c), {
    v, bold: true, size: opts.size || 11,
    color: T.white, bg: opts.bg || T.blue,
    halign: 'center', align: 'middle', border: true, wrap: true,
    ...opts
  });
}

function row(ws, r, cols, bg) {
  cols.forEach((v, i) => {
    style(cell(ws, r, i + 1), {
      v, bg: bg || (r % 2 === 0 ? T.lgray : T.white),
      border: true, wrap: true, align: 'middle',
    });
  });
}

function title(ws, r, c1, c2, text, sub) {
  ws.mergeCells(r, c1, r, c2);
  style(cell(ws, r, c1), {
    v: text, bold: true, size: 18, color: T.white,
    bg: T.navy, halign: 'center', align: 'middle',
  });
  ws.getRow(r).height = 44;
  if (sub) {
    ws.mergeCells(r + 1, c1, r + 1, c2);
    style(cell(ws, r + 1, c1), {
      v: sub, size: 12, italic: true, color: T.gray,
      bg: T.sky, halign: 'center', align: 'middle',
    });
    ws.getRow(r + 1).height = 24;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET 1 — עמוד שער  (Cover)
// ═══════════════════════════════════════════════════════════════════════════════
const ws0 = wb.addWorksheet('✦ פרויקט');
ws0.views = [{ rightToLeft: true }];
ws0.columns = Array(4).fill({ width: 32 });

ws0.getRow(2).height = 60;
ws0.mergeCells('A2:D2');
style(cell(ws0,'A2'), {
  v: 'COLUMBUS — מערכת ניהול חכמה', bold: true, size: 24,
  color: T.white, bg: T.navy, halign: 'center', align: 'middle',
});

ws0.mergeCells('A3:D3');
style(cell(ws0,'A3'), {
  v: 'דילר BMD — מסמך מסירת פרויקט', size: 14, italic: true,
  color: T.blue, bg: T.sky, halign: 'center', align: 'middle',
});
ws0.getRow(3).height = 30;

ws0.mergeCells('A4:D4');
style(cell(ws0,'A4'), { v: 'מאי 2026', size: 12, color: T.gray, halign: 'center' });
ws0.getRow(4).height = 22;

ws0.getRow(6).height = 10;

const blocks = [
  ['🏭 מה נבנה',      'מערכת ניהול שלמה: אפליקציה לנציגים, פלנוגרמה למחסן, אנליטיקה חיה', T.sky,   T.blue],
  ['⏱ זמן פיתוח',    '~93 שעות עבודה בפועל / 3 שבועות', T.lgold,  T.gold],
  ['🤖 AI מובנה',     '7 סוכני AI פעילים — CEO, גיאוגרף, מחסן, דיזיינר ועוד', T.lgreen, T.green],
  ['📊 נתונים חיים',  'עדכון אוטומטי כל שעה 16:00–23:00 + 06:00 ללא תלות במחשב', T.lred,   T.red],
];

let br = 7;
for (const [k, v, bg, fg] of blocks) {
  ws0.getRow(br).height = 36;
  ws0.mergeCells(br, 1, br, 2);
  style(cell(ws0, br, 1), { v: k, bold: true, size: 13, color: fg, bg, halign: 'right', align: 'middle', border: true });
  ws0.mergeCells(br, 3, br, 4);
  style(cell(ws0, br, 3), { v, size: 12, color: T.text, bg, halign: 'right', align: 'middle', wrap: true, border: true });
  br++;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET 2 — מה נמסר  (What was delivered)
// ═══════════════════════════════════════════════════════════════════════════════
const ws1 = wb.addWorksheet('📦 מה נמסר');
ws1.views = [{ rightToLeft: true, state: 'frozen', xSplit: 0, ySplit: 3 }];
ws1.columns = [
  { width: 6 }, { width: 28 }, { width: 40 }, { width: 18 }, { width: 14 },
];

title(ws1, 1, 1, 5, '📦 רכיבים שנמסרו', 'סטטוס מסירה מלא — מאי 2026');

hdr(ws1, 3, 1, '#',       { bg: T.navy });
hdr(ws1, 3, 2, 'רכיב',    { bg: T.navy });
hdr(ws1, 3, 3, 'תיאור',   { bg: T.navy });
hdr(ws1, 3, 4, 'טכנולוגיה', { bg: T.navy });
hdr(ws1, 3, 5, 'סטטוס',   { bg: T.navy });
ws1.getRow(3).height = 28;

const deliverables = [
  // #, component, description, tech, status
  [1, 'אפליקציה לנציגי מכירות', 'ניווט יומי, סדר ביקורים, מפה, מסנני עיר, GPS, נתוני מכירות', 'React Native', '✅ הושלם'],
  [2, 'חיבור Fabric / Power BI', 'נתוני מלאי, מכירות, לקוחות — ישירות מ-ERP בזמן אמת', 'REST API + DAX', '✅ הושלם'],
  [3, 'עורך פלנוגרמה — קפוא', 'תצוגת בייס, גרירה, שיוך מוצרים, צבעים לפי משפחה', 'HTML/JS + JSON', '✅ הושלם'],
  [4, 'עורך פלנוגרמה — חלבי', 'פלנוגרמה פיזית 12×5 בייס, רזרב, ברירת מחדל CSV', 'HTML/JS + JSON', '✅ הושלם'],
  [5, 'עורך פלנוגרמה — דגים', 'מדפים NORD PORT / SANTA BREMOR / מצונן, 57 בייס', 'HTML/JS + JSON', '✅ הושלם'],
  [6, 'עורך פלנוגרמה — דג יבש', 'פלנוגרמה יבשה, ניקוי אוטומטי יחידות ללא מלאי ומכירות', 'HTML/JS + JSON', '✅ הושלם'],
  [7, 'תצוגת תוקף (תו"ק)', 'כרטיסי פג תוקף, סכנה, צפון vs מרכז, STOP SALE, השלכה', 'PBI + HTML', '✅ הושלם'],
  [8, 'תהליך אוטומטי יומי', 'CSV → JSON → PBI → git push ללא התערבות אנושית', 'Node.js + bat', '✅ הושלם'],
  [9, 'GitHub Actions — ענן', 'עדכון כל שעה 16–23 + 06:00, ללא מחשב פעיל', 'GitHub CI/CD', '✅ הושלם'],
  [10,'Watchdog + Doctor',    'בדיקת בריאות תהליך, איתור שגיאות, ניסיון חוזר אוטומטי', 'PowerShell + Node', '✅ הושלם'],
  [11,'7 סוכני AI',           'CEO, גיאוגרף, מחסן, דיזיינר, אנליטיקה, fin-agent, skill-creator', 'Claude Agent SDK', '✅ הושלם'],
  [12,'אקסל תכנית מחסן',     'MAHSAN PLANOGRAM v41.xlsx — כל הסניפים, מדפים, נתוני מכירות', 'ExcelJS', '✅ הושלם'],
];

deliverables.forEach(([num, comp, desc, tech, status], i) => {
  const r = i + 4;
  const bg = i % 2 === 0 ? T.white : T.lgray;
  style(cell(ws1,r,1), { v: num,    bg, border: true, halign: 'center', align: 'middle' });
  style(cell(ws1,r,2), { v: comp,   bg, border: true, bold: true, align: 'middle', halign: 'right' });
  style(cell(ws1,r,3), { v: desc,   bg, border: true, wrap: true, align: 'middle', halign: 'right' });
  style(cell(ws1,r,4), { v: tech,   bg, border: true, align: 'middle', halign: 'center', italic: true, color: T.blue });
  style(cell(ws1,r,5), { v: status, bg: T.lgreen, border: true, align: 'middle', halign: 'center', bold: true, color: T.green });
  ws1.getRow(r).height = 28;
});

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET 3 — פוטנציאל עסקי  (Commercial potential)
// ═══════════════════════════════════════════════════════════════════════════════
const ws2 = wb.addWorksheet('💰 פוטנציאל עסקי');
ws2.views = [{ rightToLeft: true }];
ws2.columns = [{ width: 28 }, { width: 35 }, { width: 20 }, { width: 20 }];

title(ws2, 1, 1, 4, '💰 פוטנציאל עסקי ומסחרי', 'ניתוח שוק, תמחור והשוואה לפתרונות מתחרים');

// Market comparison
hdr(ws2, 3, 1, 'פתרון',          { bg: T.navy });
hdr(ws2, 3, 2, 'מה הוא עושה',    { bg: T.navy });
hdr(ws2, 3, 3, 'מחיר / חודש',    { bg: T.navy });
hdr(ws2, 3, 4, 'COLUMBUS',        { bg: T.green });
ws2.getRow(3).height = 28;

const competitors = [
  ['Bringg',         'ניהול משלוחים + נציגים',          '$500–2,000',  '✅ כן'],
  ['Repsly',         'CRM + ביקורים לנציגים',            '$800–3,000',  '✅ כן'],
  ['BeatRoute',      'ניהול צוות מכירות שטח',            '$300–1,200',  '✅ כן'],
  ['Nielsen Spaceman','פלנוגרמה ועיצוב מדפים',            '$2,000–8,000','✅ כן'],
  ['BlueYonder WMS', 'ניהול מחסן מלא',                    '$5,000+',     '⚠️ חלקי'],
  ['COLUMBUS (שלנו)', 'הכל יחד: נציגים + פלנוגרמה + AI', '🔒 פרטי',    '🏆 מותאם אישית'],
];

competitors.forEach(([sol, what, price, col], i) => {
  const r = i + 4;
  const isOurs = i === competitors.length - 1;
  const bg = isOurs ? T.lgreen : (i % 2 === 0 ? T.white : T.lgray);
  style(cell(ws2,r,1), { v: sol,   bg, border: true, bold: isOurs, align: 'middle', halign: 'right' });
  style(cell(ws2,r,2), { v: what,  bg, border: true, wrap: true, align: 'middle', halign: 'right' });
  style(cell(ws2,r,3), { v: price, bg, border: true, align: 'middle', halign: 'center', color: isOurs ? T.green : T.gray });
  style(cell(ws2,r,4), { v: col,   bg: isOurs ? T.lgreen : bg, border: true, align: 'middle', halign: 'center', bold: isOurs, color: isOurs ? T.green : T.text });
  ws2.getRow(r).height = 24;
});

// Pricing model
ws2.getRow(12).height = 16;
hdr(ws2, 13, 1, 'מודל תמחור מוצע',    { bg: T.navy, size: 12 });
hdr(ws2, 13, 2, 'תיאור',              { bg: T.navy });
hdr(ws2, 13, 3, 'מחיר מוצע / חודש',  { bg: T.navy });
hdr(ws2, 13, 4, 'לקוחות פוטנציאליים', { bg: T.navy });
ws2.getRow(13).height = 28;

const pricing = [
  ['Starter — חברה קטנה',    '1–5 נציגים, מחסן 1, ללא AI מתקדם',   '₪1,500–2,500',  'יבואנים, סיטונאים קטנים'],
  ['Business — חברה בינונית', '5–20 נציגים, 2–3 מחסנות, AI מלא',   '₪4,000–8,000',  'יבואני מזון, מוצרי צריכה'],
  ['Enterprise — כמו FORMULA', '20+ נציגים, מחסן גדול, Fabric',      '₪12,000–20,000', 'רשתות הפצה, יבואנים גדולים'],
  ['SaaS — לקוחות ענן',       'שכירות חודשית, עדכונים אוטומטיים',   'MRR מתצבר',     'שוק רחב, ×10 פוטנציאל'],
];

pricing.forEach(([tier, desc, price, cust], i) => {
  const r = i + 14;
  const bg = i % 2 === 0 ? T.sky : T.white;
  style(cell(ws2,r,1), { v: tier,  bg, border: true, bold: true, align: 'middle', halign: 'right', color: T.blue });
  style(cell(ws2,r,2), { v: desc,  bg, border: true, wrap: true, align: 'middle', halign: 'right' });
  style(cell(ws2,r,3), { v: price, bg, border: true, align: 'middle', halign: 'center', bold: true, color: T.green });
  style(cell(ws2,r,4), { v: cust,  bg, border: true, wrap: true, align: 'middle', halign: 'right', italic: true });
  ws2.getRow(r).height = 26;
});

// Scalability
ws2.getRow(19).height = 16;
ws2.mergeCells('A20:D20');
style(cell(ws2,'A20'), { v: '📈 יכולת הרחבה (Scalability)', bold: true, size: 13, color: T.white, bg: T.lblue, halign: 'right', align: 'middle' });
ws2.getRow(20).height = 30;

const scale = [
  ['קוד לקוח רב-תכלית',   'כל לקוח מקבל instance נפרד — מחיר הוספה: שעות בודדות'],
  ['Power BI / Fabric',     'מתחבר לכל ERP ישראלי: Priority, SAP, חשבשבת'],
  ['אפליקציה מוכנה',       'React Native — iOS + Android מאותו קוד'],
  ['סוכני AI בנויים',      '7 סוכנים פעילים — ניתן להוסיף תחומים חדשים'],
  ['ענן ללא תחזוקה',       'GitHub Actions — אפס תשתית שרתים לקוח'],
];

scale.forEach(([k, v], i) => {
  const r = i + 21;
  const bg = i % 2 === 0 ? T.lgreen : T.white;
  ws2.mergeCells(r, 1, r, 2);
  style(cell(ws2,r,1), { v: '✓ ' + k, bg, border: true, bold: true, align: 'middle', halign: 'right', color: T.green });
  ws2.mergeCells(r, 3, r, 4);
  style(cell(ws2,r,3), { v, bg, border: true, wrap: true, align: 'middle', halign: 'right' });
  ws2.getRow(r).height = 24;
});

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET 4 — אבטחת מידע  (Data Security)
// ═══════════════════════════════════════════════════════════════════════════════
const ws3 = wb.addWorksheet('🔒 אבטחת מידע');
ws3.views = [{ rightToLeft: true }];
ws3.columns = [{ width: 28 }, { width: 50 }, { width: 16 }];

title(ws3, 1, 1, 3, '🔒 אבטחת מידע לקוח', 'מדיניות, הגנות ועמידה בסטנדרטים');

hdr(ws3, 3, 1, 'תחום',         { bg: T.navy });
hdr(ws3, 3, 2, 'פירוט',        { bg: T.navy });
hdr(ws3, 3, 3, 'סטטוס',        { bg: T.navy });
ws3.getRow(3).height = 28;

const security = [
  ['אחסון נתונים',         'נתוני לקוחות נשמרים ב-Microsoft Azure בלבד (Power BI Fabric) — שרתי EU', '✅'],
  ['אין DB מקומי',         'אין שרת SQL פנימי עם נתוני לקוחות — הכל בענן Microsoft מוצפן', '✅'],
  ['הרשאות גישה',          'כל נציג מכירות מחובר דרך Azure AD — הרשאות granular לפי תפקיד', '✅'],
  ['טוקנים מוצפנים',       'PAT / Client Secrets שמורים ב-GitHub Secrets / .env מחוץ לקוד', '✅'],
  ['ללא נתונים בקוד',      'repo לא מכיל סיסמאות, ה-.env ב-.gitignore, אין leaks', '✅'],
  ['גיבוי אוטומטי',        'כל עדכון → commit ב-GitHub = היסטוריית גיבויים מלאה + rollback', '✅'],
  ['הפרדת לקוחות',         'כל לקוח = repo/workspace נפרד — אין גישה צולבת', '✅'],
  ['GDPR / CCPA',          'נתוני לקוחות לא עוברים ממדינה — Azure Israel/EU', '⚠️ בבדיקה'],
  ['הצפנת תקשורת',         'HTTPS בלבד לכל API calls — PBI, GitHub, אפליקציה', '✅'],
  ['ניטור גישה',           'GitHub Actions logs + workflow.log — כל פעולה מתועדת', '✅'],
  ['הגבלת גישה ל-repo',    'repo פרטי — רק בעלי הרשאה יכולים לראות קוד', '✅'],
  ['סיסמאות חזקות',        'Client Secret Azure — rotate כל 6 חודשים (מומלץ)', '⚠️ להגדיר'],
];

security.forEach(([topic, detail, status], i) => {
  const r = i + 4;
  const bg = i % 2 === 0 ? T.white : T.lgray;
  const statusBg = status === '✅' ? T.lgreen : T.lgold;
  const statusFg = status === '✅' ? T.green  : T.gold;
  style(cell(ws3,r,1), { v: topic,  bg, border: true, bold: true, align: 'middle', halign: 'right' });
  style(cell(ws3,r,2), { v: detail, bg, border: true, wrap: true, align: 'middle', halign: 'right' });
  style(cell(ws3,r,3), { v: status, bg: statusBg, border: true, bold: true, align: 'middle', halign: 'center', color: statusFg });
  ws3.getRow(r).height = 26;
});

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET 5 — השקעה וערך  (Investment & Value)
// ═══════════════════════════════════════════════════════════════════════════════
const ws4 = wb.addWorksheet('📈 השקעה וערך');
ws4.views = [{ rightToLeft: true }];
ws4.columns = [{ width: 32 }, { width: 22 }, { width: 22 }, { width: 22 }];

title(ws4, 1, 1, 4, '📈 השקעה, ערך ו-ROI', 'עלות פיתוח, שווי שוק וחזרה על השקעה');

// Dev cost
hdr(ws4, 3, 1, 'פירוט',         { bg: T.navy });
hdr(ws4, 3, 2, 'שעות',          { bg: T.navy });
hdr(ws4, 3, 3, 'שווי ($200/ש)', { bg: T.navy });
hdr(ws4, 3, 4, 'הערות',         { bg: T.navy });
ws4.getRow(3).height = 28;

const devCost = [
  ['Columbus App (ניווט + Fabric)',   17,  3400,  'GPS, API, UI/UX נציגים'],
  ['פלנוגרמה — עורך ו-UX',           38,  7600,  'HTML editor, 4 מחלקות'],
  ['PBI Integration — כל הסניפים',   18,  3600,  'DAX, API, stock/sales'],
  ['Automation — workflow + CI/CD',   12,  2400,  'GitHub Actions, watchdog'],
  ['AI Agents — 7 סוכנים',           8,   1600,  'CEO, geograf, mahsan ועוד'],
  ['תיקונים, בגים, אופטימיזציה',     16,  3200,  'localStorage, git, merges'],
  ['תיעוד, vault, memory',            4,   800,   'CLAUDE.md, VAULT, SKILL.md'],
];

let devTotal = 0, valTotal = 0;
devCost.forEach(([item, hrs, val, note], i) => {
  const r = i + 4;
  const bg = i % 2 === 0 ? T.white : T.lgray;
  style(cell(ws4,r,1), { v: item, bg, border: true, wrap: true, align: 'middle', halign: 'right' });
  style(cell(ws4,r,2), { v: hrs,  bg, border: true, halign: 'center', align: 'middle', numFmt: '0' });
  style(cell(ws4,r,3), { v: val,  bg, border: true, halign: 'center', align: 'middle', numFmt: '"$"#,##0', bold: true, color: T.blue });
  style(cell(ws4,r,4), { v: note, bg, border: true, wrap: true, align: 'middle', halign: 'right', italic: true });
  ws4.getRow(r).height = 24;
  devTotal += hrs; valTotal += val;
});

// Total row
const tr = devCost.length + 4;
style(cell(ws4,tr,1), { v: 'סה"כ', bold: true, size: 13, bg: T.navy, color: T.white, border: true, halign: 'right', align: 'middle' });
style(cell(ws4,tr,2), { v: devTotal, bold: true, size: 13, bg: T.navy, color: T.white, border: true, halign: 'center', align: 'middle', numFmt: '0" ש"' });
style(cell(ws4,tr,3), { v: valTotal, bold: true, size: 13, bg: T.navy, color: T.white, border: true, halign: 'center', align: 'middle', numFmt: '"$"#,##0' });
style(cell(ws4,tr,4), { v: 'שווי שוק מינימלי לפרויקט זה', bold: true, bg: T.navy, color: T.white, border: true, halign: 'right', align: 'middle' });
ws4.getRow(tr).height = 32;

// ROI
ws4.getRow(tr + 2).height = 16;
hdr(ws4, tr + 3, 1, 'תרחיש',         { bg: T.green });
hdr(ws4, tr + 3, 2, 'לקוחות',        { bg: T.green });
hdr(ws4, tr + 3, 3, 'הכנסה / חודש',  { bg: T.green });
hdr(ws4, tr + 3, 4, 'ROI (שנה)',      { bg: T.green });
ws4.getRow(tr + 3).height = 28;

const roi = [
  ['שמרני',    3,  45000,  '×2.5 על ההשקעה'],
  ['סביר',     8,  120000, '×6.5 על ההשקעה'],
  ['אופטימי', 20,  300000, '×16 על ההשקעה'],
];

roi.forEach(([scenario, clients, monthly, roiX], i) => {
  const r = tr + 4 + i;
  const bg = [T.lred, T.lgold, T.lgreen][i];
  style(cell(ws4,r,1), { v: scenario, bg, border: true, bold: true, halign: 'right', align: 'middle' });
  style(cell(ws4,r,2), { v: clients,  bg, border: true, halign: 'center', align: 'middle', numFmt: '0" לקוחות"' });
  style(cell(ws4,r,3), { v: monthly,  bg, border: true, halign: 'center', align: 'middle', bold: true, numFmt: '"₪"#,##0', color: T.green });
  style(cell(ws4,r,4), { v: roiX,     bg, border: true, halign: 'center', align: 'middle', bold: true, color: T.navy });
  ws4.getRow(r).height = 26;
});

// ─── Save ─────────────────────────────────────────────────────────────────────
const OUT = path.join(__dirname, 'COLUMBUS — מסמך מסירת פרויקט.xlsx');
wb.xlsx.writeFile(OUT).then(() => console.log('✅ Saved:', OUT));
