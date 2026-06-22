require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Check SKU 732 specifically with date filter
  console.log('\n=== SKU 732 with date filter May-June 2026 ===');
  try {
    const r = await executeDax(`
      EVALUATE
      CALCULATETABLE(
        FILTER(
          SUMMARIZECOLUMNS(
            'KARTIS PARIT'[מק"ט],
            "yamim",   [כמה ימים נשארו],
            "mkr",     [מכר ממוצע בשבוע קרטון],
            "mkr_tk",  [מכר קרטון בתקופה],
            "hamlatza",[המלצה להזמנה קרטון],
            "ashdod",  'KARTIS PARIT'[ASHDOD KAARTON],
            "mmd",     'KARTIS PARIT'[MMD KARTON]
          ),
          'KARTIS PARIT'[מק"ט] = "732"
        ),
        DATESBETWEEN(DIMCALENDAR[Date], DATE(2026,5,1), DATE(2026,6,30))
      )
    `, MMD_DS);
    console.log('SKU 732:', JSON.stringify(r, null, 2));
  } catch(e) { console.log('ERR:', e.message.substring(0,400)); }

  // Check current month only
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const lastDay = new Date(y, m, 0).getDate();
  console.log(`\n=== SKU 732 current month only (${y}-${String(m).padStart(2,'0')}) ===`);
  try {
    const r = await executeDax(`
      EVALUATE
      CALCULATETABLE(
        FILTER(
          SUMMARIZECOLUMNS(
            'KARTIS PARIT'[מק"ט],
            "yamim",  [כמה ימים נשארו],
            "mkr",    [מכר ממוצע בשבוע קרטון]
          ),
          'KARTIS PARIT'[מק"ט] = "732"
        ),
        DATESBETWEEN(DIMCALENDAR[Date], DATE(${y},${m},1), DATE(${y},${m},${lastDay}))
      )
    `, MMD_DS);
    console.log('SKU 732 cur month:', JSON.stringify(r));
  } catch(e) { console.log('ERR:', e.message.substring(0,300)); }
}

probe().catch(e => console.error('FATAL:', e.message));
