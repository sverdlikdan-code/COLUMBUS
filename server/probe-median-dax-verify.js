require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

(async () => {
  console.log('=== MEDIANX over per-client totals, חנויות category, May-Jul 2026 ===');
  console.log('(expected ~14456, from independent JS calc in probe-hanuyot-distribution.js)');
  try {
    const custRows = await executeDax(`
      EVALUATE
      SELECTCOLUMNS(
        FILTER('משטח', 'משטח'[תאור סוג לקוח] = "חנויות"),
        "cust", 'משטח'[מס. לקוח]
      )
    `);
    const custIds = custRows.map(r => String(r['[cust]'] || '')).filter(Boolean);
    const chainInFilter = `\n  ALL_PARTS[מספר לקוח] IN {${custIds.map(id => `"${id}"`).join(',')}},`;

    // Version A: naive (filters NOT repeated inside per-row CALCULATE) — testing
    // whether the outer CALCULATETABLE filters actually carry into MEDIANX's
    // per-row context-transitioned SUM, or get silently dropped.
    const daxNaive = `
EVALUATE
ROW(
  "median_naive",
  MEDIANX(
    CALCULATETABLE(
      SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
      ALL_PARTS[ASHMADOT] = "-מכר-",${chainInFilter}
      ALL_PARTS[תאריך] >= DATE(2026,5,1),
      ALL_PARTS[תאריך] <= DATE(2026,7,31)
    ),
    CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]))
  )
)`;
    const rowsNaive = await executeDax(daxNaive);
    console.log('naive (filters not repeated inside):', JSON.stringify(rowsNaive));

    // Version B: filters explicitly repeated inside the per-row CALCULATE (except
    // the client-list filter, which targets the grouping column and must stay
    // outer-only to avoid the context-transition-replacement trap).
    const daxRepeated = `
EVALUATE
ROW(
  "median_repeated",
  MEDIANX(
    CALCULATETABLE(
      SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
      ALL_PARTS[ASHMADOT] = "-מכר-",${chainInFilter}
      ALL_PARTS[תאריך] >= DATE(2026,5,1),
      ALL_PARTS[תאריך] <= DATE(2026,7,31)
    ),
    CALCULATE(
      SUM(ALL_PARTS[סכום (ש'ח)]),
      ALL_PARTS[ASHMADOT] = "-מכר-",
      ALL_PARTS[תאריך] >= DATE(2026,5,1),
      ALL_PARTS[תאריך] <= DATE(2026,7,31)
    )
  )
)`;
    const rowsRepeated = await executeDax(daxRepeated);
    console.log('repeated (filters explicit inside too):', JSON.stringify(rowsRepeated));
  } catch (e) { console.log('ERROR:', e.message.slice(0, 800)); }
})();
