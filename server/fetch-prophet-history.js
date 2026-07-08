/**
 * Pulls weekly carton sales for ALL active MMD SKUs from Power BI.
 * Source of truth: docs/mmd-orders.json (already built by build-mmd-orders.js)
 *
 * Output:
 *   prophet/weekly_sales.csv   — SKU x week x carton sales
 *   prophet/hamlatza_map.json  — SKU → hamlatza (from mmd-orders.json)
 *
 * Run: node server/fetch-prophet-history.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const fs   = require('fs');
const path = require('path');

const MMD_DS      = process.env.POWERBI_MMD_DATASET_ID;
const PROPHET_DIR = path.join(__dirname, '..', 'prophet');
const DOCS_DIR    = path.join(__dirname, '..', 'docs');

async function fetchHistory() {
  // Read all active SKUs from the already-built mmd-orders.json
  const ordersPath = path.join(DOCS_DIR, 'mmd-orders.json');
  if (!fs.existsSync(ordersPath)) {
    console.error('docs/mmd-orders.json not found — run build-mmd-orders.js first');
    process.exit(1);
  }
  const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  const skus = orders.data || [];
  console.log(`Active SKUs from mmd-orders.json: ${skus.length}`);

  // Build hamlatza map for all SKUs
  const hamlatzaMap = {};
  skus.forEach(r => { hamlatzaMap[String(r.mkt)] = r.hamlatza ?? null; });
  fs.writeFileSync(path.join(PROPHET_DIR, 'hamlatza_map.json'), JSON.stringify(hamlatzaMap, null, 2));
  console.log(`Saved hamlatza_map.json for ${skus.length} SKUs`);

  // DAX: weekly carton sales for ALL SKUs, 2023 → last COMPLETE week only
  // Exclude current partial week: filter dates < start of current week (Sunday)
  const dax = `
    EVALUATE
    FILTER(
      SUMMARIZECOLUMNS(
        'KARTIS PARIT'[מק"ט],
        'KARTIS PARIT'[תאור],
        DIMCALENDAR[Year],
        DIMCALENDAR[Week Number],
        FILTER(DIMCALENDAR,
          DIMCALENDAR[Date] >= TODAY() - 365 &&
          DIMCALENDAR[Date] < TODAY() - MOD(WEEKDAY(TODAY(), 1) - 1, 7)
        ),
        "mkr_k", [מכר קרטון]
      ),
      [mkr_k] > 0
    )
    ORDER BY 'KARTIS PARIT'[מק"ט], DIMCALENDAR[Year], DIMCALENDAR[Week Number]
  `;

  console.log('Querying Power BI for all SKUs history (2023+)...');
  const rows = await executeDax(dax, MMD_DS);
  console.log(`Got ${rows.length} rows`);

  if (!rows.length) {
    console.error('No data returned — check DAX query');
    process.exit(1);
  }

  // Build CSV
  const lines = ['mkt,taur,year,week,mkr_k'];
  for (const r of rows) {
    const mkt  = r['KARTIS PARIT[מק"ט]'];
    const taur = (r['KARTIS PARIT[תאור]'] || '').replace(/"/g, '""');
    const yr   = r['DIMCALENDAR[Year]'];
    const wk   = r['DIMCALENDAR[Week Number]'];
    const mkr  = r['[mkr_k]'];
    if (mkt == null || yr == null || wk == null || mkr == null) continue;
    lines.push(`${mkt},"${taur}",${yr},${wk},${Math.round(mkr * 100) / 100}`);
  }

  const csvPath = path.join(PROPHET_DIR, 'weekly_sales.csv');
  fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
  console.log(`Saved ${lines.length - 1} rows → prophet/weekly_sales.csv`);

  // Report unique SKUs found
  const uniqueSkus = new Set(rows.map(r => r['KARTIS PARIT[מק"ט]']));
  console.log(`Unique SKUs with sales history: ${uniqueSkus.size}`);
}

fetchHistory().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
