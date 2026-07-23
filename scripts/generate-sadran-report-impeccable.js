// SADRAN report — IMPECCABLE вариант: та же данные, что и generate-sadran-report.js,
// другой визуальный язык (см. .claude/skills/impeccable — shared design laws).
//
// Сцена: директор показывает результаты команде на планёрке днём в офисе, слайды может
// печатать/проецировать — нужна ясность данных, но с редакторской уверенностью, не "SaaS-дефолт".
//
// Color strategy: Committed — один плотный чернильный цвет несёт реальный вес на секционных
// слайдах, тёплый off-white на содержательных, один сдержанный акцент (охра) для выделений.
// Рост/падение — не дефолтный зелёный/серый, а приглушённый шалфей / глина.
const pptxgenjs = require('pptxgenjs');
const { loadRows, pctChange, aggBy, fmtILS, fmtPct, DEPT_COMPANY, isolateLatin, getNewCustomerSet } = require('./sadran-data');

const OUT = 'C:\\Users\\d.sverdlik\\Desktop\\SADRAN_REPORT_IMPECCABLE.pptx';

// --- palette (OKLCH-informed, tinted neutrals — не чистый #000/#fff) ---
const INK = '1B2430';        // глубокий чернильный (не чёрный) — секционные слайды
const INK_SOFT = '2A3644';   // чуть светлее чернильного, для панелей на INK
const PAPER = 'FAF7F2';      // тёплый off-white — фон содержательных слайдов
const PAPER_LINE = 'E4DDD1'; // тонкая линия на PAPER
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

