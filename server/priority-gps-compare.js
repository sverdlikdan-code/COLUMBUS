/**
 * Cross-company GPS comparison: FORM + ICE + INTER
 * v4: single combined CSV (חברה, CUST, lat, lng, cnt), no header row.
 * Pools all GPS points per client across companies, then finds consensus cluster.
 */
const fs   = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DIR = path.join(__dirname, '../ATA GPS FROM ORDERS');

// ── Geo helpers ───────────────────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function isValidIL(lat, lng) {
  return lat && lng && lat > 29 && lat < 33.5 && lng > 33 && lng < 36.5;
}

// Normalize company name → canonical key
const COMPANY_MAP = {
  'ice': 'ICE', 'אייס': 'ICE', 'ice cream': 'ICE',
  'פורמולה': 'FORM', 'formula': 'FORM', 'form': 'FORM',
  'אינטר': 'INTER', 'inter': 'INTER', 'diller': 'INTER',
};
function normalizeCompany(raw) {
  return COMPANY_MAP[raw.trim().toLowerCase()] || raw.trim().toUpperCase();
}

// ── Load single combined CSV (חברה, CUST, lat, lng, cnt) ─────────────────────
function loadAllCSV(filename) {
  const file = path.join(DIR, filename);
  if (!fs.existsSync(file)) { console.error('Missing:', filename); process.exit(1); }
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split('\n');
  const byCompany = { FORM: new Map(), ICE: new Map(), INTER: new Map() };
  let skipped = 0;
  for (const line of lines) {
    const parts = line.trim().split(',');
    if (parts.length < 4) continue;
    const source = normalizeCompany(parts[0]);
    const cust   = String(parts[1]).trim();
    const lat    = parseFloat(parts[2]);
    const lng    = parseFloat(parts[3]);
    const cnt    = parseInt(parts[4]) || 1;
    if (!cust || isNaN(lat) || isNaN(lng)) continue;
    if (!isValidIL(lat, lng)) { skipped++; continue; }
    if (!byCompany[source]) byCompany[source] = new Map();
    if (!byCompany[source].has(cust)) byCompany[source].set(cust, []);
    byCompany[source].get(cust).push({ lat, lng, cnt, source });
  }
  if (skipped) console.log(`Filtered out ${skipped} points outside Israel bbox`);
  return byCompany;
}

// ── Weighted centroid of a set of points ─────────────────────────────────────
function centroid(pts) {
  if (!pts.length) return null;
  const total = pts.reduce((s, p) => s + p.cnt, 0);
  return {
    lat: pts.reduce((s, p) => s + p.lat * p.cnt, 0) / total,
    lng: pts.reduce((s, p) => s + p.lng * p.cnt, 0) / total,
    cnt: total,
  };
}

// ── Best cluster: find group of points within radius with max total cnt ───────
const CLUSTER_RADIUS = 500; // meters

