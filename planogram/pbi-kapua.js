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
const KAPUA_FAM_CODES = ['029','004','026','022','019','035','421','420','046','0191','0190'];

// Family code → display name (for auto-discovered products)
const KAPUA_FAM_NAMES = {
  '029':'חמאה FERMA', '004':'חמאה רושן',   '026':'חמאה SVALIA',
  '022':'ממרחי חמאה', '019':'כיסונים',     '035':'SANTA BREMOR',
  '421':'עוגות רושן', '420':'עוגות מוזיקה','046':'חטיף גבינה',
  '0191':'מוסדי',     '0190':'VALESTA',
};

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
  // Only include products with סטטוס="פעיל" in KARTIS PARIT (excludes discontinued items).
  // Explicit makatim (KAPUA_PICKS hardcoded) bypass the status filter via UNION.
  const famMakatim = `
    UNION(
      INTERSECT(
        SELECTCOLUMNS(
          FILTER(MLAY, CONTAINSROW({${famCodes}}, MLAY[משפחת מוצר])),
          "mk", MLAY[מק'ט]
        ),
        CALCULATETABLE(VALUES('KARTIS PARIT'[מק"ט]), 'KARTIS PARIT'[סטטוס]="פעיל")
      ),
      SELECTCOLUMNS({${explicitMks}}, "mk", [Value])
    )`;

  const [stockRows, salesRows, descRows, mlayDescRows, pakuaRows, salesAllRows, pakuaAllRows, nameEnRows] = await Promise.all([

    // 1. Stock at Main (Ashdod)
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        FILTER('מלאי-תוקף',
          'מלאי-תוקף'[מחסן] = "Main" &&
          CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])
        ),
        "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
      )
    `),

    // 2. Sales Main only — for planogram display
    dax(t, `
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
    `),

    // 3. Desc from מלאי-תוקף Main
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        'מלאי-תוקף'[תאור מוצר],
        FILTER('מלאי-תוקף',
          'מלאי-תוקף'[מחסן] = "Main" &&
          CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])
        )
      )
    `),

    // 4. Desc fallback from MLAY master catalog (also fetches family code for new products)
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        MLAY[מק'ט],
        MLAY[תאור מוצר],
        MLAY[משפחת מוצר],
        FILTER(MLAY, CONTAINSROW(${famMakatim}, MLAY[מק'ט]))
      )
    `),

    // 5. פק"ע batches at Main — for planogram display
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        'מלאי-תוקף'[ת. תפוגת תוקף],
        FILTER('מלאי-תוקף',
          'מלאי-תוקף'[מחסן] = "Main" &&
          CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])
        ),
        "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
      )
      ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
    `),

    // 6. Sales ALL warehouses — for סכנה calculation (no מחסן filter)
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySalesAll", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 90),
        TREATAS(${famMakatim}, 'ALL_PARTS'[מק'ט])
      )
    `),

    // 7. פק"ע batches ALL warehouses — for סכנה calculation (no מחסן filter)
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        'מלאי-תוקף'[ת. תפוגת תוקף],
        FILTER('מלאי-תוקף', CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])),
        "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
      )
      ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
    `),

    // 8. Product names + unit weight from KARTIS PARIT (pack factor is in SQL mmdint.dbo.PARTPACK)
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'KARTIS PARIT'[מק"ט],
        'KARTIS PARIT'[תאור],
        'KARTIS PARIT'[משקל ליחידה],
        FILTER('KARTIS PARIT', 'KARTIS PARIT'[סטטוס] = "פעיל")
      )
    `),

  ]);

  // ── Build result map ──────────────────────────────────────────────────────
  // Includes ALL makatim found in family queries, not just the passed (known) ones.
  const result = {};
  for (const mk of makatim) {
    result[mk] = { desc: null, stock: 0, daySales: null, pakuot: [], daySalesAll: null, pakuotAll: [], isNew: false };
  }
  // ensure: lazily add makatim discovered in family queries (not in KAPUA_PICKS)
  function ensure(mk) {
    if (!result[mk]) result[mk] = { desc: null, stock: 0, daySales: null, pakuot: [], daySalesAll: null, pakuotAll: [], isNew: true };
  }

  for (const r of stockRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (!mk) continue;
    ensure(mk);
    result[mk].stock = r['[stock]'] || 0;
  }

  for (const r of salesRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    ensure(mk);
    result[mk].daySales = r['[daySales]'] || null;
  }

  const descSeen = new Set();
  for (const r of descRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (!mk) continue;
    ensure(mk);
    if (!descSeen.has(mk)) { result[mk].desc = r['מלאי-תוקף[תאור מוצר]'] || null; descSeen.add(mk); }
  }
  // Fallback: products with 0 stock at Main won't be in מלאי-תוקף → use MLAY catalog
  // Also captures family name for newly discovered products
  for (const r of mlayDescRows) {
    const mk = r["MLAY[מק'ט]"];
    if (!mk) continue;
    ensure(mk);
    if (!result[mk].desc) result[mk].desc = r["MLAY[תאור מוצר]"] || null;
    if (!result[mk].fam) {
      const fc = r["MLAY[משפחת מוצר]"];
      result[mk].fam = (fc && KAPUA_FAM_NAMES[fc]) || fc || null;
    }
  }

  // Parse pakuaRows into per-מקט array, sorted by expiry date
  const today = new Date(); today.setHours(0,0,0,0);
  for (const r of pakuaRows) {
    const mk      = r['מלאי-תוקף[מק"ט]'];
    const cartons = r['[cartons]'] || 0;
    if (!mk || cartons <= 0) continue;
    ensure(mk);
    const rawDate = r["מלאי-תוקף[ת. תפוגת תוקף]"];
    let expDate = null, daysLeft = null;
    if (rawDate) { expDate = new Date(rawDate); daysLeft = Math.round((expDate - today) / 86400000); }
    result[mk].pakuot.push({ date: expDate, daysLeft, cartons });
  }
  for (const mk of Object.keys(result)) {
    if (result[mk].pakuot.length > 1) result[mk].pakuot.sort((a, b) => (a.date||0) - (b.date||0));
  }

  // ── daySalesAll: all-warehouse sales (for סכנה calculation) ──────────────
  for (const r of salesAllRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    ensure(mk);
    result[mk].daySalesAll = r['[daySalesAll]'] || null;
  }

  // ── pakuotAll: all-warehouse expiry batches (for סכנה calculation) ────────
  for (const r of pakuaAllRows) {
    const mk      = r['מלאי-תוקף[מק"ט]'];
    const cartons = r['[cartons]'] || 0;
    if (!mk || cartons <= 0) continue;
    ensure(mk);
    const rawDate = r["מלאי-תוקף[ת. תפוגת תוקף]"];
    let expDate = null, daysLeft = null;
    if (rawDate) { expDate = new Date(rawDate); daysLeft = Math.round((expDate - today) / 86400000); }
    result[mk].pakuotAll.push({ date: expDate, daysLeft, cartons });
  }
  for (const mk of Object.keys(result)) {
    if (result[mk].pakuotAll.length > 1) result[mk].pakuotAll.sort((a, b) => (a.date||0) - (b.date||0));
  }

  for (const r of nameEnRows) {
    const mk = r['KARTIS PARIT[מק"ט]'];
    if (!mk) continue;
    ensure(mk);
    const name = r['KARTIS PARIT[תאור]'];
    result[mk].nameEn = (name && name.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim()) || null;
  }

  const newMks   = Object.keys(result).filter(mk => result[mk].isNew);
  const noStk    = makatim.filter(m => !result[m] || result[m].stock === 0).length;
  const withSales = Object.keys(result).filter(m => result[m].daySales != null).length;
  if (newMks.length) console.log(`🆕 פעיל new makatim in families: ${newMks.join(', ')}`);
  const nameEnMap = {};
  for (const r of nameEnRows) {
    const mk   = r['KARTIS PARIT[מק"ט]'];
    const name = r['KARTIS PARIT[תאור]'];
    if (mk) nameEnMap[String(mk)] = (name && name.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim()) || null;
  }

  console.log(`Power BI קפוא: ${Object.keys(result).length} total (${newMks.length} new) | ${noStk} zero-stock | ${withSales} with sales`);
  return { kapuaData: result, nameEnMap };
}

// ── Last data update time (from SERVER DATE TIME table in Fabric dataset) ─────
// The table is built from MAX(ORDERS.UDATE) → actual SQL Server last-order time.
async function fetchLastRefresh() {
  try {
    const t = await getToken();
    const rows = await dax(t, `EVALUATE 'SERVER DATE TIME'`);
    if (rows && rows.length) {
      const raw = rows[0]['SERVER DATE TIME[תאריך עדכון]'];
      if (raw) return String(raw); // Fabric returns Israel local time — return as-is, no UTC conversion
    }
    return null;
  } catch(e) {
    console.warn('Could not fetch SERVER DATE TIME:', e.message);
    return null;
  }
}

// ── Fetch stock + sales at Main only for חלבי / דגים makatim ────────────────
async function fetchStockMain(makatim) {
  if (!makatim || !makatim.length) return {};
  const t = await getToken();
  const mkSet = '{' + makatim.map(m => `"${m}"`).join(',') + '}';

  const [stockRows, salesRows, salesAllRows] = await Promise.all([
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        FILTER('מלאי-תוקף',
          'מלאי-תוקף'[מחסן] = "Main" &&
          CONTAINSROW(${mkSet}, 'מלאי-תוקף'[מק"ט])
        ),
        "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
      )
    `),
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySales", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        'ALL_PARTS'[מחסן] = "Main",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 90),
        TREATAS(${mkSet}, 'ALL_PARTS'[מק'ט])
      )
    `),
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySalesAll", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 90),
        TREATAS(${mkSet}, 'ALL_PARTS'[מק'ט])
      )
    `),
  ]);

  const result = {};
  for (const mk of makatim) result[mk] = { stock: 0, daySales: null, daySalesAll: null };

  for (const r of stockRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null };
    result[mk].stock = r['[stock]'] || 0;
  }
  for (const r of salesRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null };
    result[mk].daySales = r['[daySales]'] || null;
  }
  for (const r of salesAllRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null };
    result[mk].daySalesAll = r['[daySalesAll]'] || null;
  }

  console.log(`Stock/sales Main: ${Object.values(result).filter(v=>v.stock>0).length}/${makatim.length} with stock`);
  return result;
}

