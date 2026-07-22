/**
 * Fetch דג יבש (dry/smoked fish) live data from Power BI / Fabric (replaces dagim-yavesh.xlsx)
 * Returns: Map<makat, { desc, stock, daySales, pakuot, daySalesAll, pakuotAll, fam, nameEn }>
 *
 * Families (source: "משפחת מוצר לפי מחסן.xlsx", sheet דג יבש):
 *   דגים KAZAHSTAN  → anchor makat 717
 *   דגים RUSSIA     → anchor makat 237
 *   דגים פודסטוק    → anchor makat 1098
 *   דגים RUSSIAN SEA → anchor makat 1147
 *
 * Anchor-makat approach: family codes discovered at runtime from MLAY —
 * no hardcoded BI numeric codes; new products auto-discovered when added.
 * Only products with סטטוס="פעיל" in KARTIS PARIT are included.
 */

const TENANT    = process.env.PBI_TENANT;
const CLIENT    = process.env.PBI_CLIENT;
const SECRET    = process.env.PBI_SECRET;
const DATASET   = process.env.PBI_DATASET;
const WORKSPACE = process.env.PBI_WORKSPACE;

// One known makat per dry-fish family — used to discover family codes at runtime via MLAY
const DAGIM_YAVESH_ANCHORS = ['717', '237', '1098', '1147'];

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

