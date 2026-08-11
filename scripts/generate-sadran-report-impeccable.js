// SADRAN report — IMPECCABLE вариант: та же данные, что и generate-sadran-report.js,
// другой визуальный язык (см. .claude/skills/impeccable — shared design laws).
//
// Сцена: директор показывает результаты команде на планёрке днём в офисе, слайды может
// печатать/проецировать — нужна ясность данных, но с редакторской уверенностью, не "SaaS-дефолт".
//
// Color strategy: Committed — один плотный чернильный цвет несёт реальный вес на секционных
// слайдах, тёплый off-white на содержательных, один сдержанный акцент (охра) для выделений.
// Рост/падение — не дефолтный зелёный/серый, а приглушённый шалфей / глина.
const path = require('path');
const pptxgenjs = require('pptxgenjs');
const { loadRows, loadIceBddBenchmark, pctChange, aggBy, fmtILS, fmtPct, DEPT_COMPANY, getNewCustomerSet } = require('./sadran-data');

// SADRAN_OUTPUT_DIR — задан на VPS (cron), не задан локально на Windows (дефолт — Desktop).
const OUT = process.env.SADRAN_OUTPUT_DIR
  ? path.join(process.env.SADRAN_OUTPUT_DIR, 'SADRAN_REPORT_IMPECCABLE.pptx')
  : 'C:\\Users\\d.sverdlik\\Desktop\\SADRAN_REPORT_IMPECCABLE.pptx';

// --- palette (OKLCH-informed, tinted neutrals — не чистый #000/#fff) ---
const INK = '1B2430';        // глубокий чернильный (не чёрный) — секционные слайды
const PAPER = 'FAF7F2';      // тёплый off-white — фон содержательных слайдов
const PAPER_LINE = 'D9CFBF'; // линия на PAPER — чуть плотнее исходной (E4DDD1 сливалась с фоном)
const INK_TEXT = '2A2620';   // текст на PAPER — тёплый почти-чёрный
const MUTED = '7A7264';      // второстепенный текст
const GOLD = 'B8863B';       // единственный акцент — приглушённая охра
const SAGE = '5B7A5E';       // рост — приглушённый шалфей, не SaaS-зелёный
const CLAY = 'B2603F';       // падение — тёплая глина, не тревожный красный
const FLAT = '9C9284';

const SERIF = 'Georgia';     // display — редакторский контраст
const SANS = 'Calibri';      // текст/данные

function colorForPct(p) {
  if (p === null) return FLAT;
  if (p > 0.02) return SAGE;
  if (p < -0.02) return CLAY;
  return FLAT;
}

// barChartSolid — общие настройки веса для всех горизонтальных bar-чартов: уже зазор между
// столбцами (толще сам столбец — выглядит как плотный блок, не тонкая полоска) + тонкая
// PAPER-обводка отделяет соседние столбцы друг от друга и от фона чётче, чем голая заливка.
const barChartSolid = {
  barGapWidthPct: 45,
  dataBorder: { pt: 1, color: PAPER },
};

