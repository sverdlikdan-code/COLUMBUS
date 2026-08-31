// Direct-to-Priority read-only pools (form=FORMULA, icecrea=ICE) — used only by
// GET /api/today-orders. Lazy connect (mirrors server/db.js) so a Priority outage
// at process boot never blocks server startup or crashes pm2.
const sql = require('mssql');

// CURDATE is whole days since 1988-01-01 * 1440 — see .claude/SKILLS/priority-sql/SKILL.md
// (Date Format section) for why this isn't YYYYMMDD despite looking like it.
function curdateFor(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const daysSince1988 = (Date.UTC(y, m - 1, d) - Date.UTC(1988, 0, 1)) / 86400000;
  return daysSince1988 * 1440;
}

const baseCfg = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectTimeout: 10000,
  requestTimeout: 15000,
  pool: { min: 0, max: 2 },
};

const pools = {}; // dbName -> ConnectionPool

async function getPool(dbName) {
  if (pools[dbName]?.connected) return pools[dbName];
  if (!pools[dbName]) pools[dbName] = new sql.ConnectionPool({ ...baseCfg, database: dbName });
  if (!pools[dbName].connected && !pools[dbName].connecting) await pools[dbName].connect();
  return pools[dbName];
}

// ORDSTATUS -6 = 'מבוטלת' (cancelled, office soft-delete — CANCELFLAG='Y' in the
// ORDSTATUS lookup table). Priority never removes the row, just flips this flag,
// so without excluding it a cancelled order looks identical to an active one.
// Found live 2026-08-31 (Zoya/agent 257, ORD 121153): our day-closing sum
// included a cancelled order the tablet's native report correctly excludes.
const OPEN_ORDERS_QUERY = `
  SELECT DISTINCT C.CUSTNAME
  FROM ORDERS O
  JOIN CUSTOMERS C ON C.CUST = O.CUST
  WHERE O.CURDATE = @today AND O.ORDSTATUS <> -6
`;

// ICE only: בודדים (singles) sell van-sale — invoiced directly off the truck, never
// passes through ORDERS as a pending/open order — so any בודדים row that DOES show up
// in ORDERS isn't the "client placed an order, awaiting fulfillment" signal this badge
// means. Verified empirically 2026-08-25 (server/probe-ice-family-filter*.js): 161
// unfiltered -> 151 after excluding בודדים-family lines, zero overlap. מארזים/מאגדת
// (multipack/case families) count as mishpachti-equivalent per user confirmation, so
// this excludes ONLY בודדים rather than maintaining a growing include-list.
const OPEN_ICE_MISH_ORDERS_QUERY = `
  SELECT DISTINCT C.CUSTNAME
  FROM ORDERS O
  JOIN CUSTOMERS C ON C.CUST = O.CUST
  JOIN ORDERITEMS OI ON OI.ORD = O.ORD
  JOIN PART P ON P.PART = OI.PART
  JOIN FAMILY F ON F.FAMILY = P.FAMILY
  WHERE O.CURDATE = @today AND O.ORDSTATUS <> -6 AND F.FAMILYDES NOT LIKE N'%בודדים%'
`;

// Returns Set<CUSTNAME string> or null on any failure — caller decides what "no data" means.
// Never throws: a Priority outage must degrade the ✔️ feature, not the caller's response.
async function custIdsWithOpenOrderToday(dbName, dateStr) {
  try {
    const pool = await getPool(dbName);
    const result = await pool.request().input('today', sql.BigInt, curdateFor(dateStr)).query(OPEN_ORDERS_QUERY);
    return new Set(result.recordset.map(r => String(r.CUSTNAME)));
  } catch (e) {
    console.error(`[priority-db] ${dbName} query failed: ${e.message}`);
    return null;
  }
}

async function iceMishCustIdsWithOpenOrderToday(dbName, dateStr) {
  try {
    const pool = await getPool(dbName);
    const result = await pool.request().input('today', sql.BigInt, curdateFor(dateStr)).query(OPEN_ICE_MISH_ORDERS_QUERY);
    return new Set(result.recordset.map(r => String(r.CUSTNAME)));
  } catch (e) {
    console.error(`[priority-db] ${dbName} (ice mish) query failed: ${e.message}`);
    return null;
  }
}

