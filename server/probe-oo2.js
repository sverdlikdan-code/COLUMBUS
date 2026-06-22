require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

async function run(label, dax) {
  console.log(`\n=== ${label} ===`);
  try {
    const rows = await executeDax(dax);
    rows.slice(0, 5).forEach(r => console.log(' ', JSON.stringify(r)));
    if (rows.length > 5) console.log(`  ... (${rows.length} rows)`);
    return rows;
  } catch (e) { console.log('  ERROR:', e.message.slice(0, 500)); return []; }
}

(async () => {
  // Check tables that ARE in pbi-kapua.js
  await run('מלאי-תוקף — top 3 (column names)', `EVALUATE TOPN(3, 'מלאי-תוקף')`);
  await run('OBLIGO — top 3 (column names)', `EVALUATE TOPN(3, 'OBLIGO')`);
  await run('MLAY — top 1 (column names)', `EVALUATE TOPN(1, MLAY)`);

  // Try open orders in OBLIGO
  await run('OBLIGO — top 5 by cartons (all columns)', `
    EVALUATE TOPN(5, OBLIGO, OBLIGO[KARTON], DESC)
  `);

  // Test if measures work with CALCULATE context
  await run('SPO measure via CALCULATE with FORMULA filter', `
    EVALUATE
    ROW(
      "spo", CALCULATE([מלאי +הזמנות פתוחות קרטונים 🚛], 'ALL_PARTS'[חברה] = "FORMULA")
    )
  `);

  // Check all columns in OBLIGO
  await run('OBLIGO columns via TOPN 1', `EVALUATE TOPN(1, OBLIGO)`);

  // Try to find open orders column name in OBLIGO
  await run('OBLIGO — summarize by מק"ט', `
    EVALUATE
    TOPN(5,
      SUMMARIZE(OBLIGO, OBLIGO[מק"ט], "total", SUM(OBLIGO[KARTON])),
      [total], DESC
    )
  `);
})();
