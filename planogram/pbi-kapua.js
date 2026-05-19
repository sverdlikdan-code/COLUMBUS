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

  // Active קפוא products from KARTIS PARIT by warehouse column UNION explicit makatim.
  // Explicit list (KAPUA_PICKS hardcoded) bypasses status filter for edge-case SKUs.
  const explicitMks = makatim.map(m => `"${m}"`).join(',');
  const famMakatim = `
    UNION(
      SELECTCOLUMNS(
        FILTER('KARTIS PARIT',
          'KARTIS PARIT'[סטטוס] = "פעיל" &&
          'KARTIS PARIT'[שם מחסן אשדוד] = "קפוא ❄"
        ),
        "mk", 'KARTIS PARIT'[מק"ט]
      ),
      SELECTCOLUMNS({${explicitMks}}, "mk", [Value])
    )`;

  const [stockRows, salesRows, descRows, mlayDescRows, pakuaRows, salesAllRows, pakuaAllRows, nameEnRows, packFactorRows, stockZafnRows, stockTrnzRows, salesZafnRows, salesTrnzRows, pakuaZafnRows] = await Promise.all([

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
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 45),
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
        MLAY[תאור משפחה],
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
        "cartons",  SUM('מלאי-תוקף'[קרטון מלאי תוקף]),
        "daysLeft", MAX('מלאי-תוקף'[כמה ימים נשארו])
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
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 45),
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
        "cartons",  SUM('מלאי-תוקף'[קרטון מלאי תוקף]),
        "daysLeft", MAX('מלאי-תוקף'[כמה ימים נשארו])
      )
      ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
    `),

    // 8. Product names + unit weight + shelf life from KARTIS PARIT
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'KARTIS PARIT'[מק"ט],
        'KARTIS PARIT'[תאור],
        'KARTIS PARIT'[משקל ליחידה],
        FILTER('KARTIS PARIT', 'KARTIS PARIT'[סטטוס] = "פעיל"),
        "shelfLife", MAX('KARTIS PARIT'[חיי מדף])
      )
    `),

    // 9. Pack factor (units per carton) from גורם אירוז lookup table
    dax(t, `
      EVALUATE
      SELECTCOLUMNS(
        FILTER('גורם אירוז', CONTAINSROW(${famMakatim}, 'גורם אירוז'[מק"ט])),
        "mk", 'גורם אירוז'[מק"ט],
        "packFactor", 'גורם אירוז'[תכולת האריזה למוצר]
      )
    `),

    // 10. Stock at Zafn (North warehouse)
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        FILTER('מלאי-תוקף',
          'מלאי-תוקף'[מחסן] = "Zafn" &&
          CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])
        ),
        "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
      )
    `),

    // 11. Stock at Trnz (transit warehouse)
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        FILTER('מלאי-תוקף',
          'מלאי-תוקף'[מחסן] = "Trnz" &&
          CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])
        ),
        "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
      )
    `),

    // 12. Sales Zafn — avg day cartons
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySalesZafn", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        'ALL_PARTS'[מחסן] = "Zafn",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 45),
        TREATAS(${famMakatim}, 'ALL_PARTS'[מק'ט])
      )
    `),

    // 13. Sales Trnz — avg day cartons
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySalesTrnz", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        'ALL_PARTS'[מחסן] = "Trnz",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 45),
        TREATAS(${famMakatim}, 'ALL_PARTS'[מק'ט])
      )
    `),

    // 14. פק"ע batches at Zafn (North) — for two-warehouse expiry report
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        'מלאי-תוקף'[ת. תפוגת תוקף],
        FILTER('מלאי-תוקף',
          'מלאי-תוקף'[מחסן] = "Zafn" &&
          CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])
        ),
        "cartons",  SUM('מלאי-תוקף'[קרטון מלאי תוקף]),
        "daysLeft", MAX('מלאי-תוקף'[כמה ימים נשארו])
      )
      ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
    `),

  ]);

  // ── Build result map ──────────────────────────────────────────────────────
  // Includes ALL makatim found in family queries, not just the passed (known) ones.
  const result = {};
  for (const mk of makatim) {
    result[mk] = { desc: null, stock: 0, daySales: null, pakuot: [], daySalesAll: null, pakuotAll: [], shelfLife: null, isNew: false };
  }
  // ensure: lazily add makatim discovered in family queries (not in KAPUA_PICKS)
  function ensure(mk) {
    if (!result[mk]) result[mk] = { desc: null, stock: 0, daySales: null, pakuot: [], daySalesAll: null, pakuotAll: [], shelfLife: null, isNew: true };
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
      result[mk].fam = r["MLAY[תאור משפחה]"] || r["MLAY[משפחת מוצר]"] || null;
    }
  }

  // Parse pakuaRows into per-מקט array — daysLeft/sellDays/sakana from PBI
  for (const r of pakuaRows) {
    const mk      = r['מלאי-תוקף[מק"ט]'];
    const cartons = r['[cartons]'] || 0;
    if (!mk || cartons <= 0) continue;
    ensure(mk);
    const rawDate  = r["מלאי-תוקף[ת. תפוגת תוקף]"];
    const expDate  = rawDate ? new Date(rawDate) : null;
    const daysLeft = r['[daysLeft]'] ?? null;
    const sellDays = r['[sellDays]'] ?? null;
    const sakana   = r['[sakana]'] === 1;
    result[mk].pakuot.push({ date: expDate, daysLeft, cartons, sellDays, sakana });
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
    const rawDate  = r["מלאי-תוקף[ת. תפוגת תוקף]"];
    const expDate  = rawDate ? new Date(rawDate) : null;
    const daysLeft = r['[daysLeft]'] ?? null;
    const sellDays = r['[sellDays]'] ?? null;
    const sakana   = r['[sakana]'] === 1;
    result[mk].pakuotAll.push({ date: expDate, daysLeft, cartons, sellDays, sakana });
  }
  for (const mk of Object.keys(result)) {
    if (result[mk].pakuotAll.length > 1) result[mk].pakuotAll.sort((a, b) => (a.date||0) - (b.date||0));
  }

  // ── pakuotZafn: Zafn (North) expiry batches ───────────────────────────────
  for (const mk of Object.keys(result)) { result[mk].pakuotZafn = []; }
  for (const r of pakuaZafnRows) {
    const mk      = r['מלאי-תוקף[מק"ט]'];
    const cartons = r['[cartons]'] || 0;
    if (!mk || cartons <= 0) continue;
    ensure(mk);
    if (!result[mk].pakuotZafn) result[mk].pakuotZafn = [];
    const rawDate  = r["מלאי-תוקף[ת. תפוגת תוקף]"];
    const expDate  = rawDate ? new Date(rawDate) : null;
    const daysLeft = r['[daysLeft]'] ?? null;
    const sellDays = r['[sellDays]'] ?? null;
    const sakana   = r['[sakana]'] === 1;
    result[mk].pakuotZafn.push({ date: expDate, daysLeft, cartons, sellDays, sakana });
  }
  for (const mk of Object.keys(result)) {
    if (result[mk].pakuotZafn?.length > 1) result[mk].pakuotZafn.sort((a, b) => (a.date||0) - (b.date||0));
  }

  // nameEn + shelfLife from KARTIS PARIT (Query 8) — authoritative product catalog
  for (const r of nameEnRows) {
    const mk = String(r['KARTIS PARIT[מק"ט]'] || '');
    if (!mk) continue;
    ensure(mk);
    result[mk].shelfLife = r['[shelfLife]'] ?? null;
    const kpName = r['KARTIS PARIT[תאור]'];
    if (kpName) result[mk].nameEn = kpName.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim() || null;
  }

  for (const r of packFactorRows) {
    const mk = r['[mk]'];
    if (!mk) continue;
    ensure(mk);
    const pf = r['[packFactor]'];
    if (pf) result[mk].packFactor = pf;
  }

  for (const r of stockZafnRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (!mk) continue;
    ensure(mk);
    result[mk].stockZafn = r['[stock]'] || 0;
  }

  for (const r of stockTrnzRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (!mk) continue;
    ensure(mk);
    result[mk].stockTrnz = r['[stock]'] || 0;
  }

  for (const r of salesZafnRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    ensure(mk);
    result[mk].daySalesZafn = r['[daySalesZafn]'] || null;
  }

  for (const r of salesTrnzRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    ensure(mk);
    result[mk].daySalesTrnz = r['[daySalesTrnz]'] || null;
  }

  const newMks   = Object.keys(result).filter(mk => result[mk].isNew);
  const noStk    = makatim.filter(m => !result[m] || result[m].stock === 0).length;
  const withSales = Object.keys(result).filter(m => result[m].daySales != null).length;
  if (newMks.length) console.log(`🆕 פעיל new makatim in families: ${newMks.join(', ')}`);
  const nameEnMap = {};
  for (const r of nameEnRows) {
    const mk   = String(r['KARTIS PARIT[מק"ט]'] || '');
    const name = r['KARTIS PARIT[תאור]'];
    if (mk) nameEnMap[mk] = (name && name.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim()) || null;
  }

  console.log(`Power BI קפוא: ${Object.keys(result).length} total (${newMks.length} new) | ${noStk} zero-stock | ${withSales} with sales`);
  return { kapuaData: result, nameEnMap };
}

// ── Last data update time (from SERVER DATE TIME table in Fabric dataset) ─────
// The table is built from MAX(ORDERS.UDATE) → actual SQL Server last-order time.
async function fetchLastRefresh() {
  try {
    const t = await getToken();
    const res = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE}/datasets/${DATASET}/refreshes?$top=1`,
      { headers: { 'Authorization': 'Bearer ' + t } }
    );
    const j = await res.json();
    const last = j?.value?.[0];
    if (last?.endTime) {
      // endTime is UTC ISO — convert to Israel time (UTC+3 summer)
      const d = new Date(last.endTime);
      const il = new Date(d.getTime() + 3 * 60 * 60 * 1000);
      const pad = n => String(n).padStart(2, '0');
      return `${il.getUTCFullYear()}-${pad(il.getUTCMonth()+1)}-${pad(il.getUTCDate())}T${pad(il.getUTCHours())}:${pad(il.getUTCMinutes())}:00`;
    }
    return null;
  } catch(e) {
    console.warn('Could not fetch dataset refresh history:', e.message);
    return null;
  }
}

