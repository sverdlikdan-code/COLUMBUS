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
  // MLAY full column list + a product with stock
  await run('MLAY — product 1009 (BUTTER with likely stock)', `
    EVALUATE FILTER(MLAY, MLAY[מק'ט] = "1009")
  `);

  // MLAY top 5 by מלאי זמין
  await run('MLAY — top 5 by מלאי זמין', `
    EVALUATE TOPN(5, MLAY, MLAY[מלאי זמין], DESC)
  `);

  // Search for open orders table candidates
  const candidates = [
    'הזמנות רכש', 'הזמנות פתוחות', 'open orders', 'PO', 'oo', 'OO',
    'ORDERS', 'הזמנה', 'PURCHASE', 'purchase',
    'KARTIS PARIT FULL', 'MAHSAN', 'מחסן',
    'מלאי+הזמנות', 'מלאי הזמנות',
    'FORMULA_STOCK', 'formula_stock',
    'STOCK_OO', 'SPO', 'spo',
    'KAPUA', 'kapua', 'קפוא',
  ];
  console.log('\n=== TABLE SCAN — more candidates ===');
  for (const t of candidates) {
    try {
      await executeDax(`EVALUATE TOPN(1, '${t}')`);
      console.log(`  ✅ ${t}`);
    } catch(e) {
      const m = e.message || '';
      if (!m.includes('Cannot find table')) console.log(`  ⚠️ ${t} — ${m.slice(0,120)}`);
    }
  }

  // KARTIS PARIT — find all columns
  await run('KARTIS PARIT — top 1 row (all columns)', `EVALUATE TOPN(1, 'KARTIS PARIT')`);

  // MLAY — search for הזמנות column
  await run('MLAY — row for product that has מלאי זמין > 0', `
    EVALUATE TOPN(1, FILTER(MLAY, MLAY[מלאי זמין] > 0), MLAY[מלאי זמין], DESC)
  `);
})();