function main() {
  const rows = loadRows();
  const totalLY = rows.reduce((s, r) => s + r.lastYear, 0);
  const totalNow = rows.reduce((s, r) => s + r.now, 0);
  const totalPct = pctChange(totalLY, totalNow);

  const byCompany = aggBy(rows, r => r.company);
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
  const bySadran = aggBy(rowsExBdd.filter(r => !newCustSet.has(r.custno)), r => r.sadran);
  const byKosher = aggBy(rows, r => r.kosher);
  const byCustType = aggBy(rows, r => r.custtype).filter(b => b.now > 20000 || b.lastYear > 20000).slice(0, 10);

  const custKey = r => `${r.custno}|${r.custname}`;
  const byCustomer = aggBy(rowsExBdd, custKey).map(c => {
    const [custno, custname] = c.key.split('|');
    return { ...c, custno, custname };
  });
  const topGrowth = byCustomer.slice(0, 6);
  const topDecline = byCustomer.slice(-6).reverse();

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
  const churnAndOther = churnDelta + otherDelta; // сворачиваем незначительный "other" (₪182) в отток
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
    s.addText(kicker.toUpperCase(), {
      x: 0.7, y: 0.5, w: 11.5, h: 0.35, fontSize: 11, color: GOLD, charSpacing: 2, bold: true, fontFace: SANS,
    });
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
    s.addText('Валовые потоки (рост + новые ≈ ₪6.46M) в разы больше падения и оттока (≈ ₪2.0M) — чистый итог +15.8% прячет намного более динамичную картину под собой.', {
      x: 0.7, y: 6.95, w: 11.9, h: 0.4, fontSize: 11, color: MUTED, fontFace: SANS, italic: true,
    });
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
  divider('Разрез 1', 'По компаниям', 'INTER · FORMULA · ICE MISH · ICE BDD');

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
  }

  // ---------- Divider: departments & sadran ----------
  divider('Разрез 2', 'Департаменты и мерчендайзеры', 'Где именно живёт рост, а где — просадка');

  // ---------- Slide — department chart ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'מחלקה', 'Рост / падение по департаментам');
    const chartData = [{ name: '% изменение', labels: byDept.map(b => isolateLatin(b.key)), values: byDept.map(b => Math.round((b.pct || 0) * 1000) / 10) }];
    s.addChart(pptx.ChartType.bar, chartData, {
      x: 0.6, y: 1.9, w: 12.1, h: 5.1, barDir: 'bar',
      chartColors: byDept.map(b => colorForPct(b.pct)),
      valAxisTitle: '% изменение', showValAxisTitle: true,
      showLegend: false, showTitle: false,
      dataLabelColor: INK_TEXT, showValue: true, dataLabelFormatCode: '+0.0"%";-0.0"%"',
      catAxisLabelFontSize: 12, valAxisLabelFontSize: 10,
      catAxisLabelColor: INK_TEXT, valAxisLabelColor: MUTED,
      plotArea: { border: { type: 'none' } },
      catGridLine: { style: 'none' }, valGridLine: { color: PAPER_LINE, style: 'solid', size: 0.5 },
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
      dataLabelColor: INK_TEXT, showValue: true, dataLabelFormatCode: '+0.0"%";-0.0"%"',
      catAxisLabelFontSize: 12, valAxisLabelFontSize: 10,
      catAxisLabelColor: INK_TEXT, valAxisLabelColor: MUTED,
      plotArea: { border: { type: 'none' } },
      catGridLine: { style: 'none' }, valGridLine: { color: PAPER_LINE, style: 'solid', size: 0.5 },
    });
  }

  // ---------- Slide — Сдаран x Департамент, same-store, крупнейшие сдвиги ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'סדרן x מחלקה', 'Крупнейшие сдвиги (same-store)');
    const newSet2 = getNewCustomerSet(rowsExBdd);
    const ssRows2 = rowsExBdd.filter(r => !newSet2.has(r.custno));
    const newRows2 = rowsExBdd.filter(r => newSet2.has(r.custno));
    const sdAll = aggBy(ssRows2, r => `${r.sadran}|${r.dept}`).map(b => {
      const [sadran, dept] = b.key.split('|');
      return { ...b, sadran, dept };
    });
    const sdNewMap = new Map(aggBy(newRows2, r => `${r.sadran}|${r.dept}`).map(b => [b.key, b.now]));
    const sdMovers = [...sdAll].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12)
      .sort((a, b) => b.delta - a.delta);
    let ty = 1.9;
    // заголовок таблицы вручную (редакторский стиль — тонкая линия, не заливка)
    const cols = [0.6, 3.0, 5.6, 9.7, 11.1];
    ['Сдаран', 'Департамент', 'Прошлый → Текущий', '%', '+ Новые'].forEach((h, i) => {
      s.addText(h, { x: cols[i], y: ty, w: (cols[i + 1] || 12.5) - cols[i], h: 0.3, fontSize: 10, bold: true, color: GOLD, fontFace: SANS });
    });
    s.addShape('line', { x: 0.6, y: ty + 0.32, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
    ty += 0.42;
    sdMovers.forEach(b => {
      const newVal = sdNewMap.get(`${b.sadran}|${b.dept}`) || 0;
      s.addText(b.sadran, { x: cols[0], y: ty, w: cols[1] - cols[0], h: 0.32, fontSize: 10, color: INK_TEXT, fontFace: SANS });
      s.addText(b.dept, { x: cols[1], y: ty, w: cols[2] - cols[1], h: 0.32, fontSize: 10, color: INK_TEXT, fontFace: SANS });
      s.addText(`${fmtILS(b.lastYear)} → ${fmtILS(b.now)}`, { x: cols[2], y: ty, w: cols[3] - cols[2], h: 0.32, fontSize: 9.5, color: MUTED, fontFace: SANS });
      s.addText(fmtPct(b.pct), { x: cols[3], y: ty, w: cols[4] - cols[3], h: 0.32, fontSize: 10, bold: true, color: colorForPct(b.pct), fontFace: SANS });
      s.addText(newVal ? '+' + fmtILS(newVal) : '—', { x: cols[4], y: ty, w: 12.5 - cols[4], h: 0.32, fontSize: 9.5, color: GOLD, fontFace: SANS });
      ty += 0.345;
    });
    s.addText('% — только клиенты с историей прошлого года (same-store). Новые клиенты — отдельно, вне %.', {
      x: 0.7, y: 7.05, w: 11.9, h: 0.3, fontSize: 9.5, color: MUTED, fontFace: SANS, italic: true,
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
      dataLabelColor: INK_TEXT, showValue: true, dataLabelFormatCode: '+0.0"%";-0.0"%"',
      catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
      catAxisLabelColor: INK_TEXT, valAxisLabelColor: MUTED,
      plotArea: { border: { type: 'none' } },
      catGridLine: { style: 'none' }, valGridLine: { color: PAPER_LINE, style: 'solid', size: 0.5 },
    });
  }

  // ---------- Divider: insights ----------
  divider('Разрез 3', 'Что заметно в данных', 'Паттерны, которые прячутся за средними цифрами');

  // ---------- Slide — insight quotes (editorial, no bullets-as-cards) ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 'Наблюдения', 'Выводы и рекомендации');
    const insights = [
      { k: 'קשת טעמים', t: 'Шесть филиалов одной сети синхронно теряют מדף (-32%…-58%) — решение уровня закупки сети, не единичный случай.', c: CLAY },
      { k: 'קפוא ❄', t: 'Компания в целом стабильна (+3.6%), но за этим средним — города вроде רעננה (-66%) и בת ים (+48%) гасят друг друга.', c: GOLD },
      { k: 'ICE BDD', t: 'Падение (-3.3%) не от оттока клиентов, а от снижения объёма у активных — и товар идёт через OneSales, не через сдаранов.', c: CLAY },
      { k: 'INTER', t: 'Рост +51.6% здоровый и широкий: same-store сам по себе +44.7%, без учёта новых точек.', c: SAGE },
    ];
    let y = 2.0;
    insights.forEach(item => {
      s.addText(item.k, { x: 0.7, y, w: 2.6, h: 1.1, fontSize: 15, bold: true, color: item.c, fontFace: SANS, valign: 'top' });
      s.addText(item.t, { x: 3.5, y, w: 9.1, h: 1.1, fontSize: 14, color: INK_TEXT, fontFace: SERIF, valign: 'top', wrap: true });
      y += 1.25;
    });
  }

  // ---------- Slide — top movers (editorial table, minimal chrome) ----------
  function moversSlide(kicker, title, list, color) {
    const s = pptx.addSlide();
    contentHeader(s, kicker, title);
    let y = 2.0;
    list.forEach(c => {
      s.addText(c.custname || '', { x: 0.7, y, w: 8.3, h: 0.55, fontSize: 13, color: INK_TEXT, fontFace: SANS, valign: 'middle' });
      s.addText(`${fmtILS(c.lastYear)} → ${fmtILS(c.now)}`, { x: 9.1, y, w: 2.3, h: 0.55, fontSize: 10.5, color: MUTED, fontFace: SANS, valign: 'middle' });
      s.addText(fmtPct(c.pct), { x: 11.5, y, w: 1.1, h: 0.55, fontSize: 13, bold: true, color, align: 'right', fontFace: SANS, valign: 'middle' });
      s.addShape('line', { x: 0.7, y: y + 0.5, w: 11.9, h: 0, line: { color: PAPER_LINE, width: 1 } });
      y += 0.58;
    });
  }
  moversSlide('Клиенты', 'Топ роста', topGrowth, SAGE);
  moversSlide('Клиенты', 'Топ падения', topDecline, CLAY);

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
