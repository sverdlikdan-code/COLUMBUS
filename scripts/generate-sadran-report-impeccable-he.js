// SADRAN report — IMPECCABLE, גרסה עברית (RTL) — אותם נתונים כמו generate-sadran-report-impeccable.js,
// טקסט מתורגם לעברית + עוגני פריסה עיקריים (kicker/title/כותרות מדור) ממוקמים מימין.
// טבלאות/שורות נתונים נשארות באותה גיאומטריה כמו בגרסה הרוסית — רק ה-BiDi של הטקסט העברי מתוקן
// (rtlMode + lang בכל תיבת טקסט עברית).
const path = require('path');
const pptxgenjs = require('pptxgenjs');
const { loadRows, loadIceBddBenchmark, pctChange, aggBy, fmtILS, fmtPct, DEPT_COMPANY, getNewCustomerSet } = require('./sadran-data');

// SADRAN_OUTPUT_DIR — задан на VPS (cron), не задан локально на Windows (дефолт — Desktop).
const OUT = process.env.SADRAN_OUTPUT_DIR
  ? path.join(process.env.SADRAN_OUTPUT_DIR, 'SADRAN_REPORT_IMPECCABLE_HE.pptx')
  : 'C:\\Users\\d.sverdlik\\Desktop\\SADRAN_REPORT_IMPECCABLE_HE.pptx';

// --- palette (זהה לגרסה הרוסית) ---
const INK = '1B2430';
const PAPER = 'FAF7F2';
const PAPER_LINE = 'D9CFBF';
const INK_TEXT = '2A2620';
const MUTED = '7A7264';
const GOLD = 'B8863B';
const SAGE = '5B7A5E';
const CLAY = 'B2603F';
const FLAT = '9C9284';

const SERIF = 'Georgia';
const SANS = 'Calibri';

function colorForPct(p) {
  if (p === null) return FLAT;
  if (p > 0.02) return SAGE;
  if (p < -0.02) return CLAY;
  return FLAT;
}

const barChartSolid = {
  barGapWidthPct: 45,
  dataBorder: { pt: 1, color: PAPER },
};

// he — все Hebrew-контентные text-опции получают rtlMode+lang одним вызовом.
function he(opts) {
  return { ...opts, rtlMode: true, lang: 'he-IL' };
}

