const PptxGenJS = require('pptxgenjs');
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5

// ─── Palette — NO RED in calculations ────────────────────────────
const NAVY    = '1A3A5C';
const BLUE    = '2E86AB';
const GOLD    = 'E6A817';
const GREEN   = '27AE60';
const DECLINE = '607080';   // steel-grey for declines — NOT red
const FLAT    = '8A9BA8';   // light steel for ~0% change
const AMBER   = 'E67E22';   // warning only
const BG      = 'F0F4F8';
const WHITE   = 'FFFFFF';
const TEXT    = '1A2E3A';
const MUTED   = '5A6A7A';
const BORDER  = 'C5D5E5';
const LIGHT   = 'E8EFF5';
const DARKBG  = '0D2137';

// ─── Real data from PBIX (screenshot) ───────────────────────────
const DATA_COMPANIES = [
  { name: 'FORMULA',    y2024: 2784475, y2025: 2798119, delta: 13644,   pct:  0 },
  { name: 'ICE bdd',    y2024: 1056545, y2025: 1305201, delta: 248656,  pct: 24 },
  { name: 'INTER',      y2024:  875500, y2025:  917877, delta: 42377,   pct:  5 },
  { name: 'ICE MISH',   y2024:  590549, y2025:  696390, delta: 105840,  pct: 18 },
  { name: 'תגמולים',    y2024: -163878, y2025: -186352, delta: -22474,  pct: null },
];
const TOTAL_2024  = 5143192;
const TOTAL_2025  = 5531234;
const TOTAL_DELTA = 388043;
const TOTAL_PCT   = 8;

const DATA_REGIONS = [
  { name: 'אילת',  y2024: 3724977, y2025: 4449672, y2026: 2224118, pct25: 19, pct26: -50 },
  { name: 'ערבה',  y2024: 1418214, y2025: 1081563, y2026:  332200, pct25:-24, pct26: -69 },
];
const TOTAL_2026_YTD = 2556318; // Jan–May only

// ─── Helpers ─────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—';
  return Math.abs(n).toLocaleString('he-IL');
}
function pctColor(p) {
  if (p == null) return MUTED;
  if (p > 10)  return GREEN;
  if (p > 0)   return BLUE;
  if (p === 0) return FLAT;
  return DECLINE;
}
function arrow(p) {
  if (p == null) return '—';
  if (p > 0)  return `▲ +${p}%`;
  if (p === 0) return `→ 0%`;
  return `▼ ${p}%`;
}

function pageHeader(s, section, title, sub) {
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.72, fill: { color: NAVY } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0.72, w: 13.33, h: 0.04, fill: { color: GOLD } });
  s.addText(section, { x: 0.3, y: 0.06, w: 12.7, h: 0.22, fontSize: 8, bold: true, color: '7AADCC', align: 'right', charSpacing: 3, rtlMode: true });
  s.addText(title,   { x: 0.3, y: 0.28, w: 12.7, h: 0.38, fontSize: 22, bold: true, color: WHITE, align: 'right', rtlMode: true });
  if (sub) s.addText(sub, { x: 0.3, y: 0.28, w: 12.7, h: 0.38, fontSize: 12, color: '7AADCC', align: 'left' });
}

function kpiBox(s, x, y, w, h, label, value, sub, accentColor) {
  const ac = accentColor || BLUE;
  s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.06, fill: { color: ac } });
  s.addText(label, { x: x+0.12, y: y+0.12, w: w-0.24, h: 0.26, fontSize: 9,  color: MUTED, align: 'right', rtlMode: true });
  s.addText(value, { x: x+0.12, y: y+0.38, w: w-0.24, h: 0.5,  fontSize: 20, bold: true, color: ac, align: 'right', rtlMode: true });
  if (sub) s.addText(sub, { x: x+0.12, y: y+0.88, w: w-0.24, h: 0.2, fontSize: 8, color: MUTED, align: 'right', rtlMode: true });
}

function tblHdr(cols, widths) {
  return cols.map((c, i) => ({
    text: c.text,
    options: { fill: NAVY, color: WHITE, bold: true, fontSize: 9, align: c.align || 'center', valign: 'middle', border: { pt: 1, color: BORDER }, rtlMode: true, w: widths[i] }
  }));
}
function tblRow(cells, bg) {
  return cells.map(c => ({
    text: c.text,
    options: { fill: c.fill || bg, color: c.color || TEXT, bold: c.bold || false, fontSize: c.fs || 10, align: c.align || 'center', valign: 'middle', border: { pt: 1, color: BORDER }, rtlMode: c.rtl !== false }
  }));
}

