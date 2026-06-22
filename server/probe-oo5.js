require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

async function run(label, dax) {
  console.log(`\n=== ${label} ===`);
  try {
    const rows = await executeDax(dax);
    rows.slice(0, 8).forEach(r => console.log(' ', JSON.stringify(r)));
    if (rows.length > 8) console.log(`  ... (${rows.length} rows)`);
    return rows;
  } catch (e) { console.log('  ERROR:', e.message.slice(0, 500)); return []; }
}

const FROZEN_MAKATS = ['732','604','1009','802','660','664','1185','1191','1196'];
const mkSet = '{' + FROZEN_MAKATS.map(m => `"${m}"`).join(',') + '}';

(async () => {
  // MLAY with pack factor via LOOKUPVALUE from גורם אירוז
  await run('MLAY + pack factor (LOOKUPVALUE גורם אירוז)', `
    EVALUATE
    ADDCOLUMNS(
      SUMMARIZE(
        FILTER(MLAY, CONTAINSROW(${mkSet}, MLAY[מק'ט]) && MLAY[חברה] = "FORMULA"),
        MLAY[מק'ט],
        "stockUnits", SUM(MLAY[מלאי זמין])
      ),
      "packFactor", LOOKUPVALUE('גורם אירוז'[תכולת האריזה למוצר], 'גורם אירוז'[מק"ט], MLAY[מק'ט])
    )
  `);

  // Open orders for same makats
  await run('Open orders for frozen makats', `
    EVALUATE
    SUMMARIZE(
      FILTER('הזמנות רכש פתוחות', CONTAINSROW(${mkSet}, 'הזמנות רכש פתוחות'[מק"ט])),
      'הזמנות רכש פתוחות'[מק"ט],
      "ooCartons", SUM('הזמנות רכש פתוחות'[KARTON הזמנות פתוחות])
    )
  `);

  // Alternative: use מלאי-תוקף ALL warehouses (already in cartons, no conversion needed)
  await run('מלאי-תוקף ALL warehouses — cartons per מק"ט', `
    EVALUATE
    SUMMARIZE(
      FILTER('מלאי-תוקף', CONTAINSROW(${mkSet}, 'מלאי-תוקף'[מק"ט])),
      'מלאי-תוקף'[מק"ט],
      "stockCartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
    )
  `);
})();
