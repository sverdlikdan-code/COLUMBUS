const PptxGenJS = require('pptxgenjs');
const path = require('path');
const fs = require('fs');

const ASSETS = path.resolve(__dirname, 'portfolio/screenshots');
const OUT    = path.resolve(__dirname, 'portfolio/yissumit-hd-presentation-he.pptx');

const C = {
  TEAL:    '1B7A7C',
  GREEN:   '7DC242',
  OLIVE:   '5C7A2E',
  TEXT:    '162620',
  MUTED:   '4A6E64',
  BG:      'F3F9F7',
  FAINT:   'E5EFEd',
  BORDER:  'C4DAD4',
  WHITE:   'FFFFFF',
  DARK:    '115C5E',
  DIMTEAL: 'DFF0F1',
};

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5

// ─── helpers ────────────────────────────────────────────────────────────────
function bg(s, color) {
  s.background = { color };
}

function rect(s, x, y, w, h, fill) {
  s.addShape('rect', { x, y, w, h, fill: { color: fill }, line: { type: 'none' } });
}

function sep(s, x, y, w) {
  rect(s, x, y, w, 0.015, C.BORDER);
}

function img(s, file, x, y, w, h, opts = {}) {
  const p = path.join(ASSETS, file);
  if (fs.existsSync(p)) s.addImage({ path: p, x, y, w, h, ...opts });
}

