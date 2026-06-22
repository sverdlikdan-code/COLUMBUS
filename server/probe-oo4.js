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
  // FOUND in screenshot: הזמנות רכש פתוחות (not הזמנות פתוחות)
  await run('הזמנות רכש פתוחות — top 3', `EVALUATE TOPN(3, 'הזמנות רכש פתוחות')`);

  // Open orders per מק"ט (cartons)
  await run('הזמנות רכש פתוחות — sum by מק"ט, top 10', `
    EVALUATE
    TOPN(10,
      SUMMARIZE(
        'הזמנות רכש פתוחות',
        'הזמנות רכש פתוחות'[מק"ט],
        "oo_units", SUM('הזמנות רכש פתוחות'[כמות בהזמנה])
      ),
      [oo_units], DESC
    )
  `);

  // גורם אירוז — pack factor table
  await run('גורם אירוז — top 3', `EVALUATE TOPN(3, 'גורם אירוז')`);

  // MLAY all columns for one product with stock > 0
  await run('MLAY — all columns for מק"ט 732 (butter)', `
    EVALUATE FILTER(MLAY, MLAY[מק'ט] = "732")
  `);

  // MLAY מלאי זמין for planogram products — top 10
  await run('MLAY — top 10 frozen/butter products by מלאי זמין', `
    EVALUATE
    TOPN(10,
      FILTER(MLAY,
        MLAY[משפחת מוצר] = "029" ||
        MLAY[משפחת מוצר] = "022" ||
        MLAY[משפחת מוצר] = "019" ||
        MLAY[משפחת מוצר] = "004"
      ),
      MLAY[מלאי זמין], DESC
    )
  `);

  // MLAY + open orders join for a product
  await run('MLAY + OO join for מק"ט 732', `
    EVALUATE
    ADDCOLUMNS(
      FILTER(MLAY, MLAY[מק'ט] = "732"),
      "oo_units", CALCULATE(SUM('הזמנות רכש פתוחות'[כמות בהזמנה]), 'הזמנות רכש פתוחות'[מק"ט] = MLAY[מק'ט])
    )
  `);
})();
