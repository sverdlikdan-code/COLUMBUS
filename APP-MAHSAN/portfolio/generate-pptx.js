const PptxGenJS = require('pptxgenjs');
const pptx = new PptxGenJS();

pptx.layout = 'LAYOUT_WIDE'; // 16:9

const TEAL   = '1B7A7C';
const GREEN  = '7DC242';
const RED    = 'E05252';
const AMBER  = 'F59E0B';
const MUTED  = '6B7A74';
const TEXT   = '111C18';
const BG     = 'F4FAF8';
const BORDER = 'C8D8D4';

function slide1_cover() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  // Left teal half
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '50%', h: '100%', fill: { color: TEAL } });
  s.addText('📡', { x: 1.5, y: 1.2, w: 2, h: 0.8, fontSize: 36, align: 'center' });
  s.addText('ישומית HD · פתרון רכש', { x: 0.3, y: 2.1, w: 4, h: 0.4, fontSize: 10, bold: true, color: 'AADDDB', align: 'center', charSpacing: 3, rtlMode: true });
  s.addText('מכ״ם רכש', { x: 0.3, y: 2.6, w: 4, h: 0.8, fontSize: 34, bold: true, color: 'FFFFFF', align: 'center', rtlMode: true });
  s.addText('PROCUREMENT RADAR', { x: 0.3, y: 3.4, w: 4, h: 0.4, fontSize: 12, bold: true, color: '88BBBB', align: 'center', charSpacing: 3 });
  // Right light half
  s.addText('פתרון לקניין  |  יבואן / מפיץ · 50–500 SKU · Priority ERP', { x: 5.2, y: 1.0, w: 7.5, h: 0.4, fontSize: 10, color: MUTED, align: 'right', rtlMode: true });
  s.addText('תמיד תדע —', { x: 5.2, y: 1.6, w: 7.5, h: 0.9, fontSize: 38, bold: true, color: TEXT, align: 'right', rtlMode: true });
  s.addText('לפני שיגמר.', { x: 5.2, y: 2.5, w: 7.5, h: 0.9, fontSize: 38, bold: true, color: TEAL, align: 'right', rtlMode: true });
  s.addText('מסך אחד לקניין. כל ה-SKU. התראות על גירעונות לפני שקורה — לא אחרי.', { x: 5.2, y: 3.5, w: 7.5, h: 0.6, fontSize: 13, color: MUTED, align: 'right', rtlMode: true });
}

function slide2_pain() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  s.addText('הבעיה', { x: 0.5, y: 0.3, w: 12, h: 0.3, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 3, rtlMode: true });
  s.addText('הקניין שלך עובד בעיוורון', { x: 0.5, y: 0.7, w: 12, h: 0.7, fontSize: 32, bold: true, color: TEXT, align: 'right', rtlMode: true });

  const pains = [
    { icon: '⏳', title: 'ליד טיים ארוך — ריאקציה מאוחרת', text: 'יבואן מחכה 45–90 יום לסחורה. כשרואים גירעון — כבר מאוחר מדי.' },
    { icon: '📊', title: 'נתונים פזורים — אין תמונה אחת', text: 'ERP, אקסל, WhatsApp עם הספק. הקניין פותח 4 מסכים כדי להבין מה להזמין.' },
    { icon: '🔔', title: 'אין התראות — מגיבים לתלונות', text: 'גירעון מגלים כשלקוח מתקשר. לא כשהמלאי מתחיל לרדת.' },
  ];
  pains.forEach((p, i) => {
    const x = 0.4 + i * 4.3;
    s.addShape(pptx.ShapeType.rect, { x, y: 1.6, w: 4.0, h: 2.6, fill: { color: 'FFFFFF' }, line: { color: RED, width: 2 } });
    s.addText(p.icon, { x, y: 1.7, w: 4.0, h: 0.5, fontSize: 22, align: 'center' });
    s.addText(p.title, { x: x + 0.15, y: 2.3, w: 3.7, h: 0.5, fontSize: 12, bold: true, color: TEXT, align: 'right', rtlMode: true });
    s.addText(p.text, { x: x + 0.15, y: 2.9, w: 3.7, h: 0.9, fontSize: 11, color: MUTED, align: 'right', rtlMode: true });
  });
}

