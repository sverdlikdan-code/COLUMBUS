require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

(async () => {
  console.log('=== Find custId for client name containing "פודלנד" ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      SELECTCOLUMNS(
        FILTER('משטח', CONTAINSSTRING('משטח'[שם לקוח], "פודלנד")),
        "cust", 'משטח'[מס. לקוח],
        "name", 'משטח'[שם לקוח],
        "type", 'משטח'[תאור סוג לקוח],
        "segment", 'משטח'[רשתות - פרטי]
      )
    `);
    rows.forEach(r => console.log(JSON.stringify(r)));
  } catch (e) { console.log('ERROR:', e.message.slice(0, 500)); }

  console.log('\n=== "-מכר-" sales in last 3 months, by agent-exclusion bucket (whole company) ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      ROW(
        "total_all", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]), ALL_PARTS[ASHMADOT]="-מכר-", ALL_PARTS[תאריך] >= DATE(2026,5,1)),
        "total_excluded_agents", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]), ALL_PARTS[ASHMADOT]="-מכר-", ALL_PARTS[תאריך] >= DATE(2026,5,1), ALL_PARTS[שם סוכן] IN {"‭באילא יסוי‬", "‭יללכ‬"} || ISBLANK(ALL_PARTS[שם סוכן])),
        "clients_all", CALCULATE(DISTINCTCOUNT(ALL_PARTS[מספר לקוח]), ALL_PARTS[ASHMADOT]="-מכר-", ALL_PARTS[תאריך] >= DATE(2026,5,1)),
        "clients_excluded_agents_only", CALCULATE(DISTINCTCOUNT(ALL_PARTS[מספר לקוח]), ALL_PARTS[ASHMADOT]="-מכר-", ALL_PARTS[תאריך] >= DATE(2026,5,1), ALL_PARTS[שם סוכן] IN {"‭באילא יסוי‬", "‭יללכ‬"} || ISBLANK(ALL_PARTS[שם סוכן]))
      )
    `);
    rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
  } catch (e) { console.log('ERROR:', e.message.slice(0, 500)); }
})();