// ── Fetch stock + sales at Main only for חלבי / דגים makatim ────────────────
async function fetchStockMain(makatim) {
  if (!makatim || !makatim.length) return {};
  const t = await getToken();
  const mkSet = '{' + makatim.map(m => `"${m}"`).join(',') + '}';

  const [stockRows, salesRows, salesAllRows, stockZafnRows, stockTrnzRows, salesZafnRows, salesTrnzRows, sales90Rows] = await Promise.all([
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
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 45),
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
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 45),
        TREATAS(${mkSet}, 'ALL_PARTS'[מק'ט])
      )
    `),
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        FILTER('מלאי-תוקף',
          'מלאי-תוקף'[מחסן] = "Zafn" &&
          CONTAINSROW(${mkSet}, 'מלאי-תוקף'[מק"ט])
        ),
        "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
      )
    `),
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        FILTER('מלאי-תוקף',
          'מלאי-תוקף'[מחסן] = "Trnz" &&
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
          "daySalesZafn", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        'ALL_PARTS'[מחסן] = "Zafn",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 45),
        TREATAS(${mkSet}, 'ALL_PARTS'[מק'ט])
      )
    `),
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySalesTrnz", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        'ALL_PARTS'[מחסן] = "Trnz",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 45),
        TREATAS(${mkSet}, 'ALL_PARTS'[מק'ט])
      )
    `),
    // 180-day eligibility check (all warehouses) — used only for reserve-slot filter, not displayed
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySales180", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 180),
        TREATAS(${mkSet}, 'ALL_PARTS'[מק'ט])
      )
    `),
  ]);

  const result = {};
  for (const mk of makatim) result[mk] = { stock: 0, daySales: null, daySalesAll: null, stockZafn: 0, stockTrnz: 0, daySalesZafn: null, daySalesTrnz: null, daySales180: null };

  for (const r of stockRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null, stockZafn: 0, stockTrnz: 0 };
    result[mk].stock = r['[stock]'] || 0;
  }
  for (const r of salesRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null, stockZafn: 0, stockTrnz: 0 };
    result[mk].daySales = r['[daySales]'] || null;
  }
  for (const r of salesAllRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null, stockZafn: 0, stockTrnz: 0 };
    result[mk].daySalesAll = r['[daySalesAll]'] || null;
  }
  for (const r of stockZafnRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null, stockZafn: 0, stockTrnz: 0 };
    result[mk].stockZafn = r['[stock]'] || 0;
  }
  for (const r of stockTrnzRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null, stockZafn: 0, stockTrnz: 0, daySalesZafn: null, daySalesTrnz: null };
    result[mk].stockTrnz = r['[stock]'] || 0;
  }
  for (const r of salesZafnRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null, stockZafn: 0, stockTrnz: 0, daySalesZafn: null, daySalesTrnz: null };
    result[mk].daySalesZafn = r['[daySalesZafn]'] || null;
  }
  for (const r of salesTrnzRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null, stockZafn: 0, stockTrnz: 0, daySalesZafn: null, daySalesTrnz: null };
    result[mk].daySalesTrnz = r['[daySalesTrnz]'] || null;
  }

  for (const r of sales90Rows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    if (!result[mk]) result[mk] = { stock: 0, daySales: null, daySalesAll: null, stockZafn: 0, stockTrnz: 0, daySalesZafn: null, daySalesTrnz: null, daySales180: null };
    result[mk].daySales180 = r['[daySales180]'] || null;
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
      "cartons",  SUM('מלאי-תוקף'[קרטון מלאי תוקף]),
      "daysLeft", MAX('מלאי-תוקף'[כמה ימים נשארו])
    )
    ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
  `);

  const result = {};
  for(const r of pakuaRows) {
    const mk = String(r['מלאי-תוקף[מק"ט]'] || '');
    if(!mk) continue;
    if(!result[mk]) result[mk] = [];
    const rawDate  = r['מלאי-תוקף[ת. תפוגת תוקף]'];
    const expDate  = rawDate ? new Date(rawDate) : null;
    const cartons  = r['[cartons]'] || 0;
    const daysLeft = r['[daysLeft]'] ?? null;
    const sellDays = r['[sellDays]'] ?? null;
    const sakana   = r['[sakana]'] === 1;
    if(cartons > 0) result[mk].push({ date: expDate, daysLeft, cartons, sellDays, sakana });
  }
  for(const mk of Object.keys(result)) result[mk].sort((a,b) => (a.date||0) - (b.date||0));
  console.log(`פק"ע fetched for ${Object.keys(result).length} חלבי/דגים products`);
  return result;
}