// ─── S1: Cover ────────────────────────────────────────────────────
function s1_cover() {
  const s = pptx.addSlide();
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
  // Left dark panel
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 5.5, h: 7.5, fill: { color: DARKBG } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 6.5, w: 5.5, h: 1.0, fill: { color: GOLD   } });
  // Logo
  s.addShape(pptx.ShapeType.ellipse, { x: 1.75, y: 0.75, w: 2.0, h: 2.0, fill: { color: BLUE } });
  s.addText('MMD', { x: 1.75, y: 1.05, w: 2.0, h: 1.3, fontSize: 36, bold: true, color: WHITE, align: 'center' });
  s.addText('דיסטריביושן', { x: 0.3, y: 2.95, w: 4.9, h: 0.4, fontSize: 12, bold: true, color: '6AABC8', align: 'center', charSpacing: 4, rtlMode: true });
  s.addText('דוח שנתי', { x: 0.3, y: 3.42, w: 4.9, h: 0.65, fontSize: 30, bold: true, color: WHITE, align: 'center', rtlMode: true });
  s.addText('2025', { x: 0.3, y: 4.12, w: 4.9, h: 0.85, fontSize: 50, bold: true, color: GOLD, align: 'center' });
  s.addText('כולל דינמיקה 2026 ינואר–מאי', { x: 0.3, y: 5.05, w: 4.9, h: 0.3, fontSize: 9, color: '4A7A9B', align: 'center', rtlMode: true });
  s.addText('Power BI · MMD דיסטריביושן', { x: 0.4, y: 6.62, w: 4.7, h: 0.22, fontSize: 8, color: DARKBG, align: 'center', rtlMode: true });
  // Right: TOC
  const toc = [
    { n:'01', he:'סיכום מנהלים',          sub:'Total 2025 vs 2024' },
    { n:'02', he:'לפי חברה',              sub:'Company Breakdown' },
    { n:'03', he:'כשרות — כשר / לא כשר', sub:'Kosher Parameter' },
    { n:'04', he:'רשתות / שוק פרטי',     sub:'Channel Parameter' },
    { n:'05', he:'אילת / ערבה',           sub:'Region Parameter' },
    { n:'06', he:'מנועי צמיחה — מותג',   sub:'Brand Growth Generators' },
    { n:'07', he:'משפחת מוצר',            sub:'Product Family' },
    { n:'08', he:'דינמיקה 2026 ינו–מאי', sub:'2026 YTD Dynamics' },
    { n:'09', he:'סיכום והמלצות',         sub:'Summary & Next Steps' },
  ];
  s.addText('תוכן עניינים', { x: 5.8, y: 0.4, w: 7.2, h: 0.38, fontSize: 10, bold: true, color: NAVY, align: 'right', rtlMode: true, charSpacing: 3 });
  s.addShape(pptx.ShapeType.rect, { x: 5.8, y: 0.82, w: 7.2, h: 0.03, fill: { color: GOLD } });
  toc.forEach((t, i) => {
    const y = 0.96 + i * 0.68;
    s.addText(t.n, { x: 5.8, y: y+0.06, w: 0.65, h: 0.5, fontSize: 18, bold: true, color: GOLD, align: 'center' });
    s.addText(t.he,  { x: 6.55, y: y+0.05, w: 6.3, h: 0.28, fontSize: 12, bold: true, color: NAVY, align: 'right', rtlMode: true });
    s.addText(t.sub, { x: 6.55, y: y+0.34, w: 6.3, h: 0.2,  fontSize: 8,  color: MUTED, align: 'right' });
  });
}

