require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const sql = require('mssql');
const fs  = require('fs');
const path = require('path');

const baseCfg = {
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server:   process.env.DB_SERVER,
  options:  { encrypt: false, trustServerCertificate: true },
  pool:     { max: 3, min: 0, idleTimeoutMillis: 20000 }
};

// Filter: skip small/supplementary orders (truck top-ups made outside the store)
const MIN_LINES = 3;

// Cluster radius: round coordinates to 3 decimal places (~100m)
const BUCKET = 3;

async function queryDB(db, q) {
  const pool = await new sql.ConnectionPool({...baseCfg, database: db}).connect();
  try { return (await pool.request().query(q)).recordset; }
  finally { await pool.close(); }
}

// Per-company: get GPS clusters filtered by min line count and Israel bbox
// Returns rows: { custname, lat_bucket, lng_bucket, lat_avg, lng_avg, cnt }
function buildGpsQuery() {
  return `
    WITH order_lines AS (
      SELECT ORD, COUNT(DISTINCT KLINE) AS line_cnt FROM ORDERITEMS GROUP BY ORD
    ),
    filtered AS (
      SELECT O.CUST, OB.GPSX, OB.GPSY, OL.line_cnt
      FROM ORDERS O
      JOIN ORDERSB     OB ON OB.ORD = O.ORD
      JOIN order_lines OL ON OL.ORD = O.ORD
      WHERE OL.line_cnt >= ${MIN_LINES}
        AND OB.GPSX IS NOT NULL AND OB.GPSX NOT IN ('','0')
        AND OB.GPSY IS NOT NULL AND OB.GPSY NOT IN ('','0')
        AND TRY_CAST(OB.GPSY AS float) BETWEEN 29.5 AND 33.5
        AND TRY_CAST(OB.GPSX AS float) BETWEEN 34.0 AND 36.2
    )
    SELECT
      C.CUSTNAME AS custname,
      CAST(ROUND(CAST(F.GPSY AS float), ${BUCKET}) AS float) AS lat_bucket,
      CAST(ROUND(CAST(F.GPSX AS float), ${BUCKET}) AS float) AS lng_bucket,
      AVG(CAST(F.GPSY AS float)) AS lat_avg,
      AVG(CAST(F.GPSX AS float)) AS lng_avg,
      COUNT(*) AS cnt,
      SUM(F.line_cnt) AS lines
    FROM filtered F
    JOIN CUSTOMERS C ON C.CUST = F.CUST
    GROUP BY
      C.CUSTNAME,
      CAST(ROUND(CAST(F.GPSY AS float), ${BUCKET}) AS float),
      CAST(ROUND(CAST(F.GPSX AS float), ${BUCKET}) AS float)
  `;
}

async function fetchCompany(db, label) {
  console.log(`  [${label}] querying ${db}...`);
  const rows = await queryDB(db, buildGpsQuery());
  const clients = new Set(rows.map(r => r.custname)).size;
  console.log(`  -> ${rows.length} GPS clusters for ${clients} clients`);
  return rows.map(r => ({...r, src: label}));
}

