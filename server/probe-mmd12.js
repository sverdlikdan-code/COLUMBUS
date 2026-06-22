require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Maybe the slicer uses DIMCALENDAR[Year] and DIMCALENDAR[Month] columns (not Date)
  // PBI month chip filter = DIMCALENDAR[Year]=2026, DIMCALENDAR[Month] IN {5,6}
  console.log('\n=== מכר קרטון בתקופה — filter on Year+Month columns ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [מכר קרטון בתקופה]),
          DIMCALENDAR[Year] = 2026,
          DIMCALENDAR[Month] IN {5, 6}
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('YEAR+MONTH result:', JSON.stringify(r[0]));
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log('ERR:', (d[1] || e.message).substring(0, 300));
  }

  // Try only Month=5 (May only — what PBI screenshot shows selected)
  console.log('\n=== מכר קרטון בתקופה — May 2026 only ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [מכר קרטון בתקופה]),
          DIMCALENDAR[Year] = 2026,
          DIMCALENDAR[Month] = 5
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('May only result:', JSON.stringify(r[0]));
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log('ERR:', (d[1] || e.message).substring(0, 300));
  }

  // Try WEEKS לפח same way
  console.log('\n=== WEEKS לפח — Year+Month ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [WEEKS לפח]),
          DIMCALENDAR[Year] = 2026,
          DIMCALENDAR[Month] IN {5, 6}
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('WEEKS לפח result:', JSON.stringify(r[0]));
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log('ERR:', (d[1] || e.message).substring(0, 300));
  }

  // ימים שהיה מלאי
  console.log('\n=== ימים שהיה מלאי — Year+Month ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [ימים שהיה מלאי]),
          DIMCALENDAR[Year] = 2026,
          DIMCALENDAR[Month] IN {5, 6}
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('ימים שהיה מלאי result:', JSON.stringify(r[0]));
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log('ERR:', (d[1] || e.message).substring(0, 300));
  }

  // ימי מכר מכלל % מכר
  console.log('\n=== ימי מכר מכלל % מכר — Year+Month ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [ימי מכר מכלל % מכר]),
          DIMCALENDAR[Year] = 2026,
          DIMCALENDAR[Month] IN {5, 6}
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('% מכר result:', JSON.stringify(r[0]));
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log('ERR:', (d[1] || e.message).substring(0, 300));
  }
}

probe().catch(e => console.error('FATAL:', e.message));