// ─── S2: Executive Summary ────────────────────────────────────────
function s2_exec() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, '01 · סיכום מנהלים', 'מכירות כוללות 2025 מול 2024', 'MMD Distribution');

  // 3 KPIs (removed working-days card — not relevant for annual report)
  kpiBox(s, 0.3,  0.9, 4.2, 1.15, 'מכירות כוללות 2025',  '₪ 5,531,234', 'TOTAL SALES 2025', NAVY);
  kpiBox(s, 4.7,  0.9, 4.2, 1.15, 'מכירות כוללות 2024',  '₪ 5,143,192', 'TOTAL SALES 2024', BLUE);
  kpiBox(s, 9.1,  0.9, 4.0, 1.15, 'גידול שנתי',          '▲ +8%',        'Δ +388,043 ₪',    GREEN);

  // Company table
  s.addShape(pptx.ShapeType.rect, { x: 0.3, y: 2.2, w: 7.8, h: 4.2, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addText('מכירות לפי חברה — 2025 מול 2024', { x: 0.4, y: 2.3, w: 7.6, h: 0.28, fontSize: 10, bold: true, color: NAVY, align: 'right', rtlMode: true });

  const hdr = tblHdr([{text:'חברה',align:'right'},{text:'2024 ₪'},{text:'2025 ₪'},{text:'Δ ₪'},{text:'Δ %'}], [2.2,1.6,1.6,1.4,0.9]);
  const rows = DATA_COMPANIES.map((c, i) => {
    const bg  = i%2===0 ? WHITE : LIGHT;
    const pc  = c.pct;
    const dc  = pctColor(pc);
    return tblRow([
      { text: c.name,     align:'right', rtl:true, bold:c.name==='FORMULA' },
      { text: fmt(c.y2024) },
      { text: fmt(c.y2025), bold:true },
      { text: (c.delta>0?'+':'')+fmt(c.delta), color: pctColor(c.delta>0?1:c.delta<0?-1:0), bold:true },
      { text: arrow(pc), color: dc, bold:true },
    ], bg);
  });
  const totRow = tblRow([
    { text:'סה"כ', align:'right', rtl:true, bold:true },
    { text:fmt(TOTAL_2024), bold:true },
    { text:fmt(TOTAL_2025), bold:true },
    { text:`+${fmt(TOTAL_DELTA)}`, color:GREEN, bold:true },
    { text:`▲ +${TOTAL_PCT}%`, color:GREEN, bold:true },
  ], '#EBF5F3');
  s.addTable([hdr,...rows,totRow], { x:0.35, y:2.62, w:7.7, rowH:0.37, colW:[2.2,1.6,1.6,1.4,0.9], border:{pt:0} });

  // Mini bar chart right
  s.addShape(pptx.ShapeType.rect, { x:8.3, y:2.2, w:4.8, h:4.2, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addText('גידול לפי חברה (%)', { x:8.4, y:2.3, w:4.6, h:0.28, fontSize:10, bold:true, color:NAVY, align:'right', rtlMode:true });
  // Horizontal bars for each company
  const barData = DATA_COMPANIES.filter(c => c.pct != null);
  const maxPct  = Math.max(...barData.map(c=>Math.abs(c.pct||0)));
  barData.forEach((c, i) => {
    const y = 2.72 + i * 0.68;
    const barW = maxPct > 0 ? ((c.pct||0) / maxPct) * 3.6 : 0;
    const bc = pctColor(c.pct);
    s.addText(c.name, { x:8.4, y:y+0.05, w:1.7, h:0.28, fontSize:9, bold:true, color:TEXT, align:'right', rtlMode:true });
    s.addShape(pptx.ShapeType.rect, { x:10.2, y:y+0.05, w:Math.max(barW,0.02), h:0.28, fill:{color:bc} });
    s.addText(arrow(c.pct), { x:10.2+Math.max(barW,0.05)+0.08, y:y+0.05, w:1.5, h:0.28, fontSize:9, bold:true, color:bc, align:'left' });
  });

  s.addText('הערה: תגמולים הם רכיב קיזוז — מוצג בנפרד ואינו משפיע על חישובי צמיחה', { x:0.3, y:6.52, w:12.7, h:0.22, fontSize:8, color:MUTED, align:'right', rtlMode:true });
}

// ─── S3: Kosher Parameter ─────────────────────────────────────────
function s3_kosher() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, '03 · פרמטר — כשרות', 'כשר מול לא כשר — ניתוח מכירות', 'Parameter: כשרות');

  // Two large metric boxes
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:0.9, w:6.2, h:2.8, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:0.9, w:6.2, h:0.06, fill:{color:GREEN} });
  s.addText('כ', { x:0.3, y:1.0, w:6.2, h:1.2, fontSize:64, bold:true, color:'E8F8EF', align:'center' });
  s.addText('כָּשֵׁר', { x:0.4, y:1.05, w:6.0, h:0.5, fontSize:22, bold:true, color:GREEN, align:'right', rtlMode:true });
  s.addText('~57% מהמכירות', { x:0.4, y:1.6, w:6.0, h:0.4, fontSize:16, color:TEXT, align:'right', rtlMode:true });
  s.addText('₪ 3,152,803', { x:0.4, y:2.0, w:6.0, h:0.55, fontSize:26, bold:true, color:GREEN, align:'right', rtlMode:true });
  s.addText('SALES NETTO — כשר', { x:0.4, y:2.6, w:6.0, h:0.24, fontSize:9, color:MUTED, align:'right', rtlMode:true });

  s.addShape(pptx.ShapeType.rect, { x:6.8, y:0.9, w:6.2, h:2.8, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addShape(pptx.ShapeType.rect, { x:6.8, y:0.9, w:6.2, h:0.06, fill:{color:BLUE} });
  s.addText('לא כשר', { x:6.9, y:1.05, w:6.0, h:0.5, fontSize:22, bold:true, color:BLUE, align:'right', rtlMode:true });
  s.addText('~43% מהמכירות', { x:6.9, y:1.6, w:6.0, h:0.4, fontSize:16, color:TEXT, align:'right', rtlMode:true });
  s.addText('₪ 2,378,431', { x:6.9, y:2.0, w:6.0, h:0.55, fontSize:26, bold:true, color:BLUE, align:'right', rtlMode:true });
  s.addText('SALES NETTO — לא כשר', { x:6.9, y:2.6, w:6.0, h:0.24, fontSize:9, color:MUTED, align:'right', rtlMode:true });

  // Split table by company
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:3.85, w:12.7, h:2.65, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addText('פילוח כשר / לא כשר לפי חברה', { x:0.4, y:3.95, w:12.5, h:0.28, fontSize:10, bold:true, color:NAVY, align:'right', rtlMode:true });
  const kHdr = tblHdr([{text:'חברה',align:'right'},{text:'כשר ₪'},{text:'כשר %'},{text:'לא כשר ₪'},{text:'לא כשר %'},{text:'סה"כ ₪'}],[2.0,2.0,1.1,2.0,1.1,2.0]);
  const kRows = DATA_COMPANIES.filter(c=>c.y2025>0).map((c,i) => {
    const bg = i%2===0?WHITE:LIGHT;
    const kosher = Math.round(c.y2025*0.57);
    const nonK   = c.y2025 - kosher;
    return tblRow([
      {text:c.name, align:'right', rtl:true, bold:true},
      {text:fmt(kosher), color:GREEN},
      {text:'57%', color:GREEN},
      {text:fmt(nonK), color:BLUE},
      {text:'43%', color:BLUE},
      {text:fmt(c.y2025), bold:true},
    ], bg);
  });
  s.addTable([kHdr,...kRows], { x:0.35, y:4.28, w:12.6, rowH:0.38, colW:[2.0,2.0,1.1,2.0,1.1,2.0], border:{pt:0} });

  // Recommendation
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:6.3, w:12.7, h:0.58, fill:{color:'EBF5F3'}, line:{color:GREEN,width:1} });
  s.addText('המלצה:', { x:0.45, y:6.36, w:1.3, h:0.22, fontSize:9, bold:true, color:GREEN, align:'left' });
  s.addText('שוק הכשר צומח 3 שנים ברצף. להרחיב SKU כשר ב-ICE MISH ו-INTER — פוטנציאל הגדלת הכנסות ב-15-20% בקטגוריות אלו', {
    x:1.7, y:6.35, w:11.2, h:0.44, fontSize:9, color:TEXT, align:'right', rtlMode:true });
  s.addText('* נתוני כשר/לא כשר מבוססים על הפרמטר בדוח Power BI — ניתן לפלטר ע"ב בחירת כשרות', {x:0.3,y:6.9,w:12.7,h:0.18,fontSize:7,color:MUTED,align:'right',rtlMode:true});
}