// ── Fetch pakuot (expiry batches at Main) for any list of מקטים ────────────
// Used for חלבי / דגים products whose pakuot comes from Fabric.
async function fetchPakuotForMakats(makatim) {
  if(!makatim || !makatim.length) return {};
  const t = await getToken();
  const mkSet = '{' + makatim.map(m => `"${m}"`).join(',') + '}';
  const pakuaRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      'מלאי-תוקף'[ת. תפוגת תוקף],
      FILTER(
        'מלאי-תוקף',
        'מלאי-תוקף'[מחסן] = "Main" &&
        CONTAINSROW(${mkSet}, 'מלאי-תוקף'[מק"ט])
      ),
      "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
    )
    ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
  `);

  const result = {};
  const today = new Date(); today.setHours(0,0,0,0);
  for(const r of pakuaRows) {
    const mk = String(r['מלאי-תוקף[מק"ט]'] || '');
    if(!mk) continue;
    if(!result[mk]) result[mk] = [];
    const rawDate = r['מלאי-תוקף[ת. תפוגת תוקף]'];
    let expDate = null, daysLeft = null;
    if(rawDate) { expDate = new Date(rawDate); daysLeft = Math.round((expDate - today) / 86400000); }
    const cartons = r['[cartons]'] || 0;
    if(cartons > 0) result[mk].push({ date: expDate, daysLeft, cartons });
  }
  for(const mk of Object.keys(result)) result[mk].sort((a,b) => (a.date||0) - (b.date||0));
  console.log(`פק"ע fetched for ${Object.keys(result).length} חלבי/דגים products`);
  return result;
}

// ── Fetch pakuot ALL warehouses — for סכנה calculation (חלבי/דגים) ──────────
async function fetchPakuotAllForMakats(makatim) {
  if(!makatim || !makatim.length) return {};
  const t = await getToken();
  const mkSet = '{' + makatim.map(m => `"${m}"`).join(',') + '}';
  const rows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      'מלאי-תוקף'[ת. תפוגת תוקף],
      FILTER('מלאי-תוקף', CONTAINSROW(${mkSet}, 'מלאי-תוקף'[מק"ט])),
      "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
    )
    ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
  `);
  const result = {};
  const today = new Date(); today.setHours(0,0,0,0);
  for(const r of rows) {
    const mk = String(r['מלאי-תוקף[מק"ט]'] || '');
    if(!mk) continue;
    if(!result[mk]) result[mk] = [];
    const rawDate = r['מלאי-תוקף[ת. תפוגת תוקף]'];
    let expDate = null, daysLeft = null;
    if(rawDate) { expDate = new Date(rawDate); daysLeft = Math.round((expDate - today) / 86400000); }
    const cartons = r['[cartons]'] || 0;
    if(cartons > 0) result[mk].push({ date: expDate, daysLeft, cartons });
  }
  for(const mk of Object.keys(result)) result[mk].sort((a,b) => (a.date||0) - (b.date||0));
  return result;
}

// ── Fetch pack factors from SQL Server mmdint.dbo.PARTPACK ───────────────────
// Returns Map<makat, packFactor> where packFactor = units per carton (PACKQUANT/1000)
async function fetchPackFactors() {
  const sql  = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'mssql'));
  const pool = await sql.connect({
    server:   process.env.DB_SERVER || '192.168.100.246',
    port:     Number(process.env.DB_PORT || 1433),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'mmdint',
    options:  { trustServerCertificate: true, encrypt: false },
    requestTimeout: 15000, connectionTimeout: 10000,
  });
  const res = await pool.request().query(`
    SELECT p.PARTNAME AS makat, pp.PACKQUANT / 1000.0 AS packFactor
    FROM dbo.PARTPACK pp
    INNER JOIN dbo.PART p ON p.PART = pp.PART
    WHERE pp.PACKQUANT > 0
  `);
  await pool.close();
  const map = {};
  for (const r of res.recordset) {
    if (r.makat && r.packFactor > 0) map[String(r.makat)] = r.packFactor;
  }
  console.log(`Pack factors loaded from SQL: ${Object.keys(map).length} products`);
  return map;
}

module.exports = { fetchKapuaFromBI, fetchLastRefresh, fetchStockMain, fetchPakuotForMakats, fetchPakuotAllForMakats, fetchPackFactors, getToken };
