require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

async function main() {
  const dax = `
EVALUATE
ADDCOLUMNS(
  FILTER('משטח עם כפולות', 'משטח עם כפולות'[סוכן] = "258"),
  "הזמנה אחרונה",
    CALCULATE(
      MAX('ALL_PARTS'[תאריך]),
      FILTER('ALL_PARTS', 'ALL_PARTS'[מספר לקוח] = EARLIER('משטח עם כפולות'[מס.לקוח]))
    ),
  "מכירות חודש",
    CALCULATE(
      SUM('ALL_PARTS'[סכום (ש'ח)]),
      FILTER('ALL_PARTS',
        'ALL_PARTS'[מספר לקוח] = EARLIER('משטח עם כפולות'[מס.לקוח])
        && YEAR('ALL_PARTS'[תאריך]) = YEAR(TODAY())
        && MONTH('ALL_PARTS'[תאריך]) = MONTH(TODAY())
      )
    )
)
ORDER BY 'משטח עם כפולות'[סדר ביקור] ASC
  `;
  try {
    const rows = await executeDax(dax);
    console.log(`Got ${rows.length} rows`);
    if (rows.length > 0) console.log('Sample:', JSON.stringify(rows[0], null, 2));
    if (rows.length > 1) console.log('Sample 2:', JSON.stringify(rows[1], null, 2));
  } catch (e) {
    console.error('Query failed:', e.message);
  }
}

main();
