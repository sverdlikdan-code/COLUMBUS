require('dotenv').config();
const { executeDax } = require('./server/powerbi');

(async () => {
  // 1. Structure of הזמנות פתוחות table
  console.log('\n=== הזמנות פתוחות — top 3 rows ===');
  try {
    const rows = await executeDax("EVALUATE TOPN(3, 'הזמנות פתוחות')");
    console.log('Columns:', Object.keys(rows[0] || {}));
    rows.forEach(r => console.log(JSON.stringify(r).substring(0, 300)));
  } catch(e) { console.log('Error:', e.message.slice(0, 300)); }

  // 2. MEASURE TABLE — test SPO measure total
  console.log('\n=== MEASURE TABLE — SPO total ===');
  try {
    const rows = await executeDax("EVALUATE ROW(\"spo\", [מלאי +הזמנות פתוחות קרטונים 🚛], \"oo\", [הזמנה פתוחה בקרטונים])");
    console.log(JSON.stringify(rows[0]));
  } catch(e) { console.log('Error:', e.message.slice(0, 300)); }

  // 3. SPO per מק"ט via SUMMARIZECOLUMNS on מלאי-תוקף
  console.log('\n=== SPO via SUMMARIZECOLUMNS KARTIS PARIT ===');
  try {
    const rows = await executeDax(`
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
    rows.forEach(r => console.log(JSON.stringify(r)));
  } catch(e) { console.log('Error:', e.message.slice(0, 300)); }
})();
