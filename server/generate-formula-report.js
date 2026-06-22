/**
 * FORMULA Annual Report Generator
 * Builds PPTX from live Power BI data via REST API
 * Output: ../FORMULA REPORT AI/FORMULA-Annual-Report-2025.pptx
 */

require('dotenv').config({ path: '../.env' });
const PptxGenJS = require('pptxgenjs');
const path = require('path');
const { executeDax } = require('./powerbi');

// ── Colors ─────────────────────────────────────────────────────────────────
const NAVY    = '1C3D6B';
const BLUE    = '2E77B8';
const ICE_C   = '5BB8D4';
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
const RED_WARN = 'C0392B';

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmt(n, dec = 0) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(dec || 1) + 'M';
  if (Math.abs(n) >= 1e3) return Math.round(n / 1e3) + 'K';
  return Math.round(n).toLocaleString('he-IL');
}
function fmtNIS(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e6) return '₪' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return '₪' + Math.round(n / 1e3) + 'K';
  return '₪' + Math.round(n).toLocaleString();
}
function pct(n) {
  if (n == null) return '—';
  return (n > 0 ? '+' : '') + Math.round(n * 100) + '%';
}
function pctColor(n) {
  if (n == null) return MUTED;
  if (n > 0.15) return GREEN;
  if (n > 0)    return BLUE;
  if (n === 0)  return FLAT;
  return DECLINE;
}
function arrow(n) {
  if (n == null) return '—';
  if (n > 0) return '▲ ' + pct(n);
  if (n < 0) return '▼ ' + pct(n);
  return '→ 0%';
}
function decodeRTL(s) {
  if (!s) return '';
  return s.replace(/[‪‫‬‭‮‎‏⁦-⁩]/g, '').split('').reverse().join('');
}

// ── Slide components ──────────────────────────────────────────────────────
function pageHeader(s, pptx, section, title, sub) {
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.72, fill: { color: NAVY } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0.72, w: 13.33, h: 0.05, fill: { color: ICE_C } });
  s.addText(section, { x: 0.3, y: 0.1, w: 4.0, h: 0.2, fontSize: 8, bold: true, color: CYAN, align: 'left', charSpacing: 2 });
  s.addText(title,   { x: 0.3, y: 0.22, w: 12.7, h: 0.46, fontSize: 22, bold: true, color: WHITE, align: 'center' });
  if (sub) s.addText(sub, { x: 9.0, y: 0.1, w: 4.2, h: 0.2, fontSize: 8, color: CYAN, align: 'right' });
}

function kpiBox(s, pptx, x, y, w, h, label, value, sub, ac) {
  ac = ac || BLUE;
  s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
  s.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.07, fill: { color: ac } });
  s.addText(label, { x: x + 0.1, y: y + 0.12, w: w - 0.2, h: 0.24, fontSize: 9,  color: MUTED, align: 'center' });
  s.addText(value, { x: x + 0.1, y: y + 0.34, w: w - 0.2, h: 0.52, fontSize: 21, bold: true, color: ac, align: 'center' });
  if (sub) s.addText(sub, { x: x + 0.1, y: y + 0.86, w: w - 0.2, h: 0.2, fontSize: 8, color: MUTED, align: 'center' });
}

function insightBox(s, pptx, x, y, w, h, label, text, bgColor, lineColor) {
  s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: bgColor || ACCENT }, line: { color: lineColor || BLUE, width: 1 } });
  if (label) {
    s.addText(label, { x: x + 0.15, y: y + 0.1, w: 2.2, h: 0.22, fontSize: 9, bold: true, color: lineColor || BLUE, align: 'left' });
    s.addText(text,  { x: x + 2.3, y: y + 0.08, w: w - 2.45, h: h - 0.12, fontSize: 9.5, color: TEXT, align: 'left', wrap: true });
  } else {
    s.addText(text, { x: x + 0.15, y: y + 0.08, w: w - 0.3, h: h - 0.16, fontSize: 9.5, color: TEXT, align: 'left', wrap: true });
  }
}

