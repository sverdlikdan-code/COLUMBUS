/**
 * Enriches docs/product-data.json with desc, packFactor, weightCarton
 * from FORMULA PALLETS.xlsx (local, no BI needed).
 *
 * Fields added per makat:
 *   desc        = תאור מוצר (col3)
 *   packFactor  = גורם אריז parsed from desc "(N)" — units per carton
 *   weightCarton = weight * packFactor (kg per carton)
 *
 * Run: node enrich-product-data.js
 */
const path    = require('path');
const ExcelJS = require(path.join(__dirname, '..', 'server', 'node_modules', 'exceljs'));
const fs      = require('fs');

const DOCS = path.join(__dirname, '..', 'docs');

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, 'FORMULA PALLETS.xlsx'));
  const ws = wb.worksheets[0];

  // col1=makat, col3=desc, col8=weight/unit
  const palletDesc = {};
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const makat = String(row.getCell(1).value || '').trim();
    const desc  = String(row.getCell(3).value || '').trim();
    const wt    = parseFloat(row.getCell(8).value || 0);
    if (makat && desc) palletDesc[makat] = { desc, wt: wt > 0 ? wt : null };
  });

  console.log(`FORMULA PALLETS: ${Object.keys(palletDesc).length} products`);

  // Parse packFactor from "(N)" pattern in desc
  function parsePackFactor(desc) {
    const m = desc.match(/\((\d+)\)/g);
    if (!m) return null;
    // Take the LAST "(N)" in the string — usually the pack count
    const last = m[m.length - 1];
    const n = parseInt(last.replace(/[()]/g, ''));
    return n > 0 ? n : null;
  }

  const pd = JSON.parse(fs.readFileSync(path.join(DOCS, 'product-data.json'), 'utf8'));

  let enriched = 0, withCarton = 0;
  for (const [makat, entry] of Object.entries(palletDesc)) {
    if (!pd[makat]) continue;
    pd[makat].desc = entry.desc;
    enriched++;
    const pf = parsePackFactor(entry.desc);
    if (pf) {
      pd[makat].packFactor = pf;
      const wt = entry.wt || pd[makat].weight;
      if (wt) {
        pd[makat].weightCarton = +(wt * pf).toFixed(2);
        withCarton++;
      }
    }
  }

  fs.writeFileSync(path.join(DOCS, 'product-data.json'), JSON.stringify(pd, null, 2), 'utf8');
  console.log(`Enriched: ${enriched} products | weightCarton: ${withCarton}`);
  console.log('Saved docs/product-data.json');
})();
