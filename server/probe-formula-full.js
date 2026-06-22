require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

async function run(label, dax) {
  console.log(`\n=== ${label} ===`);
  try {
    const rows = await executeDax(dax);
    rows.slice(0, 20).forEach(r => console.log(' ', JSON.stringify(r)));
    if (rows.length > 20) console.log(`  ... (${rows.length} total rows)`);
    return rows;
  } catch (e) { console.log('  ❌', e.message.slice(0, 200)); return []; }
}

async function probe() {
  console.log('🔍 FORMULA dataset — full structure probe\n');

  // 1. ALL COLUMNS in ALL_PARTS
  await run('ALL_PARTS — all columns (1 row)', `EVALUATE TOPN(1, 'ALL_PARTS')`);

  // 2. All other tables
  const candidateTables = [
    'OBLIGO','Obligo','אובליגו','DELTA','Delta','דלתא',
    'KPI','Kpi','מנהל','MANAGERS','Targets','יעדים',
    'CLIENTS','לקוחות','AGENTS','סוכנים',
    'CUSTSTATS','CUSTSPEC','CUSTCALLFREQUENCY',
    'Budget','תקציב','Forecast'
  ];
  console.log('\n=== TABLE SCAN ===');
  const foundTables = [];
  for (const t of candidateTables) {
    try {
      await executeDax(`EVALUATE TOPN(1, '${t}')`);
      console.log(`  ✅ ${t}`);
      foundTables.push(t);
    } catch { console.log(`  ❌ ${t}`); }
  }

  // 3. מנהל column in ALL_PARTS?
  await run('מנהל column check', `
    EVALUATE
    TOPN(5, SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מנהל]))
  `);

  // 4. סוג לקוח values
  await run('סוג לקוח — all values', `
    EVALUATE
    SUMMARIZE(
      'ALL_PARTS',
      'ALL_PARTS'[תאור סוג לקוח],
      "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025)
    )
    ORDER BY [Y2025] DESC
  `);

  // 5. Top 5 agents FORMULA 2025 vs 2024 — growth
  await run('FORMULA — Top agents by growth 2024→2025', `
    EVALUATE
    TOPN(10,
      ADDCOLUMNS(
        SUMMARIZE(
          FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "FORMULA"),
          'ALL_PARTS'[שם סוכן],
          "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
          "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025)
        ),
        "Delta", [Y2025] - [Y2024],
        "PctGrowth", DIVIDE([Y2025] - [Y2024], [Y2024])
      ),
      [Delta], DESC
    )
  `);

  // 6. Client activity FORMULA — kosher vs non-kosher by agent
  await run('FORMULA — Agent x Kashrut 2025', `
    EVALUATE
    SUMMARIZE(
      FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "FORMULA" && YEAR('ALL_PARTS'[תאריך]) = 2025),
      'ALL_PARTS'[שם סוכן],
      'ALL_PARTS'[כשרות],
      "Sales", SUM('ALL_PARTS'[סכום (ש'ח)])
    )
    ORDER BY [Sales] DESC
  `);

  // 7. Chains analysis — רשתות by client type 2024 vs 2025
  await run('Chains — סוג לקוח x שנה', `
    EVALUATE
    ADDCOLUMNS(
      SUMMARIZE(
        'ALL_PARTS',
        'ALL_PARTS'[תאור סוג לקוח],
        'ALL_PARTS'[רשתות-שוק פרטי],
        "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
        "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025)
      ),
      "Pct", DIVIDE([Y2025]-[Y2024],[Y2024])
    )
    ORDER BY [Y2025] DESC
  `);

  // 8. Unique client count per agent FORMULA (activity indicator)
  await run('FORMULA — Unique clients per agent 2025 vs 2024', `
    EVALUATE
    ADDCOLUMNS(
      SUMMARIZE(
        FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "FORMULA"),
        'ALL_PARTS'[שם סוכן],
        "Clients2024", CALCULATE(DISTINCTCOUNT('ALL_PARTS'[שם לקוח]), YEAR('ALL_PARTS'[תאריך]) = 2024),
        "Clients2025", CALCULATE(DISTINCTCOUNT('ALL_PARTS'[שם לקוח]), YEAR('ALL_PARTS'[תאריך]) = 2025),
        "Sales2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025)
      ),
      "ClientDelta", [Clients2025] - [Clients2024]
    )
    ORDER BY [Sales2025] DESC
  `);

  // 9. FORMULA top clients 2025 kosher vs non-kosher
  await run('FORMULA — Top 15 clients 2025 (kosher split)', `
    EVALUATE
    TOPN(15,
      SUMMARIZE(
        FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "FORMULA" && YEAR('ALL_PARTS'[תאריך]) = 2025),
        'ALL_PARTS'[שם לקוח],
        'ALL_PARTS'[כשרות],
        'ALL_PARTS'[תאור סוג לקוח],
        "Sales", SUM('ALL_PARTS'[סכום (ש'ח)])
      ),
      [Sales], DESC
    )
  `);

  // 10. FORMULA product family 2024 vs 2025
  await run('FORMULA — Product families 2024 vs 2025', `
    EVALUATE
    ADDCOLUMNS(
      SUMMARIZE(
        FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "FORMULA"),
        'ALL_PARTS'[תאור משפחת מוצר],
        "Y2024", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
        "Y2025", CALCULATE(SUM('ALL_PARTS'[סכום (ש'ח)]), YEAR('ALL_PARTS'[תאריך]) = 2025)
      ),
      "Pct", DIVIDE([Y2025]-[Y2024],[Y2024])
    )
    ORDER BY [Y2025] DESC
  `);

  // 11. 2026 YTD full — all companies by month
  await run('2026 YTD by month — all companies', `
    EVALUATE
    SUMMARIZE(
      FILTER('ALL_PARTS', YEAR('ALL_PARTS'[תאריך]) = 2026),
      'ALL_PARTS'[חברה],
      'ALL_PARTS'[שבוע],
      "Sales", SUM('ALL_PARTS'[סכום (ש'ח)])
    )
    ORDER BY 'ALL_PARTS'[חברה], 'ALL_PARTS'[שבוע]
  `);

  // 12. Look for OBLIGO/DELTA in ALL_PARTS columns
  await run('ASHMADOT column values (obligo related?)', `
    EVALUATE
    TOPN(10, SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[ASHMADOT],
      "Sales", SUM('ALL_PARTS'[סכום (ש'ח)])
    ), [Sales], DESC)
  `);

  // 13. פרמטר 7 values
  await run('פרמטר 7 values', `
    EVALUATE
    TOPN(10, SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[פרמטר 7],
      "Sales", SUM('ALL_PARTS'[סכום (ש'ח)])
    ), [Sales], DESC)
  `);

  // 14. KEY FOR CAT 7 values
  await run('KEY FOR CAT 7 values', `
    EVALUATE
    TOPN(10, SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[KEY FOR CAT 7],
      "Sales", SUM('ALL_PARTS'[סכום (ש'ח)])
    ), [Sales], DESC)
  `);

  // 15. 2026 obligo search — רווח (profit) trend
  await run('FORMULA — profit (רווח) 2024 vs 2025 vs 2026 YTD', `
    EVALUATE
    SUMMARIZE(
      FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "FORMULA"),
      "Y2024_profit", CALCULATE(SUM('ALL_PARTS'[רווח (שח)]), YEAR('ALL_PARTS'[תאריך]) = 2024),
      "Y2025_profit", CALCULATE(SUM('ALL_PARTS'[רווח (שח)]), YEAR('ALL_PARTS'[תאריך]) = 2025),
      "Y2026_profit", CALCULATE(SUM('ALL_PARTS'[רווח (שח)]), YEAR('ALL_PARTS'[תאריך]) = 2026)
    )
  `);

  // 16. 2026 YTD full detail FORMULA — by month + kosher
  await run('FORMULA 2026 YTD — by month x kashrut', `
    EVALUATE
    SUMMARIZE(
      FILTER('ALL_PARTS',
        'ALL_PARTS'[חברה] = "FORMULA" && YEAR('ALL_PARTS'[תאריך]) = 2026
      ),
      "Month", MONTH('ALL_PARTS'[תאריך]),
      'ALL_PARTS'[כשרות],
      "Sales", SUM('ALL_PARTS'[סכום (ש'ח)])
    )
    ORDER BY [Month]
  `);

  console.log('\n✅ Probe complete');
}

probe().catch(console.error);