// "סגירת יום" (day close) button — scoped by the currently-viewed agent's full
// client roster (custIds — every client across all their route days, not just
// today's), never by ORDERS.AGENT. Live clarification 2026-08-26: whoever is
// physically logged in doesn't matter — "sitting in Galina" and pressing
// סגירת יום means every open order today from one of GALINA's clients counts,
// regardless of which real Priority agent code ended up on that order.
// custIds are the app's custId values, which are Priority's CUSTOMERS.CUSTNAME
// (the customer-facing code, e.g. "1136710") — NOT CUSTOMERS.CUST (the
// internal surrogate key, e.g. "5243"). Confirmed live 2026-08-26: filtering
// ORDERS.CUST directly against a CUSTNAME value matched nothing even for a
// client with a real order that day, because they're different columns with
// different value spaces. Must join CUSTOMERS and filter on C.CUSTNAME.
// DISPRICE (not TOTPRICE) — sum without VAT, per live request 2026-08-26.
// TOTPRICE = DISPRICE + VAT (confirmed on a real row earlier this session).
//
// ICE mishpachti branch filters PRODUCT-family בודדים lines out (not the
// same "בודדים" as the CUSTOMER/channel meaning in OPEN_ICE_MISH_ORDERS_QUERY
// below — see that comment) but does it at LINE level via ORDERITEMS.QPRICE,
// not by excluding the whole ORDERS.DISPRICE. Confirmed live 2026-08-26
// (David/agent 258 case): 6 of 137 ICE orders that day mixed בודדים- and
// מישפחתי-labeled PRODUCT lines in the SAME order — an order-level filter/sum
// would fold the בודדים portion into a total that's supposed to be
// מישפחתי-only (measured ~45% inflation on the affected clients: 27,170.79
// order-level vs 14,958.86 line-level for the same 6-client test set).
// User's final call after seeing both product-family lines exist for real
// reasons: keep the per-line filter, just do it correctly at line grain.
//
// agentCode fallback: custIds comes from the PBI roster cache, which only
// refreshes once a day — a client created TODAY isn't in ANYONE's roster yet
// and would be invisible no matter who's viewing. Live call 2026-08-26: also
// match orders whose ORDERS.AGENT resolves to the CURRENTLY VIEWED agentCode,
// so a brand-new client's order still lands on the right line even before
// tomorrow's PBI refresh picks them up. ORDERS.AGENT stores AGENTS' internal
// AGENT id in BOTH databases, never the AGENTCODE directly — confirmed live
// 2026-08-26 the hard way: an earlier version of this compared O.AGENT to the
// AGENTCODE literally for 'form', which happened to silently "work" for one
// test case (agent 258's orders showed AGENT='100', which is ALSO agent 100's
// own AGENTCODE — a coincidence of two different fields landing on the same
// digits) and hid the bug. David's own internal AGENT id is actually '100'
// too (AGENTCODE=258 -> AGENT=100), unrelated to Andrey's AGENTCODE=100 — two
// different people, same string, different columns. Always resolve through
// AGENTS regardless of database.
async function dayClosingSummary(dbName, dateStr, custIds, agentCode, { iceMishOnly } = {}) {
  if (!custIds.length && !agentCode) return { custCount: 0, sum: 0 };
  const pool = await getPool(dbName);
  const req = pool.request().input('today', sql.BigInt, curdateFor(dateStr));
  const custInList = custIds.length
    ? custIds.map((c, i) => { req.input(`cust${i}`, sql.NVarChar, String(c)); return `@cust${i}`; }).join(',')
    : null;
  const orParts = [];
  if (custInList) orParts.push(`C.CUSTNAME IN (${custInList})`);
  if (agentCode) {
    req.input('agentCode', sql.NVarChar, String(agentCode));
    orParts.push(`O.AGENT = (SELECT TOP 1 AGENT FROM AGENTS WHERE AGENTCODE = @agentCode)`);
  }
  const orClause = orParts.join(' OR ');
  // "new" = matched only via the agentCode fallback, not in the PBI roster —
  // reported as a separate מתוכם ("of which") line so an agent can see a new
  // client contributed, not just a bigger total with no explanation. A client
  // with an empty roster (custInList null) is "new" by definition — NOT IN ()
  // is invalid SQL, so that case just hardcodes the flag true.
  const notInRoster = custInList ? `C.CUSTNAME NOT IN (${custInList})` : '1=1';
  // OI.QPRICE is the PRE-discount line price — O.T$PERCENT is the document-level
  // discount % that DISPRICE already bakes in for the non-ICE branch below. Found
  // live 2026-08-27 (Zoya/agent 257 case): summing raw QPRICE overstated the ICE
  // total by exactly each order's discount (e.g. order 120821: line QPRICE sum
  // 812.6 vs the real DISPRICE 694.77 = 812.6*(1-14.5/100)) — tablet's native
  // Priority report shows DISPRICE-equivalent (post-discount), so the line-level
  // sum here must apply the same % per order to match. Verified the corrected
  // formula reproduces the tablet's total exactly (5,318.70) for that day/agent.
  const query = iceMishOnly ? `
    SELECT COUNT(DISTINCT O.CUST) AS custCount, SUM(OI.QPRICE * (1 - O.T$PERCENT/100.0)) AS sumPrice,
      COUNT(DISTINCT CASE WHEN ${notInRoster} THEN O.CUST END) AS newCustCount,
      SUM(CASE WHEN ${notInRoster} THEN OI.QPRICE * (1 - O.T$PERCENT/100.0) ELSE 0 END) AS newSumPrice
    FROM ORDERS O
    JOIN CUSTOMERS C ON C.CUST = O.CUST
    JOIN ORDERITEMS OI ON OI.ORD = O.ORD
    JOIN PART P ON P.PART = OI.PART
    JOIN FAMILY F ON F.FAMILY = P.FAMILY
    WHERE O.CURDATE = @today AND O.ORDSTATUS <> -6 AND (${orClause}) AND F.FAMILYDES NOT LIKE N'%בודדים%'
  ` : `
    SELECT COUNT(DISTINCT O.CUST) AS custCount, SUM(O.DISPRICE) AS sumPrice,
      COUNT(DISTINCT CASE WHEN ${notInRoster} THEN O.CUST END) AS newCustCount,
      SUM(CASE WHEN ${notInRoster} THEN O.DISPRICE ELSE 0 END) AS newSumPrice
    FROM ORDERS O
    JOIN CUSTOMERS C ON C.CUST = O.CUST
    WHERE O.CURDATE = @today AND O.ORDSTATUS <> -6 AND (${orClause})
  `;
  const result = await req.query(query);
  const row = result.recordset[0] || {};

  // Subtotal by whoever actually keyed the order into Priority (O.AGENT resolved
  // to AGENTCODE) — found live 2026-08-28 (Alexey Brilov/agent 53 case): the
  // roster owner and the entering agent are often different people (a manager or
  // another rep placing the order for someone else's client), so a client asking
  // "who sold what" needs this breakdown, not just the combined total. Same
  // WHERE clause as the main query, just grouped by the entering agent instead
  // of collapsed. Only meaningful (and only rendered client-side) when there's
  // more than one distinct entering agent — a single-agent day doesn't need it.
  const byAgentReq = pool.request().input('today', sql.BigInt, curdateFor(dateStr));
  if (custInList) custIds.forEach((c, i) => byAgentReq.input(`cust${i}`, sql.NVarChar, String(c)));
  if (agentCode) byAgentReq.input('agentCode', sql.NVarChar, String(agentCode));
  const byAgentQuery = iceMishOnly ? `
    SELECT (SELECT AGENTCODE FROM AGENTS WHERE AGENT = O.AGENT) AS enteringAgentCode,
      (SELECT AGENTNAME FROM AGENTS WHERE AGENT = O.AGENT) AS enteringAgentName,
      COUNT(DISTINCT O.CUST) AS custCount, SUM(OI.QPRICE * (1 - O.T$PERCENT/100.0)) AS sumPrice
    FROM ORDERS O
    JOIN CUSTOMERS C ON C.CUST = O.CUST
    JOIN ORDERITEMS OI ON OI.ORD = O.ORD
    JOIN PART P ON P.PART = OI.PART
    JOIN FAMILY F ON F.FAMILY = P.FAMILY
    WHERE O.CURDATE = @today AND O.ORDSTATUS <> -6 AND (${orClause}) AND F.FAMILYDES NOT LIKE N'%בודדים%'
    GROUP BY O.AGENT
  ` : `
    SELECT (SELECT AGENTCODE FROM AGENTS WHERE AGENT = O.AGENT) AS enteringAgentCode,
      (SELECT AGENTNAME FROM AGENTS WHERE AGENT = O.AGENT) AS enteringAgentName,
      COUNT(DISTINCT O.CUST) AS custCount, SUM(O.DISPRICE) AS sumPrice
    FROM ORDERS O
    JOIN CUSTOMERS C ON C.CUST = O.CUST
    WHERE O.CURDATE = @today AND O.ORDSTATUS <> -6 AND (${orClause})
    GROUP BY O.AGENT
  `;
  const byAgentResult = await byAgentReq.query(byAgentQuery);
  const byAgent = byAgentResult.recordset.map(r => ({
    agentCode: r.enteringAgentCode || null,
    agentName: r.enteringAgentName || '',
    custCount: Number(r.custCount) || 0,
    sum: Math.round((Number(r.sumPrice) || 0) * 100) / 100,
  }));

  return {
    custCount: Number(row.custCount) || 0,
    sum: Math.round((Number(row.sumPrice) || 0) * 100) / 100,
    newCustCount: Number(row.newCustCount) || 0,
    newSum: Math.round((Number(row.newSumPrice) || 0) * 100) / 100,
    byAgent,
  };
}

