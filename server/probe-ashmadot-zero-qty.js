require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

const custId = '1164512';
const sku = '1077';

(async () => {
  console.log('=== Raw ALL_PARTS rows: client 1164512, SKU 1077, ASHMADOT=השמדות ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      FILTER(
        ALL_PARTS,
        ALL_PARTS[מספר לקוח] = "${custId}" &&
        ALL_PARTS[מק'ט] = "${sku}" &&
        ALL_PARTS[ASHMADOT] = "השמדות"
      )
    `);
    rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
    console.log('row count:', rows.length);
  } catch (e) { console.log('ERROR:', e.message.slice(0, 800)); }
})();
