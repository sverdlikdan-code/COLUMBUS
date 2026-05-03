require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

async function main() {
  console.log('Testing GPS columns in Fabric...\n');

  // Test 1: check columns in לקוחות FORM+I+INT
  const dax = `
EVALUATE
TOPN(3,
  SELECTCOLUMNS(
    FILTER('לקוחות FORM+I+INT',
      'לקוחות FORM+I+INT'[קו רוחב] <> BLANK() &&
      'לקוחות FORM+I+INT'[קו אורך] <> BLANK()
    ),
    "custId", 'לקוחות FORM+I+INT'[מס. לקוח],
    "custName", 'לקוחות FORM+I+INT'[שם לקוח],
    "lat", 'לקוחות FORM+I+INT'[קו רוחב],
    "lng", 'לקוחות FORM+I+INT'[קו אורך]
  )
)
  `;

  try {
    const rows = await executeDax(dax);
    if (rows.length === 0) {
      console.log('❌ GPS columns exist but all values are BLANK — refresh may not have run yet');
    } else {
      console.log(`✅ GPS found! ${rows.length} rows with coordinates:`);
      rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
    }
  } catch (e) {
    if (e.message.includes('קו רוחב') || e.message.includes('column')) {
      console.log('❌ Columns קו רוחב / קו אורך not found in table — publish may not be complete');
    }
    console.error('Error:', e.message);
  }
}

main();
