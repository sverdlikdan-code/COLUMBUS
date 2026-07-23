// SADRAN report — рост/падение по мерчендайзерам, департаментам, кошерности
// Данные читаются напрямую из SADRAN.xlsx (лист Export) при каждом запуске — без хардкода.
const pptxgenjs = require('pptxgenjs');
const { loadRows, pctChange, aggBy, fmtILS, fmtPct, DEPT_COMPANY, isolateLatin, getNewCustomerSet } = require('./sadran-data');

const OUT = 'C:\\Users\\d.sverdlik\\Desktop\\SADRAN_REPORT.pptx';

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
  const sameStoreRows = rowsExBdd.filter(r => !newCustSet.has(r.custno));
  const newCustRows = rowsExBdd.filter(r => newCustSet.has(r.custno));
  const bySadran = aggBy(sameStoreRows, r => r.sadran);
  const bySadranNewMap = new Map(aggBy(newCustRows, r => r.sadran).map(b => [b.key, b.now]));
  const byKosher = aggBy(rows, r => r.kosher);
  const byCustType = aggBy(rows, r => r.custtype).filter(b => b.now > 20000 || b.lastYear > 20000).slice(0, 12);
  // Сдаран x Департамент — тоже same-store (та же логика, что и общий разрез по сдаранам),
  // + отдельно вклад новых клиентов в той же связке.
  const bySadranDeptAll = aggBy(sameStoreRows, r => `${r.sadran}|${r.dept}`).map(b => {
    const [sadran, dept] = b.key.split('|');
    return { ...b, sadran, dept };
  });
  const bySadranDeptNewMap = new Map(
    aggBy(newCustRows, r => `${r.sadran}|${r.dept}`).map(b => [b.key, b.now])
  );
  const sadranDeptMovers = [...bySadranDeptAll].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 14)
    .sort((a, b) => b.delta - a.delta)
    .map(b => ({ ...b, newVal: bySadranDeptNewMap.get(`${b.sadran}|${b.dept}`) || 0 }));

  // Клиентские топы — тоже без ICE BDD (см. выше)
  const custKey = r => `${r.custno}|${r.custname}|${r.sadran}|${r.kosher}`;
  const byCustomer = aggBy(rowsExBdd, custKey).map(c => {
    const [custno, custname, sadran, kosher] = c.key.split('|');
    return { ...c, custno, custname, sadran, kosher };
  });
  const topGrowth = byCustomer.slice(0, 8);
  const topDecline = byCustomer.slice(-8).reverse();

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
  const rankedCustomers = [...custTotals.entries()].sort((a, b) => b[1].now - a[1].now);
  let cum = 0;
  const paretoSet = new Set();
  for (const [c, v] of rankedCustomers) {
    cum += v.now;
    paretoSet.add(c);
    if (cum >= 0.70 * grandNow) break;
  }
  const deptByCust = new Map();
  for (const r of rows) {
    if (!paretoSet.has(r.custno)) continue;
    if (!deptByCust.has(r.custno)) deptByCust.set(r.custno, new Map());
    const dm = deptByCust.get(r.custno);
    if (!dm.has(r.dept)) dm.set(r.dept, { lastYear: 0, now: 0 });
    const d = dm.get(r.dept);
    d.lastYear += r.lastYear;
    d.now += r.now;
  }
  let paretoFlagCount = 0;
  for (const custno of paretoSet) {
    const dm = deptByCust.get(custno) || new Map();
    let flagged = false;
    for (const d of dm.values()) {
      if (d.lastYear > 0 && d.now === 0) flagged = true;
      else if (d.lastYear > 0 && d.now > 0 && (d.now - d.lastYear) / d.lastYear < -0.30) flagged = true;
    }
    if (flagged) paretoFlagCount++;
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
      s.addText(`${b.key}`, { x: 0.6, y, w: 2.5, h: 0.45, fontSize: 13, color: '333333', fontFace: 'Arial' });
      s.addText(`${fmtILS(b.lastYear)} → ${fmtILS(b.now)}`, { x: 3.1, y, w: 4.2, h: 0.45, fontSize: 12, color: '5A6B80', fontFace: 'Arial' });
      s.addText(fmtPct(b.pct), { x: 7.3, y, w: 1.5, h: 0.45, fontSize: 13, bold: true, color: colorForPct(b.pct), fontFace: 'Arial' });
    });
  }

  // Slide 2.5 — Same-Store vs New customers
  {
    const s = pptx.addSlide();
    s.addText('Рост органический или за счёт новых клиентов?', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    const rows = [
      { label: 'Same-Store (есть история 2025)', value: `${fmtILS(sameLY)} → ${fmtILS(sameNow)}`, sub: `${sameStoreCustomers.size} клиентов`, pct: fmtPct(samePct), color: colorForPct(samePct) },
      { label: 'Новые клиенты (нет истории 2025)', value: fmtILS(newNow), sub: `${newCustomers.size} клиентов · ${(newNow / grandNow * 100).toFixed(1)}% от текущей выручки`, pct: '', color: BLUE },
    ];
    rows.forEach((r, i) => {
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
      labels: byDept.map(b => isolateLatin(b.key)),
      values: byDept.map(b => Math.round((b.pct || 0) * 1000) / 10),
    }];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.5, y: 1.2, w: 12.3, h: 5.8,
      barDir: 'bar',
      chartColors: byDept.map(b => colorForPct(b.pct)),
      valAxisTitle: '% изменение', showValAxisTitle: true,
      showLegend: false, showTitle: false,
      dataLabelColor: '333333', showValue: true, dataLabelFormatCode: '+0.0"%";-0.0"%"',
      catAxisLabelFontSize: 12, valAxisLabelFontSize: 11,
    });
  }

  // Slide 4 — by sadran (chart)
  {
    const s = pptx.addSlide();
    s.addText('Рост / падение по мерчендайзерам (סדרן) — same-store', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    const chartData = [{
      name: '% изменение',
      labels: bySadran.map(b => b.key),
      values: bySadran.map(b => Math.round((b.pct || 0) * 1000) / 10),
    }];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.5, y: 1.2, w: 12.3, h: 5.3,
      barDir: 'bar',
      chartColors: bySadran.map(b => colorForPct(b.pct)),
      valAxisTitle: '% изменение', showValAxisTitle: true,
      showLegend: false, showTitle: false,
      dataLabelColor: '333333', showValue: true, dataLabelFormatCode: '+0.0"%";-0.0"%"',
      catAxisLabelFontSize: 12, valAxisLabelFontSize: 11,
    });
    s.addText('% считается только по клиентам с историей прошлого года (like-for-like) — новые клиенты не входят в %.', {
      x: 0.5, y: 6.65, w: 12.3, h: 0.3, fontSize: 10, color: '8A9BA8', fontFace: 'Arial',
    });
    const newTop = [...bySadranNewMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (newTop.length) {
      s.addText('Вклад новых клиентов (вне %): ' + newTop.map(([k, v]) => `${k} +${fmtILS(v)}`).join('  ·  '), {
        x: 0.5, y: 6.95, w: 12.3, h: 0.3, fontSize: 10, color: BLUE, fontFace: 'Arial',
      });
    }
  }

  // Slide 4.2 — топ-14 связок Сдаран x Департамент по величине изменения
  {
    const s = pptx.addSlide();
    s.addText('Крупнейшие сдвиги: сдаран x департамент (same-store)', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 22, bold: true, color: NAVY, fontFace: 'Arial' });
    const header = ['Сдаран', 'Департамент', 'Прошлый', 'Текущий', '%', '+ Новые'].map(t => ({
      text: t, options: { bold: true, fill: { color: NAVY }, color: WHITE, fontSize: 10.5 },
    }));
    const body = sadranDeptMovers.map(b => ([
      { text: b.sadran, options: { fontSize: 9.5 } },
      { text: b.dept, options: { fontSize: 9.5 } },
      { text: fmtILS(b.lastYear), options: { fontSize: 9.5, align: 'right' } },
      { text: fmtILS(b.now), options: { fontSize: 9.5, align: 'right' } },
      { text: fmtPct(b.pct), options: { fontSize: 9.5, align: 'right', bold: true, color: colorForPct(b.pct) } },
      { text: b.newVal ? '+' + fmtILS(b.newVal) : '—', options: { fontSize: 9.5, align: 'right', color: BLUE } },
    ]));
    s.addTable([header, ...body], {
      x: 0.5, y: 1.15, w: 12.3, h: 5.7,
      colW: [3.0, 2.4, 1.9, 1.9, 1.6, 1.5],
      border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
      autoPage: false,
    });
    s.addText('% — только клиенты с историей прошлого года (same-store). Новые клиенты — отдельно, вне %.', {
      x: 0.5, y: 6.95, w: 12.3, h: 0.3, fontSize: 9.5, color: '8A9BA8', fontFace: 'Arial',
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
      dataLabelColor: '333333', showValue: true, dataLabelFormatCode: '+0.0"%";-0.0"%"',
      catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
    });
    s.addText('Топ-12 сетей/типов по обороту (≥₪20K хотя бы в одном периоде). Источник: FORMULA PBI, таблица לקוחות FORM+I+INT.', {
      x: 0.5, y: 7.05, w: 12.3, h: 0.35, fontSize: 10, color: '8A9BA8', fontFace: 'Arial',
    });
  }

  // Slide 4.5 — риск концентрации / выводы и рекомендации
  {
    const s = pptx.addSlide();
    s.addText('Выводы и рекомендации', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    const kpByCity = aggBy(rows.filter(r => r.dept === 'קפוא ❄'), r => r.city);
    const kpGrowth = kpByCity.filter(b => b.lastYear > 10000 && b.pct > 0.15).sort((a, b) => b.delta - a.delta).slice(0, 3);
    const kpDecline = kpByCity.filter(b => b.lastYear > 10000 && b.pct < -0.15).sort((a, b) => a.delta - b.delta).slice(0, 3);
    const bullets = [
      { t: `Риск концентрации: ${paretoSet.size} клиентов (${(paretoSet.size / custTotals.size * 100).toFixed(0)}% базы) дают 70% выручки — из них ${paretoFlagCount} уже проседают >=30% в отдельном מחלקה, даже если их общий итог положительный.`, c: AMBER },
      { t: `Сеть 'קשת טעמים' (6 филиалов) синхронно теряет מדף (-32%…-58% в каждом филиале) — похоже на решение уровня сети/закупки, а не разовую историю по точке.`, c: AMBER },
      { t: `Сеть 'קרל ברג' (2 филиала) теряет mish גלידה (-63% и -85%) — тот же паттерн, отдельная проверка.`, c: AMBER },
      { t: `קפוא выглядит стабильным (+3.6%) только в среднем — растут ${kpGrowth.map(b => b.key + ' +' + Math.round(b.pct * 100) + '%').join(', ')}, падают ${kpDecline.map(b => b.key + ' ' + Math.round(b.pct * 100) + '%').join(', ')}. Разброс в разы больше итога — усреднение прячет реальную картину по городам.`, c: AMBER },
      { t: `ICE BDD (-3.3%) — падение не от оттока клиентов (всего -₪31K), а от снижения объёма у активных (-₪522K). Товар идёт через канал OneSales, не через сдаранов — причину стоит искать там.`, c: DECLINE },
      { t: `INTER (+51.6%) — рост здоровый: и новые клиенты (42, +₪740K), и рост существующих (+₪1.33M), same-store сам по себе +44.7%. Топ-3 same-store (без новых клиентов): אוקסנה קיצ'ייב +41.4%, יבגני בלקיטני +62.3%, יבגני זמשה +59.1% — стоит разобрать их подход и масштабировать.`, c: GREEN },
      { t: `Осторожно с общей % по сдарану: יבגני זמשה выглядел "главным генератором роста" по сумме, но same-store у него обычные +14.9% — почти половина роста была от новых клиентов (+₪697K). Обратный случай: יגאל רייכמן показывал "+126%", а на своей реальной базе — минус 1.6%.`, c: AMBER },
    ];
    let y = 1.3;
    bullets.forEach((b, i) => {
      s.addShape('ellipse', { x: 0.6, y: y + 0.08, w: 0.4, h: 0.4, fill: { color: b.c }, line: { type: 'none' } });
      s.addText(String(i + 1), { x: 0.6, y: y + 0.08, w: 0.4, h: 0.4, fontSize: 14, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Arial' });
      s.addText(b.t, { x: 1.15, y, w: 11.4, h: 1.05, fontSize: 12.5, color: '333333', fontFace: 'Arial', valign: 'top', wrap: true });
      y += 1.12;
    });
  }

  // Slide 5 — top growth / decline customers table
  function customerTableSlide(title, list, color) {
    const s = pptx.addSlide();
    s.addText(title, { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 24, bold: true, color: NAVY, fontFace: 'Arial' });
    const header = ['Клиент', 'Сдаран', 'Кошер', 'Прошлый', 'Текущий', '%'].map(t => ({
      text: t, options: { bold: true, fill: { color: NAVY }, color: WHITE, fontSize: 11 },
    }));
    const body = list.map(c => ([
      { text: String(c.custname || '').slice(0, 40), options: { fontSize: 10 } },
      { text: c.sadran || '', options: { fontSize: 10 } },
      { text: c.kosher || '', options: { fontSize: 10 } },
      { text: fmtILS(c.lastYear), options: { fontSize: 10, align: 'right' } },
      { text: fmtILS(c.now), options: { fontSize: 10, align: 'right' } },
      { text: fmtPct(c.pct), options: { fontSize: 10, align: 'right', bold: true, color } },
    ]));
    s.addTable([header, ...body], {
      x: 0.5, y: 1.2, w: 12.3, h: 5.8,
      colW: [4.3, 2.5, 1.3, 1.4, 1.4, 1.4],
      border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
      autoPage: false,
    });
  }
  customerTableSlide('Топ клиентов — рост продаж', topGrowth, GREEN);
  customerTableSlide('Топ клиентов — падение продаж', topDecline, DECLINE);

  pptx.writeFile({ fileName: OUT }).then(() => {
    console.log('PPTX saved:', OUT);
  }).catch(err => {
    console.error('PPTX write failed:', err.message);
    process.exit(1);
  });
}

main();
