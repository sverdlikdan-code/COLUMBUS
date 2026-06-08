const PptxGenJS = require('pptxgenjs');
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5

const LANG = 'RU'; // 'RU' | 'HE' | 'EN'
function t(ru, he, en) {
  if (LANG === 'HE') return he;
  if (LANG === 'EN') return en;
  return ru;
}

const IMGDIR = 'C:/Users/d.sverdlik/Desktop/MMD REPORT/';
const IMG  = (ts) => `${IMGDIR}Screenshot 2026-06-07 ${ts}.jpg`;
const IMG8 = (ts) => `${IMGDIR}Screenshot 2026-06-08 ${ts}.jpg`;

const NAVY    = '1C3D6B';
const BLUE    = '2E77B8';
const ICE     = '5BB8D4';
const CYAN    = 'A8E6F0';
const GREEN   = '1A9E5C';
const DECLINE = '607080';
const FLAT    = '8A9BA8';
const GOLD    = 'E6A817';
const AMBER   = 'E67E22';
const BG      = 'F2F6FA';
const WHITE   = 'FFFFFF';
const TEXT    = '1A1A1A';
const MUTED   = '5A6A7A';
const BORDER  = 'C5D5E5';
const LIGHT   = 'EAF2FA';
const DARKBG  = '0D2137';
const ACCENT  = 'E8F4FD';
const TOTAL_SLIDES = 19;

const DATA_COMPANIES = [
  { name: 'FORMULA',  y2024: 2784475, y2025: 2798119, delta:  13644, pct:  0 },
  { name: 'ICE bdd',  y2024: 1056545, y2025: 1305201, delta: 248656, pct: 24 },
  { name: 'INTER',    y2024:  875500, y2025:  917877, delta:  42377, pct:  5 },
  { name: 'ICE MISH', y2024:  590549, y2025:  696390, delta: 105840, pct: 18 },
];
const TOTAL_2024 = 5143192, TOTAL_2025 = 5531234, TOTAL_DELTA = 388043, TOTAL_PCT = 8;

function fmt(n) { return n == null ? '—' : Math.abs(n).toLocaleString('he-IL'); }
function pctColor(p) {
  if (p == null) return MUTED;
  if (p > 10) return GREEN;
  if (p > 0)  return BLUE;
  if (p === 0) return FLAT;
  return DECLINE;
}
function arrow(p) {
  if (p == null) return '—';
  if (p > 0)  return `▲ +${p}%`;
  if (p === 0) return '→ 0%';
  return `▼ ${p}%`;
}

function pageHeader(s, section, title, sub) {
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.72, fill: { color: NAVY } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0.72, w: 13.33, h: 0.05, fill: { color: ICE } });
  s.addText(section, { x: 0.3, y: 0.1, w: 4.0, h: 0.2, fontSize: 8, bold: true, color: CYAN, align: 'left', charSpacing: 2 });
  s.addText(title,   { x: 0.3, y: 0.24, w: 12.7, h: 0.42, fontSize: 22, bold: true, color: WHITE, align: 'center' });
  if (sub) s.addText(sub, { x: 9.0, y: 0.1, w: 4.2, h: 0.2, fontSize: 8, color: CYAN, align: 'right' });
}

function kpiBox(s, x, y, w, h, label, value, sub, ac) {
  ac = ac || BLUE;
  s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.07, fill: { color: ac } });
  s.addText(label, { x: x+0.14, y: y+0.14, w: w-0.28, h: 0.26, fontSize: 9,  color: MUTED, align: 'center' });
  s.addText(value, { x: x+0.14, y: y+0.38, w: w-0.28, h: 0.5,  fontSize: 20, bold: true, color: ac, align: 'center' });
  if (sub) s.addText(sub, { x: x+0.14, y: y+0.88, w: w-0.28, h: 0.2, fontSize: 8, color: MUTED, align: 'center' });
}

function insightBox(s, x, y, w, h, label, text, bgColor, lineColor) {
  s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: bgColor || ACCENT }, line: { color: lineColor || BLUE, width: 1 } });
  if (label) {
    s.addText(label, { x: x+0.18, y: y+0.1, w: 2.1, h: 0.22, fontSize: 9, bold: true, color: lineColor || BLUE, align: 'left' });
    s.addText(text,  { x: x+2.25, y: y+0.08, w: w-2.45, h: h-0.12, fontSize: 10, color: TEXT, align: 'left', wrap: true });
  } else {
    s.addText(text, { x: x+0.18, y: y+0.08, w: w-0.36, h: h-0.12, fontSize: 10, color: TEXT, align: 'left', wrap: true });
  }
}

function langBadge(s) {
  s.addShape(pptx.ShapeType.roundRect, { x: 12.6, y: 7.18, w: 0.65, h: 0.24, fill: { color: NAVY }, line: { color: ICE, width: 1 }, rectRadius: 0.04 });
  s.addText(LANG, { x: 12.6, y: 7.18, w: 0.65, h: 0.24, fontSize: 8, bold: true, color: ICE, align: 'center' });
}

function footerLine(s, pageNum) {
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.28, w: 13.33, h: 0.02, fill: { color: BORDER } });
  s.addText('MMD Distribution · Годовой отчёт 2025 · 2026 YTD', { x: 0.3, y: 7.3, w: 8.0, h: 0.18, fontSize: 7, color: MUTED, align: 'left' });
  s.addText(`${pageNum} / ${TOTAL_SLIDES}`, { x: 10.5, y: 7.3, w: 2.5, h: 0.18, fontSize: 7, color: MUTED, align: 'right' });
  langBadge(s);
}

