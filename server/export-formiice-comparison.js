/**
 * export-formiice-comparison.js — сравнение "грязного" адреса (משטח) с адресом
 * из 'לקוחות FORM+I+INT' (ICE) по номеру клиента (мס. לקוח).
 * Запуск: node server/export-formiice-comparison.js
 * Результат: Desktop/formiice-comparison-YYYY-MM-DD.xlsx
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const ExcelJS = require('exceljs');
const { executeDax } = require('./powerbi');

// Power BI (Priority ERP) delivers Hebrew text wrapped in LRO/RLO BiDi marks,
// with characters (and digit runs) in visual order (reversed). Strip marks,
// then un-reverse words and digit runs back to logical order.
const BIDI_TEST  = /[‎‏‪-‮]/;
const BIDI_STRIP = /[‎‏‪-‮]/g;
function fixBiDi(raw) {
  if (!raw) return '';
  const hasBidi = BIDI_TEST.test(raw);
  const s = raw.replace(BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  const fixed = s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('').replace(/\d+/g, m => m.split('').reverse().join('')) : w)
    .join(' ');
  return fixed.replace(/\(/g, '\x01').replace(/\)/g, '(').replace(/\x01/g, ')');
}

function normAddr(s) {
  return (s || '')
    .replace(/[,\.\s]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();
}

const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

// Heuristic "how clean is this address" score. Each flag is a concrete,
// checkable reason a geocoder would struggle with this string — not a vague
// guess. hasAnyGPS comes from the data (does ANY source already have valid
// coords for this custId), since an address nobody could ever geocode is the
// strongest real-world signal of "garbage", regardless of how it reads.
function assessGarbage(address, hasAnyGPS) {
  const a = (address || '').trim();
  const reasons = [];
  let score = 0;

  if (!a) { reasons.push('כתובת ריקה'); score += 6; }
  if (a && !/\d/.test(a)) { reasons.push('אין מספר בית'); score += 3; }
  if (/(^|\s)ת['"]?\.?\s+ד['"]?\.?\s*\d*(\s|$)/.test(a)) { reasons.push('תא דואר — לא ניתן לאיתור גיאוגרפי'); score += 5; }
  if (a && a.length < 4) { reasons.push('כתובת קצרה מאוד'); score += 2; }
  if (a.split(',').length > 2) { reasons.push('כמה חלקי כתובת מאוחדים בפסיקים'); score += 3; }
  else if (a.split(',').length === 2) { reasons.push('כתובת מורכבת — תיאור נוסף אחרי פסיק'); score += 3; }
  if (/^(מרכז|שכונת|אזור)\s/.test(a) && !/\d/.test(a)) { reasons.push('תיאור אזור כללי בלבד'); score += 2; }
  if (!hasAnyGPS) { reasons.push('אין GPS תקין באף מקור (משטח/ICE)'); score += 4; }

  let level;
  if (score >= 6) level = 'GARBAGE';
  else if (score >= 3) level = 'SUSPECT';
  else level = 'CLEAN';

  return { level, reasons: reasons.join('; '), score };
}

async function main() {
  console.log('Querying משטח (dirty addresses)...');
  const dirtyRows = await executeDax(`
EVALUATE
SUMMARIZE(
  FILTER('משטח', 'משטח'[סטטוס] = "פעיל"),
  'משטח'[מס. לקוח],
  'משטח'[שם לקוח],
  'משטח'[עיר],
  'משטח'[כתובת],
  'משטח'[קו רוחב],
  'משטח'[קו אורך],
  'משטח'[סוכן],
  'משטח'[שם סוכן]
)
ORDER BY 'משטח'[מס. לקוח] ASC
  `);

  const dirty = dirtyRows.map(r => ({
    custId:    String(r['משטח[מס. לקוח]']),
    custName:  fixBiDi(r['משטח[שם לקוח]'] || ''),
    city:      fixBiDi(r['משטח[עיר]']     || ''),
    address:   fixBiDi(r['משטח[כתובת]']   || ''),
    pbiLat:    r['משטח[קו רוחב]']  || null,
    pbiLng:    r['משטח[קו אורך]']  || null,
    agentCode: r['משטח[סוכן]']     || '',
    agentName: fixBiDi(r['משטח[שם סוכן]'] || ''),
  })).filter(c => c.agentName.trim() !== '' && c.agentName !== 'כללי - פורמולה');
  console.log(`Active clients (משטח): ${dirty.length}`);

  console.log('Querying לקוחות FORM+I+INT (ICE reference)...');
  const iceRows = await executeDax(`
EVALUATE
SELECTCOLUMNS('לקוחות FORM+I+INT',
  "id",   'לקוחות FORM+I+INT'[מס. לקוח],
  "name", 'לקוחות FORM+I+INT'[שם לקוח],
  "city", 'לקוחות FORM+I+INT'[עיר],
  "addr", 'לקוחות FORM+I+INT'[כתובת],
  "lat",  'לקוחות FORM+I+INT'[קו רוחב],
  "lng",  'לקוחות FORM+I+INT'[קו אורך]
)
  `);

  // Multiple rows per custId exist (duplicates) — prefer the row with valid GPS
  const iceByCustId = new Map();
  for (const r of iceRows) {
    const id = String(r['[id]']);
    if (!id) continue;
    const lat = parseFloat(r['[lat]']);
    const lng = parseFloat(r['[lng]']);
    const cand = {
      name: fixBiDi(r['[name]'] || ''),
      city: fixBiDi(r['[city]'] || ''),
      addr: fixBiDi(r['[addr]'] || ''),
      lat: isValidIL(lat, lng) ? lat : null,
      lng: isValidIL(lat, lng) ? lng : null,
    };
    const existing = iceByCustId.get(id);
    if (!existing) { iceByCustId.set(id, cand); continue; }
    // upgrade to a row with GPS if the stored one doesn't have it yet
    if (!existing.lat && cand.lat) iceByCustId.set(id, cand);
  }
  console.log(`ICE reference rows: ${iceRows.length} (${iceByCustId.size} unique custId)`);

  // ── Compare ───────────────────────────────────────────────────────────────
  const compared = dirty.map(c => {
    const ice = iceByCustId.get(c.custId) || null;
    const addrMatch = ice ? normAddr(c.address) === normAddr(ice.addr) : null;
    const cityMatch = ice ? normAddr(c.city) === normAddr(ice.city) : null;

    let status;
    if (!ice) status = 'אין ב-ICE';
    else if (addrMatch && cityMatch) status = 'תואם';
    else if (!isValidIL(c.pbiLat, c.pbiLng) && isValidIL(ice.lat, ice.lng)) status = 'ICE GPS תקין';
    else status = 'כתובת שונה';

    const hasAnyGPS = isValidIL(c.pbiLat, c.pbiLng) || (ice && isValidIL(ice.lat, ice.lng));
    const garbage = assessGarbage(c.address, hasAnyGPS);

    return {
      custId:      c.custId,
      custName:    c.custName,
      city:        c.city,
      address:     c.address,
      pbiLat:      c.pbiLat,
      pbiLng:      c.pbiLng,
      iceCity:     ice ? ice.city : '',
      iceAddr:     ice ? ice.addr : '',
      iceLat:      ice ? ice.lat  : '',
      iceLng:      ice ? ice.lng  : '',
      status,
      garbageLevel: garbage.level,
      garbageScore: garbage.score,
      garbageWhy:   garbage.reasons,
      agentCode:   c.agentCode,
      agentName:   c.agentName,
    };
  });

  const cnt = {
    match:    compared.filter(r => r.status === 'תואם').length,
    gpsFix:   compared.filter(r => r.status === 'ICE GPS תקין').length,
    diff:     compared.filter(r => r.status === 'כתובת שונה').length,
    missing:  compared.filter(r => r.status === 'אין ב-ICE').length,
  };
  console.log(`תואם: ${cnt.match} | ICE GPS תקין: ${cnt.gpsFix} | כתובת שונה: ${cnt.diff} | אין ב-ICE: ${cnt.missing}`);

  const gCnt = {
    garbage: compared.filter(r => r.garbageLevel === 'GARBAGE').length,
    suspect: compared.filter(r => r.garbageLevel === 'SUSPECT').length,
    clean:   compared.filter(r => r.garbageLevel === 'CLEAN').length,
  };
  console.log(`GARBAGE: ${gCnt.garbage} | SUSPECT: ${gCnt.suspect} | CLEAN: ${gCnt.clean}`);

  // ── Write Excel ──────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('FORM+I+INT Comparison');
  ws.views = [{ rightToLeft: true }];

  ws.columns = [
    { header: 'מס. לקוח',         key: 'custId',    width: 12 },
    { header: 'שם לקוח',          key: 'custName',  width: 32 },
    { header: 'עיר (משטח)',       key: 'city',      width: 14 },
    { header: 'כתובת (משטח)',     key: 'address',   width: 30 },
    { header: 'קו רוחב (משטח)',   key: 'pbiLat',    width: 14 },
    { header: 'קו אורך (משטח)',   key: 'pbiLng',    width: 14 },
    { header: 'עיר (ICE)',        key: 'iceCity',   width: 14 },
    { header: 'כתובת (ICE)',      key: 'iceAddr',   width: 30 },
    { header: 'קו רוחב (ICE)',    key: 'iceLat',    width: 14 },
    { header: 'קו אורך (ICE)',    key: 'iceLng',    width: 14 },
    { header: 'סטטוס השוואה',     key: 'status',       width: 16 },
    { header: 'ניקיון כתובת',     key: 'garbageLevel', width: 14 },
    { header: 'ציון',             key: 'garbageScore', width: 8  },
    { header: 'סיבה',             key: 'garbageWhy',   width: 36 },
    { header: 'קוד סוכן',         key: 'agentCode',    width: 12 },
    { header: 'שם סוכן',          key: 'agentName',    width: 22 },
  ];

  ws.getRow(1).eachCell(cell => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3F7C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = { bottom: { style: 'medium', color: { argb: 'FFC9A84C' } } };
  });
  ws.getRow(1).height = 24;

  const statusFill = {
    'תואם':         'FF1B5E20',
    'ICE GPS תקין':  'FF0D47A1',
    'כתובת שונה':    'FFB71C1C',
    'אין ב-ICE':     'FF616161',
  };

  const garbageFill = {
    'GARBAGE': 'FFB71C1C',
    'SUSPECT': 'FFFF8F00',
    'CLEAN':   'FF1B5E20',
  };

  for (const row of compared) {
    const r = ws.addRow(row);
    const bg = statusFill[row.status];
    if (bg) {
      r.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      r.getCell('status').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    }
    const gbg = garbageFill[row.garbageLevel];
    if (gbg) {
      r.getCell('garbageLevel').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gbg } };
      r.getCell('garbageLevel').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    }
    r.eachCell(cell => { cell.alignment = { vertical: 'middle' }; });
  }

  ws.autoFilter  = { from: 'A1', to: `O${compared.length + 1}` };
  ws.views[0].state  = 'frozen';
  ws.views[0].ySplit = 1;

  const today   = new Date().toISOString().slice(0, 10);
  const outPath = `C:\\Users\\d.sverdlik\\Desktop\\formiice-comparison-${today}.xlsx`;
  await wb.xlsx.writeFile(outPath);

  console.log(`\n✓ Saved: ${outPath}`);
  console.log(`  Total rows: ${compared.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