// Sellout table for "סגירת יום פורמולה" — fixed makat list (given by the user, not
// agent-selected), quantity summed from today's ORDERITEMS for the viewed
// agent's full client roster (same custIds/CUSTNAME/agentCode-fallback scoping
// as dayClosingSummary — ORDERS.AGENT is AGENTS' internal id, not AGENTCODE,
// resolved via the same subquery (see dayClosingSummary's comment for the
// live bug this fixed).
// QUANT/1000 per the project's Priority-SQL convention (CLAUDE.md).
async function dayClosingSellout(dbName, dateStr, custIds, agentCode, skuList) {
  if (!skuList.length || (!custIds.length && !agentCode)) return [];
  const pool = await getPool(dbName);
  const req = pool.request().input('today', sql.BigInt, curdateFor(dateStr));
  const custInList = custIds.length
    ? custIds.map((c, i) => { req.input(`cust${i}`, sql.NVarChar, String(c)); return `@cust${i}`; }).join(',')
    : null;
  const orParts = [];
  if (custInList) orParts.push(`C.CUSTNAME IN (${custInList})`);
  if (agentCode) {
    req.input('agentCode', sql.NVarChar, String(agentCode));
    orParts.push(`O.AGENT = (SELECT TOP 1 AGENT FROM AGENTS WHERE AGENTCODE = @agentCode)`);
  }
  const orClause = orParts.join(' OR ');
  const skuInList = skuList.map((s, i) => { req.input(`sku${i}`, sql.NVarChar, String(s)); return `@sku${i}`; }).join(',');
  const result = await req.query(`
    SELECT P.PARTNAME AS sku, P.PARTDES AS name, SUM(OI.QUANT) AS sumQuant
    FROM ORDERS O
    JOIN CUSTOMERS C ON C.CUST = O.CUST
    JOIN ORDERITEMS OI ON OI.ORD = O.ORD
    JOIN PART P ON P.PART = OI.PART
    WHERE O.CURDATE = @today AND O.ORDSTATUS <> -6 AND (${orClause}) AND P.PARTNAME IN (${skuInList})
    GROUP BY P.PARTNAME, P.PARTDES
  `);
  const bySku = new Map(result.recordset.map(r => [String(r.sku), { name: String(r.name || ''), qty: Number(r.sumQuant) / 1000 }]));
  // Every requested SKU appears in the report even with 0 sold today — an agent
  // needs to see "0" as much as a number, not have the row silently vanish.
  return skuList.map(sku => ({ sku, name: bySku.get(sku)?.name || '', qty: bySku.get(sku)?.qty || 0 }));
}