// ── Fetch product names from KARTIS PARIT[תאור] for any list of מקטים ────────
async function fetchNamesForMakats(makatim) {
  if (!makatim || !makatim.length) return {};
  const t = await getToken();
  const mkSet = '{' + makatim.map(m => `"${m}"`).join(',') + '}';
  const rows = await dax(t, `
    EVALUATE
    FILTER(
      SELECTCOLUMNS('KARTIS PARIT', "mk", 'KARTIS PARIT'[מק"ט], "name", 'KARTIS PARIT'[תאור]),
      CONTAINSROW(${mkSet}, [mk])
    )
  `);
  const result = {};
  for (const r of rows) {
    const mk   = String(r['[mk]'] || '');
    const name = r['[name]'];
    if (mk && name) result[mk] = name.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
  }
  console.log(`Names fetched for ${Object.keys(result).length}/${makatim.length} חלבי/דגים products`);
  return result;
}

// ── Fetch pakuotZafn (expiry batches at Zafn) for any list of מקטים ─────────
async function fetchPakuotZafnForMakats(makatim) {
  if(!makatim || !makatim.length) return {};
  const t = await getToken();
  const mkSet = '{' + makatim.map(m => `"${m}"`).join(',') + '}';
  const rows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      'מלאי-תוקף'[ת. תפוגת תוקף],
      FILTER(
        'מלאי-תוקף',
        'מלאי-תוקף'[מחסן] = "Zafn" &&
        CONTAINSROW(${mkSet}, 'מלאי-תוקף'[מק"ט])
      ),
      "cartons",  SUM('מלאי-תוקף'[קרטון מלאי תוקף]),
      "daysLeft", MAX('מלאי-תוקף'[כמה ימים נשארו])
    )
    ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
  `);

  const result = {};
  for(const r of rows) {
    const mk = String(r['מלאי-תוקף[מק"ט]'] || '');
    if(!mk) continue;
    if(!result[mk]) result[mk] = [];
    const rawDate  = r['מלאי-תוקף[ת. תפוגת תוקף]'];
    const expDate  = rawDate ? new Date(rawDate) : null;
    const cartons  = r['[cartons]'] || 0;
    const daysLeft = r['[daysLeft]'] ?? null;
    const sellDays = r['[sellDays]'] ?? null;
    const sakana   = r['[sakana]'] === 1;
    if(cartons > 0) result[mk].push({ date: expDate, daysLeft, cartons, sellDays, sakana });
  }
  for(const mk of Object.keys(result)) result[mk].sort((a,b) => (a.date||0) - (b.date||0));
  console.log(`פק"ע Zafn fetched for ${Object.keys(result).length} חלבי/דגים products`);
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
      "cartons",  SUM('מלאי-תוקף'[קרטון מלאי תוקף]),
      "daysLeft", MAX('מלאי-תוקף'[כמה ימים נשארו])
    )
    ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
  `);
  const result = {};
  for(const r of rows) {
    const mk = String(r['מלאי-תוקף[מק"ט]'] || '');
    if(!mk) continue;
    if(!result[mk]) result[mk] = [];
    const rawDate  = r['מלאי-תוקף[ת. תפוגת תוקף]'];
    const expDate  = rawDate ? new Date(rawDate) : null;
    const cartons  = r['[cartons]'] || 0;
    const daysLeft = r['[daysLeft]'] ?? null;
    const sellDays = r['[sellDays]'] ?? null;
    const sakana   = r['[sakana]'] === 1;
    if(cartons > 0) result[mk].push({ date: expDate, daysLeft, cartons, sellDays, sakana });
  }
  for(const mk of Object.keys(result)) result[mk].sort((a,b) => (a.date||0) - (b.date||0));
  return result;
}

// ── חלבי family codes — KARTIS PARIT[משפחת מוצר] column
// Source: משפחת מוצר לפי מחסן.xlsx col "משפחת מוצר N" (section = "חלבי")
// ── Fetch all active חלבי products from KARTIS PARIT + live stock/sales/pakuot ──
async function fetchHalaviFromBI() {
  const t = await getToken();

  const kpRows = await dax(t, `
    EVALUATE
    SELECTCOLUMNS(
      FILTER('KARTIS PARIT',
        'KARTIS PARIT'[סטטוס] = "פעיל" &&
        'KARTIS PARIT'[שם מחסן אשדוד] = "חלבי 🥛"
      ),
      "makat",     'KARTIS PARIT'[מק"ט],
      "name",      'KARTIS PARIT'[תאור],
      "fam",       'KARTIS PARIT'[תאור משפחה],
      "weight",    'KARTIS PARIT'[משקל ליחידה],
      "shelfLife", 'KARTIS PARIT'[חיי מדף]
    )
  `);

  const result = {};
  const makatim = [];
  for (const r of kpRows) {
    const mk = String(r['[makat]'] || '');
    if (!mk) continue;
    const raw = r['[name]'] || '';
    result[mk] = {
      makat:     mk,
      desc:      raw.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim() || null,
      fam:       r['[fam]'] || null,
      weight:    r['[weight]'] ?? null,
      shelfLife: r['[shelfLife]'] ?? null,
      dayAvg:    null, ss: null,
      stock: 0, daySales: null, daySalesAll: null,
      stockZafn: 0, daySalesZafn: null,
      stockTrnz: 0, daySalesTrnz: null,
      pakuot: [], pakuotZafn: [], pakuotAll: [],
    };
    makatim.push(mk);
  }

  if (!makatim.length) {
    console.warn('fetchHalaviFromBI: no products found — check HALAVI_FAM_NAMES vs KARTIS PARIT[תאור משפחה]');
    return result;
  }

  const [stockMap, pakuotMap, pakuotZafnMap, pakuotAllMap] = await Promise.all([
    fetchStockMain(makatim),
    fetchPakuotForMakats(makatim),
    fetchPakuotZafnForMakats(makatim),
    fetchPakuotAllForMakats(makatim),
  ]);

  for (const mk of makatim) {
    const fm = stockMap[mk] || {};
    Object.assign(result[mk], {
      stock:        fm.stock        ?? 0,
      daySales:     fm.daySales     ?? null,
      daySalesAll:  fm.daySalesAll  ?? null,
      daySales180:   fm.daySales180   ?? null,
      stockZafn:    fm.stockZafn    ?? 0,
      daySalesZafn: fm.daySalesZafn ?? null,
      stockTrnz:    fm.stockTrnz    ?? 0,
      daySalesTrnz: fm.daySalesTrnz ?? null,
      pakuot:       pakuotMap[mk]     || [],
      pakuotZafn:   pakuotZafnMap[mk] || [],
      pakuotAll:    pakuotAllMap[mk]  || [],
    });
    result[mk].dayAvg = result[mk].daySales;
  }

  console.log(`fetchHalaviFromBI: ${makatim.length} active חלבי products from KARTIS PARIT`);
  return result;
}

// ── Fetch all active דגים (wet fish) products from KARTIS PARIT + live stock/sales/pakuot ──
async function fetchDagimFromBI() {
  const t = await getToken();

  const kpRows = await dax(t, `
    EVALUATE
    SELECTCOLUMNS(
      FILTER('KARTIS PARIT',
        'KARTIS PARIT'[סטטוס] = "פעיל" &&
        'KARTIS PARIT'[שם מחסן אשדוד] = "דגים 🐟"
      ),
      "makat",    'KARTIS PARIT'[מק"ט],
      "name",     'KARTIS PARIT'[תאור],
      "fam",      'KARTIS PARIT'[תאור משפחה],
      "weight",   'KARTIS PARIT'[משקל ליחידה],
      "shelfLife",'KARTIS PARIT'[חיי מדף]
    )
  `);

  const result = {};
  const makatim = [];
  for (const r of kpRows) {
    const mk = String(r['[makat]'] || '');
    if (!mk) continue;
    const raw = r['[name]'] || '';
    result[mk] = {
      makat:     mk,
      desc:      raw.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim() || null,
      fam:       r['[fam]'] || null,
      weight:    r['[weight]'] ?? null,
      shelfLife: r['[shelfLife]'] ?? null,
      dayAvg:    null, ss: null,
      stock: 0, daySales: null, daySalesAll: null,
      stockZafn: 0, daySalesZafn: null,
      stockTrnz: 0, daySalesTrnz: null,
      pakuot: [], pakuotZafn: [], pakuotAll: [],
    };
    makatim.push(mk);
  }

  if (!makatim.length) {
    console.warn('fetchDagimFromBI: no products found — check שם מחסן אשדוד = "דגים" in KARTIS PARIT');
    return result;
  }

  const [stockMap, pakuotMap, pakuotZafnMap, pakuotAllMap] = await Promise.all([
    fetchStockMain(makatim),
    fetchPakuotForMakats(makatim),
    fetchPakuotZafnForMakats(makatim),
    fetchPakuotAllForMakats(makatim),
  ]);

  for (const mk of makatim) {
    const fm = stockMap[mk] || {};
    Object.assign(result[mk], {
      stock:        fm.stock        ?? 0,
      daySales:     fm.daySales     ?? null,
      daySalesAll:  fm.daySalesAll  ?? null,
      daySales180:   fm.daySales180   ?? null,
      stockZafn:    fm.stockZafn    ?? 0,
      daySalesZafn: fm.daySalesZafn ?? null,
      stockTrnz:    fm.stockTrnz    ?? 0,
      daySalesTrnz: fm.daySalesTrnz ?? null,
      pakuot:       pakuotMap[mk]     || [],
      pakuotZafn:   pakuotZafnMap[mk] || [],
      pakuotAll:    pakuotAllMap[mk]  || [],
    });
    result[mk].dayAvg = result[mk].daySales;
  }

  console.log(`fetchDagimFromBI: ${makatim.length} active דגים products from KARTIS PARIT`);
  return result;
}

// ── Fetch חיי מדף (required shelf life) per product from KARTIS PARIT ──
async function fetchShelfLifeForMakats(makatim) {
  if (!makatim || !makatim.length) return {};
  const t = await getToken();
  const mkSet = '{' + makatim.map(m => `"${m}"`).join(',') + '}';
  const rows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'KARTIS PARIT'[מק"ט],
      FILTER('KARTIS PARIT',
        CONTAINSROW(${mkSet}, 'KARTIS PARIT'[מק"ט]) &&
        'KARTIS PARIT'[סטטוס] = "פעיל"
      ),
      "shelfLife", MAX('KARTIS PARIT'[חיי מדף])
    )
  `);
  const result = {};
  for (const r of rows) {
    const mk = String(r['KARTIS PARIT[מק"ט]'] || '');
    if (!mk) continue;
    result[mk] = r['[shelfLife]'] ?? null;
  }
  return result;
}

async function fetchPhotoUrls() {
  const t = await getToken();
  const rows = await dax(t, `
    EVALUATE
    FILTER(
      SUMMARIZECOLUMNS(
        'KARTIS PARIT'[מק"ט],
        'KARTIS PARIT'[URL תמונה],
        FILTER('KARTIS PARIT', 'KARTIS PARIT'[סטטוס] = "פעיל")
      ),
      NOT ISBLANK('KARTIS PARIT'[URL תמונה]) && 'KARTIS PARIT'[URL תמונה] <> ""
    )
  `);
  const result = {};
  for (const r of rows) {
    const mk  = String(r['KARTIS PARIT[מק"ט]'] || '').trim();
    const url = String(r['KARTIS PARIT[URL תמונה]'] || '').trim();
    if (mk && url) result[mk] = url;
  }
  console.log(`Photo URLs fetched: ${Object.keys(result).length}`);
  return result;
}

module.exports = { fetchKapuaFromBI, fetchLastRefresh, fetchStockMain, fetchNamesForMakats, fetchPakuotForMakats, fetchPakuotZafnForMakats, fetchPakuotAllForMakats, fetchShelfLifeForMakats, fetchHalaviFromBI, fetchDagimFromBI, fetchPhotoUrls, getToken };
