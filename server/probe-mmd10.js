require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function tryMeasure(label, dax) {
  try {
    const r = await executeDax(dax, MMD_DS);
    const v = r[0] ? Object.values(r[0]).find((_, i) => Object.keys(r[0])[i] !== 'KARTIS PARIT[מק"ט]' && Object.keys(r[0])[i] !== "תוקף FORM[מק'ט]") : null;
    const val = r[0] ? r[0][Object.keys(r[0]).find(k => k === '[v]')] : null;
    console.log(`✅ ${label} = ${JSON.stringify(r[0])}`);
  } catch(e) {
    const detail = e.message.match(/"value":"([^"]{0,300})"/) || [];
    console.log(`❌ ${label}`);
    console.log(`   ERR: ${(detail[1] || e.message).substring(0, 300)}`);
  }
}

async function probe() {
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  const prevM = curM === 1 ? 12 : curM - 1;
  const prevY = curM === 1 ? curY - 1 : curY;
  const lastDay = new Date(curY, curM, 0).getDate();
  const df = `DATESBETWEEN(DIMCALENDAR[Date], DATE(${prevY},${prevM},1), DATE(${curY},${curM},${lastDay}))`;

  console.log(`\nDate filter: prev=${prevY}/${prevM} → cur=${curY}/${curM}/${lastDay}\n`);

  // 1. מכר קרטון בתקופה — with date filter
  await tryMeasure('מכר קרטון בתקופה (CALCULATE+df)', `
    EVALUATE FILTER(SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v",
      CALCULATE([מכר קרטון בתקופה], ${df})), 'KARTIS PARIT'[מק"ט] = "732")`);

  // 2. מכר קרטון בתקופה — CALCULATETABLE approach
  await tryMeasure('מכר קרטון בתקופה (CALCULATETABLE)', `
    EVALUATE FILTER(
      CALCULATETABLE(
        SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [מכר קרטון בתקופה]),
        ${df}
      ), 'KARTIS PARIT'[מק"ט] = "732")`);

  // 3. WEEKS לפח
  await tryMeasure('WEEKS לפח (CALCULATE+df)', `
    EVALUATE FILTER(SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v",
      CALCULATE([WEEKS לפח], ${df})), 'KARTIS PARIT'[מק"ט] = "732")`);

  await tryMeasure('WEEKS לפח (CALCULATETABLE)', `
    EVALUATE FILTER(
      CALCULATETABLE(
        SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [WEEKS לפח]),
        ${df}
      ), 'KARTIS PARIT'[מק"ט] = "732")`);

  // 4. ימים שהיה מלאי
  await tryMeasure('ימים שהיה מלאי (CALCULATE+df)', `
    EVALUATE FILTER(SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v",
      CALCULATE([ימים שהיה מלאי], ${df})), 'KARTIS PARIT'[מק"ט] = "732")`);

  await tryMeasure('ימים שהיה מלאי (CALCULATETABLE)', `
    EVALUATE FILTER(
      CALCULATETABLE(
        SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [ימים שהיה מלאי]),
        ${df}
      ), 'KARTIS PARIT'[מק"ט] = "732")`);

  // 5. ימי מכר מכלל % מכר
  await tryMeasure('ימי מכר מכלל % (CALCULATE+df)', `
    EVALUATE FILTER(SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v",
      CALCULATE([ימי מכר מכלל % מכר], ${df})), 'KARTIS PARIT'[מק"ט] = "732")`);

  await tryMeasure('ימי מכר מכלל % (CALCULATETABLE)', `
    EVALUATE FILTER(
      CALCULATETABLE(
        SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", [ימי מכר מכלל % מכר]),
        ${df}
      ), 'KARTIS PARIT'[מק"ט] = "732")`);

  // 6. לכמה שבועות יספיק המלאי (already works, confirm value)
  await tryMeasure('לכמה שבועות יספיק המלאי', `
    EVALUATE FILTER(SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v",
      [לכמה שבועות יספיק המלאי]), 'KARTIS PARIT'[מק"ט] = "732")`);
}

probe().catch(e => console.error('FATAL:', e.message));