// Team-wide FORMULA order totals for TODAY, grouped by the entering agent
// (O.AGENT resolved to AGENTCODE) — ONE query for the whole team instead of
// one dayClosingSummary call per agent, which is exactly the PBI-overload
// mistake the /customers sequential-fetch comment in server/index.js already
// learned from, just at the SQL layer this time. Used by the manager's
// agent-picker screen for a live per-agent glance.
// ponytail: entering-agent grouping only (same as dayClosingSummary's byAgent
// sub-query), not the fuller roster-OR-entering-agent scoping dayClosingSummary
// uses for the real day-closing send. Good enough for a live overview number;
// upgrade to roster-scoped (needs a per-agent custId roster join) only if a
// manager reports this not matching the real day-closing sum for some agent.
async function dayClosingByAgentAll(dbName, dateStr) {
  try {
    const pool = await getPool(dbName);
    const result = await pool.request().input('today', sql.BigInt, curdateFor(dateStr)).query(`
      SELECT (SELECT AGENTCODE FROM AGENTS WHERE AGENT = O.AGENT) AS agentCode,
        COUNT(DISTINCT O.CUST) AS custCount, SUM(O.DISPRICE) AS sumPrice
      FROM ORDERS O
      WHERE O.CURDATE = @today AND O.ORDSTATUS <> -6
      GROUP BY O.AGENT
    `);
    return result.recordset
      .filter(r => r.agentCode)
      .map(r => ({
        agentCode: String(r.agentCode),
        custCount: Number(r.custCount) || 0,
        sum: Math.round((Number(r.sumPrice) || 0) * 100) / 100,
      }));
  } catch (e) {
    console.error(`[priority-db] ${dbName} day-closing-team query failed: ${e.message}`);
    return null;
  }
}