function main() {
  const rows = loadRows();
  const totalLY = rows.reduce((s, r) => s + r.lastYear, 0);
  const totalNow = rows.reduce((s, r) => s + r.now, 0);
  const totalPct = pctChange(totalLY, totalNow);

  // lowValueCandidates — кандидаты на снятие сдарана: точки с наименьшим тотал продаж.
  // Тотал — по клиенту ЦЕЛИКОМ (сумма по всем компаниям).
  const custTotalsAll = new Map();
  for (const r of rows) {
    if (!custTotalsAll.has(r.custno)) {
      custTotalsAll.set(r.custno, { custname: r.custname, sadran: r.sadran, city: r.city, companies: new Set(), lastYear: 0, now: 0 });
    }
    const t = custTotalsAll.get(r.custno);
    t.companies.add(r.company);
    t.lastYear += r.lastYear;
    t.now += r.now;
  }
  const grandNowAll = [...custTotalsAll.values()].reduce((s, v) => s + v.now, 0);
  const lowValueCandidates = [...custTotalsAll.values()].sort((a, b) => a.now - b.now);

  const byCompany = aggBy(rows, r => r.company);
  const iceBdd = loadIceBddBenchmark();
  const iceBddPct = iceBdd ? pctChange(iceBdd.lastYear, iceBdd.now) : undefined;
  const byDept = aggBy(rows, r => r.dept).sort((a, b) => {
    const ca = DEPT_COMPANY[a.key] || '', cb = DEPT_COMPANY[b.key] || '';
    if (ca !== cb) return ca.localeCompare(cb);
    return b.delta - a.delta;
  });
  const rowsExBdd = rows.filter(r => r.company !== 'ICE BDD');
  const newCustSet = getNewCustomerSet(rowsExBdd);
  const byCustType = aggBy(rows, r => r.custtype).filter(b => b.now > 20000 || b.lastYear > 20000).slice(0, 10);

  const custKeyFI = r => `${r.custno}|${r.custname}|${r.sadran}|${r.kosher}`;
  function buildCompanyDeepDive(company, minRevenue) {
    const companyRows = rowsExBdd.filter(r => r.company === company);
    const byDeptC = aggBy(companyRows, r => r.dept).sort((a, b) => b.delta - a.delta);
    const byCustTypeC = aggBy(companyRows, r => r.custtype)
      .filter(b => b.now > minRevenue || b.lastYear > minRevenue)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 8);
    const custTypeTopMovers = {};
    for (const ct of byCustTypeC) {
      const typeRows = companyRows.filter(r => r.custtype === ct.key);
      const byCust = aggBy(typeRows, custKeyFI).map(c => {
        const [custno, custname, sadran, kosher] = c.key.split('|');
        return { ...c, custno, custname, sadran, kosher };
      });
      custTypeTopMovers[ct.key] = byCust.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10);
    }
    return { byDept: byDeptC, byCustType: byCustTypeC, custTypeTopMovers };
  }
  const deepDiveFORMULA = buildCompanyDeepDive('FORMULA', 10000);
  const deepDiveICEMISH = buildCompanyDeepDive('ICE MISH', 5000);

  const custKey = r => `${r.custno}|${r.custname}`;
  // custKeySochen — только для per-company топов: שם סוכן стабилен для клиент+компания,
  // но может отличаться МЕЖДУ компаниями того же клиента.
  const custKeySochen = r => `${r.custno}|${r.custname}|${r.sochen || ''}`;
  const byCustomer = aggBy(rowsExBdd, custKey).map(c => {
    const [custno, custname] = c.key.split('|');
    return { ...c, custno, custname };
  });
  const byCustomerSameStore = byCustomer.filter(c => !newCustSet.has(c.custno));
  const topGrowth = byCustomerSameStore.slice(0, 6);
  const topDecline = byCustomerSameStore.slice(-6).reverse();
  const topNewCustomers = byCustomer.filter(c => newCustSet.has(c.custno)).sort((a, b) => b.now - a.now).slice(0, 6);

  const topGrowthByCompany = {};
  const topDeclineByCompany = {};
  for (const company of ['FORMULA', 'INTER', 'ICE MISH']) {
    const companyRows = rowsExBdd.filter(r => r.company === company);
    const newSetC = getNewCustomerSet(companyRows);
    const sameStoreC = companyRows.filter(r => !newSetC.has(r.custno));
    const byCustC = aggBy(sameStoreC, custKeySochen).map(c => {
      const [custno, custname, sochen] = c.key.split('|');
      return { ...c, custno, custname, sochen };
    });
    topGrowthByCompany[company] = byCustC.slice(0, 6);
    topDeclineByCompany[company] = byCustC.slice(-6).reverse();
  }

  function paretoRisk(companyRows) {
    const totals = new Map();
    for (const r of companyRows) {
      if (!totals.has(r.custno)) totals.set(r.custno, { lastYear: 0, now: 0 });
      const c = totals.get(r.custno);
      c.lastYear += r.lastYear;
      c.now += r.now;
    }
    const grand = [...totals.values()].reduce((s, v) => s + v.now, 0);
    const ranked = [...totals.entries()].sort((a, b) => b[1].now - a[1].now);
    let cum = 0;
    const paretoSet = new Set();
    for (const [c, v] of ranked) {
      cum += v.now;
      paretoSet.add(c);
      if (cum >= 0.70 * grand) break;
    }
    const deptByCust = new Map();
    for (const r of companyRows) {
      if (!paretoSet.has(r.custno)) continue;
      if (!deptByCust.has(r.custno)) deptByCust.set(r.custno, new Map());
      const dm = deptByCust.get(r.custno);
      if (!dm.has(r.dept)) dm.set(r.dept, { lastYear: 0, now: 0 });
      const d = dm.get(r.dept);
      d.lastYear += r.lastYear;
      d.now += r.now;
    }
    let flagCount = 0;
    for (const custno of paretoSet) {
      const dm = deptByCust.get(custno) || new Map();
      let flagged = false;
      for (const d of dm.values()) {
        if (d.lastYear > 0 && d.now === 0) flagged = true;
        else if (d.lastYear > 0 && d.now > 0 && (d.now - d.lastYear) / d.lastYear < -0.30) flagged = true;
      }
      if (flagged) flagCount++;
    }
    return { paretoCount: paretoSet.size, totalCount: totals.size, flagCount };
  }
  function companyInsightData(company, minRevenue) {
    const companyRows = rows.filter(r => r.company === company);
    const deptStats = aggBy(companyRows, r => r.dept).sort((a, b) => b.delta - a.delta);
    const custTypeStats = aggBy(companyRows, r => r.custtype)
      .filter(b => b.now > minRevenue || b.lastYear > minRevenue)
      .sort((a, b) => b.delta - a.delta);
    const custKeyC = r => `${r.custno}|${r.custname}|${r.sadran}|${r.kosher}`;
    const custStats = aggBy(companyRows, custKeyC).map(c => {
      const [custno, custname, sadran, kosher] = c.key.split('|');
      return { ...c, custno, custname, sadran, kosher };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return { deptStats, custTypeStats, topCustomer: custStats[0], pareto: paretoRisk(companyRows) };
  }
  const insightsFORMULA = companyInsightData('FORMULA', 10000);
  const insightsICEMISH = companyInsightData('ICE MISH', 5000);
  function signedILS(n) {
    return (n >= 0 ? '+' : '−') + fmtILS(Math.abs(n));
  }

  const custTotals = new Map();
  for (const r of rows) {
    if (!custTotals.has(r.custno)) custTotals.set(r.custno, { lastYear: 0, now: 0 });
    const c = custTotals.get(r.custno);
    c.lastYear += r.lastYear;
    c.now += r.now;
  }
  const newCustomers = [...custTotals.values()].filter(v => v.lastYear === 0 && v.now > 0);
  const sameStoreCustomers = [...custTotals.values()].filter(v => v.lastYear > 0);
  const sameLY = sameStoreCustomers.reduce((s, v) => s + v.lastYear, 0);
  const sameNow = sameStoreCustomers.reduce((s, v) => s + v.now, 0);
  const samePct = pctChange(sameLY, sameNow);

  let churnDelta = 0, newDelta = 0, growthDelta = 0, declineDelta = 0, otherDelta = 0;
  for (const r of rows) {
    const ly = r.lastYear, now = r.now, d = now - ly;
    if (ly > 0 && now <= 0) churnDelta += d;
    else if (ly <= 0 && now > 0) newDelta += d;
    else if (ly > 0 && now > ly) growthDelta += d;
    else if (ly > 0 && now > 0 && now <= ly) declineDelta += d;
    else otherDelta += d;
  }
  const churnAndOther = churnDelta + otherDelta;
  // churnList — реальные строки за суммой "נטישה" (см. project_sadran_pbi_join memory,
  // запрос пользователя 2026-08-11: бар оттока без имён нельзя объяснить руководству).
  const churnList = rows.filter(r => r.lastYear > 0 && r.now <= 0)
    .map(r => ({ ...r, deptLabel: `${r.company} · ${r.dept}` }))
    .sort((a, b) => b.lastYear - a.lastYear);
  const wf = [
    { label: 'תקופה\nקודמת', base: 0, value: totalLY, kind: 'end' },
    { label: 'לקוחות\nחדשים', base: totalLY, value: newDelta, kind: 'pos' },
    { label: 'צמיחת\nבסיס', base: totalLY + newDelta, value: growthDelta, kind: 'pos' },
    { label: 'ירידת\nבסיס', base: totalLY + newDelta + growthDelta + declineDelta, value: -declineDelta, kind: 'neg' },
    { label: 'נטישה', base: totalLY + newDelta + growthDelta + declineDelta + churnAndOther, value: -churnAndOther, kind: 'neg' },
    { label: 'תקופה\nנוכחית', base: 0, value: totalNow, kind: 'end' },
  ];

  const pptx = new pptxgenjs();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.rtlMode = true; // презентация целиком RTL (панель PowerPoint, направление слайдов)

  // ---------- Section divider — kicker/title/sub якорятся справа ----------
  function divider(kicker, title, sub) {
    const s = pptx.addSlide();
    s.background = { color: INK };
    s.addText(kicker.toUpperCase(), he({
      x: 0.9, y: 2.6, w: 11.5, h: 0.5, fontSize: 13, color: GOLD, charSpacing: 3,
      fontFace: SANS, bold: true, align: 'right',
    }));
    s.addText(title, he({
      x: 0.9, y: 3.1, w: 11.5, h: 2.0, fontSize: 44, color: PAPER, fontFace: SERIF, valign: 'top', align: 'right',
    }));
    if (sub) {
      s.addText(sub, he({
        x: 0.9, y: 4.9, w: 10.5, h: 0.8, fontSize: 15, color: 'B8B2A6', fontFace: SANS, valign: 'top', align: 'right',
      }));
    }
    return s;
  }

  // ---------- Content header — золотой якорь и kicker справа ----------
  function contentHeader(s, kicker, title) {
    s.background = { color: PAPER };
    s.addShape('rect', { x: 12.54, y: 0.53, w: 0.09, h: 0.24, fill: { color: GOLD }, line: { type: 'none' } });
    s.addText(kicker.toUpperCase(), he({
      x: 0.7, y: 0.5, w: 11.75, h: 0.35, fontSize: 11, color: GOLD, charSpacing: 2, bold: true, fontFace: SANS, align: 'right',
    }));
    s.addText(title, he({
      x: 0.7, y: 0.82, w: 11.5, h: 0.7, fontSize: 26, color: INK_TEXT, fontFace: SERIF, align: 'right',
    }));
    s.addShape('line', { x: 0.7, y: 1.55, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
  }

  // ---------- Slide 1 — title ----------
  {
    const s = pptx.addSlide();
    s.background = { color: INK };
    s.addText('SADRAN', he({
      x: 0.9, y: 2.3, w: 11.5, h: 1.3, fontSize: 64, color: PAPER, fontFace: SERIF, bold: false, align: 'right',
    }));
    s.addShape('line', { x: 10.23, y: 3.55, w: 2.2, h: 0, line: { color: GOLD, width: 2 } });
    s.addText('עלייה וירידה במכירות לפי סדרנים, מחלקות ושווקים', he({
      x: 2.43, y: 3.75, w: 10, h: 0.6, fontSize: 16, color: 'C7C1B4', fontFace: SANS, align: 'right',
    }));
    s.addText(`הופק אוטומטית על ידי סוכן אנליטי  ·  ${new Date().toLocaleDateString('he-IL')}`, he({
      x: 2.43, y: 6.8, w: 10, h: 0.4, fontSize: 10.5, color: '746E62', fontFace: SANS, align: 'right',
    }));
  }

  // ---------- Slide 2 — waterfall ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'תמונה כללית', `ממה מורכב ${fmtPct(totalPct)}`);
    const chartData = [
      { name: 'בסיס', labels: wf.map(w => w.label), values: wf.map(w => Math.round(w.base)) },
      { name: 'צמיחה', labels: wf.map(w => w.label), values: wf.map(w => w.kind === 'pos' ? Math.round(w.value) : 0) },
      { name: 'ירידה', labels: wf.map(w => w.label), values: wf.map(w => w.kind === 'neg' ? Math.round(w.value) : 0) },
      { name: 'תוצאה', labels: wf.map(w => w.label), values: wf.map(w => w.kind === 'end' ? Math.round(w.value) : 0) },
    ];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.6, y: 1.85, w: 12.1, h: 4.7, barDir: 'col', barGrouping: 'stacked',
      chartColors: [PAPER, SAGE, CLAY, INK],
      showLegend: false, showTitle: false,
      showValue: false,
      catAxisLabelFontSize: 11.5, catAxisLabelColor: INK_TEXT,
      valAxisHidden: true,
      plotArea: { border: { type: 'none' } },
      catGridLine: { style: 'none' }, valGridLine: { style: 'none' },
      border: { type: 'none' },
      ...barChartSolid,
    });
    wf.forEach((w, i) => {
      const xPos = 0.6 + (i + 0.5) * (12.1 / wf.length);
      const signed = w.kind === 'pos' ? w.value : w.kind === 'neg' ? -w.value : w.value;
      const label = w.kind === 'end' ? fmtILS(signed) : (signed >= 0 ? '+' : '−') + fmtILS(Math.abs(signed));
      s.addText(label, {
        x: xPos - 0.85, y: 6.55, w: 1.7, h: 0.35, fontSize: 11.5, bold: true, align: 'center',
        color: w.kind === 'end' ? INK_TEXT : (w.kind === 'pos' ? SAGE : CLAY), fontFace: SANS,
      });
    });
    s.addText('התזרימים הגולמיים (צמיחה + חדשים) גדולים פי כמה מהירידה והנטישה — התוצאה הנקייה מסתירה תמונה דינמית הרבה יותר.', he({
      x: 0.7, y: 6.95, w: 11.9, h: 0.4, fontSize: 11, color: MUTED, fontFace: SANS, italic: true, align: 'right',
    }));
  }

  // ---------- Slide 2.5 — נטישה: מי בדיוק עזב ----------
  if (churnList.length) {
    const s = pptx.addSlide();
    contentHeader(s, 'תמונה כללית', 'נטישה — מי בדיוק עזב');
    const SHOW = 8;
    const shown = churnList.slice(0, SHOW);
    const rest = churnList.slice(SHOW);
    // Колонки, не слитная строка (запрос пользователя 2026-08-11) — "סדרן" убран совсем,
    // остаётся только имя סוכן, привязанное к конкретной паре клиент+компания. Геометрия
    // намеренно LTR-идентична русской версии (established decision) — переведён только текст.
    const header = ['לקוח', 'מחלקה', 'סוכן', 'היה'].map(t => ({
      text: t, options: { bold: true, fill: { color: INK }, color: PAPER, fontSize: 10.5, fontFace: SANS },
    }));
    const body = shown.map(c => ([
      { text: c.custname || '', options: { fontSize: 10.5, color: INK_TEXT, fontFace: SANS, rtlMode: true, lang: 'he-IL' } },
      { text: c.deptLabel || '', options: { fontSize: 10, color: MUTED, fontFace: SANS, rtlMode: true, lang: 'he-IL' } },
      { text: c.sochen || '', options: { fontSize: 10, color: MUTED, fontFace: SANS, rtlMode: true, lang: 'he-IL' } },
      { text: fmtILS(c.lastYear), options: { fontSize: 10.5, bold: true, color: CLAY, fontFace: SANS, align: 'right' } },
    ]));
    s.addTable([header, ...body], {
      x: 0.7, y: 1.85, w: 11.9, h: 4.9,
      colW: [4.6, 2.7, 2.8, 1.8],
      border: { type: 'solid', color: PAPER_LINE, pt: 0.5 },
      autoPage: false,
    });
    if (rest.length) {
      const restSum = rest.reduce((s2, c) => s2 + c.lastYear, 0);
      s.addText(`עוד ${rest.length} שורות נטישה על ${fmtILS(restSum)} (קטנות יותר, כל אחת < ${fmtILS(shown[shown.length - 1].lastYear)}) — רשימה מלאה ב-SADRAN_ANALYSIS.xlsx.`, he({
        x: 0.7, y: 6.9, w: 11.9, h: 0.4, fontSize: 10, color: MUTED, fontFace: SANS, italic: true,
      }));
    }
  }

  // ---------- Slide 3 — Same-Store ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'צמיחה אורגנית', 'Same-store מול לקוחות חדשים');
    s.addText(fmtPct(samePct), {
      x: 7.63, y: 2.0, w: 5, h: 1.2, fontSize: 58, bold: true, color: colorForPct(samePct), fontFace: SERIF, align: 'right',
    });
    s.addText(`Same-store: ${sameStoreCustomers.length} לקוחות עם היסטוריה מהתקופה המקבילה אשתקד · ${fmtILS(sameLY)} → ${fmtILS(sameNow)}`, he({
      x: 4.63, y: 3.15, w: 8, h: 0.5, fontSize: 13, color: MUTED, fontFace: SANS, align: 'right',
    }));
    s.addShape('line', { x: 0.7, y: 3.85, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
    const newShare = totalNow ? (newCustomers.reduce((s2, v) => s2 + v.now, 0) / totalNow * 100) : 0;
    s.addText(`לקוחות חדשים תורמים רק ${newShare.toFixed(1)}% מהמחזור הנוכחי (${newCustomers.length} לקוחות). הצמיחה נשענת על הבסיס הקיים, לא על פתיחת נקודות חדשות — Same-store כמעט זהה לתוצאה הכוללת.`, he({
      x: 2.13, y: 4.1, w: 10.5, h: 1.4, fontSize: 15, color: INK_TEXT, fontFace: SERIF, italic: true, valign: 'top', align: 'right',
    }));
  }

  // ---------- Divider: by company ----------
  divider('פילוח 1', 'לפי חברות', 'INTER · FORMULA · ICE MISH');

  // ---------- Slide — company rows ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'חברה', 'עלייה / ירידה לפי חברות');
    byCompany.forEach((b, i) => {
      const y = 2.0 + i * 1.15;
      const lyShare = totalLY ? b.lastYear / totalLY : 0;
      const nowShare = totalNow ? b.now / totalNow : 0;
      s.addText(b.key, { x: 0.7, y, w: 3.0, h: 0.8, fontSize: 22, bold: true, color: INK_TEXT, fontFace: SERIF, valign: 'middle' });
      s.addText(`${fmtILS(b.lastYear)}  →  ${fmtILS(b.now)}`, { x: 3.8, y, w: 5.0, h: 0.5, fontSize: 13, color: MUTED, valign: 'middle', fontFace: SANS });
      s.addText(`נתח מהסך הכול: ${(lyShare * 100).toFixed(1)}% → ${(nowShare * 100).toFixed(1)}%`, he({ x: 3.8, y: y + 0.42, w: 5.0, h: 0.35, fontSize: 10.5, color: GOLD, valign: 'middle', fontFace: SANS }));
      s.addText(fmtPct(b.pct), { x: 10.3, y, w: 2.3, h: 0.8, fontSize: 26, bold: true, color: colorForPct(b.pct), align: 'right', valign: 'middle', fontFace: SERIF });
      s.addShape('line', { x: 0.7, y: y + 0.95, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
    });
    // ICE BDD — שורת השוואה אחת בלבד, נתונים גולמיים ללא סינון לפי לקוחות/שם סדרן.
    if (iceBddPct !== undefined) {
      const y = 2.0 + byCompany.length * 1.15 + 0.25;
      s.addText(`להשוואה — ICE BDD (ערוץ OneSales, ללא סדרן): ${fmtILS(iceBdd.lastYear)} → ${fmtILS(iceBdd.now)} (${fmtPct(iceBddPct)})`, he({
        x: 0.7, y, w: 11.9, h: 0.4, fontSize: 10.5, color: MUTED, fontFace: SANS, italic: true,
      }));
    }
  }

  // ---------- Divider: departments & sadran ----------
  divider('פילוח 2', 'מחלקות וסדרנים', 'איפה בדיוק חיה הצמיחה, ואיפה — הנפילה');

  // ---------- Slide — department chart ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'מחלקה', 'עלייה / ירידה לפי מחלקות');
    const chartData = [{ name: '% שינוי', labels: byDept.map(b => b.key), values: byDept.map(b => Math.round((b.pct || 0) * 1000) / 10) }];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.6, y: 1.9, w: 12.1, h: 5.1, barDir: 'bar',
      chartColors: byDept.map(b => colorForPct(b.pct)),
      valAxisTitle: '% שינוי', showValAxisTitle: true,
      showLegend: false, showTitle: false,
      dataLabelColor: INK_TEXT, showValue: true, dataLabelFormatCode: '+0"%";-0"%"',
      catAxisLabelFontSize: 12, valAxisLabelFontSize: 10,
      catAxisLabelColor: INK_TEXT, valAxisLabelColor: MUTED,
      plotArea: { border: { type: 'none' } },
      catGridLine: { style: 'none' }, valGridLine: { color: PAPER_LINE, style: 'solid', size: 0.5 },
      ...barChartSolid,
      valAxisCrossesAt: 'min',
    });
  }

  // ---------- Slides — אבחון חנויות: איפה בדיוק ההפסדים בטופ החנויות היורדות ----------
  // סטטיסטיקת סדרנים (גרף/טבלה לפי סדרן) הוסרה כליל (בקשת המשתמש 2026-08-12: "לא צריך
  // סטטיסטיקה לפי סדרן — דגש על אנליטיקת חנויות עם המלצות כמו לבדוק איפה ההפסדים ובאילו
  // קבוצות מוצר"). הסדרן נשאר רק כשורת קשר מתחת לשם החנות.
  function worstDeptForStore(custno, company) {
    const deptRows = rowsExBdd
      .filter(r => r.custno === custno && r.company === company && r.lastYear > 0)
      .map(r => ({ dept: r.dept, lastYear: r.lastYear, now: r.now, delta: r.now - r.lastYear, pct: pctChange(r.lastYear, r.now) }))
      .sort((a, b) => a.delta - b.delta);
    return deptRows[0] || null;
  }
  function recommendationForWorst(worst) {
    if (!worst) return '—';
    if (worst.now <= 0) return 'הקבוצה נעלמה — לבדוק מלאי ותצוגה';
    if (worst.pct !== null && worst.pct < -0.4) return 'ירידה חדה — לבדוק מלאי ותצוגה במדף';
    return 'לבדוק מלאי ותצוגת המוצר';
  }
  for (const company of ['FORMULA', 'INTER', 'ICE MISH']) {
    const list = topDeclineByCompany[company];
    if (!list || !list.length) continue;
    const s = pptx.addSlide();
    contentHeader(s, `אבחון חנויות · ${company}`, 'איפה ההפסדים — טופ החנויות היורדות');
    const header = ['חנות', 'קבוצה בעייתית', 'היה → עכשיו', '%', 'המלצה'].map(t => ({
      text: t, options: he({ bold: true, fill: { color: INK }, color: PAPER, fontSize: 10, fontFace: SANS }),
    }));
    const body = list.map(c => {
      const worst = worstDeptForStore(c.custno, company);
      return [
        { text: `${c.custname || ''}\n${c.sadran || ''}`, options: he({ fontSize: 9.5, color: INK_TEXT, fontFace: SANS }) },
        { text: worst ? worst.dept : '—', options: he({ fontSize: 9.5, color: INK_TEXT, fontFace: SANS }) },
        { text: worst ? `${fmtILS(worst.lastYear)} → ${fmtILS(worst.now)}` : '', options: { fontSize: 9, color: MUTED, fontFace: SANS, align: 'right' } },
        { text: worst ? fmtPct(worst.pct) : '', options: { fontSize: 9.5, bold: true, color: colorForPct(worst ? worst.pct : null), fontFace: SANS, align: 'right' } },
        { text: recommendationForWorst(worst), options: he({ fontSize: 8.5, color: INK_TEXT, fontFace: SANS }) },
      ];
    });
    s.addTable([header, ...body], {
      x: 0.7, y: 1.85, w: 11.9, h: 4.9,
      colW: [2.8, 2.0, 2.2, 1.1, 3.8],
      border: { type: 'solid', color: PAPER_LINE, pt: 0.5 },
      autoPage: false,
    });
    s.addText('קבוצה בעייתית — מחלקה עם הירידה הגדולה ביותר בנקודה הזו (רק בין קבוצות עם היסטוריה משנה קודמת). החנות יכולה לצמוח בסך הכול אך לרדת בקבוצה אחת.', he({
      x: 0.7, y: 6.9, w: 11.9, h: 0.4, fontSize: 9.5, color: MUTED, fontFace: SANS, italic: true,
    }));
  }

  // ---------- Slide — customer type chart ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'סוג לקוח', 'עלייה / ירידה לפי רשתות (טופ-10 לפי מחזור)');
    const chartData = [{ name: '% שינוי', labels: byCustType.map(b => b.key), values: byCustType.map(b => Math.round((b.pct || 0) * 1000) / 10) }];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.6, y: 1.9, w: 12.1, h: 5.1, barDir: 'bar',
      chartColors: byCustType.map(b => colorForPct(b.pct)),
      valAxisTitle: '% שינוי', showValAxisTitle: true,
      showLegend: false, showTitle: false,
      dataLabelColor: INK_TEXT, showValue: true, dataLabelFormatCode: '+0"%";-0"%"',
      catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
      catAxisLabelColor: INK_TEXT, valAxisLabelColor: MUTED,
      plotArea: { border: { type: 'none' } },
      catGridLine: { style: 'none' }, valGridLine: { color: PAPER_LINE, style: 'solid', size: 0.5 },
      ...barChartSolid,
      valAxisCrossesAt: 'min',
    });
  }

  // ---------- Разделы: FORMULA и ICE MISH ----------
  for (const [company, deep] of [['FORMULA', deepDiveFORMULA], ['ICE MISH', deepDiveICEMISH]]) {
    divider('פילוח 2.5', `${company} בנפרד`, 'ללא שאר החברות — פילוח מבודד');

    if (deep.byDept.length > 1) {
      const s = pptx.addSlide();
      contentHeader(s, `מחלקה · ${company}`, 'עלייה / ירידה לפי מחלקות');
      const chartData = [{ name: '% שינוי', labels: deep.byDept.map(b => b.key), values: deep.byDept.map(b => Math.round((b.pct || 0) * 1000) / 10) }];
      s.addChart(pptx.ChartType.bar, chartData, {
        x: 0.6, y: 1.9, w: 12.1, h: 5.1, barDir: 'bar',
        chartColors: deep.byDept.map(b => colorForPct(b.pct)),
        valAxisTitle: '% שינוי', showValAxisTitle: true,
        showLegend: false, showTitle: false,
        dataLabelColor: INK_TEXT, showValue: true, dataLabelFormatCode: '+0"%";-0"%"',
        catAxisLabelFontSize: 12, valAxisLabelFontSize: 10,
        catAxisLabelColor: INK_TEXT, valAxisLabelColor: MUTED,
        plotArea: { border: { type: 'none' } },
        catGridLine: { style: 'none' }, valGridLine: { color: PAPER_LINE, style: 'solid', size: 0.5 },
        ...barChartSolid,
        valAxisCrossesAt: 'min',
      });
    }

    {
      const s = pptx.addSlide();
      contentHeader(s, `סוג לקוח · ${company}`, 'עלייה / ירידה לפי סוג לקוח');
      const chartData = [{ name: '% שינוי', labels: deep.byCustType.map(b => b.key), values: deep.byCustType.map(b => Math.round((b.pct || 0) * 1000) / 10) }];
      s.addChart(pptx.ChartType.bar, chartData, {
        x: 0.6, y: 1.9, w: 12.1, h: 5.1, barDir: 'bar',
        chartColors: deep.byCustType.map(b => colorForPct(b.pct)),
        valAxisTitle: '% שינוי', showValAxisTitle: true,
        showLegend: false, showTitle: false,
        dataLabelColor: INK_TEXT, showValue: true, dataLabelFormatCode: '+0"%";-0"%"',
        catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
        catAxisLabelColor: INK_TEXT, valAxisLabelColor: MUTED,
        plotArea: { border: { type: 'none' } },
        catGridLine: { style: 'none' }, valGridLine: { color: PAPER_LINE, style: 'solid', size: 0.5 },
        ...barChartSolid,
        valAxisCrossesAt: 'min',
      });
      s.addText(`רק ${company}. טופ-8 סוגים לפי מחזור.`, he({
        x: 0.7, y: 7.05, w: 11.9, h: 0.3, fontSize: 9.5, color: MUTED, fontFace: SANS, italic: true,
      }));
    }

    for (const ct of deep.byCustType) {
      const list = deep.custTypeTopMovers[ct.key];
      if (!list.length) continue;
      const s = pptx.addSlide();
      contentHeader(s, `סוג לקוח: ${ct.key} · ${company}`, 'טופ-10 סטיות');
      let ty = 1.9;
      const cols = [0.6, 5.3, 7.3, 9.3, 11.1];
      ['לקוח', 'סדרן', 'קודם → נוכחי', '%'].forEach((h, i) => {
        s.addText(h, he({ x: cols[i], y: ty, w: cols[i + 1] - cols[i], h: 0.3, fontSize: 10, bold: true, color: GOLD, fontFace: SANS }));
      });
      s.addShape('line', { x: 0.6, y: ty + 0.32, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
      ty += 0.42;
      list.forEach(c => {
        s.addText(String(c.custname || '').slice(0, 45), he({ x: cols[0], y: ty, w: cols[1] - cols[0], h: 0.32, fontSize: 9.5, color: INK_TEXT, fontFace: SANS }));
        s.addText(c.sadran || '', he({ x: cols[1], y: ty, w: cols[2] - cols[1], h: 0.32, fontSize: 9.5, color: INK_TEXT, fontFace: SANS }));
        s.addText(`${fmtILS(c.lastYear)} → ${fmtILS(c.now)}`, { x: cols[2], y: ty, w: cols[3] - cols[2], h: 0.32, fontSize: 9.5, color: MUTED, fontFace: SANS });
        s.addText(fmtPct(c.pct), { x: cols[3], y: ty, w: 12.5 - cols[3], h: 0.32, fontSize: 10, bold: true, color: colorForPct(c.pct), fontFace: SANS });
        s.addShape('line', { x: 0.6, y: ty + 0.34, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 0.75 } });
        ty += 0.42;
      });
      s.addText('מדורג לפי |Δ ב-₪| (לא לפי %) — גם לקוחות חדשים (% "לא זמין") יכולים להיות התזוזה הגדולה ביותר.', he({
        x: 0.7, y: 7.05, w: 11.9, h: 0.3, fontSize: 9.5, color: MUTED, fontFace: SANS, italic: true,
      }));
    }
  }

  // ---------- Divider: insights ----------
  divider('פילוח 3', 'מה בולט בנתונים', 'דפוסים שמתחבאים מאחורי המספרים הממוצעים');

  // ---------- Slides — наблюдения по FORMULA / ICE MISH ----------
  function buildCompanyInsights(company, data) {
    const items = [];
    const paretoPct = data.pareto.totalCount ? (data.pareto.paretoCount / data.pareto.totalCount * 100).toFixed(0) : '0';
    items.push({ k: 'ריכוזיות', t: `${data.pareto.paretoCount} לקוחות (${paretoPct}% מהבסיס) מייצרים 70% מהמחזור — מתוכם ${data.pareto.flagCount} כבר יורדים ב->=30% במחלקה בודדת, גם אם התוצאה הכוללת שלהם חיובית.`, c: GOLD });
    if (data.deptStats.length > 1) {
      const best = data.deptStats[0], worst = data.deptStats[data.deptStats.length - 1];
      const worstLabel = worst.delta < 0 ? 'הגרוע ביותר' : 'הצמיחה הקטנה ביותר';
      items.push({ k: 'מחלקה', t: `הטוב ביותר — ${best.key} (${fmtPct(best.pct)}, ${signedILS(best.delta)}), ${worstLabel} — ${worst.key} (${fmtPct(worst.pct)}, ${signedILS(worst.delta)}).`, c: worst.delta < 0 ? CLAY : SAGE });
    }
    if (data.custTypeStats.length > 1) {
      const best = data.custTypeStats[0], worst = data.custTypeStats[data.custTypeStats.length - 1];
      const worstLabel = worst.delta < 0 ? 'הגרוע ביותר' : 'הצמיחה הקטנה ביותר';
      items.push({ k: 'סוג לקוח', t: `הטוב ביותר — ${best.key} (${fmtPct(best.pct)}, ${signedILS(best.delta)}), ${worstLabel} — ${worst.key} (${fmtPct(worst.pct)}, ${signedILS(worst.delta)}).`, c: worst.delta < 0 ? CLAY : SAGE });
    }
    if (data.topCustomer) {
      const c = data.topCustomer;
      const pctLabel = c.lastYear > 0 ? fmtPct(c.pct) : 'לקוח חדש';
      items.push({ k: 'לקוח', t: `התזוזה הגדולה ביותר: ${c.custname} (סדרן ${c.sadran}) — ${fmtILS(c.lastYear)} → ${fmtILS(c.now)} (${pctLabel}).`, c: c.delta >= 0 ? SAGE : CLAY });
    }
    return items;
  }
  for (const [company, data] of [['FORMULA', insightsFORMULA], ['ICE MISH', insightsICEMISH]]) {
    const s = pptx.addSlide();
    contentHeader(s, `תובנות · ${company}`, 'מסקנות והמלצות');
    const items = buildCompanyInsights(company, data);
    let y = 2.0;
    items.forEach(item => {
      s.addText(item.k, he({ x: 0.7, y, w: 2.6, h: 1.1, fontSize: 15, bold: true, color: item.c, fontFace: SANS, valign: 'top' }));
      s.addText(item.t, he({ x: 3.5, y, w: 9.1, h: 1.1, fontSize: 14, color: INK_TEXT, fontFace: SERIF, valign: 'top', wrap: true }));
      y += 1.25;
    });
  }

  // ---------- Slide — top movers ----------
  function moversSlide(kicker, title, list, color, isNew, showAgent) {
    const s = pptx.addSlide();
    contentHeader(s, kicker, title);
    let y = 2.0;
    const rowH = showAgent ? 0.72 : 0.58;
    list.forEach(c => {
      s.addText(c.custname || '', he({ x: 0.7, y, w: 8.3, h: 0.4, fontSize: 13, color: INK_TEXT, fontFace: SANS, valign: 'bottom' }));
      if (showAgent) {
        s.addText(`סוכן: ${c.sochen || ''}`, he({ x: 0.7, y: y + 0.38, w: 8.3, h: 0.28, fontSize: 9.5, color: MUTED, fontFace: SANS, valign: 'top' }));
      }
      s.addText(`${fmtILS(c.lastYear)} → ${fmtILS(c.now)}`, { x: 9.1, y, w: 2.3, h: 0.55, fontSize: 10.5, color: MUTED, fontFace: SANS, valign: 'middle' });
      s.addText(isNew ? 'חדש' : fmtPct(c.pct), { x: 11.5, y, w: 1.1, h: 0.55, fontSize: 13, bold: true, color, align: 'right', fontFace: SANS, valign: 'middle' });
      s.addShape('line', { x: 0.7, y: y + rowH - 0.08, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
      y += rowH;
    });
    if (isNew) {
      s.addText('לקוחות ללא היסטוריה משנה קודמת — % לא מוגדר (צמיחה מאפס). לא נכללים בטופ הצמיחה של same-store.', he({
        x: 0.7, y: 6.9, w: 11.9, h: 0.35, fontSize: 9.5, color: MUTED, fontFace: SANS, italic: true,
      }));
    }
  }
  for (const company of ['FORMULA', 'INTER', 'ICE MISH']) {
    if (topGrowthByCompany[company].length) moversSlide('לקוחות', `טופ צמיחה · ${company}`, topGrowthByCompany[company], SAGE);
    if (topDeclineByCompany[company].length) moversSlide('לקוחות', `טופ ירידה · ${company}`, topDeclineByCompany[company], CLAY, false, true);
  }
  if (topNewCustomers.length) moversSlide('לקוחות', 'טופ לקוחות חדשים', topNewCustomers, GOLD, true);

  // ---------- Divider: מועמדים לבחינה מחדש ----------
  divider('פילוח 3', 'מועמדים לבחינה מחדש', 'נקודות עם מחזור מכירות נמוך ביותר — כדאיות הסדרן');

  // ---------- Slide — מחזור נמוך: מועמדים להסרת סדרן ----------
  if (lowValueCandidates.length) {
    const s = pptx.addSlide();
    contentHeader(s, 'תמונה כללית', 'מועמדים לבחינת כדאיות הסדרן');
    const SHOW = 10;
    const shown = lowValueCandidates.slice(0, SHOW);
    const rest = lowValueCandidates.slice(SHOW);
    const header = ['לקוח', 'עיר', 'סדרן', 'היה', 'עכשיו'].map(t => ({
      text: t, options: { bold: true, fill: { color: INK }, color: PAPER, fontSize: 10.5, fontFace: SANS },
    }));
    const body = shown.map(c => ([
      { text: c.custname || '', options: { fontSize: 10.5, color: INK_TEXT, fontFace: SANS, rtlMode: true, lang: 'he-IL' } },
      { text: c.city || '', options: { fontSize: 10, color: MUTED, fontFace: SANS, rtlMode: true, lang: 'he-IL' } },
      { text: c.sadran || '', options: { fontSize: 10, color: MUTED, fontFace: SANS, rtlMode: true, lang: 'he-IL' } },
      { text: fmtILS(c.lastYear), options: { fontSize: 10, color: MUTED, fontFace: SANS, align: 'right' } },
      { text: fmtILS(c.now), options: { fontSize: 10.5, bold: true, color: CLAY, fontFace: SANS, align: 'right' } },
    ]));
    s.addTable([header, ...body], {
      x: 0.7, y: 1.85, w: 11.9, h: 4.9,
      colW: [4.3, 2.3, 2.5, 1.4, 1.4],
      border: { type: 'solid', color: PAPER_LINE, pt: 0.5 },
      autoPage: false,
    });
    const bottomSum = shown.reduce((s2, c) => s2 + c.now, 0);
    const restSum = rest.reduce((s2, c) => s2 + c.now, 0);
    s.addText(`${SHOW} הנקודות האלה נותנות ${(bottomSum / grandNowAll * 100).toFixed(2)}% מהסך הכולל. עוד ${rest.length} נקודות קטנות יותר על ${fmtILS(restSum)} — רשימה מלאה ב-SADRAN_ANALYSIS.xlsx.`, he({
      x: 0.7, y: 6.9, w: 11.9, h: 0.4, fontSize: 10, color: MUTED, fontFace: SANS, italic: true,
    }));
  }

  // ---------- Closing ----------
  {
    const s = pptx.addSlide();
    s.background = { color: INK };
    s.addText('תודה', he({ x: 2.43, y: 3.0, w: 10, h: 1.2, fontSize: 44, color: PAPER, fontFace: SERIF, align: 'right' }));
    s.addShape('line', { x: 10.18, y: 4.1, w: 2.2, h: 0, line: { color: GOLD, width: 2 } });
    s.addText('הנתונים המלאים — בקובץ SADRAN_ANALYSIS.xlsx', he({ x: 4.43, y: 4.35, w: 8, h: 0.5, fontSize: 13, color: 'B8B2A6', fontFace: SANS, align: 'right' }));
  }

  pptx.writeFile({ fileName: OUT }).then(() => {
    console.log('PPTX saved:', OUT);
  }).catch(err => {
    console.error('PPTX write failed:', err.message);
    process.exit(1);
  });
}

main();