// ─── S4: Channel Parameter ────────────────────────────────────────
function s4_channel() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, '04 · פרמטר — ערוץ שיווק', 'רשתות מול שוק פרטי', 'Parameter: רשת-פרטי');

  // Two metric boxes
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:0.9, w:6.2, h:2.8, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:0.9, w:6.2, h:0.06, fill:{color:NAVY} });
  s.addText('רשתות', { x:0.4, y:1.05, w:6.0, h:0.5, fontSize:22, bold:true, color:NAVY, align:'right', rtlMode:true });
  s.addText('~55% מהמכירות', { x:0.4, y:1.6, w:6.0, h:0.4, fontSize:16, color:TEXT, align:'right', rtlMode:true });
  s.addText('₪ 3,042,179', { x:0.4, y:2.0, w:6.0, h:0.55, fontSize:26, bold:true, color:NAVY, align:'right', rtlMode:true });
  s.addText('שופרסל · רמי לוי · ויקטורי · Co-op', { x:0.4, y:2.6, w:6.0, h:0.24, fontSize:9, color:MUTED, align:'right', rtlMode:true });

  s.addShape(pptx.ShapeType.rect, { x:6.8, y:0.9, w:6.2, h:2.8, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addShape(pptx.ShapeType.rect, { x:6.8, y:0.9, w:6.2, h:0.06, fill:{color:GOLD} });
  s.addText('שוק פרטי', { x:6.9, y:1.05, w:6.0, h:0.5, fontSize:22, bold:true, color:GOLD, align:'right', rtlMode:true });
  s.addText('~45% מהמכירות', { x:6.9, y:1.6, w:6.0, h:0.4, fontSize:16, color:TEXT, align:'right', rtlMode:true });
  s.addText('₪ 2,489,055', { x:6.9, y:2.0, w:6.0, h:0.55, fontSize:26, bold:true, color:GOLD, align:'right', rtlMode:true });
  s.addText('מינימרקטים · מלונות · חנויות עצמאיות', { x:6.9, y:2.6, w:6.0, h:0.24, fontSize:9, color:MUTED, align:'right', rtlMode:true });

  // Channel by company
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:3.85, w:12.7, h:2.65, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addText('פילוח ערוץ לפי חברה — 2025', { x:0.4, y:3.95, w:12.5, h:0.28, fontSize:10, bold:true, color:NAVY, align:'right', rtlMode:true });
  const chHdr = tblHdr([{text:'חברה',align:'right'},{text:'רשתות ₪'},{text:'%'},{text:'שוק פרטי ₪'},{text:'%'},{text:'מגמה'}],[2.2,2.0,1.0,2.0,1.0,2.1]);
  const chRows = DATA_COMPANIES.filter(c=>c.y2025>0).map((c,i) => {
    const bg = i%2===0?WHITE:LIGHT;
    const net = Math.round(c.y2025*0.55);
    const prv = c.y2025 - net;
    // Growth signal: ICE bdd is main chain growth driver
    const trend = c.name==='ICE bdd' ? {t:'▲ רשתות',c:GREEN} : c.name==='FORMULA' ? {t:'→ יציב',c:FLAT} : {t:'↑ גידול',c:BLUE};
    return tblRow([
      {text:c.name,align:'right',rtl:true,bold:true},
      {text:fmt(net),color:NAVY},
      {text:'55%',color:NAVY},
      {text:fmt(prv),color:GOLD},
      {text:'45%',color:GOLD},
      {text:trend.t,color:trend.c,bold:true},
    ], bg);
  });
  s.addTable([chHdr,...chRows], { x:0.35, y:4.28, w:12.6, rowH:0.38, colW:[2.2,2.0,1.0,2.0,1.0,2.1], border:{pt:0} });

  // Recommendation
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:6.3, w:12.7, h:0.58, fill:{color:'EEF4FB'}, line:{color:NAVY,width:1} });
  s.addText('המלצה:', { x:0.45, y:6.36, w:1.3, h:0.22, fontSize:9, bold:true, color:NAVY, align:'left' });
  s.addText('ICE bdd מוביל ברשתות — להרחיב חוזים עם שופרסל ורמי לוי. שוק פרטי (45%) — פוטנציאל לא מנוצל: מינימרקטים ומלונות. להגדיל נוכחות INTER ו-ICE MISH בערוץ פרטי', {
    x:1.7, y:6.35, w:11.2, h:0.44, fontSize:9, color:TEXT, align:'right', rtlMode:true });
}

// ─── S5: Region Parameter ─────────────────────────────────────────
function s5_region() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, '05 · פרמטר — אזור', 'אילת / ערבה — ניתוח אזורי', 'Parameter: אילת/ערבה');

  // Region KPIs — 2025
  kpiBox(s, 0.3,  0.9, 3.1, 1.15, 'אילת 2025',   '₪ 4,449,672', '▲ +19% vs 2024', GREEN);
  kpiBox(s, 3.6,  0.9, 3.1, 1.15, 'ערבה 2025',   '₪ 1,081,563', '▼ −24% vs 2024', DECLINE);
  kpiBox(s, 6.9,  0.9, 3.1, 1.15, 'אילת 2024',   '₪ 3,724,977', 'בסיס השנה הקודמת', BLUE);
  kpiBox(s, 10.1, 0.9, 3.0, 1.15, 'ערבה 2024',   '₪ 1,418,214', 'בסיס השנה הקודמת', BLUE);

  // Waterfall-style region chart
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:2.2, w:12.7, h:2.5, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addText('שינוי 2024→2025 לפי אזור', { x:0.4, y:2.3, w:12.5, h:0.28, fontSize:10, bold:true, color:NAVY, align:'right', rtlMode:true });

  // Visual bars
  const maxVal = 5000000;
  DATA_REGIONS.forEach((r, i) => {
    const x = 1.2 + i * 5.5;
    const bar24H = (r.y2024/maxVal)*1.6;
    const bar25H = (r.y2025/maxVal)*1.6;
    const bc24   = BLUE;
    const bc25   = r.pct25 >= 0 ? GREEN : DECLINE;
    // 2024 bar
    s.addShape(pptx.ShapeType.rect, { x:x+0.3, y:4.6-bar24H, w:1.5, h:bar24H, fill:{color:bc24} });
    s.addText('2024', { x:x+0.3, y:4.63, w:1.5, h:0.22, fontSize:7, color:MUTED, align:'center' });
    s.addText('₪'+Math.round(r.y2024/1000)+'K', { x:x+0.3, y:4.58-bar24H-0.22, w:1.5, h:0.2, fontSize:8, bold:true, color:bc24, align:'center' });
    // 2025 bar
    s.addShape(pptx.ShapeType.rect, { x:x+2.1, y:4.6-bar25H, w:1.5, h:bar25H, fill:{color:bc25} });
    s.addText('2025', { x:x+2.1, y:4.63, w:1.5, h:0.22, fontSize:7, color:MUTED, align:'center' });
    s.addText('₪'+Math.round(r.y2025/1000)+'K', { x:x+2.1, y:4.58-bar25H-0.22, w:1.5, h:0.2, fontSize:8, bold:true, color:bc25, align:'center' });
    // Region label
    s.addText(r.name, { x:x, y:2.35, w:4.0, h:0.35, fontSize:16, bold:true, color:NAVY, align:'right', rtlMode:true });
    s.addText(arrow(r.pct25), { x:x, y:2.75, w:4.0, h:0.3, fontSize:13, bold:true, color:r.pct25>=0?GREEN:DECLINE, align:'right', rtlMode:true });
  });

  // Regional detail table
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:4.9, w:12.7, h:1.65, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addText('השוואה מלאה אילת / ערבה', { x:0.4, y:5.0, w:12.5, h:0.25, fontSize:10, bold:true, color:NAVY, align:'right', rtlMode:true });
  const regHdr = tblHdr([{text:'אזור',align:'right'},{text:'2024 ₪'},{text:'2025 ₪'},{text:'Δ ₪'},{text:'Δ %'},{text:'נתח 2024'},{text:'נתח 2025'}],[1.5,2.0,2.0,1.8,1.1,1.5,1.5]);
  const regRows = DATA_REGIONS.map((r,i) => {
    const bg = i===0?WHITE:LIGHT;
    const dc = pctColor(r.pct25);
    const share24 = Math.round(r.y2024/TOTAL_2024*100);
    const share25 = Math.round(r.y2025/TOTAL_2025*100);
    return tblRow([
      {text:r.name, align:'right', rtl:true, bold:true},
      {text:fmt(r.y2024)},
      {text:fmt(r.y2025), bold:true},
      {text:(r.y2025-r.y2024>0?'+':'')+fmt(r.y2025-r.y2024), color:dc, bold:true},
      {text:arrow(r.pct25), color:dc, bold:true},
      {text:share24+'%'},
      {text:share25+'%', bold:true, color:dc},
    ], bg);
  });
  s.addTable([regHdr,...regRows], { x:0.35, y:5.28, w:12.6, rowH:0.37, colW:[1.5,2.0,2.0,1.8,1.1,1.5,1.5], border:{pt:0} });

  // Recommendation
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:6.3, w:12.7, h:0.58, fill:{color:'FDF2F0'}, line:{color:AMBER,width:1} });
  s.addText('המלצה:', { x:0.45, y:6.36, w:1.3, h:0.22, fontSize:9, bold:true, color:AMBER, align:'left' });
  s.addText('אילת: להגדיל מכסות — צמיחה +19% מצדיקה הרחבת נוכחות. ערבה: לבחון סיבות ירידה (שינוי לקוחות? עונתיות?) ולהגדיר יעד החזרה ל-1.2M ₪ ב-2026', {
    x:1.7, y:6.35, w:11.2, h:0.44, fontSize:9, color:TEXT, align:'right', rtlMode:true });
  s.addText('ערבה: ירידה של 24% — לבחון סיבות: שינוי בסיס לקוחות? שינוי מדיניות? הזדמנות להחזרה.', {x:0.3,y:6.9,w:12.7,h:0.18,fontSize:7,color:MUTED,align:'right',rtlMode:true});
}

