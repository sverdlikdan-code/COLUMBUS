require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Data MMD has מק'ט (single quote) and KARTON column
  // PBI shows מכר קרטון בתקופה=310 for SKU 732 (May+June 2026)
  // Test: SUM(Data MMD[KARTON]) for period
  console.log(`\n=== SUM(KARTON) May-June 2026 for SKU 732 ===`);
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS(
            'Data MMD'[מק'ט],
            "mkr_tk",   SUM('Data MMD'[KARTON]),
            "mkr_yach", SUM('Data MMD'[כמות ביח' מפעל])
          ),
          'Data MMD'[תאריך] >= DATE(2026,5,1),
          'Data MMD'[תאריך] <= DATE(2026,6,30)
        ),
        'Data MMD'[מק'ט] = "732"
      )
    `, MMD_DS);
    console.log('Result:', JSON.stringify(r[0]));
    console.log('→ PBI shows מכר קרטון בתקופה=310 — does KARTON match?');
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log('ERR:', (d[1] || e.message).substring(0, 300));
  }

  // Also try via KARTIS PARIT grouping with RELATED
  console.log(`\n=== SUM via KARTIS PARIT grouping ===`);
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        CALCULATETABLE(
          SUMMARIZECOLUMNS(
            'KARTIS PARIT'[מק"ט],
            "mkr_tk",   CALCULATE(SUM('Data MMD'[KARTON]),   DATESBETWEEN('Data MMD'[תאריך], DATE(2026,5,1), DATE(2026,6,30))),
            "yamim_ok", MIN('תוקף FORM'[כמה ימים נשארו]),
            "shavuot",  [לכמה שבועות יספיק המלאי]
          ),
          'KARTIS PARIT'[ASHDOD KAARTON] > 0
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    console.log('Result:', JSON.stringify(r[0]));
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log('ERR:', (d[1] || e.message).substring(0, 300));
  }

  // Check what other columns exist in Data MMD that might be WEEKS לפח etc.
  console.log('\n=== All Data MMD unique column names ===');
  try {
    const r = await executeDax(`EVALUATE TOPN(1, 'Data MMD')`, MMD_DS);
    if (r[0]) Object.keys(r[0]).forEach(k => console.log(' ', k));
  } catch(e) { console.log('ERR:', e.message.substring(0, 100)); }
}

probe().catch(e => console.error('FATAL:', e.message));
