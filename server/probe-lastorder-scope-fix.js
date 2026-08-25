require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

(async () => {
  const famRows = await executeDax(`
EVALUATE
ADDCOLUMNS(
  SUMMARIZE(ALL_PARTS, ALL_PARTS[תאור משפחת מוצר]),
  "מחלקה", LOOKUPVALUE(ADIFUT[מחלקה], ADIFUT[תאור משפחה], ALL_PARTS[תאור משפחת מוצר])
)
`);
  const LASTORDER_INTER_CATS = new Set(['מדף', 'מתוקים  🍬']);
  const classify = (machlaka) => {
    if (!machlaka) return null;
    if (machlaka.includes('mish')) return 'ICE_MISH';
    if (machlaka.includes('bdd')) return 'ICE_BDD';
    if (LASTORDER_INTER_CATS.has(machlaka)) return 'INTER';
    return 'FORMULA';
  };
  const counts = {};
  for (const r of famRows) {
    const co = classify(r['[מחלקה]'] || '') || 'null';
    counts[co] = (counts[co] || 0) + 1;
  }
  console.log('Family counts by company:', counts);

  const lastOrderFamilies = famRows
    .filter(r => ['FORMULA', 'ICE_MISH'].includes(classify(r['[מחלקה]'] || '')))
    .map(r => r['ALL_PARTS[תאור משפחת מוצר]'])
    .filter(Boolean);
  console.log('lastOrderFamilies count:', lastOrderFamilies.length, '/', famRows.length);

  const escFam = f => `"${String(f).replace(/"/g, '""')}"`;
  const famFilter = `ALL_PARTS[תאור משפחת מוצר] IN {${lastOrderFamilies.map(escFam).join(', ')}}`;

  const unscoped = await executeDax(`
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]), "lastOrderDate", CALCULATE(MAX(ALL_PARTS[תאריך]))),
  ALL_PARTS[מספר לקוח] = "1151726"
)
`);
  const scoped = await executeDax(`
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]), "lastOrderDate", CALCULATE(MAX(ALL_PARTS[תאריך]))),
  ${famFilter},
  ALL_PARTS[ASHMADOT] = "-מכר-",
  ALL_PARTS[מספר לקוח] = "1151726"
)
`);
  console.log('UNSCOPED (bug, includes ICE_BDD):', JSON.stringify(unscoped));
  console.log('SCOPED (fixed, FORMULA+ICE_MISH only):', JSON.stringify(scoped));
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