async function main() {
  console.log(`=== GPS Combined Builder ===`);
  console.log(`Settings: MIN_LINES=${MIN_LINES} (filter small orders), BUCKET=3dp (~100m cluster)\n`);

  // Query all 3 companies in parallel
  const [formRows, iceRows, interRows] = await Promise.all([
    fetchCompany('form',    'FORM'),
    fetchCompany('icecrea', 'ICE'),
    fetchCompany('diller',  'INTER'),
  ]);

  // Merge all rows into cluster map
  // Key = "custname|lat_bucket|lng_bucket" — same bucket from different companies = same location
  const clusterMap = new Map();

  for (const row of [...formRows, ...iceRows, ...interRows]) {
    const key = `${row.custname}|${row.lat_bucket}|${row.lng_bucket}`;
    if (!clusterMap.has(key)) {
      clusterMap.set(key, {
        custname:   row.custname,
        lat_bucket: row.lat_bucket,
        lng_bucket: row.lng_bucket,
        lat_wsum:   row.lat_avg * row.cnt,
        lng_wsum:   row.lng_avg * row.cnt,
        total_cnt:  row.cnt,
        lines:      row.lines,
        sources:    new Set([row.src]),
      });
    } else {
      const c = clusterMap.get(key);
      c.lat_wsum  += row.lat_avg * row.cnt;
      c.lng_wsum  += row.lng_avg * row.cnt;
      c.total_cnt += row.cnt;
      c.lines     += row.lines;
      c.sources.add(row.src);
    }
  }

  // Group clusters per customer, then pick best (highest combined count)
  const byCustomer = new Map();
  for (const c of clusterMap.values()) {
    if (!byCustomer.has(c.custname)) byCustomer.set(c.custname, []);
    byCustomer.get(c.custname).push(c);
  }

  // Ratchet (Дан 26.10): the current file is the baseline. A client's point moves only when the
  // new cluster clearly outweighs the one at the current point (≥2× AND ≥3 more orders); otherwise
  // the current point stays and the candidate goes to the held list for Дан. A rebuild can then only
  // add data, never quietly swap a store for an agent's desk (1153775/1154416: Natalya's spot won
  // 3:2, 2:1). No Google arbiter on purpose: Google is often plain wrong (field test 19–20.10,
  // tablet beat it 4×; dry run 26.10 let Caesarea→Haifa through on "36.9 km beats 47.6 km").
  const outPath = process.env.GPS_OUT || path.join(__dirname, '../docs/priority-gps-cross.json');
  const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } };
  const baseline = new Map((readJson(process.env.GPS_BASE || outPath) || []).map(r => [String(r.cust), r]));
  const km = (a, b) => {
    const t = Math.PI / 180, dl = (b.lat - a.lat) * t, dn = (b.lng - a.lng) * t;
    return 12742 * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dn / 2) ** 2));
  };
  const held = [];
  let moved = 0;

  const output = [];
  for (const [custname, clusters] of byCustomer) {
    const totalOrders = clusters.reduce((s, c) => s + c.total_cnt, 0);
    // Tie on order count → more מק"טים wins (a real store visit carries the bigger order;
    // 1154525 on 30.08: 10 lines off-site vs 14 at the store). Last key is the bucket itself,
    // so the pick never depends on SQL row order (it used to flip ties randomly between rebuilds).
    // "Lines" = SUM of per-order line counts, not COUNT DISTINCT KLINE across the cluster.
    // ponytail: on a full tie the southern/western bucket wins arbitrarily, upgrade when the
    // server cascade gets a tie flag → Google-in-city-bbox (FR, after the 29.10 switch).
    clusters.sort((a, b) => b.total_cnt - a.total_cnt || b.lines - a.lines
      || a.lat_bucket - b.lat_bucket || a.lng_bucket - b.lng_bucket);
    const best = clusters[0];

    const lat = best.lat_wsum / best.total_cnt;
    const lng = best.lng_wsum / best.total_cnt;

    const prev = baseline.get(String(custname));
    if (prev) {
      const d = km(prev, { lat, lng });
      if (d >= 0.3) {
        const prevCnt = clusters.filter(c => km(prev, { lat: c.lat_wsum / c.total_cnt, lng: c.lng_wsum / c.total_cnt }) < 0.3)
          .reduce((s, c) => s + c.total_cnt, 0);
        const clear = best.total_cnt >= 2 * prevCnt && best.total_cnt - prevCnt >= 3;
        if (!clear) {
          output.push(prev);
          held.push({ cust: custname, km: Math.round(d * 10) / 10, prev_cnt: prevCnt, new_cnt: best.total_cnt,
            prev: [prev.lat, prev.lng], cand: [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6] });
          continue;
        }
        moved++;
      }
    }

    output.push({
      cust:         custname,
      lat:          Math.round(lat * 1e6) / 1e6,
      lng:          Math.round(lng * 1e6) / 1e6,
      orders:       totalOrders,
      top_cnt:      best.total_cnt,
      cluster_pct:  Math.round(best.total_cnt * 100 / totalOrders),
      sources:      [...best.sources].sort().join('+'),
      source_count: best.sources.size,
    });
  }

  // A client with no qualifying orders in this run keeps its baseline point — dropping it would
  // push the cascade down to PBI/geocode, exactly the regression the ratchet is there to stop.
  let carried = 0;
  for (const [cust, prev] of baseline) if (!byCustomer.has(cust)) { output.push(prev); carried++; }

  output.sort((a, b) => a.cust.localeCompare(b.cust));

  // Stats
  console.log(`\nTotal unique clients: ${output.length}`);

  const bySrc = {};
  output.forEach(r => { bySrc[r.sources] = (bySrc[r.sources]||0)+1; });
  console.log('Source distribution:');
  Object.entries(bySrc).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) =>
    console.log(`  ${k.padEnd(18)}: ${v} clients`)
  );

  const highConf = output.filter(r => r.source_count >= 2).length;
  console.log(`\nHigh confidence (2+ companies agree): ${highConf} / ${output.length} clients`);

  console.log(`Ratchet: moved ${moved}, held ${held.length} (kept current point), carried ${carried} (no orders this run), baseline ${baseline.size}`);
  // Held candidates ≥1 km go to Дан for a manual call (quarterly review), never auto-applied.
  // Not under docs/ — that folder is published to GitHub Pages.
  const heldPath = process.env.GPS_HELD || path.join(__dirname, 'data', 'gps-cross-held.json');
  fs.mkdirSync(path.dirname(heldPath), { recursive: true });
  fs.writeFileSync(heldPath, JSON.stringify(held.filter(h => h.km >= 1).sort((a, b) => b.km - a.km), null, 2), 'utf8');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote ${output.length} entries -> ${outPath} (held ≥1 km -> ${heldPath})`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
