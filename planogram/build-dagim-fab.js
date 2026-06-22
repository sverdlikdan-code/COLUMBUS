/**
 * build-dagim-fab.js
 * Builds dagim-base.json from Fabric (Power BI / KARTIS PARIT) only.
 * Same schema as build-dagim-yavesh-new.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const path = require('path');
const fs   = require('fs');
const { getToken } = require('./pbi-kapua');
const { loadBreiraDefault } = require('./breira-default/loader');

const OUT_PATH = path.join(__dirname, '..', 'docs', 'dagim-base.json');

const WORKING_SLOTS = 97;
const RESERVE_START = 98;
const TOTAL_SLOTS   = 126;

// fam from KARTIS PARIT — fix reversed Hebrew only, no manual remapping
function fixHebRTL(s) {
  if (!s) return s;
  return s.replace(/[ְ-תװ-״]+/g, m => m.split('').reverse().join(''));
}
function cleanFam(raw) {
  const s = (raw || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
  return fixHebRTL(s) || null;
}

(async () => {
  // ── Step 1: Read layout from existing dagim-base.json ─────────────────────
  const existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const layout   = existing.layout;

  console.log(`Layout: ${Object.keys(layout).length} positions`);
  const missing = [];
  for (let i = 1; i <= TOTAL_SLOTS; i++) if (!layout[String(i)]) missing.push(i);
  if (missing.length) console.warn('⚠ Missing positions:', missing.join(','));
  else console.log(`✅ All ${TOTAL_SLOTS} positions mapped`);

  // ── Step 2: Fetch products + sales from Fabric ────────────────────────────
  const t = await getToken();
  const WORKSPACE = process.env.PBI_WORKSPACE;
  const DATASET   = process.env.PBI_DATASET;

  async function dax(query) {
    const res = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE}/datasets/${DATASET}/executeQueries`,
      { method: 'POST',
        headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }) }
    );
    const j = await res.json();
    if (j.error) throw new Error('DAX error: ' + JSON.stringify(j.error));
    return j.results?.[0]?.tables?.[0]?.rows || [];
  }

  const dagimMakatim = `
    SELECTCOLUMNS(
      FILTER('KARTIS PARIT',
        'KARTIS PARIT'[סטטוס] = "פעיל" &&
        'KARTIS PARIT'[שם מחסן אשדוד] = "דגים 🐟"
      ),
      "mk", 'KARTIS PARIT'[מק"ט]
    )`;

  const [kpRows, salesRows] = await Promise.all([
    dax(`
      EVALUATE
      SELECTCOLUMNS(
        FILTER('KARTIS PARIT',
          'KARTIS PARIT'[סטטוס] = "פעיל" &&
          'KARTIS PARIT'[שם מחסן אשדוד] = "דגים 🐟"
        ),
        "makat", 'KARTIS PARIT'[מק"ט],
        "fam",   'KARTIS PARIT'[תאור משפחה],
        "name",  'KARTIS PARIT'[תאור]
        
      )
    `),
    dax(`
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySales", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        'ALL_PARTS'[מחסן] = "Main",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 365),
        TREATAS(${dagimMakatim}, 'ALL_PARTS'[מק'ט])
      )
    `),
  ]);

  if (!kpRows.length) throw new Error('No dagim products found — check שם מחסן אשדוד = "דגים 🐟"');

  const salesMap = {};
  for (const r of salesRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (mk) salesMap[String(mk)] = r['[daySales]'] || 0;
  }

  let stockMap = {};
  try {
    const pdPath = path.join(__dirname, '..', 'docs', 'product-data.json');
    const pd = JSON.parse(fs.readFileSync(pdPath, 'utf8'));
    for (const [mk, d] of Object.entries(pd)) stockMap[mk] = d.stock || 0;
  } catch (e) { console.warn('product-data.json not available, skipping stock filter'); }

  const hasSales = [];
  const noSales  = [];
  let excluded = 0;

  for (const r of kpRows) {
    const mk   = String(r['[makat]'] || '').trim();
    const fam  = cleanFam(r['[fam]']);
    const name = cleanFam(r['[name]'] || '') || null;
    if (!mk) continue;
    const ds    = salesMap[mk] || 0;
    const stock = stockMap[mk] ?? -1;
    if (ds === 0 && stock === 0) { excluded++; continue; }
    if (ds > 0) hasSales.push({ makat: mk, fam, name });
    else        noSales.push({ makat: mk, fam, name });
  }

  noSales.sort((a, b) => (a.fam || '').localeCompare(b.fam || '') || Number(a.makat) - Number(b.makat));

  console.log(`Products with sales: ${hasSales.length} | without: ${noSales.length} | excluded (no sales+stock): ${excluded}`);

  // ── Step 3: Build picks from בררת מחדל FOR ALL ──────────────────────────────
  const RESERVE_SLOTS = TOTAL_SLOTS - WORKING_SLOTS;
  const allProds = [...hasSales, ...noSales];
  const makatDataMap = {};
  for (const p of allProds) makatDataMap[p.makat] = { fam: p.fam, name: p.name };

  const bdPicks = loadBreiraDefault('דגים');
  const picks = {};
  const bdMakatSet = new Set();
  for (const [bay, bd] of Object.entries(bdPicks)) {
    const data = makatDataMap[bd.makat];
    picks[bay] = { makat: bd.makat, fam: data?.fam || bd.fam || null, name: data?.name || bd.name || null, printOrder: bd.printOrder ?? null };
    bdMakatSet.add(String(bd.makat));
  }

  for (let n = RESERVE_START; n < RESERVE_START + RESERVE_SLOTS; n++) {
    if (!(String(n) in picks)) picks[String(n)] = null;
  }

  const activeSet = new Set(allProds.map(p => String(p.makat)));
  let kCleaned = 0;
  for (const pk of Object.keys(picks)) {
    if (Number(pk) < RESERVE_START || !picks[pk]) continue;
    if (!activeSet.has(String(picks[pk].makat))) { picks[pk] = null; kCleaned++; }
  }
  if (kCleaned > 0) console.log(`Cleaned ${kCleaned} reserve slots (inactive)`);

  const emptyReserve = [];
  for (let n = RESERVE_START; n < RESERVE_START + RESERVE_SLOTS; n++) {
    if (!picks[String(n)]) emptyReserve.push(n);
  }

  const newProducts = allProds.filter(p => !bdMakatSet.has(String(p.makat)));
  let slotIdx = 0;
  const added = [];
  for (const prod of newProducts) {
    if (slotIdx >= emptyReserve.length) { console.warn(`⚠ No reserve slot for ${prod.makat}`); break; }
    const pk = String(emptyReserve[slotIdx++]);
    picks[pk] = { makat: prod.makat, fam: prod.fam, name: prod.name || null };
    added.push(`${prod.makat}(${prod.fam})→pick${pk}`);
  }
  if (added.length) console.log(`Added to reserve: ${added.join(', ')}`);
  console.log(`בררת מחדל FOR ALL: ${Object.keys(bdPicks).length} positions | new to reserve: ${newProducts.length} | cleaned: ${kCleaned}`);

  // ── Step 4: Write dagim-base.json ─────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 16).replace('T','-').replace(':','');
  const result = {
    picks,
    layout,
    maxCols: existing.maxCols || 29,
    maxRows: existing.maxRows || 9,
    reserveStart: RESERVE_START,
    v: `${today}-dagim-fab-v1`,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n✅ Written: ${OUT_PATH}`);

  const famCounts = {};
  for (const p of allProds) famCounts[p.fam || '?'] = (famCounts[p.fam || '?'] || 0) + 1;
  for (const [fam, cnt] of Object.entries(famCounts)) console.log(`  ${fam}: ${cnt}`);
})().catch(e => { console.error(e); process.exit(1); });
