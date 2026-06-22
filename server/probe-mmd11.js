require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Check DIMCALENDAR columns
  console.log('\n=== DIMCALENDAR columns ===');
  try {
    const r = await executeDax(`EVALUATE TOPN(1, DIMCALENDAR)`, MMD_DS);
    if (r[0]) console.log(Object.keys(r[0]).join('\n'));
  } catch(e) { console.log('ERR:', e.message.substring(0, 200)); }

  // Try filtering on individual year/month values from DIMCALENDAR
  // This simulates slicer selection by restricting each unique value
  console.log('\n=== מכר קרטון בתקופה via TREATAS ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS(
            'KARTIS PARIT'[מק"ט],
            "v", [מכר קרטון בתקופה]
          ),
          TREATAS(
            SELECTCOLUMNS(
              FILTER(DIMCALENDAR,
                (YEAR(DIMCALENDAR[Date]) = 2026 && MONTH(DIMCALENDAR[Date]) >= 5 && MONTH(DIMCALENDAR[Date]) <= 6)
              ),
              "Date", DIMCALENDAR[Date]
            ),
            DIMCALENDAR[Date]
          )
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('TREATAS result:', JSON.stringify(r[0]));
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log('ERR TREATAS:', (d[1] || e.message).substring(0, 300));
  }

  // Try KEEPFILTERS on year
  console.log('\n=== מכר קרטון בתקופה via KEEPFILTERS year ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS(
            'KARTIS PARIT'[מק"ט],
            "v", [מכר קרטון בתקופה]
          ),
          FILTER(ALL(DIMCALENDAR), DIMCALENDAR[Date] >= DATE(2026,5,1) && DIMCALENDAR[Date] <= DATE(2026,6,30))
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('KEEPFILTERS result:', JSON.stringify(r[0]));
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log('ERR KEEPFILTERS:', (d[1] || e.message).substring(0, 300));
  }

  // Check if there's a תקופה or Period slicer table
  console.log('\n=== Check period tables ===');
  for (const t of ['תקופה','Period','Slicer','PERIOD','שנה','Year']) {
    try {
      const r = await executeDax(`EVALUATE TOPN(1, '${t}')`, MMD_DS);
      console.log(`'${t}' EXISTS:`, Object.keys(r[0] || {}).join(', '));
    } catch(e) {
      const d = e.message.match(/"value":"([^"]{0,80})"/) || [];
      if (!(d[1] || '').includes('cannot be found')) console.log(`'${t}' ERR:`, (d[1] || '').substring(0,80));
    }
  }
}

probe().catch(e => console.error('FATAL:', e.message));