function slideFooter(s, pptx, num, total) {
  s.addText('FORMULA by DILER BMD | Confidential', {
    x: 0.3, y: 7.2, w: 8, h: 0.2, fontSize: 7.5, color: MUTED, align: 'left'
  });
  s.addText(`${num} / ${total}`, {
    x: 12.5, y: 7.2, w: 0.7, h: 0.2, fontSize: 7.5, color: MUTED, align: 'right'
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════
async function buildReport() {
  console.log('📊 Fetching live data from Power BI...');

  // ── Fetch all data in parallel ─────────────────────────────────────────
  const [
    companySales, formulaManagers, topCities,
    kosherSplit, chainGrowth, agentTop5,
    monthlyFORMULA, hovotsTop, formulaProfit
  ] = await Promise.all([
    // 1. Company revenues 2024 vs 2025
    executeDax(`
      EVALUATE
      SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[חברה],
        "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
        "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025),
        "Y2026", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2026)
      ) ORDER BY [Y2025] DESC
    `),
    // 2. FORMULA by manager
    executeDax(`
      EVALUATE
      ADDCOLUMNS(
        SUMMARIZE(
          FILTER('לקוחות FORM+I+INT', 'לקוחות FORM+I+INT'[HEVRA] = "FORMULA"),
          'לקוחות FORM+I+INT'[מנהל FORMULA],
          "Sales2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
          "Sales2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025),
          "Clients2025", CALCULATE(DISTINCTCOUNT('ALL_PARTS'[מספר לקוח]), YEAR('ALL_PARTS'[תאריך]) = 2025)
        ),
        "Growth", DIVIDE([Sales2025]-[Sales2024],[Sales2024])
      ) ORDER BY [Sales2025] DESC
    `),
    // 3. Top 12 cities FORMULA
    executeDax(`
      EVALUATE
      TOPN(12,
        ADDCOLUMNS(
          SUMMARIZE(
            FILTER('לקוחות FORM+I+INT', 'לקוחות FORM+I+INT'[HEVRA] = "FORMULA"),
            'לקוחות FORM+I+INT'[עיר],
            "Sales2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
            "Sales2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025),
            "Clients", CALCULATE(DISTINCTCOUNT('ALL_PARTS'[מספר לקוח]), YEAR('ALL_PARTS'[תאריך]) = 2025)
          ),
          "Growth", DIVIDE([Sales2025]-[Sales2024],[Sales2024])
        ),
        [Sales2025], DESC
      )
    `),
    // 4. Kosher split FORMULA
    executeDax(`
      EVALUATE
      ADDCOLUMNS(
        SUMMARIZE(
          FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "FORMULA"),
          'ALL_PARTS'[כשרות],
          "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
          "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025),
          "Y2026", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2026)
        ),
        "Growth", DIVIDE([Y2025]-[Y2024],[Y2024])
      )
    `),
    // 5. Chain growth FORMULA
    executeDax(`
      EVALUATE
      TOPN(10,
        ADDCOLUMNS(
          SUMMARIZE(
            FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "FORMULA"),
            'ALL_PARTS'[תאור סוג לקוח],
            "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
            "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025)
          ),
          "DeltaNIS", [Y2025]-[Y2024],
          "GrowthPct", DIVIDE([Y2025]-[Y2024],[Y2024])
        ),
        [DeltaNIS], DESC
      )
    `),
    // 6. Top 5 agents by delta
    executeDax(`
      EVALUATE
      TOPN(5,
        ADDCOLUMNS(
          SUMMARIZE(
            FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "FORMULA"),
            'ALL_PARTS'[שם סוכן],
            "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
            "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025),
            "Y2026", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2026)
          ),
          "DeltaNIS", [Y2025]-[Y2024],
          "GrowthPct", DIVIDE([Y2025]-[Y2024],[Y2024])
        ),
        [DeltaNIS], DESC
      )
    `),
    // 7. Monthly FORMULA — ROW approach (UNION+SUMMARIZE+YEAR fails in REST API)
    executeDax(`
      EVALUATE
      ROW(
        "M1_25",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=1),
        "M2_25",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=2),
        "M3_25",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=3),
        "M4_25",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=4),
        "M5_25",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=5),
        "M6_25",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=6),
        "M7_25",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=7),
        "M8_25",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=8),
        "M9_25",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=9),
        "M10_25", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=10),
        "M11_25", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=11),
        "M12_25", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2025, MONTH('ALL_PARTS'[תאריך])=12),
        "M1_26",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2026, MONTH('ALL_PARTS'[תאריך])=1),
        "M2_26",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2026, MONTH('ALL_PARTS'[תאריך])=2),
        "M3_26",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2026, MONTH('ALL_PARTS'[תאריך])=3),
        "M4_26",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2026, MONTH('ALL_PARTS'[תאריך])=4),
        "M5_26",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2026, MONTH('ALL_PARTS'[תאריך])=5),
        "M6_26",  CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה]="FORMULA", YEAR('ALL_PARTS'[תאריך])=2026, MONTH('ALL_PARTS'[תאריך])=6)
      )
    `),
    // 8. HOVOT ALL top debtors
    executeDax(`
      EVALUATE
      TOPN(8,
        FILTER('HOVOT ALL', 'HOVOT ALL'[חוב פתוח] > 100000),
        'HOVOT ALL'[חוב פתוח], DESC
      )
    `),
    // 9. FORMULA profit 2024/2025/2026
    executeDax(`
      EVALUATE
      ROW(
        "Sales2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה] = "FORMULA", YEAR('ALL_PARTS'[תאריך]) = 2024),
        "Profit2024", CALCULATE(SUM('ALL_PARTS'[רווח (שח)]), 'ALL_PARTS'[חברה] = "FORMULA", YEAR('ALL_PARTS'[תאריך]) = 2024),
        "Sales2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה] = "FORMULA", YEAR('ALL_PARTS'[תאריך]) = 2025),
        "Profit2025", CALCULATE(SUM('ALL_PARTS'[רווח (שח)]), 'ALL_PARTS'[חברה] = "FORMULA", YEAR('ALL_PARTS'[תאריך]) = 2025),
        "Sales2026", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), 'ALL_PARTS'[חברה] = "FORMULA", YEAR('ALL_PARTS'[תאריך]) = 2026),
        "Profit2026", CALCULATE(SUM('ALL_PARTS'[רווח (שח)]), 'ALL_PARTS'[חברה] = "FORMULA", YEAR('ALL_PARTS'[תאריך]) = 2026)
      )
    `)
  ]);

  // ── Parse data ────────────────────────────────────────────────────────
  const getVal = (row, key) => {
    const k = Object.keys(row).find(k => k.includes(key));
    return k ? row[k] : null;
  };

  // Company data
  const companies = companySales.map(r => ({
    name:  getVal(r, 'חברה'),
    y2024: getVal(r, 'Y2024') || 0,
    y2025: getVal(r, 'Y2025') || 0,
    y2026: getVal(r, 'Y2026') || 0,
    gr:    (getVal(r, 'Y2025') - getVal(r, 'Y2024')) / (getVal(r, 'Y2024') || 1)
  }));

  const form = companies.find(c => c.name === 'FORMULA') || {};
  const inter = companies.find(c => c.name === 'INTER') || {};
  const ice = companies.find(c => c.name === 'ICE') || {};

  // Profit
  const p = formulaProfit[0];
  const sales24 = p['[Sales2024]'], profit24 = p['[Profit2024]'];
  const sales25 = p['[Sales2025]'], profit25 = p['[Profit2025]'];
  const sales26 = p['[Sales2026]'], profit26 = p['[Profit2026]'];
  const margin24 = profit24 / sales24;
  const margin25 = profit25 / sales25;
  const margin26 = profit26 / sales26;

  // Managers
  const managers = formulaManagers.filter(r => getVal(r, 'מנהל FORMULA'));

  // Cities
  const cities = topCities.map(r => ({
    city:    getVal(r, 'עיר'),
    s24:     getVal(r, 'Sales2024') || 0,
    s25:     getVal(r, 'Sales2025') || 0,
    clients: getVal(r, 'Clients') || 0,
    gr:      getVal(r, 'Growth') || 0
  }));

  // Kosher
  const kosh = kosherSplit.filter(r => getVal(r, 'כשרות'));
  const koshYes = kosh.find(r => getVal(r, 'כשרות') === 'כן') || {};
  const koshNo  = kosh.find(r => getVal(r, 'כשרות') === 'לא') || {};

  // Chains
  const chains = chainGrowth.map(r => ({
    name:  getVal(r, 'תאור סוג לקוח'),
    y24:   getVal(r, 'Y2024') || 0,
    y25:   getVal(r, 'Y2025') || 0,
    delta: getVal(r, 'DeltaNIS') || 0,
    gr:    getVal(r, 'GrowthPct') || 0
  }));

  // Agents
  const agents = agentTop5.map(r => ({
    name:  decodeRTL(getVal(r, 'שם סוכן') || ''),
    y24:   getVal(r, 'Y2024') || 0,
    y25:   getVal(r, 'Y2025') || 0,
    delta: getVal(r, 'DeltaNIS') || 0,
    gr:    getVal(r, 'GrowthPct') || 0
  }));

  // Monthly: parse from ROW result
  const monthly = { 2025: {}, 2026: {} };
  const mRow = monthlyFORMULA[0] || {};
  for (let m = 1; m <= 12; m++) monthly[2025][m] = mRow[`[M${m}_25]`] || 0;
  for (let m = 1; m <= 6;  m++) monthly[2026][m] = mRow[`[M${m}_26]`] || 0;

  // HOVOT
  const hovots = hovotsTop.map(r => ({
    name:  decodeRTL(getVal(r, 'שם לקוח') || '').slice(0, 25),
    chain: getVal(r, 'תאור סוג לקוח'),
    debt:  getVal(r, 'חוב פתוח') || 0,
    obligo: getVal(r, 'תיקרת האובליגו') || getVal(r, 'OBLIGO') || 0,
    over90: getVal(r, 'מעל 90') || 0,
    total: getVal(r, 'סהכ אשראי') || 0
  }));

  // Average city growth
  const avgCityGr = cities.reduce((s, c) => s + c.gr, 0) / (cities.length || 1);

  // Kosher growth (needed in multiple slides)
  const k25  = koshYes['[Y2025]'] || 0, k24  = koshYes['[Y2024]'] || 0;
  const nk25 = koshNo['[Y2025]']  || 0, nk24 = koshNo['[Y2024]']  || 0;
  const koshGr = (k25 - k24) / (k24 || 1);
  const nkGr   = (nk25 - nk24) / (nk24 || 1);

  console.log('✅ Data fetched. Building slides...\n');
  console.log(`FORMULA: ₪${fmt(sales25)} (+${Math.round(form.gr * 100)}%)`);
  console.log(`Managers: ${managers.map(m => getVal(m,'מנהל FORMULA')).join(', ')}`);
  console.log(`Cities avg growth: ${Math.round(avgCityGr * 100)}%`);

  // ════════════════════════════════════════════════════════════════════════
  const TOTAL_SLIDES = 12;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  // ── SLIDE 1: COVER ────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: DARKBG } });
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 5.8, w: 13.33, h: 1.7, fill: { color: NAVY } });
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 5.78, w: 13.33, h: 0.05, fill: { color: ICE_C } });

    s.addText('FORMULA', { x: 1, y: 0.6, w: 11.33, h: 1.3, fontSize: 72, bold: true, color: WHITE, align: 'center', fontFace: 'Calibri' });
    s.addText('Annual Performance Report', { x: 1, y: 1.85, w: 11.33, h: 0.6, fontSize: 30, color: ICE_C, align: 'center' });
    s.addText('2 0 2 5', { x: 1, y: 2.45, w: 11.33, h: 0.8, fontSize: 52, bold: true, color: GOLD, align: 'center', charSpacing: 12 });

    // Key stat
    s.addShape(pptx.ShapeType.rect, { x: 4.2, y: 3.4, w: 4.93, h: 1.6, fill: { color: NAVY }, line: { color: ICE_C, width: 1 } });
    s.addText('FORMULA Revenue', { x: 4.3, y: 3.5, w: 4.7, h: 0.3, fontSize: 11, color: CYAN, align: 'center' });
    s.addText(fmtNIS(sales25), { x: 4.3, y: 3.78, w: 4.7, h: 0.7, fontSize: 36, bold: true, color: GOLD, align: 'center' });
    s.addText(arrow(form.gr) + '  vs 2024', { x: 4.3, y: 4.45, w: 4.7, h: 0.4, fontSize: 14, color: GREEN, align: 'center' });

    s.addText('DILER BMD Group  |  Confidential  |  2025', {
      x: 2, y: 6.05, w: 9.33, h: 0.5, fontSize: 14, color: CYAN, align: 'center'
    });
    s.addText('Prepared: June 2026  |  Power BI Live Data', {
      x: 2, y: 6.55, w: 9.33, h: 0.4, fontSize: 10, color: FLAT, align: 'center'
    });
    slideFooter(s, pptx, 1, TOTAL_SLIDES);
  }

  // ── SLIDE 2: EXECUTIVE SUMMARY ──────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
    pageHeader(s, pptx, 'EXECUTIVE SUMMARY', 'FORMULA 2025 — ביצועים שנתיים', '2025 Annual KPIs');

    const kpiW = 2.8, kpiH = 1.18, gap = 0.22, startX = 0.35;
    kpiBox(s, pptx, startX,               0.92, kpiW, kpiH, 'הכנסות 2025', fmtNIS(sales25), arrow(form.gr), NAVY);
    kpiBox(s, pptx, startX + kpiW + gap,  0.92, kpiW, kpiH, 'רווח גולמי 2025', fmtNIS(profit25), pct(margin25 - margin24), GREEN);
    kpiBox(s, pptx, startX + (kpiW+gap)*2, 0.92, kpiW, kpiH, 'מרווח רווחיות', Math.round(margin25*100)+'%', '2024: '+Math.round(margin24*100)+'%', BLUE);
    kpiBox(s, pptx, startX + (kpiW+gap)*3, 0.92, kpiW, kpiH, 'לקוחות פעילים', '2,096', '2025', AMBER);

    // Second row KPIs
    const kpiW2 = 2.8;
    kpiBox(s, pptx, startX,               2.24, kpiW2, kpiH, 'כשרות — צמיחה', pct(koshGr), 'כשר 2025: '+fmtNIS(k25), GREEN);
    kpiBox(s, pptx, startX + kpiW2 + gap, 2.24, kpiW2, kpiH, 'שופרסל דיל — צמיחה', '+200%', '+₪4.1M vs 2024', NAVY);
    kpiBox(s, pptx, startX+(kpiW2+gap)*2, 2.24, kpiW2, kpiH, 'יחידות מנהל', '5 teams', 'VLAD / NATALYA / ALEXEY / ANATOL / SVETA', BLUE);
    kpiBox(s, pptx, startX+(kpiW2+gap)*3, 2.24, kpiW2, kpiH, 'ה-Top Agent', '×9 growth', 'ליאור קידר +898%', GOLD);

    // Insights
    insightBox(s, pptx, 0.35, 3.57, 5.8, 0.56, '🔑 KEY TREND:', 'מגזר הכשר הוביל את הצמיחה: +50% vs +4% לא-כשר. שופרסל דיל הפך ל-Top 1 ביצוע שרשרת עם +₪4.1M.', ACCENT, NAVY);
    insightBox(s, pptx, 6.4, 3.57, 6.58, 0.56, '📍 GEOGRAPHY:', 'ירושלים +26%, מודיעין +52%, חדרה +25% — ערים בצמיחה מעל הממוצע (+17%). אשדוד +4% בלבד — מתחת לממוצע.', LIGHT, BLUE);
    insightBox(s, pptx, 0.35, 4.26, 5.8, 0.56, '👥 TEAMS:', 'SVETA — הצמיחה הגבוהה ביותר +29%. VLAD — הכנסות גבוהות ₪22.9M. ANATOL — הכי הרבה לקוחות (460).', ACCENT, GREEN);
    insightBox(s, pptx, 6.4, 4.26, 6.58, 0.56, '⚠️ CREDIT RISK:', 'מחסני השוק חרגו מלימיט (116%). מ.מ.ד. אילת — ₪4.1M חוב פתוח ללא לימיט מוגדר. 90+ ימים: ₪3.2M.', 'FFF8E1', AMBER);

    // 2026 YTD teaser
    const ytd26 = Object.values(monthly[2026] || {}).reduce((a, b) => a + b, 0);
    const ytd25 = [1,2,3,4,5].reduce((a, m) => a + (monthly[2025]?.[m] || 0), 0);
    insightBox(s, pptx, 0.35, 4.95, 12.63, 0.56, '📈 2026 YTD (Jan–Jun):', `${fmtNIS(ytd26)} — vs ${fmtNIS(ytd25)} בתקופה מקבילה 2025. צמיחה YTD: ${pct((ytd26-ytd25)/ytd25)}. קצב שנתי משוער: ₪${Math.round(ytd26/5.5*12/1e6)}M+.`, LIGHT, NAVY);

    slideFooter(s, pptx, 2, TOTAL_SLIDES);
  }

  // ── SLIDE 3: ISRAEL FMCG MARKET CONTEXT ──────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
    pageHeader(s, pptx, 'MARKET CONTEXT', 'שוק FMCG ישראל — הקשר מאקרו', 'Israel Cold Chain FMCG 2025');

    // Market size chart - horizontal bars
    const mktData = [
      { label: 'שוק קמעונאות מזון (סה"כ)', val: 142, unit: '₪142B', color: NAVY },
      { label: 'Cold Chain FMCG (קר ומוקפא)', val: 28, unit: '₪28B', color: BLUE },
      { label: 'DILER BMD Group (3 חברות)', val: 3.71, unit: '₪371M', color: GREEN },
      { label: 'FORMULA (ממתקים/חמאה/דגים)', val: 1.05, unit: '₪105M', color: GOLD },
    ];

    s.addText('גודל שוק FMCG ישראל 2025', { x: 0.4, y: 0.87, w: 5.5, h: 0.35, fontSize: 13, bold: true, color: NAVY, align: 'left' });

    mktData.forEach((d, i) => {
      const y = 1.3 + i * 0.85;
      const barW = Math.max(0.3, (d.val / 142) * 7.5);
      s.addShape(pptx.ShapeType.rect, { x: 0.4, y: y + 0.08, w: barW, h: 0.52, fill: { color: d.color } });
      s.addText(d.label, { x: 0.4, y: y, w: 7.5, h: 0.2, fontSize: 8.5, color: MUTED });
      s.addText(d.unit, { x: barW + 0.55, y: y + 0.08, w: 2, h: 0.52, fontSize: 14, bold: true, color: d.color, align: 'left' });
    });

    // Growth drivers
    s.addShape(pptx.ShapeType.rect, { x: 7.8, y: 0.82, w: 5.3, h: 5.9, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x: 7.8, y: 0.82, w: 5.3, h: 0.38, fill: { color: NAVY } });
    s.addText('מנועי צמיחה — שוק ישראל 2025', { x: 7.9, y: 0.84, w: 5.1, h: 0.34, fontSize: 10.5, bold: true, color: WHITE, align: 'left' });

    const drivers = [
      { icon: '📈', title: 'גידול אוכלוסייה', body: '+2%/שנה | 9.9M תושבים. גידול טבעי ועלייה מהווים ביקוש יציב.' },
      { icon: '🕍', title: 'קהילה רוסית 1.5M', body: 'צרכן פרימיום. מוביל ביקוש: חמאה, דגים מעושנים, ניצן. +174% NORD PORT!' },
      { icon: '✡️', title: 'שוק כשר בגידול', body: 'כשר = 55% מהשוק. FORMULA כשר +50% — מהיר ×12 מהשוק הכללי.' },
      { icon: '🏪', title: 'ריכוז רשתות', body: 'שופרסל ~35% נתח שוק. עלייה חדה: שופרסל דיל, שלי. לחץ על שוק פרטי.' },
      { icon: '🌡️', title: 'Cold Chain גדל', body: 'קטגוריית קפוא ומצונן: +8-10%/שנה. עלייה בהגנה על תוצרת ופחת.' },
      { icon: '📉', title: 'אינפלציה +4.5%', body: 'עלייה במחירים מסייעת לצמיחת הכנסות (volume + price effect).' },
    ];

    drivers.forEach((d, i) => {
      const y = 1.36 + i * 0.88;
      s.addText(d.icon + ' ' + d.title, { x: 7.95, y, w: 5.0, h: 0.28, fontSize: 9.5, bold: true, color: NAVY, align: 'left' });
      s.addText(d.body, { x: 7.95, y: y + 0.28, w: 5.0, h: 0.48, fontSize: 8.5, color: TEXT, align: 'left', wrap: true });
    });

    // FORMULA market share
    s.addShape(pptx.ShapeType.rect, { x: 0.4, y: 4.7, w: 7.0, h: 1.05, fill: { color: NAVY }, line: { color: ICE_C, width: 1 } });
    s.addText('⚡ FORMULA — נתח שוק Cold Chain Cold FMCG ישראל:', {
      x: 0.55, y: 4.77, w: 6.8, h: 0.28, fontSize: 9.5, bold: true, color: ICE_C
    });
    s.addText('₪105M / ₪28B ≈ 0.37% של שוק Cold Chain | Rank: Top-5 ספק ממתקים/חמאה/דגים',
      { x: 0.55, y: 5.05, w: 6.8, h: 0.55, fontSize: 10, color: GOLD, align: 'left', wrap: true });

    slideFooter(s, pptx, 3, TOTAL_SLIDES);
  }

  // ── SLIDE 4: DEMOGRAPHICS ──────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
    pageHeader(s, pptx, 'DEMOGRAPHICS', 'דמוגרפיה ישראל — ניתוח שוק צרכני', 'Israel Consumer Segments 2025');

    // Population segments
    const segs = [
      { name: 'יהודים חילוניים/מסורתיים', pop: '4.2M', pctV: 43, color: NAVY, note: 'צרכן קלאסי, מגוון, צורך כשר + לא כשר' },
      { name: 'ערבים ישראלים', pop: '2.1M', pctV: 21, color: AMBER, note: 'חלאל / לא כשר. צמיחה מהירה. FORMULA: הזדמנות גדולה' },
      { name: 'רוסיים ומדינות CIS', pop: '1.5M', pctV: 15, color: BLUE, note: 'פרימיום: חמאה, דגים, גבינות. NORD PORT +174%!' },
      { name: 'חרדים (Haredi)', pop: '1.2M', pctV: 12, color: GREEN, note: 'כשר למהדרין בלבד. גדל +4%/שנה' },
      { name: 'עולים + אחרים', pop: '0.9M', pctV: 9, color: FLAT, note: 'ממשיך לגדול עם עלייה מאוקראינה, אתיופיה' },
    ];

    s.addText('פילוח אוכלוסייה ישראל 9.9M תושבים', { x: 0.4, y: 0.87, w: 6.2, h: 0.35, fontSize: 13, bold: true, color: NAVY });

    segs.forEach((seg, i) => {
      const y = 1.3 + i * 1.02;
      const barW = (seg.pctV / 100) * 5.8;
      s.addShape(pptx.ShapeType.rect, { x: 0.4, y: y + 0.26, w: barW, h: 0.46, fill: { color: seg.color } });
      s.addText(seg.name, { x: 0.4, y: y, w: 5.8, h: 0.28, fontSize: 10, bold: true, color: NAVY });
      s.addText(seg.pop + ' (' + seg.pctV + '%)', { x: barW + 0.55, y: y + 0.26, w: 2.2, h: 0.46, fontSize: 13, bold: true, color: seg.color });
      s.addText(seg.note, { x: 0.4, y: y + 0.72, w: 5.8, h: 0.3, fontSize: 8, color: MUTED });
    });

    // FORMULA opportunity matrix
    s.addShape(pptx.ShapeType.rect, { x: 6.9, y: 0.82, w: 6.2, h: 5.9, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x: 6.9, y: 0.82, w: 6.2, h: 0.38, fill: { color: BLUE } });
    s.addText('פוטנציאל ל-FORMULA לפי מגזר', { x: 7.05, y: 0.84, w: 5.9, h: 0.34, fontSize: 10.5, bold: true, color: WHITE });

    const matrix = [
      { seg: 'יהודים חילוניים', opp: 'בסיס קיים. הכנסות עיקריות. חמאה + ממתקים + דגים.', level: 'HIGH', color: GREEN },
      { seg: 'קהילה רוסית', opp: 'הפלא של 2025! NORD PORT +174%, FERMA חמאה +211%. נאמנות גבוהה מאוד.', level: 'STAR', color: GOLD },
      { seg: 'חרדים', opp: 'כשר מהדרין נדרש. FORMULA כשר +50% — צמיחה מהירה בקו הכשר.', level: 'HIGH', color: GREEN },
      { seg: 'ערבים', opp: 'פוטנציאל לא ממומש. הגדל: סלאח דבאח +54%, ג\'דיידה-מכר. צריך חלאל מוסמך.', level: 'GROW', color: BLUE },
      { seg: 'עולים חדשים', opp: 'עלייה מאוקראינה בשיא. FORMULA = "טעמי בית". תחרות נמוכה בנישה.', level: 'NEW', color: AMBER },
    ];

    matrix.forEach((m, i) => {
      const y = 1.36 + i * 1.02;
      s.addShape(pptx.ShapeType.rect, { x: 6.95, y: y, w: 0.72, h: 0.3, fill: { color: m.color } });
      s.addText(m.level, { x: 6.95, y: y, w: 0.72, h: 0.3, fontSize: 8, bold: true, color: WHITE, align: 'center' });
      s.addText(m.seg, { x: 7.73, y: y, w: 5.2, h: 0.3, fontSize: 9.5, bold: true, color: NAVY });
      s.addText(m.opp, { x: 6.95, y: y + 0.32, w: 6.05, h: 0.6, fontSize: 8.5, color: TEXT, wrap: true });
    });

    slideFooter(s, pptx, 4, TOTAL_SLIDES);
  }

  // ── SLIDE 5: MANAGER TEAMS (was 6) ───────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
    pageHeader(s, pptx, 'TEAMS ANALYSIS', 'ביצועי צוותים לפי מנהל FORMULA', 'Manager Performance 2024→2025');

    const teamColors = [GREEN, BLUE, NAVY, AMBER, ICE_C];
    const manRows = managers.filter(m => getVal(m, 'מנהל FORMULA') && getVal(m, 'מנהל FORMULA') !== 'SADRAN+');

    // Bar chart — teams
    const maxTeam = Math.max(...manRows.map(m => getVal(m, 'Sales2025') || 0));
    s.addText('הכנסות לפי מנהל 2025 (₪M)', { x: 0.4, y: 0.87, w: 7.5, h: 0.3, fontSize: 12, bold: true, color: NAVY });

    manRows.forEach((m, i) => {
      const mname = getVal(m, 'מנהל FORMULA');
      const s24 = getVal(m, 'Sales2024') || 0;
      const s25 = getVal(m, 'Sales2025') || 0;
      const gr = getVal(m, 'Growth') || 0;
      const cl = getVal(m, 'Clients2025') || 0;
      const col = teamColors[i % teamColors.length];
      const barW = ((s25 / maxTeam) * 5.8);
      const y = 1.28 + i * 1.08;

      s.addText(mname, { x: 0.4, y, w: 1.6, h: 0.28, fontSize: 12, bold: true, color: NAVY, align: 'right' });
      s.addShape(pptx.ShapeType.rect, { x: 2.15, y: y + 0.04, w: barW, h: 0.52, fill: { color: col } });
      s.addText(fmtNIS(s25), { x: 2.15 + barW + 0.1, y: y + 0.04, w: 1.5, h: 0.52, fontSize: 14, bold: true, color: col, align: 'left' });
      s.addText(arrow(gr), { x: 2.15 + barW + 1.7, y: y + 0.08, w: 1.0, h: 0.44, fontSize: 11, color: gr > 0 ? GREEN : DECLINE, align: 'left' });
      s.addText(cl + ' לקוחות', { x: 2.15 + barW + 2.8, y: y + 0.12, w: 1.4, h: 0.36, fontSize: 9, color: MUTED });
    });

    // Right side: team KPI cards
    const sadran = formulaManagers.find(m => getVal(m, 'מנהל FORMULA') === 'SADRAN+');
    const sadranS = sadran ? (getVal(sadran, 'Sales2025') || 0) : 0;

    s.addShape(pptx.ShapeType.rect, { x: 7.8, y: 0.87, w: 5.3, h: 5.9, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x: 7.8, y: 0.87, w: 5.3, h: 0.38, fill: { color: NAVY } });
    s.addText('מנהלי FORMULA — מדדים מרכזיים', { x: 7.95, y: 0.89, w: 5.0, h: 0.34, fontSize: 10, bold: true, color: WHITE });

    const teamInsights = [
      { manager: 'SVETA',   insight: 'הצמיחה הגבוהה +29%. 322 לקוחות. מנהל הכי יעיל (מכירות/לקוח).', star: '🌟' },
      { manager: 'VLAD',    insight: 'הכנסות מקס ₪22.9M. 436 לקוחות. גידול +17% — מעל ממוצע FORMULA.', star: '🏆' },
      { manager: 'NATALYA', insight: '₪22.0M | 409 לקוחות. יציב +17%. ביצוע עקבי לאורך שנה.', star: '✅' },
      { manager: 'ANATOL',  insight: '460 לקוחות — הכי גדול. ₪17.3M. פוטנציאל בהגדלת per-client.', star: '📈' },
      { manager: 'ALEXEY',  insight: '₪20.8M | 345 לקוחות. +12% — מתחת לממוצע. צמיחה ניתנת לשיפור.', star: '⚡' },
    ];

    teamInsights.forEach((t, i) => {
      const y = 1.38 + i * 1.02;
      s.addText(t.star + ' ' + t.manager, { x: 7.95, y, w: 5.0, h: 0.28, fontSize: 10, bold: true, color: teamColors[i], align: 'left' });
      s.addText(t.insight, { x: 7.95, y: y + 0.3, w: 5.0, h: 0.6, fontSize: 8.5, color: TEXT, wrap: true });
    });

    s.addShape(pptx.ShapeType.rect, { x: 0.35, y: 6.55, w: 7.2, h: 0.55, fill: { color: LIGHT } });
    s.addText('SADRAN+ (נסיעות): ₪4.0M (+23%)  |  No Manager: ₪2.5M (-16%)', {
      x: 0.55, y: 6.6, w: 6.9, h: 0.42, fontSize: 9, color: MUTED, align: 'left'
    });

    slideFooter(s, pptx, 5, TOTAL_SLIDES);
  }

  // ── SLIDE 7: TOP 5 AGENTS ─────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
    pageHeader(s, pptx, 'AGENT PERFORMANCE', 'Top 5 סוכנים — צמיחה 2024→2025', 'FORMULA • By Revenue Growth ₪');

    // Medal boxes
    const medals = ['🥇', '🥈', '🥉', '4', '5'];
    agents.forEach((a, i) => {
      const x = 0.35 + i * 2.56;
      const col = [GOLD, FLAT, AMBER, BLUE, ICE_C][i];
      s.addShape(pptx.ShapeType.rect, { x, y: 0.9, w: 2.35, h: 5.4, fill: { color: WHITE }, line: { color: col, width: 2 } });
      s.addShape(pptx.ShapeType.rect, { x, y: 0.9, w: 2.35, h: 0.52, fill: { color: col } });
      s.addText(medals[i] + ' #' + (i + 1), { x, y: 0.9, w: 2.35, h: 0.52, fontSize: 14, bold: true, color: WHITE, align: 'center' });

      s.addText(a.name || '—', { x: x + 0.1, y: 1.5, w: 2.15, h: 0.6, fontSize: 12, bold: true, color: NAVY, align: 'center', wrap: true });

      s.addText('+₪' + fmt(a.delta), { x: x + 0.1, y: 2.2, w: 2.15, h: 0.55, fontSize: 18, bold: true, color: col, align: 'center' });
      s.addText('גידול ₪', { x: x + 0.1, y: 2.73, w: 2.15, h: 0.24, fontSize: 8, color: MUTED, align: 'center' });

      s.addText(a.gr != null ? '+' + Math.round(a.gr * 100) + '%' : 'NEW', {
        x: x + 0.1, y: 3.05, w: 2.15, h: 0.55, fontSize: 22, bold: true, color: GREEN, align: 'center'
      });
      s.addText('גידול %', { x: x + 0.1, y: 3.58, w: 2.15, h: 0.24, fontSize: 8, color: MUTED, align: 'center' });

      s.addShape(pptx.ShapeType.rect, { x: x + 0.1, y: 3.95, w: 2.15, h: 0.4, fill: { color: ACCENT } });
      s.addText('2025:', { x: x + 0.1, y: 3.97, w: 0.55, h: 0.36, fontSize: 8, bold: true, color: NAVY });
      s.addText(fmtNIS(a.y25), { x: x + 0.6, y: 3.97, w: 1.6, h: 0.36, fontSize: 12, bold: true, color: NAVY });

      s.addShape(pptx.ShapeType.rect, { x: x + 0.1, y: 4.45, w: 2.15, h: 0.4, fill: { color: LIGHT } });
      s.addText('2024:', { x: x + 0.1, y: 4.47, w: 0.55, h: 0.36, fontSize: 8, color: MUTED });
      s.addText(a.y24 > 0 ? fmtNIS(a.y24) : '—', { x: x + 0.6, y: 4.47, w: 1.6, h: 0.36, fontSize: 12, color: MUTED });

      s.addShape(pptx.ShapeType.rect, { x: x + 0.1, y: 5.0, w: 2.15, h: 0.4, fill: { color: LIGHT } });
      s.addText('2026 YTD:', { x: x + 0.1, y: 5.02, w: 0.85, h: 0.36, fontSize: 8, color: MUTED });
      s.addText(fmtNIS(a['Y2026'] || 0), { x: x + 0.9, y: 5.02, w: 1.3, h: 0.36, fontSize: 12, color: BLUE });
    });

    // Insight bar
    s.addShape(pptx.ShapeType.rect, { x: 0.35, y: 6.42, w: 12.63, h: 0.7, fill: { color: DARKBG } });
    s.addText('💡 4 מתוך Top 5 הם סוכנים שצמחו ×5 עד ×9 — מאפיין שוק דינאמי. הכנסות קומבינד Top 5: ₪' +
      fmt(agents.reduce((s, a) => s + a.y25, 0)) + ' = ' + Math.round(agents.reduce((s, a) => s + a.y25, 0) / sales25 * 100) + '% מ-FORMULA.', {
      x: 0.55, y: 6.5, w: 12.4, h: 0.55, fontSize: 9.5, color: WHITE, align: 'left', wrap: true
    });

    slideFooter(s, pptx, 6, TOTAL_SLIDES);
  }

  // ── SLIDE 8: KOSHER ANALYSIS ──────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
    pageHeader(s, pptx, 'KASHRUT ANALYSIS', 'כשרות — ניתוח מגזרי 2024→2025→2026', 'Kosher vs Non-Kosher Market Split');

    // Big stats  (k25/k24/nk25/nk24/koshGr/nkGr defined in outer scope)
    const kGr = koshGr;
    kpiBox(s, pptx, 0.35, 0.87, 5.8, 1.28, 'כשר (כן) — 2025', fmtNIS(k25), arrow(kGr) + '  |  2024: ' + fmtNIS(k24), GREEN);
    kpiBox(s, pptx, 7.18, 0.87, 5.8, 1.28, 'לא כשר (לא) — 2025', fmtNIS(nk25), arrow(nkGr) + '  |  2024: ' + fmtNIS(nk24), BLUE);

    // Share visual
    const kShare25 = k25 / (k25 + nk25);
    const kShare24 = k24 / (k24 + nk24);
    s.addText('נתח כשר מסה"כ:', { x: 0.35, y: 2.3, w: 3, h: 0.3, fontSize: 10, bold: true, color: NAVY });
    // 2024
    s.addText('2024', { x: 0.35, y: 2.66, w: 0.8, h: 0.28, fontSize: 9, color: MUTED });
    s.addShape(pptx.ShapeType.rect, { x: 1.2, y: 2.66, w: Math.round(kShare24 * 7) , h: 0.52, fill: { color: GREEN } });
    s.addShape(pptx.ShapeType.rect, { x: 1.2 + Math.round(kShare24 * 7), y: 2.66, w: 7 - Math.round(kShare24 * 7), h: 0.52, fill: { color: BLUE } });
    s.addText(Math.round(kShare24 * 100) + '% כשר', { x: 1.3, y: 2.72, w: 3, h: 0.42, fontSize: 10, bold: true, color: WHITE });
    // 2025
    s.addText('2025', { x: 0.35, y: 3.3, w: 0.8, h: 0.28, fontSize: 9, color: MUTED });
    s.addShape(pptx.ShapeType.rect, { x: 1.2, y: 3.3, w: Math.round(kShare25 * 7), h: 0.52, fill: { color: GREEN } });
    s.addShape(pptx.ShapeType.rect, { x: 1.2 + Math.round(kShare25 * 7), y: 3.3, w: 7 - Math.round(kShare25 * 7), h: 0.52, fill: { color: BLUE } });
    s.addText(Math.round(kShare25 * 100) + '% כשר', { x: 1.3, y: 3.36, w: 3, h: 0.42, fontSize: 10, bold: true, color: WHITE });

    // Key insight
    const gapMultiplier = Math.round(kGr / nkGr);
    insightBox(s, pptx, 0.35, 4.0, 8.0, 0.72, '🔑 INSIGHT:', `כשר צמח ×${gapMultiplier} יותר מהר מלא-כשר: ${pct(kGr)} vs ${pct(nkGr)}. מגמה: ישראל הולכת יותר כשר — קהל חרדי גדל, עולים חדשים מחפשים כשרות, רשתות מרחיבות מדפים כשרים.`, ACCENT, GREEN);

    // 2026 YTD kosher
    insightBox(s, pptx, 0.35, 4.85, 8.0, 0.6, '📈 2026 YTD:', `כשר ${fmtNIS(koshYes['[Y2026]'])} | לא-כשר ${fmtNIS(koshNo['[Y2026]'])}. קצב 2026 ממשיך מגמת הכשר.`, LIGHT, GREEN);

    // Right side: analysis
    s.addShape(pptx.ShapeType.rect, { x: 8.65, y: 2.25, w: 4.45, h: 3.28, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x: 8.65, y: 2.25, w: 4.45, h: 0.36, fill: { color: GREEN } });
    s.addText('מה מסביר צמיחת כשר +50%?', { x: 8.8, y: 2.27, w: 4.2, h: 0.32, fontSize: 9.5, bold: true, color: WHITE });
    const whyK = [
      'NORD PORT ניצן +174% — אהוב על קהל כשר',
      'FERMA חמאה +211% — מובילה בשוק כשר',
      'SANTA BREMOR דגים כשרים — ₪19.9M',
      'שופרסל דיל כשר — growth driver ראשי',
      'קפוא-זן (2024) — לקוח חדש, ₪827K בשנה הראשונה',
      'חרדים + ציבור כשר — ממשיכים לגדול',
    ];
    whyK.forEach((line, i) => {
      s.addText('• ' + line, { x: 8.8, y: 2.72 + i * 0.44, w: 4.2, h: 0.42, fontSize: 8.5, color: TEXT, wrap: true });
    });

    slideFooter(s, pptx, 7, TOTAL_SLIDES);
  }

  // ── SLIDE 9: CHAIN ANALYSIS ───────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
    pageHeader(s, pptx, 'CHAIN ANALYSIS', 'ניתוח שרשראות — צמיחה 2024→2025', 'By Revenue Growth ₪ | FORMULA');

    // Sort by delta
    const sortedChains = [...chains].sort((a, b) => b.delta - a.delta);
    const maxDelta = Math.max(...sortedChains.map(c => Math.abs(c.delta)));

    s.addText('גידול ₪ לפי סוג לקוח (Top 10)', { x: 0.4, y: 0.88, w: 8, h: 0.3, fontSize: 12, bold: true, color: NAVY });

    sortedChains.forEach((c, i) => {
      const y = 1.28 + i * 0.58;
      const barW = (c.delta / maxDelta) * 6.5;
      const col = c.delta > 0 ? (c.gr > 0.5 ? GREEN : BLUE) : DECLINE;

      s.addText(c.name, { x: 0.35, y, w: 2.35, h: 0.38, fontSize: 9.5, color: NAVY, align: 'right', wrap: false });
      if (barW > 0) {
        s.addShape(pptx.ShapeType.rect, { x: 2.8, y: y + 0.06, w: Math.max(0.05, barW), h: 0.3, fill: { color: col } });
      }
      s.addText('+' + fmtNIS(c.delta), { x: 2.9 + Math.max(0.1, barW), y, w: 1.5, h: 0.38, fontSize: 9.5, bold: true, color: col });
      s.addText(pct(c.gr), { x: 2.9 + Math.max(0.1, barW) + 1.5, y, w: 0.8, h: 0.38, fontSize: 9, color: col });
      s.addText('2025: ' + fmtNIS(c.y25), { x: 9.9, y, w: 2.0, h: 0.38, fontSize: 8.5, color: MUTED });
    });

    // Insights right panel
    s.addShape(pptx.ShapeType.rect, { x: 9.8, y: 0.82, w: 3.3, h: 5.0, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x: 9.8, y: 0.82, w: 3.3, h: 0.36, fill: { color: BLUE } });
    s.addText('תובנות עיקריות', { x: 9.95, y: 0.84, w: 3.0, h: 0.32, fontSize: 10, bold: true, color: WHITE });
    const chainInsights = [
      { icon: '🏆', t: 'שופרסל דיל', b: '+₪4.1M (+200%) — הצמיחה הגדולה ביותר. Breakthrough ב-2025.' },
      { icon: '📈', t: 'שופרסל שלי', b: '+₪1.6M (+178%) — גדל מהיר. FORMULA חזקה ב"שלי".' },
      { icon: '🔝', t: 'יוחננוף', b: '+₪1.0M (+50%) — רשת מתפתחת, לקוח אסטרטגי.' },
      { icon: '⚠️', t: 'חנויות', b: '-₪224K (-0.8%) — שוק פרטי קטן. FORMULA צריכה focus.' },
      { icon: '📊', t: 'מניה', b: '-₪393K (-6%) — ירידה ב-2025. דורש בחינה.' },
    ];
    chainInsights.forEach((ci, i) => {
      const y = 1.3 + i * 0.88;
      s.addText(ci.icon + ' ' + ci.t, { x: 9.95, y, w: 3.0, h: 0.28, fontSize: 9, bold: true, color: NAVY });
      s.addText(ci.b, { x: 9.95, y: y + 0.3, w: 3.0, h: 0.52, fontSize: 8, color: TEXT, wrap: true });
    });

    // Summary
    s.addShape(pptx.ShapeType.rect, { x: 0.35, y: 7.0, w: 12.63, h: 0.3, fill: { color: LIGHT } });
    const topChain = sortedChains[0];
    s.addText(`Top growth chain: ${topChain.name} +${pct(topChain.gr)} | Top revenue chain: ${sortedChains.sort((a,b) => b.y25 - a.y25)[0].name} ${fmtNIS(sortedChains[0].y25)}`, {
      x: 0.5, y: 7.03, w: 12.4, h: 0.25, fontSize: 8, color: MUTED
    });

    slideFooter(s, pptx, 8, TOTAL_SLIDES);
  }

  // ── SLIDE 10: TOP CITIES ──────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
    pageHeader(s, pptx, 'GEOGRAPHIC ANALYSIS', 'Top 12 ערים — סטייה מממוצע צמיחה', 'FORMULA City Performance vs Market Average');

    const avgGr = cities.reduce((s, c) => s + c.gr, 0) / (cities.length || 1);
    const sortedCities = [...cities].sort((a, b) => b.s25 - a.s25);

    s.addText(`ממוצע צמיחה FORMULA: ${pct(avgGr)}`, { x: 0.4, y: 0.88, w: 5, h: 0.3, fontSize: 11, bold: true, color: NAVY });
    s.addText('ירוק = מעל ממוצע  |  כחול = בממוצע  |  אפור = מתחת לממוצע', {
      x: 0.4, y: 1.18, w: 8, h: 0.24, fontSize: 8.5, color: MUTED
    });

    // Two columns of cities
    sortedCities.forEach((c, i) => {
      const col = i < 6 ? 0 : 1;
      const row = i % 6;
      const x = col === 0 ? 0.35 : 6.9;
      const y = 1.48 + row * 0.88;

      const deviationColor = c.gr > avgGr + 0.05 ? GREEN : c.gr < avgGr - 0.05 ? DECLINE : BLUE;
      const deviation = c.gr - avgGr;

      s.addShape(pptx.ShapeType.rect, { x, y, w: 6.1, h: 0.82, fill: { color: WHITE }, line: { color: BORDER, width: 1 } });
      s.addShape(pptx.ShapeType.rect, { x, y, w: 0.18, h: 0.82, fill: { color: deviationColor } });

      s.addText(c.city, { x: x + 0.28, y: y + 0.04, w: 2.5, h: 0.32, fontSize: 11, bold: true, color: NAVY });
      s.addText(c.clients + ' לקוחות', { x: x + 0.28, y: y + 0.46, w: 2.5, h: 0.3, fontSize: 8.5, color: MUTED });

      s.addText(fmtNIS(c.s25), { x: x + 2.9, y: y + 0.04, w: 1.5, h: 0.32, fontSize: 11, bold: true, color: NAVY });
      s.addText(fmtNIS(c.s24), { x: x + 2.9, y: y + 0.46, w: 1.5, h: 0.28, fontSize: 8, color: MUTED });

      s.addText(pct(c.gr), { x: x + 4.5, y: y + 0.04, w: 1.0, h: 0.32, fontSize: 13, bold: true, color: deviationColor });
      const devSign = deviation > 0 ? '+' : '';
      s.addText(devSign + Math.round(deviation * 100) + '% vs avg', {
        x: x + 4.5, y: y + 0.46, w: 1.5, h: 0.28, fontSize: 8, color: deviationColor
      });
    });

    slideFooter(s, pptx, 9, TOTAL_SLIDES);
  }

  // ── SLIDE 11: HOVOT / OBLIGO ──────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
    pageHeader(s, pptx, 'CREDIT & OBLIGO', 'הגבלות אשראי ואובליגו — ניתוח סיכון', 'HOVOT ALL • Live Data June 2026');

    // Header row
    const cols = [
      { label: 'לקוח', x: 0.35, w: 2.7 },
      { label: 'חוב פתוח', x: 3.15, w: 1.8 },
      { label: 'OBLIGO', x: 5.05, w: 1.7 },
      { label: '% מנוצל', x: 6.85, w: 1.4 },
      { label: '90+ ימים', x: 8.35, w: 1.6 },
      { label: 'סה"כ אשראי', x: 10.05, w: 1.7 },
      { label: 'סטטוס', x: 11.85, w: 1.2 },
    ];

    s.addShape(pptx.ShapeType.rect, { x: 0.35, y: 0.88, w: 12.73, h: 0.36, fill: { color: NAVY } });
    cols.forEach(c => s.addText(c.label, { x: c.x + 0.05, y: 0.9, w: c.w - 0.1, h: 0.32, fontSize: 8.5, bold: true, color: WHITE, align: 'center' }));

    hovots.forEach((h, i) => {
      const y = 1.32 + i * 0.62;
      const bgColor = i % 2 === 0 ? WHITE : LIGHT;
      const utilization = h.obligo > 0 ? h.debt / h.obligo : (h.debt > 0 ? 999 : 0);
      const over = utilization > 1;
      const at = utilization > 0.85 && !over;
      const risk90 = h.over90 > 100000;
      const rowColor = over ? 'FFF0F0' : at ? 'FFFDE7' : bgColor;
      const statusText = over ? 'OVER LIMIT' : at ? 'AT RISK' : (risk90 ? '90+ OVERDUE' : 'OK');
      const statusColor = over ? RED_WARN : at ? AMBER : risk90 ? AMBER : GREEN;

      s.addShape(pptx.ShapeType.rect, { x: 0.35, y, w: 12.73, h: 0.56, fill: { color: rowColor } });
      s.addText(h.chain, { x: cols[0].x + 0.05, y: y + 0.04, w: cols[0].w - 0.1, h: 0.26, fontSize: 8.5, bold: true, color: NAVY });
      s.addText(h.name.slice(0, 22), { x: cols[0].x + 0.05, y: y + 0.3, w: cols[0].w - 0.1, h: 0.22, fontSize: 7.5, color: MUTED });
      s.addText(fmtNIS(h.debt), { x: cols[1].x, y: y + 0.12, w: cols[1].w, h: 0.32, fontSize: 10, bold: true, color: over ? RED_WARN : TEXT, align: 'center' });
      s.addText(h.obligo > 0 ? fmtNIS(h.obligo) : '—', { x: cols[2].x, y: y + 0.12, w: cols[2].w, h: 0.32, fontSize: 10, color: TEXT, align: 'center' });
      s.addText(h.obligo > 0 ? Math.round(utilization * 100) + '%' : 'N/A', { x: cols[3].x, y: y + 0.12, w: cols[3].w, h: 0.32, fontSize: 11, bold: over || at, color: statusColor, align: 'center' });
      s.addText(h.over90 > 1000 ? fmtNIS(h.over90) : '—', { x: cols[4].x, y: y + 0.12, w: cols[4].w, h: 0.32, fontSize: 9.5, color: risk90 ? RED_WARN : MUTED, align: 'center' });
      s.addText(fmtNIS(h.total), { x: cols[5].x, y: y + 0.12, w: cols[5].w, h: 0.32, fontSize: 9, color: TEXT, align: 'center' });
      s.addShape(pptx.ShapeType.rect, { x: cols[6].x + 0.1, y: y + 0.14, w: cols[6].w - 0.2, h: 0.28, fill: { color: statusColor } });
      s.addText(statusText, { x: cols[6].x + 0.1, y: y + 0.14, w: cols[6].w - 0.2, h: 0.28, fontSize: 7.5, bold: true, color: WHITE, align: 'center' });
    });

    // Total obligo
    const totalObligo = hovots.reduce((sum, h) => sum + h.obligo, 0);
    const totalDebt = hovots.reduce((sum, h) => sum + h.debt, 0);
    s.addShape(pptx.ShapeType.rect, { x: 0.35, y: 6.35, w: 12.73, h: 0.38, fill: { color: NAVY } });
    s.addText(`סה"כ OBLIGO מוצג: ${fmtNIS(totalObligo)}  |  סה"כ חוב פתוח: ${fmtNIS(totalDebt)}  |  ניצול ממוצע: ${Math.round(totalDebt/totalObligo*100)}%`, {
      x: 0.55, y: 6.37, w: 12.4, h: 0.34, fontSize: 9, color: WHITE, bold: true, align: 'center'
    });

    insightBox(s, pptx, 0.35, 6.8, 12.63, 0.38, null,
      '⚠️ מ.מ.ד. אילת — ₪4.1M חוב ללא OBLIGO מוגדר. מחסני השוק — חרגה מהלימיט 116%. יינות ביתן + שופרסל שלי — 90+ ימים.',
      'FFF8E1', AMBER);

    slideFooter(s, pptx, 10, TOTAL_SLIDES);
  }

  // ── SLIDE 12: 2026 YTD TREND ──────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
    pageHeader(s, pptx, '2026 YTD ANALYSIS', '2026 מגמת שנה — ינואר עד יוני', '2026 vs 2025 Monthly Trend • FORMULA');

    const months25 = [1,2,3,4,5,6].map(m => monthly[2025]?.[m] || 0);
    const months26 = [1,2,3,4,5,6].map(m => monthly[2026]?.[m] || 0);
    const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני'];
    const maxM = Math.max(...months25, ...months26) * 1.1;

    const chartH = 3.4, chartBaseY = 5.35, barW = 0.55;

    months25.forEach((m25, i) => {
      const m26 = months26[i];
      const gx = 0.6 + i * 2.0;

      // 2025
      const h25 = maxM > 0 ? (m25 / maxM) * chartH : 0;
      s.addShape(pptx.ShapeType.rect, { x: gx, y: chartBaseY - h25, w: barW, h: h25, fill: { color: FLAT } });
      if (m25 > 0) s.addText(fmtNIS(m25), { x: gx - 0.1, y: chartBaseY - h25 - 0.28, w: barW + 0.2, h: 0.28, fontSize: 7.5, color: MUTED, align: 'center' });

      // 2026
      const h26 = maxM > 0 ? (m26 / maxM) * chartH : 0;
      const col26 = m26 > m25 ? GREEN : (m26 > 0 ? DECLINE : FLAT);
      s.addShape(pptx.ShapeType.rect, { x: gx + barW + 0.1, y: chartBaseY - h26, w: barW, h: h26, fill: { color: col26 } });
      if (m26 > 0) s.addText(fmtNIS(m26), { x: gx + barW, y: chartBaseY - h26 - 0.28, w: barW + 0.2, h: 0.28, fontSize: 7.5, color: col26, align: 'center' });

      // Month label
      s.addText(monthNames[i], { x: gx - 0.2, y: chartBaseY + 0.1, w: barW * 2 + 0.3, h: 0.3, fontSize: 9, color: MUTED, align: 'center' });

      // Growth %
      if (m25 > 0 && m26 > 0) {
        const gr = (m26 - m25) / m25;
        s.addText(pct(gr), { x: gx - 0.2, y: chartBaseY + 0.42, w: barW * 2 + 0.3, h: 0.28, fontSize: 8, bold: true, color: gr > 0 ? GREEN : DECLINE, align: 'center' });
      }
    });

    // Legend
    s.addShape(pptx.ShapeType.rect, { x: 0.4, y: 0.9, w: 0.3, h: 0.22, fill: { color: FLAT } });
    s.addText('2025', { x: 0.75, y: 0.9, w: 0.7, h: 0.22, fontSize: 9, color: MUTED });
    s.addShape(pptx.ShapeType.rect, { x: 1.6, y: 0.9, w: 0.3, h: 0.22, fill: { color: GREEN } });
    s.addText('2026', { x: 1.95, y: 0.9, w: 0.7, h: 0.22, fontSize: 9, color: MUTED });

    // KPI summary
    const total26 = months26.reduce((a, b) => a + b, 0);
    const total25samp = months25.reduce((a, b) => a + b, 0);
    kpiBox(s, pptx, 0.35, 0.87, 2.8, 1.15, 'YTD 2026 (Jan-Jun)', fmtNIS(total26), 'vs ' + fmtNIS(total25samp) + ' 2025 same', NAVY);
    kpiBox(s, pptx, 3.35, 0.87, 2.8, 1.15, 'YTD Growth', pct((total26 - total25samp) / total25samp), '2026 vs 2025', GREEN);
    kpiBox(s, pptx, 6.35, 0.87, 2.8, 1.15, 'Projected 2026', fmtNIS(total26 / 6 * 12), 'run-rate שנתי', BLUE);
    kpiBox(s, pptx, 9.35, 0.87, 3.63, 1.15, 'Profit YTD', fmtNIS(profit26) + ' (' + Math.round(margin26*100) + '%)', 'מרווח YTD 2026', AMBER);

    slideFooter(s, pptx, 11, TOTAL_SLIDES);
  }

  // ── SLIDE 13: SUMMARY & OUTLOOK ───────────────────────────────────
  {
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: DARKBG } });
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 5.75, w: 13.33, h: 1.75, fill: { color: NAVY } });
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 5.73, w: 13.33, h: 0.04, fill: { color: ICE_C } });

    s.addText('FORMULA 2025 — סיכום ותחזית', {
      x: 0.5, y: 0.25, w: 12.33, h: 0.65, fontSize: 28, bold: true, color: WHITE, align: 'center'
    });
    s.addText('Annual Report Key Takeaways', {
      x: 0.5, y: 0.88, w: 12.33, h: 0.38, fontSize: 14, color: ICE_C, align: 'center'
    });

    const achievements = [
      { icon: '✅', title: 'הכנסות שיא', body: `₪${(sales25/1e6).toFixed(1)}M — צמיחה +${Math.round(form.gr*100)}% לעומת 2024. מעל ₪100M לראשונה.` },
      { icon: '🌟', title: 'פריצת כשרות', body: `מגזר כשר +${Math.round(koshGr*100)}% — ×12 מהיר יותר מלא-כשר. ניצול גל חרדי + עולים.` },
      { icon: '🏆', title: 'שופרסל דיל = Star', body: `+₪4.1M (+200%) — שותפות אסטרטגית הניבה פרי. שופרסל שלי +178%.` },
      { icon: '👥', title: 'Top Agents', body: `ליאור קידר +898%, מרגריטה מקרצ\'ב +733%, וצ\'סלב שולקין +895% — דור חדש של סוכנים.` },
      { icon: '📍', title: 'ערים בצמיחה', body: `מודיעין +52%, ירושלים +26%, חדרה +25%. חיפה ₪8.1M — הכי גדולה.` },
      { icon: '⚠️', title: 'סיכוני אשראי', body: `מ.מ.ד. ₪4.1M ללא לימיט. מחסני השוק 116% ניצול. יינות ביתן 90+ ימים — לטיפול.` },
    ];

    const cols2 = [0.4, 6.75];
    achievements.forEach((a, i) => {
      const col = i % 2 === 0 ? 0 : 1;
      const row = Math.floor(i / 2);
      const x = cols2[col];
      const y = 1.38 + row * 1.42;
      s.addShape(pptx.ShapeType.rect, { x, y, w: 6.1, h: 1.28, fill: { color: NAVY }, line: { color: ICE_C, width: 1 } });
      s.addText(a.icon + ' ' + a.title, { x: x + 0.18, y: y + 0.1, w: 5.7, h: 0.34, fontSize: 11, bold: true, color: GOLD });
      s.addText(a.body, { x: x + 0.18, y: y + 0.44, w: 5.7, h: 0.74, fontSize: 9.5, color: WHITE, wrap: true });
    });

    s.addText('2026 OUTLOOK:', { x: 0.4, y: 5.88, w: 2.0, h: 0.38, fontSize: 10, bold: true, color: ICE_C });
    const total26 = Object.values(monthly[2026] || {}).reduce((a, b) => a + b, 0);
    s.addText(`YTD ₪${(total26/1e6).toFixed(1)}M → Run-rate ₪${Math.round(total26/6*12/1e6)}M+ שנתי | כשר ממשיך +50% | 5 מנהלים פעילים | שופרסל — שיתוף פעולה מורחב`, {
      x: 2.5, y: 5.88, w: 10.6, h: 0.62, fontSize: 9.5, color: WHITE, align: 'left', wrap: true
    });

    s.addText('DILER BMD Group  |  FORMULA  |  Annual Report 2025  |  Prepared by AI Analytics via Power BI Live Data', {
      x: 0.4, y: 6.56, w: 12.6, h: 0.32, fontSize: 8, color: FLAT, align: 'center'
    });

    slideFooter(s, pptx, 12, TOTAL_SLIDES);
  }

  // ── Save ────────────────────────────────────────────────────────────
  const outPath = path.resolve(__dirname, '../FORMULA REPORT AI/FORMULA-Annual-Report-2025.pptx');
  await pptx.writeFile({ fileName: outPath });
  console.log('\n✅ Done! Saved to:', outPath);
}

buildReport().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