// ─── Data slide: screenshot left + KPIs right + bottom rec ───────────────────
function dataSlide({ pageNum, section, title, imgTs, imgDate, kpis, analysis, rec, sourceLinks }) {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, section, title, 'MMD Distribution');

  const imgPath = imgDate === '08' ? IMG8(imgTs) : IMG(imgTs);
  s.addShape(pptx.ShapeType.rect, { x: 0.13, y: 0.80, w: 8.39, h: 4.93, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addImage({ path: imgPath, x: 0.15, y: 0.82, w: 8.35, h: 4.89 });

  s.addShape(pptx.ShapeType.rect, { x: 8.65, y: 0.80, w: 4.5, h: 4.93, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });

  kpis.forEach((k, i) => {
    const ky = 0.88 + i * 1.22;
    const ac = k.color || BLUE;
    s.addShape(pptx.ShapeType.rect, { x: 8.73, y: ky, w: 4.34, h: 1.04, fill: { color: ACCENT }, line: { color: ac, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x: 8.73, y: ky, w: 0.07, h: 1.04, fill: { color: ac } });
    s.addText(k.label, { x: 8.87, y: ky+0.07, w: 4.1, h: 0.24, fontSize: 8, color: MUTED, align: 'left' });
    s.addText(k.value, { x: 8.87, y: ky+0.35, w: 3.1, h: 0.44, fontSize: 19, bold: true, color: ac, align: 'left' });
    if (k.sub) s.addText(k.sub, { x: 8.87, y: ky+0.77, w: 4.1, h: 0.2, fontSize: 8, color: MUTED, align: 'left' });
  });

  const textY = 0.88 + kpis.length * 1.22 + 0.14;
  const textH = Math.max(0.4, 5.63 - textY);
  s.addText(analysis, { x: 8.73, y: textY, w: 4.34, h: textH, fontSize: 9.5, color: TEXT, align: 'left', valign: 'top', wrap: true });

  insightBox(s, 0.15, 5.92, 13.03, 1.18, t('Рекомендация:', 'המלצה:', 'Recommendation:'), rec, 'E8F9F0', GREEN);

  if (sourceLinks && sourceLinks.length > 0) {
    const runs = [{ text: t('Источники: ','מקורות: ','Sources: '), options: { fontSize: 6, color: MUTED, bold: true } }];
    sourceLinks.forEach((src, i) => {
      if (i > 0) runs.push({ text: ' · ', options: { fontSize: 6, color: MUTED } });
      runs.push({ text: src.text, options: { fontSize: 6, color: BLUE, hyperlink: { url: src.url, tooltip: src.text } } });
    });
    s.addText(runs, { x: 0.15, y: 7.12, w: 13.0, h: 0.14, align: 'left' });
  }

  footerLine(s, pageNum);
}

// ─── S1: Cover ────────────────────────────────────────────────────────────────
function s1_cover() {
  const s = pptx.addSlide();
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: DARKBG } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: BLUE } });
  s.addShape(pptx.ShapeType.rect, { x: 0.35, y: 0, w: 12.98, h: 0.06, fill: { color: ICE } });

  s.addShape(pptx.ShapeType.ellipse, { x: 0.8, y: 1.1, w: 2.6, h: 2.6, fill: { color: BLUE }, line: { color: ICE, width: 2 } });
  s.addText('MMD', { x: 0.8, y: 1.5, w: 2.6, h: 1.0, fontSize: 42, bold: true, color: WHITE, align: 'center' });
  s.addText('DISTRIBUTION', { x: 0.75, y: 2.55, w: 2.7, h: 0.35, fontSize: 8, bold: true, color: CYAN, align: 'center', charSpacing: 2 });

  s.addShape(pptx.ShapeType.roundRect, { x: 11.2, y: 0.2, w: 1.9, h: 0.42, fill: { color: NAVY }, line: { color: ICE, width: 1 }, rectRadius: 0.06 });
  s.addText(`Язык: ${LANG}  ·  change LANG const`, { x: 11.25, y: 0.22, w: 1.8, h: 0.2, fontSize: 6, color: CYAN, align: 'center' });
  s.addText('RU · HE · EN', { x: 11.25, y: 0.38, w: 1.8, h: 0.18, fontSize: 7, bold: true, color: WHITE, align: 'center' });

  s.addText(t('Годовой отчёт', 'דוח שנתי', 'Annual Report'), { x: 4.0, y: 1.1, w: 8.9, h: 0.65, fontSize: 36, bold: true, color: WHITE, align: 'left' });
  s.addText('2025', { x: 4.0, y: 1.8, w: 8.9, h: 1.1, fontSize: 80, bold: true, color: ICE, align: 'left' });
  s.addText(t('Продажи · Динамика · Рекомендации', 'מכירות · דינמיקה · המלצות', 'Sales · Dynamics · Recommendations'), {
    x: 4.0, y: 2.95, w: 8.9, h: 0.38, fontSize: 14, color: CYAN, align: 'left', charSpacing: 1
  });
  s.addShape(pptx.ShapeType.rect, { x: 4.0, y: 3.45, w: 8.9, h: 0.03, fill: { color: ICE } });

  const metrics = [
    { label: t('Общие продажи 2025','מכירות 2025','Total Sales 2025'), value: '₪ 5,531,234', color: ICE },
    { label: t('Рост vs 2024','גידול vs 2024','Growth vs 2024'), value: '▲ +8%', color: GREEN },
    { label: t('Компаний','חברות','Companies'), value: '4', color: GOLD },
    { label: t('2026 YTD','2026 ינו–מאי','2026 YTD'), value: '▲ +20%', color: BLUE },
  ];
  metrics.forEach((m, i) => {
    const x = 4.0 + i * 2.25;
    s.addShape(pptx.ShapeType.rect, { x, y: 3.55, w: 2.1, h: 0.8, fill: { color: NAVY }, line: { color: m.color, width: 1 } });
    s.addText(m.label, { x: x+0.08, y: 3.58, w: 1.94, h: 0.24, fontSize: 7, color: MUTED, align: 'center' });
    s.addText(m.value, { x: x+0.08, y: 3.82, w: 1.94, h: 0.42, fontSize: 16, bold: true, color: m.color, align: 'center' });
  });

  // TOC — 3 columns × 6 rows = 18 items
  const toc = [
    { n:'01', ru:'Итоги 2025 — Executive Summary',      he:'סיכום מנהלים 2025'              },
    { n:'02', ru:'Кашрут: кошерный vs некошерный',      he:'כשרות — כשר / לא כשר'           },
    { n:'03', ru:'Каналы: сети vs частный рынок',        he:'ערוצי הפצה'                     },
    { n:'04', ru:'Регионы: Эйлат vs Арава',             he:'אזורים — אילת / ערבה'            },
    { n:'05', ru:'Бренды — генераторы роста',            he:'מנועי צמיחה — מותגים'           },
    { n:'06', ru:'FORMULA 2025',                         he:'פורמולה — ניתוח 2025'            },
    { n:'07', ru:'ICE bdd 2025 (+24%)',                  he:'ICE bdd — כוכב השנה (+24%)'     },
    { n:'08', ru:'ICE MISH 2025',                        he:'ICE MISH — ניתוח 2025'          },
    { n:'09', ru:'INTER 2025',                           he:'אינטר — ניתוח 2025'             },
    { n:'10', ru:'2026 YTD — по компаниям',              he:'2026 ינו–מאי — לפי חברה'        },
    { n:'11', ru:'2026 YTD — регионы',                   he:'2026 ינו–מאי — אזורים'          },
    { n:'12', ru:'2026 YTD — каналы',                    he:'2026 ינו–מאי — ערוצים'          },
    { n:'13', ru:'2026 YTD — кашрут',                    he:'2026 ינו–מאי — כשרות'           },
    { n:'14', ru:'FORMULA 2026',                         he:'פורמולה 2026'                    },
    { n:'15', ru:'ICE bdd 2026',                         he:'ICE bdd 2026'                   },
    { n:'16', ru:'ICE MISH 2026',                        he:'ICE MISH 2026'                  },
    { n:'17', ru:'INTER 2026',                           he:'אינטר 2026'                     },
    { n:'18', ru:'Выводы и следующие шаги',              he:'סיכום והמלצות לפעולה'           },
  ];

  s.addText(t('Содержание', 'תוכן עניינים', 'Contents'), {
    x: 3.7, y: 4.45, w: 9.5, h: 0.28, fontSize: 9, bold: true, color: ICE, align: 'left', charSpacing: 3
  });
  s.addShape(pptx.ShapeType.rect, { x: 3.7, y: 4.76, w: 9.5, h: 0.02, fill: { color: NAVY } });

  toc.forEach((t_, i) => {
    const col = i < 6 ? 0 : (i < 12 ? 1 : 2);
    const row = i % 6;
    const x = 3.7 + col * 3.18;
    const y = 4.82 + row * 0.38;
    s.addText(t_.n, { x, y: y+0.03, w: 0.4, h: 0.28, fontSize: 10, bold: true, color: GOLD, align: 'center' });
    s.addShape(pptx.ShapeType.rect, { x: x+0.43, y: y+0.04, w: 0.02, h: 0.26, fill: { color: ICE } });
    s.addText(LANG === 'HE' ? t_.he : t_.ru, { x: x+0.5, y: y+0.07, w: 2.55, h: 0.26, fontSize: 7.5, color: WHITE, align: 'left' });
  });

  s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.1, w: 13.33, h: 0.4, fill: { color: NAVY } });
  s.addText('MMD Distribution · Power BI Data · 2025', { x: 0.4, y: 7.17, w: 6.0, h: 0.24, fontSize: 8, color: CYAN, align: 'left' });
  s.addText(t('Конфиденциально', 'סודי', 'Confidential'), { x: 7.0, y: 7.17, w: 6.0, h: 0.24, fontSize: 8, color: MUTED, align: 'right' });
}