// Raw per-order rows for TODAY, no grouping — the "upgrade to roster-scoped"
// promised in dayClosingByAgentAll's comment above, needed live 2026-08-31:
// Oleg Gladkikh's tile showed 0 מתוך 22 while his own banner showed 2, because
// both of his day's orders were entered under Alexey Brilov's code (AGENT 53)
// for Oleg's roster clients — dayClosingByAgentAll only ever credits the
// entering agent, never the roster owner. The caller (server/index.js, which
// has pbiCache in memory) cross-references custId against each agent's roster
// and credits BOTH the roster owner and the entering agent when they differ —
// same roster-OR-entering-agent rule dayClosingSummary already uses per-agent,
// just computed for the whole team in one pass instead of one query per agent.
async function dayClosingOrdersToday(dbName, dateStr) {
  try {
    const pool = await getPool(dbName);
    const result = await pool.request().input('today', sql.BigInt, curdateFor(dateStr)).query(`
      SELECT C.CUSTNAME AS custId, O.DISPRICE AS dispPrice,
        (SELECT AGENTCODE FROM AGENTS WHERE AGENT = O.AGENT) AS enteringAgentCode
      FROM ORDERS O
      JOIN CUSTOMERS C ON C.CUST = O.CUST
      WHERE O.CURDATE = @today AND O.ORDSTATUS <> -6
    `);
    return result.recordset.map(r => ({
      custId: String(r.custId),
      dispPrice: Number(r.dispPrice) || 0,
      enteringAgentCode: r.enteringAgentCode ? String(r.enteringAgentCode) : null,
    }));
  } catch (e) {
    console.error(`[priority-db] ${dbName} day-closing-orders query failed: ${e.message}`);
    return null;
  }
}