function slide3_gap() {
  const s = pptx.addSlide();
  s.addImage({ path: __dirname + '/slide-screenshots/slide-03.png', x: 0, y: 0, w: 13.33, h: 7.5 });
}

function slide4_solution() {
  const s = pptx.addSlide();
  s.addImage({ path: __dirname + '/slide-screenshots/slide-04.png', x: 0, y: 0, w: 13.33, h: 7.5 });
}
function slide4_solution_UNUSED() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  s.addText('הפתרון — מסך הקניין', { x: 0.3, y: 0.18, w: 12.7, h: 0.25, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 3, rtlMode: true });
  s.addText('מסך אחד. כל ה-SKU. סטטוס בזמן אמת.', { x: 0.3, y: 0.45, w: 12.7, h: 0.55, fontSize: 24, bold: true, color: TEXT, align: 'right', rtlMode: true });

  // Header row
  const hdrOpts = { fill: TEAL, color: 'FFFFFF', bold: true, fontSize: 10, align: 'center', valign: 'middle', border: { pt: 0 } };
  const hdrRow = [
    { text: 'פעולה',          options: hdrOpts },
    { text: 'כמות מוצעת',    options: hdrOpts },
    { text: 'סטטוס',         options: hdrOpts },
    { text: 'ימי מלאי',      options: hdrOpts },
    { text: 'ליד טיים',      options: hdrOpts },
    { text: 'מכר/יום',       options: hdrOpts },
    { text: 'מלאי',          options: hdrOpts },
    { text: 'משפחה',         options: hdrOpts },
    { text: 'מוצר',          options: hdrOpts },
  ];

  function makeRow(cells, bg) {
    return cells.map(c => ({
      text: c.text,
      options: {
        fill: c.fill || bg,
        color: c.color || TEXT,
        bold: c.bold || false,
        fontSize: 10,
        align: 'center',
        valign: 'middle',
        border: { pt: 1, color: 'E0ECEB' },
        rtlMode: true,
      }
    }));
  }

  const rows = [
    hdrRow,
    makeRow([
      { text: 'הזמן', color: 'FFFFFF', fill: RED,   bold: true },
      { text: '360 יח', bold: true },
      { text: 'דחוף',   color: 'FFFFFF', fill: RED,   bold: true },
      { text: '16',  color: RED,   bold: true },
      { text: '60' },
      { text: '2.4' },
      { text: '38' },
      { text: 'דרמוקוסמטיקה' },
      { text: "NOAH's Pink Clay Mask" },
    ], 'FFFFFF'),
    makeRow([
      { text: 'הזמן', color: AMBER, bold: true },
      { text: '210 יח', bold: true },
      { text: 'הזמן',   color: 'FFFFFF', fill: AMBER, bold: true },
      { text: '52',  color: AMBER, bold: true },
      { text: '45' },
      { text: '2.8' },
      { text: '145' },
      { text: 'לעיניים' },
      { text: 'I DROP PUR' },
    ], 'FAFAF7'),
    makeRow([
      { text: 'בדוק' },
      { text: '—' },
      { text: 'OK',     color: 'FFFFFF', fill: GREEN, bold: true },
      { text: '161', color: GREEN,  bold: true },
      { text: '60' },
      { text: '1.8' },
      { text: '290' },
      { text: 'ללא מרשם' },
      { text: 'CortinaT' },
    ], 'FFFFFF'),
    makeRow([
      { text: 'הזמן', color: 'FFFFFF', fill: RED,   bold: true },
      { text: '220 יח', bold: true },
      { text: 'דחוף',   color: 'FFFFFF', fill: RED,   bold: true },
      { text: '13',  color: RED,   bold: true },
      { text: '75' },
      { text: '1.9' },
      { text: '24' },
      { text: 'תוספי תזונה' },
      { text: 'Aloe Vera Drink' },
    ], 'FAFAF7'),
    makeRow([
      { text: 'בדוק' },
      { text: '—' },
      { text: 'עודף',   color: 'FFFFFF', fill: '7C3AED', bold: true },
      { text: '1033', color: '7C3AED', bold: true },
      { text: '45' },
      { text: '1.2' },
      { text: '1,240' },
      { text: 'תוספי תזונה' },
      { text: 'Omega 3 Premium' },
    ], 'FFFFFF'),
  ];

  s.addTable(rows, {
    x: 0.15, y: 1.1, w: 12.9,
    rowH: [0.38, 0.42, 0.42, 0.42, 0.42, 0.42],
    colW: [0.95, 1.1, 1.0, 0.95, 0.85, 0.85, 0.85, 1.55, 2.15],
    border: { pt: 0 },
  });

  // Legend bar at bottom
  const legend = [
    { label: 'דחוף — הזמן עכשיו', color: RED },
    { label: 'הזמן — עוד זמן', color: AMBER },
    { label: 'OK — מלאי תקין', color: GREEN },
    { label: 'עודף — אל תזמין', color: '7C3AED' },
  ];
  legend.forEach((l, i) => {
    const x = 0.3 + i * 3.2;
    s.addShape(pptx.ShapeType.rect, { x, y: 4.55, w: 0.18, h: 0.18, fill: { color: l.color } });
    s.addText(l.label, { x: x + 0.24, y: 4.52, w: 2.8, h: 0.24, fontSize: 9, color: MUTED, align: 'left' });
  });
}

