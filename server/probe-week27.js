require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

(async () => {
  // Week 27 of 2026 = Jun 29 – Jul 5, 2026
  const rows = await executeDax(`
    EVALUATE
    TOPN(
      50,
      FILTER(
        SUMMARIZECOLUMNS(
          'לקוחות'[שם לקוח],
          'לקוחות'[תאור סוג לקוח],
          KEEPFILTERS(FILTER('KARTIS PARIT', 'KARTIS PARIT'[מק"ט] = "604")),
          "mkr_k", CALCULATE(
            [מכר קרטון],
            DATESBETWEEN(DIMCALENDAR[Date], DATE(2026,6,29), DATE(2026,7,5))
          )
        ),
        [mkr_k] > 0
      ),
      [mkr_k], DESC
    )
  `, MMD_DS);

  console.log('\n=== מק"ט 604 | שבוע 27 (29/06–05/07/2026) | לפי לקוח ===\n');
  rows.forEach(r => {
    const name = (r['לקוחות[שם לקוח]'] || '').padEnd(35);
    const type = (r['לקוחות[תאור סוג לקוח]'] || '').padEnd(20);
    const qty  = Math.round(r['[mkr_k]']);
    console.log(qty + ' קרט\t' + name + type);
  });
  const total = rows.reduce((s, r) => s + (r['[mkr_k]'] || 0), 0);
  console.log('\nסה"כ:', Math.round(total), 'קרט |', rows.length, 'לקוחות');
})().catch(e => { console.error(e.message.slice(0, 600)); process.exit(1); });
