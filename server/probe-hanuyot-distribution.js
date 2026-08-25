require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

(async () => {
  console.log('=== Clients tagged "חנויות" (private-market category) + their sales May-Jul 2026 ===');
  try {
    const custRows = await executeDax(`
      EVALUATE
      SELECTCOLUMNS(
        FILTER('משטח', 'משטח'[תאור סוג לקוח] = "חנויות"),
        "cust", 'משטח'[מס. לקוח]
      )
    `);
    const custIds = custRows.map(r => String(r['[cust]'] || '')).filter(Boolean);
    console.log('total clients tagged חנויות:', custIds.length);

    const idsFilter = custIds.map(id => `"${id}"`).join(',');
    const salesRows = await executeDax(`
      EVALUATE
      ADDCOLUMNS(
        SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
        "total", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]), ALL_PARTS[ASHMADOT]="-מכר-", ALL_PARTS[תאריך] >= DATE(2026,5,1), ALL_PARTS[תאריך] <= DATE(2026,7,31))
      )
    `);
    const totalMap = new Map(salesRows.map(r => [String(r["ALL_PARTS[מספר לקוח]"] || ''), r['[total]'] || 0]));

    const vals = custIds.map(id => totalMap.get(id) || 0).filter(v => v > 0).sort((a, b) => b - a);
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = sum / vals.length;
    const median = vals[Math.floor(vals.length / 2)];
    console.log('clients with any sale in period:', vals.length);
    console.log('mean:', Math.round(mean), 'median:', Math.round(median));
    console.log('top 15 by sales:');
    vals.slice(0, 15).forEach((v, i) => console.log(i + 1, Math.round(v)));
    console.log('bottom 5:');
    vals.slice(-5).forEach((v, i) => console.log(vals.length - 5 + i + 1, Math.round(v)));
  } catch (e) { console.log('ERROR:', e.message.slice(0, 800)); }
})();
