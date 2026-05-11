/**
 * MAHSAN PLANOGRAM BUILDER
 * Клонирует MAHSAN 8.xlsx (3 листа), заменяет числа-пики на данные товара.
 * Сохраняет точную компоновку оригинала.
 */
const ExcelJS = require('exceljs');
const { fetchKapuaFromBI, fetchLastRefresh } = require('./pbi-kapua');
const { fetchExtraSheets }   = require('./pbi-extra-sheets');

// ─── Family colors (ARGB) ─────────────────────────────────────────────────
const FAM_COLORS = {
  'חמאה FERMA':       'FFFFFAD5',
  'חמאה רושן':        'FFFFFCC0',
  'ממרחי חמאה':       'FFFFFAB0',
  'בלינצס':           'FFD4E8FF',
  'כיסונים':          'FFE8D5F5',
  'בצק':              'FFFFF0CC',
  'עלי בלינצס':       'FFD5F0D5',
  'SANTA BREMOR':     'FFD5EAF5',
  'חטיף גבינה':       'FFFFFF9A',
  'עוגות רושן':       'FFFFD5D5',
  'עוגות מוזיקה':     'FFD5FFD5',
  'מוסדי':            'FFFFDEA0',
  'VALESTA':          'FFC8C8FF',
  'SANTA BREMOR דגים':'FFD0F0FF',
  'PRESIDENT':        'FFFCE4EC',
  'SVALIA תנמש':      'FFE3F2FD',
  'SVALIA גורובט':    'FFF3E5F5',
  'SVALIA תוסורפ':    'FFF1F8E9',
  'SVALIA הניבג':     'FFFFF8E1',
  'NORD PORT':        'FFE0F7FA',
  'NORD PORT מצונן': 'FFB2DFEE',
  'SANTA BREMOR Fish':'FFFFE0B2',
  'EMPTY':            'FFF5F5F5',
};
function famColor(fam) {
  if(!fam) return 'FFFFFFFF';
  for(const k of Object.keys(FAM_COLORS))
    if(fam.includes(k)) return FAM_COLORS[k];
  return 'FFE0E0E0';
}

// ─── Visual-order → logical Unicode for Hebrew (legacy DB encoding) ──────
// Source stores Hebrew in visual RTL order (first byte = leftmost visual char).
// Fix: reverse entire string → Hebrew words become logical; then reverse back
// any ASCII-only runs so numbers/parens are not corrupted (180 not 081).
function fixVisualRTL(s) {
  const full = s.split('').reverse().join('');
  return full.replace(/[\x20-\x7E]+/g, m => m.split('').reverse().join(''));
}

// ─── Percentile threshold helper ─────────────────────────────────────────
// pct=0.7 → top 30% (above 70th pct) | pct=0.5 → top 50% (above median)
function percentileThreshold(values, pct) {
  const sorted = values.filter(v => v != null && v > 0).sort((a,b) => a-b);
  if(!sorted.length) return Infinity;
  return sorted[Math.floor(sorted.length * pct)];
}

// ─── Apply product info to a cell ────────────────────────────────────────
// kratnost: cartons/pallet | daySales: avg daily cartons from BI
// dayThreshHigh: top-30% threshold (★) | dayThreshMid: top-50% threshold (☆)
// pakuot: [{date, daysLeft, cartons}]
function fillCell(cell, pick, makat, fam, dayAvg, daySales, ss, stock, weight, desc, weightThresh, dayThreshHigh, dayThreshMid, kratnost, pctOfTotal, pakuot) {
  const kg   = weight != null ? (+weight).toFixed(2) : '—';
  const name = desc ? fixVisualRTL(String(desc).replace(/[​-‏‪-‮﻿]/g,'').trim()) : '';

  // Stars based on daySales PAL/d (BI live data); fallback to dayAvg if no daySales
  const palDay      = (daySales != null && kratnost > 0) ? daySales / kratnost
                    : (daySales != null)                  ? daySales
                    : dayAvg;
  const isTopStar   = palDay != null && dayThreshHigh != null && palDay >= dayThreshHigh;
  const isMidStar   = !isTopStar && palDay != null && dayThreshMid != null && palDay >= dayThreshMid;
  const isHeavy     = weight != null && weightThresh != null && weight >= weightThresh;

  const base = { size:8, name:'Arial' };
  const rt   = [];

  // Line 1: pick number
  rt.push({ text: `#${pick}\n`, font: base });

  // Line 2 (optional): stars + heavy icon
  if(isTopStar || isMidStar || isHeavy) {
    if(isTopStar) rt.push({ text: '🏅 ', font: { size:14, name:'Segoe UI Emoji' } });
    if(isMidStar) rt.push({ text: '⭐ ', font: { size:12, name:'Segoe UI Emoji' } });
    if(isHeavy)   rt.push({ text: '🏋️ ', font: { size:12, name:'Segoe UI Emoji' } });
    rt.push({ text: '\n', font: base });
  }

  // makat
  rt.push({ text: `${makat}\n`, font: base });
  // product name — bigger + bold
  rt.push({ text: `${name}\n`, font: { size:10, bold:true, name:'Arial' } });
  // ── separator after product name ──────────────────────────────────────────
  rt.push({ text: `────────────────────\n`, font: { size:6, name:'Arial', color:{ argb:'FFBBBBBB' } } });

  // AVG/d line: average daily cartons + pallets
  if(daySales != null) {
    const kartStr = daySales.toFixed(1);
    if(kratnost > 0) {
      rt.push({ text: `AVG/d: ${kartStr} קרט | ${(daySales/kratnost).toFixed(1)} PAL\n`, font: { ...base, bold:true } });
    } else {
      rt.push({ text: `AVG/d: ${kartStr} קרט\n`, font: { ...base, bold:true, color:{ argb:'FF884400' } } });
    }
  }

  // KG line
  rt.push({ text: `KG: ${kg}\n`, font: base });

  // ── מלאי in frame ─────────────────────────────────────────────────────────
  if(stock != null && kratnost > 0) {
    const palVal = Math.round(stock / kratnost);
    if(palVal === 0) {
      rt.push({ text: `╔══════════════╗\n`, font: { size:7, name:'Courier New', color:{ argb:'FFCC0000' } } });
      rt.push({ text: `  מלאי: 0 PAL  \n`, font: { size:10, bold:true, name:'Arial', color:{ argb:'FFCC0000' } } });
      rt.push({ text: `╚══════════════╝\n`, font: { size:7, name:'Courier New', color:{ argb:'FFCC0000' } } });
    } else {
      rt.push({ text: `╔══════════════╗\n`, font: { size:7, name:'Courier New', color:{ argb:'FF003399' } } });
      rt.push({ text: `  מלאי: ${palVal} PAL  \n`, font: { size:10, bold:true, name:'Arial', color:{ argb:'FF003399' } } });
      rt.push({ text: `╚══════════════╝\n`, font: { size:7, name:'Courier New', color:{ argb:'FF003399' } } });
    }
  } else if(stock != null) {
    rt.push({ text: `╔══════════════╗\n`, font: { size:7, name:'Courier New', color:{ argb:'FFCC0000' } } });
    rt.push({ text: `  מלאי: ${Math.round(stock)} קרט  \n`, font: { size:10, bold:true, name:'Arial', color:{ argb:'FFCC0000' } } });
    rt.push({ text: `╚══════════════╝\n`, font: { size:7, name:'Courier New', color:{ argb:'FFCC0000' } } });
  }

  // ── פק"ע lines: each batch on its own line, RED if danger ─────────────────
  if(pakuot && pakuot.length > 0) {
    for(const pak of pakuot) {
      const dateStr = pak.date
        ? `${pak.date.getDate().toString().padStart(2,'0')}/${(pak.date.getMonth()+1).toString().padStart(2,'0')}/${String(pak.date.getFullYear()).slice(-2)}`
        : '—';
      const dStr    = pak.daysLeft != null ? `${pak.daysLeft}d` : '?';
      const sellDays = (daySales && daySales > 0 && pak.cartons > 0) ? pak.cartons / daySales : Infinity;
      const isDanger = pak.daysLeft != null && pak.daysLeft < sellDays;
      if(isDanger) {
        rt.push({ text: `⚡ DANGER  `, font: { bold:true, size:8, name:'Segoe UI Emoji', color:{ argb:'FFCC0000' } } });
        rt.push({ text: `פק"ע ${dateStr} (${dStr}) ${Math.round(pak.cartons)}קרט\n`, font: { ...base, color:{ argb:'FFCC0000' }, bold:true } });
      } else {
        rt.push({ text: `פק"ע ${dateStr} (${dStr}) ${Math.round(pak.cartons)}קרט\n`, font: { ...base, color:{ argb:'FF006600' } } });
      }
    }
  }

  cell.value = { richText: rt };
  cell.alignment = { wrapText:true, vertical:'top', horizontal:'right', readingOrder:2 };
  const fc = {argb: famColor(fam)};
  cell.border = {
    top:    {style:'thin'},
    right:  {style:'thin'},
    bottom: {style:'thin'},
    left:   {style:'medium', color: fc},
  };
}

