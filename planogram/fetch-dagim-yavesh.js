require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const { getToken } = require('./pbi-kapua');
const { fixVisualRTL } = require('./build-planogram');

async function main() {
  const t = await getToken();
  const WORKSPACE = process.env.PBI_WORKSPACE;
  const DATASET   = process.env.PBI_DATASET;

  async function dax(query) {
    const res = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE}/datasets/${DATASET}/executeQueries`,
      { method:'POST', headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json'},
        body: JSON.stringify({ queries:[{query}], serializerSettings:{includeNulls:false} }) }
    );
    const j = await res.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j?.results?.[0]?.tables?.[0]?.rows || [];
  }

  // Makatim + descriptions
  const mkRows = await dax(`
    EVALUATE
    SELECTCOLUMNS(
      FILTER('KARTIS PARIT',
        'KARTIS PARIT'[סטטוס] = "פעיל" &&
        'KARTIS PARIT'[שם מחסן אשדוד] = "דג יבש 🐠"
      ),
      "makat",  'KARTIS PARIT'[מק"ט],
      "name",   'KARTIS PARIT'[תאור],
      "famCode",'KARTIS PARIT'[משפחת מוצר],
      "fam",    'KARTIS PARIT'[תאור משפחה]
    )
    ORDER BY 'KARTIS PARIT'[משפחת מוצר], 'KARTIS PARIT'[מק"ט]
  `);

  const yaveshMkats = mkRows.map(r => `"${r['[makat]']}"`).join(',');

  // Stock at Main
  const stockRows = !yaveshMkats.length ? [] : await dax(`
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      FILTER(
        'מלאי-תוקף',
        'מלאי-תוקף'[מחסן] = "Main" &&
        CONTAINSROW({${yaveshMkats}}, 'מלאי-תוקף'[מק"ט])
      ),
      "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
    )
  `);

  const stockMap = {};
  for (const r of stockRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (mk) stockMap[String(mk)] = r['[stock]'] || 0;
  }

  console.log(`\nTotal dry-fish products: ${mkRows.length}`);
  console.log('');

  const byFam = {};
  for (const r of mkRows) {
    const mk      = String(r['[makat]'] || '');
    const desc    = r['[name]'] || '';
    const famCode = r['[famCode]'] || '';
    const famName = r['[fam]'] || '';
    if (!byFam[famCode]) byFam[famCode] = { name: famName, items: [] };
    byFam[famCode].items.push({ mk, desc, stock: stockMap[mk] ?? null });
  }

  for (const [fam, data] of Object.entries(byFam)) {
    console.log(`\n=== ${fam} | ${data.name} (${data.items.length} products) ===`);
    for (const item of data.items) {
      const stk = item.stock != null ? `stock:${item.stock}` : 'no-stock-data';
      console.log(`  ${item.mk} | ${item.desc} | ${stk}`);
    }
  }
}

main().catch(e => console.error(e.message));