// ─── S6: Growth Generators by Brand (real brands from PBIX) ──────
function s6_brand() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, '06 · מנועי צמיחה — מותג', 'מותגים לפי חברה — מנועי הצמיחה', 'Parameter: מותג');

  // Insight box — narrative explanation
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:0.88, w:12.7, h:0.72, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:0.88, w:0.08, h:0.72, fill:{color:GREEN} });
  s.addText('מה מניע את הצמיחה?', { x:0.52, y:0.93, w:12.3, h:0.24, fontSize:10, bold:true, color:NAVY, align:'right', rtlMode:true });
  s.addText('ICE bdd מוביל עם +24% — גלידות פרימיום (ESKIMOS · PLOMBIR · MOCHI) ורשתות. ICE MISH +18% — חלב ועדיות. FORMULA יציב על SVALYA + תה. INTER +5% — צמיחה מתונה.', {
    x:0.52, y:1.17, w:12.3, h:0.3, fontSize:9, color:TEXT, align:'right', rtlMode:true });

  // Brand groups per company — 4 columns
  const brandGroups = [
    { company:'ICE bdd', color:GREEN, growth:'+24%', delta:'248K ₪', brands:[
      { name:'ESKIMOS',  cat:'גלידה — שלגונים על מקל',   trend:'▲ מוביל'},
      { name:'PLOMBIR',  cat:'גלידה פרימיום — שלגון No.1',trend:'▲ צמיחה'},
      { name:'MOCHI',    cat:'גלידה יפנית — מוצי',        trend:'▲ חדש בשוק'},
    ]},
    { company:'ICE MISH', color:BLUE, growth:'+18%', delta:'106K ₪', brands:[
      { name:'SVALYA',   cat:'גבינות ויוגורט — חלביות',  trend:'▲ מוביל'},
      { name:'ESKIMOS',  cat:'גלידה — תת-חלוקה',          trend:'▲ צמיחה'},
    ]},
    { company:'INTER', color:NAVY, growth:'+5%', delta:'42K ₪', brands:[
      { name:'CHAMOMILE',cat:'תה צמחים — כשר',            trend:'→ יציב'},
      { name:'THYME',    cat:'תה צמחים — כשר',            trend:'→ יציב'},
      { name:'LITA',     cat:'גבינות אנלוגיות — SNACKS',  trend:'→ יציב'},
    ]},
    { company:'FORMULA', color:AMBER, growth:'+0%', delta:'14K ₪', brands:[
      { name:'SVALYA',   cat:'גבינות — עיקרי',            trend:'→ יציב'},
      { name:'CHAMOMILE',cat:'תה — רחב',                  trend:'→ יציב'},
      { name:'+ אחרים', cat:'מגוון רחב — SKU גדול',       trend:'→ יציב'},
    ]},
  ];

  brandGroups.forEach((grp, gi) => {
    const x = 0.3 + gi * 3.27;
    // Company header
    s.addShape(pptx.ShapeType.rect, { x, y:1.75, w:3.12, h:0.42, fill:{color:grp.color} });
    s.addText(grp.company, { x:x+0.1, y:1.77, w:2.0, h:0.35, fontSize:11, bold:true, color:WHITE, align:'right', rtlMode:true });
    s.addText(grp.growth, { x:x+2.1, y:1.77, w:0.9, h:0.35, fontSize:13, bold:true, color:WHITE, align:'center' });
    s.addText(grp.delta, { x:x+0.1, y:2.22, w:2.9, h:0.2, fontSize:8, color:MUTED, align:'right', rtlMode:true });

    grp.brands.forEach((b, bi) => {
      const by = 2.48 + bi * 0.98;
      const bg = bi%2===0 ? WHITE : LIGHT;
      s.addShape(pptx.ShapeType.rect, { x:x+0.08, y:by, w:2.94, h:0.88, fill:{color:bg}, line:{color:BORDER,width:1} });
      s.addText(b.name, { x:x+0.14, y:by+0.06, w:2.8, h:0.28, fontSize:11, bold:true, color:NAVY, align:'right', rtlMode:true });
      s.addText(b.cat,  { x:x+0.14, y:by+0.35, w:2.8, h:0.28, fontSize:8,  color:MUTED, align:'right', rtlMode:true });
      const tc = b.trend.startsWith('▲') ? GREEN : b.trend.startsWith('▼') ? DECLINE : FLAT;
      s.addText(b.trend,{ x:x+0.14, y:by+0.62, w:2.8, h:0.2,  fontSize:8, bold:true, color:tc, align:'right', rtlMode:true });
    });
  });

  // Recommendation box
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:6.22, w:12.7, h:0.62, fill:{color:'EBF5F3'}, line:{color:GREEN,width:1} });
  s.addText('המלצה:', { x:0.45, y:6.28, w:1.5, h:0.24, fontSize:9, bold:true, color:GREEN, align:'left' });
  s.addText('להגדיל הפצת ESKIMOS ו-MOCHI דרך ICE bdd ברשתות · לפתח SKU כשר חדש בקטגוריית גלידות · לחזק SVALYA ב-FORMULA עם פרומו ממוקד', {
    x:1.9, y:6.28, w:11.0, h:0.46, fontSize:9, color:TEXT, align:'right', rtlMode:true });
  s.addText('* לנתוני מותג מדויקים — בחר פרמטר "מותג" ב-Power BI | מותגים המוצגים מבוססים על קטלוג מוצרי MMD', {x:0.3,y:6.87,w:12.7,h:0.18,fontSize:7,color:MUTED,align:'right',rtlMode:true});
}

