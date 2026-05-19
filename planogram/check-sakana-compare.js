/**
 * Compare PBI measure [צפי סכנה השמדה] with our local formula [צפי קרט לזריקה]
 *
 * Our formula (planogram-editor.html):
 *   effectiveDays = max(0, daysLeft - shelfLife)
 *   canSell       = effectiveDays * daySales
 *   throwAway     = ceil(max(0, cartons - canSell))
 *
 * PBI measure: [צפי סכנה השמדה] — fetched below and compared
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const { getToken } = require('./pbi-kapua');

const W = process.env.PBI_WORKSPACE;
const D = process.env.PBI_DATASET;

async function dax(token, query) {
  const res = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${W}/datasets/${D}/executeQueries`,
    { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: false } }) }
  );
  const j = await res.json();
  if (j.error) throw new Error('DAX error: ' + JSON.stringify(j.error));
  return j.results?.[0]?.tables?.[0]?.rows || [];
}

async function main() {
  const t = await getToken();
  console.log('Token OK\n');

  // 1. Fetch PBI measure [צפי סכנה השמדה] per מקט (Main warehouse)
  console.log('=== 1. PBI measure [צפי סכנה השמדה] per מקט ===');
  let pbiRows = [];
  try {
    pbiRows = await dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          VALUES('מלאי-תוקף'[מק"ט]),
          "pbi_sakana", [צפי סכנה השמדה]
        ),
        'מלאי-תוקף'[מחסן] = "Main"
      )
      ORDER BY [pbi_sakana] DESC
    `);
    console.log(`Fetched ${pbiRows.length} rows from PBI measure`);
    if (pbiRows.length > 0) {
      console.log('Column keys in result:', Object.keys(pbiRows[0]));
    }
    pbiRows.slice(0, 10).forEach(r => {
      const val = r['[pbi_sakana]'];
      console.log(`  מקט ${r['מלאי-תוקף[מק"ט]']}  →  ${val != null ? val : '(null)'}`);
    });
  } catch (e) {
    console.log('⚠ Could not fetch [צפי סכנה השמדה]:', e.message);
    console.log('  Possible measure names to try: [צפי סכנה השמדה], [סכנת השמדה], [סכנה להשמדה]');
  }

  // 2. Fetch raw data: stock + pakuot per batch + daySales + shelfLife (Main)
  console.log('\n=== 2. Raw data from PBI (stock, pakuot, daySales, shelfLife) ===');

  const stockRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      'מלאי-תוקף'[תאור מוצר],
      FILTER('מלאי-תוקף', 'מלאי-תוקף'[מחסן] = "Main"),
      "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
    )
  `);

  const pakuotRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      'מלאי-תוקף'[ת. תפוגת תוקף],
      FILTER('מלאי-תוקף', 'מלאי-תוקף'[מחסן] = "Main"),
      "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
    )
    ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
  `);

  const salesRows = await dax(t, `
    EVALUATE
    CALCULATETABLE(
      ADDCOLUMNS(
        SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
        "daySales", [TOTAL מכר בקרטונים ממוצע ביום]
      ),
      'ALL_PARTS'[חברה] = "FORMULA",
      'ALL_PARTS'[מחסן] = "Main",
      FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 180)
    )
  `);

  // shelfLife from KARTIS PARIT
  const shelfRows = await dax(t, `
    EVALUATE
    ADDCOLUMNS(
      SUMMARIZE('KARTIS PARIT', 'KARTIS PARIT'[מק"ט]),
      "mk",        'KARTIS PARIT'[מק"ט],
      "shelfLife", MAX('KARTIS PARIT'[חיי מדף])
    )
  `);

  // Build maps
  const salesMap = {};
  for (const r of salesRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (mk) salesMap[String(mk)] = r['[daySales]'] || 0;
  }

  const shelfMap = {};
  for (const r of shelfRows) {
    const mk = r['[mk]'];
    if (mk) shelfMap[String(mk)] = r['[shelfLife]'] || 0;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const pakuotMap = {};
  for (const r of pakuotRows) {
    const mk      = r['מלאי-תוקף[מק"ט]'];
    const cartons = r['[cartons]'] || 0;
    if (!mk || cartons <= 0) continue;
    const rawDate = r["מלאי-תוקף[ת. תפוגת תוקף]"];
    let daysLeft = null;
    if (rawDate) daysLeft = Math.round((new Date(rawDate) - today) / 86400000);
    if (!pakuotMap[mk]) pakuotMap[mk] = [];
    pakuotMap[mk].push({ daysLeft, cartons });
  }

  // 3. Calculate our formula per מקט and compare with PBI measure
  console.log('\n=== 3. Comparison: PBI measure vs Our formula ===');

  const pbiMap = {};
  for (const r of pbiRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (mk) pbiMap[String(mk)] = r['[pbi_sakana]'] || 0;
  }

  let matchCount = 0, diffCount = 0, pbiOnlyCount = 0, ourOnlyCount = 0;
  const diffs = [];

  for (const r of stockRows) {
    const mk      = r['מלאי-תוקף[מק"ט]'];
    const stock   = r['[stock]'] || 0;
    if (stock <= 0) continue;

    const daySales  = salesMap[String(mk)] || 0;
    const shelfLife = shelfMap[String(mk)] || 0;
    const paks      = pakuotMap[String(mk)] || [];
    const pbiVal    = pbiMap[String(mk)] ?? null;

    // Our formula: sum throwAway across all batches
    let ourTotal = 0;
    for (const pak of paks) {
      if (pak.daysLeft == null || pak.cartons <= 0) continue;
      const effectiveDays = Math.max(0, pak.daysLeft - shelfLife);
      const canSell       = daySales > 0 ? effectiveDays * daySales : pak.cartons;
      const throwAway     = Math.max(0, pak.cartons - canSell);
      ourTotal += throwAway;
    }
    ourTotal = Math.ceil(ourTotal);

    if (pbiVal === null && ourTotal === 0) continue; // both zero, skip
    if (pbiVal === null) { ourOnlyCount++; }
    else if (ourTotal === 0 && pbiVal === 0) { matchCount++; continue; }
    else if (Math.abs((pbiVal || 0) - ourTotal) < 0.5) { matchCount++; }
    else {
      diffCount++;
      diffs.push({ mk, pbi: pbiVal, ours: ourTotal, stock, daySales, shelfLife, paks });
    }
  }

  console.log(`\nResults:`);
  console.log(`  ✓ Match:    ${matchCount}`);
  console.log(`  ✗ Differs:  ${diffCount}`);
  console.log(`  Our only:   ${ourOnlyCount} (PBI measure = null for these)`);
  console.log(`  PBI only:   ${pbiOnlyCount}`);

  if (diffs.length > 0) {
    console.log(`\nDifferences (top ${Math.min(20, diffs.length)}):`);
    diffs.slice(0, 20).forEach(d => {
      console.log(`  מקט ${d.mk}  PBI=${d.pbi?.toFixed ? d.pbi.toFixed(1) : d.pbi}  ours=${d.ours}  stock=${d.stock}  daySales=${d.daySales?.toFixed ? d.daySales.toFixed(2) : d.daySales}  shelfLife=${d.shelfLife}`);
      d.paks.forEach(p => console.log(`    batch: ${p.daysLeft} days, ${p.cartons} cartons`));
    });
  }

  // 4. Discover STOP SALE measure name
  console.log('\n=== 4. Discovering STOP SALE measure name ===');
  const stopNames = ['STOP SALE ⛔', 'Stop Sale ⛔', 'STOP SALE', 'Stop Sale', 'Stop_Sale', 'StopSale', 'stop sale',
                     'עצור מכירה', 'הקפאת מכירה', 'סטופ', 'STOP'];
  for (const name of stopNames) {
    try {
      const r = await dax(t, `EVALUATE ROW("v", [${name}])`);
      console.log(`  ✓ [${name}] = ${JSON.stringify(r[0])}`);
    } catch { console.log(`  ✗ [${name}] not found`); }
  }

  // 4b. STOP SALE ⛔ per מקט — all products, see which ones are flagged
  console.log('\n=== 4b. PBI measure [STOP SALE ⛔] per מקט ===');
  try {
    const stopRows = await dax(t, `
      EVALUATE
      ADDCOLUMNS(
        SUMMARIZE('KARTIS PARIT', 'KARTIS PARIT'[מק"ט]),
        "stop_sale", [STOP SALE ⛔]
      )
      ORDER BY [stop_sale] DESC
    `);
    if (stopRows.length > 0) console.log('Column keys:', Object.keys(stopRows[0]));
    const flagged = stopRows.filter(r => {
      const v = r['[stop_sale]'];
      return v != null && v !== 0 && v !== false && v !== '';
    });
    console.log(`Total rows: ${stopRows.length}, flagged (non-zero/non-null): ${flagged.length}`);
    flagged.slice(0, 20).forEach(r =>
      console.log(`  מקט ${r['KARTIS PARIT[מק"ט]']}  stop_sale = ${r['[stop_sale]']}`)
    );
    if (flagged.length === 0) {
      console.log('First 5 rows (any value):', stopRows.slice(0,5).map(r => ({mk: r['KARTIS PARIT[מק"ט]'], v: r['[stop_sale]']})));
    }
  } catch(e) {
    console.log('⚠ error:', e.message);
  }

  // 4c. Try STOP SALE as column in tables
  console.log('\n=== 4c. Search STOP SALE as column ===');
  const colNames = ['Stop Sale','STOP SALE','stop sale','Stop_Sale','עצור מכירה'];
  const tables   = ['KARTIS PARIT','ALL_PARTS','מלאי-תוקף'];
  for (const tbl of tables) {
    for (const col of colNames) {
      try {
        const r = await dax(t, `EVALUATE TOPN(3, SELECTCOLUMNS('${tbl}', "v", '${tbl}'[${col}]))`);
        console.log(`  ✓ '${tbl}'[${col}] = ${JSON.stringify(r.map(x=>x['[v]']))}`);
      } catch { /* not found */ }
    }
  }

  // 5. Explore: what does [צפי סכנה השמדה] actually calculate — show raw DAX values
  console.log('\n=== 5. [צפי סכנה השמדה] raw values (include null=false) ===');
  try {
    const rawRows = await dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          VALUES('מלאי-תוקף'[מק"ט]),
          "v", [צפי סכנה השמדה]
        ),
        'מלאי-תוקף'[מחסן] = "Main"
      )
      ORDER BY [v] ASC
    `);
    const allVals = rawRows.map(r => r['[v]']);
    const nonZero = allVals.filter(v => v != null && v !== 0);
    console.log(`Total rows: ${rawRows.length}, non-null non-zero: ${nonZero.length}`);
    if (nonZero.length > 0) {
      rawRows
        .filter(r => r['[v]'] != null && r['[v]'] !== 0)
        .slice(0, 20)
        .forEach(r => console.log(`  מקט ${r['מלאי-תוקף[מק"ט]']}  v = ${r['[v]']}`));
    } else {
      console.log('All values are 0 or null — measure may be using different filter context');
      // Try without warehouse filter
      const allCtx = await dax(t, `
        EVALUATE
        ADDCOLUMNS(
          VALUES('מלאי-תוקף'[מק"ט]),
          "v", [צפי סכנה השמדה]
        )
        ORDER BY [v] ASC
      `);
      const nonZero2 = allCtx.filter(r => r['[v]'] != null && r['[v]'] !== 0);
      console.log(`Without warehouse filter: ${allCtx.length} rows, non-zero: ${nonZero2.length}`);
      nonZero2.slice(0, 10).forEach(r =>
        console.log(`  מקט ${r['מלאי-תוקף[מק"ט]']}  v = ${r['[v]']}`)
      );
    }
  } catch(e) {
    console.log('Error:', e.message);
  }
}

main().catch(e => console.error('ERROR:', e.message));
