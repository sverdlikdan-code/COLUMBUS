/**
 * Fetch ׳§׳₪׳•׳ live data from Power BI / Fabric (replaces ׳§׳₪׳•׳.xlsx)
 * Returns: Map<makat, { desc, stock, daySales }>
 *
 * stock    = cartons at ׳׳©׳“׳•׳“ (׳׳—׳¡׳ Main), 0 if not found
 * daySales = [TOTAL ׳׳›׳¨ ׳‘׳§׳¨׳˜׳•׳ ׳™׳ ׳׳׳•׳¦׳¢ ׳‘׳™׳•׳] official BI measure, last 90d, Main only
 * desc     = product name from ׳׳׳׳™-׳×׳•׳§׳£ (visual RTL ג€” fixVisualRTL applied in build script)
 *
 * Family filter (MLAY[׳׳©׳₪׳—׳× ׳׳•׳¦׳¨] codes) ג€” new products in these families auto-discovered:
 *   029=׳—׳׳׳” FERMA  004=׳—׳׳׳” ׳¨׳•׳©׳  022=׳׳׳¨׳—׳™ ׳—׳׳׳”  019=׳›׳™׳¡׳•׳ ׳™׳/׳¡׳™׳¨׳ ׳™׳§׳™
 *   035=SANTA BREMOR ׳¡׳׳׳•׳/׳₪׳•׳¨׳
 *   421=׳¢׳•׳’׳•׳× ׳¨׳•׳©׳  420=׳¢׳•׳’׳•׳× ׳׳•׳–׳™׳§׳”  046=׳—׳˜׳™׳£ ׳’׳‘׳™׳ ׳”
 *   0191=׳׳•׳¡׳“׳™  0190=Valesto ׳׳׳₪׳”
 *
 * NOTE: family 030 (SANTA BREMOR ׳“׳’׳™׳) is excluded ג€” it contains chilled (׳׳¦׳•׳ ׳) products
 * not relevant to the frozen planogram. Products 1045/1046/1051 (surimi/frozen) are
 * passed via the explicit makatim list and fetched through UNION with famMakatim.
 */

const TENANT    = process.env.PBI_TENANT;
const CLIENT    = process.env.PBI_CLIENT;
const SECRET    = process.env.PBI_SECRET;
const DATASET   = process.env.PBI_DATASET;
const WORKSPACE = process.env.PBI_WORKSPACE;