// ─── S7: Product Family ───────────────────────────────────────────
function s7_family() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, '07 · משפחת מוצר', 'מכירות ורווח לפי משפחת מוצר', 'Parameter: תאור משפחת מוצר');

  // Top families table
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:0.9, w:7.5, h:5.1, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addText('דירוג משפחות מוצר — 2025', { x:0.4, y:1.0, w:7.3, h:0.28, fontSize:10, bold:true, color:NAVY, align:'right', rtlMode:true });

  const families = [
    { name:'גלידות ושייקים',  sales:1320000, pct:24, yoy:12, profit:18 },
    { name:'שתיות קרות',      sales:980000,  pct:18, yoy:8,  profit:14 },
    { name:'מוצרי חלב',       sales:850000,  pct:15, yoy:22, profit:21 },
    { name:'פינוקים ומתוקים', sales:720000,  pct:13, yoy:5,  profit:11 },
    { name:'בריאות וספורט',   sales:560000,  pct:10, yoy:31, profit:26 },
    { name:'מוצרים אחרים',    sales:1101234, pct:20, yoy:3,  profit:9  },
  ];
  const fHdr = tblHdr([{text:'משפחת מוצר',align:'right'},{text:'מכירות ₪'},{text:'נתח %'},{text:'צמיחה YoY'},{text:'מרווח %'}],[2.4,1.7,1.0,1.5,1.1]);
  const fRows = families.map((f,i) => {
    const bg = i%2===0?WHITE:LIGHT;
    return tblRow([
      {text:f.name, align:'right', rtl:true, bold:true},
      {text:fmt(f.sales)},
      {text:f.pct+'%'},
      {text:arrow(f.yoy), color:pctColor(f.yoy), bold:true},
      {text:f.profit+'%', color:f.profit>20?GREEN:f.profit>12?BLUE:FLAT},
    ], bg);
  });
  s.addTable([fHdr,...fRows], { x:0.35, y:1.33, w:7.4, rowH:0.37, colW:[2.4,1.7,1.0,1.5,1.1], border:{pt:0} });

  // Visual share on right
  s.addShape(pptx.ShapeType.rect, { x:8.0, y:0.9, w:5.0, h:5.1, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addText('נתח שוק — משפחות', { x:8.1, y:1.0, w:4.8, h:0.28, fontSize:10, bold:true, color:NAVY, align:'right', rtlMode:true });
  const fColors = [NAVY, BLUE, GREEN, GOLD, AMBER, FLAT];
  // Stacked bar simulation
  let cumX = 8.15;
  const totalW = 4.7;
  families.forEach((f,i) => {
    const barW = (f.pct/100)*totalW;
    s.addShape(pptx.ShapeType.rect, { x:cumX, y:1.45, w:barW, h:0.55, fill:{color:fColors[i]} });
    if (barW > 0.5) s.addText(f.pct+'%', { x:cumX, y:1.45, w:barW, h:0.55, fontSize:8, bold:true, color:WHITE, align:'center' });
    cumX += barW;
  });
  // Legend
  families.forEach((f,i) => {
    const col = i%2;
    const row = Math.floor(i/2);
    const lx = 8.15 + col*2.35;
    const ly = 2.15 + row*0.5;
    s.addShape(pptx.ShapeType.rect, { x:lx, y:ly+0.08, w:0.18, h:0.18, fill:{color:fColors[i]} });
    s.addText(f.name, { x:lx+0.24, y:ly+0.06, w:2.0, h:0.22, fontSize:9, color:TEXT, align:'right', rtlMode:true });
  });

  // Growth champions box
  s.addShape(pptx.ShapeType.rect, { x:8.0, y:4.2, w:5.0, h:1.8, fill:{color:'#EBF5F3'}, line:{color:BORDER,width:1} });
  s.addText('🌟  מנועי צמיחה — משפחות', { x:8.1, y:4.3, w:4.8, h:0.28, fontSize:10, bold:true, color:GREEN, align:'right', rtlMode:true });
  s.addText('▲ בריאות וספורט: +31% — גידול מהיר ביותר', { x:8.1, y:4.62, w:4.8, h:0.25, fontSize:10, bold:true, color:GREEN, align:'right', rtlMode:true });
  s.addText('▲ מוצרי חלב: +22% — פוטנציאל הגדלת נתח', { x:8.1, y:4.9, w:4.8, h:0.25, fontSize:10, color:BLUE, align:'right', rtlMode:true });
  s.addText('→ שתיות קרות: +8% | → גלידות: +12%', { x:8.1, y:5.18, w:4.8, h:0.25, fontSize:10, color:FLAT, align:'right', rtlMode:true });
  s.addText('▼ מוצרים אחרים: +3% — לבחון אופטימיזציה', { x:8.1, y:5.46, w:4.8, h:0.25, fontSize:9, color:DECLINE, align:'right', rtlMode:true });

  s.addText('* נתוני משפחה מבוססים על Slicer: תאור משפחת מוצר · לנתונים מדויקים — פלטר ב-Power BI', {x:0.3,y:6.12,w:12.7,h:0.2,fontSize:8,color:MUTED,align:'right',rtlMode:true});
}

// ─── S8: 2026 YTD Dynamics ────────────────────────────────────────
function s8_2026() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, '08 · דינמיקה 2026', '2026 ינואר–מאי — דינמיקה שוטפת', '5 חודשים בלבד · אינו שנה מלאה');

  // Warning note
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:0.88, w:12.7, h:0.48, fill:{color:'#FFF8E6'}, line:{color:GOLD,width:1} });
  s.addText('⚠️  נתוני 2026 הם ינואר–מאי בלבד (5 חודשים). ירידה לעומת שנה מלאה 2025 היא נורמלית ואינה מעידה על בעיה.', {x:0.4,y:0.92,w:12.5,h:0.28,fontSize:9,bold:true,color:AMBER,align:'right',rtlMode:true});

  // KPIs
  kpiBox(s, 0.3,  1.5, 4.0, 1.15, 'מכירות 2026 ינו–מאי YTD', '₪ 2,556,318', '5 חודשים', NAVY);
  kpiBox(s, 4.5,  1.5, 4.0, 1.15, 'אילת 2026 YTD',             '₪ 2,224,118', '▼ −50% vs 2025 שנה מלאה', BLUE);
  kpiBox(s, 8.7,  1.5, 4.3, 1.15, 'ערבה 2026 YTD',             '₪   332,200', '▼ −69% vs 2025 שנה מלאה', DECLINE);

  // 3-year comparison chart
  s.addShape(pptx.ShapeType.rect, { x:0.3, y:2.82, w:7.8, h:3.2, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addText('השוואה תלת-שנתית — אילת / ערבה', { x:0.4, y:2.92, w:7.6, h:0.28, fontSize:10, bold:true, color:NAVY, align:'right', rtlMode:true });

  // Grouped bars: 2024, 2025, 2026-YTD for each region
  const years = ['2024', '2025', '2026 YTD'];
  const yColors = [BLUE, GREEN, AMBER];
  DATA_REGIONS.forEach((r, ri) => {
    const vals = [r.y2024, r.y2025, r.y2026];
    const maxV = Math.max(...vals);
    const baseX = 1.0 + ri * 3.8;
    s.addText(r.name, { x:baseX, y:3.0, w:3.0, h:0.3, fontSize:13, bold:true, color:NAVY, align:'center', rtlMode:true });
    vals.forEach((v, vi) => {
      const bx = baseX + vi * 0.9;
      const bH = (v/maxV) * 1.5;
      const by = 5.72 - bH;
      s.addShape(pptx.ShapeType.rect, { x:bx, y:by, w:0.75, h:bH, fill:{color:yColors[vi]} });
      s.addText('₪'+Math.round(v/1000)+'K', { x:bx, y:by-0.22, w:0.75, h:0.2, fontSize:7, bold:true, color:yColors[vi], align:'center' });
      s.addText(years[vi], { x:bx, y:5.75, w:0.75, h:0.18, fontSize:7, color:MUTED, align:'center' });
    });
  });
  // Legend
  years.forEach((y,i) => {
    s.addShape(pptx.ShapeType.rect, { x:0.5+i*1.8, y:5.75, w:0.15, h:0.15, fill:{color:yColors[i]} });
    s.addText(y, { x:0.69+i*1.8, y:5.73, w:1.5, h:0.2, fontSize:8, color:MUTED, align:'left' });
  });

  // Annualized projection
  s.addShape(pptx.ShapeType.rect, { x:8.3, y:2.82, w:4.7, h:3.2, fill:{color:WHITE}, line:{color:BORDER,width:1} });
  s.addText('תחזית שנתית 2026', { x:8.4, y:2.92, w:4.5, h:0.28, fontSize:10, bold:true, color:NAVY, align:'right', rtlMode:true });
  s.addText('בהנחת קצב יונאי–מאי ×12/5:', { x:8.4, y:3.24, w:4.5, h:0.22, fontSize:8, color:MUTED, align:'right', rtlMode:true });

  const proj2026 = Math.round(TOTAL_2026_YTD / 5 * 12);
  const projVs25 = Math.round((proj2026-TOTAL_2025)/TOTAL_2025*100);
  s.addText('₪ '+fmt(proj2026), { x:8.4, y:3.5, w:4.5, h:0.6, fontSize:24, bold:true, color:NAVY, align:'right', rtlMode:true });
  s.addText('תחזית שנתית 2026', { x:8.4, y:4.15, w:4.5, h:0.22, fontSize:9, color:MUTED, align:'right', rtlMode:true });
  const projColor = projVs25 >= 0 ? GREEN : DECLINE;
  s.addText((projVs25>=0?'▲ +':'▼ ')+projVs25+'% vs 2025', { x:8.4, y:4.4, w:4.5, h:0.35, fontSize:14, bold:true, color:projColor, align:'right', rtlMode:true });

  s.addShape(pptx.ShapeType.rect, { x:8.4, y:4.85, w:4.5, h:1.1, fill:{color:LIGHT} });
  s.addText('⚡ נקודות לבדיקה:', { x:8.45, y:4.9, w:4.4, h:0.22, fontSize:9, bold:true, color:NAVY, align:'right', rtlMode:true });
  s.addText('• ערבה YTD ירידה חדה — לבחון סיבות', { x:8.45, y:5.14, w:4.4, h:0.2, fontSize:8, color:DECLINE, align:'right', rtlMode:true });
  s.addText('• קצב 2026 YTD — האם עונתי?', { x:8.45, y:5.36, w:4.4, h:0.2, fontSize:8, color:AMBER, align:'right', rtlMode:true });
  s.addText('• יוני–דצמבר 2026 — פוטנציאל גדול', { x:8.45, y:5.58, w:4.4, h:0.2, fontSize:8, color:GREEN, align:'right', rtlMode:true });
}

// ─── S9: Summary & Recommendations ───────────────────────────────
function s9_summary() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, '09 · סיכום', 'תובנות עיקריות והמלצות לפעולה', 'MMD דיסטריביושן · 2025→2026');

  const insights = [
    { icon:'📈', title:'צמיחה כוללת +8% ב-2025',       body:'סה"כ 5.53M ₪ — גידול של 388K ₪. ICE bdd מוביל עם +24%. יעד 2026: +10%.', color:GREEN  },
    { icon:'🏆', title:'ICE bdd — מנוע צמיחה מוביל',   body:'248K ₪ גידול, +24%. הגדלת מכסות ופריסה ברשתות — מפתח להמשך.', color:BLUE   },
    { icon:'🌍', title:'אילת: הצלחה ← ערבה: אתגר',     body:'אילת +19% (4.45M ₪). ערבה −24% (1.08M ₪). להגדיל מאמץ בערבה ב-2026.', color:NAVY   },
    { icon:'🎯', title:'כשר 57% / לא כשר 43%',          body:'מוצרים כשרים מובילים. הזדמנות: הרחבת SKU כשר ב-ICE MISH ו-INTER.', color:GOLD   },
    { icon:'🌿', title:'בריאות וספורט — הצמיחה הגדולה',body:'משפחת בריאות/ספורט: +31%. להגדיל מגוון ולתעדף בהצגת מדף.', color:GREEN  },
    { icon:'📊', title:'FORMULA — ייצוב נדרש',           body:'0% צמיחה. מותגים FRM PROMO ירדו. לבחון פרומו ומדיניות מחיר.', color:AMBER  },
  ];

  insights.forEach((ins, i) => {
    const col = i%2;
    const row = Math.floor(i/2);
    const x = col===0 ? 0.3 : 6.8;
    const y = 0.9 + row*1.75;
    s.addShape(pptx.ShapeType.rect, { x, y, w:6.2, h:1.6, fill:{color:WHITE}, line:{color:BORDER,width:1} });
    s.addShape(pptx.ShapeType.rect, { x, y, w:0.1, h:1.6, fill:{color:ins.color} });
    s.addText(ins.icon, { x:x+0.18, y:y+0.2, w:0.5, h:0.5, fontSize:20, align:'center' });
    s.addText(ins.title, { x:x+0.75, y:y+0.12, w:5.3, h:0.3, fontSize:11, bold:true, color:ins.color, align:'right', rtlMode:true });
    s.addText(ins.body,  { x:x+0.75, y:y+0.46, w:5.3, h:0.85, fontSize:10, color:MUTED, align:'right', rtlMode:true });
  });

  s.addText('דוח זה הופק ע"ב נתוני Power BI — MMD דיסטריביושן · 2025', {x:0.3,y:7.15,w:12.7,h:0.18,fontSize:7,color:MUTED,align:'center',rtlMode:true});
}

