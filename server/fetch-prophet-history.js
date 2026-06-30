/**
 * Pulls weekly carton sales for top-10 SKUs from Power BI MMD dataset.
 * Output: prophet/weekly_sales.csv
 *
 * Run: node server/fetch-prophet-history.js
 * Requires: prophet/top10_skus.json (created by probe-prophet.js)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const fs   = require('fs');
const path = require('path');

const MMD_DS     = process.env.POWERBI_MMD_DATASET_ID;
const PROPHET_DIR = path.join(__dirname, '..', 'prophet');

async function fetchHistory() {
  // Load top-10 SKUs from probe output
  const top10Path = path.join(PROPHET_DIR, 'top10_skus.json');
  if (!fs.existsSync(top10Path)) {
    console.error('prophet/top10_skus.json not found — run probe-prophet.js first');
    process.exit(1);
  }
  const top10 = JSON.parse(fs.readFileSync(top10Path, 'utf8'));
  const mktList = top10.map(r => `"${r.mkt}"`).join(', ');
  console.log(`Fetching history for ${top10.length} SKUs: [${mktList}]`);

  // DAX: weekly carton sales for top-10 SKUs, 2025-01-01 → today
  // DIMCALENDAR[Year] + DIMCALENDAR[Week Number] give ISO week grain
  const dax = `
    EVALUATE
    FILTER(
      SUMMARIZECOLUMNS(
        'KARTIS PARIT'[מק"ט],
        'KARTIS PARIT'[תאור],
        DIMCALENDAR[Year],
        DIMCALENDAR[Week Number],
        FILTER('KARTIS PARIT', 'KARTIS PARIT'[מק"ט] IN {${mktList}}),
        FILTER(DIMCALENDAR, DIMCALENDAR[Year] >= 2022),
        "mkr_k", [מכר קרטון]
      ),
      [mkr_k] > 0
    )
    ORDER BY 'KARTIS PARIT'[מק"ט], DIMCALENDAR[Year], DIMCALENDAR[Week Number]
  `;

  console.log('Querying Power BI...');
  const rows = await executeDax(dax, MMD_DS);
  console.log(`Got ${rows.length} rows`);

  if (!rows.length) {
    console.error('No data returned — check DAX query');
    process.exit(1);
  }

  // Debug: show first row keys
  console.log('Sample row keys:', Object.keys(rows[0]));

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
  console.log(`✓ Saved ${lines.length - 1} rows → prophet/weekly_sales.csv`);

  // Also save the hamlatza map from top10 for Python script
  const hamlatzaMap = {};
  top10.forEach(r => { hamlatzaMap[r.mkt] = r.hamlatza; });
  fs.writeFileSync(path.join(PROPHET_DIR, 'hamlatza_map.json'), JSON.stringify(hamlatzaMap, null, 2));
  console.log('✓ Saved prophet/hamlatza_map.json');
}

fetchHistory().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
