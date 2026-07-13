require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { executeDax } = require('./powerbi');

async function run() {
  const DS = process.env.POWERBI_MMD_DATASET_ID;

  // Check if [כמות לקוחות] varies per product
  console.log('--- כמות לקוחות per product ---');
  try {
    var r = await executeDax(`
      EVALUATE
      TOPN(5,
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          "pct", [% לקוחות],
          "active", [לקוחות פעילים],
          "kama", [כמות לקוחות]
        ),
        [% לקוחות], DESC
      )
    `, DS);
    r.forEach(function(row) { console.log(JSON.stringify(row)); });
  } catch(e) { console.log('ERR:', e.message.slice(0,120)); }
}
run().catch(console.error);