function slide5_how() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  s.addText('איך זה עובד', { x: 0.5, y: 0.3, w: 12, h: 0.3, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 3, rtlMode: true });
  s.addText('מהנתונים להזמנה — אוטומטית', { x: 0.5, y: 0.7, w: 12, h: 0.6, fontSize: 28, bold: true, color: TEXT, align: 'right', rtlMode: true });

  const steps = [
    { icon: '🗄️', num: '1', title: 'נתונים', text: 'ERP / Priority → מלאי, מכירות, ספקים' },
    { icon: '🧠', num: '2', title: 'תחזית', text: 'AI מחשב ביקוש ל-90 יום + עונתיות' },
    { icon: '🔔', num: '3', title: 'התראה', text: 'Email לפני שיש גירעון' },
    { icon: '📦', num: '4', title: 'הזמנה', text: 'קניין מאשר → PDF לספק → נרשם בהיסטוריה' },
  ];
  steps.forEach((st, i) => {
    const x = 0.4 + i * 3.15;
    s.addShape(pptx.ShapeType.ellipse, { x: x + 1.1, y: 1.6, w: 0.8, h: 0.8, fill: { color: 'D4EDED' } });
    s.addText(st.icon, { x: x + 1.1, y: 1.6, w: 0.8, h: 0.8, fontSize: 18, align: 'center' });
    s.addText(`${st.num} · ${st.title}`, { x, y: 2.55, w: 3.0, h: 0.35, fontSize: 11, bold: true, color: TEAL, align: 'center' });
    s.addText(st.text, { x, y: 2.95, w: 3.0, h: 0.5, fontSize: 10, color: MUTED, align: 'center', rtlMode: true });
  });

  s.addShape(pptx.ShapeType.rect, { x: 0.4, y: 3.65, w: 6.0, h: 1.0, fill: { color: 'FFFFFF' }, line: { color: BORDER, width: 1 } });
  s.addText('מה המערכת מחשבת', { x: 0.55, y: 3.7, w: 5.7, h: 0.25, fontSize: 9, bold: true, color: TEAL, align: 'left', charSpacing: 2 });
  s.addText('days_left = stock / avg_daily_sales\nif days_left < lead_time → 🔴 DANGER\nif days_left < lead_time × 1.5 → 🟡 WARN', { x: 0.55, y: 3.98, w: 5.7, h: 0.6, fontSize: 9, color: TEXT, align: 'left' });

  s.addShape(pptx.ShapeType.rect, { x: 6.6, y: 3.65, w: 6.2, h: 1.0, fill: { color: 'FFFFFF' }, line: { color: BORDER, width: 1 } });
  s.addText('AI אומר', { x: 6.75, y: 3.7, w: 5.9, h: 0.25, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 2, rtlMode: true });
  s.addText('💬 "Vitamin D — מכירות עלו ×2.4 בנובמבר–ינואר. מומלץ להגדיל safety stock ל-60 יום לפני אוקטובר."', { x: 6.75, y: 3.98, w: 5.9, h: 0.6, fontSize: 10, color: MUTED, align: 'right', rtlMode: true });
}

