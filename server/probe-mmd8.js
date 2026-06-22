require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Check תוקף FORM table structure
  console.log('\n=== תוקף FORM columns ===');
  try {
    const r = await executeDax(`EVALUATE TOPN(3, 'תוקף FORM')`, MMD_DS);
    if (r[0]) console.log('columns:', Object.keys(r[0]).join(', '));
    r.forEach(row => console.log(JSON.stringify(row)));
  } catch(e) { console.log('ERR:', e.message.substring(0, 300)); }

  // Get MIN days for SKU 732 exactly as PBI does
  console.log('\n=== SKU 732 — MIN from תוקף FORM ===');
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        SUMMARIZECOLUMNS(
          'תוקף FORM'[מק'ט],
          "yamim_min", MINX(
            KEEPFILTERS(VALUES('תוקף FORM'[מק'ט])),
            CALCULATE(MIN('תוקף FORM'[כמה ימים נשארו]))
          )
        ),
        'תוקף FORM'[מק'ט] = "732"
      )
    `, MMD_DS);
    console.log('Result:', JSON.stringify(r));
  } catch(e) { console.log('ERR:', e.message.substring(0, 400)); }

  // Simpler: just MIN directly
  console.log('\n=== SKU 732 — simple MIN ===');
  try {
    const r = await executeDax(`
      EVALUATE
      SUMMARIZECOLUMNS(
        'תוקף FORM'[מק'ט],
        FILTER('תוקף FORM', 'תוקף FORM'[מק'ט] = "732"),
        "yamim", MIN('תוקף FORM'[כמה ימים נשארו])
      )
    `, MMD_DS);
    console.log('Simple MIN:', JSON.stringify(r));
  } catch(e) { console.log('ERR simple:', e.message.substring(0, 400)); }
}

probe().catch(e => console.error('FATAL:', e.message));