// Used as a last-resort fallback tier in geocodeBatch (server/index.js) for brand-new
// clients that have no PBI coordinate and failed address geocoding: last `daysBack`
// days, all 3 companies, same ~100m clustering convention as gps-build-combined.js.
// Deliberately NOT wired in ahead of PBI/address geocoding — that "tablet-priority"
// architecture (which overrode already-good coordinates for ALL clients, not just new
// ones) caused a cascade of live routing bugs 2026-08-30/31 and was rolled back same
// day. This narrower re-add only fires for clients who'd otherwise end up with no GPS
// at all — it can only help, never override an existing coordinate. Live request
// 2026-08-31 ("для новых клиентов можно допустить фолбэк гео из таблета").
// AGENT exclusions: house/admin codes whose orders don't reflect a real field visit —
// no agent (0/NULL), any generic-agent name containing "כללי", and named individual
// exclusions (currently just יוסי אלייב).
const EXCLUDED_LIVE_AGENT_PATTERN = '%כללי%';
const EXCLUDED_LIVE_AGENT_EXACT = ['יוסי אלייב'];
const IL_BBOX_SQL = `
  AND TRY_CAST(OB.GPSY AS float) BETWEEN 29.5 AND 33.5
  AND TRY_CAST(OB.GPSX AS float) BETWEEN 34.0 AND 36.2
`;

async function liveOrderGpsForNewClient(custId, daysBack = 30) {
  const since = curdateFor(new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10));
  const dbs = ['form', 'icecrea', 'diller'];
  const perDb = await Promise.all(dbs.map(async (dbName) => {
    try {
      const pool = await getPool(dbName);
      const req = pool.request()
        .input('custId', sql.NVarChar, String(custId))
        .input('since', sql.BigInt, since)
        .input('agentPattern', sql.NVarChar, EXCLUDED_LIVE_AGENT_PATTERN);
      const exactInList = EXCLUDED_LIVE_AGENT_EXACT.map((n, i) => { req.input(`ag${i}`, sql.NVarChar, n); return `@ag${i}`; }).join(',');
      const result = await req.query(`
        SELECT OB.GPSX AS lng, OB.GPSY AS lat, COUNT(*) AS cnt
        FROM ORDERS O
        JOIN CUSTOMERS C ON C.CUST = O.CUST
        JOIN ORDERSB OB ON OB.ORD = O.ORD
        WHERE C.CUSTNAME = @custId
          AND O.CURDATE >= @since
          AND O.AGENT IS NOT NULL AND O.AGENT <> 0
          AND O.AGENT NOT IN (SELECT AGENT FROM AGENTS WHERE AGENTNAME LIKE @agentPattern OR AGENTNAME IN (${exactInList}))
          AND OB.GPSX IS NOT NULL AND OB.GPSX NOT IN ('','0')
          AND OB.GPSY IS NOT NULL AND OB.GPSY NOT IN ('','0')
          ${IL_BBOX_SQL}
          -- equipment/sample/other non-sale orders (no real qty or price on any
          -- line) don't reflect an actual product visit — same exclusion as
          -- gps-build-combined.js
          AND EXISTS (
            SELECT 1 FROM ORDERITEMS OI
            WHERE OI.ORD = O.ORD AND (ISNULL(OI.QUANT, 0) <> 0 OR ISNULL(OI.QPRICE, 0) <> 0)
          )
        GROUP BY OB.GPSX, OB.GPSY
      `);
      return result.recordset.map(r => ({ lat: parseFloat(r.lat), lng: parseFloat(r.lng), cnt: Number(r.cnt) }));
    } catch (e) {
      console.error(`[priority-db] live GPS lookup failed (${dbName}, cust=${custId}): ${e.message}`);
      return [];
    }
  }));

  const points = perDb.flat().filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!points.length) return null;

  // cluster by ~100m rounding (same convention as gps-build-combined.js), weighted centroid of the biggest bucket
  const buckets = new Map();
  for (const p of points) {
    const key = `${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`;
    const b = buckets.get(key) || { latSum: 0, lngSum: 0, cnt: 0 };
    b.latSum += p.lat * p.cnt; b.lngSum += p.lng * p.cnt; b.cnt += p.cnt;
    buckets.set(key, b);
  }
  let best = null;
  for (const b of buckets.values()) if (!best || b.cnt > best.cnt) best = b;
  return best ? { lat: best.latSum / best.cnt, lng: best.lngSum / best.cnt, orders: best.cnt } : null;
}

module.exports = { custIdsWithOpenOrderToday, iceMishCustIdsWithOpenOrderToday, dayClosingSummary, dayClosingSellout, dayClosingByAgentAll, dayClosingOrdersToday, curdateFor, liveOrderGpsForNewClient };