function emptyCell(cell, pick) {
  cell.value = `#${pick}\nפנוי`;
  cell.alignment = { wrapText:true, vertical:'middle', horizontal:'center' };
  cell.font = { size:8, color:{argb:'FFAAAAAA'} };
}

// Zero-stock cell: product is assigned here but out of stock → red indicator, no data
function zeroStockCell(cell, pick, makat, desc, fam) {
  const name = desc ? fixVisualRTL(String(desc).replace(/[​-‏‪-‮﻿]/g,'').trim()) : '';
  cell.value = { richText: [
    { text: `#${pick}\n`, font: { size:8, name:'Arial' } },
    { text: `⛔ אפס מלאי\n`, font: { bold:true, size:10, name:'Arial', color:{ argb:'FFCC0000' } } },
    { text: `${makat}\n`, font: { size:8, name:'Arial' } },
    { text: name,         font: { bold:true, size:9, name:'Arial', color:{ argb:'FF880000' } } },
  ]};
  cell.alignment = { wrapText:true, vertical:'top', horizontal:'right', readingOrder:2 };
  cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFDDDD' } };
  cell.border = {
    top:    { style:'thin' },
    right:  { style:'thin' },
    bottom: { style:'thin' },
    left:   { style:'medium', color:{ argb:'FFCC0000' } },
  };
}

// ─── Sort products: families by total dayAvg desc, within family by weight desc ─
function assignByLogic(products, nSlots) {
  const fams = {};
  for(const p of products) {
    const k = p.fam||'other';
    (fams[k] = fams[k]||[]).push(p);
  }
  for(const k of Object.keys(fams))
    fams[k].sort((a,b)=>(b.weight||0)-(a.weight||0));
  const order = Object.keys(fams).sort((a,b)=>{
    const sA = fams[a].reduce((s,p)=>s+(p.dayAvg||0),0);
    const sB = fams[b].reduce((s,p)=>s+(p.dayAvg||0),0);
    return sB-sA;
  });
  const out = [];
  for(const k of order) { for(const p of fams[k]) { out.push(p); if(out.length>=nSlots) return out; } }
  return out;
}

// ─── Read source Excel (חלבי / דגים) ─────────────────────────────────────
async function readProducts(wb, famMapper) {
  const sh = wb.worksheets[0];
  const items = [];
  sh.eachRow((row,r)=>{
    if(r===1) return;
    const makat  = row.getCell(3).value;
    const active = row.getCell(6).value;
    if(!makat || !active) return;
    const dayAvg = row.getCell(11).value; // col11 = orders/customers per day (sort+icons)
    if(!dayAvg) return;
    items.push({
      makat:    String(makat),
      fam:      famMapper(String(row.getCell(2).value||'')),
      desc:     String(row.getCell(4).value||''),
      dayAvg:   parseFloat(dayAvg),
      daySales: row.getCell(8).value  != null ? parseFloat(row.getCell(8).value)  : null,
      stock:    row.getCell(7).value  != null ? parseFloat(row.getCell(7).value)  : null,
      ss:       row.getCell(9).value  != null ? parseFloat(row.getCell(9).value)  : null,
      weight:   row.getCell(10).value != null ? parseFloat(row.getCell(10).value) : null,
    });
  });
  return items;
}

// ─── Scan sheet: collect all cells whose value is a pick number ───────────
function collectPickCells(ws) {
  const map = {}; // pickNum → {row,col}
  ws.eachRow((row,r)=>{
    row.eachCell({includeEmpty:false},(cell,c)=>{
      const v = cell.value;
      if(typeof v === 'number' && Number.isInteger(v) && v>=1 && v<=200)
        map[v] = {row:r, col:c};
    });
  });
  return map;
}