function bestCluster(allPts) {
  if (!allPts.length) return null;
  let winner = null, winScore = -1;
  for (const p of allPts) {
    const cluster = allPts.filter(q => haversine(p.lat, p.lng, q.lat, q.lng) <= CLUSTER_RADIUS);
    const score = cluster.reduce((s, q) => s + q.cnt, 0);
    if (score > winScore) { winScore = score; winner = cluster; }
  }
  return winner;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const byCompany = loadAllCSV('priority-gps_ALL FROM ORDERS.csv');
  const form  = byCompany['FORM']  || new Map();
  const ice   = byCompany['ICE']   || new Map();
  const inter = byCompany['INTER'] || new Map();

  console.log(`Loaded — FORM: ${form.size} clients, ICE: ${ice.size} clients, INTER: ${inter.size} clients`);

  const allCusts = new Set([...form.keys(), ...ice.keys(), ...inter.keys()]);
  console.log(`Total unique clients: ${allCusts.size}`);

  const rows = [];

  for (const cust of allCusts) {
    const fPts = form.get(cust)  || [];
    const iPts = ice.get(cust)   || [];
    const nPts = inter.get(cust) || [];
    const allPts = [...fPts, ...iPts, ...nPts];

    const sources = [
      fPts.length ? 'FORM'  : null,
      iPts.length ? 'ICE'   : null,
      nPts.length ? 'INTER' : null,
    ].filter(Boolean);
    const companyCount = sources.length;

    // Company centroids (for inter-company distance)
    const fc = centroid(fPts);
    const ic = centroid(iPts);
    const nc = centroid(nPts);
    const distFI = fc && ic ? haversine(fc.lat, fc.lng, ic.lat, ic.lng) : null;
    const distFN = fc && nc ? haversine(fc.lat, fc.lng, nc.lat, nc.lng) : null;
    const distIN = ic && nc ? haversine(ic.lat, ic.lng, nc.lat, nc.lng) : null;

    // Pool all points, find best cluster ACROSS all companies
    const cluster = bestCluster(allPts);
    const con = centroid(cluster);
    const clusterSources = new Set((cluster || []).map(p => p.source));
    const consensusMatch = clusterSources.size;

    const consensusLat = con ? +con.lat.toFixed(6) : '';
    const consensusLng = con ? +con.lng.toFixed(6) : '';
    const totalOrders  = allPts.reduce((s, p) => s + p.cnt, 0);

    // Confidence
    let confidence;
    if (consensusMatch === 3)        confidence = '\u{1F3C6} 3/3 חפיפה מלאה';
    else if (consensusMatch === 2)   confidence = '✅ 2/3 חפיפה';
    else if (companyCount >= 2)      confidence = '⚠️ 2+ חברות אך GPS שונה';
    else                             confidence = '\u{1F4CD} חברה אחת';

    rows.push({
      cust,
      sources:       sources.join('+'),
      companyCount,
      totalOrders,
      formLat:  fc?.lat  != null ? +fc.lat.toFixed(6)  : '',
      formLng:  fc?.lng  != null ? +fc.lng.toFixed(6)  : '',
      formCnt:  fc?.cnt  ?? '',
      iceLat:   ic?.lat  != null ? +ic.lat.toFixed(6)  : '',
      iceLng:   ic?.lng  != null ? +ic.lng.toFixed(6)  : '',
      iceCnt:   ic?.cnt  ?? '',
      interLat: nc?.lat  != null ? +nc.lat.toFixed(6)  : '',
      interLng: nc?.lng  != null ? +nc.lng.toFixed(6)  : '',
      interCnt: nc?.cnt  ?? '',
      distFI:   distFI ?? '',
      distFN:   distFN ?? '',
      distIN:   distIN ?? '',
      consensusLat,
      consensusLng,
      consensusMatch,
      confidence,
    });
  }

  // Sort: best confidence first
  const order = { 3: 0, 2: 1 };
  rows.sort((a, b) => {
    const ca = a.consensusMatch === 3 ? 0 : a.consensusMatch === 2 ? 1 : a.companyCount >= 2 ? 2 : 3;
    const cb = b.consensusMatch === 3 ? 0 : b.consensusMatch === 2 ? 1 : b.companyCount >= 2 ? 2 : 3;
    return ca - cb || b.totalOrders - a.totalOrders;
  });

  const s3 = rows.filter(r => r.consensusMatch === 3).length;
  const s2 = rows.filter(r => r.consensusMatch === 2).length;
  const sX = rows.filter(r => r.companyCount >= 2 && r.consensusMatch < 2).length;
  const s1 = rows.filter(r => r.companyCount === 1).length;
  console.log(`\n3/3: ${s3} | 2/3: ${s2} | 2+ diff GPS: ${sX} | single co: ${s1}`);

  // ── Excel ────────────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GPS Cross-Company', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'מס. לקוח',       key: 'cust',         width: 12 },
    { header: 'מקורות',         key: 'sources',       width: 16 },
    { header: 'חברות',          key: 'companyCount',  width: 8  },
    { header: "סה\"כ הזמנות",   key: 'totalOrders',   width: 13 },
    { header: 'FORM Lat',       key: 'formLat',       width: 13 },
    { header: 'FORM Lng',       key: 'formLng',       width: 13 },
    { header: 'FORM הזמ.',      key: 'formCnt',       width: 11 },
    { header: 'ICE Lat',        key: 'iceLat',        width: 13 },
    { header: 'ICE Lng',        key: 'iceLng',        width: 13 },
    { header: 'ICE הזמ.',       key: 'iceCnt',        width: 11 },
    { header: 'INTER Lat',      key: 'interLat',      width: 13 },
    { header: 'INTER Lng',      key: 'interLng',      width: 13 },
    { header: 'INTER הזמ.',     key: 'interCnt',      width: 11 },
    { header: "FORM↔ICE (מ')",   key: 'distFI', width: 14 },
    { header: "FORM↔INTER (מ')", key: 'distFN', width: 14 },
    { header: "ICE↔INTER (מ')",  key: 'distIN', width: 14 },
    { header: 'Consensus Lat',  key: 'consensusLat',  width: 13 },
    { header: 'Consensus Lng',  key: 'consensusLng',  width: 13 },
    { header: 'חפיפה',          key: 'consensusMatch', width: 8  },
    { header: 'ביטחון',         key: 'confidence',    width: 22 },
  ];

  ws.getRow(1).eachCell(cell => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3F7C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  ws.getRow(1).height = 22;

  const FILLS = {
    GOLD:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } },
    GREEN:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } },
    ORANGE: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } },
    GRAY:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } },
    WHITE:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
  };

  rows.forEach((r, i) => {
    const row = ws.addRow([
      r.cust, r.sources, r.companyCount, r.totalOrders,
      r.formLat, r.formLng, r.formCnt,
      r.iceLat,  r.iceLng,  r.iceCnt,
      r.interLat,r.interLng,r.interCnt,
      r.distFI, r.distFN, r.distIN,
      r.consensusLat, r.consensusLng, r.consensusMatch,
      r.confidence,
    ]);
    const fill =
      r.consensusMatch === 3 ? FILLS.GOLD :
      r.consensusMatch === 2 ? FILLS.GREEN :
      r.companyCount >= 2    ? FILLS.ORANGE :
      i % 2 === 0            ? FILLS.WHITE : FILLS.GRAY;
    row.eachCell(cell => { cell.fill = fill; });
  });

  ws.autoFilter = { from: 'A1', to: { row: 1, column: 20 } };

  const ws2 = wb.addWorksheet('סיכום');
  ws2.addRow(['ביטחון GPS', 'כמות לקוחות']);
  ws2.getRow(1).font = { bold: true };
  ws2.addRow(['\u{1F3C6} 3/3 חפיפה מלאה', s3]);
  ws2.addRow(['✅ 2/3 חפיפה', s2]);
  ws2.addRow(['⚠️ 2+ חברות אך GPS שונה', sX]);
  ws2.addRow(['\u{1F4CD} חברה אחת בלבד', s1]);
  ws2.addRow([]);
  ws2.addRow(['סה"כ', rows.length]);
  ws2.columns = [{ width: 30 }, { width: 16 }];

  const xlsxOut = path.join(DIR, 'gps-cross-company.xlsx');
  await wb.xlsx.writeFile(xlsxOut);
  console.log(`\nSaved Excel: ${xlsxOut}`);

  // ── JSON for map ─────────────────────────────────────────────────────────────
  const jsonRows = rows
    .filter(r => r.consensusLat && r.consensusLng)
    .map(r => ({
      cust:    r.cust,
      sources: r.sources,
      count:   r.companyCount,
      orders:  r.totalOrders,
      lat:     r.consensusLat,
      lng:     r.consensusLng,
      match:   r.consensusMatch,
      distFI:  r.distFI || null,
      distFN:  r.distFN || null,
      distIN:  r.distIN || null,
      formLat: r.formLat || null, formLng: r.formLng || null,
      iceLat:  r.iceLat  || null, iceLng:  r.iceLng  || null,
      interLat:r.interLat|| null, interLng:r.interLng || null,
    }));

  const jsonOut = path.join(DIR, 'priority-gps-cross.json');
  fs.writeFileSync(jsonOut, JSON.stringify(jsonRows));
  console.log(`Saved JSON: ${jsonOut} (${jsonRows.length} clients)`);

  // Also copy JSON to docs/ for web serving
  const docsCopy = path.join(__dirname, '../docs/priority-gps-cross.json');
  fs.copyFileSync(jsonOut, docsCopy);
  console.log(`Copied to: ${docsCopy}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
