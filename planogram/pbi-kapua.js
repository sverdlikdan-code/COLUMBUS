/**
 * Fetch קפוא live data from Power BI / Fabric (replaces קפוא.xlsx)
 * Returns: Map<makat, { desc, stock, daySales }>
 *
 * stock    = cartons at אשדוד (מחסן Main), 0 if not found
 * daySales = [TOTAL מכר בקרטונים ממוצע ביום] official BI measure, last 90d, Main only
 * desc     = product name from מלאי-תוקף (visual RTL — fixVisualRTL applied in build script)
 *
 * Family filter (MLAY[משפחת מוצר] codes) — new products in these families auto-discovered:
 *   029=חמאה FERMA  004=חמאה רושן  022=ממרחי חמאה  019=כיסונים/סירניקי
 *   035=SANTA BREMOR סלמון/פורל
 *   421=עוגות רושן  420=עוגות מוזיקה  046=חטיף גבינה
 *   0191=מוסדי  0190=Valesto מאפה
 *
 * NOTE: family 030 (SANTA BREMOR דגים) is excluded — it contains chilled (מצונן) products
 * not relevant to the frozen planogram. Products 1045/1046/1051 (surimi/frozen) are
 * passed via the explicit makatim list and fetched through UNION with famMakatim.
 */

const TENANT    = process.env.PBI_TENANT;
const CLIENT    = process.env.PBI_CLIENT;
const SECRET    = process.env.PBI_SECRET;
const DATASET   = process.env.PBI_DATASET;
const WORKSPACE = process.env.PBI_WORKSPACE;

// Family codes from MLAY[משפחת מוצר] covering frozen קפוא sections
// 030 (SANTA BREMOR דגים) excluded — those are chilled (מצונן), not frozen
// Products 1045/1046/1051 from family 030 are frozen surimi and handled via explicit makat UNION
const KAPUA_FAM_CODES = ['029','004','022','019','035','421','420','046','0191','0190'];

async function getToken() {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT,
        client_secret: SECRET, scope: 'https://analysis.windows.net/powerbi/api/.default' }) }
  );
  const j = await res.json();
  if (!j.access_token) throw new Error('Power BI token failed: ' + JSON.stringify(j));
  return j.access_token;
}

