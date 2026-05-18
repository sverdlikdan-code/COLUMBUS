/**
 * Extra BI data for planogram: Trn + Zafn sheets
 *
 * fetchTrnStock()   → [ { makat, desc, stock } ] — products at Trn (transit, blocked)
 * fetchZafnDanger() → [ { makat, desc, stock, daySales, days } ] — Zafn items with days < 3
 */

const TENANT    = process.env.PBI_TENANT;
const CLIENT    = process.env.PBI_CLIENT;
const SECRET    = process.env.PBI_SECRET;
const DATASET   = process.env.PBI_DATASET;
const WORKSPACE = process.env.PBI_WORKSPACE;

async function getToken() {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({ grant_type:'client_credentials', client_id:CLIENT,
        client_secret:SECRET, scope:'https://analysis.windows.net/powerbi/api/.default' }) }
  );
  const j = await res.json();
  if(!j.access_token) throw new Error('PBI token failed: ' + JSON.stringify(j));
  return j.access_token;
}

async function dax(token, query) {
  const res = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE}/datasets/${DATASET}/executeQueries`,
    { method:'POST',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body: JSON.stringify({ queries:[{query}], serializerSettings:{includeNulls:true} }) }
  );
  const j = await res.json();
  if(j.error) throw new Error('DAX error: ' + JSON.stringify(j.error));
  return j.results?.[0]?.tables?.[0]?.rows || [];
}

function fixVisualRTL(s) {
  if(!s) return '';
  const full = s.split('').reverse().join('');
  return full.replace(/[\x20-\x7E]+/g, m => m.split('').reverse().join(''));
}

// ── Trn warehouse: ALL products (sorted by stock desc) ───────────────────────
async function fetchTrnStock(token) {
  const rows = await dax(token, `
    EVALUATE
    ADDCOLUMNS(
      SUMMARIZECOLUMNS(
        'מלאי-תוקף'[מק"ט],
        'מלאי-תוקף'[תאור מוצר],
        FILTER('מלאי-תוקף', 'מלאי-תוקף'[מחסן] = "Trn"),
        "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
      ),
      "fam", LOOKUPVALUE(MLAY[משפחת מוצר], MLAY[מק'ט], 'מלאי-תוקף'[מק"ט])
    )
    ORDER BY [stock] DESC
  `);

  return rows
    .filter(r => (r['[stock]'] || 0) > 0)
    .map(r => ({
      makat   : r['מלאי-תוקף[מק"ט]'],
      desc    : fixVisualRTL(r['מלאי-תוקף[תאור מוצר]'] || ''),
      fam     : r['[fam]'] || '',
      stock   : r['[stock]'] || 0,
    }));
}

// ── Zafn warehouse: all FORMULA products with days-remaining < 3 ─────────────
// days = stockZafn / daySalesZafn   (using official BI measure for Zafn)
async function fetchZafnDanger(token) {
  // Stock at Zafn — ALL products (not family-filtered, user wants everything dangerous)
  const stockRows = await dax(token, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      'מלאי-תוקף'[תאור מוצר],
      FILTER('מלאי-תוקף', 'מלאי-תוקף'[מחסן] = "Zafn"),
      "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
    )
  `);

  // daySales at Zafn using official BI measure (FORMULA, Zafn, last 90d)
  const salesRows = await dax(token, `
    EVALUATE
    CALCULATETABLE(
      ADDCOLUMNS(
        SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
        "daySales", [TOTAL מכר בקרטונים ממוצע ביום]
      ),
      'ALL_PARTS'[חברה] = "FORMULA",
      'ALL_PARTS'[מחסן] = "Zafn",
      FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 45)
    )
  `);

  // Build map
  const salesMap = {};
  for(const r of salesRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if(mk) salesMap[mk] = r['[daySales]'] || null;
  }

  // Per-פק"ע data at Zafn (expiry date + cartons per batch)
  const pakuaRows = await dax(token, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'מלאי-תוקף'[מק"ט],
      'מלאי-תוקף'[ת. תפוגת תוקף],
      FILTER('מלאי-תוקף', 'מלאי-תוקף'[מחסן] = "Zafn"),
      "cartons", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
    )
    ORDER BY 'מלאי-תוקף'[מק"ט], 'מלאי-תוקף'[ת. תפוגת תוקף]
  `);

  // Build pakuot map: mk → [{date, daysLeft, cartons}]
  const today = new Date(); today.setHours(0,0,0,0);
  const pakuotMap = {};
  for(const r of pakuaRows) {
    const mk      = r['מלאי-תוקף[מק"ט]'];
    const cartons = r['[cartons]'] || 0;
    if(!mk || cartons <= 0) continue;
    const rawDate = r["מלאי-תוקף[ת. תפוגת תוקף]"];
    let expDate = null, daysLeft = null;
    if(rawDate) { expDate = new Date(rawDate); daysLeft = Math.round((expDate - today) / 86400000); }
    if(!pakuotMap[mk]) pakuotMap[mk] = [];
    pakuotMap[mk].push({ date: expDate, daysLeft, cartons });
  }

  // Build result: items with < 3 days cover, plus all items with per-פק"ע danger
  const result = [];
  const dangerMks = new Set();  // makatim already added (< 3 days)

  for(const r of stockRows) {
    const mk       = r['מלאי-תוקף[מק"ט]'];
    const stock    = r['[stock]'] || 0;
    if(stock <= 0) continue;
    const daySales = salesMap[mk] || null;
    const days     = daySales && daySales > 0 ? stock / daySales : null;
    if(days !== null && days < 3) {
      dangerMks.add(mk);
      result.push({
        makat   : mk,
        desc    : fixVisualRTL(r['מלאי-תוקף[תאור מוצר]'] || ''),
        stock, daySales, days,
        pakuot  : pakuotMap[mk] || [],
      });
    }
  }

  // סכנת השמדה Zafn: batches that expire before being sold
  const zafnSakana = [];
  for(const r of stockRows) {
    const mk       = r['מלאי-תוקף[מק"ט]'];
    const stock    = r['[stock]'] || 0;
    if(stock <= 0) continue;
    const daySales = salesMap[mk] || null;
    const paks     = pakuotMap[mk] || [];
    const dangerPaks = paks.filter(pak => {
      if(pak.daysLeft == null || pak.cartons <= 0) return false;
      const sellDays = (daySales && daySales > 0) ? pak.cartons / daySales : Infinity;
      return pak.daysLeft < sellDays;
    });
    if(dangerPaks.length > 0) {
      zafnSakana.push({
        makat   : mk,
        desc    : fixVisualRTL(r['מלאי-תוקף[תאור מוצר]'] || ''),
        stock, daySales,
        pakuot  : dangerPaks,
        minDaysLeft: Math.min(...dangerPaks.map(p => p.daysLeft != null ? p.daysLeft : 9999)),
      });
    }
  }
  zafnSakana.sort((a,b) => a.minDaysLeft - b.minDaysLeft);

  // Sort < 3 days result by days ascending
  result.sort((a, b) => a.days - b.days);
  return { under3: result, sakana: zafnSakana };
}

// ── Public: fetch both, reusing one token ─────────────────────────────────────
async function fetchExtraSheets() {
  const t = await getToken();
  const [trn, zafnData] = await Promise.all([fetchTrnStock(t), fetchZafnDanger(t)]);
  console.log(`Trn מחסן מעבר: ${trn.length} items with stock`);
  console.log(`Zafn צפון danger (<3 days): ${zafnData.under3.length} items | סכנה: ${zafnData.sakana.length}`);
  return { trn, zafn: zafnData };
}

module.exports = { fetchExtraSheets };
