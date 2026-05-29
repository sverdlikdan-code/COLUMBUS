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

const OUT_PATH = path.join(__dirname, '..', 'docs', 'kapua-base.json');
const SECTION  = 'קפוא ❄';

const WORKING_SLOTS = 61;
const RESERVE_SLOTS = 18;
const RESERVE_START = 62;

const BLACKLIST = new Set(['1130', '1131']);

// fixHebRTL(clean KARTIS PARIT value) → display name
const FAM_NAMES = {
  'FERMA חמאה':              'חמאה FERMA',
  'SANTA BREMOR פורל/סלמון': 'SANTA BREMOR',
  'SANTA BREMOR דגים':       'SANTA BREMOR דגים',
  'SVALIA חמאה':             'חמאה SVALIA',
  'Valesto מאפה':            'VALESTA',
  'חמאה ממרחי':              'ממרחי חמאה',
  'גבינה חטיף':              'חטיף גבינה',
  'מוזאיקה עוגות':           'עוגות מוזיקה',
  'מוסדי':                   'מוסדי',
  'סירניקי/כיסונים':         'כיסונים',
  'רושן חמאה':               'חמאה רושן',
  'רושן עוגות':              'עוגות רושן',
};

// Approved family order (user-confirmed)
const FAM_ORDER_LIST = [
  'חמאה FERMA', 'חמאה רושן', 'חמאה SVALIA', 'ממרחי חמאה',
  'כיסונים', 'SANTA BREMOR',
  'עוגות רושן', 'עוגות מוזיקה', 'חטיף גבינה',
  'SANTA BREMOR דגים', 'VALESTA', 'מוסדי',
];
const FAM_ORDER = {};
FAM_ORDER_LIST.forEach((f, i) => { FAM_ORDER[f] = i; });

function fixHebRTL(s) {
  if (!s) return s;
  return s.replace(/[ְ-תװ-״]+/g, m => m.split('').reverse().join(''));
}

function cleanFam(raw) {
  const clean = (raw || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
  const fixed = fixHebRTL(clean);
  if (!fixed) return null;
  if (FAM_NAMES[fixed]) return FAM_NAMES[fixed];
  console.log(`kapua fam unknown: ${JSON.stringify(fixed)}`);
  return fixed;
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
        "fam",   'KARTIS PARIT'[תאור משפחה]
      )
      ORDER BY 'KARTIS PARIT'[תאור משפחה], 'KARTIS PARIT'[מק"ט]
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
    const mk  = String(r['[makat]'] || '').trim();
    const fam = cleanFam(r['[fam]']);
    if (!mk || seen.has(mk)) continue;
    seen.add(mk);
    if (BLACKLIST.has(mk)) { console.log(`  ⛔ blacklisted: ${mk}`); continue; }
    const mkr = salesMap[mk] || 0;
    products.push({ makat: mk, fam, mkr365: mkr });
  }

  // Sort: family order → sales desc within family
  products.sort((a, b) => {
    const fo = (FAM_ORDER[a.fam] ?? 99) - (FAM_ORDER[b.fam] ?? 99);
    return fo !== 0 ? fo : b.mkr365 - a.mkr365;
  });

  console.log(`Products (active, not blacklisted): ${products.length}`);
  if (products.length > WORKING_SLOTS)
    console.warn(`⚠ ${products.length - WORKING_SLOTS} products overflow ${WORKING_SLOTS} working slots`);

  // ── Step 3: Preserve ברירת מחדל, add new products to reserve slots ─────────
  const existingPicks   = existing.picks || {};
  const existingMakatSet = new Set(
    Object.values(existingPicks).filter(Boolean).map(p => String(p.makat))
  );

  // Build makat→fam map for normalizing fam in existing picks
  const makatFamMap = {};
  for (const p of products) makatFamMap[p.makat] = p.fam;

  // Copy existing picks, normalizing fam where known
  const picks = {};
  for (const [pk, p] of Object.entries(existingPicks)) {
    if (p && makatFamMap[String(p.makat)]) picks[pk] = { ...p, fam: makatFamMap[String(p.makat)] };
    else picks[pk] = p;
  }

  // Ensure all reserve slots exist
  for (let n = RESERVE_START; n < RESERVE_START + RESERVE_SLOTS; n++) {
    if (!(String(n) in picks)) picks[String(n)] = null;
  }

  // Clean reserve slots: remove products no longer active in KARTIS PARIT
  const activeSet = new Set(products.map(p => String(p.makat)));
  let kCleaned = 0;
  for (const pk of Object.keys(picks)) {
    if (Number(pk) < RESERVE_START || !picks[pk]) continue;
    if (!activeSet.has(String(picks[pk].makat))) { picks[pk] = null; kCleaned++; }
  }
  if (kCleaned > 0) console.log(`Cleaned ${kCleaned} reserve slots (inactive/zero sales)`);

  // Empty reserve slots after cleanup
  const emptyReserve = [];
  for (let n = RESERVE_START; n < RESERVE_START + RESERVE_SLOTS; n++) {
    if (!picks[String(n)]) emptyReserve.push(n);
  }

  // New products → reserve slots
  const newProducts = products.filter(p => !existingMakatSet.has(String(p.makat)));
  let slotIdx = 0;
  const added = [];
  for (const prod of newProducts) {
    if (slotIdx >= emptyReserve.length) { console.warn(`⚠ No reserve slot for ${prod.makat}`); break; }
    const pk = String(emptyReserve[slotIdx++]);
    picks[pk] = { makat: prod.makat, fam: prod.fam, name: null };
    added.push(`${prod.makat}(${prod.fam})→pick${pk}`);
  }

  // Fix garbled/unknown fam in all slots (legacy values from pre-KARTIS PARIT builds)
  const knownFams = new Set(FAM_ORDER_LIST);
  let fFixed = 0;
  for (const [pk, p] of Object.entries(picks)) {
    if (p && p.fam && !knownFams.has(p.fam)) {
      picks[pk] = { ...p, fam: null };
      fFixed++;
    }
  }
  if (fFixed > 0) console.log(`Fixed ${fFixed} garbled/unknown fam → null`);

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
