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
const IMG = (ts) => `${IMGDIR}Screenshot 2026-06-07 ${ts}.jpg`;

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
const TOTAL_SLIDES = 13;

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
  s.addText('MMD Distribution · Годовой отчёт 2025', { x: 0.3, y: 7.3, w: 8.0, h: 0.18, fontSize: 7, color: MUTED, align: 'left' });
  s.addText(`${pageNum} / ${TOTAL_SLIDES}`, { x: 10.5, y: 7.3, w: 2.5, h: 0.18, fontSize: 7, color: MUTED, align: 'right' });
  langBadge(s);
}

// ─── Data slide: screenshot left + right panel KPIs + bottom rec ─────────────
function dataSlide({ pageNum, section, title, imgTs, kpis, analysis, rec }) {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, section, title, 'MMD Distribution');

  // Screenshot
  s.addShape(pptx.ShapeType.rect, { x: 0.13, y: 0.80, w: 8.39, h: 4.93, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addImage({ path: IMG(imgTs), x: 0.15, y: 0.82, w: 8.35, h: 4.89 });

  // Right panel bg
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

  insightBox(s, 0.15, 5.92, 12.9, 1.18, t('Рекомендация:', 'המלצה:', 'Recommendation:'), rec, 'E8F9F0', GREEN);
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

  const toc = [
    { n:'01', ru:'Итоги 2025 — Executive Summary',         he:'סיכום מנהלים 2025'             },
    { n:'02', ru:'Кашрут: кошерный vs некошерный',         he:'כשרות — כשר / לא כשר'          },
    { n:'03', ru:'Каналы: сети vs частный рынок',           he:'ערוצי הפצה'                    },
    { n:'04', ru:'Регионы: Эйлат vs Арава',                he:'אזורים — אילת / ערבה'           },
    { n:'05', ru:'Бренды — генераторы роста',               he:'מנועי צמיחה — מותגים'          },
    { n:'06', ru:'FORMULA — анализ 2025',                   he:'פורמולה — ניתוח 2025'           },
    { n:'07', ru:'ICE bdd — звезда года (+24%)',            he:'ICE bdd — כוכב השנה (+24%)'    },
    { n:'08', ru:'ICE MISH — анализ 2025',                  he:'ICE MISH — ניתוח 2025'         },
    { n:'09', ru:'INTER — анализ 2025',                     he:'אינטר — ניתוח 2025'            },
    { n:'10', ru:'2026 YTD — по компаниям',                 he:'2026 ינו–מאי — לפי חברה'       },
    { n:'11', ru:'2026 YTD — регионы',                      he:'2026 ינו–מאי — אזורים'         },
    { n:'12', ru:'Выводы и следующие шаги',                  he:'סיכום והמלצות לפעולה'          },
  ];

  s.addText(t('Содержание', 'תוכן עניינים', 'Contents'), {
    x: 4.0, y: 4.45, w: 8.9, h: 0.28, fontSize: 9, bold: true, color: ICE, align: 'left', charSpacing: 3
  });
  s.addShape(pptx.ShapeType.rect, { x: 4.0, y: 4.76, w: 8.9, h: 0.02, fill: { color: NAVY } });

  toc.forEach((t_, i) => {
    const col = i < 6 ? 0 : 1;
    const row = i < 6 ? i : i - 6;
    const x = 4.0 + col * 4.55;
    const y = 4.82 + row * 0.38;
    s.addText(t_.n, { x, y: y+0.03, w: 0.46, h: 0.3, fontSize: 12, bold: true, color: GOLD, align: 'center' });
    s.addShape(pptx.ShapeType.rect, { x: x+0.5, y: y+0.04, w: 0.03, h: 0.28, fill: { color: ICE } });
    s.addText(LANG === 'HE' ? t_.he : t_.ru, { x: x+0.6, y: y+0.07, w: 3.78, h: 0.24, fontSize: 8.5, color: WHITE, align: 'left' });
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
    const barW = maxPct > 0 ? ((c.pct || 0) / maxPct) * 3.4 : 0;
    const bc = pctColor(c.pct);
    s.addText(c.name, { x: 8.4, y: y+0.06, w: 1.6, h: 0.28, fontSize: 9, bold: true, color: TEXT, align: 'left' });
    s.addShape(pptx.ShapeType.rect, { x: 10.1, y: y+0.06, w: Math.max(barW, 0.02), h: 0.28, fill: { color: bc } });
    s.addText(arrow(c.pct), { x: 10.1 + Math.max(barW, 0.05) + 0.1, y: y+0.06, w: 1.5, h: 0.28, fontSize: 9, bold: true, color: bc, align: 'left' });
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

// ─── S3–S12 via dataSlide ─────────────────────────────────────────────────────
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
      'Некошерный рынок растёт в 8× быстрее кошерного. Системный тренд: секулярное население расширяется, покупательская способность non-kosher сегмента растёт.\n\nКошерный рынок удерживает объём (+2%), но теряет долю в общем росте. Non-kosher уже 43% всех продаж.',
      'שוק הלא-כשר גדל פי 8 מהכשר — מגמה מערכתית: אוכלוסייה חילונית גדלה. כשר שומר על נפח (+2%), אך מאבד נתח בצמיחה הכוללת.',
      'Non-kosher grows 8× faster than kosher. Systemic trend: secular population expanding. Kosher holds volume (+2%) but loses share of total growth.'
    ),
    rec: t(
      'Сфокусировать рост ICE MISH и ICE bdd на некошерном канале — там динамика. Для FORMULA кошерный портфель требует аудита SKU: сегмент почти не растёт.',
      'למקד צמיחת ICE MISH ו-ICE bdd בערוץ הלא-כשר. ב-FORMULA — לסקור תיק הכשר: הסגמנט כמעט לא צומח.',
      'Focus ICE MISH & ICE bdd growth on non-kosher. For FORMULA — kosher portfolio SKU audit needed: segment barely growing.'
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
      'Частный рынок (55% продаж) обгоняет сети вдвое (+10% vs +5%). Малый и средний ритейл — חנויות, מכולות — динамичнее крупных сетей.\n\nСети растут медленнее: жёсткие условия входа, давление на маржу, долгие переговоры по ассортименту.',
      'שוק פרטי (55% ממכירות) מוביל פי 2 על הרשתות (+10% מול +5%). חנויות ומכולות — דינמיות יותר. רשתות גדלות לאט יותר.',
      'Independent market (55% of sales) outpaces chains 2× (+10% vs +5%). Small/mid retail more dynamic than chains.'
    ),
    rec: t(
      'Наращивать покрытие в независимом ритейле — рост без сетевой наценки. Развивать клиентов типа חנויות и מכולות. В сетях — работать над расширением ассортимента, а не наращиванием точек.',
      'להרחיב כיסוי בקמעונאות עצמאית — צמיחה ללא עמלות רשת. לפתח חנויות ומכולות. ברשתות — לעבוד על הרחבת מגוון.',
      'Expand independent retail coverage — growth without chain fees. Develop חנויות & מכולות. In chains — focus on assortment expansion, not store count.'
    ),
  });

  // S5: Регионы
  dataSlide({
    pageNum: 5,
    section: t('04 · РЕГИОНЫ','04 · אזורים','04 · REGIONS'),
    title:   t('Регионы: Эйлат +19% и Арава -24% (2025)','אזורים: אילת +19% וערבה -24%','Regions: Eilat +19% and Arava -24%'),
    imgTs: '180835',
    kpis: [
      { label: t('Эйлат — ⚠️ аномалия войны','אילת — ⚠️ אנומליית מלחמה','Eilat — ⚠️ war anomaly'), value: '▲ +19%', sub: '₪ 3,724,977 → 4,449,672', color: AMBER   },
      { label: t('Арава — военная зона','ערבה — איזור מלחמה','Arava — war zone'),                  value: '▼ -24%', sub: '₪ 1,418,214 → 1,081,563', color: DECLINE },
    ],
    analysis: t(
      '⚠️ Рост Эйлата +19% НЕ органический!\n\nПричина: 60,000 эвакуированных с Севера удвоили население города. При этом туристов = 0 (порт обанкротился). Покупают эвакуированные, не туристы.\n\nАрава -24% = приграничные районы закрыты по соображениям безопасности.',
      '⚠️ +19% אילת — לא אורגני! 60,000 מפונים מהצפון הכפילו אוכלוסייה. תיירים = 0 (הנמל פשט רגל). ערבה -24% = אזורים גבוליים סגורים.',
      '⚠️ +19% Eilat is NOT organic! 60K evacuees from the North doubled population. Tourists = 0 (port bankrupt). Arava -24% = border areas closed.'
    ),
    rec: t(
      'НЕ планировать Эйлат +19% как устойчивый тренд. После окончания войны — ожидать нормализации до ~10-12%. Арава: не инвестировать в расширение до снятия военного режима.',
      'לא לתכנן +19% אילת כמגמה בת-קיימא. עם סיום המלחמה — לצפות לנורמליזציה ל-~10%. ערבה: לא להשקיע עד סיום המצב הביטחוני.',
      'DO NOT project Eilat +19% as sustainable. Post-war normalization expected ~10%. Arava: no investment until security situation resolves.'
    ),
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
      'TERRA FOOD +156% — взрыв с малой базы, нужно наблюдать.\nYUKKI +50% — крупный бренд, продолжает доминировать.\nSVALYA +14% — стабильный рост.\nROSHEN +1% — стагнация флагмана INTER.\nSANTA BREMOR -5% — давление санкций против Беларуси.',
      'TERRA FOOD +156% — פיצוץ מבסיס קטן.\nYUKKI +50% — מותג גדול ממשיך לדומינירה.\nSVALYA +14% — יציב.\nROSHEN +1% — קיפאון.\nSANTA BREMOR -5% — סנקציות בלארוס.',
      'TERRA FOOD +156% — explosive from small base.\nYUKKI +50% — major brand dominates.\nSVALYA +14% — stable.\nROSHEN +1% — stagnant.\nSANTA BREMOR -5% — Belarus sanctions.'
    ),
    rec: t(
      'Инвестировать в YUKKI и TERRA FOOD — они несут портфель. Начать готовить замену SANTA BREMOR (санкционный риск долгосрочный). Разобраться с причиной стагнации ROSHEN — ценовая конкуренция или потеря полки.',
      'להשקיע ב-YUKKI ו-TERRA FOOD. להתחיל להכין תחליף ל-SANTA BREMOR (סיכון סנקציות). לאבחן קיפאון ROSHEN.',
      'Invest in YUKKI & TERRA FOOD. Start SANTA BREMOR replacement (long-term sanctions risk). Diagnose ROSHEN stagnation.'
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
      'FORMULA в целом +0% — стагнация. Внутри — разрыв:\n• Кошер -9%: теряет клиентов\n• Non-kosher +14%: компенсирует\n\nПо регионам:\n• Эйлат +33% (эффект войны)\n• Арава -50% (закрытые районы)\n\nПо каналам:\nשופרסל דיל +370% — новый крупный контракт.',
      'FORMULA +0% בסך הכל — קיפאון. פנימית:\n• כשר -9%\n• לא-כשר +14%\n\nאזורים:\n• אילת +33% (מלחמה)\n• ערבה -50%\n\nשופרסל דיל +370% — חוזה חדש.',
      'FORMULA flat +0%. Internally split:\n• Kosher -9%\n• Non-kosher +14%\n\nRegions: Eilat +33% (war), Arava -50%.\nShufersal Deal +370% — new major contract.'
    ),
    rec: t(
      'Переориентировать FORMULA на рост некошерного направления (+14%). Кошерный портфель: аудит SKU, убрать неходовые позиции. Закрепить успех со שופרסל דיל — расширить ассортимент в этой сети.',
      'לאוורינט FORMULA לצמיחה לא-כשר (+14%). תיק כשר: בדיקת SKU, להסיר מוצרים איטיים. לחזק שופרסל דיל.',
      'Reorient FORMULA to non-kosher (+14%). Kosher SKU audit — remove slow movers. Consolidate Shufersal Deal success.'
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
      'ICE bdd — единственный быстрорастущий игрок холдинга. Рост равномерный:\n• Кошер +32%, некошер +15%\n• Эйлат +23%, Арава +26%\n\nОба региона и оба сегмента в плюсе — редкость.\n\nYUKKI лидирует по объёму.\nSVALYA -32% — серьёзное падение.',
      'ICE bdd — שחקן צמיחה מהיר יחיד. כשר +32%, לא-כשר +15%. אילת +23%, ערבה +26%. שני אזורים ושני סגמנטים בפלוס. YUKKI מוביל. SVALYA -32% — נפילה חמורה.',
      'ICE bdd sole fast-grower. Kosher +32%, non-kosher +15%. Eilat +23%, Arava +26%. Both regions & segments positive. YUKKI leads. SVALYA -32% — serious drop.'
    ),
    rec: t(
      'Масштабировать модель ICE bdd на другие компании холдинга. Разобраться с падением SVALYA -32% — ценовая конкуренция, поставки или потеря полки? YUKKI — защитить полочное пространство от конкурентов.',
      'להרחיב מודל ICE bdd לחברות אחרות. לברר סיבת SVALYA -32%. YUKKI — להגן על שטח מדף.',
      'Scale ICE bdd model to other companies. Diagnose SVALYA -32% — pricing, supply or shelf loss? YUKKI — protect shelf space.'
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
      'ICE MISH показывает ровный рост без резких колебаний:\n• Эйлат +18%, Арава +17% — оба региона в плюсе\n• MOTAGIM +5% — стабильно\n• RUD +103% — взрывной рост!\n• NICEE -38% — серьёзное падение\n\nКлиенты:\nשופרסל דיל +181%, לאלירון +92%.',
      'ICE MISH צמיחה אחידה:\n• אילת +18%, ערבה +17%\n• RUD +103% — פיצוצי\n• NICEE -38% — נפילה חמורה\nשופרסל דיל +181%, לאלירון +92%.',
      'ICE MISH steady growth:\n• Eilat +18%, Arava +17% — both positive\n• RUD +103% — explosive\n• NICEE -38% — serious drop\nShufersal Deal +181%, Lealirón +92%.'
    ),
    rec: t(
      'Разобраться с RUD +103% — новый клиент или ценовой эффект? Масштабировать эту модель. Диагностика NICEE -38%: ценовой конфликт или потеря полки. Развивать сеть לאלירון — показывает потенциал.',
      'לברר גורם RUD +103% — לקוח חדש? להרחיב מודל. לאבחן NICEE -38%. לפתח רשת לאלירון.',
      'Diagnose RUD +103% — new account or price effect? Scale the model. Diagnose NICEE -38%. Develop Lealirón network.'
    ),
  });

  // S10: INTER
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
      'INTER растёт умеренно (+5%). Концентрация на ROSHEN — риск:\n• ROSHEN = 88% выручки, рост 0%\n• UKR OLIYA +11% — позитив\n• YARYCH — новинка, растёт\n\nПо каналам: частный рынок +28%, сети -16% — выход из убыточных сетей.\nחנויות +28%, המכולת שלי +17%.',
      'INTER גדל במתינות (+5%). תלות ב-ROSHEN — סיכון:\n• ROSHEN = 88%, צמיחה 0%\n• UKR OLIYA +11%\n• חנויות +28%, המכולת שלי +17%\n• רשתות -16% — יציאה.',
      'INTER moderate growth (+5%). ROSHEN dependence = risk:\n• ROSHEN = 88%, growth 0%\n• UKR OLIYA +11%\n• Stores +28%, HaMakolet +17%\n• Chains -16% — exiting.'
    ),
    rec: t(
      'Диверсифицировать за пределы ROSHEN — развивать SAMBA, YARYCH, UKR OLIYA. Выходить из убыточных сетей (рашатот -16%) и концентрироваться на частном рынке. Искать новые украинские бренды.',
      'לגוון מ-ROSHEN — לפתח SAMBA, YARYCH, UKR OLIYA. לצאת מרשתות הפסדיות (-16%). לחפש מותגים אוקראינים חדשים.',
      'Diversify beyond ROSHEN — develop SAMBA, YARYCH, UKR OLIYA. Exit declining chains (-16%). Seek new Ukrainian brands.'
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
      'Обе тенденции 2025 года ускоряются:\n\nЭйлат +34% (было +19%) — эвакуированные всё ещё там. Когда туристы вернутся → нормализация к ~12-15%.\n\nАрава -31% (было -24%) — ситуация ухудшается. Военная зона. Потенциал восстановления огромный — когда откроется.',
      'שתי המגמות של 2025 מתחזקות:\nאילת +34% (היה +19%) — מפונים עדיין שם.\nערבה -31% (היה -24%) — מחמיר. פוטנציאל התאוששות ענק.',
      'Both 2025 trends accelerating:\nEilat +34% (was +19%) — evacuees still there.\nArava -31% (was -24%) — worsening. Huge recovery potential post-war.'
    ),
    rec: t(
      'Готовить ДВА бюджетных сценария на 2027: (1) Нормализация — Эйлат -15%, Арава +70% восстановление. (2) Продолжение — текущие темпы. НЕ сокращать ресурсы в Арава — это временная просадка с огромным отскоком.',
      'להכין שני תרחישי תקציב ל-2027:\n(1) נורמליזציה — אילת -15%, ערבה +70%.\n(2) המשך — קצבים נוכחיים.\nלא לצמצם ב-ערבה — ירידה זמנית עם פוטנציאל גדול.',
      'Prepare TWO 2027 budget scenarios:\n(1) Normalization — Eilat -15%, Arava +70% recovery.\n(2) Continuation — current pace.\nDO NOT cut Arava resources — temporary dip, huge rebound potential.'
    ),
  });
}

