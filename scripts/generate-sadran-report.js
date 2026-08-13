// SADRAN report — рост/падение по мерчендайзерам, департаментам, кошерности
// Данные читаются через sadran-data.js: DAX-кэш от fetch-sadran-data.js (приоритет) или
// SADRAN.xlsx (резерв, ручной экспорт), см. project memory про восстановленный 2026-08-06
// data-pipeline (fetch-sadran-data.js читал ALL_PARTS + 'ADIFUT FOR DEILTA' напрямую).
const path = require('path');
const pptxgenjs = require('pptxgenjs');
const { loadRows, pctChange, aggBy, fmtILS, fmtPct, DEPT_COMPANY, getNewCustomerSet } = require('./sadran-data');

// SADRAN_OUTPUT_DIR — задан на VPS (cron), не задан локально на Windows (дефолт — Desktop).
const OUT = process.env.SADRAN_OUTPUT_DIR
  ? path.join(process.env.SADRAN_OUTPUT_DIR, 'SADRAN_REPORT.pptx')
  : 'C:\\Users\\d.sverdlik\\Desktop\\SADRAN_REPORT.pptx';

// --- brand ---
const NAVY = '1C3D6B', BLUE = '2E77B8', GREEN = '1A9E5C';
const DECLINE = '607080'; // NO RED rule
const FLAT = '8A9BA8';
const AMBER = 'E67E22'; // предупреждение / частичная аномалия
const WHITE = 'FFFFFF';

function colorForPct(p) {
  if (p === null) return FLAT;
  if (p > 0.02) return GREEN;
  if (p < -0.02) return DECLINE;
  return FLAT;
}

