require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  const measures = [
    '[לכמה שבועות יספיק המלאי]',
    '[WEEKS לפח]',
    '[ימים שהיה מלאי]',
    '[ימי מכר מכלל % מכר]',
    '[מכר קרטון בתקופה]',
  ];

  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  const prevM = curM === 1 ? 12 : curM - 1;
  const prevY = curM === 1 ? curY - 1 : curY;
  const lastDay = new Date(curY, curM, 0).getDate();
  const df = `DATESBETWEEN(DIMCALENDAR[Date], DATE(${prevY},${prevM},1), DATE(${curY},${curM},${lastDay}))`;

  for (const m of measures) {
    // Try without date filter
    try {
      const r = await executeDax(`
        EVALUATE
        FILTER(
          SUMMARIZECOLUMNS(
            'KARTIS PARIT'[מק"ט],
            "v", ${m}
          ),
          'KARTIS PARIT'[מק"ט] = "732"
        )
      `, MMD_DS);
      console.log(`✅ ${m} (no date) = ${r[0] ? r[0]['[v]'] : 'null'}`);
    } catch(e) {
      // Try with date filter
      try {
        const r = await executeDax(`
          EVALUATE
          FILTER(
            SUMMARIZECOLUMNS(
              'KARTIS PARIT'[מק"ט],
              "v", CALCULATE(${m}, ${df})
            ),
            'KARTIS PARIT'[מק"ט] = "732"
          )
        `, MMD_DS);
        console.log(`✅ ${m} (with date) = ${r[0] ? r[0]['[v]'] : 'null'}`);
      } catch(e2) {
        console.log(`❌ ${m} → ${e2.message.substring(0, 120)}`);
      }
    }
  }
}

probe().catch(e => console.error('FATAL:', e.message));
