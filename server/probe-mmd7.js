require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Test: CALCULATE(measure, DATESBETWEEN) INSIDE SUMMARIZECOLUMNS
  // This way columns like MMD KARTON are not affected by date context
  const y1 = 2026, m1 = 5, d1 = 1;   // May 1
  const y2 = 2026, m2 = 6, d2 = 30;  // June 30

  console.log(`\n=== SKU 732 — CALCULATE inside SUMMARIZE (May-June 2026) ===`);
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          'KARTIS PARIT'[ASHDOD KAARTON],
          'KARTIS PARIT'[MMD KARTON],
          "yamim",    CALCULATE([כמה ימים נשארו],    DATESBETWEEN(DIMCALENDAR[Date], DATE(${y1},${m1},${d1}), DATE(${y2},${m2},${d2}))),
          "mkr",      CALCULATE([מכר ממוצע בשבוע קרטון], DATESBETWEEN(DIMCALENDAR[Date], DATE(${y1},${m1},${d1}), DATE(${y2},${m2},${d2}))),
          "hamlatza", CALCULATE([המלצה להזמנה קרטון],   DATESBETWEEN(DIMCALENDAR[Date], DATE(${y1},${m1},${d1}), DATE(${y2},${m2},${d2})))
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('Result:', JSON.stringify(r, null, 2));
    if (r[0]) {
      console.log('\nSKU 732 yamim =', r[0]['[yamim]'], '(PBI shows 312)');
      console.log('SKU 732 mkr   =', r[0]['[mkr]'],   '(PBI shows 51.7)');
    }
  } catch(e) { console.log('ERR:', e.message.substring(0, 500)); }

  // Also test May only
  console.log(`\n=== SKU 732 — May 2026 only ===`);
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          "yamim", CALCULATE([כמה ימים נשארו], DATESBETWEEN(DIMCALENDAR[Date], DATE(2026,5,1), DATE(2026,5,31))),
          "mkr",   CALCULATE([מכר ממוצע בשבוע קרטון], DATESBETWEEN(DIMCALENDAR[Date], DATE(2026,5,1), DATE(2026,5,31)))
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    if (r[0]) {
      console.log('May yamim =', r[0]['[yamim]'], '| mkr =', r[0]['[mkr]']);
    }
  } catch(e) { console.log('ERR May:', e.message.substring(0, 300)); }
}

probe().catch(e => console.error('FATAL:', e.message));
