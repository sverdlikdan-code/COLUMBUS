/**
 * Probe DIMCALENDAR for week columns + top-10 SKUs by carton sales.
 * Run: node server/probe-prophet.js   (from project root)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const fs   = require('fs');
const path = require('path');

const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  console.log('MMD Dataset:', MMD_DS ? MMD_DS.slice(0, 8) + '...' : 'NOT SET');

  // 1. All DIMCALENDAR columns
  console.log('\n=== DIMCALENDAR ALL COLUMNS ===');
  try {
    const rows = await executeDax(`EVALUATE TOPN(1, DIMCALENDAR)`, MMD_DS);
    if (rows.length) Object.keys(rows[0]).forEach(k => console.log('  ', JSON.stringify(k), '=', rows[0][k]));
  } catch (e) { console.log('ERR:', e.message.substring(0, 400)); }

  // 2. Top-10 SKUs by total carton sales (last ~12 months)
  console.log('\n=== TOP 10 SKUs by [מכר קרטון] last 52w ===');
  let top10 = [];
  try {
    const rows = await executeDax(`
      EVALUATE
      TOPN(10,
        FILTER(
          SUMMARIZECOLUMNS(
            'KARTIS PARIT'[מק"ט],
            'KARTIS PARIT'[תאור],
            "total_mkr", CALCULATE([מכר קרטון],
              DATESBETWEEN(DIMCALENDAR[Date], DATE(2025,6,1), DATE(2026,6,30))
            ),
            "hamlatza", CALCULATE([המלצה להזמנה קרטון],
              DATESBETWEEN(DIMCALENDAR[Date], DATE(2026,5,1), DATE(2026,6,30))
            )
          ),
          [total_mkr] > 0
        ),
        [total_mkr], DESC
      )
    `, MMD_DS);
    rows.forEach((r, i) => {
      const mkt  = r['KARTIS PARIT[מק"ט]'];
      const taur = r['KARTIS PARIT[תאור]'];
      const tot  = r['[total_mkr]'];
      const ham  = r['[hamlatza]'];
      console.log(`  ${i + 1}. mkt=${mkt}  total=${Math.round(tot)}  hamlatza=${ham != null ? Math.round(ham * 10) / 10 : 'null'}  ${taur}`);
      top10.push({ mkt, taur, total_mkr: Math.round(tot), hamlatza: ham != null ? Math.round(ham * 10) / 10 : null });
    });
    // Save top10 for next step
    fs.writeFileSync(path.join(__dirname, '..', 'prophet', 'top10_skus.json'), JSON.stringify(top10, null, 2));
    console.log('\n  ✓ Saved prophet/top10_skus.json');
  } catch (e) { console.log('ERR TOP10:', e.message.substring(0, 600)); }

  // 3. Probe week column candidates
  const weekCandidates = ['WeekStart', 'WeekStartDate', 'Week Start', 'WeekNum', 'ISO_Week', 'שבוע', 'YearWeekNum', 'WeekYear'];
  console.log('\n=== WEEK COLUMN CANDIDATES ===');
  let foundWeekCol = null;
  for (const col of weekCandidates) {
    try {
      const r = await executeDax(`EVALUATE TOPN(1, SUMMARIZECOLUMNS(DIMCALENDAR[${col}]))`, MMD_DS);
      console.log(`  ✓ DIMCALENDAR[${col}] = ${r[0] ? Object.values(r[0])[0] : '?'}`);
      if (!foundWeekCol) foundWeekCol = col;
    } catch {
      console.log(`  ✗ DIMCALENDAR[${col}]`);
    }
  }

  // 4. Probe month column candidates
  const monthCandidates = ['Year', 'MonthNumber', 'MonthNum', 'Month', 'YearMonth', 'CalendarYear', 'Month Number', 'Year Month'];
  console.log('\n=== MONTH COLUMN CANDIDATES ===');
  let foundYearCol = null, foundMonthCol = null;
  for (const col of monthCandidates) {
    try {
      const r = await executeDax(`EVALUATE TOPN(1, SUMMARIZECOLUMNS(DIMCALENDAR[${col}]))`, MMD_DS);
      console.log(`  ✓ DIMCALENDAR[${col}] = ${r[0] ? Object.values(r[0])[0] : '?'}`);
      if (col.toLowerCase().includes('year') && !col.toLowerCase().includes('month') && !foundYearCol) foundYearCol = col;
      if ((col.toLowerCase().includes('month') || col === 'Month') && !foundMonthCol) foundMonthCol = col;
    } catch {
      console.log(`  ✗ DIMCALENDAR[${col}]`);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('  Week column:', foundWeekCol || 'NONE — will use monthly grouping');
  console.log('  Year column:', foundYearCol || 'NONE');
  console.log('  Month column:', foundMonthCol || 'NONE');

  // Save probe result
  const probeResult = { foundWeekCol, foundYearCol, foundMonthCol };
  fs.writeFileSync(path.join(__dirname, '..', 'prophet', 'probe_result.json'), JSON.stringify(probeResult, null, 2));
  console.log('  ✓ Saved prophet/probe_result.json');
}

probe().catch(e => console.error('FATAL:', e.message));
