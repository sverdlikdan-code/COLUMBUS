require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Find calendar table
  console.log('\n=== PROBE: Calendar tables ===');
  const candidates = ['DimCalendar','DimDate','Calendar','Date','DateDim','CALENDAR','DIMCALENDAR','תקופה'];
  for (const t of candidates) {
    try {
      const r = await executeDax(`EVALUATE TOPN(1, '${t}')`, MMD_DS);
      const keys = Object.keys(r[0] || {});
      console.log(`  '${t}' EXISTS, columns: ${keys.join(', ').substring(0, 200)}`);
    } catch(e) {
      const detail = e.message.match(/"value":"([^"]{0,100})"/) || [];
      if (!detail[1] || !detail[1].includes('cannot be found')) {
        console.log(`  '${t}' ERR: ${(detail[1] || e.message).substring(0,100)}`);
      } else {
        console.log(`  '${t}' not found`);
      }
    }
  }

  // Test with May-June 2026 date filter using CALCULATETABLE
  console.log('\n=== TEST yamim with date filter (CALCULATE approach) ===');
  for (const calTable of ['DimCalendar','Calendar']) {
    try {
      const r = await executeDax(`
        EVALUATE TOPN(3,
          CALCULATETABLE(
            SUMMARIZECOLUMNS(
              'KARTIS PARIT'[מק"ט],
              "yamim", [כמה ימים נשארו],
              "mkr",   [מכר ממוצע בשבוע קרטון]
            ),
            DATESBETWEEN('${calTable}'[Date], DATE(2026,5,1), DATE(2026,6,30)),
            'KARTIS PARIT'[ASHDOD KAARTON] > 0
          )
        )
      `, MMD_DS);
      console.log(`  With '${calTable}' filter OK:`);
      r.forEach(row => console.log('   ', JSON.stringify(row)));
      break;
    } catch(e) {
      console.log(`  '${calTable}' date filter ERR: ${e.message.substring(0,200)}`);
    }
  }
}

probe().catch(e => console.error('FATAL:', e.message));
