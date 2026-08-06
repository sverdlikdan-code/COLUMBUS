/**
 * GPS Source Comparison — полное сравнение всех источников GPS
 * Tablet (ORDERSB) vs PBI (CUSTOMERS) vs AI Google vs ручные правки
 * Выявляет клиентов где агенты работают по телефону (разброс GPS)
 */
const fs   = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const DIR  = path.join(ROOT, 'ATA GPS FROM ORDERS');

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function loadJson(p) {
  if (!fs.existsSync(p)) { console.warn('Missing:', p); return null; }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function main() {
  const tabletArr  = loadJson(path.join(ROOT, 'docs/priority-gps-cross.json')) || [];
  const pbiMap     = loadJson(path.join(ROOT, 'docs/gps-lookup.json'))          || {};
  const googleMap  = loadJson(path.join(ROOT, 'docs/google-gps.json'))           || {};
  const corrMap    = loadJson(path.join(ROOT, 'docs/gps-corrections.json'))      || {};

  console.log(`Tablet GPS: ${tabletArr.length} | PBI: ${Object.keys(pbiMap).length} | Google: ${Object.keys(googleMap).length} | Corrections: ${Object.keys(corrMap).length}`);

  // Build tablet map
  const tabletMap = {};
  tabletArr.forEach(r => { tabletMap[String(r.cust)] = r; });

  // All unique custIds
  const allIds = new Set([
    ...Object.keys(tabletMap),
    ...Object.keys(pbiMap),
    ...Object.keys(googleMap),
    ...Object.keys(corrMap),
  ]);
  console.log(`Total unique clients: ${allIds.size}`);

  const rows = [];

  for (const cust of allIds) {
    const t = tabletMap[cust];
    const p = pbiMap[cust];
    const g = googleMap[cust];
    const c = corrMap[cust];

    const tLat = t?.lat   || null;
    const tLng = t?.lng   || null;
    const pLat = p?.lat   || null;
    const pLng = p?.lng   || null;
    const gLat = g?.aiLat || null;
    const gLng = g?.aiLng || null;
    const cLat = c?.lat   || null;
    const cLng = c?.lng   || null;

    const distTP = tLat && pLat ? haversine(tLat, tLng, pLat, pLng) : null;
    const distTG = tLat && gLat ? haversine(tLat, tLng, gLat, gLng) : null;
    const distPG = pLat && gLat ? haversine(pLat, pLng, gLat, gLng) : null;

    // Best reference = correction > google > pbi
    const refLat = cLat || gLat || pLat;
    const refLng = cLng || gLng || pLng;
    const refSource = cLat ? 'תיקון' : gLat ? 'Google AI' : pLat ? 'PBI' : null;
    const distVsRef = tLat && refLat ? haversine(tLat, tLng, refLat, refLng) : null;

    // GPS scatter verdict — main signal for "phone orders"
    const clusterRatio  = t?.clusterRatio  ?? null;
    const clusterOrders = t?.clusterOrders ?? null;
    const totalOrders   = t?.orders        ?? null;
    const agentMatch    = t?.match         ?? null;
    const sources       = t?.sources       ?? null;

    let phoneVerdict = '—';
    if (tLat) {
      if (clusterRatio !== null && clusterRatio < 50 && totalOrders >= 5) {
        phoneVerdict = '📞 בטלפון — GPS מפוזר';
      } else if (distVsRef !== null && distVsRef > 1000 && agentMatch < 2) {
        phoneVerdict = '⚠️ שונה מהייחוס >1ק"מ';
      } else if (clusterRatio !== null && clusterRatio < 75 && totalOrders >= 5) {
        phoneVerdict = '🟡 GPS חלקי';
      } else {
        phoneVerdict = '✅ GPS יציב';
      }
    } else if (refLat) {
      phoneVerdict = '🔵 אין ב-Tablet';
    }

    rows.push({
      cust,
      tLat:  tLat  ? +tLat.toFixed(6)  : '',
      tLng:  tLng  ? +tLng.toFixed(6)  : '',
      pLat:  pLat  ? +pLat.toFixed(6)  : '',
      pLng:  pLng  ? +pLng.toFixed(6)  : '',
      gLat:  gLat  ? +gLat.toFixed(6)  : '',
      gLng:  gLng  ? +gLng.toFixed(6)  : '',
      cLat:  cLat  ? +cLat.toFixed(6)  : '',
      cLng:  cLng  ? +cLng.toFixed(6)  : '',
      distTP: distTP ?? '',
      distTG: distTG ?? '',
      distPG: distPG ?? '',
      distVsRef: distVsRef ?? '',
      refSource: refSource || '',
      sources:      sources  || '',
      agentMatch:   agentMatch ?? '',
      totalOrders:  totalOrders ?? '',
      clusterOrders:clusterOrders ?? '',
      clusterRatio: clusterRatio !== null ? clusterRatio + '%' : '',
      phoneVerdict,
    });
  }

  // Sort: phone-verdict first (most problematic at top), then by totalOrders desc
  const verdictOrder = { '📞 בטלפון — GPS מפוזר': 0, '⚠️ שונה מהייחוס >1ק"מ': 1, '🟡 GPS חלקי': 2, '✅ GPS יציב': 3, '🔵 אין ב-Tablet': 4, '—': 5 };
  rows.sort((a, b) => {
    const va = verdictOrder[a.phoneVerdict] ?? 9;
    const vb = verdictOrder[b.phoneVerdict] ?? 9;
    return va - vb || (b.totalOrders || 0) - (a.totalOrders || 0);
  });

  // ── Stats ──────────────────────────────────────────────────────────────────
  const phone     = rows.filter(r => r.phoneVerdict === '📞 בטלפון — GPS מפוזר').length;
  const diff      = rows.filter(r => r.phoneVerdict === '⚠️ שונה מהייחוס >1ק"מ').length;
  const partial   = rows.filter(r => r.phoneVerdict === '🟡 GPS חלקי').length;
  const stable    = rows.filter(r => r.phoneVerdict === '✅ GPS יציב').length;
  const noTablet  = rows.filter(r => r.phoneVerdict === '🔵 אין ב-Tablet').length;
  console.log(`\n📞 Phone GPS: ${phone} | ⚠️ Diff >1km: ${diff} | 🟡 Partial: ${partial} | ✅ Stable: ${stable} | 🔵 No tablet: ${noTablet}`);

  // ── Excel ──────────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('השוואת GPS', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'מס. לקוח',           key: 'cust',         width: 12 },
    { header: 'Tablet Lat',          key: 'tLat',         width: 13 },
    { header: 'Tablet Lng',          key: 'tLng',         width: 13 },
    { header: 'PBI Lat',             key: 'pLat',         width: 13 },
    { header: 'PBI Lng',             key: 'pLng',         width: 13 },
    { header: 'Google Lat',          key: 'gLat',         width: 13 },
    { header: 'Google Lng',          key: 'gLng',         width: 13 },
    { header: 'תיקון Lat',           key: 'cLat',         width: 13 },
    { header: 'תיקון Lng',           key: 'cLng',         width: 13 },
    { header: "Tablet↔PBI (מ')",     key: 'distTP',       width: 14 },
    { header: "Tablet↔Google (מ')",  key: 'distTG',       width: 15 },
    { header: "PBI↔Google (מ')",     key: 'distPG',       width: 14 },
    { header: "Tablet↔ייחוס (מ')",  key: 'distVsRef',    width: 15 },
    { header: 'ייחוס',              key: 'refSource',     width: 11 },
    { header: 'מקורות Tablet',       key: 'sources',       width: 14 },
    { header: 'סוכנים עצמ.',        key: 'agentMatch',    width: 12 },
    { header: 'הזמנות סה"כ',        key: 'totalOrders',   width: 12 },
    { header: 'הזמנות בקלאסטר',     key: 'clusterOrders', width: 15 },
    { header: '% GPS יציב',         key: 'clusterRatio',  width: 12 },
    { header: 'ניתוח GPS',           key: 'phoneVerdict',  width: 26 },
  ];

  ws.getRow(1).eachCell(cell => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3F7C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  ws.getRow(1).height = 22;

  const F = {
    RED:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } },
    ORANGE: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } },
    YELLOW: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } },
    GREEN:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } },
    BLUE:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } },
    W:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
    GR:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } },
  };

  rows.forEach((r, i) => {
    const row = ws.addRow([
      r.cust, r.tLat, r.tLng, r.pLat, r.pLng, r.gLat, r.gLng, r.cLat, r.cLng,
      r.distTP, r.distTG, r.distPG, r.distVsRef, r.refSource,
      r.sources, r.agentMatch, r.totalOrders, r.clusterOrders, r.clusterRatio,
      r.phoneVerdict,
    ]);
    const fill =
      r.phoneVerdict.startsWith('📞') ? F.RED :
      r.phoneVerdict.startsWith('⚠️') ? F.ORANGE :
      r.phoneVerdict.startsWith('🟡') ? F.YELLOW :
      r.phoneVerdict.startsWith('✅') ? F.GREEN :
      r.phoneVerdict.startsWith('🔵') ? F.BLUE :
      i % 2 === 0 ? F.W : F.GR;
    row.eachCell(cell => { cell.fill = fill; });
  });

  ws.autoFilter = { from: 'A1', to: { row: 1, column: 20 } };

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('סיכום');
  ws2.columns = [{ width: 36 }, { width: 14 }];
  ws2.addRow(['קטגוריה', 'לקוחות']).font = { bold: true };
  ws2.addRow(['📞 GPS מפוזר — עבודה בטלפון', phone]);
  ws2.addRow(['⚠️ Tablet שונה מייחוס >1ק"מ', diff]);
  ws2.addRow(['🟡 GPS חלקי (50-75% בקלאסטר)', partial]);
  ws2.addRow(['✅ GPS יציב', stable]);
  ws2.addRow(['🔵 אין נתוני Tablet', noTablet]);
  ws2.addRow([]);
  ws2.addRow(['סה"כ לקוחות', allIds.size]);

  const out = path.join(DIR, 'gps-source-compare.xlsx');
  await wb.xlsx.writeFile(out);
  console.log(`\nSaved: ${out}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