function slide6_arch() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  s.addText('ארכיטקטורה טכנית', { x: 0.5, y: 0.3, w: 12, h: 0.3, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 3, rtlMode: true });
  s.addText('שלוש שכבות — זרימה אחת', { x: 0.5, y: 0.7, w: 12, h: 0.6, fontSize: 28, bold: true, color: TEXT, align: 'right', rtlMode: true });

  const cards = [
    { x: 0.3, title: 'SQL SERVER', sub: 'Priority ERP', icon: '🗄️', items: ['מלאי בזמן אמת','היסטוריית מכירות 24M','ספקים + ליד טיים'], code: 'Daily SQL sync\nREST API / Direct', featured: false },
    { x: 4.55, title: 'POWER BI FABRIC', sub: 'Semantic Model', icon: '📊', items: ['DAX measures — ימי מלאי','תחזית ביקוש (Prophet)','KPI סטטוסים אוטומטיים','API לאפליקציה'], code: 'executeQueries REST\nBearer token auth', featured: true },
    { x: 8.8, title: 'WEB APP / PWA', sub: 'מכ״ם רכש', icon: '📡', items: ['לוח SKU + סטטוסים','מרכז התראות','Order Builder','Email התראות'], code: 'Node.js + React\nVPS / Azure Cloud', featured: false },
  ];
  cards.forEach(c => {
    s.addShape(pptx.ShapeType.rect, { x: c.x, y: 1.5, w: 4.0, h: 3.0, fill: { color: 'FFFFFF' }, line: { color: c.featured ? TEAL : BORDER, width: c.featured ? 2 : 1 } });
    if (c.featured) s.addText('ANALYTICS LAYER', { x: c.x + 0.8, y: 1.35, w: 2.4, h: 0.28, fontSize: 8, bold: true, color: 'FFFFFF', fill: { color: TEAL }, align: 'center', charSpacing: 1 });
    s.addText(c.icon, { x: c.x + 0.1, y: 1.6, w: 3.8, h: 0.45, fontSize: 20, align: 'center' });
    s.addText(c.title, { x: c.x + 0.1, y: 2.1, w: 3.8, h: 0.3, fontSize: 9, bold: true, color: TEAL, align: 'center', charSpacing: 2 });
    s.addText(c.sub, { x: c.x + 0.1, y: 2.42, w: 3.8, h: 0.35, fontSize: 13, bold: true, color: TEXT, align: 'center', rtlMode: true });
    c.items.forEach((item, ii) => {
      s.addText(`▸ ${item}`, { x: c.x + 0.15, y: 2.85 + ii * 0.28, w: 3.7, h: 0.26, fontSize: 10, color: MUTED, align: 'right', rtlMode: true });
    });
    s.addShape(pptx.ShapeType.rect, { x: c.x + 0.15, y: 4.05, w: 3.7, h: 0.35, fill: { color: 'EEF6F4' } });
    s.addText(c.code, { x: c.x + 0.2, y: 4.07, w: 3.6, h: 0.3, fontSize: 8, color: MUTED, align: 'left' });
  });
  // Arrows
  s.addText('←', { x: 4.1, y: 2.85, w: 0.45, h: 0.4, fontSize: 20, bold: true, color: TEAL, align: 'center' });
  s.addText('←', { x: 8.35, y: 2.85, w: 0.45, h: 0.4, fontSize: 20, bold: true, color: TEAL, align: 'center' });
}

