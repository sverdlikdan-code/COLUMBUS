require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Check Data MMD table columns
  console.log('\n=== Data MMD columns ===');
  try {
    const r = await executeDax(`EVALUATE TOPN(1, 'Data MMD')`, MMD_DS);
    if (r[0]) console.log(Object.keys(r[0]).join('\n'));
  } catch(e) { console.log('ERR:', e.message.substring(0, 200)); }

  // Try measures with 'Data MMD'[תאריך] filter
  console.log('\n=== מכר קרטון בתקופה — filter on Data MMD[תאריך] ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [מכר קרטון בתקופה]),
          'Data MMD'[תאריך] >= DATE(2026,5,1) && 'Data MMD'[תאריך] <= DATE(2026,6,30)
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('✅ Result:', JSON.stringify(r[0]));
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log('❌ ERR:', (d[1] || e.message).substring(0, 300));
  }

  // Try with MEASURE TABLE prefix
  console.log('\n=== MEASURE TABLE prefix test ===');
  const measures = [
    "'MEASURE TABLE'[מכר קרטון בתקופה]",
    "'MEASURE TABLE'[WEEKS לפח]",
    "'MEASURE TABLE'[ימים שהיה מלאי]",
    "'MEASURE TABLE'[ימי מכר מכלל % מכר]",
  ];
  for (const m of measures) {
    try {
      const r = await executeDax(`
        EVALUATE
        FILTER(
          CALCULATETABLE(
            SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", ${m}),
            'Data MMD'[תאריך] >= DATE(2026,5,1) && 'Data MMD'[תאריך] <= DATE(2026,6,30)
          ),
          'KARTIS PARIT'[מק"ט] = "732"
        )
      `, MMD_DS);
      console.log(`✅ ${m} = ${r[0] ? r[0]['[v]'] : 'null'}`);
    } catch(e) {
      const d = e.message.match(/"value":"([^"]{0,200})"/) || [];
      console.log(`❌ ${m}`);
      console.log(`   ${(d[1] || e.message).substring(0, 200)}`);
    }
  }

  // Also try without KARTIS PARIT — group by Data MMD[מק"ט] instead
  console.log('\n=== Group by Data MMD[מק"ט] ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS('Data MMD'[מק"ט], "v", [מכר קרטון בתקופה]),
          'Data MMD'[תאריך] >= DATE(2026,5,1) && 'Data MMD'[תאריך] <= DATE(2026,6,30)
        ),
        'Data MMD'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('✅ By Data MMD mkt:', JSON.stringify(r[0]));
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,200})"/) || [];
    console.log('❌', (d[1] || e.message).substring(0, 200));
  }
}

probe().catch(e => console.error('FATAL:', e.message));