async function dax(token, query) {
  const res = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE}/datasets/${DATASET}/executeQueries`,
    { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }) }
  );
  const j = await res.json();
  if (j.error) throw new Error('DAX error: ' + JSON.stringify(j.error));
  return j.results?.[0]?.tables?.[0]?.rows || [];
}

async function fetchKapuaFromBI(makatim) {
  const t = await getToken();

  // DAX sub-expression: family makatim UNION explicit makatim list
  // Family codes auto-discover new products in those families.
  // Explicit list adds products whose family (030=chilled) is excluded but specific SKUs are frozen.
  const famCodes    = KAPUA_FAM_CODES.map(c => `"${c}"`).join(',');
  const explicitMks = makatim.map(m => `"${m}"`).join(',');
  const famMakatim = `
    UNION(
      SELECTCOLUMNS(
        FILTER(MLAY, CONTAINSROW({${famCodes}}, MLAY[משפחת מוצר])),
        "mk", MLAY[מק'ט]
      ),
      SELECTCOLUMNS({${explicitMks}}, "mk", [Value])
    )`;

  // ── 1. Stock: products of our families at Main (Ashdod) ───────────────────
  const stockRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      FILTER(
        'מלאי-תוקף',
        'מלאי-תוקף'[מחסן] = "Main" &&
        CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])
      ),
      "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
    )
  `);

  // ── 2. Sales: [TOTAL מכר בקרטונים ממוצע ביום], FORMULA+Main, last 90d, our families
  const salesRows = await dax(t, `
    EVALUATE
    CALCULATETABLE(
      ADDCOLUMNS(
        SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
        "daySales", [TOTAL מכר בקרטונים ממוצע ביום]
      ),
      'ALL_PARTS'[חברה] = "FORMULA",
      'ALL_PARTS'[מחסן] = "Main",
      FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 90),
      TREATAS(${famMakatim}, 'ALL_PARTS'[מק'ט])
    )
  `);

  // ── 3. Desc: product name per מקט from מלאי-תוקף Main ────────────────────
  const descRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      'מלאי-תוקף'[תאור מוצר],
      FILTER(
        'מלאי-תוקף',
        'מלאי-תוקף'[מחסן] = "Main" &&
        CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])
      )
    )
  `);

  // ── 4. Desc fallback from MLAY master catalog (for products absent from מלאי-תוקף Main) ──
  const mlayDescRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      MLAY[מק'ט],
      MLAY[תאור מוצר],
      FILTER(MLAY, CONTAINSROW(${famMakatim}, MLAY[מק'ט]))
    )
  `);

  // ── 5. פק"ע per מקט at Main: expiry date + cartons per batch ─────────────
  const pakuaRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      'מלאי-תוקף'[ת. תפוגת תוקף],
      FILTER(
        'מלאי-תוקף',
        'מלאי-תוקף'[מחסן] = "Main" &&
        CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])
      ),
      "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
    )
    ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
  `);

  // ── Build result map ──────────────────────────────────────────────────────
  const result = {};
  for (const mk of makatim) result[mk] = { desc: null, stock: 0, daySales: null, pakuot: [] };

  for (const r of stockRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (mk && result[mk] !== undefined) result[mk].stock = r['[stock]'] || 0;
  }

  for (const r of salesRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (mk && result[mk] !== undefined) result[mk].daySales = r['[daySales]'] || null;
  }

  const descSeen = new Set();
  for (const r of descRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (mk && result[mk] !== undefined && !descSeen.has(mk)) {
      result[mk].desc = r['מלאי-תוקף[תאור מוצר]'] || null;
      descSeen.add(mk);
    }
  }
  // Fallback: products with 0 stock at Main won't be in מלאי-תוקף → use MLAY catalog
  for (const r of mlayDescRows) {
    const mk = r["MLAY[מק'ט]"];
    if (mk && result[mk] !== undefined && !result[mk].desc) {
      result[mk].desc = r["MLAY[תאור מוצר]"] || null;
    }
  }

  // Parse pakuaRows into per-מקט array, sorted by expiry date
  const today = new Date(); today.setHours(0,0,0,0);
  for (const r of pakuaRows) {
    const mk      = r['מלאי-תוקף[מק"ט]'];
    const cartons = r['[cartons]'] || 0;
    if (!mk || cartons <= 0) continue;
    if (result[mk] === undefined) continue;
    const rawDate = r["מלאי-תוקף[ת. תפוגת תוקף]"];
    let expDate = null;
    let daysLeft = null;
    if (rawDate) {
      expDate = new Date(rawDate);
      daysLeft = Math.round((expDate - today) / 86400000);
    }
    result[mk].pakuot.push({ date: expDate, daysLeft, cartons });
  }
  // Sort each product's batches by expiry date ascending
  for (const mk of makatim) {
    if (result[mk] && result[mk].pakuot.length > 1)
      result[mk].pakuot.sort((a, b) => (a.date||0) - (b.date||0));
  }

  // Log new makatim found in families but not yet in KAPUA_PICKS
  const allFamMks = new Set([
    ...stockRows.map(r => r['מלאי-תוקף[מק"ט]']),
    ...salesRows.map(r => r["ALL_PARTS[מק'ט]"]),
  ].filter(Boolean));
  const newMks = [...allFamMks].filter(mk => result[mk] === undefined);
  if (newMks.length) console.log(`⚠ New makatim in families (not in KAPUA_PICKS): ${newMks.join(', ')}`);

  const noStk    = makatim.filter(m => result[m].stock === 0).length;
  const withSales = makatim.filter(m => result[m].daySales != null).length;
  console.log(`Power BI קפוא: ${allFamMks.size} in families | ${noStk} zero-stock in picks | ${withSales} picks with sales`);
  return result;
}

// ── Last dataset refresh time (from Power BI refresh history API) ─────────────
// Returns ISO string of endTime of the most recent successful refresh, or null.
async function fetchLastRefresh() {
  try {
    const t = await getToken();
    const res = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE}/datasets/${DATASET}/refreshes?$top=5`,
      { headers: { 'Authorization': 'Bearer ' + t } }
    );
    const j = await res.json();
    const completed = (j.value || []).find(r => r.status === 'Completed' && r.endTime);
    return completed ? completed.endTime : null;
  } catch(e) {
    console.warn('Could not fetch refresh time:', e.message);
    return null;
  }
}

module.exports = { fetchKapuaFromBI, fetchLastRefresh };