function slide7_hours() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  s.addText('כמה עבודה מאחורי המחיר', { x: 0.3, y: 0.18, w: 8.5, h: 0.25, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 3, rtlMode: true });
  s.addText('אומדן שעות — MVP מלא', { x: 0.3, y: 0.45, w: 8.5, h: 0.55, fontSize: 24, bold: true, color: TEXT, align: 'right', rtlMode: true });

  // 4 columns: # | Phase (Hebrew) | Details (English) | Hours
  // Keeping Hebrew and English in SEPARATE columns to avoid BiDi collision
  const BASE = { fontSize: 10, valign: 'middle', border: { pt: 1, color: 'E0ECEB' } };
  const HDR  = { ...BASE, fill: TEAL, color: 'FFFFFF', bold: true, fontSize: 9, align: 'center' };

  function cell(text, extra = {}) {
    return { text, options: { ...BASE, color: TEXT, align: 'center', fill: 'FFFFFF', ...extra } };
  }

  const phases = [
    { num:'1', he:'תשתית ואימות',        en:'Server, DB, API skeleton, JWT',  h:'15' },
    { num:'2', he:'שכבת Power BI',        en:'PBI Gateway, DAX measures',      h:'20' },
    { num:'3', he:'לוח SKU',              en:'Table, statuses, filters',       h:'30' },
    { num:'4', he:'מנוע התראות',          en:'Email alerts, logic, cron',      h:'15' },
    { num:'5', he:'Order Builder',        en:'Suggested qty, MVP',             h:'10' },
    { num:'6', he:'ניהול ספקים',          en:'Basic table, lead time, MOQ',    h:'5'  },
    { num:'7', he:'ממשק עברי RTL',        en:'Design, responsive, PWA',        h:'15' },
    { num:'8', he:'QA ופריסה',            en:'VPS, HTTPS, security, UAT',      h:'20' },
    { num:'9', he:'הדרכה ואונבורדינג',    en:'1 session + video tutorial',     h:'5'  },
  ];

  const tableRows = [
    [
      { text: '#',         options: HDR },
      { text: 'פאזה',      options: { ...HDR } },
      { text: 'מה כלול',   options: HDR },
      { text: 'שעות',      options: HDR },
    ],
    ...phases.map((p, i) => {
      const bg = i % 2 === 0 ? 'FFFFFF' : 'F4FAF8';
      return [
        cell(p.num,  { fill: bg, color: MUTED, fontSize: 9 }),
        cell(p.he,   { fill: bg, color: TEXT,  bold: true,  align: 'right', rtlMode: true }),
        cell(p.en,   { fill: bg, color: MUTED, align: 'left' }),
        cell(p.h,    { fill: bg, color: TEXT,  bold: true }),
      ];
    }),
    [
      { text: '',          options: { ...BASE, fill: 'EBF5F3', border: { pt: 0 } } },
      { text: 'MVP סה״כ',  options: { ...BASE, fill: 'EBF5F3', color: TEAL, bold: true, fontSize: 11, align: 'right', rtlMode: true, border: { pt: 0 } } },
      { text: '',          options: { ...BASE, fill: 'EBF5F3', border: { pt: 0 } } },
      { text: '135',       options: { ...BASE, fill: 'EBF5F3', color: TEAL, bold: true, fontSize: 14, align: 'center', border: { pt: 0 } } },
    ],
  ];

  s.addTable(tableRows, {
    x: 0.15, y: 1.05, w: 8.8,
    rowH: [0.32, ...phases.map(() => 0.38), 0.38],
    colW: [0.4, 2.2, 4.5, 0.8],
    border: { pt: 0 },
  });

  // Right side price box — unchanged
  s.addShape(pptx.ShapeType.rect, { x: 9.2, y: 1.05, w: 3.6, h: 2.9, fill: { color: 'FFFFFF' }, line: { color: TEAL, width: 2 } });
  s.addText('המחיר שלנו', { x: 9.3, y: 1.15, w: 3.4, h: 0.28, fontSize: 9, bold: true, color: TEAL, align: 'center', charSpacing: 2 });
  s.addText('20,000', { x: 9.3, y: 1.45, w: 3.4, h: 0.7, fontSize: 36, bold: true, color: TEAL, align: 'center' });
  s.addText('₪ — הטמעה חד-פעמית', { x: 9.3, y: 2.2, w: 3.4, h: 0.3, fontSize: 11, color: MUTED, align: 'center', rtlMode: true });
  s.addText('800₪/חודש — תמיכה ועדכונים', { x: 9.3, y: 2.55, w: 3.4, h: 0.28, fontSize: 11, bold: true, color: GREEN, align: 'center', rtlMode: true });
  s.addShape(pptx.ShapeType.rect, { x: 9.3, y: 2.9, w: 3.4, h: 0.9, fill: { color: 'EEF6F4' } });
  s.addText('6-8 שבועות לסיום', { x: 9.3, y: 2.95, w: 3.4, h: 0.28, fontSize: 10, color: MUTED, align: 'center', rtlMode: true });
  s.addText('Priority ERP מבפנים', { x: 9.3, y: 3.25, w: 3.4, h: 0.28, fontSize: 10, color: MUTED, align: 'center', rtlMode: true });
  s.addText('קוד שלכם, שרת שלכם', { x: 9.3, y: 3.55, w: 3.4, h: 0.28, fontSize: 10, bold: true, color: TEAL, align: 'center', rtlMode: true });
}

