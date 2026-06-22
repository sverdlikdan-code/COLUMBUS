require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

async function probe() {
  console.log('📊 FORMULA dataset — sales data probe\n');

  // 1. Годовые продажи по компаниям 2024 vs 2025
  console.log('=== Annual Sales by Company (2024 vs 2025) ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      SELECTCOLUMNS(
        SUMMARIZE(
          'ALL_PARTS',
          'ALL_PARTS'[חברה],
          "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
          "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025)
        ),
        "Company", 'ALL_PARTS'[חברה],
        "Y2024", [Y2024],
        "Y2025", [Y2025]
      )
      ORDER BY [Y2025] DESC
    `);
    rows.forEach(r => {
      const y24 = Math.round(r['[Y2024]'] || 0);
      const y25 = Math.round(r['[Y2025]'] || 0);
      const pct = y24 ? Math.round((y25 - y24) / y24 * 100) : 0;
      console.log(`  ${r['[Company]']}: 2024=₪${y24.toLocaleString()}  2025=₪${y25.toLocaleString()}  Δ${pct > 0 ? '+' : ''}${pct}%`);
    });
  } catch (e) { console.log('  error:', e.message); }

  // 2. ICE разбивка по мחסן
  console.log('\n=== ICE — breakdown by מחסן (warehouse) ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      SUMMARIZE(
        FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "ICE"),
        'ALL_PARTS'[מחסן],
        "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
        "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025)
      )
    `);
    rows.forEach(r => {
      const y24 = Math.round(r['[Y2024]'] || 0);
      const y25 = Math.round(r['[Y2025]'] || 0);
      const pct = y24 ? Math.round((y25 - y24) / y24 * 100) : 0;
      console.log(`  ${r['ALL_PARTS[מחסן]']}: 2024=₪${y24.toLocaleString()}  2025=₪${y25.toLocaleString()}  Δ${pct > 0 ? '+' : ''}${pct}%`);
    });
  } catch (e) { console.log('  error:', e.message); }

  // 3. Кашрут разбивка 2024 vs 2025
  console.log('\n=== Kashrut split 2024 vs 2025 ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      SUMMARIZE(
        'ALL_PARTS',
        'ALL_PARTS'[כשרות],
        "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
        "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025)
      )
    `);
    rows.forEach(r => {
      const y24 = Math.round(r['[Y2024]'] || 0);
      const y25 = Math.round(r['[Y2025]'] || 0);
      const pct = y24 ? Math.round((y25 - y24) / y24 * 100) : 0;
      console.log(`  ${r['ALL_PARTS[כשרות]']}: 2024=₪${y24.toLocaleString()}  2025=₪${y25.toLocaleString()}  Δ${pct > 0 ? '+' : ''}${pct}%`);
    });
  } catch (e) { console.log('  error:', e.message); }

  // 4. Каналы (רשתות vs שוק פרטי)
  console.log('\n=== Channels (רשתות-שוק פרטי) 2024 vs 2025 ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      SUMMARIZE(
        'ALL_PARTS',
        'ALL_PARTS'[רשתות-שוק פרטי],
        "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
        "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025)
      )
    `);
    rows.forEach(r => {
      const y24 = Math.round(r['[Y2024]'] || 0);
      const y25 = Math.round(r['[Y2025]'] || 0);
      const pct = y24 ? Math.round((y25 - y24) / y24 * 100) : 0;
      console.log(`  "${r['ALL_PARTS[רשתות-שוק פרטי]']}": 2024=₪${y24.toLocaleString()}  2025=₪${y25.toLocaleString()}  Δ${pct > 0 ? '+' : ''}${pct}%`);
    });
  } catch (e) { console.log('  error:', e.message); }

  // 5. 2026 YTD (Jan-May) vs 2025 same period
  console.log('\n=== 2026 YTD Jan-May vs 2025 same period ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      SUMMARIZE(
        'ALL_PARTS',
        'ALL_PARTS'[חברה],
        "YTD2026", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2026, MONTH('ALL_PARTS'[תאריך]) <= 5),
        "YTD2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025, MONTH('ALL_PARTS'[תאריך]) <= 5)
      )
      ORDER BY [YTD2026] DESC
    `);
    rows.forEach(r => {
      const y25 = Math.round(r['[YTD2025]'] || 0);
      const y26 = Math.round(r['[YTD2026]'] || 0);
      const pct = y25 ? Math.round((y26 - y25) / y25 * 100) : 0;
      console.log(`  ${r['ALL_PARTS[חברה]']}: 2025 Jan-May=₪${y25.toLocaleString()}  2026 Jan-May=₪${y26.toLocaleString()}  Δ${pct > 0 ? '+' : ''}${pct}%`);
    });
  } catch (e) { console.log('  error:', e.message); }
}

probe().catch(console.error);