// Family codes from MLAY[׳׳©׳₪׳—׳× ׳׳•׳¦׳¨] covering frozen ׳§׳₪׳•׳ sections
// 030 (SANTA BREMOR ׳“׳’׳™׳) excluded ג€” those are chilled (׳׳¦׳•׳ ׳), not frozen
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
        FILTER(MLAY, CONTAINSROW({${famCodes}}, MLAY[׳׳©׳₪׳—׳× ׳׳•׳¦׳¨])),
        "mk", MLAY[׳׳§'׳˜]
      ),
      SELECTCOLUMNS({${explicitMks}}, "mk", [Value])
    )`;

  // ג”€ג”€ 1. Stock: products of our families at Main (Ashdod) ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
  const stockRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      '׳׳׳׳™-׳×׳•׳§׳£'[׳׳§"׳˜],
      FILTER(
        '׳׳׳׳™-׳×׳•׳§׳£',
        '׳׳׳׳™-׳×׳•׳§׳£'[׳׳—׳¡׳] = "Main" &&
        CONTAINSROW(${famMakatim}, '׳׳׳׳™-׳×׳•׳§׳£'[׳׳§"׳˜])
      ),
      "stock", SUM('׳׳׳׳™-׳×׳•׳§׳£'[׳§׳¨׳˜׳•׳ ׳׳׳׳™ ׳×׳•׳§׳£])
    )
  `);

  // ג”€ג”€ 2. Sales: [TOTAL ׳׳›׳¨ ׳‘׳§׳¨׳˜׳•׳ ׳™׳ ׳׳׳•׳¦׳¢ ׳‘׳™׳•׳], FORMULA+Main, last 90d, our families
  const salesRows = await dax(t, `
    EVALUATE
    CALCULATETABLE(
      ADDCOLUMNS(
        SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[׳׳§'׳˜]),
        "daySales", [TOTAL ׳׳›׳¨ ׳‘׳§׳¨׳˜׳•׳ ׳™׳ ׳׳׳•׳¦׳¢ ׳‘׳™׳•׳]
      ),
      'ALL_PARTS'[׳—׳‘׳¨׳”] = "FORMULA",
      'ALL_PARTS'[׳׳—׳¡׳] = "Main",
      FILTER('ALL_PARTS', 'ALL_PARTS'[׳×׳׳¨׳™׳] >= TODAY() - 90),
      TREATAS(${famMakatim}, 'ALL_PARTS'[׳׳§'׳˜])
    )
  `);

  // ג”€ג”€ 3. Desc: product name per ׳׳§׳˜ from ׳׳׳׳™-׳×׳•׳§׳£ Main ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
  const descRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      '׳׳׳׳™-׳×׳•׳§׳£'[׳׳§"׳˜],
      '׳׳׳׳™-׳×׳•׳§׳£'[׳×׳׳•׳¨ ׳׳•׳¦׳¨],
      FILTER(
        '׳׳׳׳™-׳×׳•׳§׳£',
        '׳׳׳׳™-׳×׳•׳§׳£'[׳׳—׳¡׳] = "Main" &&
        CONTAINSROW(${famMakatim}, '׳׳׳׳™-׳×׳•׳§׳£'[׳׳§"׳˜])
      )
    )
  `);

  // ג”€ג”€ 4. Desc fallback from MLAY master catalog (for products absent from ׳׳׳׳™-׳×׳•׳§׳£ Main) ג”€ג”€
  const mlayDescRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      MLAY[׳׳§'׳˜],
      MLAY[׳×׳׳•׳¨ ׳׳•׳¦׳¨],
      FILTER(MLAY, CONTAINSROW(${famMakatim}, MLAY[׳׳§'׳˜]))
    )
  `);

  // ג”€ג”€ 5. ׳₪׳§"׳¢ per ׳׳§׳˜ at Main: expiry date + cartons per batch ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
  const pakuaRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      '׳׳׳׳™-׳×׳•׳§׳£'[׳׳§"׳˜],
      '׳׳׳׳™-׳×׳•׳§׳£'[׳×. ׳×׳₪׳•׳’׳× ׳×׳•׳§׳£],
      FILTER(
        '׳׳׳׳™-׳×׳•׳§׳£',
        '׳׳׳׳™-׳×׳•׳§׳£'[׳׳—׳¡׳] = "Main" &&
        CONTAINSROW(${famMakatim}, '׳׳׳׳™-׳×׳•׳§׳£'[׳׳§"׳˜])
      ),
      "cartons", SUM('׳׳׳׳™-׳×׳•׳§׳£'[׳§׳¨׳˜׳•׳ ׳׳׳׳™ ׳×׳•׳§׳£])
    )
    ORDER BY '׳׳׳׳™-׳×׳•׳§׳£'[׳׳§"׳˜], '׳׳׳׳™-׳×׳•׳§׳£'[׳×. ׳×׳₪׳•׳’׳× ׳×׳•׳§׳£]
  `);

  // ג”€ג”€ Build result map ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
  const result = {};
  for (const mk of makatim) result[mk] = { desc: null, stock: 0, daySales: null, pakuot: [] };

  for (const r of stockRows) {
    const mk = r['׳׳׳׳™-׳×׳•׳§׳£[׳׳§"׳˜]'];
    if (mk && result[mk] !== undefined) result[mk].stock = r['[stock]'] || 0;
  }

  for (const r of salesRows) {
    const mk = r["ALL_PARTS[׳׳§'׳˜]"];
    if (mk && result[mk] !== undefined) result[mk].daySales = r['[daySales]'] || null;
  }

  const descSeen = new Set();
  for (const r of descRows) {
    const mk = r['׳׳׳׳™-׳×׳•׳§׳£[׳׳§"׳˜]'];
    if (mk && result[mk] !== undefined && !descSeen.has(mk)) {
      result[mk].desc = r['׳׳׳׳™-׳×׳•׳§׳£[׳×׳׳•׳¨ ׳׳•׳¦׳¨]'] || null;
      descSeen.add(mk);
    }
  }
  // Fallback: products with 0 stock at Main won't be in ׳׳׳׳™-׳×׳•׳§׳£ ג†’ use MLAY catalog
  for (const r of mlayDescRows) {
    const mk = r["MLAY[׳׳§'׳˜]"];
    if (mk && result[mk] !== undefined && !result[mk].desc) {
      result[mk].desc = r["MLAY[׳×׳׳•׳¨ ׳׳•׳¦׳¨]"] || null;
    }
  }

  // Parse pakuaRows into per-׳׳§׳˜ array, sorted by expiry date
  const today = new Date(); today.setHours(0,0,0,0);
  for (const r of pakuaRows) {
    const mk      = r['׳׳׳׳™-׳×׳•׳§׳£[׳׳§"׳˜]'];
    const cartons = r['[cartons]'] || 0;
    if (!mk || cartons <= 0) continue;
    if (result[mk] === undefined) continue;
    const rawDate = r["׳׳׳׳™-׳×׳•׳§׳£[׳×. ׳×׳₪׳•׳’׳× ׳×׳•׳§׳£]"];
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
    ...stockRows.map(r => r['׳׳׳׳™-׳×׳•׳§׳£[׳׳§"׳˜]']),
    ...salesRows.map(r => r["ALL_PARTS[׳׳§'׳˜]"]),
  ].filter(Boolean));
  const newMks = [...allFamMks].filter(mk => result[mk] === undefined);
  if (newMks.length) console.log(`ג  New makatim in families (not in KAPUA_PICKS): ${newMks.join(', ')}`);

  const noStk    = makatim.filter(m => result[m].stock === 0).length;
  const withSales = makatim.filter(m => result[m].daySales != null).length;
  console.log(`Power BI ׳§׳₪׳•׳: ${allFamMks.size} in families | ${noStk} zero-stock in picks | ${withSales} picks with sales`);
  return result;
}

// ג”€ג”€ Last dataset refresh time (from Power BI refresh history API) ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
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

