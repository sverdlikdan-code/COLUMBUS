/**
 * build-makat-ean.js
 * Fetches מקט → EAN (ברקוד) from Power BI קרטיס פריט table.
 * Output: ../docs/makat-ean.json
 * Run: node build-makat-ean.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
// Map local AZURE_* names → PBI_* names used by pbi-kapua.js
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const { fetchBarcodes } = require('./pbi-barcode');
const fs   = require('fs');
const path = require('path');

async function main() {
  console.log('Fetching מקט→EAN from Power BI קרטיס פריט...');
  const map = await fetchBarcodes();

  const out = path.join(__dirname, '..', 'docs', 'makat-ean.json');
  fs.writeFileSync(out, JSON.stringify(map, null, 2), 'utf8');
  console.log(`✅  makat-ean.json: ${Object.keys(map).length} מקטים → ${out}`);
}

main().catch(e => { console.error(e); process.exit(1); });