function slide8_pricing() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  s.addText('מחירים', { x: 0.5, y: 0.3, w: 12, h: 0.3, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 3, rtlMode: true });
  s.addText('מחיר סטארט-אפ — מומחיות אמיתית', { x: 0.5, y: 0.7, w: 12, h: 0.6, fontSize: 28, bold: true, color: TEXT, align: 'right', rtlMode: true });

  // Card 1: SETUP + FORECAST 20K
  s.addShape(pptx.ShapeType.rect, { x: 1.5, y: 1.5, w: 5.0, h: 3.2, fill: { color: 'FFFFFF' }, line: { color: TEAL, width: 2 } });
  s.addText('מומלץ', { x: 3.3, y: 1.35, w: 1.4, h: 0.28, fontSize: 9, bold: true, color: 'FFFFFF', fill: { color: TEAL }, align: 'center' });
  s.addText('SETUP + FORECAST', { x: 1.6, y: 1.6, w: 4.8, h: 0.3, fontSize: 10, bold: true, color: MUTED, align: 'center', charSpacing: 1 });
  s.addText('20K', { x: 1.6, y: 1.95, w: 4.8, h: 0.8, fontSize: 46, bold: true, color: TEAL, align: 'center' });
  s.addText('₪ — הטמעה + מנוע חיזוי', { x: 1.6, y: 2.8, w: 4.8, h: 0.3, fontSize: 11, color: MUTED, align: 'center', rtlMode: true });
  const f1 = ['הכל ב-SETUP +','תחזית ביקוש 90 יום','זיהוי עונתיות אוטומטי','AI אינסייטים על SKU','זיהוי עודפי מלאי (Slow Movers)'];
  f1.forEach((f, i) => s.addText(`✓  ${f}`, { x: 1.7, y: 3.15 + i * 0.27, w: 4.6, h: 0.25, fontSize: 11, color: MUTED, align: 'right', rtlMode: true }));

  // Card 2: Support 800
  s.addShape(pptx.ShapeType.rect, { x: 7.2, y: 1.5, w: 5.0, h: 3.2, fill: { color: 'FFFFFF' }, line: { color: BORDER, width: 1 } });
  s.addText('תמיכה שוטפת', { x: 7.3, y: 1.6, w: 4.8, h: 0.3, fontSize: 10, bold: true, color: MUTED, align: 'center', charSpacing: 1 });
  s.addText('800', { x: 7.3, y: 1.95, w: 4.8, h: 0.8, fontSize: 46, bold: true, color: TEAL, align: 'center' });
  s.addText('₪/חודש — אחרי האישור הסופי', { x: 7.3, y: 2.8, w: 4.8, h: 0.3, fontSize: 11, color: MUTED, align: 'center', rtlMode: true });
  const f2 = ['הרצת שרת + דאטה יומי','עדכוני מודל חיזוי','תמיכה שוטפת','גיבויים אוטומטיים'];
  f2.forEach((f, i) => s.addText(`✓  ${f}`, { x: 7.3, y: 3.15 + i * 0.27, w: 4.6, h: 0.25, fontSize: 11, color: MUTED, align: 'right', rtlMode: true }));
}

