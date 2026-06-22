require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Check DIMCALENDAR Month Name and Month-Year values for May/June 2026
  console.log('\n=== DIMCALENDAR May-June 2026 values ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        SELECTCOLUMNS(DIMCALENDAR,
          "Date",       DIMCALENDAR[Date],
          "Year",       DIMCALENDAR[Year],
          "Month",      DIMCALENDAR[Month],
          "MonthName",  DIMCALENDAR[Month Name],
          "MonthYear",  DIMCALENDAR[Month-Year]
        ),
        DIMCALENDAR[Year] = 2026 && DIMCALENDAR[Month] IN {5, 6}
      )
      ORDER BY DIMCALENDAR[Date] ASC
    `, MMD_DS);
    // Show first 3 rows only
    r.slice(0,3).forEach(row => console.log(JSON.stringify(row)));
    console.log('... total', r.length, 'rows');
    console.log('Month Name sample:', r[0] ? r[0]['[MonthName]'] : '?');
    console.log('Month-Year sample:', r[0] ? r[0]['[MonthYear]'] : '?');
  } catch(e) { console.log('ERR:', e.message.substring(0,200)); }

  // Now try filtering on Month-Year string
  const monthYearVals = ['May 2026', 'Jun 2026', 'June 2026', 'מאי 2026', 'יון 2026'];
  for (const mv of monthYearVals) {
    try {
      const r = await executeDax(`
        EVALUATE
        FILTER(
          CALCULATETABLE(
            SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [מכר קרטון בתקופה]),
            DIMCALENDAR[Month-Year] = "${mv}"
          ),
          'KARTIS PARIT'[מק"ט] = "732"
        )
      `, MMD_DS);
      console.log(`✅ Month-Year="${mv}" → ${JSON.stringify(r[0])}`);
    } catch(e) {
      const d = e.message.match(/"value":"([^"]{0,100})"/) || [];
      console.log(`❌ Month-Year="${mv}" → ${(d[1] || '').substring(0,80)}`);
    }
  }

  // Try Month Name filter
  const monthNames = ['May', 'June', 'מאי', 'יוני', 'יון'];
  for (const mn of monthNames) {
    try {
      const r = await executeDax(`
        EVALUATE
        FILTER(
          CALCULATETABLE(
            SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [מכר קרטון בתקופה]),
            DIMCALENDAR[Month Name] = "${mn}",
            DIMCALENDAR[Year] = 2026
          ),
          'KARTIS PARIT'[מק"ט] = "732"
        )
      `, MMD_DS);
      console.log(`✅ Month Name="${mn}" → ${JSON.stringify(r[0])}`);
    } catch(e) {
      const d = e.message.match(/"value":"([^"]{0,100})"/) || [];
      console.log(`❌ Month Name="${mn}" → ${(d[1] || '').substring(0,80)}`);
    }
  }
}

probe().catch(e => console.error('FATAL:', e.message));