function txt(s, text, x, y, w, h, opts = {}) {
  s.addText(text, { x, y, w, h, fontFace: 'Arial', ...opts });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 1 — COVER
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();

  // Left teal half
  rect(s, 0, 0, 6.665, 7.5, C.TEAL);

  // Logo white box
  rect(s, 2.28, 1.3, 2.07, 0.72, C.WHITE);
  img(s, 'yissumit-logo.png', 2.36, 1.35, 1.9, 0.62);

  // Company name
  txt(s, 'ישומית', 0.5, 2.25, 5.665, 0.9, {
    fontSize: 38, bold: true, color: C.WHITE, align: 'center', rtlMode: true,
  });
  txt(s, 'HD', 0.5, 3.0, 5.665, 0.85, {
    fontSize: 38, bold: true, color: C.GREEN, align: 'center',
  });
  txt(s, 'הדרכה ופתרונות', 0.5, 3.85, 5.665, 0.4, {
    fontSize: 10, bold: true, color: 'FFFFFF', charSpacing: 2.5, align: 'center', rtlMode: true,
    transparency: 45,
  });

  // Priority partner
  rect(s, 1.7, 5.55, 3.265, 0.58, C.WHITE);
  img(s, 'priority-partner-dark.png', 1.78, 5.6, 3.1, 0.48);

  // Right light half
  rect(s, 6.665, 0, 6.665, 7.5, C.BG);

  // Headline
  txt(s, 'מערכות', 6.9, 1.55, 6.1, 1.05, {
    fontSize: 58, bold: true, color: C.TEXT, align: 'right', rtlMode: true,
  });
  txt(s, 'BI + Apps', 6.9, 2.52, 6.1, 1.05, {
    fontSize: 58, bold: true, color: C.TEAL, align: 'right',
  });

  // Subline
  txt(s, 'מהשרת עד הדשבורד — מחבר אחד.\nPriority ERP לדשבורדים חיים ואפליקציות שטח.', 7.2, 3.75, 5.7, 1.1, {
    fontSize: 14, color: C.MUTED, align: 'right', rtlMode: true,
    paraSpaceAfter: 4,
  });

  // Tags
  const tags = ['Priority ERP', 'SQL Server', 'Power BI Fabric', 'PWA App'];
  tags.forEach((tag, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col === 0 ? 10.5 : 7.5;
    rect(s, x - 0.08, 5.08 + row * 0.5, 2.65, 0.38, C.DIMTEAL);
    txt(s, tag, x, 5.11 + row * 0.5, 2.5, 0.32, {
      fontSize: 9, bold: true, color: C.TEAL, align: 'center', charSpacing: 1.5,
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 2 — DEMING QUOTE
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  rect(s, 0, 0, 13.33, 7.5, C.TEAL);

  txt(s, 'W. EDWARDS DEMING', 1, 1.1, 11.33, 0.45, {
    fontSize: 10, bold: true, color: C.WHITE, align: 'center', charSpacing: 3.5, transparency: 50,
  });

  txt(s, [
    { text: '"In God we trust.\nAll others must\n', options: { color: C.WHITE } },
    { text: 'bring data."',                          options: { color: C.GREEN } },
  ], 1.5, 1.7, 10.33, 3.5, {
    fontSize: 46, bold: true, align: 'center', paraSpaceBefore: 6, paraSpaceAfter: 6,
  });

  txt(s, 'באלוהים בוטחים — כל השאר חייבים להביא נתונים.', 1.5, 5.35, 10.33, 0.75, {
    fontSize: 16, color: C.WHITE, align: 'center', rtlMode: true, transparency: 45,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 3 — מי אנחנו
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  rect(s, 0, 0, 13.33, 7.5, C.BG);

  txt(s, 'מי אנחנו', 1.0, 0.55, 11.33, 0.38, {
    fontSize: 10, bold: true, color: C.TEAL, align: 'right', rtlMode: true, charSpacing: 3,
  });
  txt(s, 'מומחיות אמיתית — ‫בתחום אחד‬', 1.0, 0.92, 11.33, 1.0, {
    fontSize: 42, bold: true, color: C.TEXT, align: 'right', rtlMode: true,
  });

  const rows = [
    { n: '01', t: 'תחום אחד לעומק — הפצה · יבוא · מסחר', b: 'לא עובדים עם כולם. המגרש שלנו הוא הפצה ומסחר — ויש לנו מומחיות אמיתית בו.' },
    { n: '02', t: 'שותפי Priority מורשים עם אנליסטים פעילים בשטח', b: 'ישומית HD היא שותפת Priority מורשית. חלק מהצוות עובד כאנליסטים פעילים בחברות הפצה — מכירים את הנתונים מבפנים.' },
    { n: '03', t: 'עובדים איתכם — לא בשבילכם', b: '30% מהזמן שלנו — סשנים משותפים על ה-KPIs שלכם. מדד האיכות שלנו הוא הטמעה מוצלחת.' },
  ];

  rows.forEach(({ n, t, b }, i) => {
    const y = 2.2 + i * 1.5;
    sep(s, 1.0, y, 11.33);
    txt(s, n, 1.0, y + 0.12, 0.65, 0.8, { fontSize: 22, bold: true, color: 'B0D0CC', align: 'left' });
    txt(s, t, 1.85, y + 0.1, 10.3, 0.48, { fontSize: 15, bold: true, color: C.TEXT, align: 'right', rtlMode: true });
    txt(s, b, 1.85, y + 0.55, 10.3, 0.75, { fontSize: 13, color: C.MUTED, align: 'right', rtlMode: true });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 4 — מה אנחנו עושים
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  rect(s, 0, 0, 13.33, 7.5, C.BG);

  txt(s, 'מה אנחנו עושים', 1.0, 0.55, 11.33, 0.38, {
    fontSize: 10, bold: true, color: C.TEAL, align: 'right', rtlMode: true, charSpacing: 3,
  });
  txt(s, 'מהשרת עד הדשבורד — מחבר אחד', 1.0, 0.92, 11.33, 0.95, {
    fontSize: 38, bold: true, color: C.TEXT, align: 'right', rtlMode: true,
  });

  // Left: numbered items
  const items = [
    { n: '01', t: 'מכירים את Priority מבפנים', b: 'כולל הנתונים שמצריכים נורמליזציה לפני האנליטיקה. מחברים ישירות ל-SQL, בונים מודל נקי.' },
    { n: '02', t: 'בונים ומאוטומטים הכל', b: 'Power BI Fabric · Power Automate · Power Apps · אפליקציות PWA לשטח — עובד לבד, ללא ייצוא ידני.' },
  ];
  items.forEach(({ n, t, b }, i) => {
    const y = 2.35 + i * 1.65;
    sep(s, 0.8, y, 5.9);
    txt(s, n, 0.8, y + 0.1, 0.6, 0.75, { fontSize: 20, bold: true, color: 'B0D0CC', align: 'left' });
    txt(s, t, 1.55, y + 0.08, 5.2, 0.44, { fontSize: 14, bold: true, color: C.TEXT, align: 'right', rtlMode: true });
    txt(s, b, 1.55, y + 0.5,  5.2, 0.85, { fontSize: 12, color: C.MUTED, align: 'right', rtlMode: true });
  });

  // Right: stack
  const primary = ['Priority ERP'];
  const secondary = ['SQL Server', 'Power BI Fabric', 'Power Automate · Power Apps', 'PWA Apps לשטח', 'Servers · Infrastructure · Data Security'];

  primary.forEach((t, i) => {
    rect(s, 7.2, 2.35 + i * 0.58, 5.7, 0.48, C.DIMTEAL);
    txt(s, t, 7.3, 2.39 + i * 0.58, 5.5, 0.4, { fontSize: 12, bold: true, color: C.TEAL, fontFace: 'Courier New' });
  });
  secondary.forEach((t, i) => {
    rect(s, 7.2, 3.02 + i * 0.58, 5.7, 0.48, C.FAINT);
    txt(s, t, 7.3, 3.06 + i * 0.58, 5.5, 0.4, { fontSize: 12, color: C.MUTED, fontFace: 'Courier New' });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 5 — בפועל
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  rect(s, 0, 0, 13.33, 7.5, C.BG);

  txt(s, 'פרויקט אמיתי — דיסטריביוטור ישראלי', 1.0, 0.5, 11.33, 0.38, {
    fontSize: 10, bold: true, color: C.TEAL, align: 'right', rtlMode: true, charSpacing: 2.5,
  });
  txt(s, 'לא פיילוט.\nמערכת עובדת.', 1.0, 0.88, 3.5, 1.3, {
    fontSize: 34, bold: true, color: C.TEXT, align: 'right', rtlMode: true,
  });

  // Big numbers
  txt(s, '27', 0.5, 2.35, 3.0, 1.2, { fontSize: 82, bold: true, color: C.TEAL, align: 'right' });
  txt(s, 'משתמשים פעילים יומיומיים', 0.5, 3.45, 3.0, 0.38, {
    fontSize: 10, color: C.MUTED, align: 'right', rtlMode: true,
  });

  txt(s, '30', 0.5, 3.95, 3.0, 1.2, { fontSize: 82, bold: true, color: C.TEAL, align: 'right' });
  txt(s, 'דשבורדים בייצור', 0.5, 5.05, 3.0, 0.38, {
    fontSize: 10, color: C.MUTED, align: 'right', rtlMode: true,
  });

  // Checklist
  const checks = [
    'מכירות · כספים · רכש · מחסן · הנהלה',
    'P&L · Lost Sales · מלאי חי · Intercompany',
    'חיבור ישיר ל-Priority · ללא ייצוא ידני',
  ];
  checks.forEach((c, i) => {
    const y = 5.6 + i * 0.53;
    sep(s, 0.4, y, 3.2);
    txt(s, '✓', 0.4, y + 0.08, 0.38, 0.38, { fontSize: 13, bold: true, color: C.TEAL });
    txt(s, c, 0.82, y + 0.08, 2.8, 0.38, { fontSize: 11, color: C.MUTED, align: 'right', rtlMode: true });
  });

  // Dashboard screenshot
  img(s, 'pbi-usage-report.png', 3.9, 1.8, 9.1, 5.35);
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 6 — CONTACT
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  rect(s, 0, 0, 13.33, 7.5, C.TEAL);
  rect(s, 0, 4.2, 13.33, 3.3, C.DARK);

  // Brand
  rect(s, 0.75, 0.8, 1.7, 0.65, C.WHITE);
  img(s, 'yissumit-logo.png', 0.83, 0.85, 1.54, 0.55);
  txt(s, 'ישומית HD', 2.65, 0.85, 5.5, 0.65, {
    fontSize: 28, bold: true, color: C.WHITE, rtlMode: true,
  });

  // Slogan
  txt(s, [
    { text: 'אחריות', options: { color: C.GREEN } },
    { text: ' · ביצוע · תוצאות', options: { color: C.WHITE } },
  ], 0.6, 1.7, 12.0, 1.9, {
    fontSize: 66, bold: true, rtlMode: true,
  });

  // Divider
  sep(s, 0.6, 3.75, 12.13);

  // Contact items
  const contacts = [
    { lbl: 'טלפון', val: '08-669-98-55' },
    { lbl: 'נייד / וואטסאפ', val: '052-51-888-62' },
    { lbl: 'מייל', val: 'office@yissumithd.co.il' },
  ];
  contacts.forEach(({ lbl, val }, i) => {
    const x = 0.7 + i * 3.9;
    txt(s, lbl, x, 3.9, 3.6, 0.32, {
      fontSize: 9, bold: true, color: C.WHITE, charSpacing: 2, transparency: 50,
    });
    txt(s, val, x, 4.22, 3.6, 0.52, { fontSize: 15, bold: true, color: C.WHITE });
  });

  // Address
  txt(s, 'ראשון לציון · בניין METRO צרפתי · פאול גרוניגר 4 · קומה 3 · יחידה 303', 0.6, 5.4, 12.13, 0.45, {
    fontSize: 11, color: C.WHITE, align: 'right', rtlMode: true, transparency: 60,
  });
}

// ─── save ────────────────────────────────────────────────────────────────────
pptx.writeFile({ fileName: OUT })
  .then(() => console.log('PPTX saved:', OUT))
  .catch(e => { console.error(e); process.exit(1); });
