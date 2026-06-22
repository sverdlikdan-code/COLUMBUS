require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

async function run(label, dax) {
  console.log(`\n=== ${label} ===`);
  try {
    const rows = await executeDax(dax);
    rows.slice(0, 10).forEach(r => console.log(' ', JSON.stringify(r)));
    if (rows.length > 10) console.log(`  ... (${rows.length} total rows)`);
    return rows;
  } catch (e) { console.log('  ERROR:', e.message.slice(0, 400)); return []; }
}

(async () => {
  // 1. Structure of הזמנות פתוחות table
  await run('הזמנות פתוחות — top 3 rows (columns check)', `EVALUATE TOPN(3, 'הזמנות פתוחות')`);

  // 2. Total measures via ROW() — do they return any values at all?
  await run('MEASURE totals via ROW()', `EVALUATE ROW("spo", [מלאי +הזמנות פתוחות קרטונים 🚛], "oo", [הזמנה פתוחה בקרטונים])`);

  // 3. SUMMARIZECOLUMNS on KARTIS PARIT — top 5 by spo
  await run('SUMMARIZECOLUMNS KARTIS PARIT — top 5 by spo', `
    EVALUATE
    TOPN(5,
      SUMMARIZECOLUMNS(
        'KARTIS PARIT'[מק"ט],
        "spo", [מלאי +הזמנות פתוחות קרטונים 🚛],
        "oo",  [הזמנה פתוחה בקרטונים]
      ),
      [spo], DESC
    )
  `);

  // 4. Direct query on מלאי INT+F+ICE table
  await run('מלאי INT+F+ICE — top 3 rows (columns check)', `EVALUATE TOPN(3, 'מלאי INT+F+ICE')`);

  // 5. Direct query on הזמנות פתוחות — sum by מק"ט
  await run('הזמנות פתוחות — sum KARTON by מק"ט, top 5', `
    EVALUATE
    TOPN(5,
      SUMMARIZE(
        'הזמנות פתוחות',
        'הזמנות פתוחות'[מק"ט],
        "oo", SUM('הזמנות פתוחות'[KARTON הזמנות פתוחות])
      ),
      [oo], DESC
    )
  `);
})();