// ─── S13: Conclusions ─────────────────────────────────────────────────────────
function s13_conclusions() {
  const s = pptx.addSlide();
  s.background = { fill: BG };
  pageHeader(s, t('12 · ВЫВОДЫ','12 · סיכום','12 · CONCLUSIONS'), t('Выводы и следующие шаги','סיכום והמלצות לפעולה','Conclusions & Next Steps'), 'MMD Distribution');

  // Left: Key findings
  s.addShape(pptx.ShapeType.rect, { x: 0.15, y: 0.85, w: 6.25, h: 6.28, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addShape(pptx.ShapeType.rect, { x: 0.15, y: 0.85, w: 6.25, h: 0.38, fill: { color: NAVY } });
  s.addText(t('Ключевые выводы 2025','תובנות מפתח 2025','Key Findings 2025'), { x: 0.3, y: 0.9, w: 5.9, h: 0.28, fontSize: 11, bold: true, color: WHITE, align: 'left' });

  const findings = [
    { n:'01', text: t('MMD вырос на +8% → ₪5,531,234. Рынок живёт, несмотря на войну.','MMD גדל +8% → ₪5,531,234 למרות המלחמה.','MMD grew +8% → ₪5,531,234 despite war.'), color: GREEN },
    { n:'02', text: t('ICE bdd — двигатель роста (+24%). Остальные растут ниже рынка.','ICE bdd — מנוע הצמיחה (+24%). שאר — מתחת לשוק.','ICE bdd growth engine (+24%). Others below market rate.'), color: GREEN },
    { n:'03', text: t('FORMULA стагнирует (0%). Кошерный портфель в минусе (-9%).','FORMULA בקיפאון (0%). כשר ב-(-9%).','FORMULA stagnant (0%). Kosher portfolio -9%.'), color: AMBER },
    { n:'04', text: t('Эйлат +19% = военная аномалия. Не строить на этом планы!','אילת +19% = אנומליית מלחמה. לא לתכנן על זה!','Eilat +19% = war anomaly. Do not plan on this!'), color: AMBER },
    { n:'05', text: t('Non-kosher растёт в 8× быстрее kosher (+16% vs +2%).','לא-כשר גדל פי 8 מהכשר (+16% מול +2%).','Non-kosher grows 8× faster than kosher.'), color: BLUE },
    { n:'06', text: t('2026 YTD +20% — впервые все 4 компании одновременно в плюсе.','2026 YTD +20% — לראשונה כל 4 החברות בפלוס.','2026 YTD +20% — first time all 4 companies positive.'), color: GREEN },
  ];
  findings.forEach((f, i) => {
    const y = 1.32 + i * 0.86;
    s.addShape(pptx.ShapeType.ellipse, { x: 0.26, y: y+0.04, w: 0.36, h: 0.36, fill: { color: f.color } });
    s.addText(f.n, { x: 0.26, y: y+0.04, w: 0.36, h: 0.36, fontSize: 8, bold: true, color: WHITE, align: 'center', valign: 'middle' });
    s.addText(f.text, { x: 0.7, y: y+0.04, w: 5.55, h: 0.32, fontSize: 9.5, color: TEXT, align: 'left', valign: 'middle', wrap: true });
  });

  // Right: Actions
  s.addShape(pptx.ShapeType.rect, { x: 6.58, y: 0.85, w: 6.57, h: 6.28, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addShape(pptx.ShapeType.rect, { x: 6.58, y: 0.85, w: 6.57, h: 0.38, fill: { color: BLUE } });
  s.addText(t('Следующие шаги','צעדים הבאים','Next Steps'), { x: 6.73, y: 0.9, w: 6.27, h: 0.28, fontSize: 11, bold: true, color: WHITE, align: 'left' });

  const actions = [
    { company: 'FORMULA', action: t('Аудит кошерного SKU. Развивать non-kosher. Масштабировать שופרסל דיל.','בדיקת SKU כשר. פיתוח לא-כשר. הרחבת שופרסל דיל.','Kosher SKU audit. Non-kosher push. Scale Shufersal Deal.'), color: MUTED },
    { company: 'ICE bdd',  action: t('Защитить полку YUKKI. Разобраться с SVALYA -32%. Масштабировать модель.','להגן על מדף YUKKI. לאבחן SVALYA -32%. להרחיב מודל.','Protect YUKKI shelf. Diagnose SVALYA -32%. Scale model.'), color: GREEN },
    { company: 'ICE MISH', action: t('Изучить RUD +103%. Диагностировать NICEE -38%. Развивать לאלירון.','לחקור RUD +103%. לאבחן NICEE -38%. לפתח לאלירון.','Investigate RUD +103%. Diagnose NICEE -38%. Develop Lealirón.'), color: GREEN },
    { company: 'INTER',    action: t('Диверсифицировать за ROSHEN. Развивать SAMBA/YARYCH. Уйти из убыточных сетей.','לגוון מ-ROSHEN. לפתח SAMBA/YARYCH. לצאת מרשתות הפסדיות.','Diversify from ROSHEN. Develop SAMBA/YARYCH. Exit declining chains.'), color: BLUE },
  ];
  actions.forEach((a, i) => {
    const y = 1.32 + i * 1.2;
    s.addShape(pptx.ShapeType.rect, { x: 6.66, y, w: 6.41, h: 1.06, fill: { color: BG }, line: { color: a.color, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x: 6.66, y, w: 0.08, h: 1.06, fill: { color: a.color } });
    s.addText(a.company, { x: 6.82, y: y+0.07, w: 6.1, h: 0.26, fontSize: 10, bold: true, color: a.color, align: 'left' });
    s.addText(a.action,  { x: 6.82, y: y+0.37, w: 6.1, h: 0.58, fontSize: 9, color: TEXT, align: 'left', wrap: true });
  });

  insightBox(s, 0.15, 6.88, 12.9, 0.25, null,
    t('Стратегически: война искажает региональные данные. Планировать 2027 с двумя сценариями — с нормализацией и без.',
      'אסטרטגית: המלחמה מעוותת נתוני אזורים. לתכנן 2027 עם שני תרחישים.',
      'Strategically: war distorts regional data. Plan 2027 with two scenarios — normalized and war-continued.'),
    LIGHT, NAVY
  );
  footerLine(s, 13);
}

// ─── Build ─────────────────────────────────────────────────────────────────────
s1_cover();
s2_exec();
buildSlides();
s13_conclusions();

const outPath = 'C:/Users/d.sverdlik/Desktop/MMD REPORT/MMD-Annual-Report-v3.pptx';
pptx.writeFile({ fileName: outPath })
  .then(() => console.log(`✅ PPTX saved: ${outPath}`))
  .catch(e => console.error('❌ Error:', e));