function slide9_quote() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  s.addText('הצעת מחיר רשמית', { x: 0.5, y: 0.3, w: 12, h: 0.3, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 3, rtlMode: true });
  s.addText('הצעת מחיר — מכ״ם רכש', { x: 0.5, y: 0.65, w: 12, h: 0.55, fontSize: 26, bold: true, color: TEXT, align: 'right', rtlMode: true });

  // Left: breakdown
  s.addShape(pptx.ShapeType.rect, { x: 0.3, y: 1.35, w: 6.2, h: 3.5, fill: { color: 'FFFFFF' }, line: { color: BORDER, width: 1 } });
  s.addText('פירוט השירותים', { x: 0.45, y: 1.45, w: 5.9, h: 0.3, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 2, rtlMode: true });
  const items = [
    ['Setup — לוח SKU, ERP, סטטוסים, Email','15,000₪'],
    ['Forecast — תחזית 90 יום + AI אינסייטס','+3,000₪'],
    ['Order Builder MVP — כמות מוצעת','+2,000₪'],
    ['הדרכה + תיעוד משתמש','כלול'],
  ];
  items.forEach((item, i) => {
    s.addText(item[0], { x: 0.45, y: 1.85 + i * 0.42, w: 4.5, h: 0.38, fontSize: 11, color: TEXT, align: 'right', rtlMode: true });
    s.addText(item[1], { x: 5.0, y: 1.85 + i * 0.42, w: 1.3, h: 0.38, fontSize: 11, bold: true, color: TEAL, align: 'left' });
  });
  s.addShape(pptx.ShapeType.rect, { x: 0.3, y: 3.65, w: 6.2, h: 0.5, fill: { color: 'EBF5F3' } });
  s.addText('סה"כ הטמעה', { x: 0.45, y: 3.68, w: 3.5, h: 0.42, fontSize: 13, bold: true, color: TEXT, align: 'right', rtlMode: true });
  s.addText('20,000₪', { x: 4.2, y: 3.68, w: 2.1, h: 0.42, fontSize: 20, bold: true, color: TEAL, align: 'left' });
  s.addText('תמיכה שוטפת + עדכונים (חודשי)   800₪/חודש', { x: 0.45, y: 4.2, w: 5.9, h: 0.35, fontSize: 11, color: MUTED, align: 'right', rtlMode: true });

  // Right: terms
  s.addShape(pptx.ShapeType.rect, { x: 6.8, y: 1.35, w: 5.9, h: 2.0, fill: { color: 'FFFFFF' }, line: { color: BORDER, width: 1 } });
  s.addText('לוח זמנים ואספקה', { x: 6.95, y: 1.45, w: 5.6, h: 0.28, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 2, rtlMode: true });
  const timeline = ['שבועות 1–2 — תשתית + חיבור Priority','שבועות 3–4 — לוח SKU + סטטוסים + התראות','שבועות 5–8 — Order Builder + Forecast + QA','3 חודשי ניסיון — פיתוח ממשיך','אישור לקוח — מסירה סופית + Go-Live מלא'];
  timeline.forEach((t, i) => s.addText(`${['1','2','3','⏱','✓'][i]}  ${t}`, { x: 6.95, y: 1.78 + i * 0.28, w: 5.6, h: 0.26, fontSize: 10, color: MUTED, align: 'right', rtlMode: true }));

  s.addShape(pptx.ShapeType.rect, { x: 6.8, y: 3.45, w: 5.9, h: 1.1, fill: { color: 'FFFFFF' }, line: { color: BORDER, width: 1 } });
  s.addText('תנאי תשלום', { x: 6.95, y: 3.52, w: 5.6, h: 0.28, fontSize: 9, bold: true, color: TEAL, align: 'right', charSpacing: 2, rtlMode: true });
  s.addText('💳 50% בחתימה (10,000₪) — תחילת עבודה', { x: 6.95, y: 3.83, w: 5.6, h: 0.25, fontSize: 10, color: MUTED, align: 'right', rtlMode: true });
  s.addText('⏱ 3 חודשי ניסיון — מערכת חיה, לא משלמים', { x: 6.95, y: 4.1, w: 5.6, h: 0.25, fontSize: 10, color: MUTED, align: 'right', rtlMode: true });
  s.addText('💳 50% באישור (10,000₪) — רק אחרי שמרוצים', { x: 6.95, y: 4.37, w: 5.6, h: 0.25, fontSize: 10, color: MUTED, align: 'right', rtlMode: true });
}

