require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { executeDax } = require('../server/powerbi');

(async () => {
  const dax = `
EVALUATE
TOPN(20,
  SELECTCOLUMNS(
    FILTER('משטח', 'משטח'[כתובת] <> BLANK()),
    "id",     'משטח'[מס. לקוח],
    "city",   'משטח'[עיר],
    "addrM",  'משטח'[כתובת],
    "addrFI", CALCULATE(FIRSTNONBLANK('לקוחות FORM+I+INT'[כתובת],1), FILTER('לקוחות FORM+I+INT','לקוחות FORM+I+INT'[מס. לקוח]='משטח'[מס. לקוח]))
  )
)`;
  const rows = await executeDax(dax);
  let same = 0, diff = 0, noFI = 0;
  rows.forEach(r => {
    const m  = (r['[addrM]']  || '').trim();
    const fi = (r['[addrFI]'] || '').trim();
    if (!fi) { noFI++; console.log(`NO_FI [${r['[id]']}] ${r['[city]']} | משטח: ${m}`); }
    else if (m !== fi) { diff++; console.log(`DIFF  [${r['[id]']}] ${r['[city]']}\n  משטח:    ${m}\n  F+I+INT: ${fi}`); }
    else { same++; }
  });
  console.log(`\nSAME: ${same}  DIFF: ${diff}  NO_FI: ${noFI}`);
})().catch(e => console.error(e.message));
