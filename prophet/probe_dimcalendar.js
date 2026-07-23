/**
 * Probe DIMCALENDAR table to discover week-grain columns.
 * Run: node prophet/probe_dimcalendar.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('../server/powerbi');

const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  console.log('MMD Dataset:', MMD_DS ? MMD_DS.slice(0, 8) + '...' : 'NOT SET');

  // 1. All DIMCALENDAR columns
  console.log('\n=== DIMCALENDAR COLUMNS ===');
  try {
    const rows = await executeDax(`EVALUATE TOPN(1, DIMCALENDAR)`, MMD_DS);
    if (rows.length) {
      Object.keys(rows[0]).forEach(k => console.log('  ', k, '=', rows[0][k]));
    }
  } catch (e) { console.log('ERR:', e.message.substring(0, 400)); }

  // 2. Top-10 SKUs by total carton sales (last 52 weeks)
  console.log('\n=== TOP 10 SKUs by מכר קרטון (52w) ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      TOPN(10,
        FILTER(
          SUMMARIZECOLUMNS(
            'KARTIS PARIT'[מק"ט],
            'KARTIS PARIT'[תאור],
            "total_mkr", CALCULATE([מכר קרטון],
              DATESBETWEEN(DIMCALENDAR[Date], TODAY()-365, TODAY()-1)
            ),
            "hamlatza", CALCULATE([המלצה להזמנה קרטון],
              DATESBETWEEN(DIMCALENDAR[Date], TODAY()-56, TODAY()-1)
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
      console.log(`  ${i + 1}. mkt=${mkt}  total=${Math.round(tot)}k  hamlatza=${ham != null ? Math.round(ham * 10) / 10 : 'null'}  ${taur}`);
    });
  } catch (e) { console.log('ERR TOP10:', e.message.substring(0, 400)); }

  // 3. Try week-grain via candidate column names
  const weekCandidates = ['WeekStart', 'WeekStartDate', 'Week Start', 'YearWeekNum', 'WeekNum', 'ISO_Week', 'שבוע'];
  console.log('\n=== DIMCALENDAR WEEK COLUMN CANDIDATES ===');
  for (const col of weekCandidates) {
    try {
      await executeDax(`EVALUATE TOPN(1, SUMMARIZECOLUMNS(DIMCALENDAR[${col}]))`, MMD_DS);
      console.log(`  ✓ DIMCALENDAR[${col}] — EXISTS`);
    } catch {
      console.log(`  ✗ DIMCALENDAR[${col}] — not found`);
    }
  }

  // 4. Try month-grain columns
  const monthCandidates = ['Year', 'MonthNumber', 'MonthNum', 'Month', 'YearMonth', 'CalendarYear', 'Month Number'];
  console.log('\n=== DIMCALENDAR MONTH COLUMN CANDIDATES ===');
  for (const col of monthCandidates) {
    try {
      const r = await executeDax(`EVALUATE TOPN(1, SUMMARIZECOLUMNS(DIMCALENDAR[${col}]))`, MMD_DS);
      console.log(`  ✓ DIMCALENDAR[${col}] = ${r[0] ? Object.values(r[0])[0] : '?'}`);
    } catch {
      console.log(`  ✗ DIMCALENDAR[${col}] — not found`);
    }
  }
}

probe().catch(e => console.error('FATAL:', e.message));