// ─── Add sequence review sheet ───────────────────────────────────────────
function addSeqSheet(wb, sheetName, prodsByPick, headerColor) {
  const ws = wb.addWorksheet(sheetName);
  ws.views = [{ rightToLeft: true }];

  const headers = ['#', 'מקט', 'שם מוצר', 'משפחה', 'KG', 'מלאי'];
  const colWidths = [6, 10, 40, 22, 8, 12];
  headers.forEach((h, i) => {
    ws.getColumn(i + 1).width = colWidths[i];
  });

  // Header row
  const hRow = ws.addRow(headers);
  hRow.font = { bold: true, size: 10, name: 'Arial' };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } };
  hRow.alignment = { horizontal: 'center' };
  ws.getRow(1).height = 18;
  ws.views[0].state = 'frozen'; ws.views[0].ySplit = 1;

  // Data rows sorted by pick#
  const picks = Object.keys(prodsByPick).map(Number).sort((a, b) => a - b);
  picks.forEach((pick, idx) => {
    const p = prodsByPick[pick];
    if (!p) return;
    const name = p.desc
      ? fixVisualRTL(String(p.desc).replace(/[​-‏‪-‮﻿]/g, '').trim())
      : '';
    const fam = p.fam || '';
    const isZeroStock = p.stock != null && p.stock <= 0;
    const row = ws.addRow([
      pick,
      p.makat,
      name,
      fam,
      p.weight != null ? (+p.weight).toFixed(2) : '—',
      isZeroStock ? 'אפס מלאי' : '',
    ]);
    row.font = { size: 9, name: 'Arial' };
    row.alignment = { horizontal: 'right', readingOrder: 2 };
    row.height = 16;
    if (isZeroStock) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFDDDD' } };
      row.getCell(6).font = { size: 9, name: 'Arial', bold: true, color: { argb: 'FFCC0000' } };
    } else if (idx % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
    }
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

// ─── Apply products to a sheet ───────────────────────────────────────────
// totalDayAvg: sum of dayAvg for all products in this section (for % display)
// Returns array of zero-stock products (stock=0) that were skipped.
function applyToSheet(ws, pickMap, prodsByPick, weightThresh, dayThreshHigh, dayThreshMid, palletMap, usePallets, totalDayAvg) {
  const rowsToResize = new Set();
  const colsToResize = new Set();
  const zeroStock = [];

  for(const [pickStr, pos] of Object.entries(pickMap)) {
    const pick = parseInt(pickStr);
    const cell = ws.getCell(pos.row, pos.col);
    const p = prodsByPick[pick];
    if(p) {
      const isZero = p.stock != null && p.stock <= 0;
      if(isZero) {
        // Zero stock: skip planogram cell, only in table below
        zeroStock.push(p);
      } else {
        const kratnost = usePallets ? (palletMap && palletMap[String(p.makat)] || 0) : 0;
        const pct = (totalDayAvg > 0 && p.dayAvg != null) ? (p.dayAvg / totalDayAvg * 100) : null;
        fillCell(cell, pick, p.makat, p.fam, p.dayAvg, p.daySales||null, p.ss, p.stock, p.weight, p.desc, weightThresh, dayThreshHigh, dayThreshMid, kratnost, pct, p.pakuot||[]);
      }
      rowsToResize.add(pos.row);
      colsToResize.add(pos.col);
    }
  }
  for(const r of rowsToResize) ws.getRow(r).height = 160;
  for(const c of colsToResize) {
    const col = ws.getColumn(c);
    if(!col.width || col.width < 32) col.width = 32;
  }
  return zeroStock;
}

// ─── Family navigation bar (row 2, after summary header) ─────────────────
// Inserts 1 row at position 2 with colored hyperlink "buttons" per family.
// Each button jumps to the first cell of that family in the planogram.
function addFamilyNavBar(ws, pickCells, prodsByPick, refreshLabel) {
  // Collect family → first occurrence {row, col} in pick order
  const famOrder = [];
  const seenFam  = new Set();
  for(const pick of Object.keys(pickCells).map(Number).sort((a,b)=>a-b)) {
    const pos = pickCells[pick];
    const p   = prodsByPick[pick];
    if(!p || !p.fam || seenFam.has(p.fam)) continue;
    seenFam.add(p.fam);
    famOrder.push({ fam: p.fam, row: pos.row, col: pos.col });
  }
  if(!famOrder.length) return;

  // Insert 1 row at position 2 (after summary header row 1)
  ws.spliceRows(2, 0, []);
  const navRow  = ws.getRow(2);
  navRow.height = 22;

  const shName = ws.name.replace(/'/g, "''");   // escape single quotes in sheet name

  famOrder.forEach((item, i) => {
    const c = ws.getCell(2, i + 1);
    // Insertion shifted original rows ≥ 2 by +1 → use row+1 for hyperlink target
    const targetAddr = ws.getCell(item.row + 1, item.col).address;
    c.value     = { formula: `HYPERLINK("#'${shName}'!${targetAddr}","${item.fam}")` };
    c.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb: famColor(item.fam) } };
    c.font      = { bold:true, size:8, name:'Arial' };
    c.alignment = { horizontal:'center', vertical:'middle' };
    c.border    = { top:{style:'thin'}, bottom:{style:'medium'},
                    left:{style:'thin'}, right:{style:'thin'} };
  });

  // Refresh timestamp — placed after all family buttons, right side
  if(refreshLabel) {
    const tsCell = ws.getCell(2, famOrder.length + 2);
    tsCell.value     = refreshLabel;
    tsCell.font      = { bold:true, size:10, name:'Arial', color:{ argb:'FF333333' } };
    tsCell.alignment = { horizontal:'right', vertical:'middle' };
    tsCell.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF5F5F5' } };
  }

  // Update frozen view: row 1 = summary, row 2 = nav → freeze after row 2
  if(ws.views && ws.views[0]) {
    ws.views[0].ySplit       = 2;
    ws.views[0].topLeftCell  = ws.getCell(3, 1).address;
  }
}

// ─── Add summary header row above planogram ──────────────────────────────
function addSummaryHeader(ws, label, totalOrd, totalPalDay, activeCount, zeroCount, grandTotalOrd) {
  ws.spliceRows(1, 0, []);   // insert 1 blank row at top → shifts planogram down

  const r = ws.getRow(1);
  r.height = 26;

  const palStr  = totalPalDay > 0 ? ` | מכר: ${totalPalDay.toFixed(1)} PAL/d` : '';
  const zeroStr = zeroCount  > 0  ? ` | אפס מלאי: ${zeroCount}` : '';
  const grandStr = grandTotalOrd > 0 ? `   ║   כל המחסנים: ${Math.round(grandTotalOrd)} הזמנות/d` : '';
  const txt = `${label}  ·  הזמנות/d: ${Math.round(totalOrd)}${palStr}  ·  פעיל: ${activeCount}${zeroStr}${grandStr}`;

  // Fill cells 1-20 with blue background + text in cell 1
  for(let c = 1; c <= 20; c++) {
    const cell = r.getCell(c);
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1565C0' } };
    cell.font = { bold:true, size:11, name:'Arial', color:{ argb:'FFFFFFFF' } };
  }
  const cell1 = r.getCell(1);
  cell1.value     = txt;
  cell1.alignment = { horizontal:'left', readingOrder:2, vertical:'middle' };
  try { ws.mergeCells(1, 1, 1, 20); } catch(e) {}
}

