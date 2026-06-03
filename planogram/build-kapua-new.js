/**
 * build-kapua-new.js
 * Builds kapua-base.json from Fabric (Power BI / KARTIS PARIT) only.
 * Same schema as build-dagim-fab.js / build-halavi-new.js
 * Preserves ברירת מחדל — existing picks kept, new products added to reserve.
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

const OUT_PATH = path.join(__dirname, '..', 'docs', 'kapua-base.json');
const SECTION  = 'קפוא ❄';

const WORKING_SLOTS = 61;
const RESERVE_SLOTS = 18;
const RESERVE_START = 62;

const BLACKLIST = new Set(['1130', '1131']);

// fam from KARTIS PARIT — fix reversed Hebrew only, no manual remapping
function fixHebRTL(s) {
  if (!s) return s;
  return s.replace(/[ְ-תװ-״]+/g, m => m.split('').reverse().join(''));
}
function cleanFam(raw) {
  const s = (raw || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
  return fixHebRTL(s) || null;
}

async function dax(token, query) {
  const res = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${process.env.PBI_WORKSPACE}/datasets/${process.env.PBI_DATASET}/executeQueries`,
    { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }) }
  );
  const j = await res.json();
  if (j.error) throw new Error('DAX error: ' + JSON.stringify(j.error));
  return j.results?.[0]?.tables?.[0]?.rows || [];
}

(async () => {
  // ── Step 1: Load physical layout from existing kapua-base.json ─────────────
  const existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const { layout = {}, maxCols = 18, maxRows = 11 } = existing;
  console.log(`Layout: ${Object.keys(layout).length} positions (from kapua-base.json)`);

  // ── Step 2: Fetch products + 365-day sales from Fabric ────────────────────
  const t = await getToken();

  const sectionMakatim = `
    SELECTCOLUMNS(
      FILTER('KARTIS PARIT',
        'KARTIS PARIT'[סטטוס] = "פעיל" &&
        'KARTIS PARIT'[שם מחסן אשדוד] = "${SECTION}"
      ),
      "mk", 'KARTIS PARIT'[מק"ט]
    )`;

  const [kpRows, salesRows] = await Promise.all([
    dax(t, `
      EVALUATE
      SELECTCOLUMNS(
        FILTER('KARTIS PARIT',
          'KARTIS PARIT'[סטטוס] = "פעיל" &&
          'KARTIS PARIT'[שם מחסן אשדוד] = "${SECTION}"
        ),
        "makat", 'KARTIS PARIT'[מק"ט],
        "fam",   'KARTIS PARIT'[תאור משפחה],
        "name",  'KARTIS PARIT'[תאור]
        
      )
    `),
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "mkr365", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 365),
        TREATAS(${sectionMakatim}, 'ALL_PARTS'[מק'ט])
      )
    `),
  ]);

  const salesMap = {};
  for (const r of salesRows) {
    const mk = String(r["ALL_PARTS[מק'ט]"] || '').trim();
    if (mk) salesMap[mk] = r['[mkr365]'] || 0;
  }

  const seen = new Set();
  const products = [];
  for (const r of kpRows) {
    const mk   = String(r['[makat]'] || '').trim();
    const fam  = cleanFam(r['[fam]']);
    const name = cleanFam(r['[name]'] || '') || null;
    if (!mk || seen.has(mk)) continue;
    seen.add(mk);
    if (BLACKLIST.has(mk)) { console.log(`  ⛔ blacklisted: ${mk}`); continue; }
    const mkr = salesMap[mk] || 0;
    products.push({ makat: mk, fam, name, mkr365: mkr });
  }

  // Sort: family alphabetical → sales desc within family
  products.sort((a, b) => {
    const fo = (a.fam || '').localeCompare(b.fam || '', 'he');
    return fo !== 0 ? fo : b.mkr365 - a.mkr365;
  });

  console.log(`Products (active, not blacklisted): ${products.length}`);
  if (products.length > WORKING_SLOTS)
    console.warn(`⚠ ${products.length - WORKING_SLOTS} products overflow ${WORKING_SLOTS} working slots`);

  // ── Step 3: Build picks from בררת מחדל FOR ALL ──────────────────────────────
  const makatDataMap = {};
  for (const p of products) makatDataMap[p.makat] = { fam: p.fam, name: p.name };

  const bdPicks = await loadBreiraDefault('קפוא');
  const picks = {};
  const bdMakatSet = new Set();
  for (const [bay, bd] of Object.entries(bdPicks)) {
    const data = makatDataMap[bd.makat];
    picks[bay] = { makat: bd.makat, fam: data?.fam || bd.fam || null, name: data?.name || bd.name || null };
    bdMakatSet.add(String(bd.makat));
  }

  for (let n = RESERVE_START; n < RESERVE_START + RESERVE_SLOTS; n++) {
    if (!(String(n) in picks)) picks[String(n)] = null;
  }

  const activeSet = new Set(products.map(p => String(p.makat)));
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

  const newProducts = products.filter(p => !bdMakatSet.has(String(p.makat)));
  let slotIdx = 0;
  const added = [];
  for (const prod of newProducts) {
    if (slotIdx >= emptyReserve.length) { console.warn(`⚠ No reserve slot for ${prod.makat}`); break; }
    const pk = String(emptyReserve[slotIdx++]);
    picks[pk] = { makat: prod.makat, fam: prod.fam, name: prod.name || null };
    added.push(`${prod.makat}(${prod.fam})→pick${pk}`);
  }
  console.log(`בררת מחדל FOR ALL: ${Object.keys(bdPicks).length} positions | new to reserve: ${newProducts.length} | cleaned: ${kCleaned}`);


  // ── Step 4: Write kapua-base.json ─────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const newV  = added.length > 0 ? `${today}-kapua-new` : (existing.v || `${today}-kapua-v1`);
  const result = { picks, layout, maxCols, maxRows, reserveStart: RESERVE_START, v: newV };
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');

  if (added.length) {
    console.log(`\n✅ Written: ${OUT_PATH} — ${added.length} new products added to reserve:`);
    added.forEach(s => console.log(`  ${s}`));
  } else {
    console.log(`\n✅ Written: ${OUT_PATH} — ברירת מחדל preserved, ${products.length} products known, 0 new`);
  }

  const famCounts = {};
  for (const p of products) famCounts[p.fam || '?'] = (famCounts[p.fam || '?'] || 0) + 1;
  for (const [fam, cnt] of Object.entries(famCounts)) console.log(`  ${fam}: ${cnt}`);
})().catch(e => { console.error(e); process.exit(1); });