function main() {
  const rows = loadRows();
  const totalLY = rows.reduce((s, r) => s + r.lastYear, 0);
  const totalNow = rows.reduce((s, r) => s + r.now, 0);
  const totalPct = pctChange(totalLY, totalNow);

  const byCompany = aggBy(rows, r => r.company);
  const iceBdd = loadIceBddBenchmark();
  const iceBddPct = iceBdd ? pctChange(iceBdd.lastYear, iceBdd.now) : undefined;
  const byDept = aggBy(rows, r => r.dept).sort((a, b) => {
    const ca = DEPT_COMPANY[a.key] || '', cb = DEPT_COMPANY[b.key] || '';
    if (ca !== cb) return ca.localeCompare(cb);
    return b.delta - a.delta;
  });
  // По сдаранам/клиентам — ИСКЛЮЧАЕМ ICE BDD (канал OneSales, сдараны его не ведут) и считаем
  // ТОЛЬКО same-store (like-for-like), иначе новый клиент искажает % роста (принято в
  // FMCG-дистрибуции). Новых клиентов сдаранам назначают, они их не приводят сами.
  const rowsExBdd = rows.filter(r => r.company !== 'ICE BDD');
  const newCustSet = getNewCustomerSet(rowsExBdd);
  const sameStoreRows = rowsExBdd.filter(r => !newCustSet.has(r.custno));
  const newCustRows = rowsExBdd.filter(r => newCustSet.has(r.custno));
  const bySadran = aggBy(sameStoreRows, r => r.sadran);
  const byKosher = aggBy(rows, r => r.kosher);
  const byCustType = aggBy(rows, r => r.custtype).filter(b => b.now > 20000 || b.lastYear > 20000).slice(0, 10);

  // --- Отдельные разрезы FORMULA и ICE MISH — КАЖДЫЙ САМ ПО СЕБЕ, не общий пул FORMULA+ICE MISH ---
  const custKeyFI = r => `${r.custno}|${r.custname}|${r.sadran}|${r.kosher}`;
  function buildCompanyDeepDive(company, minRevenue) {
    const companyRows = rowsExBdd.filter(r => r.company === company);
    const byDeptC = aggBy(companyRows, r => r.dept).sort((a, b) => b.delta - a.delta);
    const byCustTypeC = aggBy(companyRows, r => r.custtype)
      .filter(b => b.now > minRevenue || b.lastYear > minRevenue)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 8);
    // Топ-10 клиентов КАЖДОГО סוג לקוח по |Δ| в ₪ (не по %) — новые клиенты тоже участвуют,
    // их вклад в ₪ реален и может быть крупнейшим движением типа сети.
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
  // но может отличаться МЕЖДУ компаниями того же клиента — в кросс-компанийном custKey нельзя.
  const custKeySochen = r => `${r.custno}|${r.custname}|${r.sochen || ''}`;
  const byCustomer = aggBy(rowsExBdd, custKey).map(c => {
    const [custno, custname] = c.key.split('|');
    return { ...c, custno, custname };
  });
  // Топ роста/падения — ТОЛЬКО same-store (та же логика, что у сдаранов): у новых клиентов
  // % от нуля не определён ("н/д"), их нельзя ранжировать в одном списке с реальным %.
  const byCustomerSameStore = byCustomer.filter(c => !newCustSet.has(c.custno));
  const topGrowth = byCustomerSameStore.slice(0, 6);
  const topDecline = byCustomerSameStore.slice(-6).reverse();
  const topNewCustomers = byCustomer.filter(c => newCustSet.has(c.custno)).sort((a, b) => b.now - a.now).slice(0, 6);

  // Топ роста/падения клиентов — отдельно по חברה (клиенты разных компаний не сравнимы
  // напрямую в одном рейтинге).
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

  // --- Данные для по-компанийных "Наблюдений" (FORMULA / ICE MISH) — только реально
  // вычисленные значения, без хардкода конкретных имён/цифр. ---
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

  // --- Waterfall: разложение LY -> Now на 4 потока (считается по каждой строке product-level,
  // не по клиенту целиком — иначе клиент, выросший в одном מחלקה и упавший в другом, потеряется) ---
  let churnDelta = 0, newDelta = 0, growthDelta = 0, declineDelta = 0, otherDelta = 0;
  for (const r of rows) {
    const ly = r.lastYear, now = r.now, d = now - ly;
    if (ly > 0 && now <= 0) churnDelta += d;
    else if (ly <= 0 && now > 0) newDelta += d;
    else if (ly > 0 && now > ly) growthDelta += d;
    else if (ly > 0 && now > 0 && now <= ly) declineDelta += d;
    else otherDelta += d;
  }
  const churnAndOther = churnDelta + otherDelta; // сворачиваем незначительный "other" в отток
  // churnList — реальные строки за суммой "Отток" на waterfall: без этого бар ₪126K не имеет
  // имени и его нельзя объяснить руководству (пользователь явно попросил — 2026-08-11).
  // По клиент×מחלקה, не по клиенту целиком: клиент может уйти из ОДНОГО מחלקה, продолжая
  // покупать в других — это не потеря аккаунта целиком, но всё равно реальный отток строки.
  const churnList = rows.filter(r => r.lastYear > 0 && r.now <= 0)
    .map(r => ({ ...r, deptLabel: `${r.company} · ${r.dept}` }))
    .sort((a, b) => b.lastYear - a.lastYear);
  const wf = [
    { label: 'Прошлый\nпериод', base: 0, value: totalLY, kind: 'end' },
    { label: 'Новые\nклиенты', base: totalLY, value: newDelta, kind: 'pos' },
    { label: 'Рост\nбазы', base: totalLY + newDelta, value: growthDelta, kind: 'pos' },
    { label: 'Падение\nбазы', base: totalLY + newDelta + growthDelta + declineDelta, value: -declineDelta, kind: 'neg' },
    { label: 'Отток', base: totalLY + newDelta + growthDelta + declineDelta + churnAndOther, value: -churnAndOther, kind: 'neg' },
    { label: 'Текущий\nпериод', base: 0, value: totalNow, kind: 'end' },
  ];

  const pptx = new pptxgenjs();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';

  // ---------- Section divider helper ----------
  function divider(kicker, title, sub) {
    const s = pptx.addSlide();
    s.background = { color: INK };
    s.addText(kicker.toUpperCase(), {
      x: 0.9, y: 2.6, w: 11.5, h: 0.5, fontSize: 13, color: GOLD, charSpacing: 3,
      fontFace: SANS, bold: true,
    });
    s.addText(title, {
      x: 0.9, y: 3.1, w: 11.5, h: 2.0, fontSize: 44, color: PAPER, fontFace: SERIF, valign: 'top',
    });
    if (sub) {
      s.addText(sub, {
        x: 0.9, y: 4.9, w: 10.5, h: 0.8, fontSize: 15, color: 'B8B2A6', fontFace: SANS, valign: 'top',
      });
    }
    return s;
  }

  function contentHeader(s, kicker, title) {
    s.background = { color: PAPER };
    // Золотой якорь перед kicker — тот же уверенный акцент, что и на divider-слайдах
    // (там gold-линия под заголовком), иначе content-слайды визуально "легче" divider-слайдов.
    s.addShape('rect', { x: 0.7, y: 0.53, w: 0.09, h: 0.24, fill: { color: GOLD }, line: { type: 'none' } });
    const kickerOpts = { x: 0.92, y: 0.5, w: 11.3, h: 0.35, fontSize: 11, color: GOLD, charSpacing: 2, bold: true, fontFace: SANS };
    // Kicker иногда смешивает иврит с латинским разделителем ("סדרן x מחלקה") — без явного
    // rtl+lang PowerPoint путает порядок слов вокруг нейтрального символа.
    if (/[֐-׿]/.test(kicker)) { kickerOpts.rtlMode = true; kickerOpts.lang = 'he-IL'; }
    s.addText(kicker.toUpperCase(), kickerOpts);
    s.addText(title, {
      x: 0.7, y: 0.82, w: 11.5, h: 0.7, fontSize: 26, color: INK_TEXT, fontFace: SERIF,
    });
    s.addShape('line', { x: 0.7, y: 1.55, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
  }

  // ---------- Slide 1 — title ----------
  {
    const s = pptx.addSlide();
    s.background = { color: INK };
    s.addText('SADRAN', {
      x: 0.9, y: 2.3, w: 11.5, h: 1.3, fontSize: 64, color: PAPER, fontFace: SERIF, bold: false,
    });
    s.addShape('line', { x: 0.95, y: 3.55, w: 2.2, h: 0, line: { color: GOLD, width: 2 } });
    s.addText('Рост и падение продаж по мерчендайзерам, департаментам и рынкам', {
      x: 0.9, y: 3.75, w: 10, h: 0.6, fontSize: 16, color: 'C7C1B4', fontFace: SANS,
    });
    s.addText(`Сформировано автоматически аналитическим агентом  ·  ${new Date().toLocaleDateString('ru-RU')}`, {
      x: 0.9, y: 6.8, w: 10, h: 0.4, fontSize: 10.5, color: '746E62', fontFace: SANS,
    });
  }

  // ---------- Slide 2 — waterfall: из чего на самом деле складывается +15.8% ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'Общая картина', `Из чего складывается ${fmtPct(totalPct)}`);
    // pptxgenjs красит stacked-серии целиком, не по точкам — поэтому вместо одной серии
    // "значение" с разным цветом на разные бары делаем 4 серии (база + pos + neg + end),
    // в каждой из которых не-ноль стоит только там, где нужен именно этот цвет.
    const chartData = [
      { name: 'база', labels: wf.map(w => w.label), values: wf.map(w => Math.round(w.base)) },
      { name: 'рост', labels: wf.map(w => w.label), values: wf.map(w => w.kind === 'pos' ? Math.round(w.value) : 0) },
      { name: 'падение', labels: wf.map(w => w.label), values: wf.map(w => w.kind === 'neg' ? Math.round(w.value) : 0) },
      { name: 'итог', labels: wf.map(w => w.label), values: wf.map(w => w.kind === 'end' ? Math.round(w.value) : 0) },
    ];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.6, y: 1.85, w: 12.1, h: 4.7, barDir: 'col', barGrouping: 'stacked',
      chartColors: [PAPER, SAGE, CLAY, INK], // первая серия (база) — сливается с фоном
      showLegend: false, showTitle: false,
      showValue: false,
      catAxisLabelFontSize: 11.5, catAxisLabelColor: INK_TEXT,
      valAxisHidden: true,
      plotArea: { border: { type: 'none' } },
      catGridLine: { style: 'none' }, valGridLine: { style: 'none' },
      border: { type: 'none' },
      ...barChartSolid,
    });
    // подписи значений над столбцами (свои, а не встроенные — чтобы не подписывать невидимую базу
    // и явно показать знак: падение/отток — это МИНУС, даже если хранится как положительная величина)
    wf.forEach((w, i) => {
      const xPos = 0.6 + (i + 0.5) * (12.1 / wf.length);
      const signed = w.kind === 'pos' ? w.value : w.kind === 'neg' ? -w.value : w.value;
      const label = w.kind === 'end' ? fmtILS(signed) : (signed >= 0 ? '+' : '−') + fmtILS(Math.abs(signed));
      s.addText(label, {
        x: xPos - 0.85, y: 6.55, w: 1.7, h: 0.35, fontSize: 11.5, bold: true, align: 'center',
        color: w.kind === 'end' ? INK_TEXT : (w.kind === 'pos' ? SAGE : CLAY), fontFace: SANS,
      });
    });
    s.addText('Валовые потоки (рост + новые) в разы больше падения и оттока — чистый итог прячет намного более динамичную картину под собой.', {
      x: 0.7, y: 6.95, w: 11.9, h: 0.4, fontSize: 11, color: MUTED, fontFace: SANS, italic: true,
    });
  }

  // ---------- Slide 2.5 — Отток: кто именно ушёл ----------
  // Бар "Отток" на waterfall без имён нельзя объяснить руководству (явный запрос пользователя,
  // 2026-08-11) — показываем крупнейшие строки поимённо, остальное — сумма + ссылка на Excel.
  if (churnList.length) {
    const s = pptx.addSlide();
    contentHeader(s, 'Общая картина', 'Отток — кто именно ушёл');
    const SHOW = 8;
    const shown = churnList.slice(0, SHOW);
    const rest = churnList.slice(SHOW);
    let y = 1.85;
    shown.forEach(c => {
      s.addText(c.custname || '', { x: 0.7, y, w: 8.3, h: 0.32, fontSize: 12.5, color: INK_TEXT, fontFace: SANS, valign: 'bottom', rtlMode: true, lang: 'he-IL' });
      s.addText(`${c.deptLabel} · сдаран ${c.sadran || ''} · агент ${c.sochen || ''}`, { x: 0.7, y: y + 0.3, w: 8.3, h: 0.26, fontSize: 9.5, color: MUTED, fontFace: SANS, valign: 'top', rtlMode: true, lang: 'he-IL' });
      s.addText(`было ${fmtILS(c.lastYear)}`, { x: 9.4, y, w: 3.2, h: 0.55, fontSize: 12, bold: true, color: CLAY, align: 'right', fontFace: SANS, valign: 'middle' });
      s.addShape('line', { x: 0.7, y: y + 0.54, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
      y += 0.58;
    });
    if (rest.length) {
      const restSum = rest.reduce((s2, c) => s2 + c.lastYear, 0);
      s.addText(`Ещё ${rest.length} строк оттока на ${fmtILS(restSum)} (мельче, каждая < ${fmtILS(shown[shown.length - 1].lastYear)}) — полный список в SADRAN_ANALYSIS.xlsx.`, {
        x: 0.7, y, w: 11.9, h: 0.4, fontSize: 10, color: MUTED, fontFace: SANS, italic: true,
      });
    }
  }

  // ---------- Slide 3 — Same-Store editorial ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'Органический рост', 'Same-store против новых клиентов');
    s.addText(fmtPct(samePct), {
      x: 0.7, y: 2.0, w: 5, h: 1.2, fontSize: 58, bold: true, color: colorForPct(samePct), fontFace: SERIF,
    });
    s.addText(`Same-store: ${sameStoreCustomers.length} клиентов с историей 2025 · ${fmtILS(sameLY)} → ${fmtILS(sameNow)}`, {
      x: 0.7, y: 3.15, w: 8, h: 0.5, fontSize: 13, color: MUTED, fontFace: SANS,
    });
    s.addShape('line', { x: 0.7, y: 3.85, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
    const newShare = totalNow ? (newCustomers.reduce((s2, v) => s2 + v.now, 0) / totalNow * 100) : 0;
    s.addText(`Новые клиенты дают лишь ${newShare.toFixed(1)}% текущей выручки (${newCustomers.length} клиентов). Рост держится на существующей базе, не на открытии новых точек — same-store почти точно повторяет общий итог.`, {
      x: 0.7, y: 4.1, w: 10.5, h: 1.4, fontSize: 15, color: INK_TEXT, fontFace: SERIF, italic: true, valign: 'top',
    });
  }

  // ---------- Divider: by company ----------
  divider('Разрез 1', 'По компаниям', 'INTER · FORMULA · ICE MISH');

  // ---------- Slide — company rows ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'חברה', 'Рост / падение по компаниям');
    byCompany.forEach((b, i) => {
      const y = 2.0 + i * 1.15;
      const lyShare = totalLY ? b.lastYear / totalLY : 0;
      const nowShare = totalNow ? b.now / totalNow : 0;
      s.addText(b.key, { x: 0.7, y, w: 3.0, h: 0.8, fontSize: 22, bold: true, color: INK_TEXT, fontFace: SERIF, valign: 'middle' });
      s.addText(`${fmtILS(b.lastYear)}  →  ${fmtILS(b.now)}`, { x: 3.8, y, w: 5.0, h: 0.5, fontSize: 13, color: MUTED, valign: 'middle', fontFace: SANS });
      s.addText(`доля в total: ${(lyShare * 100).toFixed(1)}% → ${(nowShare * 100).toFixed(1)}%`, { x: 3.8, y: y + 0.42, w: 5.0, h: 0.35, fontSize: 10.5, color: GOLD, valign: 'middle', fontFace: SANS });
      s.addText(fmtPct(b.pct), { x: 10.3, y, w: 2.3, h: 0.8, fontSize: 26, bold: true, color: colorForPct(b.pct), align: 'right', valign: 'middle', fontFace: SERIF });
      s.addShape('line', { x: 0.7, y: y + 0.95, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
    });
    // ICE BDD — ОДНА референсная строка, сырые цифры без фильтра по клиентам/שם סדרן (не входит
    // в byCompany выше и нигде больше в отчёте не используется). Канал OneSales — сдараны его
    // не ведут, поэтому его динамика — естественный контроль "как растёт направление без
    // участия сдарана" (запрос пользователя 2026-08-11).
    if (iceBddPct !== undefined) {
      const y = 2.0 + byCompany.length * 1.15 + 0.25;
      s.addText(`Для сравнения — ICE BDD (канал OneSales, без участия сдарана): ${fmtILS(iceBdd.lastYear)} → ${fmtILS(iceBdd.now)} (${fmtPct(iceBddPct)})`, {
        x: 0.7, y, w: 11.9, h: 0.4, fontSize: 10.5, color: MUTED, fontFace: SANS, italic: true,
      });
    }
  }

  // ---------- Divider: departments & sadran ----------
  divider('Разрез 2', 'Департаменты и мерчендайзеры', 'Где именно живёт рост, а где — просадка');

  // ---------- Slide — department chart ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'מחלקה', 'Рост / падение по департаментам');
    const chartData = [{ name: '% изменение', labels: byDept.map(b => b.key), values: byDept.map(b => Math.round((b.pct || 0) * 1000) / 10) }];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.6, y: 1.9, w: 12.1, h: 5.1, barDir: 'bar',
      chartColors: byDept.map(b => colorForPct(b.pct)),
      valAxisTitle: '% изменение', showValAxisTitle: true,
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

  // ---------- Slide — sadran chart ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'סדרן', 'Рост / падение по мерчендайзерам');
    const chartData = [{ name: '% изменение', labels: bySadran.map(b => b.key), values: bySadran.map(b => Math.round((b.pct || 0) * 1000) / 10) }];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.6, y: 1.9, w: 12.1, h: 5.1, barDir: 'bar',
      chartColors: bySadran.map(b => colorForPct(b.pct)),
      valAxisTitle: '% изменение', showValAxisTitle: true,
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

  // ---------- Slides — Сдаран x חברה, same-store — без разбивки по מחלקה (лишняя детализация) ----------
  {
    ['FORMULA', 'INTER', 'ICE MISH'].forEach(company => {
      const companySameStore = sameStoreRows.filter(r => r.company === company);
      const companyNew = newCustRows.filter(r => r.company === company);
      const newBySadranC = new Map(aggBy(companyNew, r => r.sadran).map(b => [b.key, b.now]));
      const sadranMovers = aggBy(companySameStore, r => r.sadran)
        .sort((a, b) => b.delta - a.delta)
        .map(b => ({ ...b, sadran: b.key, newVal: newBySadranC.get(b.key) || 0 }));
      if (!sadranMovers.length) return;
      const s = pptx.addSlide();
      contentHeader(s, `סדרן x חברה · ${company}`, `Сдаран x חברה (same-store) — ${company}`);
      let ty = 1.9;
      // заголовок таблицы вручную (редакторский стиль — тонкая линия, не заливка)
      const cols = [0.6, 4.6, 7.6, 9.7, 11.1];
      ['Сдаран', 'Прошлый → Текущий', '%', '+ Новые'].forEach((h, i) => {
        s.addText(h, { x: cols[i], y: ty, w: (cols[i + 1] || 12.5) - cols[i], h: 0.3, fontSize: 10, bold: true, color: GOLD, fontFace: SANS });
      });
      s.addShape('line', { x: 0.6, y: ty + 0.32, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
      ty += 0.42;
      sadranMovers.forEach(b => {
        s.addText(b.sadran, { x: cols[0], y: ty, w: cols[1] - cols[0], h: 0.32, fontSize: 10, color: INK_TEXT, fontFace: SANS, rtlMode: true, lang: 'he-IL' });
        s.addText(`${fmtILS(b.lastYear)} → ${fmtILS(b.now)}`, { x: cols[1], y: ty, w: cols[2] - cols[1], h: 0.32, fontSize: 9.5, color: MUTED, fontFace: SANS });
        s.addText(fmtPct(b.pct), { x: cols[2], y: ty, w: cols[3] - cols[2], h: 0.32, fontSize: 10, bold: true, color: colorForPct(b.pct), fontFace: SANS });
        s.addText(b.newVal ? '+' + fmtILS(b.newVal) : '—', { x: cols[3], y: ty, w: 12.5 - cols[3], h: 0.32, fontSize: 9.5, color: GOLD, fontFace: SANS });
        s.addShape('line', { x: 0.6, y: ty + 0.34, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 0.75 } });
        ty += 0.4;
      });
      s.addText('% — только клиенты с историей прошлого года (same-store). Новые клиенты — отдельно, вне %.', {
        x: 0.7, y: 7.05, w: 11.9, h: 0.3, fontSize: 9.5, color: MUTED, fontFace: SANS, italic: true,
      });
    });
  }

  // ---------- Slide — customer type chart ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'סוג לקוח', 'Рост / падение по сетям (топ-10 по обороту)');
    const chartData = [{ name: '% изменение', labels: byCustType.map(b => b.key), values: byCustType.map(b => Math.round((b.pct || 0) * 1000) / 10) }];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.6, y: 1.9, w: 12.1, h: 5.1, barDir: 'bar',
      chartColors: byCustType.map(b => colorForPct(b.pct)),
      valAxisTitle: '% изменение', showValAxisTitle: true,
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

  // ---------- Разделы: FORMULA и ICE MISH — каждая компания полностью отдельно ----------
  for (const [company, deep] of [['FORMULA', deepDiveFORMULA], ['ICE MISH', deepDiveICEMISH]]) {
    divider('Разрез 2.5', `${company} отдельно`, 'Без остальных компаний — изолированный разрез');

    // Пропускаем מחלקה chart для компаний с одним департаментом (ICE MISH — только mish גלידה):
    // сравнивать не с чем, график из одного столбца бесполезен.
    if (deep.byDept.length > 1) {
      const s = pptx.addSlide();
      contentHeader(s, `מחלקה · ${company}`, 'Рост / падение по департаментам');
      const chartData = [{ name: '% изменение', labels: deep.byDept.map(b => b.key), values: deep.byDept.map(b => Math.round((b.pct || 0) * 1000) / 10) }];
      s.addChart(pptx.ChartType.bar, chartData, {
        x: 0.6, y: 1.9, w: 12.1, h: 5.1, barDir: 'bar',
        chartColors: deep.byDept.map(b => colorForPct(b.pct)),
        valAxisTitle: '% изменение', showValAxisTitle: true,
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

    // ---------- Slide — סוג לקוח chart ----------
    {
      const s = pptx.addSlide();
      contentHeader(s, `סוג לקוח · ${company}`, 'Рост / падение по типу клиента');
      const chartData = [{ name: '% изменение', labels: deep.byCustType.map(b => b.key), values: deep.byCustType.map(b => Math.round((b.pct || 0) * 1000) / 10) }];
      s.addChart(pptx.ChartType.bar, chartData, {
        x: 0.6, y: 1.9, w: 12.1, h: 5.1, barDir: 'bar',
        chartColors: deep.byCustType.map(b => colorForPct(b.pct)),
        valAxisTitle: '% изменение', showValAxisTitle: true,
        showLegend: false, showTitle: false,
        dataLabelColor: INK_TEXT, showValue: true, dataLabelFormatCode: '+0"%";-0"%"',
        catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
        catAxisLabelColor: INK_TEXT, valAxisLabelColor: MUTED,
        plotArea: { border: { type: 'none' } },
        catGridLine: { style: 'none' }, valGridLine: { color: PAPER_LINE, style: 'solid', size: 0.5 },
        ...barChartSolid,
        valAxisCrossesAt: 'min',
      });
      s.addText(`Только ${company}. Топ-8 типов по обороту.`, {
        x: 0.7, y: 7.05, w: 11.9, h: 0.3, fontSize: 9.5, color: MUTED, fontFace: SANS, italic: true,
      });
    }

    // ---------- Slides — топ-10 клиентов КАЖДОГО סוג לקוח по величине отклонения ----------
    for (const ct of deep.byCustType) {
      const list = deep.custTypeTopMovers[ct.key];
      if (!list.length) continue;
      const s = pptx.addSlide();
      contentHeader(s, `סוג לקוח: ${ct.key} · ${company}`, 'Топ-10 отклонений');
      let ty = 1.9;
      const cols = [0.6, 5.3, 7.3, 9.3, 11.1];
      ['Клиент', 'Сдаран', 'Прошлый → Текущий', '%'].forEach((h, i) => {
        s.addText(h, { x: cols[i], y: ty, w: cols[i + 1] - cols[i], h: 0.3, fontSize: 10, bold: true, color: GOLD, fontFace: SANS });
      });
      s.addShape('line', { x: 0.6, y: ty + 0.32, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
      ty += 0.42;
      list.forEach(c => {
        s.addText(String(c.custname || '').slice(0, 45), { x: cols[0], y: ty, w: cols[1] - cols[0], h: 0.32, fontSize: 9.5, color: INK_TEXT, fontFace: SANS, rtlMode: true, lang: 'he-IL' });
        s.addText(c.sadran || '', { x: cols[1], y: ty, w: cols[2] - cols[1], h: 0.32, fontSize: 9.5, color: INK_TEXT, fontFace: SANS, rtlMode: true, lang: 'he-IL' });
        s.addText(`${fmtILS(c.lastYear)} → ${fmtILS(c.now)}`, { x: cols[2], y: ty, w: cols[3] - cols[2], h: 0.32, fontSize: 9.5, color: MUTED, fontFace: SANS });
        s.addText(fmtPct(c.pct), { x: cols[3], y: ty, w: 12.5 - cols[3], h: 0.32, fontSize: 10, bold: true, color: colorForPct(c.pct), fontFace: SANS });
        s.addShape('line', { x: 0.6, y: ty + 0.34, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 0.75 } });
        ty += 0.42;
      });
      s.addText('Ранжировано по |Δ в ₪| (не по %) — новые клиенты (% "н/д") тоже могут быть крупнейшим движением.', {
        x: 0.7, y: 7.05, w: 11.9, h: 0.3, fontSize: 9.5, color: MUTED, fontFace: SANS, italic: true,
      });
    }
  }

  // ---------- Divider: insights ----------
  divider('Разрез 3', 'Что заметно в данных', 'Паттерны, которые прячутся за средними цифрами');

  // ---------- Slides — наблюдения по FORMULA / ICE MISH отдельно (editorial, no bullets-as-cards) ----------
  // Не общий кросс-компанийный слайд — INTER/ICE BDD сюда не попадают, они не сравнимы напрямую
  // с FORMULA/ICE MISH. Все цифры — из реально вычисленных deptStats/custTypeStats/topCustomer/pareto.
  function buildCompanyInsights(company, data) {
    const items = [];
    const paretoPct = data.pareto.totalCount ? (data.pareto.paretoCount / data.pareto.totalCount * 100).toFixed(0) : '0';
    items.push({ k: 'Концентрация', t: `${data.pareto.paretoCount} клиентов (${paretoPct}% базы) дают 70% выручки — из них ${data.pareto.flagCount} уже проседают >=30% в отдельном מחלקה, даже если их общий итог положительный.`, c: GOLD });
    if (data.deptStats.length > 1) {
      const best = data.deptStats[0], worst = data.deptStats[data.deptStats.length - 1];
      const worstLabel = worst.delta < 0 ? 'худший' : 'наименьший рост';
      items.push({ k: 'מחלקה', t: `Лучший — ${best.key} (${fmtPct(best.pct)}, ${signedILS(best.delta)}), ${worstLabel} — ${worst.key} (${fmtPct(worst.pct)}, ${signedILS(worst.delta)}).`, c: worst.delta < 0 ? CLAY : SAGE });
    }
    if (data.custTypeStats.length > 1) {
      const best = data.custTypeStats[0], worst = data.custTypeStats[data.custTypeStats.length - 1];
      const worstLabel = worst.delta < 0 ? 'худший' : 'наименьший рост';
      items.push({ k: 'סוג לקוח', t: `Лучший — ${best.key} (${fmtPct(best.pct)}, ${signedILS(best.delta)}), ${worstLabel} — ${worst.key} (${fmtPct(worst.pct)}, ${signedILS(worst.delta)}).`, c: worst.delta < 0 ? CLAY : SAGE });
    }
    if (data.topCustomer) {
      const c = data.topCustomer;
      const pctLabel = c.lastYear > 0 ? fmtPct(c.pct) : 'новый клиент';
      items.push({ k: 'Клиент', t: `Крупнейшее движение: ${c.custname} (сдаран ${c.sadran}) — ${fmtILS(c.lastYear)} → ${fmtILS(c.now)} (${pctLabel}).`, c: c.delta >= 0 ? SAGE : CLAY });
    }
    return items;
  }
  for (const [company, data] of [['FORMULA', insightsFORMULA], ['ICE MISH', insightsICEMISH]]) {
    const s = pptx.addSlide();
    contentHeader(s, `Наблюдения · ${company}`, 'Выводы и рекомендации');
    const items = buildCompanyInsights(company, data);
    let y = 2.0;
    items.forEach(item => {
      const kOpts = { x: 0.7, y, w: 2.6, h: 1.1, fontSize: 15, bold: true, color: item.c, fontFace: SANS, valign: 'top' };
      if (/[֐-׿]/.test(item.k)) { kOpts.rtlMode = true; kOpts.lang = 'he-IL'; }
      s.addText(item.k, kOpts);
      s.addText(item.t, { x: 3.5, y, w: 9.1, h: 1.1, fontSize: 14, color: INK_TEXT, fontFace: SERIF, valign: 'top', wrap: true });
      y += 1.25;
    });
  }

  // ---------- Slide — top movers (editorial table, minimal chrome) ----------
  function moversSlide(kicker, title, list, color, isNew, showAgent) {
    const s = pptx.addSlide();
    contentHeader(s, kicker, title);
    let y = 2.0;
    const rowH = showAgent ? 0.72 : 0.58;
    list.forEach(c => {
      s.addText(c.custname || '', { x: 0.7, y, w: 8.3, h: 0.4, fontSize: 13, color: INK_TEXT, fontFace: SANS, valign: 'bottom', rtlMode: true, lang: 'he-IL' });
      if (showAgent) {
        s.addText(`Агент: ${c.sochen || ''}`, { x: 0.7, y: y + 0.38, w: 8.3, h: 0.28, fontSize: 9.5, color: MUTED, fontFace: SANS, valign: 'top', rtlMode: true, lang: 'he-IL' });
      }
      s.addText(`${fmtILS(c.lastYear)} → ${fmtILS(c.now)}`, { x: 9.1, y, w: 2.3, h: 0.55, fontSize: 10.5, color: MUTED, fontFace: SANS, valign: 'middle' });
      s.addText(isNew ? 'новый' : fmtPct(c.pct), { x: 11.5, y, w: 1.1, h: 0.55, fontSize: 13, bold: true, color, align: 'right', fontFace: SANS, valign: 'middle' });
      s.addShape('line', { x: 0.7, y: y + rowH - 0.08, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
      y += rowH;
    });
    if (isNew) {
      s.addText('Клиенты без истории прошлого года — % не определён (рост от нуля). Не входят в same-store топ роста.', {
        x: 0.7, y: 6.9, w: 11.9, h: 0.35, fontSize: 9.5, color: MUTED, fontFace: SANS, italic: true,
      });
    }
  }
  for (const company of ['FORMULA', 'INTER', 'ICE MISH']) {
    if (topGrowthByCompany[company].length) moversSlide('Клиенты', `Топ роста · ${company}`, topGrowthByCompany[company], SAGE);
    if (topDeclineByCompany[company].length) moversSlide('Клиенты', `Топ падения · ${company}`, topDeclineByCompany[company], CLAY, false, true);
  }
  if (topNewCustomers.length) moversSlide('Клиенты', 'Топ новых клиентов', topNewCustomers, GOLD, true);

  // ---------- Closing ----------
  {
    const s = pptx.addSlide();
    s.background = { color: INK };
    s.addText('Спасибо', { x: 0.9, y: 3.0, w: 10, h: 1.2, fontSize: 44, color: PAPER, fontFace: SERIF });
    s.addShape('line', { x: 0.95, y: 4.1, w: 2.2, h: 0, line: { color: GOLD, width: 2 } });
    s.addText('Полные данные — в SADRAN_ANALYSIS.xlsx', { x: 0.9, y: 4.35, w: 8, h: 0.5, fontSize: 13, color: 'B8B2A6', fontFace: SANS });
  }

  pptx.writeFile({ fileName: OUT }).then(() => {
    console.log('PPTX saved:', OUT);
  }).catch(err => {
    console.error('PPTX write failed:', err.message);
    process.exit(1);
  });
}

main();
