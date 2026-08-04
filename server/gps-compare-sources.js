/**
 * GPS Source Comparison: Priority (tablet orders) vs Google AI vs GPS Corrections
 * Output: ATA GPS FROM ORDERS/gps-source-compare.xlsx
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

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) { console.warn('Missing:', filePath); return null; }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function main() {
  // ── Load sources ───────────────────────────────────────────────────────────
  const priorityArr  = loadJson(path.join(ROOT, 'docs/priority-gps-cross.json')) || [];
  const googleRaw    = loadJson(path.join(ROOT, 'docs/google-gps.json')) || {};
  const corrections  = loadJson(path.join(ROOT, 'docs/gps-corrections.json')) || {};

  console.log(`Priority GPS: ${priorityArr.length} clients`);
  console.log(`Google AI GPS: ${Object.keys(googleRaw).length} clients`);
  console.log(`GPS Corrections: ${Object.keys(corrections).length} clients`);

  // ── Build priority map ─────────────────────────────────────────────────────
  const priorityMap = {};
  priorityArr.forEach(r => { priorityMap[String(r.cust)] = r; });

  // ── All unique custIds across all sources ──────────────────────────────────
  const allIds = new Set([
    ...Object.keys(priorityMap),
    ...Object.keys(googleRaw),
    ...Object.keys(corrections),
  ]);
  console.log(`Total unique clients: ${allIds.size}`);

  const rows = [];

  for (const cust of allIds) {
    const p = priorityMap[cust];
    const g = googleRaw[cust];
    const c = corrections[cust];

    const pLat = p?.lat  || null;
    const pLng = p?.lng  || null;
    const gLat = g?.aiLat || null;
    const gLng = g?.aiLng || null;
    const cLat = c?.lat  || null;
    const cLng = c?.lng  || null;

    // Distances
    const distPG = (pLat&&gLat) ? haversine(pLat,pLng,gLat,gLng) : null;
    const distPC = (pLat&&cLat) ? haversine(pLat,pLng,cLat,cLng) : null;
    const distGC = (gLat&&cLat) ? haversine(gLat,gLng,cLat,cLng) : null;

    // Assessment: Priority vs best available
    const bestRefLat = cLat || gLat;
    const bestRefLng = cLng || gLng;
    const distVsBest = (pLat&&bestRefLat) ? haversine(pLat,pLng,bestRefLat,bestRefLng) : null;

    let verdict = '—';
    if (pLat && bestRefLat) {
      if (distVsBest < 100)       verdict = '✅ מעולה (<100מ)';
      else if (distVsBest < 500)  verdict = '👍 טוב (<500מ)';
      else if (distVsBest < 2000) verdict = '⚠️ סביר (<2ק"מ)';
      else                        verdict = '❌ שונה (>2ק"מ)';
    } else if (pLat && !bestRefLat) {
      verdict = '📱 רק Tablet';
    } else if (!pLat && bestRefLat) {
      verdict = '🔵 אין ב-Tablet';
    }

    // Priority match confidence
    const matchLabel = !p ? '—' :
      p.match === 3 ? '3/3' :
      p.match === 2 ? '2/3' :
      (p.count||1) >= 2 ? '2+ שונה' : '1 חברה';

    rows.push({
      cust,
      pLat:  pLat  ? +pLat.toFixed(6)  : '',
      pLng:  pLng  ? +pLng.toFixed(6)  : '',
      pMatch: matchLabel,
      pSources: p?.sources || '',
      pOrders: p?.orders || '',
      gLat:  gLat  ? +gLat.toFixed(6)  : '',
      gLng:  gLng  ? +gLng.toFixed(6)  : '',
      cLat:  cLat  ? +cLat.toFixed(6)  : '',
      cLng:  cLng  ? +cLng.toFixed(6)  : '',
      distPG: distPG ?? '',
      distPC: distPC ?? '',
      distGC: distGC ?? '',
      distVsBest: distVsBest ?? '',
      verdict,
    });
  }

  // Sort: biggest difference first (most interesting)
  rows.sort((a, b) => {
    const va = typeof a.distVsBest === 'number' ? a.distVsBest : -1;
    const vb = typeof b.distVsBest === 'number' ? b.distVsBest : -1;
    return vb - va;
  });

  // ── Stats ──────────────────────────────────────────────────────────────────
  const withBoth   = rows.filter(r => r.pLat && (r.gLat || r.cLat));
  const excellent  = withBoth.filter(r => r.distVsBest < 100).length;
  const good       = withBoth.filter(r => r.distVsBest >= 100 && r.distVsBest < 500).length;
  const ok         = withBoth.filter(r => r.distVsBest >= 500 && r.distVsBest < 2000).length;
  const diff       = withBoth.filter(r => r.distVsBest >= 2000).length;
  const tabletOnly = rows.filter(r => r.pLat && !r.gLat && !r.cLat).length;
  const noTablet   = rows.filter(r => !r.pLat && (r.gLat || r.cLat)).length;

  console.log(`\n✅ <100מ: ${excellent} | 👍 <500מ: ${good} | ⚠️ <2km: ${ok} | ❌ >2km: ${diff}`);
  console.log(`📱 Tablet only: ${tabletOnly} | 🔵 No tablet: ${noTablet}`);

  // ── Excel ──────────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('השוואת GPS', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'מס. לקוח',         key: 'cust',        width: 12 },
    { header: 'Tablet Lat',        key: 'pLat',        width: 13 },
    { header: 'Tablet Lng',        key: 'pLng',        width: 13 },
    { header: 'Tablet חפיפה',     key: 'pMatch',       width: 10 },
    { header: 'Tablet מקורות',    key: 'pSources',     width: 14 },
    { header: 'Tablet הזמנות',    key: 'pOrders',      width: 10 },
    { header: 'AI Google Lat',     key: 'gLat',        width: 13 },
    { header: 'AI Google Lng',     key: 'gLng',        width: 13 },
    { header: 'תיקון ידני Lat',   key: 'cLat',        width: 13 },
    { header: 'תיקון ידני Lng',   key: 'cLng',        width: 13 },
    { header: "Tablet↔AI (מ')",   key: 'distPG',      width: 13 },
    { header: "Tablet↔תיקון (מ')", key: 'distPC',     width: 14 },
    { header: "AI↔תיקון (מ')",    key: 'distGC',      width: 13 },
    { header: "Tablet↔עדיף (מ')", key: 'distVsBest',  width: 14 },
    { header: 'הערכה',            key: 'verdict',      width: 20 },
  ];

  ws.getRow(1).eachCell(cell => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3F7C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  ws.getRow(1).height = 22;

  const FILLS = {
    GREEN:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } },
    LIME:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8E9' } },
    ORANGE: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } },
    RED:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } },
    BLUE:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } },
    GRAY:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } },
    WHITE:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
  };

  rows.forEach((r, i) => {
    const row = ws.addRow([
      r.cust, r.pLat, r.pLng, r.pMatch, r.pSources, r.pOrders,
      r.gLat, r.gLng, r.cLat, r.cLng,
      r.distPG, r.distPC, r.distGC, r.distVsBest,
      r.verdict,
    ]);
    const fill =
      r.verdict.startsWith('✅') ? FILLS.GREEN :
      r.verdict.startsWith('👍') ? FILLS.LIME  :
      r.verdict.startsWith('⚠️') ? FILLS.ORANGE:
      r.verdict.startsWith('❌') ? FILLS.RED   :
      r.verdict.startsWith('📱') ? FILLS.BLUE  :
      i % 2 === 0 ? FILLS.WHITE : FILLS.GRAY;
    row.eachCell(cell => { cell.fill = fill; });
  });

  ws.autoFilter = { from: 'A1', to: { row: 1, column: 15 } };

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('סיכום');
  ws2.addRow(['קטגוריה', 'לקוחות']);
  ws2.getRow(1).font = { bold: true };
  ws2.addRow(['✅ מעולה — Tablet vs עדיף <100מ', excellent]);
  ws2.addRow(['👍 טוב — <500מ', good]);
  ws2.addRow(['⚠️ סביר — <2ק"מ', ok]);
  ws2.addRow(['❌ שונה — >2ק"מ', diff]);
  ws2.addRow(['📱 רק ב-Tablet (אין AI/תיקון)', tabletOnly]);
  ws2.addRow(['🔵 אין ב-Tablet (יש AI/תיקון)', noTablet]);
  ws2.addRow([]);
  ws2.addRow(['סה"כ לקוחות', allIds.size]);
  ws2.addRow(['לקוחות עם שני מקורות', withBoth.length]);
  ws2.columns = [{ width: 35 }, { width: 14 }];

  const out = path.join(DIR, 'gps-source-compare.xlsx');
  await wb.xlsx.writeFile(out);
  console.log(`\nSaved: ${out}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