// ─── Add אפס מלאי table below planogram ──────────────────────────────────
function addZeroStockTable(ws, zeroItems) {
  if(!zeroItems.length) return;

  const startRow = (ws.lastRow ? ws.lastRow.number : 50) + 3;

  // Title
  const titleCell = ws.getCell(startRow, 1);
  titleCell.value = 'אפס מלאי';
  titleCell.font = { bold: true, size: 13, name: 'Arial', color: { argb: 'FFCC0000' } };
  titleCell.alignment = { horizontal: 'right', readingOrder: 2 };

  // Header row
  const hRow = ws.getRow(startRow + 1);
  ['מקט', 'שם מוצר', 'משפחה', 'מלאי'].forEach((h, i) => {
    const c = hRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 9, name: 'Arial' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0E0' } };
    c.border = { bottom: { style: 'thin' } };
    c.alignment = { horizontal: 'center', readingOrder: 2 };
  });
  ws.getRow(startRow + 1).height = 16;

  // Data rows
  zeroItems.forEach((p, i) => {
    const name = p.desc ? fixVisualRTL(String(p.desc).replace(/[​-‏‪-‮﻿]/g, '').trim()) : '';
    const row = ws.getRow(startRow + 2 + i);
    row.getCell(1).value = p.makat;
    row.getCell(2).value = name;
    row.getCell(3).value = p.fam || '';
    row.getCell(4).value = p.stock  != null ? Math.round(p.stock)  : '—';
    row.font = { size: 9, name: 'Arial' };
    row.alignment = { horizontal: 'right', readingOrder: 2 };
    row.height = 15;
    if(i % 2 === 1)
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF5F5' } };
  });

  // Ensure column widths cover the table
  const minWidths = [10, 38, 22, 12];
  minWidths.forEach((w, i) => {
    const col = ws.getColumn(i + 1);
    if(!col.width || col.width < w) col.width = w;
  });

  console.log(`  אפס מלאי: ${zeroItems.length} products → row ${startRow}`);
}

// ─── Build pickNum→product maps ──────────────────────────────────────────

// קפוא — new order: butter first → כיסונים → עוגות → SB → חטיף → SB דגים → מוסדי → VALESTA last
const KAPUA_PICKS = {
  // ── חמאה + ממרחי חמאה (heavy → dock-side logic) ──────────────────────
  1: {makat:'732',   fam:'חמאה FERMA',   weight:4.00,dayAvg:88, ss:null},
  2: {makat:'800',   fam:'חמאה רושן',    weight:4.80,dayAvg:35, ss:null},
  3: {makat:'604',   fam:'חמאה רושן',    weight:4.80,dayAvg:33, ss:null},
  4: {makat:'736',   fam:'ממרחי חמאה',   weight:4.00,dayAvg:11, ss:null},
  5: {makat:'803',   fam:'ממרחי חמאה',   weight:4.00,dayAvg:8,  ss:null},
  6: {makat:'802',   fam:'ממרחי חמאה',   weight:4.00,dayAvg:6,  ss:null},
  7: {makat:'739',   fam:'ממרחי חמאה',   weight:4.00,dayAvg:7,  ss:null},
  8: {makat:'740',   fam:'ממרחי חמאה',   weight:8.00,dayAvg:7,  ss:null},
  // ── כיסונים ────────────────────────────────────────────────────────────
  // ── בלינצס (blintzes — sorted by ORD desc) ─────────────────────────────
  9: {makat:'1192',fam:'בלינצס',     weight:2.16,dayAvg:26, ss:null},
  10:{makat:'1191',fam:'בלינצס',     weight:2.16,dayAvg:20, ss:null},
  11:{makat:'1190',fam:'בלינצס',     weight:2.52,dayAvg:13, ss:null},
  12:{makat:'1193',fam:'בלינצס',     weight:2.16,dayAvg:12, ss:null},
  13:{makat:'1198',fam:'בלינצס',     weight:2.16,dayAvg:12, ss:null},
  // ── כיסונים (dumplings/vareniki) ───────────────────────────────────────
  14:{makat:'1182',fam:'כיסונים',    weight:2.70,dayAvg:18, ss:null},
  15:{makat:'1185',fam:'כיסונים',    weight:2.70,dayAvg:14, ss:null},
  16:{makat:'1187',fam:'כיסונים',    weight:2.70,dayAvg:14, ss:null},
  17:{makat:'1180',fam:'כיסונים',    weight:2.70,dayAvg:13, ss:null},
  18:{makat:'1184',fam:'כיסונים',    weight:2.70,dayAvg:12, ss:null},
  // ── בצק + עלי בלינצס (dough + wrappers) ────────────────────────────────
  19:{makat:'1196',fam:'בצק',        weight:3.15,dayAvg:17, ss:null},
  20:{makat:'1195',fam:'בצק',        weight:3.15,dayAvg:15, ss:null},
  21:{makat:'1197',fam:'בצק',        weight:3.15,dayAvg:14, ss:null},
  22:{makat:'1194',fam:'עלי בלינצס', weight:3.20,dayAvg:12, ss:null},
  // ── סורימי (SANTA BREMOR דגים) — после כיסונים ──────────────────────────
  23:{makat:'1045',  fam:'SANTA BREMOR דגים',weight:6.00,dayAvg:22,ss:706},
  24:{makat:'1046',  fam:'SANTA BREMOR דגים',weight:6.00,dayAvg:14,ss:453},
  // ── SANTA BREMOR 4.5 ─────────────────────────────────────────────────────
  25:{makat:'1030',  fam:'SANTA BREMOR',weight:1.00,dayAvg:16, ss:null},
  26:{makat:'1031',  fam:'SANTA BREMOR',weight:1.00,dayAvg:11, ss:null},
  27:{makat:'1034',  fam:'SANTA BREMOR',weight:1.20,dayAvg:10, ss:null},
  28:{makat:'1036',  fam:'SANTA BREMOR',weight:1.20,dayAvg:8,  ss:null},
  29:{makat:'1035',  fam:'SANTA BREMOR',weight:1.20,dayAvg:7,  ss:null},
  30:{makat:'1033',  fam:'SANTA BREMOR',weight:1.00,dayAvg:2,  ss:null},
  31:{makat:'1032',  fam:'SANTA BREMOR',weight:1.00,dayAvg:1,  ss:null},
  32:{makat:'1037',  fam:'SANTA BREMOR',weight:1.20,dayAvg:null,ss:null},
  // ── עוגות רושן ─────────────────────────────────────────────────────────
  33:{makat:'420004',fam:'עוגות רושן', weight:5.10,dayAvg:10, ss:321},
  34:{makat:'420003',fam:'עוגות רושן', weight:5.10,dayAvg:4,  ss:116},
  35:{makat:'420008',fam:'עוגות רושן', weight:3.12,dayAvg:4,  ss:136},
  36:{makat:'420007',fam:'עוגות רושן', weight:3.00,dayAvg:4,  ss:121},
  37:{makat:'420005',fam:'עוגות רושן', weight:2.70,dayAvg:19, ss:624},
  38:{makat:'420006',fam:'עוגות רושן', weight:2.70,dayAvg:5,  ss:164},
  // ── עוגות מוזיקה ───────────────────────────────────────────────────────
  39:{makat:'420001',fam:'עוגות מוזיקה',weight:4.00,dayAvg:17, ss:539},
  40:{makat:'420002',fam:'עוגות מוזיקה',weight:4.00,dayAvg:12, ss:377},
  // ── חטיף גבינה ─────────────────────────────────────────────────────────
  41:{makat:'818',   fam:'חטיף גבינה',  weight:0.81,dayAvg:233,ss:7475},
  42:{makat:'815',   fam:'חטיף גבינה',  weight:0.81,dayAvg:131,ss:4214},
  43:{makat:'816',   fam:'חטיף גבינה',  weight:0.81,dayAvg:111,ss:3552},
  44:{makat:'817',   fam:'חטיף גבינה',  weight:0.81,dayAvg:109,ss:3517},
  // ── SANTA BREMOR דגים (1051 only here — 1045/1046 moved to 23-24) ────────
  45:{makat:'1051',  fam:'SANTA BREMOR דגים',weight:4.50,dayAvg:24,ss:759},
  // ── VALESTA (4 bays before מוסדי) ─────────────────────────────────────
  46:{makat:'1213',  fam:'VALESTA',      weight:null,dayAvg:null,ss:null},
  47:{makat:'1214',  fam:'VALESTA',      weight:null,dayAvg:null,ss:null},
  48:{makat:'1215',  fam:'VALESTA',      weight:null,dayAvg:null,ss:null},
  49:{makat:'1216',  fam:'VALESTA',      weight:null,dayAvg:null,ss:null},
  // ── מוסדי (last — picks 50-54) ────────────────────────────────────────
  50:{makat:'1211',  fam:'מוסדי',        weight:7.00,dayAvg:165,ss:5304},
  51:{makat:'1209',  fam:'מוסדי',        weight:7.00,dayAvg:17, ss:554},
  52:{makat:'1208',  fam:'מוסדי',        weight:7.00,dayAvg:9,  ss:292},
  53:{makat:'1217',  fam:'VALESTA',      weight:3.96,dayAvg:null,ss:null},
  54:{makat:'1218',  fam:'VALESTA',      weight:null,dayAvg:null,ss:null},
};

