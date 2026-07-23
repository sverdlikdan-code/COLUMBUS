require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');

const ICE_DS = 'dd051b51-c6b9-4292-a96a-a094fddbc4a0';
const FORMULA_DS = process.env.POWERBI_DATASET_ID;

async function probe() {
  // 1. פרמטר 18 values in ICE (for secondary-agent clients)
  console.log('=== ICE פרמטר 18 values ===');
  const r1 = await executeDax(`
EVALUATE
SUMMARIZE(
  FILTER('MISHPAHTI ICE MISHTAH',
    LEN('MISHPAHTI ICE MISHTAH'[שם סוכן נוסף]) > 0
  ),
  'MISHPAHTI ICE MISHTAH'[פרמטר 18],
  "cnt", COUNTROWS('MISHPAHTI ICE MISHTAH')
)`, ICE_DS);
  r1.sort((a,b) => b['[cnt]']-a['[cnt]'])
    .forEach(r => console.log(`  "${r['MISHPAHTI ICE MISHTAH[פרמטר 18]']}" → ${r['[cnt]']} clients`));

  // 2. פרמטר 7 values in Formula meshtat
  console.log('\n=== Formula משטח פרמטר 7 values ===');
  const r2 = await executeDax(`
EVALUATE
SUMMARIZE('משטח',
  'משטח'[פרמטר 7],
  "cnt", COUNTROWS('משטח')
)`, FORMULA_DS);
  r2.sort((a,b) => b['[cnt]']-a['[cnt]'])
    .forEach(r => console.log(`  "${r['משטח[פרמטר 7]']}" → ${r['[cnt]']} clients`));

  // 3. Sample ICE row with פרמטר 18 for a specific agent (code 234 = מרגריטה, most ICE new)
  console.log('\n=== ICE sample — agent 234 + פרמטר 18 ===');
  const r3 = await executeDax(`
EVALUATE
TOPN(5,
  SELECTCOLUMNS(
    FILTER('MISHPAHTI ICE MISHTAH',
      'MISHPAHTI ICE MISHTAH'[מס.סוכן נוסף] = 234
    ),
    "cust", 'MISHPAHTI ICE MISHTAH'[מס. לקוח],
    "city", 'MISHPAHTI ICE MISHTAH'[עיר],
    "p18",  'MISHPAHTI ICE MISHTAH'[פרמטר 18]
  )
)`, ICE_DS);
  r3.forEach(r => console.log(`  ${r['[cust]']} | ${r['[city]']} | day=${r['[p18]']}`));
}

probe().catch(e => console.error(e.message));