function main() {
  const rows = loadRows();
  const totalLY = rows.reduce((s, r) => s + r.lastYear, 0);
  const totalNow = rows.reduce((s, r) => s + r.now, 0);
  const totalPct = pctChange(totalLY, totalNow);

  const byCompany = aggBy(rows, r => r.company);
  // Метка графика — только название департамента (иврит), без смешения с латиницей компании:
  // PowerPoint BiDi-рендер ломает подписи, где в одной строке чередуются ивритский и латинский текст
  // (см. hebrew-bidi skill). Группировка по компании сохраняется через сортировку, не через текст метки.
  const byDept = aggBy(rows, r => r.dept).sort((a, b) => {
    const ca = DEPT_COMPANY[a.key] || '', cb = DEPT_COMPANY[b.key] || '';
    if (ca !== cb) return ca.localeCompare(cb);
    return b.delta - a.delta;
  });
  // По сдаранам/клиентам — ИСКЛЮЧАЕМ ICE BDD (канал OneSales, сдараны его не ведут — водитель
  // сам себе агент и мерч) и считаем ТОЛЬКО same-store (like-for-like), иначе новый клиент
  // искажает % роста (принято в FMCG-дистрибуции). Новых клиентов сдаранам назначают
  // (территория/канал), они их не приводят сами — смешивать с ростом своей базы некорректно.
  const rowsExBdd = rows.filter(r => r.company !== 'ICE BDD');
  const newCustSet = getNewCustomerSet(rowsExBdd);
  const byKosher = aggBy(rows, r => r.kosher);
  const byCustType = aggBy(rows, r => r.custtype).filter(b => b.now > 20000 || b.lastYear > 20000).slice(0, 12);

  // --- Отдельные разрезы FORMULA и ICE MISH — КАЖДЫЙ САМ ПО СЕБЕ, не общий пул FORMULA+ICE MISH
  // (ошибочно смешивал разные компании в одном топ-10 по типу клиента). מחלקה/סוג לקוח % —
  // по всем клиентам компании, а не только same-store: это агрегат, а не рейтинг сущностей.
  const custKeyFI = r => `${r.custno}|${r.custname}|${r.sadran}|${r.kosher}`;
  function buildCompanyDeepDive(company, minRevenue) {
    const companyRows = rowsExBdd.filter(r => r.company === company);
    const byDeptC = aggBy(companyRows, r => r.dept).sort((a, b) => b.delta - a.delta);
    const byCustTypeC = aggBy(companyRows, r => r.custtype)
      .filter(b => b.now > minRevenue || b.lastYear > minRevenue)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 8);
    // Топ-10 клиентов КАЖДОГО סוג לקוח по |Δ| — ранжируем по величине изменения в ₪, не по %,
    // поэтому новые клиенты (% не определён) тоже участвуют — их вклад в ₪ реален и может быть
    // крупнейшим движением типа сети.
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

  // Клиентские топы — тоже без ICE BDD (см. выше)
  const custKey = r => `${r.custno}|${r.custname}|${r.sadran}|${r.kosher}`;
  // custKeySochen — только для per-company топов (topGrowthByCompany/topDeclineByCompany):
  // שם סוכן стабилен для одной пары клиент+компания (см. fetch-sadran-data.js), но может
  // отличаться МЕЖДУ компаниями одного клиента — в кросс-компанийном custKey его включать нельзя.
  const custKeySochen = r => `${r.custno}|${r.custname}|${r.sadran}|${r.kosher}|${r.sochen || ''}`;
  const byCustomer = aggBy(rowsExBdd, custKey).map(c => {
    const [custno, custname, sadran, kosher] = c.key.split('|');
    return { ...c, custno, custname, sadran, kosher };
  });
  // Топ роста/падения — ТОЛЬКО same-store (та же логика, что у сдаранов): у новых клиентов
  // % от нуля не определён ("н/д"), их нельзя ранжировать в одном списке с реальным %.
  const byCustomerSameStore = byCustomer.filter(c => !newCustSet.has(c.custno));
  const topGrowth = byCustomerSameStore.slice(0, 8);
  const topDecline = byCustomerSameStore.slice(-8).reverse();
  const topNewCustomers = byCustomer.filter(c => newCustSet.has(c.custno)).sort((a, b) => b.now - a.now).slice(0, 8);

  // Топ роста/падения клиентов — отдельно по חברה (клиенты разных компаний не сравнимы
  // напрямую в одном рейтинге).
  const topGrowthByCompany = {};
  const topDeclineByCompany = {};
  for (const company of ['FORMULA', 'INTER', 'ICE MISH']) {
    const companyRows = rowsExBdd.filter(r => r.company === company);
    const newSetC = getNewCustomerSet(companyRows);
    const sameStoreC = companyRows.filter(r => !newSetC.has(r.custno));
    const byCustC = aggBy(sameStoreC, custKeySochen).map(c => {
      const [custno, custname, sadran, kosher, sochen] = c.key.split('|');
      return { ...c, custno, custname, sadran, kosher, sochen };
    });
    topGrowthByCompany[company] = byCustC.slice(0, 8);
    topDeclineByCompany[company] = byCustC.slice(-8).reverse();
  }

  // --- Same-Store vs New customers (глобально по клиенту, есть история / нет истории) ---
  const custTotals = new Map();
  for (const r of rows) {
    if (!custTotals.has(r.custno)) custTotals.set(r.custno, { lastYear: 0, now: 0, custname: r.custname });
    const c = custTotals.get(r.custno);
    c.lastYear += r.lastYear;
    c.now += r.now;
  }
  const newCustomers = new Set([...custTotals].filter(([, v]) => v.lastYear === 0 && v.now > 0).map(([k]) => k));
  const sameStoreCustomers = new Set([...custTotals].filter(([, v]) => v.lastYear > 0).map(([k]) => k));
  const sameLY = [...sameStoreCustomers].reduce((s, c) => s + custTotals.get(c).lastYear, 0);
  const sameNow = [...sameStoreCustomers].reduce((s, c) => s + custTotals.get(c).now, 0);
  const newNow = [...newCustomers].reduce((s, c) => s + custTotals.get(c).now, 0);
  const samePct = pctChange(sameLY, sameNow);

  // --- Pareto-70: top customers giving 70% of current revenue, flag dept-level collapse ---
  const grandNow = [...custTotals.values()].reduce((s, v) => s + v.now, 0);
  // paretoRisk(companyRows) — тот же расчёт, но scoped на переданный набор строк (компания),
  // используется в companyInsightData для FORMULA/ICE MISH выводов по отдельности.
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

  // Данные для по-компанийных "Выводов" (FORMULA / ICE MISH) — только реальные вычисленные
  // значения, без хардкода конкретных имён/цифр (см. feedback_no_speculation память).
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
  // signedILS — в отличие от fmtILS не лепит "-" после "₪" (fmtILS(-94681) → "₪-94,681",
  // непривычно для рус. записи) — здесь явный "+"/"−" перед ₪, сумма всегда абсолютная.
  function signedILS(n) {
    return (n >= 0 ? '+' : '−') + fmtILS(Math.abs(n));
  }

  const pptx = new pptxgenjs();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';

  const titleSlideOpts = { fontFace: 'Arial', color: WHITE };

  // Slide 1 — title
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addText('SADRAN — анализ продаж по мерчендайзерам', {
      x: 0.6, y: 2.6, w: 12, h: 1.2, fontSize: 32, bold: true, ...titleSlideOpts,
    });
    s.addText('Рост / падение по департаментам, мерчендайзерам и кошерному рынку', {
      x: 0.6, y: 3.6, w: 12, h: 0.6, fontSize: 16, color: 'C9D6E8', fontFace: 'Arial',
    });
    s.addText(`Сформировано автоматически аналитическим агентом · ${new Date().toLocaleDateString('ru-RU')}`, {
      x: 0.6, y: 6.7, w: 12, h: 0.4, fontSize: 11, color: '8FA3C0', fontFace: 'Arial',
    });
  }

  // Slide 2 — overall KPI (одна строка с типографической иерархией, без карточек)
  {
    const s = pptx.addSlide();
    s.addText('Общая картина', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    s.addText(
      [
        { text: fmtILS(totalLY), options: { fontSize: 34, bold: true, color: '5A6B80', fontFace: 'Arial' } },
        { text: '  →  ', options: { fontSize: 24, color: 'B7C2D0', fontFace: 'Arial' } },
        { text: fmtILS(totalNow), options: { fontSize: 34, bold: true, color: NAVY, fontFace: 'Arial' } },
        { text: '   ' + fmtPct(totalPct), options: { fontSize: 34, bold: true, color: colorForPct(totalPct), fontFace: 'Arial' } },
      ],
      { x: 0.6, y: 1.5, w: 12, h: 1.1, valign: 'middle' }
    );
    s.addText('прошлый период → текущий период, изменение суммарных продаж', {
      x: 0.6, y: 2.55, w: 12, h: 0.4, fontSize: 12, color: '8A9BA8', fontFace: 'Arial',
    });
    s.addShape('line', { x: 0.6, y: 3.25, w: 12.1, h: 0, line: { color: 'E2E8F0', width: 1 } });

    s.addText('По кошерности (שוק כשר)', { x: 0.6, y: 3.6, w: 6, h: 0.4, fontSize: 15, bold: true, color: NAVY, fontFace: 'Arial' });
    byKosher.forEach((b, i) => {
      const y = 4.1 + i * 0.55;
      s.addText(`${b.key}`, { x: 0.6, y, w: 2.5, h: 0.45, fontSize: 13, color: '333333', fontFace: 'Arial', rtlMode: true, lang: 'he-IL' });
      s.addText(`${fmtILS(b.lastYear)} → ${fmtILS(b.now)}`, { x: 3.1, y, w: 4.2, h: 0.45, fontSize: 12, color: '5A6B80', fontFace: 'Arial' });
      s.addText(fmtPct(b.pct), { x: 7.3, y, w: 1.5, h: 0.45, fontSize: 13, bold: true, color: colorForPct(b.pct), fontFace: 'Arial' });
    });
  }

  // Slide 2.5 — Same-Store vs New customers
  {
    const s = pptx.addSlide();
    s.addText('Рост органический или за счёт новых клиентов?', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    const rows2 = [
      { label: 'Same-Store (есть история 2025)', value: `${fmtILS(sameLY)} → ${fmtILS(sameNow)}`, sub: `${sameStoreCustomers.size} клиентов`, pct: fmtPct(samePct), color: colorForPct(samePct) },
      { label: 'Новые клиенты (нет истории 2025)', value: fmtILS(newNow), sub: `${newCustomers.size} клиентов · ${(newNow / grandNow * 100).toFixed(1)}% от текущей выручки`, pct: '', color: BLUE },
    ];
    rows2.forEach((r, i) => {
      const y = 1.5 + i * 1.35;
      s.addText(r.label, { x: 0.6, y, w: 5.2, h: 0.5, fontSize: 14, color: '5A6B80', fontFace: 'Arial' });
      s.addText(r.value, { x: 0.6, y: y + 0.45, w: 7.5, h: 0.7, fontSize: 24, bold: true, color: r.color, fontFace: 'Arial' });
      s.addText(r.sub, { x: 0.6, y: y + 1.05, w: 8, h: 0.35, fontSize: 11, color: '8A9BA8', fontFace: 'Arial' });
      if (r.pct) s.addText(r.pct, { x: 9.5, y: y + 0.4, w: 3, h: 0.7, fontSize: 26, bold: true, color: r.color, align: 'right', fontFace: 'Arial' });
      s.addShape('line', { x: 0.6, y: y + 1.15, w: 12.1, h: 0, line: { color: 'E2E8F0', width: 1 } });
    });
    s.addText(
      `Вывод: Same-Store рост (${fmtPct(samePct)}) почти совпадает с общим ростом компании (${fmtPct(totalPct)}) — ` +
      `новые клиенты дают лишь ${(newNow / grandNow * 100).toFixed(1)}% выручки. Рост в основном органический, ` +
      `за счёт существующей базы, а не за счёт открытия новых точек.`,
      { x: 0.7, y: 4.5, w: 11.9, h: 1.8, fontSize: 14, color: '333333', fontFace: 'Arial', valign: 'top', wrap: true }
    );
  }

  // Slide 3 — by company (top-level resolution: INTER / FORMULA / ICE MISH / ICE BDD)
  {
    const s = pptx.addSlide();
    s.addText('Рост / падение по компаниям (חברה)', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    byCompany.forEach((b, i) => {
      const y = 1.5 + i * 1.15;
      const lyShare = totalLY ? b.lastYear / totalLY : 0;
      const nowShare = totalNow ? b.now / totalNow : 0;
      s.addText(b.key, { x: 0.6, y, w: 3.0, h: 0.8, fontSize: 20, bold: true, color: NAVY, valign: 'middle', fontFace: 'Arial' });
      s.addText(`${fmtILS(b.lastYear)}  →  ${fmtILS(b.now)}`, { x: 3.7, y, w: 5.0, h: 0.8, fontSize: 13, color: '5A6B80', valign: 'middle', fontFace: 'Arial' });
      s.addText(`доля: ${(lyShare * 100).toFixed(1)}% → ${(nowShare * 100).toFixed(1)}%`, { x: 3.7, y: y + 0.4, w: 5.0, h: 0.4, fontSize: 10.5, color: '8A9BA8', valign: 'middle', fontFace: 'Arial' });
      s.addText(fmtPct(b.pct), { x: 10.3, y, w: 2.2, h: 0.8, fontSize: 24, bold: true, color: colorForPct(b.pct), align: 'right', valign: 'middle', fontFace: 'Arial' });
      s.addShape('line', { x: 0.6, y: y + 0.95, w: 12.1, h: 0, line: { color: 'E2E8F0', width: 1 } });
    });
  }

  // Slide 4 — by department (chart, внутри каждой компании)
  {
    const s = pptx.addSlide();
    s.addText('Рост / падение по департаментам (מחלקה)', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    const chartData = [{
      name: '% изменение',
      labels: byDept.map(b => b.key),
      values: byDept.map(b => Math.round((b.pct || 0) * 1000) / 10),
    }];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.5, y: 1.2, w: 12.3, h: 5.8,
      barDir: 'bar',
      chartColors: byDept.map(b => colorForPct(b.pct)),
      valAxisTitle: '% изменение', showValAxisTitle: true,
      showLegend: false, showTitle: false,
      dataLabelColor: '333333', showValue: true, dataLabelFormatCode: '+0"%";-0"%"',
      catAxisLabelFontSize: 12, valAxisLabelFontSize: 11,
      // Ось категорий по умолчанию пересекает ось значений в 0 (autoZero) — подписи
      // категорий садятся у нулевой отметки и наезжают на data label соседнего
      // короткого/отрицательного столбца. 'min' уводит её к левому краю графика.
      valAxisCrossesAt: 'min',
    });
  }

  // Slide 4.1 — Магазинная диагностика: у топ-падающих точек каждой компании — в какой
  // товарной группе (מחלקה) именно потери, плюс короткая рекомендация что проверить
  // (запрос пользователя 2026-08-12: "упор на магазинную аналитику с рекомендациями типа
  // проверить там где потери в каких группах товара"). Сдаранная статистика (график/таблица
  // по мерчендайзерам) убрана целиком — сдаран остаётся только как контакт в колонке магазина.
  function worstDeptForStore(custno, company) {
    const deptRows = rowsExBdd
      .filter(r => r.custno === custno && r.company === company && r.lastYear > 0)
      .map(r => ({ dept: r.dept, lastYear: r.lastYear, now: r.now, delta: r.now - r.lastYear, pct: pctChange(r.lastYear, r.now) }))
      .sort((a, b) => a.delta - b.delta);
    return deptRows[0] || null;
  }
  function recommendationFor(worst) {
    if (!worst) return '—';
    if (worst.now <= 0) return 'Группа полностью исчезла — проверить наличие и выкладку';
    if (worst.pct !== null && worst.pct < -0.4) return 'Резкое падение — проверить остатки и выкладку на полке';
    return 'Проверить наличие и выкладку товара';
  }
  for (const company of ['FORMULA', 'INTER', 'ICE MISH']) {
    const list = topDeclineByCompany[company];
    if (!list || !list.length) continue;
    const s = pptx.addSlide();
    s.addText(`Где потери — топ падающих точек (${company})`, { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    const header = ['Магазин / сдаран', 'Проблемная группа (מחלקה)', 'Прошлый → Текущий', '%', 'Рекомендация'].map(t => ({
      text: t, options: { bold: true, fill: { color: NAVY }, color: WHITE, fontSize: 10.5 },
    }));
    const body = list.map(c => {
      const worst = worstDeptForStore(c.custno, company);
      return [
        { text: `${String(c.custname || '').slice(0, 38)}\n${c.sadran || ''}`, options: { fontSize: 9.5, rtlMode: true, lang: 'he-IL' } },
        { text: worst ? worst.dept : '—', options: { fontSize: 9.5, rtlMode: true, lang: 'he-IL' } },
        { text: worst ? `${fmtILS(worst.lastYear)} → ${fmtILS(worst.now)}` : '', options: { fontSize: 9, align: 'right' } },
        { text: worst ? fmtPct(worst.pct) : '', options: { fontSize: 9.5, align: 'right', bold: true, color: colorForPct(worst ? worst.pct : null) } },
        { text: recommendationFor(worst), options: { fontSize: 9 } },
      ];
    });
    s.addTable([header, ...body], {
      x: 0.5, y: 1.2, w: 12.3, h: 5.8,
      colW: [3.2, 2.2, 2.3, 1.2, 3.4],
      border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
      autoPage: false,
    });
    s.addText('Проблемная группа — מחלקה с наибольшим падением у этой точки (только среди групп с историей прошлого года). Магазин может расти в целом, но проседать в одной группе.', {
      x: 0.5, y: 7.05, w: 12.3, h: 0.35, fontSize: 9.5, color: '8A9BA8', fontFace: 'Arial',
    });
  }

  // Slide 4.3 — по типу клиента (סוג לקוח)
  {
    const s = pptx.addSlide();
    s.addText('Рост / падение по типу клиента (סוג לקוח)', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    const chartData = [{
      name: '% изменение',
      labels: byCustType.map(b => b.key),
      values: byCustType.map(b => Math.round((b.pct || 0) * 1000) / 10),
    }];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.5, y: 1.2, w: 12.3, h: 5.8,
      barDir: 'bar',
      chartColors: byCustType.map(b => colorForPct(b.pct)),
      valAxisTitle: '% изменение', showValAxisTitle: true,
      showLegend: false, showTitle: false,
      dataLabelColor: '333333', showValue: true, dataLabelFormatCode: '+0"%";-0"%"',
      catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
      valAxisCrossesAt: 'min',
    });
    s.addText('Топ-12 сетей/типов по обороту (≥₪20K хотя бы в одном периоде). Источник: FORMULA PBI, таблица לקוחות FORM+I+INT.', {
      x: 0.5, y: 7.05, w: 12.3, h: 0.35, fontSize: 10, color: '8A9BA8', fontFace: 'Arial',
    });
  }

  // ---------- Разделы: FORMULA и ICE MISH — каждая компания полностью отдельно ----------
  for (const [company, deep] of [['FORMULA', deepDiveFORMULA], ['ICE MISH', deepDiveICEMISH]]) {
    // Слайд — общая картина по מחלקה. Пропускаем для компаний с одним департаментом
    // (ICE MISH — только mish גלידה) — сравнивать не с чем, график из одного столбца бесполезен.
    if (deep.byDept.length > 1) {
      const s = pptx.addSlide();
      s.addText(`${company} — рост / падение по מחלקה`, { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
      const chartData = [{
        name: '% изменение',
        labels: deep.byDept.map(b => b.key),
        values: deep.byDept.map(b => Math.round((b.pct || 0) * 1000) / 10),
      }];
      s.addChart(pptx.ChartType.bar, chartData, {
        x: 0.5, y: 1.2, w: 12.3, h: 5.8,
        barDir: 'bar',
        chartColors: deep.byDept.map(b => colorForPct(b.pct)),
        valAxisTitle: '% изменение', showValAxisTitle: true,
        showLegend: false, showTitle: false,
        dataLabelColor: '333333', showValue: true, dataLabelFormatCode: '+0"%";-0"%"',
        catAxisLabelFontSize: 12, valAxisLabelFontSize: 11,
        valAxisCrossesAt: 'min',
      });
    }

    // Слайд — общая картина по סוג לקוח
    {
      const s = pptx.addSlide();
      s.addText(`${company} — рост / падение по סוג לקוח`, { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
      const chartData = [{
        name: '% изменение',
        labels: deep.byCustType.map(b => b.key),
        values: deep.byCustType.map(b => Math.round((b.pct || 0) * 1000) / 10),
      }];
      s.addChart(pptx.ChartType.bar, chartData, {
        x: 0.5, y: 1.2, w: 12.3, h: 5.8,
        barDir: 'bar',
        chartColors: deep.byCustType.map(b => colorForPct(b.pct)),
        valAxisTitle: '% изменение', showValAxisTitle: true,
        showLegend: false, showTitle: false,
        dataLabelColor: '333333', showValue: true, dataLabelFormatCode: '+0"%";-0"%"',
        catAxisLabelFontSize: 12, valAxisLabelFontSize: 11,
        valAxisCrossesAt: 'min',
      });
      s.addText(`Только ${company}. Топ-8 типов по обороту.`, {
        x: 0.5, y: 7.05, w: 12.3, h: 0.35, fontSize: 10, color: '8A9BA8', fontFace: 'Arial',
      });
    }

    // Слайды — топ-10 клиентов КАЖДОГО סוג לקוח по величине отклонения
    for (const ct of deep.byCustType) {
      const list = deep.custTypeTopMovers[ct.key];
      if (!list.length) continue;
      const s = pptx.addSlide();
      s.addText(`${company} — סוג לקוח: ${ct.key} — топ-10 отклонений`, { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 20, bold: true, color: NAVY, fontFace: 'Arial' });
      const header = ['Клиент', 'Сдаран', 'Кошер', 'Прошлый', 'Текущий', '%'].map(t => ({
        text: t, options: { bold: true, fill: { color: NAVY }, color: WHITE, fontSize: 11 },
      }));
      const body = list.map(c => ([
        { text: String(c.custname || '').slice(0, 40), options: { fontSize: 10, rtlMode: true, lang: 'he-IL' } },
        { text: c.sadran || '', options: { fontSize: 10, rtlMode: true, lang: 'he-IL' } },
        { text: c.kosher || '', options: { fontSize: 10, rtlMode: true, lang: 'he-IL' } },
        { text: fmtILS(c.lastYear), options: { fontSize: 10, align: 'right' } },
        { text: fmtILS(c.now), options: { fontSize: 10, align: 'right' } },
        { text: fmtPct(c.pct), options: { fontSize: 10, align: 'right', bold: true, color: colorForPct(c.pct) } },
      ]));
      s.addTable([header, ...body], {
        x: 0.5, y: 1.2, w: 12.3, h: 5.8,
        colW: [4.3, 2.5, 1.3, 1.4, 1.4, 1.4],
        border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
        autoPage: false,
      });
      s.addText('Ранжировано по |Δ в ₪| (не по %) — новые клиенты (% "н/д") тоже могут быть крупнейшим движением.', {
        x: 0.5, y: 7.05, w: 12.3, h: 0.3, fontSize: 9.5, color: '8A9BA8', fontFace: 'Arial',
      });
    }
  }

  // Slide 4.5 — Выводы и рекомендации, отдельно по FORMULA и по ICE MISH (не общий кросс-компанийный
  // слайд — INTER/ICE BDD выводы туда не попадают, они не сравнимы напрямую с FORMULA/ICE MISH).
  // Все цифры — из реально вычисленных deptStats/custTypeStats/topCustomer/pareto, без хардкода.
  function buildCompanyBullets(company, data) {
    const bullets = [];
    const paretoPct = data.pareto.totalCount ? (data.pareto.paretoCount / data.pareto.totalCount * 100).toFixed(0) : '0';
    bullets.push({
      t: `Риск концентрации: ${data.pareto.paretoCount} клиентов (${paretoPct}% базы ${company}) дают 70% выручки — из них ${data.pareto.flagCount} уже проседают >=30% в отдельном מחלקה, даже если их общий итог положительный.`,
      c: AMBER,
    });
    if (data.deptStats.length > 1) {
      const best = data.deptStats[0], worst = data.deptStats[data.deptStats.length - 1];
      const worstLabel = worst.delta < 0 ? 'худший' : 'наименьший рост';
      bullets.push({
        t: `Департаменты (מחלקה): лучший — ${best.key} (${fmtPct(best.pct)}, ${signedILS(best.delta)}), ${worstLabel} — ${worst.key} (${fmtPct(worst.pct)}, ${signedILS(worst.delta)}).`,
        c: worst.delta < 0 ? DECLINE : GREEN,
      });
    }
    if (data.custTypeStats.length > 1) {
      const best = data.custTypeStats[0], worst = data.custTypeStats[data.custTypeStats.length - 1];
      const worstLabel = worst.delta < 0 ? 'худший' : 'наименьший рост';
      bullets.push({
        t: `Типы клиентов (סוג לקוח): лучший — ${best.key} (${fmtPct(best.pct)}, ${signedILS(best.delta)}), ${worstLabel} — ${worst.key} (${fmtPct(worst.pct)}, ${signedILS(worst.delta)}).`,
        c: worst.delta < 0 ? DECLINE : GREEN,
      });
    }
    if (data.topCustomer) {
      const c = data.topCustomer;
      const pctLabel = c.lastYear > 0 ? fmtPct(c.pct) : 'новый клиент';
      bullets.push({
        t: `Крупнейшее движение клиента: ${c.custname} (сдаран ${c.sadran}) — ${fmtILS(c.lastYear)} → ${fmtILS(c.now)} (${pctLabel}).`,
        c: c.delta >= 0 ? GREEN : DECLINE,
      });
    }
    return bullets;
  }
  for (const [company, data] of [['FORMULA', insightsFORMULA], ['ICE MISH', insightsICEMISH]]) {
    const bullets = buildCompanyBullets(company, data);
    // Фиксированный шаг 1.12in на буллит не помещает 7 пунктов в 7.5in слайд — пагинация по 4 держит запас.
    const PER_SLIDE = 4;
    const pageCount = Math.ceil(bullets.length / PER_SLIDE);
    for (let p = 0; p < pageCount; p++) {
      const s = pptx.addSlide();
      const title = pageCount > 1 ? `Выводы — ${company} (${p + 1}/${pageCount})` : `Выводы — ${company}`;
      s.addText(title, { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
      const pageBullets = bullets.slice(p * PER_SLIDE, (p + 1) * PER_SLIDE);
      let y = 1.3;
      pageBullets.forEach((b, i) => {
        const num = p * PER_SLIDE + i + 1;
        s.addShape('ellipse', { x: 0.6, y: y + 0.08, w: 0.4, h: 0.4, fill: { color: b.c }, line: { type: 'none' } });
        s.addText(String(num), { x: 0.6, y: y + 0.08, w: 0.4, h: 0.4, fontSize: 14, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Arial' });
        s.addText(b.t, { x: 1.15, y, w: 11.4, h: 1.3, fontSize: 12.5, color: '333333', fontFace: 'Arial', valign: 'top', wrap: true });
        y += 1.45;
      });
    }
  }

  // Slide 5 — top growth / decline customers table
  function customerTableSlide(title, list, color, isNew, showAgent) {
    const s = pptx.addSlide();
    s.addText(title, { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    const cols = ['Клиент', 'Сдаран', 'Кошер'];
    if (showAgent) cols.push('Агент');
    cols.push('Прошлый', 'Текущий', '%');
    const header = cols.map(t => ({
      text: t, options: { bold: true, fill: { color: NAVY }, color: WHITE, fontSize: 11 },
    }));
    const body = list.map(c => {
      const row = [
        { text: String(c.custname || '').slice(0, 40), options: { fontSize: 10, rtlMode: true, lang: 'he-IL' } },
        { text: c.sadran || '', options: { fontSize: 10, rtlMode: true, lang: 'he-IL' } },
        { text: c.kosher || '', options: { fontSize: 10, rtlMode: true, lang: 'he-IL' } },
      ];
      if (showAgent) row.push({ text: c.sochen || '', options: { fontSize: 10, rtlMode: true, lang: 'he-IL' } });
      row.push(
        { text: fmtILS(c.lastYear), options: { fontSize: 10, align: 'right' } },
        { text: fmtILS(c.now), options: { fontSize: 10, align: 'right' } },
        { text: isNew ? 'новый' : fmtPct(c.pct), options: { fontSize: 10, align: 'right', bold: true, color } },
      );
      return row;
    });
    const colW = showAgent ? [3.3, 2.1, 1.1, 2.1, 1.3, 1.3, 1.1] : [4.3, 2.5, 1.3, 1.4, 1.4, 1.4];
    s.addTable([header, ...body], {
      x: 0.5, y: 1.2, w: 12.3, h: 5.8,
      colW,
      border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
      autoPage: false,
    });
    if (isNew) {
      s.addText('Клиенты без истории прошлого года — % не определён (рост от нуля). Не входят в same-store топ роста.', {
        x: 0.5, y: 7.05, w: 12.3, h: 0.35, fontSize: 9.5, color: '8A9BA8', fontFace: 'Arial',
      });
    }
  }
  for (const company of ['FORMULA', 'INTER', 'ICE MISH']) {
    if (topGrowthByCompany[company].length) customerTableSlide(`Топ клиентов — рост продаж — ${company}`, topGrowthByCompany[company], GREEN);
    if (topDeclineByCompany[company].length) customerTableSlide(`Топ клиентов — падение продаж — ${company}`, topDeclineByCompany[company], DECLINE, false, true);
  }
  if (topNewCustomers.length) customerTableSlide('Топ новых клиентов', topNewCustomers, BLUE, true);

  pptx.writeFile({ fileName: OUT }).then(() => {
    console.log('PPTX saved:', OUT);
  }).catch(err => {
    console.error('PPTX write failed:', err.message);
    process.exit(1);
  });
}

main();
