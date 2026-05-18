/**
 * Fetch חלבי live data from Power BI / Fabric (replaces חלבי.xlsx)
 * Returns: Map<makat, { desc, stock, daySales, pakuot, daySalesAll, pakuotAll, fam, nameEn }>
 *
 * Families (source: "משפחת מוצר לפי מחסן.xlsx", sheet חלבי):
 *   גבינה SVALIA             → anchor makat 660
 *   גבינה פרוסות SVALIA      → anchor makat 670
 *   גבינות PRESIDENT         → anchor makat 411001
 *   דייסה/יוגורט/שמנת SVALIA → anchor makat 630
 *   טבורוג/קוטג'/גבינה למריחה SVALIA → anchor makat 646
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

// One known makat per halavi family — used to discover family codes at runtime via MLAY
const HALAVI_ANCHORS = ['660', '670', '411001', '630', '646'];

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

async function fetchHalaviFromBI() {
  const t = await getToken();

  const anchorSet = HALAVI_ANCHORS.map(m => `"${m}"`).join(',');

  // Anchor-makat: all makatim in the same MLAY families as our anchors, filtered to פעיל only.
  // The nested SELECTCOLUMNS discovers the numeric family codes from MLAY at runtime.
  const famMakatim = `
    INTERSECT(
      SELECTCOLUMNS(
        FILTER(MLAY,
          CONTAINSROW(
            SELECTCOLUMNS(
              FILTER(MLAY, CONTAINSROW({${anchorSet}}, MLAY[מק'ט])),
              "fc", MLAY[משפחת מוצר]
            ),
            MLAY[משפחת מוצר]
          )
        ),
        "mk", MLAY[מק'ט]
      ),
      CALCULATETABLE(VALUES('KARTIS PARIT'[מק"ט]), 'KARTIS PARIT'[סטטוס]="פעיל")
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
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        'מלאי-תוקף'[תאור מוצר],
        FILTER('מלאי-תוקף',
          'מלאי-תוקף'[מחסן] = "Main" &&
          CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])
        )
      )
    `),

    // 4. Desc + family code fallback from MLAY master catalog
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        MLAY[מק'ט],
        MLAY[תאור מוצר],
        MLAY[משפחת מוצר],
        FILTER(MLAY, CONTAINSROW(${famMakatim}, MLAY[מק'ט]))
      )
    `),

    // 5. פק"ע batches at Main — planogram display
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
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        'מלאי-תוקף'[ת. תפוגת תוקף],
        FILTER('מלאי-תוקף', CONTAINSROW(${famMakatim}, 'מלאי-תוקף'[מק"ט])),
        "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
      )
      ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
    `),

    // 8. Product names from KARTIS PARIT — לועזי first, fallback to שם מוצר
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        'KARTIS PARIT'[מק"ט],
        'KARTIS PARIT'[שם מוצר לועזי],
        'KARTIS PARIT'[שם מוצר],
        FILTER('KARTIS PARIT', 'KARTIS PARIT'[סטטוס] = "פעיל")
      )
    `),
  ]);

  const result = {};
  function ensure(mk) {
    if (!result[mk]) result[mk] = { desc: null, stock: 0, daySales: null, pakuot: [], daySalesAll: null, pakuotAll: [], fam: null, nameEn: null };
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

  const nameEnMap = {};
  for (const r of nameEnRows) {
    const mk  = r['KARTIS PARIT[מק"ט]'];
    const lou = r['KARTIS PARIT[שם מוצר לועזי]'];
    const heb = r['KARTIS PARIT[שם מוצר]'];
    if (!mk) continue;
    const name = (lou && lou.trim()) || (heb && heb.trim()) || null;
    nameEnMap[String(mk)] = name;
    if (result[mk]) result[mk].nameEn = name;
  }

  const total     = Object.keys(result).length;
  const withStock = Object.keys(result).filter(m => result[m].stock > 0).length;
  const withSales = Object.keys(result).filter(m => result[m].daySales != null).length;
  console.log(`Power BI חלבי: ${total} total | ${withStock} with stock | ${withSales} with sales`);
  return { halaviData: result, nameEnMap };
}

module.exports = { fetchHalaviFromBI };