// Family name cleaner for חלבי / דגים source files
function cleanFam(s) {
  s = s.replace(/[‏‎]/g,'').trim();
  if(s.includes('PRESIDENT'))                                    return 'PRESIDENT';
  if(s.includes('SVALIA') && /תנמש|טרוגוי|הסייד|ריפק/.test(s)) return 'SVALIA תנמש';
  if(s.includes('SVALIA') && /גורובט|קוטג|החירמל/.test(s))      return 'SVALIA גורובט';
  if(s.includes('SVALIA') && s.includes('תוסורפ'))              return 'SVALIA תוסורפ';
  if(s.includes('SVALIA') && s.includes('הניבג'))               return 'SVALIA הניבג';
  if(s.includes('SVALIA'))                                       return 'SVALIA תנמש';
  if(s.includes('NORD PORT') && (s.includes('מצון') || s.includes('ןוצמ') || s.includes('סלמון') || s.includes('ןומלס'))) return 'NORD PORT מצונן';
  if(s.includes('NORD PORT'))                                    return 'NORD PORT';
  if(s.includes('SANTA BREMOR'))                                 return 'SANTA BREMOR Fish';
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  // Load קפוא data from Power BI (replaces קפוא.xlsx)
  // stock = cartons at אשדוד only (מחסן Main, no צפון)
  const allMakatim = Object.values(KAPUA_PICKS).map(p => p.makat);
  const [kapuaData, lastRefreshISO] = await Promise.all([
    fetchKapuaFromBI(allMakatim),
    fetchLastRefresh(),
  ]);

  // Format refresh time: "עודכן: 11/05 09:30" (Israel local time)
  let refreshLabel = '';
  if(lastRefreshISO) {
    const d = new Date(lastRefreshISO);
    // Convert UTC → Asia/Jerusalem (+3 in winter / +3 in summer = UTC+2/+3)
    const ilTime = new Intl.DateTimeFormat('he-IL', {
      timeZone: 'Asia/Jerusalem',
      day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false
    }).format(d);
    refreshLabel = `BI עודכן: ${ilTime}`;
    console.log(`Dataset last refresh: ${lastRefreshISO} → ${ilTime}`);
  }

  for(const pick of Object.keys(KAPUA_PICKS)) {
    const p   = KAPUA_PICKS[pick];
    const src = kapuaData[String(p.makat)];
    if(src) {
      if(!p.desc && src.desc)   p.desc     = src.desc;
      if(src.daySales != null)  p.daySales = src.daySales;
      p.stock  = src.stock;  // always from BI (0 = zero stock at אשדוד)
      p.pakuot = src.pakuot || [];
      // ss, weight: stay from KAPUA_PICKS (no BI source)
    }
  }

  // All 54 קפוא picks are statically assigned — no auto-fill needed

  // Load source product files
  const wbHalavi = new ExcelJS.Workbook();
  await wbHalavi.xlsx.readFile('MAHSAN חלבי/חלבי.xlsx');
  const halaviProds = await readProducts(wbHalavi, cleanFam);

  const wbDagim = new ExcelJS.Workbook();
  await wbDagim.xlsx.readFile('MAHSAN דגים/דגים.xlsx');
  const dagimProds = await readProducts(wbDagim, cleanFam);

  console.log(`חלבי: ${halaviProds.length} active | דגים: ${dagimProds.length} active`);

  // Grand total ORD/day across all three sections
  const kapuaOrdForGrand  = Object.values(KAPUA_PICKS).reduce((s,p)=>s+(p.dayAvg||0),0);
  const halaviOrdForGrand = halaviProds.reduce((s,p)=>s+(p.dayAvg||0),0);
  const dagimOrdForGrand  = dagimProds.reduce((s,p)=>s+(p.dayAvg||0),0);
  const grandTotalOrd = kapuaOrdForGrand + halaviOrdForGrand + dagimOrdForGrand;
  console.log(`Grand total ORD/day: קפוא ${Math.round(kapuaOrdForGrand)} + חלבי ${Math.round(halaviOrdForGrand)} + דגים ${Math.round(dagimOrdForGrand)} = ${Math.round(grandTotalOrd)}`);

  // ── Global top-30% thresholds (all three sheets combined) ──────────────
  const kapuaList = Object.values(KAPUA_PICKS);
  const allProds  = [...kapuaList, ...halaviProds, ...dagimProds];
  const weightThresh = percentileThreshold(allProds.map(p => p.weight), 0.7);
  // Star thresholds based on daySales PAL/d (BI live); fallback dayAvg for חלבי/דגים
  const palDayVals   = allProds.map(p => {
    const s = p.daySales || p.dayAvg;
    const k = p.makat ? (Object.values(KAPUA_PICKS).find(q => q.makat === p.makat) || {}) : {};
    return s; // use raw carton/day — kratnost varies per product, compare on common base
  }).filter(Boolean);
  const dayThreshHigh = percentileThreshold(palDayVals, 0.7);  // 🏅 top 30%
  const dayThreshMid  = percentileThreshold(palDayVals, 0.5);  // ⭐ next 20%
  console.log(`Star thresholds → 🏅 top-30%: ≥${dayThreshHigh.toFixed(1)} קרט/d | ⭐ top-50%: ≥${dayThreshMid.toFixed(1)} קרט/d | weight 🏋️: ≥${weightThresh.toFixed(2)} kg`);

  // Load pallet kratnost map (cartons per pallet per מקט)
  const palletMap = {};
  {
    const wbPal = new ExcelJS.Workbook();
    await wbPal.xlsx.readFile('FORMULA PALLETS.xlsx');
    wbPal.worksheets[0].eachRow((row,r)=>{
      if(r===1) return;
      const makat = String(row.getCell(1).value||'');
      const krat  = parseFloat(row.getCell(10).value||0);
      if(makat && krat > 0) palletMap[makat] = krat;
    });
    console.log(`Pallet map loaded: ${Object.keys(palletMap).length} products`);
  }

  // Load the template (MAHSAN 8.xlsx — 3 sheets)
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('MAHSAN 8.xlsx');

  // ── SHEET: MAHSAN 8 (קפוא) ─────────────────────────────────────────────
  const shKapua = wb.getWorksheet('MAHSAN 8');
  {
    const kapuaTotalOrd = Object.values(KAPUA_PICKS).reduce((s,p)=>s+(p.dayAvg||0),0);
    const kapuaTotalPal = Object.values(KAPUA_PICKS).reduce((s,p)=>{
      const krat = palletMap[String(p.makat)]||0;
      return s + (p.daySales!=null && krat>0 ? p.daySales/krat : 0);
    }, 0);
    const kapuaZero   = Object.values(KAPUA_PICKS).filter(p=>p.stock!=null&&p.stock<=0).length;
    const kapuaActive = Object.values(KAPUA_PICKS).length - kapuaZero;
    addSummaryHeader(shKapua, 'קפוא', kapuaTotalOrd, kapuaTotalPal, kapuaActive, kapuaZero, grandTotalOrd);
    shKapua.views = [{...((shKapua.views||[])[0]||{}), state:'frozen', ySplit:1, topLeftCell:'A2'}];
    // rescan after row insert (positions shifted +1)
    const pickCells = collectPickCells(shKapua);
    const picks = Object.keys(pickCells).map(Number).sort((a,b)=>a-b);
    // Compact: picks 46-54 are PINNED (VALESTA + מוסדי), picks 1-45 get compact fill
    const PINNED = new Set([46,47,48,49,50,51,52,53,54]);
    const regularKeys = Object.keys(KAPUA_PICKS).map(Number).sort((a,b)=>a-b).filter(k=>!PINNED.has(k));
    const pinnedKeys  = Object.keys(KAPUA_PICKS).map(Number).sort((a,b)=>a-b).filter(k=>PINNED.has(k));
    const kapuaZeroList = [];
    // Regular: compact fill (skip zero-stock, shift others forward)
    const regularInStock = regularKeys.map(k=>KAPUA_PICKS[k]).filter(p=>{
      if(p.stock!=null&&p.stock<=0){ kapuaZeroList.push(p); return false; } return true;
    });
    const regularPickNums = picks.filter(p=>!PINNED.has(p));
    const compactedKapua = {};
    regularPickNums.forEach((pick,i)=>{ if(regularInStock[i]) compactedKapua[pick]=regularInStock[i]; });
    // Pinned: always at their designated physical position
    pinnedKeys.forEach(k=>{
      const p=KAPUA_PICKS[k];
      if(p.stock!=null&&p.stock<=0){ kapuaZeroList.push(p); } else { compactedKapua[k]=p; }
    });
    console.log(`\nקפוא picks found: ${picks.length} (${picks[0]}..${picks[picks.length-1]}) | total ORD: ${Math.round(kapuaTotalOrd)} | PAL/d: ${kapuaTotalPal.toFixed(1)}`);
    applyToSheet(shKapua, pickCells, compactedKapua, weightThresh, dayThreshHigh, dayThreshMid, palletMap, true, kapuaTotalOrd);
    addZeroStockTable(shKapua, kapuaZeroList);
    addFamilyNavBar(shKapua, pickCells, compactedKapua, refreshLabel);
    shKapua.name = 'MAHSAN 8 קפוא';
    addSeqSheet(wb, 'סדר קפוא', KAPUA_PICKS, 'FFCCE5FF');
  }

  // ── SHEET: MAHSAN חלבי ─────────────────────────────────────────────────
  const shHalavi = wb.getWorksheet('MAHSAN חלבי');
  {
    // First pass: count picks to size prodMap
    const picksCountScan = Object.keys(collectPickCells(shHalavi)).length;
    const assigned = assignByLogic(halaviProds, picksCountScan);
    const prodMapH = {};
    Object.keys(collectPickCells(shHalavi)).map(Number).sort((a,b)=>a-b)
      .forEach((pick,i) => { if(assigned[i]) prodMapH[pick] = assigned[i]; });

    const halaviTotalOrd = Object.values(prodMapH).reduce((s,p)=>s+(p.dayAvg||0),0);
    const halaviZero     = Object.values(prodMapH).filter(p=>p.stock!=null&&p.stock<=0).length;
    const halaviActive   = Object.values(prodMapH).length - halaviZero;
    addSummaryHeader(shHalavi, 'חלבי', halaviTotalOrd, 0, halaviActive, halaviZero, grandTotalOrd);
    shHalavi.views = [{...((shHalavi.views||[])[0]||{}), state:'frozen', ySplit:1, topLeftCell:'A2'}];
    // rescan after insert
    const pickCells = collectPickCells(shHalavi);
    const picks     = Object.keys(pickCells).map(Number).sort((a,b)=>a-b);
    const prodMap   = {};
    picks.forEach((pick,i) => { if(assigned[i]) prodMap[pick] = assigned[i]; });
    console.log(`חלבי picks found: ${picks.length} | total ORD: ${Math.round(halaviTotalOrd)}`);
    const zeroHalavi = applyToSheet(shHalavi, pickCells, prodMap, weightThresh, dayThreshHigh, dayThreshMid, null, false, halaviTotalOrd);
    addZeroStockTable(shHalavi, zeroHalavi);
    addFamilyNavBar(shHalavi, pickCells, prodMap, refreshLabel);
    addSeqSheet(wb, 'סדר חלבי', prodMap, 'FFD5F5D5');
  }

  // ── SHEET: MAHSAN דגים ─────────────────────────────────────────────────
  // NORD PORT → R6 (one face), SANTA BREMOR → dock(R5) + R8 + R9 (other face)
  const shDagim = wb.getWorksheet('MAHSAN דגים');
  {
    // Build prodMap first (need it for stats before header insert)
    const preScanPicks = Object.keys(collectPickCells(shDagim)).map(Number).sort((a,b)=>a-b);
    const FACE_A_pre = new Set([10,12,14,16,18,20,22,24,26,28,29,30,31,33,35,37,39,41,43,45,47,49,51,53,55,57]);
    const FACE_B_pre = new Set([11,13,15,17,19,21,23,25,27,32,34,36,38,40,42,44,46,48,50,52,54,56,58]);
    const BACK_pre   = new Set([59,60,61,62,63,64,65,66,67,68,69,70,71,72]);
    const DOCK_pre   = new Set([1,2,3,4,5,6,7,8,9]);
    const nordPortMatzPre = dagimProds.filter(p=>p.fam==='NORD PORT מצונן').sort((a,b)=>(b.weight||0)-(a.weight||0));
    const santaBremorPre  = dagimProds.filter(p=>p.fam==='SANTA BREMOR Fish').sort((a,b)=>(b.weight||0)-(a.weight||0));
    const nordPortPre     = dagimProds.filter(p=>p.fam==='NORD PORT').sort((a,b)=>(b.weight||0)-(a.weight||0));
    const preProdMap = {};
    preScanPicks.filter(p=>DOCK_pre.has(p)).forEach((pick,i)=>{ if(nordPortMatzPre[i]) preProdMap[pick]=nordPortMatzPre[i]; });
    preScanPicks.filter(p=>FACE_A_pre.has(p)).forEach((pick,i)=>{ if(santaBremorPre[i]) preProdMap[pick]=santaBremorPre[i]; });
    [...preScanPicks.filter(p=>FACE_B_pre.has(p)),...preScanPicks.filter(p=>BACK_pre.has(p))].forEach((pick,i)=>{ if(nordPortPre[i]) preProdMap[pick]=nordPortPre[i]; });
    const dagimTotalOrd = Object.values(preProdMap).reduce((s,p)=>s+(p.dayAvg||0),0);
    const dagimTotalPal = Object.values(preProdMap).reduce((s,p)=>{
      const krat = palletMap[String(p.makat)]||0;
      return s + (p.daySales!=null && krat>0 ? p.daySales/krat : 0);
    }, 0);
    const dagimZero   = Object.values(preProdMap).filter(p=>p.stock!=null&&p.stock<=0).length;
    const dagimActive = Object.values(preProdMap).length - dagimZero;
    addSummaryHeader(shDagim, 'דגים', dagimTotalOrd, dagimTotalPal, dagimActive, dagimZero, grandTotalOrd);
    shDagim.views = [{...((shDagim.views||[])[0]||{}), state:'frozen', ySplit:1, topLeftCell:'A2'}];

    const pickCells = collectPickCells(shDagim);
    const allPicks  = Object.keys(pickCells).map(Number).sort((a,b)=>a-b);
    console.log(`דגים picks found: ${allPicks.length} (${allPicks[0]}..${allPicks[allPicks.length-1]})`);

    // Physical faces from the sheet layout (full 29-col map)
    const FACE_A  = new Set([10,12,14,16,18,20,22,24,26,28,29,30,31,33,35,37,39,41,43,45,47,49,51,53,55,57]); // R6 (26 slots)
    const FACE_B  = new Set([11,13,15,17,19,21,23,25,27,32,34,36,38,40,42,44,46,48,50,52,54,56,58]);          // R8 (23 slots)
    const BACK    = new Set([59,60,61,62,63,64,65,66,67,68,69,70,71,72]);                                      // R9 (14 slots)
    const DOCK    = new Set([1,2,3,4,5,6,7,8,9]);                                                              // R5 (9 slots)

    // Split by family, sort by weight desc within each
    const nordPortMatz = dagimProds.filter(p=>p.fam==='NORD PORT מצונן')   .sort((a,b)=>(b.weight||0)-(a.weight||0));
    const nordPort     = dagimProds.filter(p=>p.fam==='NORD PORT')          .sort((a,b)=>(b.weight||0)-(a.weight||0));
    const santaBremor  = dagimProds.filter(p=>p.fam==='SANTA BREMOR Fish')  .sort((a,b)=>(b.weight||0)-(a.weight||0));

    console.log(`  NORD PORT מצונן: ${nordPortMatz.length} | NORD PORT: ${nordPort.length} | SANTA BREMOR: ${santaBremor.length}`);
    console.log(`  DOCK(R5): ${[...DOCK].length} slots (NP מצונן) | Face A(R6): ${[...FACE_A].length} slots (SB) | FaceB+Back: ${[...FACE_B].length+[...BACK].length} slots (NP)`);

    const prodMap = {};

    // NORD PORT מצונן → DOCK (R5, picks 1-9)
    allPicks.filter(p=>DOCK.has(p))
      .forEach((pick,i) => { if(nordPortMatz[i]) prodMap[pick] = nordPortMatz[i]; });

    // SANTA BREMOR → Face A (R6)
    allPicks.filter(p=>FACE_A.has(p))
      .forEach((pick,i) => { if(santaBremor[i]) prodMap[pick] = santaBremor[i]; });

    // NORD PORT → Face B (R8) + Back (R9)
    const npSlots = [
      ...allPicks.filter(p=>FACE_B.has(p)),
      ...allPicks.filter(p=>BACK.has(p)),
    ];
    npSlots.forEach((pick,i) => { if(nordPort[i]) prodMap[pick] = nordPort[i]; });

    console.log(`דגים total ORD/day: ${dagimTotalOrd.toFixed(0)}`);
    const zeroDagim = applyToSheet(shDagim, pickCells, prodMap, weightThresh, dayThreshHigh, dayThreshMid, palletMap, true, dagimTotalOrd);
    addZeroStockTable(shDagim, zeroDagim);
    addFamilyNavBar(shDagim, pickCells, prodMap, refreshLabel);
    addSeqSheet(wb, 'סדר דגים', prodMap, 'FFFFF0CC');
  }

  // ── EXTRA SHEETS: Trn (transit/blocked) + Zafn danger < 3 days ───────────
  const { trn, zafn } = await fetchExtraSheets();

  // Sheet: מחסן מעבר (Trn) — stock list, sorted by stock desc
  {
    const sh = wb.addWorksheet('מחסן מעבר Trn');
    sh.views = [{ state:'frozen', ySplit:1, topLeftCell:'A2' }];
    sh.columns = [
      { header:"מקט",         key:'makat',   width:12 },
      { header:"שם מוצר",     key:'desc',    width:42 },
      { header:"משפחה",       key:'fam',     width:10 },
      { header:"מלאי (קרטון)", key:'stock',  width:16 },
    ];
    const hdr = sh.getRow(1);
    hdr.font = { bold:true, size:10, name:'Arial' };
    hdr.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF2E4057' } };
    hdr.font = { bold:true, size:10, name:'Arial', color:{ argb:'FFFFFFFF' } };
    hdr.alignment = { horizontal:'center' };
    hdr.height = 18;

    trn.forEach((item, i) => {
      const row = sh.addRow({ makat: item.makat, desc: item.desc, fam: item.fam, stock: item.stock });
      row.getCell('stock').numFmt = '#,##0';
      row.getCell('stock').alignment = { horizontal:'right' };
      const bg = i % 2 === 0 ? 'FFFAFAFA' : 'FFF0F4FF';
      row.eachCell(c => c.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:bg } });
    });

    // Total row
    const totalRow = sh.addRow({ makat:'', desc:'סה"כ', fam:'', stock: trn.reduce((s,r)=>s+r.stock,0) });
    totalRow.font = { bold:true };
    totalRow.getCell('stock').numFmt = '#,##0';
    totalRow.getCell('stock').fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF2E4057' } };
    totalRow.getCell('stock').font = { bold:true, color:{ argb:'FFFFFFFF' } };

    sh.autoFilter = { from:'A1', to:`D1` };
    console.log(`מחסן מעבר sheet: ${trn.length} rows`);
  }

  // Sheet: מחסן צפון Zafn danger — items with days < 3, sorted by urgency
  {
    const sh = wb.addWorksheet('מחסן צפון Zafn');
    sh.views = [{ state:'frozen', ySplit:1, topLeftCell:'A2' }];
    sh.columns = [
      { header:"מקט",           key:'makat',    width:12 },
      { header:"שם מוצר",       key:'desc',     width:42 },
      { header:"מלאי צפון (קרט)", key:'stock',  width:18 },
      { header:"קרט/יום",        key:'daySales',width:12 },
      { header:"יספיק ל (ימים)", key:'days',    width:16 },
    ];
    const hdr = sh.getRow(1);
    hdr.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFCC0000' } };
    hdr.font = { bold:true, size:10, name:'Arial', color:{ argb:'FFFFFFFF' } };
    hdr.alignment = { horizontal:'center' };
    hdr.height = 18;

    // ── Table 1: items with < 3 days stock cover ──────────────────────────────
    zafn.under3.forEach(item => {
      const row = sh.addRow({
        makat   : item.makat,
        desc    : item.desc,
        stock   : item.stock,
        daySales: item.daySales != null ? +item.daySales.toFixed(1) : null,
        days    : +item.days.toFixed(2),
      });
      row.getCell('stock').numFmt    = '#,##0';
      row.getCell('daySales').numFmt = '0.0';
      row.getCell('days').numFmt     = '0.00';
      const urgentColor = item.days < 1 ? 'FFFFCCCC' : 'FFFFF5CC';
      row.eachCell(c => c.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: urgentColor } });
      row.getCell('days').font = { bold: item.days < 1, color:{ argb: item.days < 1 ? 'FFCC0000' : 'FF885500' } };
    });

    sh.autoFilter = { from:'A1', to:`E1` };

    // ── Helper: render a סכנת השמדה section ───────────────────────────────────
    function renderSakanaSection(sh, items, sectionTitle) {
      if(!items.length) return;
      const sepRow = sh.addRow({}); sepRow.height = 8;
      const hdrRow = sh.addRow({});
      hdrRow.getCell(1).value = sectionTitle;
      hdrRow.getCell(1).font  = { bold:true, size:10, name:'Arial', color:{argb:'FFFFFFFF'} };
      hdrRow.getCell(1).fill  = { type:'pattern', pattern:'solid', fgColor:{argb:'FF8B0000'} };
      hdrRow.height = 18;
      const sub = sh.addRow({});
      ['מקט','שם מוצר','מלאי (קרט)','קרט/יום','פק"ע | תוקף | ימים'].forEach((t,i) => {
        sub.getCell(i+1).value = t;
        sub.getCell(i+1).font  = { bold:true, size:9, name:'Arial' };
        sub.getCell(i+1).fill  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFDDDD'} };
      });
      for(const p of items) {
        const desc = p.desc ? fixVisualRTL(String(p.desc).replace(/[​-‏‪-‮﻿]/g,'').trim()) : (p.makat||'');
        const paks = (p.pakuot||[]).map(pak => {
          const ds = pak.date ? `${pak.date.getDate().toString().padStart(2,'0')}/${(pak.date.getMonth()+1).toString().padStart(2,'0')}/${String(pak.date.getFullYear()).slice(-2)}` : '?';
          return `${ds} (${pak.daysLeft??'?'}d) ${Math.round(pak.cartons)}קרט`;
        }).join(' | ');
        const row = sh.addRow({});
        row.getCell(1).value = p.makat;
        row.getCell(2).value = desc;
        row.getCell(3).value = p.stock || 0;
        row.getCell(4).value = p.daySales != null ? +p.daySales.toFixed(1) : null;
        row.getCell(5).value = paks;
        row.getCell(3).numFmt = '#,##0';
        row.getCell(4).numFmt = '0.0';
        row.eachCell(c => c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFEEEE'} });
        row.getCell(1).font = { bold:true, color:{argb:'FF880000'} };
      }
    }

    // ── Table 2: סכנת השמדה — Zafn (פק"ע expires before sold at Zafn rate) ───
    renderSakanaSection(sh, zafn.sakana, 'סכנת השמדה — צפון  (פק"ע פגה לפני מכירה)');

    // ── Table 3: סכנת השמדה — Main (KAPUA planogram picks) ───────────────────
    const dangerPicks = Object.values(KAPUA_PICKS).filter(p => {
      if(!p.pakuot || !p.pakuot.length) return false;
      return p.pakuot.some(pak => {
        if(pak.daysLeft == null || pak.cartons <= 0) return false;
        const sellDays = (p.daySales && p.daySales > 0) ? pak.cartons / p.daySales : Infinity;
        return pak.daysLeft < sellDays;
      });
    }).map(p => ({
      makat   : p.makat,
      desc    : p.desc,
      stock   : p.stock || 0,
      daySales: p.daySales,
      pakuot  : p.pakuot.filter(pak => {
        if(pak.daysLeft == null || pak.cartons <= 0) return false;
        const sellDays = (p.daySales && p.daySales > 0) ? pak.cartons / p.daySales : Infinity;
        return pak.daysLeft < sellDays;
      }),
    })).sort((a,b) => {
      const minA = Math.min(...a.pakuot.map(pk => pk.daysLeft??9999));
      const minB = Math.min(...b.pakuot.map(pk => pk.daysLeft??9999));
      return minA - minB;
    });
    renderSakanaSection(sh, dangerPicks, 'סכנת השמדה — Main  (פק"ע פגה לפני מכירה)');

    console.log(`מחסן צפון sheet: under3=${zafn.under3.length} | סכנה Zafn=${zafn.sakana.length} | סכנה Main=${dangerPicks.length}`);
  }

  // Write output
  const out = 'MAHSAN PLANOGRAM.xlsx';
  await wb.xlsx.writeFile(out);
  console.log('\n✅ Written:', out);
}

main().catch(e => { console.error(e); process.exit(1); });
