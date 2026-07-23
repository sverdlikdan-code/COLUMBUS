require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');

const ICE_DS = process.env.POWERBI_ICE_DATASET_ID;
if (!ICE_DS) { console.error('POWERBI_ICE_DATASET_ID not set'); process.exit(1); }

async function probe() {
  console.log('ICE DS:', ICE_DS);

  // List tables
  console.log('\n=== TABLES IN ICE DATASET ===');
  try {
    const r = await executeDax(`EVALUATE INFO.TABLES()`, ICE_DS);
    r.forEach(row => {
      const name = row['[Name]'] || row['Name'] || JSON.stringify(row).slice(0,80);
      console.log(' ', name);
    });
  } catch(e) { console.log('err tables:', e.message); }

  // Check if ALL_PARTS exists in ICE dataset
  console.log('\n=== TOP 3 FROM ALL_PARTS (ICE) ===');
  try {
    const r = await executeDax(`EVALUATE TOPN(3, ALL_PARTS)`, ICE_DS);
    console.log('columns:', Object.keys(r[0]||{}));
    r.forEach(row => console.log(JSON.stringify(row).slice(0,120)));
  } catch(e) { console.log('err all_parts:', e.message); }

  // Try MISHPAHTI ICE ALL_PARTS
  console.log('\n=== TOP 3 FROM MISHPAHTI ICE MISHTAH ===');
  try {
    const r = await executeDax(`EVALUATE TOPN(3, 'MISHPAHTI ICE MISHTAH')`, ICE_DS);
    console.log('columns:', Object.keys(r[0]||{}));
  } catch(e) { console.log('err mishpahti:', e.message); }
}

probe().catch(e => console.error('FATAL:', e.message));
