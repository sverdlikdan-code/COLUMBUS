require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

const tables = [
  'מלאי INT+F+ICE', 'מלאי', 'STOCK', 'Stock', 'מלאי זמין',
  'הזמנות פתוחות', 'הזמנות', 'ORDERS', 'Orders',
  'KARTIS PARIT', 'כרטיס פריט', 'MEASURE TABLE', 'Measures',
  'ALL_PARTS', 'OBLIGO', 'מכירות', 'Sales',
  'מחיר', 'prices', 'PRICES',
];

(async () => {
  console.log('=== TABLE SCAN ===');
  for (const t of tables) {
    try {
      await executeDax(`EVALUATE TOPN(1, '${t}')`);
      console.log(`  ✅ ${t}`);
    } catch(e) {
      const msg = e.message || '';
      if (msg.includes('Cannot find table')) {
        console.log(`  ❌ ${t}`);
      } else {
        console.log(`  ⚠️  ${t} — ${msg.slice(0, 100)}`);
      }
    }
  }

  // Test SPO measure via ROW - only spo (no oo)
  console.log('\n=== ROW() — spo measure only ===');
  try {
    const r = await executeDax(`EVALUATE ROW("spo", [מלאי +הזמנות פתוחות קרטונים 🚛])`);
    console.log(JSON.stringify(r[0]));
  } catch(e) { console.log('ERROR:', e.message.slice(0, 300)); }

  // Test all SUMMARIZECOLUMNS on KARTIS PARIT with only spo
  console.log('\n=== SUMMARIZECOLUMNS KARTIS PARIT — spo only, top 5 ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      TOPN(5,
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          "spo", [מלאי +הזמנות פתוחות קרטונים 🚛]
        ),
        [spo], DESC
      )
    `);
    rows.forEach(r => console.log(' ', JSON.stringify(r)));
  } catch(e) { console.log('ERROR:', e.message.slice(0, 300)); }
})();
