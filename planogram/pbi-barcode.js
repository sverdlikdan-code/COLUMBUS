/**
 * pbi-barcode.js
 * Fetches מקט → EAN (ברקוד) mapping from Power BI — table "kartis parit".
 * Returns object: { "732": "4810168045616", ... }
 */
const { getToken } = require('./pbi-kapua');

async function fetchBarcodes() {
  const token     = await getToken();
  const WORKSPACE = process.env.PBI_WORKSPACE;
  const DATASET   = process.env.PBI_DATASET;

  // Table: "kartis parit" | Columns: [מק"ט], [ברקוד]
  const dax = `
    EVALUATE
    SELECTCOLUMNS(
      FILTER(
        'kartis parit',
        NOT ISBLANK('kartis parit'[ברקוד]) &&
        NOT ISBLANK('kartis parit'[מק"ט])
      ),
      "makat",   'kartis parit'[מק"ט],
      "barcode", 'kartis parit'[ברקוד]
    )
  `;

  const url = `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE}/datasets/${DATASET}/executeQueries`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: false } }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PBI barcode query ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = await res.json();
  const rows = json?.results?.[0]?.tables?.[0]?.rows || [];
  const map  = {};

  for (const row of rows) {
    // DAX returns columns as "[alias]" keys
    const makat   = String(row['[makat]']   || row['makat']   || '').trim();
    const barcode = String(row['[barcode]'] || row['barcode'] || '').trim();
    if (makat && barcode && barcode.length >= 8) map[makat] = barcode;
  }

  console.log(`Barcodes from BI: ${Object.keys(map).length} מקטים`);
  return map;
}

module.exports = { fetchBarcodes };