// ─── S2: Executive Summary ────────────────────────────────────────────────────
function s2_exec() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, t('01 · ИТОГИ','01 · סיכום','01 · SUMMARY'), t('Общие продажи 2025 vs 2024','מכירות כוללות 2025 מול 2024','Total Sales 2025 vs 2024'), 'MMD Distribution');

  kpiBox(s, 0.3,  0.9, 4.1, 1.15, t('Продажи 2025','מכירות 2025','Sales 2025'), '₪ 5,531,234', 'TOTAL 2025', NAVY);
  kpiBox(s, 4.6,  0.9, 4.1, 1.15, t('Продажи 2024','מכירות 2024','Sales 2024'), '₪ 5,143,192', 'TOTAL 2024', BLUE);
  kpiBox(s, 9.1,  0.9, 4.0, 1.15, t('Годовой рост','גידול שנתי','Annual Growth'), '▲ +8%', 'Δ +388,043 ₪', GREEN);

  s.addShape(pptx.ShapeType.rect, { x: 0.3, y: 2.2, w: 7.8, h: 4.1, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addText(t('Продажи по компаниям — 2025 vs 2024','מכירות לפי חברה','Sales by Company'), {
    x: 0.4, y: 2.28, w: 7.6, h: 0.3, fontSize: 10, bold: true, color: NAVY, align: 'left'
  });

  const colW = [2.0, 1.6, 1.6, 1.5, 0.9];
  const hdrCells = [t('Компания','חברה','Company'),'2024 ₪','2025 ₪',t('Δ шек.','Δ ₪','Δ ILS'),'Δ %'].map((text, i) => ({
    text, options: { fill: NAVY, color: WHITE, bold: true, fontSize: 9, align: 'center', valign: 'middle', border: { pt: 1, color: BORDER }, w: colW[i] }
  }));

  const dataRows = DATA_COMPANIES.map((c, i) => {
    const bg = i % 2 === 0 ? WHITE : LIGHT;
    const dc = pctColor(c.pct);
    return [
      { text: c.name,                             options: { fill: bg, color: TEXT,  bold: c.name==='FORMULA', fontSize: 10, align: 'left',   valign:'middle', border:{pt:1,color:BORDER}, w:colW[0] } },
      { text: fmt(c.y2024),                       options: { fill: bg, color: MUTED, fontSize: 10, align: 'center', valign:'middle', border:{pt:1,color:BORDER}, w:colW[1] } },
      { text: fmt(c.y2025),                       options: { fill: bg, color: TEXT,  bold: true, fontSize: 10, align: 'center', valign:'middle', border:{pt:1,color:BORDER}, w:colW[2] } },
      { text: (c.delta>0?'+':'')+fmt(c.delta),    options: { fill: bg, color: pctColor(c.delta>0?20:-1), bold:true, fontSize:10, align:'center', valign:'middle', border:{pt:1,color:BORDER}, w:colW[3] } },
      { text: arrow(c.pct),                       options: { fill: bg, color: dc, bold: true, fontSize: 10, align: 'center', valign:'middle', border:{pt:1,color:BORDER}, w:colW[4] } },
    ];
  });
  const totCells = [
    { text: t('ИТОГО','סה"כ','TOTAL'), options: { fill: LIGHT, color: NAVY, bold:true, fontSize:10, align:'left',   valign:'middle', border:{pt:1,color:BORDER}, w:colW[0] } },
    { text: fmt(TOTAL_2024),           options: { fill: LIGHT, color: TEXT,  bold:true, fontSize:10, align:'center', valign:'middle', border:{pt:1,color:BORDER}, w:colW[1] } },
    { text: fmt(TOTAL_2025),           options: { fill: LIGHT, color: TEXT,  bold:true, fontSize:10, align:'center', valign:'middle', border:{pt:1,color:BORDER}, w:colW[2] } },
    { text: `+${fmt(TOTAL_DELTA)}`,    options: { fill: LIGHT, color: GREEN, bold:true, fontSize:10, align:'center', valign:'middle', border:{pt:1,color:BORDER}, w:colW[3] } },
    { text: `▲ +${TOTAL_PCT}%`,        options: { fill: LIGHT, color: GREEN, bold:true, fontSize:10, align:'center', valign:'middle', border:{pt:1,color:BORDER}, w:colW[4] } },
  ];
  s.addTable([hdrCells, ...dataRows, totCells], { x: 0.35, y: 2.62, w: 7.7, rowH: 0.38, colW, border: { pt: 0 } });

  s.addShape(pptx.ShapeType.rect, { x: 8.3, y: 2.2, w: 4.8, h: 4.1, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addText(t('Рост по компаниям (%)','גידול לפי חברה','Growth by Company (%)'), {
    x: 8.4, y: 2.28, w: 4.6, h: 0.3, fontSize: 10, bold: true, color: NAVY, align: 'left'
  });
  const maxPct = Math.max(...DATA_COMPANIES.map(c => Math.abs(c.pct || 0)));
  DATA_COMPANIES.forEach((c, i) => {
    const y = 2.72 + i * 0.7;
    const barW = maxPct > 0 ? ((c.pct || 0) / maxPct) * 2.2 : 0;
    const bc = pctColor(c.pct);
    s.addText(c.name, { x: 8.4, y: y+0.06, w: 1.6, h: 0.28, fontSize: 9, bold: true, color: TEXT, align: 'left' });
    s.addShape(pptx.ShapeType.rect, { x: 10.1, y: y+0.06, w: Math.max(barW, 0.02), h: 0.28, fill: { color: bc } });
    s.addText(arrow(c.pct), { x: 10.1 + Math.max(barW, 0.05) + 0.08, y: y+0.06, w: 0.75, h: 0.28, fontSize: 9, bold: true, color: bc, align: 'left' });
  });

  insightBox(s, 0.3, 6.3, 12.7, 0.58,
    t('Главный вывод:','תובנה:','Key Insight:'),
    t('ICE bdd — единственный быстрорастущий игрок (+24%). FORMULA стагнирует (0%). Рост всего рынка держится за счёт ICE bdd и ICE MISH.',
      'ICE bdd — מנוע הצמיחה היחיד (+24%). FORMULA בקיפאון (0%). צמיחת השוק מוסברת ע"י ICE bdd ו-ICE MISH.',
      'ICE bdd is the sole fast-growth player (+24%). FORMULA stagnant (0%). Market growth driven by ICE bdd & ICE MISH.'),
    'E8F4FD', BLUE
  );
  footerLine(s, 2);
}

// ─── S3–S18 via dataSlide ─────────────────────────────────────────────────────
function buildSlides() {
  // S3: Кашрут
  dataSlide({
    pageNum: 3,
    section: t('02 · КАШРУТ','02 · כשרות','02 · KOSHER'),
    title:   t('Кашрут: кошерный vs некошерный рынок','כשרות: כשר מול לא כשר','Kosher vs Non-Kosher Market'),
    imgTs: '180740',
    kpis: [
      { label: t('Кошерный сегмент','כשר','Kosher'),         value: '▲ +2%',  sub: '₪ 3,086,294 → 3,142,652', color: BLUE  },
      { label: t('Некошерный сегмент','לא כשר','Non-Kosher'), value: '▲ +16%', sub: '₪ 2,058,898 → 2,388,582', color: GREEN },
    ],
    analysis: t(
      'Non-kosher +16% — в 8× быстрее кошерного. Демографический тренд работает на нас.\n\n❓ Мы его используем или просто едем по волне?\n\nКошер +2% — стагнация. А у FORMULA кошерный портфель уже -9%. Это рынок проседает или мы теряем полку и клиентов?\n\nБез SKU-аудита по каждой компании ответа нет.',
      'לא-כשר +16% — פי 8 מהכשר. מגמה דמוגרפית עובדת לטובתנו.\n\n❓ האם אנו מנצלים אותה — או פשוט רוכבים על הגל?\n\nכשר +2% — קיפאון. ב-FORMULA הכשר כבר -9%. זה השוק יורד — או שאנחנו מאבדים מדף ולקוחות? ללא אודיט SKU — אין תשובה.',
      'Non-kosher +16% — 8× faster than kosher. Demographic trend working in our favour.\n\n❓ Are we capturing it — or just riding the wave?\n\nKosher +2% — stagnation. FORMULA kosher already -9%. Is the market declining — or are we losing shelf & clients? No answer without SKU audit.'
    ),
    rec: t(
      'Активно заходить в non-kosher — тренд долгосрочный. Кошер: провести SKU-аудит по каждой компании. Выявить — это рыночная просадка или наша потеря позиций. Разные диагнозы → разные действия.',
      'להיכנס אקטיבית ללא-כשר — מגמה לטווח ארוך. כשר: לבצע אודיט SKU לכל חברה. לאבחן — האם זו ירידת שוק או אובדן עמדות שלנו. אבחון שונה = פעולה שונה.',
      'Actively push non-kosher — long-term trend. Kosher: SKU audit per company. Diagnose — market decline or our position loss? Different diagnosis → different action.'
    ),
  });

  // S4: Каналы
  dataSlide({
    pageNum: 4,
    section: t('03 · КАНАЛЫ','03 · ערוצים','03 · CHANNELS'),
    title:   t('Каналы сбыта: сети vs частный рынок','ערוצי הפצה: רשתות מול שוק פרטי','Distribution Channels: Chains vs Independent'),
    imgTs: '180806',
    kpis: [
      { label: t('Частный рынок (שוק פרטי)','שוק פרטי','Independent Market'), value: '▲ +10%', sub: '₪ 2,792,696 → 3,060,872', color: GREEN },
      { label: t('Сетевые магазины (רשתות)','רשתות','Chain Stores'),         value: '▲ +5%',  sub: '₪ 2,350,495 → 2,470,362', color: BLUE  },
    ],
    analysis: t(
      'Частный рынок +10% против сетей +5% — разрыв вдвое.\n\n❓ Это рынок — или мы сами?\n\nВопросы к исполнению в сетях:\n• Частота визитов — раз в месяц?\n• Ценники и POS-материалы — есть на полке?\n• Участвуем в сетевых промо/каталогах?\n• Out-of-stock — товар вымывается и не пополняется?\n\nЕсли хоть один пункт слабый — +5% это не потолок рынка, это наша упущенная точка роста.',
      'שוק פרטי +10% מול רשתות +5% — פער כפול.\n\n❓ זה השוק — או אנחנו?\n\nשאלות לביצוע ברשתות:\n• תדירות ביקורים — פעם בחודש?\n• תוויות מחיר ו-POS — קיימים על המדף?\n• האם אנו משתתפים בפרומו ובקטלוגים?\n• חוסרים — האם הסחורה נגמרת ולא מתחדשת?\n\nאם נקודה אחת חלשה — +5% זה לא תקרת השוק, זה נקודת צמיחה שאנחנו מפסידים.',
      'Independent +10% vs chains +5% — 2× gap.\n\n❓ Is this the market — or is it us?\n\nExecution questions in chains:\n• Visit frequency — once a month?\n• Price tags & POS on shelf?\n• Participating in chain promos/catalogues?\n• Out-of-stock — product running out without replenishment?\n\nIf any one item is weak — +5% is not the market ceiling, it\'s our missed growth.'
    ),
    rec: t(
      'Аудит исполнения в 3 крупнейших сетях: частота визитов, состояние полки, наличие ценников, участие в промо. Задача: если сети работают как частный рынок — получим +10% вместо +5%. Это +₪120K/год.',
      'ביצוע אודיט בשלוש הרשתות הגדולות: תדירות ביקורים, מצב מדף, תוויות מחיר, השתתפות בפרומו. אם הרשתות עובדות כמו שוק פרטי — נגיע ל-+10% במקום +5%. זה +₪120K לשנה.',
      'Audit execution in top 3 chains: visit frequency, shelf condition, price tags, promo participation. If chains perform like independent market — we get +10% instead of +5%. That\'s +₪120K/year.'
    ),
  });

  // S5: Регионы — Эйлат: THK +19%, не MMD
  dataSlide({
    pageNum: 5,
    section: t('04 · РЕГИОНЫ','04 · אזורים','04 · REGIONS'),
    title:   t('Регионы: Эйлат +19% и Арава -24% (2025)','אזורים: אילת +19% וערבה -24%','Regions: Eilat +19% and Arava -24%'),
    imgTs: '180835',
    kpis: [
      { label: t('Эйлат — ⚠️ аномалия: эвакуированные + блокада Хусити','אילת — ⚠️ אנומליה: מפונים + חות׳ים','Eilat — ⚠️ anomaly: evacuees + Houthi blockade'), value: '▲ +19%', sub: '₪ 3,724,977 → 4,449,672', color: AMBER   },
      { label: t('Арава — военная зона (2024→2025)','ערבה — איזור מלחמה (2024→2025)','Arava — war zone (2024→2025)'),              value: '▼ -24%', sub: '₪ 1,418,214 → 1,081,563', color: DECLINE },
    ],
    analysis: t(
      '⚠️ Рост Эйлата +19% (2024→2025) НЕ органический!\n\n~60,000 эвакуированных удвоили население. Туристов = 0: порт -80% выручки (блокада Хусити). Но MMD работает с местной розницей — эвакуированные покупают ежедневно, месяцами.\n\nTHK +19% = рост вместе с рынком, не победа бренда.\n\nАрава -24% = другая история. Нет туристов, нет HRI — чисто местные: кибуцы, мошавы вдоль иорданской границы. Погранзоны закрыты → агент не мог приехать, клиенты частично эвакуированы.',
      '⚠️ +19% אילת (2024→2025) — לא אורגני!\n~60,000 מפונים (מ-7.10.2023) הכפילו אוכלוסייה. תיירים = 0: רמון ללא טיסות, נמל אילת — הכנסות -80% (212M→42M ₪), בסף סגירה (חות׳ים חסמו ים סוף). כל קמעונאות אילת עלתה ~18-22% (StoreNext). THK +19% = מגמת שוק, לא ניצחון מותג.\nערבה -24% (2024→2025) = אזורים גבוליים סגורים.',
      '⚠️ +19% Eilat (2024→2025) NOT organic!\n~60K evacuees (since Oct 7, 2023) doubled population. Tourists = 0: Eilat port revenue -80% (212M→42M ₪), near closure (Houthi Red Sea blockade). All Eilat retail grew ~18-22% (StoreNext). THK +19% = market trend, not brand win.\nArava -24% (2024→2025) = border zones closed since Oct 2023.'
    ),
    rec: t(
      'НЕ планировать Эйлат +19% как устойчивый тренд. После нормализации — ожидать возврата к ~10-12%. Арава: режим снят — начать восстановление каналов. Потенциал отскока огромный, действовать сейчас.',
      'לא לתכנן +19% אילת כמגמה בת-קיימא. ערבה: המצב הביטחוני הוסר — להתחיל שיקום הערוצים. פוטנציאל הריבאונד עצום, לפעול עכשיו.',
      'DO NOT project Eilat +19% as sustainable. Arava: security restrictions lifted — begin channel restoration now. Rebound potential is huge, act immediately.'
    ),
    sourceLinks: [
      { text: 'TheMarker — «אילת מלאה — עסקים סובלים»', url: 'https://www.themarker.com' },
      { text: 'Globes — «מכירות בעלייה באילת»', url: 'https://www.globes.co.il' },
      { text: 'CBS — סקר מסחר קמעונאי', url: 'https://www.cbs.gov.il' },
    ],
  });

  // S6: Бренды
  dataSlide({
    pageNum: 6,
    section: t('05 · БРЕНДЫ','05 · מותגים','05 · BRANDS'),
    title:   t('Бренды — генераторы роста 2025','מותגים — מנועי צמיחה 2025','Brand Growth Drivers 2025'),
    imgTs: '181022',
    kpis: [
      { label: t('YUKKI — лидер роста по объёму','YUKKI — מוביל צמיחה','YUKKI — volume leader'), value: '▲ +50%', sub: 'Крупнейший δ в абс. выражении', color: GREEN },
      { label: t('TERRA FOOD — сюрприз года','TERRA FOOD — הפתעת השנה','TERRA FOOD — year surprise'), value: '▲+156%', sub: 'Малая база → взрывной рост',     color: GREEN },
    ],
    analysis: t(
      'YUKKI +50% — реальный движок: большой объём, большой прирост в шекелях.\n\nTERRA FOOD +156% — красивая цифра, но малая база: в абсолютных шекелях вклад небольшой. Без YUKKI — картина гораздо скромнее.\n\nROSHEN +1% — флагман INTER стоит. Это насыщение рынка или мы не делаем промо и не обновляем выкладку?\n\n❓ По каким брендам мы работаем на автопилоте и теряем позиции без шума?',
      'YUKKI +50% — מנוע אמיתי: נפח גדול, גידול גדול בשקלים.\n\nTERRA FOOD +156% — מספר יפה אבל בסיס קטן: התרומה בשקלים קטנה. בלי YUKKI — התמונה הרבה יותר צנועה.\n\nROSHEN +1% — מותג דגל עומד במקום. האם זה רוויית שוק — או שאנחנו לא עושים פרומו ולא מחדשים תצוגה?\n\n❓ אילו מותגים רצים על טייס אוטומטי ומאבדים עמדות בלי רעש?',
      'YUKKI +50% — the real engine: large volume, large absolute growth.\n\nTERRA FOOD +156% — impressive %, but small base: absolute contribution is modest. Without YUKKI — a much weaker picture.\n\nROSHEN +1% — flagship standing still. Market saturation or are we not doing promo/display refresh?\n\n❓ Which brands are running on autopilot while quietly losing position?'
    ),
    rec: t(
      'YUKKI и TERRA FOOD: защитить полку, усилить промо — они несут цифры. ROSHEN: провести аудит промо-активности — есть ли акции, ценники, каталоги?',
      'YUKKI ו-TERRA FOOD: להגן על המדף, לחזק פרומו. ROSHEN: לבדוק פעילות פרומו — יש מבצעים, תוויות, קטלוגים?',
      'YUKKI & TERRA FOOD: protect shelf, reinforce promo — they carry the numbers. ROSHEN: audit promo activity — are there deals, price tags, catalogues?'
    ),
  });

  // S7: FORMULA
  dataSlide({
    pageNum: 7,
    section: t('06 · FORMULA','06 · פורמולה','06 · FORMULA'),
    title:   t('FORMULA — анализ 2025: кашрут и динамика','פורמולה — ניתוח 2025: כשרות ודינמיקה','FORMULA — 2025: Kosher Split & Dynamics'),
    imgTs: '181103',
    kpis: [
      { label: t('Кошерный портфель FORMULA','FORMULA — כשר','FORMULA — Kosher'),         value: '▼ -9%',  sub: '₪ 1,686,813 → 1,541,608', color: DECLINE },
      { label: t('Некошерный портфель FORMULA','FORMULA — לא כשר','FORMULA — Non-Kosher'), value: '▲ +14%', sub: '₪ 1,097,662 → 1,256,511', color: GREEN  },
    ],
    analysis: t(
      'FORMULA +0% — итог скрывает разрыв внутри:\n• Кошер -9%: клиенты уходят. Куда? К конкурентам? Или меняют на non-kosher?\n• Non-kosher +14%: единственный рост\n\nשופרסל דיל +370% — крупный контракт. Разовый вход или начало масштабирования?\n\n⚠️ Май-июн 2026: ВСЕ FORMULA SKU — участие в рабочих днях <50% (диапазон 4–35%). Проблема частоты визитов. Выделенный агент = больше визитов = больше рабочих дней.\n\n❓ Кошер -9% — это рынок или наша потеря позиций? Эти диагнозы требуют разных действий.',
      'FORMULA +0% — מסתיר פער פנימי:\n• כשר -9%: לקוחות עוזבים. לאן? מתחרים? עוברים ללא-כשר?\n• לא-כשר +14%: הצמיחה היחידה\n\nשופרסל דיל +370% — כניסה חד-פעמית או תחילת שכפול?\n\n❓ כשר -9% — זה השוק או אובדן עמדות? האבחון משנה את הפעולה.',
      'FORMULA +0% — hides an internal gap:\n• Kosher -9%: clients leaving. To whom? Competitors? Switching to non-kosher?\n• Non-kosher +14%: the only growth\n\nShufersal Deal +370% — one-time entry or start of scaling?\n\n❓ Kosher -9% — market decline or position loss? Different diagnosis = different action.'
    ),
    rec: t(
      'Аргумент за выделенного агента: ВСЕ FORMULA SKU участвуют менее чем в 50% рабочих дней (4–35%) — проблема частоты, не спроса. Срочно: понять кто забирает кошерных клиентов. PRESIDENT (май 2026) — кошерная линейка с короткими сроками → требуется высокая частота визитов и усилия по продвижению в точках. Шопрсаль Диль +370% — масштабировать в других сетях.',
      'דחוף: להבין מי לוקח את לקוחות הכשר של FORMULA. מתחרה על המדף — או שינוי העדפות צרכנים? שופרסל דיל +370% — לתעד מה עבד ולשכפל ברשתות אחרות.',
      'Urgent: identify who is taking FORMULA\'s kosher clients. Shelf competitor or consumer preference shift? Shufersal Deal +370% — document what worked and replicate in other chains.'
    ),
  });

  // S8: ICE bdd
  dataSlide({
    pageNum: 8,
    section: t('07 · ICE bdd','07 · ICE bdd','07 · ICE bdd'),
    title:   t('ICE bdd — звезда года: +24%','ICE bdd — כוכב השנה: +24%','ICE bdd — Star of the Year: +24%'),
    imgTs: '181837',
    kpis: [
      { label: t('ICE bdd общий рост','ICE bdd — צמיחה כללית','ICE bdd Growth'), value: '▲ +24%', sub: '₪ 1,056,545 → 1,305,201', color: GREEN },
      { label: t('YUKKI — флагман','YUKKI — דגל','YUKKI — flagship'),            value: '▲ +50%', sub: 'SVALYA ▼ -32% (внимание!)',  color: GREEN },
    ],
    analysis: t(
      'ICE bdd +24% — лучший результат холдинга. Что делают иначе?\n• Оба сегмента в плюсе: кошер +32%, некошер +15%\n• Оба региона в плюсе: Эйлат +23%, Арава +26%\n\nЭто не случайность — это системная работа. Нужно понять модель и перенести в другие компании.\n\n❓ SVALYA -32% — было принято решение вывести («не идёт»). Но оправдано ли оно? На каких данных основано — или на ощущении? Стоит перепроверить до финального вывода.',
      'ICE bdd +24% — התוצאה הטובה של הקבוצה. מה עושים אחרת?\n• שני סגמנטים: כשר +32%, לא-כשר +15%\n• שני אזורים: אילת +23%, ערבה +26%\n\nזה לא מקרי — זו עבודה שיטתית. צריך להבין את המודל ולהעביר לחברות אחרות.\n\n❓ SVALYA -32% — התקבלה החלטה להוציא מהמגוון («לא נמכר»). האם זה מוצדק? מה הנתונים מאחורי ההחלטה — או שזה תחושת בטן? כדאי לבדוק לפני הוצאה סופית.',
      'ICE bdd +24% — best result in the group. What are they doing differently?\n• Both segments: kosher +32%, non-kosher +15%\n• Both regions: Eilat +23%, Arava +26%\n\nThis is not luck — it\'s systematic execution. Understand the model, transfer to other companies.\n\n❓ SVALYA -32% — a decision was made to phase it out ("doesn\'t sell"). But is that justified? What data supports it — or is it a gut feel? Worth verifying before final exit.'
    ),
    rec: t(
      'Провести интервью с командой ICE bdd: что именно делают с полкой, промо, запасом? Задокументировать и передать как стандарт. SVALYA: пересмотреть решение о выводе — запросить данные продаж по точкам, аудит полки, сравнение с конкурентом. Решения "не идёт" без цифр стоят дорого.',
      'לערוך ראיון עם צוות ICE bdd: מה בדיוק עושים עם המדף, פרומו, מלאי? לתעד ולהעביר כסטנדרט. SVALYA: לשקול מחדש את ההחלטה — לבקש נתוני מכירות לפי נקודה, ביקורת מדף, השוואה למתחרה. החלטות "לא נמכר" ללא מספרים יקרות מאוד.',
      'Interview ICE bdd team: what exactly do they do with shelf, promo, stock? Document and pass as standard. SVALYA: reconsider the phase-out decision — pull point-of-sale data, shelf audit, competitor comparison. "Doesn\'t sell" decisions without data are expensive.'
    ),
  });

  // S9: ICE MISH
  dataSlide({
    pageNum: 9,
    section: t('08 · ICE MISH','08 · ICE MISH','08 · ICE MISH'),
    title:   t('ICE MISH — устойчивый рост: +18%','ICE MISH — צמיחה יציבה: +18%','ICE MISH — Steady Growth: +18%'),
    imgTs: '182504',
    kpis: [
      { label: t('ICE MISH общий рост','ICE MISH — צמיחה כללית','ICE MISH Growth'), value: '▲ +18%', sub: '₪ 590,549 → 696,390',      color: GREEN },
      { label: t('RUD — взрывной рост','RUD — צמיחה פיצוצית','RUD — explosive'),    value: '▲+103%', sub: 'NICEE ▼ -38% (диагностика)', color: AMBER },
    ],
    analysis: t(
      'ICE MISH +18% — ровный рост, нет региональных провалов.\n\nRUD +103% — что стоит за этой цифрой? Новый клиент, новая точка, акция — нужно разобрать и задокументировать модель чтобы повторить.\n\nNICEE -38% — это не "рыночная динамика". Это конкретный клиент или полка. Кто-то что-то потерял.\n\n❓ שופרסל דיל +181% — случайный пик или результат работы? Если работа — документировать.',
      'ICE MISH +18% — צמיחה אחידה, ללא פרוסות אזוריות.\n\nRUD +103% — מה עומד מאחורי המספר הזה? לקוח חדש, נקודת מכירה חדשה, מבצע — צריך לנתח ולתעד כדי לשכפל.\n\nNICEE -38% — זו לא "דינמיקת שוק". זה לקוח ספציפי או מדף. מישהו משהו איבד.\n\n❓ שופרסל דיל +181% — פיק מקרי או תוצאת עבודה? אם עבודה — לתעד.',
      'ICE MISH +18% — steady growth, no regional collapses.\n\nRUD +103% — what is behind this number? New client, new outlet, promo — need to analyse and document the model to replicate it.\n\nNICEE -38% — this is not "market dynamics". Specific client or shelf. Someone lost something.\n\n❓ Shufersal Deal +181% — coincidence peak or result of work? If work — document it.'
    ),
    rec: t(
      'RUD: разобрать что привело к +103% — задокументировать и передать как модель. NICEE: у кого упали продажи — у одного клиента или у многих? Ответ определяет действие.',
      'RUD: לנתח מה הביא ל-+103% — לתעד ולהעביר כמודל. NICEE: אצל מי ירדו מכירות — לקוח אחד או רבים? התשובה קובעת את הפעולה.',
      'RUD: analyse what drove +103% — document and transfer as a model. NICEE: did sales drop at one client or many? The answer determines the action.'
    ),
  });

  // S10: INTER — removed kashrut-supplier rec + UKR OLIYA
  dataSlide({
    pageNum: 10,
    section: t('09 · INTER','09 · אינטר','09 · INTER'),
    title:   t('INTER — стабильный защитник: +5%','INTER — שחקן יציב: +5%','INTER — Stable Defender: +5%'),
    imgTs: '182822',
    kpis: [
      { label: t('INTER общий рост','INTER — צמיחה כללית','INTER Growth'), value: '▲ +5%', sub: '₪ 875,500 → 917,877',             color: BLUE },
      { label: t('ROSHEN — флагман (88%)','ROSHEN — דגל (88%)','ROSHEN — flagship (88%)'), value: '→ 0%', sub: '₪ 814,129 → 816,145', color: FLAT },
    ],
    analysis: t(
      'INTER +5% — несмотря на кашрут-потери в 2025. Проблемы с кашрутом товара = потери темпов роста → восстановление позиций.\n\nСети -16%: кашрут = условие входа в листинг. Без нужной хашгахи — ИСКЛЮЧЕНО.\n\n❓ Кашрут закрыт к 2026? → восстановление листинга в сетях = прямой рычаг роста.',
      'INTER +5% — למרות בעיות כשרות ואספקה ב-2025. בתנאים "נקיים" המספר היה גבוה יותר.\n\nרשתות -16%: בלי הכשר — מחוץ לאסורטימנט, נקודה. כשרות = כרטיס כניסה.\n\n❓ הכשרות סגורה לקראת 2026? אם כן — שחזור הליסטינג ברשתות = מנוף צמיחה ישיר.',
      'INTER +5% — despite kashrut and supply problems in 2025. In "clean" conditions the number would be higher.\n\nChains -16%: no hashgaha = EXCLUDED, full stop. Kashrut = entry ticket.\n\n❓ Is kashrut resolved for 2026? If yes — restoring chain listings is a direct growth lever.'
    ),
    rec: t(
      'ROSHEN: промо-аудит в топ-10 клиентах.',
      'ROSHEN: בדיקת פרומו ב-10 לקוחות הגדולים.',
      'ROSHEN: promo audit in top 10 clients.'
    ),
  });

  // S11: 2026 YTD
  dataSlide({
    pageNum: 11,
    section: t('10 · 2026 YTD','10 · 2026 ינו–מאי','10 · 2026 YTD'),
    title:   t('2026 (Янв–Май): все компании растут +20%','2026 ינו–מאי: כל החברות בצמיחה +20%','2026 Jan–May: All Companies +20%'),
    imgTs: '183454',
    kpis: [
      { label: t('Общий рост 2026 YTD','צמיחה כוללת 2026 ינו–מאי','Total Growth 2026 YTD'), value: '▲ +20%', sub: '₪ 1,992,157 → 2,390,950', color: GREEN },
      { label: t('⚠️ Данные за 5 мес. (Янв–Май)','⚠️ 5 חודשים בלבד','⚠️ Partial year — 5 months'), value: '2026', sub: 'Янв · Фев · Мар · Апр · Май',  color: AMBER },
    ],
    analysis: t(
      'Первый год когда ВСЕ 4 компании в плюсе:\n• FORMULA +23% — возрождение после стагнации\n• ICE bdd +9% — продолжает расти\n• INTER +19% — резкое ускорение\n• ICE MISH +29% — лучший результат\n\n⚠️ Сравнение Jan–May 2026 vs Jan–May 2025. Полный год будет другим.',
      'ראשון שכל 4 החברות בפלוס:\n• FORMULA +23%\n• ICE bdd +9%\n• INTER +19%\n• ICE MISH +29%\n\n⚠️ ינו–מאי 2026 מול 2025 בלבד.',
      'First year ALL 4 companies positive:\n• FORMULA +23%\n• ICE bdd +9%\n• INTER +19%\n• ICE MISH +29%\n\n⚠️ Jan–May only comparison.'
    ),
    rec: t(
      'Прогноз 2026 full year при текущем темпе: ~₪5,85M (+15-18% vs 2025). Приоритет: убедиться что FORMULA +23% — устойчиво, а не разовый эффект. Повторить ревью в сентябре по данным за 8 мес.',
      'תחזית 2026 שנה מלאה: ~₪5.85M (+15-18%). לוודא ש-+23% FORMULA הוא קבוע. לחזור בספטמבר עם 8 חודשים.',
      '2026 full-year forecast at current pace: ~₪5.85M (+15-18% vs 2025). Verify FORMULA +23% is sustainable. Review again in September with 8-month data.'
    ),
  });

  // S12: 2026 Регионы
  dataSlide({
    pageNum: 12,
    section: t('11 · 2026 РЕГИОНЫ','11 · 2026 אזורים','11 · 2026 REGIONS'),
    title:   t('2026 YTD — Эйлат +34%, Арава -31%','2026 ינו–מאי — אילת +34%, ערבה -31%','2026 YTD — Eilat +34%, Arava -31%'),
    imgTs: '183515',
    kpis: [
      { label: t('Эйлат 2026 — аномалия усиливается','אילת 2026 — אנומליה מתחזקת','Eilat 2026 — anomaly strengthening'), value: '▲ +34%', sub: '₪ 1,564,744 → 2,097,671', color: AMBER   },
      { label: t('Арава 2026 — падение углубляется','ערבה 2026 — הנפילה מתעמקת','Arava 2026 — fall deepens'),            value: '▼ -31%', sub: '₪ 427,413 → 293,279',   color: DECLINE },
    ],
    analysis: t(
      'Обе тенденции 2025 ускоряются (янв-май 2026 vs янв-май 2025):\n\nЭйлат +34% (было +19% в 2025) — рост продолжается. ❓ Что за этим стоит — новые клиенты, эвакуированные, возврат туристов? Нужно проверить структуру роста до прогноза на H2.\n\nАрава -31% (было -24%) — данные за период когда режим ещё действовал. Режим снят → ожидать восстановление. Огромный потенциал отскока.',
      'שתי המגמות מתחזקות (ינו-מאי 2026 מול ינו-מאי 2025):\nאילת +34% (היה +19% ב-2025) — הצמיחה נמשכת. ❓ מה מאחורי זה — לקוחות חדשים, מפונים, חזרת תיירים? צריך לבדוק את מבנה הצמיחה לפני תחזית H2.\nערבה -31% (היה -24%) — נתונים מתקופה שהמצב הביטחוני עוד חל. המצב הוסר → לצפות לריבאונד. פוטנציאל עצום.',
      'Both trends accelerating (Jan-May 2026 vs Jan-May 2025):\nEilat +34% (was +19% in 2025) — growth continues. ❓ What drives it — new clients, evacuees, returning tourists? Need to verify growth structure before H2 forecast.\nArava -31% (was -24%) — data covers the period when restrictions were still in place. Restrictions now lifted → expect rebound. Huge recovery potential.'
    ),
    rec: t(
      'Эйлат: не закладывать +34% как устойчивый тренд — сначала понять структуру роста. Логистика: цикл заказа среда→воскресенье = потери свежести, под-заказ. Вариант: заказ четверг 14:00 → поставка воскресенье. НЕ сокращать ресурсы в Арава — режим снят, огромный потенциал отскока, действовать сейчас.',
      'אילת: לא לתקצב +34% כמגמה יציבה — לבדוק קודם מבנה הצמיחה. לוגיסטיקה: מחזור הזמנה רביעי→ראשון = אובדן טריות, הזמנת חסר. אפשרות: הזמנה חמישי 14:00 → מסירה ראשון. לא לצמצם ב-ערבה — המצב הוסר, פוטנציאל עצום, לפעול עכשיו.',
      'Eilat: do not budget +34% as a stable trend — verify growth structure first. Logistics: order Wed→receive Sun = freshness loss, under-ordering. Option: order Thursday 14:00 → Sunday delivery. DO NOT cut Arava resources — restrictions lifted, huge rebound potential, act now.'
    ),
    sourceLinks: [
      { text: 'CBS Israel — נתוני מסחר', url: 'https://www.cbs.gov.il' },
      { text: 'Bank of Israel — Regional Report', url: 'https://www.boi.org.il' },
      { text: 'Ministry of Tourism Israel', url: 'https://www.gov.il/he/departments/ministry_of_tourism' },
    ],
  });

  // ─── NEW 2026 SLIDES ──────────────────────────────────────────────────────────

  // S13: 2026 Каналы
  dataSlide({
    pageNum: 13,
    section: t('12 · 2026 КАНАЛЫ','12 · 2026 ערוצים','12 · 2026 CHANNELS'),
    title:   t('2026 YTD — каналы: שוק פרטי +30%, רשתות +8%','2026 ינו–מאי — ערוצים','2026 YTD — Channels'),
    imgTs: '005502', imgDate: '08',
    kpis: [
      { label: t('Частный рынок 2026 (שוק פרטי)','שוק פרטי 2026','Independent Market 2026'), value: '▲ +30%', sub: '₪ 1,423,249 (2026 YTD)', color: GREEN },
      { label: t('Сетевые магазины 2026 (רשתות)','רשתות 2026','Chain Stores 2026'),         value: '▲ +8%',  sub: '₪ 967,701 (2026 YTD)',   color: BLUE  },
    ],
    analysis: t(
      'Разрыв вырос с 2× (2025: +10% vs +5%) до 3.7× (2026 YTD: +30% vs +8%).\n\nСети +8% растут медленнее общего рынка (+20%). Мы теряем долю в сетях — на фоне сильного частного рынка это не рыночный феномен.\n\nТоп кошерные каналы YTD:\n• חנויות +28%\n• המכולת שלי +44%\n• שופרסל דיל +46%\n• גלרו +96%\n• מחסני השוק +103%\n\n❓ Что делают агенты в сетях каждую неделю?',
      'הפער גדל מ-2× (2025) ל-3.7× (2026 YTD).\nרשתות +8% — גדלות איטי מהשוק הכולל (+20%). אנחנו מאבדים נתח ברשתות.\n\nערוצי כשר מובילים:\n• חנויות +28%, המכולת שלי +44%, שופרסל דיל +46%, גלרו +96%, מחסני השוק +103%',
      'Gap grew from 2× (2025) to 3.7× (2026 YTD: +30% vs +8%).\nChains +8% underperforming total market (+20%). We are losing share in chains.\n\nTop kosher channels: חנויות +28%, המכולת שלי +44%, שופרסל דיל +46%, גלרו +96%, מחסני השוק +103%'
    ),
    rec: t(
      'Сети: ввести KPI частоты визитов — минимум 2× в месяц на каждую точку. Цель: с +8% → +15% к Q4 2026. Частный рынок: держать темп, не снижать ресурс.',
      'רשתות: KPI תדירות ביקורים — מינימום 2× בחודש לכל נקודה. יעד: מ-+8% ל-+15% בQ4. שוק פרטי: לשמור קצב.',
      'Chains: KPI visit frequency — minimum 2× per month per outlet. Target: from +8% → +15% by Q4. Independent market: maintain pace.'
    ),
  });

  // S14: 2026 Кашрут
  dataSlide({
    pageNum: 14,
    section: t('13 · 2026 КАШРУТ','13 · 2026 כשרות','13 · 2026 KOSHER'),
    title:   t('2026 YTD — кашрут: לא כשר +29%, כשר +13%','2026 ינו–מאי — כשרות','2026 YTD — Kosher Split'),
    imgTs: '005605', imgDate: '08',
    kpis: [
      { label: t('Кошерный сегмент 2026','כשר 2026','Kosher 2026'),         value: '▲ +13%', sub: '₪ 1,274,231 (2026 YTD)', color: BLUE  },
      { label: t('Некошерный сегмент 2026','לא כשר 2026','Non-Kosher 2026'), value: '▲ +29%', sub: '₪ 1,116,719 (2026 YTD)', color: GREEN },
    ],
    analysis: t(
      'Оба сегмента в плюсе — впервые за два года.\n\nКошер ускорился с +2% (2025) до +13% (2026 YTD) — кашрут-recovery INTER начинает работать на весь холдинг.\n\nNon-kosher +29% vs +16% в 2025 — разрыв с кошером сохраняется (2.2×).\n\n❓ Non-kosher +29% — органика или ситуация? Нужен бенчмарк по рынку. Кошер: рост устойчив или одноразовый эффект?',
      'שני הסגמנטים בפלוס — בפעם הראשונה בשנתיים.\n\nכשר האיץ מ-+2% (2025) ל-+13% (2026 YTD) — שחזור הכשרות של INTER מתחיל לעבוד על כל הקבוצה.\n\nלא-כשר +29% מול +16% ב-2025 — הפער נשמר (2.2×).\n\n❓ לא-כשר +29% — אורגני או מצב? צריך מידה ביחס לשוק.',
      'Both segments positive — first time in two years.\n\nKosher accelerated from +2% (2025) to +13% (2026 YTD) — INTER kashrut recovery starting to benefit the whole group.\n\nNon-kosher +29% vs +16% in 2025 — gap maintained (2.2×).\n\n❓ Non-kosher +29% — organic or situational? Need market benchmark.'
    ),
    rec: t(
      'Кошер: продолжать восстановление листинга в сетях. Проверить — у каких компаний кошерный рост, у каких нет. Non-kosher: по каким SKU идёт рост — устойчивые бренды или разовые контракты?',
      'כשר: להמשיך שחזור ליסטינג ברשתות. לבדוק — אצל אילו חברות יש צמיחה בכשר. לא-כשר: אילו SKU צומחים — מותגים יציבים או עסקאות חד-פעמיות?',
      'Kosher: continue chain listing restoration. Verify which companies drive kosher growth. Non-kosher: which SKUs are growing — stable brands or one-off contracts?'
    ),
  });

  // S15: FORMULA 2026
  dataSlide({
    pageNum: 15,
    section: t('14 · FORMULA 2026','14 · פורמולה 2026','14 · FORMULA 2026'),
    title:   t('FORMULA 2026 YTD — разворот: +23%','פורמולה 2026 ינו–מאי — היפוך: +23%','FORMULA 2026 YTD — Turnaround: +23%'),
    imgTs: '005818', imgDate: '08',
    kpis: [
      { label: t('Кошерный FORMULA 2026','FORMULA — כשר 2026','FORMULA Kosher 2026'),         value: '▲ +9%',  sub: '₪ 692k (2026 YTD)', color: BLUE  },
      { label: t('Некошерный FORMULA 2026','FORMULA — לא כשר 2026','FORMULA Non-Kosher 2026'), value: '▲ +42%', sub: '₪ 641k (2026 YTD)', color: GREEN },
    ],
    analysis: t(
      'FORMULA разворачивается после нулевого 2025. Оба сегмента в плюсе:\n• Кошер +9% — наконец положительный после -9% в 2025\n• Non-kosher +42% — взрывной рост\n\nPRESIDENT (май 2026) — кошерная линейка, короткие сроки → требуется высокая частота визитов и усилия по продвижению в точках. Возможно уже влияет на кошер +9%.\n\n❓ Non-kosher +42% — это один крупный клиент или широкий рост? Один клиент = хрупко. Широкий рост = системный успех.',
      'FORMULA מתהפכת לאחר 0% ב-2025. שני הסגמנטים בפלוס:\n• כשר +9% — סוף סוף חיובי לאחר -9% ב-2025\n• לא-כשר +42% — צמיחה פיצוצית\n\nPRESIDENT (מאי 2026) — קו כשר, תפוגה קצרה → תדירות ביקורים גבוהה.\n\n❓ לא-כשר +42% — לקוח גדול אחד או צמיחה רחבה? לקוח אחד = שביר. צמיחה רחבה = הצלחה שיטתית.',
      'FORMULA turns around after zero-growth 2025. Both segments positive:\n• Kosher +9% — finally positive after -9% in 2025\n• Non-kosher +42% — explosive growth\n\nPRESIDENT (May 2026) — kosher line, short shelf life → high visit frequency. May already be driving kosher +9%.\n\n❓ Non-kosher +42% — one large client or broad growth? One client = fragile. Broad = systemic success.'
    ),
    rec: t(
      'Срочно: понять драйвер non-kosher +42% — задокументировать и защитить. Кошер +9%: сравнить с 2025 клиентской базой — кто вернулся, кто новый. PRESIDENT — мониторинг участия в рабочих днях (цель >50%).',
      'דחוף: להבין את מנוע לא-כשר +42% — לתעד ולהגן. כשר +9%: להשוות עם בסיס 2025 — מי חזר, מי חדש. PRESIDENT — לנטר השתתפות בימי עבודה (יעד >50%).',
      'Urgent: diagnose non-kosher +42% driver — document and protect it. Kosher +9%: compare to 2025 client base — who returned, who is new. PRESIDENT — monitor working day participation (target >50%).'
    ),
  });

  // S16: ICE bdd 2026
  dataSlide({
    pageNum: 16,
    section: t('15 · ICE bdd 2026','15 · ICE bdd 2026','15 · ICE bdd 2026'),
    title:   t('ICE bdd 2026 YTD — +9%: שוק פרטי +15%, רשתות →0%','ICE bdd 2026 — +9%','ICE bdd 2026 YTD — +9%'),
    imgTs: '010235', imgDate: '08',
    kpis: [
      { label: t('Частный рынок ICE bdd 2026','שוק פרטי ICE bdd 2026','Independent Market ICE bdd'), value: '▲ +15%', sub: '₪ 261,281 → 300,886', color: GREEN },
      { label: t('Сети ICE bdd 2026 (רשתות)','רשתות ICE bdd 2026','Chains ICE bdd 2026'),           value: '→ 0%',  sub: '₪ 167,765 → 168,089', color: FLAT  },
    ],
    analysis: t(
      'ICE bdd продолжает расти, но замедляется (был +24% в 2025, теперь +9%).\n\nЧастный рынок +15% — устойчивая база. YUKKI держит позиции.\n\nСети →0% — стагнация. В 2025 этот факт маскировался общим ростом. Причины: снизилась частота визитов? OOS? Нет ценников?\n\n52% כשר / 48% לא כשר — сбалансированный портфель.',
      'ICE bdd ממשיך לצמוח, אך מואט (+24% ב-2025, עכשיו +9%).\n\nשוק פרטי +15% — בסיס יציב. YUKKI מחזיק עמדות.\n\nרשתות →0% — קיפאון. ב-2025 זה הוסתר בצמיחה הכללית. סיבות: פחות תדירות ביקורים? חוסרים? אין תוויות?\n\n52% כשר / 48% לא כשר — תיק מאוזן.',
      'ICE bdd continues growing but decelerating (+24% in 2025, now +9%).\n\nIndependent +15% — stable base. YUKKI holds positions.\n\nChains →0% — stagnation. In 2025 this was masked by overall growth. Causes: fewer visits? OOS? No price tags?\n\n52% kosher / 48% non-kosher — balanced portfolio.'
    ),
    rec: t(
      'Сети ICE bdd: аудит топ-5 сетевых клиентов — частота визитов, ценники, OOS, промо. Цель: с 0% → +10% к Q4. Частный рынок: защитить полку YUKKI.',
      'רשתות ICE bdd: אודיט 5 לקוחות הרשת המובילים — תדירות, תוויות, חוסרים, פרומו. יעד: מ-0% ל-+10% בQ4. שוק פרטי: להגן על מדף YUKKI.',
      'Chains ICE bdd: audit top 5 chain clients — visit frequency, price tags, OOS, promo. Target: 0% → +10% by Q4. Independent: protect YUKKI shelf.'
    ),
  });

  // S17: ICE MISH 2026
  dataSlide({
    pageNum: 17,
    section: t('16 · ICE MISH 2026','16 · ICE MISH 2026','16 · ICE MISH 2026'),
    title:   t('ICE MISH 2026 YTD — лучший в холдинге: +29%','ICE MISH 2026 — מוביל הקבוצה: +29%','ICE MISH 2026 YTD — Group Leader: +29%'),
    imgTs: '005903', imgDate: '08',
    kpis: [
      { label: t('ICE MISH кошерный сегмент 2026','ICE MISH — כשר 2026','ICE MISH Kosher 2026'), value: '▲ +19%', sub: '₪ 189k (2026 YTD)', color: BLUE  },
      { label: t('ICE MISH общий рост 2026','ICE MISH — צמיחה 2026','ICE MISH Growth 2026'),    value: '▲ +29%', sub: 'лучший результат холдинга', color: GREEN },
    ],
    analysis: t(
      'ICE MISH — лучший результат 2026 YTD в холдинге. Без региональных провалов.\n\nКашрут +19% — продолжение тренда 2025 (+18%). Системная работа.\n\nRUD эффект: модель роста из 2025 продолжает работать? Нужно проверить.\n\n❓ Non-kosher сегмент: на фоне общего +29% — есть ли SKU с падением внутри? Рост не должен маскировать проблемные позиции.',
      'ICE MISH — המוביל בקבוצה ב-2026 YTD. ללא פרוסות אזוריות.\n\nכשר +19% — המשך מגמת 2025 (+18%). עבודה שיטתית.\n\nאפקט RUD: המודל מ-2025 ממשיך לעבוד? צריך לבדוק.\n\n❓ לא-כשר: על רקע +29% כולל — יש SKU עם ירידה פנימה?',
      'ICE MISH — group leader 2026 YTD. No regional collapses.\n\nKosher +19% — continuation of 2025 trend (+18%). Systematic work.\n\nRUD effect: does the 2025 growth model continue? Need to verify.\n\n❓ Non-kosher: within overall +29% — are there SKUs declining internally?'
    ),
    rec: t(
      'ICE MISH: задокументировать модель роста — что делает агент иначе. Эта модель применима к другим компаниям. Non-kosher: мониторинг SKU-уровня — рост +29% не должен маскировать проблемные позиции.',
      'ICE MISH: לתעד מודל הצמיחה — מה הנסיע עושה אחרת. המודל ישים לחברות אחרות. לא-כשר: ניטור ברמת SKU — +29% לא אמור להסתיר עמדות בעייתיות.',
      'ICE MISH: document the growth model — what does the agent do differently. This model applies to other companies. Non-kosher: monitor SKU level — +29% should not mask declining positions.'
    ),
  });

  // S18: INTER 2026
  dataSlide({
    pageNum: 18,
    section: t('17 · INTER 2026','17 · אינטר 2026','17 · INTER 2026'),
    title:   t('INTER 2026 YTD — кашрут-recovery: +19%','INTER 2026 — שחזור כשרות: +19%','INTER 2026 YTD — Kashrut Recovery: +19%'),
    imgTs: '005926', imgDate: '08',
    kpis: [
      { label: t('Кошерный INTER 2026 (восстановление)','INTER — כשר 2026 (שחזור)','INTER Kosher 2026 (recovery)'), value: '▲ +41%', sub: '₪ 217k (2026 YTD)',                color: GREEN },
      { label: t('Некошерный INTER 2026','INTER — לא כשר 2026','INTER Non-Kosher 2026'),                           value: '▲ +1%',  sub: '₪ 188k (2026 YTD, почти стоит)', color: FLAT  },
    ],
    analysis: t(
      'INTER ускорился с +5% (2025) до +19% (2026 YTD) — кашрут-recovery работает.\n\nКашрут +41%: листинг в сетях восстанавливается. Гипотеза подтверждена: кашрут закрыли → двери открылись → сети вернули ассортимент.\n\nNon-kosher +1% — стагнация. ROSHEN без промо-активации так и стоит.\n\nSankey: сегмент "אסף דתם" +29% (₪1.83M→2.35M). "מיכאל מגן" -73% (₪119k→32k) — требует диагностики.',
      'INTER האיץ מ-+5% (2025) ל-+19% (2026 YTD) — שחזור הכשרות עובד.\n\nכשר +41%: החזרת ליסטינג ברשתות. ההיפותזה מאושרת: כשרות נסגרה → דלתות נפתחו → הרשתות החזירו מגוון.\n\nלא-כשר +1% — קיפאון. ROSHEN ללא פרומו עומד במקום.\n\nSankey: "אסף דתם" +29% (₪1.83M→2.35M). "מיכאל מגן" -73% — לאבחן.',
      'INTER accelerated from +5% (2025) to +19% (2026 YTD) — kashrut recovery working.\n\nKosher +41%: chain listing restoration is working. Hypothesis confirmed: kashrut resolved → doors opened → chains restored assortment.\n\nNon-kosher +1% — stagnation. ROSHEN without promo activation stays flat.\n\nSankey: "אסף דתם" +29% (₪1.83M→2.35M). "מיכאל מגן" -73% — diagnose immediately.'
    ),
    rec: t(
      'Кашрут-путь доказан: продолжать восстановление листинга в каждой сети. ROSHEN: промо-аудит в топ-10. Диагностировать "מיכאל מגן" -73% — клиент ушёл или сменил формат? Следующий шаг: агент INTER + ICE MISH = антисезонный портфель без мёртвых точек.',
      'נתיב הכשרות הוכיח את עצמו: להמשיך שחזור ליסטינג בכל רשת. ROSHEN: אודיט פרומו ב-10 גדולים. לאבחן "מיכאל מגן" -73%. הצעד הבא: נסיע INTER+ICE MISH = תיק אנטי-עונתי.',
      'Kashrut path proven: continue listing restoration in every chain. ROSHEN: promo audit in top 10. Diagnose "מיכאל מגן" -73% — client left or changed format? Next step: INTER+ICE MISH agent = anti-seasonal portfolio with zero dead periods.'
    ),
  });
}

// ─── S19: Conclusions ─────────────────────────────────────────────────────────
function s19_conclusions() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, t('18 · ВЫВОДЫ','18 · סיכום','18 · CONCLUSIONS'), t('Выводы и следующие шаги','סיכום והמלצות לפעולה','Conclusions & Next Steps'), 'MMD Distribution');

  s.addShape(pptx.ShapeType.rect, { x: 0.15, y: 0.85, w: 6.25, h: 6.28, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addShape(pptx.ShapeType.rect, { x: 0.15, y: 0.85, w: 6.25, h: 0.38, fill: { color: NAVY } });
  s.addText(t('Ключевые выводы 2025','תובנות מפתח 2025','Key Findings 2025'), { x: 0.3, y: 0.9, w: 5.9, h: 0.28, fontSize: 11, bold: true, color: WHITE, align: 'left' });

  const findings = [
    { n:'01', text: t('MMD вырос на +8% → ₪5,531,234. Рынок живёт, несмотря на войну.','MMD גדל +8% → ₪5,531,234 למרות המלחמה.','MMD grew +8% → ₪5,531,234 despite war.'), color: GREEN },
    { n:'02', text: t('ICE bdd — двигатель роста (+24%). Остальные растут ниже рынка.','ICE bdd — מנוע הצמיחה (+24%). שאר — מתחת לשוק.','ICE bdd growth engine (+24%). Others below market rate.'), color: GREEN },
    { n:'03', text: t('FORMULA стагнирует (0%). Кошерный портфель в минусе (-9%).','FORMULA בקיפאון (0%). כשר ב-(-9%).','FORMULA stagnant (0%). Kosher portfolio -9%.'), color: AMBER },
    { n:'04', text: t('Эйлат +19% = аномалия (эвакуированные + блокада Хусити → порт -80%). Не планировать как тренд.','אילת +19% = אנומליה (מפונים + חות׳ים → נמל -80%). לא לתכנן כמגמה.','Eilat +19% = anomaly (evacuees + Houthi → port -80%). Do not plan as trend.'), color: AMBER },
    { n:'05', text: t('Non-kosher растёт в 8× быстрее kosher (+16% vs +2%).','לא-כשר גדל פי 8 מהכשר (+16% מול +2%).','Non-kosher grows 8× faster than kosher.'), color: BLUE },
    { n:'06', text: t('2026 YTD +20% — впервые все 4 компании одновременно в плюсе. INTER +19% = кашрут-recovery.','2026 YTD +20% — לראשונה כל 4 החברות בפלוס. INTER +19% = שחזור כשרות.','2026 YTD +20% — first time all 4 companies positive. INTER +19% = kashrut recovery.'), color: GREEN },
  ];
  findings.forEach((f, i) => {
    const y = 1.32 + i * 0.86;
    s.addShape(pptx.ShapeType.ellipse, { x: 0.26, y: y+0.04, w: 0.36, h: 0.36, fill: { color: f.color } });
    s.addText(f.n, { x: 0.26, y: y+0.04, w: 0.36, h: 0.36, fontSize: 8, bold: true, color: WHITE, align: 'center', valign: 'middle' });
    s.addText(f.text, { x: 0.7, y: y+0.04, w: 5.55, h: 0.32, fontSize: 9.5, color: TEXT, align: 'left', valign: 'middle', wrap: true });
  });

  s.addShape(pptx.ShapeType.rect, { x: 6.58, y: 0.85, w: 6.57, h: 6.28, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addShape(pptx.ShapeType.rect, { x: 6.58, y: 0.85, w: 6.57, h: 0.38, fill: { color: BLUE } });
  s.addText(t('Следующие шаги','צעדים הבאים','Next Steps'), { x: 6.73, y: 0.9, w: 6.27, h: 0.28, fontSize: 11, bold: true, color: WHITE, align: 'left' });

  const actions = [
    { company: 'FORMULA', action: t('PRESIDENT (май 2026) — кошерная линейка, короткие сроки → требуется высокая частота визитов и усилия по продвижению в точках. Аудит кошерного SKU. Масштабировать שופרסל דיל. Non-kosher +42% — документировать драйвер.','PRESIDENT (מאי 2026) — קו כשר, תפוגה קצרה → תדירות ביקורים גבוהה. בדיקת SKU כשר. הרחבת שופרסל דיל.','PRESIDENT (May 2026) — kosher line, short shelf life → high visit frequency. Kosher SKU audit. Scale Shufersal Deal.'), color: MUTED },
    { company: 'ICE bdd',  action: t('Защитить полку YUKKI. Разобраться с SVALYA -32%. Сети →0%: аудит топ-5 точек. Цель: сети +10% к Q4.','להגן על מדף YUKKI. לאבחן SVALYA -32%. רשתות →0%: אודיט 5 הגדולים. יעד: רשתות +10% בQ4.','Protect YUKKI shelf. Diagnose SVALYA -32%. Chains →0%: audit top 5 outlets. Target: chains +10% by Q4.'), color: GREEN },
    { company: 'ICE MISH', action: t('Документировать модель роста +29% — передать как стандарт. RUD: разобрать драйвер. NICEE -38%: диагностика.','לתעד מודל צמיחה +29% — להעביר כסטנדרט. RUD: לנתח דרייבר. NICEE -38%: אבחון.','Document +29% growth model — transfer as standard. RUD: analyse driver. NICEE -38%: diagnose.'), color: GREEN },
    { company: 'INTER',    action: t('Кашрут-recovery +41% кошер — продолжать. ROSHEN: промо-аудит топ-10. Диагностировать "מיכאל מגן" -73%. Следующий шаг: выделенный агент INTER+ICE MISH.','שחזור כשרות +41% — להמשיך. ROSHEN: אודיט פרומו. לאבחן "מיכאל מגן" -73%. נסיע ייעודי INTER+ICE MISH.','Kashrut recovery +41% kosher — continue. ROSHEN: promo audit top 10. Diagnose "מיכאל מגן" -73%. Dedicated agent INTER+ICE MISH.'), color: BLUE },
    { company: '★ OneSale: следующий шаг', action: t('ICE bdd доказал: свой агент = +24%. INTER — следующий. INTER+ICE MISH = антисезонный портфель (шоколад↓ летом, мороженое↑). Ноль амплитуды у агента. FORMULA — отдельно.','ICE bdd הוכיח: נסיע ייעודי = +24%. INTER הבא. INTER+ICE MISH = תיק אנטי-עונתי. FORMULA — נפרד.','ICE bdd proved: dedicated agent = +24%. INTER is next. INTER+ICE MISH = anti-seasonal portfolio. FORMULA separate.'), color: AMBER },
  ];
  actions.forEach((a, i) => {
    const y = 1.32 + i * 1.0;
    s.addShape(pptx.ShapeType.rect, { x: 6.66, y, w: 6.41, h: 0.88, fill: { color: BG }, line: { color: a.color, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x: 6.66, y, w: 0.08, h: 0.88, fill: { color: a.color } });
    s.addText(a.company, { x: 6.82, y: y+0.05, w: 6.1, h: 0.22, fontSize: 9.5, bold: true, color: a.color, align: 'left' });
    s.addText(a.action,  { x: 6.82, y: y+0.30, w: 6.1, h: 0.50, fontSize: 8.5, color: TEXT, align: 'left', wrap: true });
  });

  insightBox(s, 0.15, 6.88, 12.9, 0.25, null,
    t('Стратегически: война искажает региональные данные. Арава — режим снят → действовать немедленно. Эйлат — понять структуру роста до планирования H2.',
      'אסטרטגית: המלחמה מעוותת נתוני אזורים. ערבה — המצב הוסר → לפעול מיד. אילת — להבין מבנה הצמיחה לפני תכנון H2.',
      'Strategically: war distorts regional data. Arava — restrictions lifted → act immediately. Eilat — understand growth structure before H2 planning.'),
    LIGHT, NAVY
  );
  footerLine(s, 19);
}

// ─── Build ─────────────────────────────────────────────────────────────────────
s1_cover();
s2_exec();
buildSlides();   // S3–S18
s19_conclusions(); // S19

const outPath = 'C:/Users/d.sverdlik/Desktop/MMD REPORT/MMD-Annual-Report-v4.pptx';
pptx.writeFile({ fileName: outPath })
  .then(() => console.log(`✅ PPTX saved: ${outPath}`))
  .catch(e => console.error('❌ Error:', e));