function slide10_contact() {
  const s = pptx.addSlide();
  s.background = { fill: TEAL };
  s.addText('מכ״ם רכש', { x: 0.5, y: 0.8, w: 12, h: 0.7, fontSize: 32, bold: true, color: 'FFFFFF', align: 'right', rtlMode: true });
  s.addText('תחזית.', { x: 0.5, y: 1.6, w: 12, h: 0.9, fontSize: 46, bold: true, color: GREEN, align: 'right', rtlMode: true });
  s.addText('שליטה. תוצאות.', { x: 0.5, y: 2.5, w: 12, h: 0.9, fontSize: 46, bold: true, color: 'FFFFFF', align: 'right', rtlMode: true });

  const contacts = [
    { lbl: 'חברה', val: 'ישומית HD' },
    { lbl: 'טלפון', val: '08-669-98-55' },
    { lbl: 'נייד / וואטסאפ', val: '052-51-888-62' },
    { lbl: 'מייל', val: 'office@yissumithd.co.il' },
  ];
  contacts.forEach((c, i) => {
    const x = 0.5 + i * 3.2;
    s.addText(c.lbl, { x, y: 3.65, w: 3.0, h: 0.25, fontSize: 9, color: 'AADDDB', align: 'right', rtlMode: true, charSpacing: 2 });
    s.addText(c.val, { x, y: 3.93, w: 3.0, h: 0.35, fontSize: 14, bold: true, color: 'FFFFFF', align: 'right', rtlMode: true });
  });
  s.addText('ראשון לציון · בניין METRO צרפתי · פאול גרוניגר 4 · קומה 3 · יחידה 303', { x: 0.5, y: 4.55, w: 12, h: 0.25, fontSize: 9, color: '6AACAC', align: 'right', rtlMode: true });
}

// Build all slides
slide1_cover();
slide2_pain();
slide3_gap();
slide4_solution();
slide5_how();
slide6_arch();
slide7_hours();
slide8_pricing();
slide9_quote();
slide10_contact();

const outPath = __dirname + '\\procurement-radar-pitch.pptx';
pptx.writeFile({ fileName: outPath })
  .then(() => console.log('✅ PPTX saved:', outPath))
  .catch(e => console.error('❌ Error:', e));