async function fetchDagimYaveshFromBI(knownMakatim = []) {
  const t = await getToken();

  // famMakatim: use explicit MK list from dagim-yavesh-base.json when provided.
  // The KARTIS PARIT שם מחסן אשדוד filter was unreliable in CI (column empty → 0 rows → stock=0).
  const famMakatim = knownMakatim.length
    ? `{${knownMakatim.map(mk => `"${mk}"`).join(',')}}`
    : `SELECTCOLUMNS(
        FILTER('KARTIS PARIT',
          'KARTIS PARIT'[סטטוס] = "פעיל" &&
          'KARTIS PARIT'[שם מחסן אשדוד] = "דג יבש 🐠"
        ),
        "mk", 'KARTIS PARIT'[מק"ט]
      )`;

  const [stockRows, salesRows, descRows, mlayDescRows, pakuaRows, salesAllRows, pakuaAllRows, nameEnRows,
         stockZafnRows, salesZafnRows, pakuaZafnRows, sales365Rows] = await Promise.all([

    // 1. Stock at Main (Ashdod)
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        SUMMARIZECOLUMNS(
          'מלאי-תוקף'[מק"ט],
          "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
        ),
        'מלאי-תוקף'[מחסן] = "Main",
        TREATAS(${famMakatim}, 'מלאי-תוקף'[מק"ט])
      )
    `),

    // 2. Sales Main only — planogram display
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
      CALCULATETABLE(
        SUMMARIZECOLUMNS(
          'מלאי-תוקף'[מק"ט],
          'מלאי-תוקף'[תאור מוצר]
        ),
        'מלאי-תוקף'[מחסן] = "Main",
        TREATAS(${famMakatim}, 'מלאי-תוקף'[מק"ט])
      )
    `),

    // 4. Desc + family code fallback from MLAY master catalog
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        SUMMARIZECOLUMNS(
          MLAY[מק'ט],
          MLAY[תאור מוצר],
          MLAY[משפחת מוצר]
        ),
        TREATAS(${famMakatim}, MLAY[מק'ט])
      )
    `),

    // 5. פק"ע batches at Main — planogram display
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        SUMMARIZECOLUMNS(
          'מלאי-תוקף'[מק"ט],
          'מלאי-תוקף'[ת. תפוגת תוקף],
          "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
        ),
        'מלאי-תוקף'[מחסן] = "Main",
        TREATAS(${famMakatim}, 'מלאי-תוקף'[מק"ט])
      )
      ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
    `),

    // 6. Sales ALL warehouses — for סכנה calculation
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

    // 7. פק"ע ALL warehouses — for סכנה calculation
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        SUMMARIZECOLUMNS(
          'מלאי-תוקף'[מק"ט],
          'מלאי-תוקף'[ת. תפוגת תוקף],
          "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
        ),
        TREATAS(${famMakatim}, 'מלאי-תוקף'[מק"ט])
      )
      ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
    `),

    // 8. Product names from KARTIS PARIT
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'KARTIS PARIT'[מק"ט],
        'KARTIS PARIT'[תאור לועזי],
        'KARTIS PARIT'[תאור],
        'KARTIS PARIT'[חיי מדף],
        FILTER('KARTIS PARIT', 'KARTIS PARIT'[סטטוס] = "פעיל")
      )
    `),

    // 9. Stock at Zafn (North)
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        SUMMARIZECOLUMNS(
          'מלאי-תוקף'[מק"ט],
          "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
        ),
        'מלאי-תוקף'[מחסן] = "Zafn",
        TREATAS(${famMakatim}, 'מלאי-תוקף'[מק"ט])
      )
    `),

    // 10. Sales Zafn only
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

    // 11. פק"ע batches at Zafn
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        SUMMARIZECOLUMNS(
          'מלאי-תוקף'[מק"ט],
          'מלאי-תוקף'[ת. תפוגת תוקף],
          "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
        ),
        'מלאי-תוקף'[מחסן] = "Zafn",
        TREATAS(${famMakatim}, 'מלאי-תוקף'[מק"ט])
      )
      ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
    `),

    // 12. 365-day eligibility — all warehouses, used for reserve-slot filter
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySales365", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 365),
        TREATAS(${famMakatim}, 'ALL_PARTS'[מק'ט])
      )
    `),
  ]);

  const result = {};
  function ensure(mk) {
    if (!result[mk]) result[mk] = { desc: null, stock: 0, daySales: null, daySales365: null, pakuot: [], daySalesAll: null, pakuotAll: [], fam: null, nameEn: null, shelfLife: null, stockZafn: 0, daySalesZafn: null, pakuotZafn: [] };
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

  for (const r of mlayDescRows) {
    const mk = r["MLAY[מק'ט]"];
    if (!mk) continue;
    ensure(mk);
    if (!result[mk].desc) result[mk].desc = r["MLAY[תאור מוצר]"] || null;
    if (!result[mk].fam)  result[mk].fam  = r["MLAY[משפחת מוצר]"] || null;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  for (const r of pakuaRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
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

  for (const r of salesAllRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    ensure(mk);
    result[mk].daySalesAll = r['[daySalesAll]'] || null;
  }

  for (const r of pakuaAllRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
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

  for (const r of stockZafnRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    if (!mk) continue;
    ensure(mk);
    result[mk].stockZafn = r['[stock]'] || 0;
  }

  for (const r of salesZafnRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    ensure(mk);
    result[mk].daySalesZafn = r['[daySalesZafn]'] || null;
  }

  for (const r of pakuaZafnRows) {
    const mk = r['מלאי-תוקף[מק"ט]'];
    const cartons = r['[cartons]'] || 0;
    if (!mk || cartons <= 0) continue;
    ensure(mk);
    const rawDate = r["מלאי-תוקף[ת. תפוגת תוקף]"];
    let expDate = null, daysLeft = null;
    if (rawDate) { expDate = new Date(rawDate); daysLeft = Math.round((expDate - today) / 86400000); }
    result[mk].pakuotZafn.push({ date: expDate, daysLeft, cartons });
  }
  for (const mk of Object.keys(result)) {
    if (result[mk].pakuotZafn.length > 1) result[mk].pakuotZafn.sort((a, b) => (a.date||0) - (b.date||0));
  }

  const nameEnMap = {};
  for (const r of nameEnRows) {
    const mk  = r['KARTIS PARIT[מק"ט]'];
    const lou = r['KARTIS PARIT[תאור לועזי]'];
    const heb = r['KARTIS PARIT[תאור]'];
    if (!mk) continue;
    const name = (lou && lou.trim()) || (heb && heb.trim()) || null;
    nameEnMap[String(mk)] = name;
    if (result[mk]) {
      result[mk].nameEn    = name;
      result[mk].shelfLife = r['KARTIS PARIT[חיי מדף]'] ?? null;
    }
  }

  for (const r of sales365Rows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (!mk) continue;
    ensure(mk);
    result[mk].daySales365 = r['[daySales365]'] || null;
  }

  const total     = Object.keys(result).length;
  const withStock = Object.keys(result).filter(m => result[m].stock > 0).length;
  const withSales = Object.keys(result).filter(m => result[m].daySales != null).length;
  console.log(`Power BI דג יבש: ${total} total | ${withStock} with stock | ${withSales} with sales`);
  return { dagimYaveshData: result, nameEnMap };
}

module.exports = { fetchDagimYaveshFromBI };
