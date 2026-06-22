require('dotenv').config();
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  console.log('\n=== PROBE 1: KARTIS PARIT top 1 row (all columns) ===');
  try {
    const rows = await executeDax(`EVALUATE TOPN(1, 'KARTIS PARIT')`, MMD_DS);
    if (rows.length) {
      const keys = Object.keys(rows[0]);
      keys.forEach(k => console.log('  COL:', k, '=', rows[0][k]));
    }
  } catch(e) { console.log('ERR:', e.message); }

  console.log('\n=== PROBE 2: Test measure כמה ימים נשארו ===');
  try {
    const rows = await executeDax(`
      EVALUATE TOPN(5,
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          "yamim", [כמה ימים נשארו]
        )
      )
    `, MMD_DS);
    rows.forEach(r => console.log('  ', JSON.stringify(r)));
  } catch(e) { console.log('ERR:', e.message); }

  console.log('\n=== PROBE 3: Test measure מכר קרטון בתקופה ===');
  try {
    const rows = await executeDax(`
      EVALUATE TOPN(5,
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          "mkr_tk", [מכר קרטון בתקופה]
        )
      )
    `, MMD_DS);
    rows.forEach(r => console.log('  ', JSON.stringify(r)));
  } catch(e) { console.log('ERR:', e.message); }

  console.log('\n=== PROBE 4: Test column תוכף ASHDOD ===');
  try {
    const rows = await executeDax(`
      EVALUATE TOPN(5,
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          'KARTIS PARIT'[תוכף ASHDOD]
        )
      )
    `, MMD_DS);
    rows.forEach(r => console.log('  ', JSON.stringify(r)));
  } catch(e) { console.log('ERR COLUMN תוכף ASHDOD:', e.message); }

  console.log('\n=== PROBE 5: MEASURE TABLE columns ===');
  try {
    const rows = await executeDax(`EVALUATE TOPN(1, 'MEASURE TABLE')`, MMD_DS);
    if (rows.length) {
      const keys = Object.keys(rows[0]);
      keys.forEach(k => console.log('  MT COL:', k));
    }
  } catch(e) { console.log('ERR:', e.message); }

  console.log('\n=== PROBE 6: All available measures via INFO ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      SELECTCOLUMNS(
        INFO.MEASURES(),
        "TableName", [TableName],
        "Name", [Name],
        "Expression", [Expression]
      )
    `, MMD_DS);
    rows.forEach(r => {
      if (r['[Name]'] && (
        r['[Name]'].includes('ימים') ||
        r['[Name]'].includes('מכר') ||
        r['[Name]'].includes('מלאי') ||
        r['[Name]'].includes('ASHDOD') ||
        r['[Name]'].includes('קרטון') ||
        r['[Name]'].includes('MMD') ||
        r['[Name]'].includes('EILAT') ||
        r['[Name]'].includes('המלצה')
      )) {
        console.log(`  [${r['[TableName]']}] ${r['[Name]']}`);
        if (r['[Expression]']) console.log(`    = ${r['[Expression]'].substring(0, 120)}`);
      }
    });
  } catch(e) { console.log('ERR INFO.MEASURES:', e.message); }
}

probe().catch(console.error);
