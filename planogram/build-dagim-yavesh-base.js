/**
 * Generates docs/dagim-yavesh-base.json
 * Products for the dry-fish (דג יבש) editor tab.
 * Families: 03=KAZAHSTAN, 031=RUSSIA, 032=פודסטוק, 034=RUSSIAN SEA
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const { getToken } = require('./pbi-kapua');
const fs   = require('fs');
const path = require('path');

// Visual-RTL fix + strip Unicode directional markers
function fixVisualRTL(s) {
  // Strip Unicode directional formatting characters
  s = s.replace(/[‎‏‪-‮⁦-⁩]/g, '');
  const full = s.split('').reverse().join('');
  return full.replace(/[\x20-\x7E]+/g, m => m.split('').reverse().join('')).trim();
}

const FAM_CODE_TO_NAME = {
  '03':  'דגים KAZAHSTAN',
  '031': 'דגים RUSSIA',
  '032': 'דגים פודסטוק',
  '034': 'דגים RUSSIAN SEA',
};

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

  const famCodes = '"03","031","032","034"';

  const rows = await dax(`
    EVALUATE
    SUMMARIZECOLUMNS(
      MLAY[מק'ט],
      MLAY[תאור מוצר],
      MLAY[משפחת מוצר],
      FILTER(MLAY, CONTAINSROW({${famCodes}}, MLAY[משפחת מוצר]))
    )
    ORDER BY MLAY[משפחת מוצר], MLAY[מק'ט]
  `);

  // Assign pick numbers sequentially within each family (families in order)
  const famOrder = ['03', '031', '032', '034'];
  const byFam = {};
  famOrder.forEach(f => byFam[f] = []);

  for (const r of rows) {
    const mk   = String(r["MLAY[מק'ט]"] || '').trim();
    const desc = fixVisualRTL((r["MLAY[תאור מוצר]"] || '').trim());
    const fam  = String(r["MLAY[משפחת מוצר]"] || '').trim();
    if (!mk || !byFam[fam]) continue;
    byFam[fam].push({ makat: mk, fam: FAM_CODE_TO_NAME[fam] || fam, name: desc });
  }

  // Build sequential pick map
  const result = {}; // pick → {makat, fam, name}
  let pick = 1;
  for (const fam of famOrder) {
    for (const item of byFam[fam]) {
      result[pick++] = item;
    }
  }

  const out = path.join(__dirname, '..', 'docs', 'dagim-yavesh-base.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');

  console.log(`dagim-yavesh-base.json: ${Object.keys(result).length} products`);
  for (const fam of famOrder) {
    console.log(`  ${FAM_CODE_TO_NAME[fam]}: ${byFam[fam].length} products`);
  }
  console.log(`→ ${out}`);
}

main().catch(e => { console.error(e); process.exit(1); });