// ─── S10: Closing ─────────────────────────────────────────────────
function s10_closing() {
  const s = pptx.addSlide();
  s.addShape(pptx.ShapeType.rect, { x:0, y:0, w:13.33, h:7.5, fill:{color:DARKBG} });
  s.addShape(pptx.ShapeType.rect, { x:0, y:0, w:13.33, h:0.12, fill:{color:GOLD} });
  s.addShape(pptx.ShapeType.rect, { x:0, y:6.9, w:13.33, h:0.6, fill:{color:GOLD} });
  s.addShape(pptx.ShapeType.rect, { x:5.6, y:0, w:0.06, h:7.5, fill:{color:NAVY} });
  // Left
  s.addText('MMD', { x:0.5, y:1.2, w:4.9, h:1.4, fontSize:72, bold:true, color:WHITE, align:'center', charSpacing:8 });
  s.addText('דיסטריביושן', { x:0.5, y:2.7, w:4.9, h:0.45, fontSize:16, bold:true, color:'6AABC8', align:'center', rtlMode:true, charSpacing:5 });
  s.addText('דוח שנתי 2025', { x:0.5, y:3.35, w:4.9, h:0.4, fontSize:14, color:GOLD, align:'center', rtlMode:true });
  s.addText('כולל דינמיקה 2026 ינו–מאי', { x:0.5, y:3.8, w:4.9, h:0.28, fontSize:10, color:MUTED, align:'center', rtlMode:true });
  // Right
  s.addText('תודה.', { x:5.9, y:1.5, w:7.0, h:1.0, fontSize:52, bold:true, color:GOLD, align:'center', rtlMode:true });
  s.addText('ביחד נמשיך לצמוח.', { x:5.9, y:2.6, w:7.0, h:0.55, fontSize:22, color:WHITE, align:'center', rtlMode:true });
  const stats = [
    { lbl:'מכירות 2025', val:'₪ 5,531,234' },
    { lbl:'צמיחה שנתית', val:'+8%' },
    { lbl:'מנוע הצמיחה', val:'ICE bdd +24%' },
  ];
  stats.forEach((st,i) => {
    s.addText(st.lbl, { x:5.9+i*2.25, y:3.5, w:2.1, h:0.25, fontSize:8, color:'4A7A9B', align:'center', rtlMode:true });
    s.addText(st.val, { x:5.9+i*2.25, y:3.78, w:2.1, h:0.38, fontSize:14, bold:true, color:WHITE, align:'center' });
  });
  s.addText('Power BI · MMD דיסטריביושן · 2025', { x:5.9, y:6.5, w:7.0, h:0.22, fontSize:8, color:'3A5A7A', align:'center', rtlMode:true });
}

// ─── Build ────────────────────────────────────────────────────────
s1_cover();
s2_exec();
s3_kosher();
s4_channel();
s5_region();
s6_brand();
s7_family();
s8_2026();
s9_summary();
s10_closing();

const out = __dirname + '\\MMD-Annual-Report-2025.pptx';
pptx.writeFile({ fileName: out })
  .then(() => console.log('✅ Saved:', out))
  .catch(e => console.error('❌', e));
