/**
 * MAHSAN PLANOGRAM BUILDER
 * Клонирует MAHSAN 8.xlsx (3 листа), заменяет числа-пики на данные товара.
 * Сохраняет точную компоновку оригинала.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const fs      = require('fs');
const path    = require('path');
const ExcelJS = require('exceljs');
const { fetchKapuaFromBI, fetchLastRefresh, fetchStockMain, fetchNamesForMakats, fetchPakuotForMakats, fetchPakuotZafnForMakats, fetchPakuotAllForMakats, fetchShelfLifeForMakats, fetchHalaviFromBI, fetchDagimFromBI, fetchPhotoUrls, triggerAndWaitRefresh, fetchWeeklySales } = require('./pbi-kapua');
const { fetchExtraSheets }   = require('./pbi-extra-sheets');
const { fetchDagimYaveshFromBI } = require('./pbi-dagim-yavesh');

// ─── Sheets to hide in output (set [] when all ready to publish) ──────────
const HIDDEN_SHEETS = ['MAHSAN חלבי', 'MAHSAN דגים', 'סדר חלבי', 'סדר דגים',
                       'מחסן מעבר', 'צפון מלאי פחות מ3DAYS SALES'];

// Products permanently excluded from all sections
const GLOBAL_BLACKLIST = new Set(['1130', '1131']);

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
  const name = desc ? fixVisualRTL(String(desc).replace(/[​-‏‪-‮﻿]/g,'').replace(/\s*\([^)]*\)/g,'').trim()) : '';

  // Stars based on קרט/d directly — same unit as threshold (do NOT divide by kratnost)
  const salesForStar = daySales != null ? daySales : dayAvg;
  const isTopStar    = salesForStar != null && dayThreshHigh != null && salesForStar >= dayThreshHigh;
  const isMidStar    = !isTopStar && salesForStar != null && dayThreshMid != null && salesForStar >= dayThreshMid;
  const isHeavy      = weight != null && weightThresh != null && weight >= weightThresh;

  const base = { size:8, name:'Arial' };
  const rt   = [];

  // Line 1: START indicator for pick #1
  if(pick === 1) {
    rt.push({ text: `← START\n`, font: { bold:true, size:10, name:'Arial', color:{ argb:'FF003399' } } });
  }
  // Pick number
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
      rt.push({ text: `AVG/d: ${kartStr} | ${(daySales/kratnost).toFixed(1)} PAL\n`, font: { ...base, bold:true } });
    } else {
      rt.push({ text: `AVG/d: ${kartStr}\n`, font: { ...base, bold:true, color:{ argb:'FFCC0000' } } });
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

  // ── ימים יספיק — days stock will last ────────────────────────────────────
  if(stock != null && stock > 0 && daySales != null && daySales > 0) {
    const daysLeft = Math.round(stock / daySales);
    const dColor = daysLeft < 3 ? 'FFCC0000' : daysLeft < 7 ? 'FFCC6600' : 'FF006600';
    rt.push({ text: `יספיק: ${daysLeft} ימים\n`, font: { bold:true, size:9, name:'Arial', color:{ argb: dColor } } });
  }

  // ── separator before expiry dates ────────────────────────────────────────
  if(pakuot && pakuot.length > 0) {
    rt.push({ text: `────────────────────\n`, font: { size:6, name:'Arial', color:{ argb:'FF9999BB' } } });
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

  if(kratnost > 0) {
    rt.push({ text: `PAL Ashdod=${kratnost}ct\n`, font: { ...base, color:{ argb:'FF6688AA' } } });
  }

  cell.value = { richText: rt };
  cell.alignment = { wrapText:true, vertical:'top', horizontal:'right', readingOrder:2 };
  // Yellow background for products with no 90-day average daily sales (מכר ממוצע ביום)
  const noSales = daySales == null;
  const fc = noSales ? { argb: 'FFFFF2CC' } : { argb: famColor(fam) };
  const borderLeft = noSales ? { argb: 'FFFFCC00' } : fc;
  cell.fill = { type:'pattern', pattern:'solid', fgColor: fc };
  cell.border = {
    top:    {style:'thin'},
    right:  {style:'thin'},
    bottom: {style:'thin'},
    left:   {style:'medium', color: borderLeft},
  };
}

function emptyCell(cell, pick) {
  cell.value = `#${pick}\nפנוי`;
  cell.alignment = { wrapText:true, vertical:'middle', horizontal:'center' };
  cell.font = { size:10, bold:true, color:{argb:'FFCCCCCC'} };
  cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFAFAFA' } };
  cell.border = { top:{style:'thin',color:{argb:'FFE0E0E0'}}, bottom:{style:'thin',color:{argb:'FFE0E0E0'}}, left:{style:'thin',color:{argb:'FFE0E0E0'}}, right:{style:'thin',color:{argb:'FFE0E0E0'}} };
}

// Zero-stock cell: reserved slot — gray fill, product name visible
function zeroStockCell(cell, pick, makat, desc, fam) {
  const name = desc ? fixVisualRTL(String(desc).replace(/[​-‏‪-‮﻿]/g,'').replace(/\s*\([^)]*\)/g,'').trim()) : '';
  cell.value = { richText: [
    { text: `#${pick}\n`,  font: { size:8, name:'Arial', color:{ argb:'FFAAAAAA' } } },
    { text: `${makat}\n`,  font: { size:8, name:'Arial', color:{ argb:'FFAAAAAA' } } },
    { text: `${name}\n`,   font: { bold:true, size:9, name:'Arial', color:{ argb:'FF999999' } } },
    { text: `אפס מלאי`,   font: { size:9, name:'Arial', color:{ argb:'FF999999' } } },
  ]};
  cell.alignment = { wrapText:true, vertical:'middle', horizontal:'center', readingOrder:2 };
  cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFE0E0E0' } };
  cell.border = {
    top:    { style:'thin', color:{ argb:'FFCCCCCC' } },
    right:  { style:'thin', color:{ argb:'FFCCCCCC' } },
    bottom: { style:'thin', color:{ argb:'FFCCCCCC' } },
    left:   { style:'thin', color:{ argb:'FFCCCCCC' } },
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
  const isValesta = k => /VALEST/i.test(k);
  const order = Object.keys(fams).sort((a,b)=>{
    if(isValesta(a) && !isValesta(b)) return 1;
    if(!isValesta(a) && isValesta(b)) return -1;
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
    const rawName = p.nameEn || p.desc;
    const name = rawName
      ? fixVisualRTL(String(rawName).replace(/[​-‏‪-‮﻿]/g, '').trim())
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

// ─── Simplified cell: name + מקט + מלאי קרט + מלאי PAL + kratnost ────────
function fillCellSimple(cell, pick, makat, desc, fam, stock, kratnost) {
  const name    = desc ? fixVisualRTL(String(desc).replace(/[​-‏‪-‮﻿]/g,'').replace(/\s*\([^)]*\)/g,'').trim()) : '';
  const palStock = (kratnost > 0 && stock > 0) ? (stock / kratnost).toFixed(1) : null;
  const rt = [
    { text: `#${pick}\n`,  font: { size:8, name:'Arial', color:{argb:'FF888888'} } },
    { text: `${makat}\n`,  font: { size:8, name:'Arial', color:{argb:'FF444444'} } },
    { text: `${name}\n`,   font: { size:10, bold:true, name:'Arial' } },
  ];
  if(stock > 0) {
    rt.push({ text: `מלאי: ${Math.round(stock)} קרט\n`, font: { size:9, name:'Arial' } });
    if(palStock) {
      rt.push({ text: `מלאי: ${palStock} PAL\n`, font: { size:11, bold:true, name:'Arial', color:{argb:'FF1565C0'} } });
    }
    if(kratnost > 0) {
      rt.push({ text: `PAL Ashdod=${kratnost}ct\n`, font: { size:8, name:'Arial', color:{argb:'FF888888'} } });
    } else {
      rt.push({ text: `אין נתון PAL\n`, font: { size:8, name:'Arial', color:{argb:'FFCC0000'} } });
    }
  } else {
    rt.push({ text: `אפס מלאי\n`, font: { size:11, bold:true, name:'Arial', color:{argb:'FFCC0000'} } });
  }
  cell.value = { richText: rt };
  cell.alignment = { wrapText:true, vertical:'top', horizontal:'right', readingOrder:2 };
  const fc = famColor(fam);
  cell.fill   = { type:'pattern', pattern:'solid', fgColor:{argb: fc} };
  cell.border = { top:{style:'thin'}, right:{style:'thin'}, bottom:{style:'thin'}, left:{style:'medium', color:{argb: fc}} };
}

// ─── Apply simplified view to a blank sheet ───────────────────────────────
function applySimpleSheet(ws, pickMap, prodsByPick, palletMap) {
  const cols = new Set(); const rows = new Set();
  for(const [pickStr, pos] of Object.entries(pickMap)) {
    const pick = parseInt(pickStr);
    const cell = ws.getCell(pos.row, pos.col);
    const p = prodsByPick[pick];
    if(p && p.stock > 0) {
      const kratnost = palletMap && palletMap[String(p.makat)] || 0;
      fillCellSimple(cell, pick, p.makat, p.nameEn || p.desc, p.fam, p.stock, kratnost);
    } else if(p) {
      cell.value = `#${pick}\nאפס מלאי`;
      cell.alignment = { wrapText:true, vertical:'middle', horizontal:'center' };
      cell.font  = { size:9, bold:true, color:{argb:'FFCC0000'} };
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFEEEE'} };
    } else {
      cell.value = `#${pick}\nפנוי`;
      cell.alignment = { wrapText:true, vertical:'middle', horizontal:'center' };
      cell.font  = { size:9, color:{argb:'FFCCCCCC'} };
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFAFAFA'} };
    }
    cols.add(pos.col); rows.add(pos.row);
  }
  for(const r of rows) ws.getRow(r).height = 110;
  for(const c of cols) { const col = ws.getColumn(c); if(!col.width || col.width < 22) col.width = 22; }
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
        zeroStockCell(cell, pick, p.makat, p.desc, p.fam);
        zeroStock.push(p);
      } else {
        const kratnost = usePallets ? (palletMap && palletMap[String(p.makat)] || 0) : 0;
        const pct = (totalDayAvg > 0 && p.dayAvg != null) ? (p.dayAvg / totalDayAvg * 100) : null;
        fillCell(cell, pick, p.makat, p.fam, p.dayAvg, p.daySales||null, p.ss, p.stock, p.weight, p.nameEn || p.desc, weightThresh, dayThreshHigh, dayThreshMid, kratnost, pct, p.pakuot||[]);
      }
      rowsToResize.add(pos.row);
      colsToResize.add(pos.col);
    } else {
      emptyCell(cell, pick);
      colsToResize.add(pos.col);
      rowsToResize.add(pos.row);
    }
  }
  for(const r of rowsToResize) ws.getRow(r).height = 160;
  for(const c of colsToResize) {
    const col = ws.getColumn(c);
    if(!col.width || col.width < 32) col.width = 32;
  }
  return zeroStock;
}

// ─── Family legend bar (row 2, after summary header) ─────────────────────
// Each label sits above the first planogram column of its family.
// Style: white bg + thick colored bottom border (professional tab look).
function addFamilyNavBar(ws, pickCells, prodsByPick, refreshLabel) {
  // Build family → first column (col is stable across spliceRows)
  const famFirstCol = {};
  const famOrder    = [];
  const seenFam     = new Set();
  for(const pick of Object.keys(pickCells).map(Number).sort((a,b)=>a-b)) {
    const p = prodsByPick[pick];
    if(!p || !p.fam) continue;
    if(!seenFam.has(p.fam)) {
      seenFam.add(p.fam);
      famOrder.push(p.fam);
      famFirstCol[p.fam] = pickCells[pick].col;
    }
  }
  if(!famOrder.length) return;

  ws.spliceRows(2, 0, []);
  const navRow  = ws.getRow(2);
  navRow.height = 30;

  famOrder.forEach((fam) => {
    const col = famFirstCol[fam];
    const c   = ws.getCell(2, col);
    const fc  = famColor(fam);
    c.value     = fam;
    c.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFFFFF' } };
    c.font      = { bold:true, size:9, name:'Arial', color:{ argb:'FF222222' } };
    c.alignment = { horizontal:'center', vertical:'middle', wrapText:false, shrinkToFit:true };
    c.border    = {
      top:    { style:'thin',   color:{ argb:'FFE0E0E0' } },
      left:   { style:'thin',   color:{ argb:'FFE0E0E0' } },
      right:  { style:'thin',   color:{ argb:'FFE0E0E0' } },
      bottom: { style:'medium', color:{ argb: fc } },
    };
  });

  // Refresh timestamp — after last family column
  if(refreshLabel) {
    const maxCol = Math.max(...Object.values(famFirstCol));
    const tsCell = ws.getCell(2, maxCol + 2);
    tsCell.value     = refreshLabel;
    tsCell.font      = { bold:true, size:10, name:'Arial', color:{ argb:'FF333333' } };
    tsCell.alignment = { horizontal:'right', vertical:'middle' };
    tsCell.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFFFFF' } };
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

// ─── Add new-family products section below planogram (overflow) ──────────
// prods: [{pick, makat, fam, desc, stock, daySales, dayAvg, pakuot, ...}]
function addOverflowSection(ws, prods, palletMap, weightThresh, dayThreshHigh, dayThreshMid) {
  const COLS     = 9;
  const startRow = (ws.lastRow ? ws.lastRow.number : 50) + 3;

  const titleCell = ws.getCell(startRow, 1);
  titleCell.value = `🆕 מוצרים חדשים מהמשפחות — סטטוס פעיל (${prods.length})`;
  titleCell.font  = { bold:true, size:12, name:'Arial', color:{ argb:'FF1565C0' } };
  titleCell.alignment = { horizontal:'right', readingOrder:2 };
  ws.getRow(startRow).height = 22;

  prods.forEach((p, i) => {
    const r   = startRow + 1 + Math.floor(i / COLS);
    const c   = (i % COLS) + 1;
    const cell = ws.getCell(r, c);
    const kratnost = palletMap[String(p.makat)] || 0;
    if (p.stock > 0) {
      fillCell(cell, p.pick, p.makat, p.fam, p.dayAvg, p.daySales, p.ss,
               p.stock, p.weight, p.nameEn || p.desc,
               weightThresh, dayThreshHigh, dayThreshMid, kratnost, null, p.pakuot || []);
    } else {
      zeroStockCell(cell, p.pick, p.makat, p.nameEn || p.desc, p.fam);
    }
    ws.getRow(r).height = 160;
    const col = ws.getColumn(c);
    if (!col.width || col.width < 32) col.width = 32;
  });
  console.log(`  Overflow: ${prods.length} new products added (rows ${startRow+1}–${startRow+1+Math.floor((prods.length-1)/COLS)})`);
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
  // Trigger PBI refresh only when explicitly requested (SKIP_PBI_REFRESH=1 skips it).
  // When PBI Service gateway refresh is configured, CI should read only — not trigger extra refreshes.
  if (!process.env.SKIP_PBI_REFRESH) {
    await triggerAndWaitRefresh().catch(e => console.warn('⚠  triggerAndWaitRefresh error (non-fatal):', e.message));
  }

  // Load קפוא data from Power BI (replaces קפוא.xlsx)
  // stock = cartons at אשדוד only (מחסן Main, no צפון)
  const allMakatim = Object.values(KAPUA_PICKS).map(p => p.makat);
  const [{ kapuaData, nameEnMap }, lastRefreshRaw] = await Promise.all([
    fetchKapuaFromBI(allMakatim),
    fetchLastRefresh(),
  ]);

  // Fabric returns Israel local time as-is — parse string directly, no timezone conversion
  let refreshLabel = '';
  if (lastRefreshRaw) {
    // raw format: "2026-05-14T19:59:00" or similar
    const m = String(lastRefreshRaw).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (m) {
      refreshLabel = `עודכן: ${m[3]}.${m[2]}, ${m[4]}:${m[5]}`;
      console.log(`SERVER DATE TIME (local): ${lastRefreshRaw} → ${refreshLabel}`);
    }
  }

  for(const pick of Object.keys(KAPUA_PICKS)) {
    const p   = KAPUA_PICKS[pick];
    const src = kapuaData[String(p.makat)];
    if(src) {
      if(!p.desc && src.desc)   p.desc        = src.desc;
      if(src.nameEn)            p.nameEn      = src.nameEn;
      if(src.daySales != null)  p.daySales    = src.daySales;
      p.stock        = src.stock;
      p.stockZafn    = src.stockZafn    ?? null;
      p.daySalesZafn = src.daySalesZafn ?? null;
      p.daysStock    = src.daysStock    ?? null;
      p.daysStockZafn= src.daysStockZafn?? null;
      p.stockTrnz    = src.stockTrnz    ?? null;
      p.daySalesTrnz = src.daySalesTrnz ?? null;
      p.daySalesAll  = src.daySalesAll  ?? null;
      p.pakuot       = src.pakuot     || [];
      p.pakuotZafn   = src.pakuotZafn || [];
      p.spo          = src.spo        ?? null;
      p.openOrders   = src.openOrders ?? null;
    }
  }

  // ── New products from PBI families (פעיל, not in KAPUA_PICKS) ──────────────
  // Exclude makats already assigned to dagim/halavi sections (they share some PBI families)
  const _dagimBase  = JSON.parse(fs.readFileSync(path.join(__dirname,'..','docs','dagim-base.json'),  'utf8'));
  const _halaviBase = JSON.parse(fs.readFileSync(path.join(__dirname,'..','docs','halavi-base.json'), 'utf8'));
  const _otherMakats = new Set([
    ...Object.values(_dagimBase.picks).filter(Boolean).map(p => String(p.makat)),
    ...Object.values(_halaviBase.picks).filter(Boolean).map(p => String(p.makat)),
  ]);
  let newKapuaProds = Object.entries(kapuaData)
    .filter(([mk, d]) => d.isNew && !_otherMakats.has(String(mk)) && !GLOBAL_BLACKLIST.has(String(mk)) && d.daySales > 0)
    .map(([mk, d]) => ({
      makat: mk, fam: d.fam || 'קפוא', desc: d.desc, nameEn: d.nameEn || null,
      stock: d.stock, daySales: d.daySales, daySalesAll: d.daySalesAll,
      stockZafn: d.stockZafn ?? null, daySalesZafn: d.daySalesZafn ?? null,
      daysStock: d.daysStock ?? null, daysStockZafn: d.daysStockZafn ?? null,
      stockTrnz: d.stockTrnz ?? null, daySalesTrnz: d.daySalesTrnz ?? null,
      pakuot: d.pakuot || [], pakuotAll: d.pakuotAll || [],
      dayAvg: d.daySales || null, weight: null, ss: null,
      spo: d.spo ?? null, openOrders: d.openOrders ?? null,
    }));
  // Sort: with sales first (daySales desc), then no-sales at end
  newKapuaProds.sort((a, b) => {
    const aS = a.daySales != null && a.daySales > 0;
    const bS = b.daySales != null && b.daySales > 0;
    if (aS && !bS) return -1;
    if (!aS && bS) return 1;
    return (b.daySales || 0) - (a.daySales || 0);
  });
  const maxKapuaPick = Math.max(...Object.keys(KAPUA_PICKS).map(Number));
  newKapuaProds.forEach((p, i) => { p.pick = maxKapuaPick + 1 + i; });
  if (newKapuaProds.length)
    console.log(`🆕 New קפוא products: ${newKapuaProds.length} (picks ${maxKapuaPick+1}–${maxKapuaPick+newKapuaProds.length})`);

  // חלבי — from PBI / KARTIS PARIT (replaces MAHSAN חלבי/חלבי.xlsx)
  const halaviData = await fetchHalaviFromBI();
  const halaviProds = Object.values(halaviData);
  for (const [mk, p] of Object.entries(halaviData)) {
    if (p.desc) nameEnMap[mk] = p.desc;
  }

  // דגים — from PBI / KARTIS PARIT (replaces MAHSAN דגים/דגים.xlsx)
  const dagimData = await fetchDagimFromBI();
  const dagimProds = Object.values(dagimData);
  for (const [mk, p] of Object.entries(dagimData)) {
    if (p.desc) nameEnMap[mk] = p.desc;
  }

  console.log(`חלבי: ${halaviProds.length} active (from PBI) | דגים: ${dagimProds.length} active (from PBI)`);

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
    await wbPal.xlsx.readFile(path.join(__dirname, 'FORMULA PALLETS.xlsx'));
    // חטיף גבינה: FORMULA PALLETS col10 = cartons/layer; pallet = 9 layers → ×9
    const PAL_FACTOR_9 = new Set(['815','816','817','818','819','820','821','822','825','826']);
    wbPal.worksheets[0].eachRow((row,r)=>{
      if(r===1) return;
      const makat = String(row.getCell(1).value||'');
      const krat  = parseFloat(row.getCell(10).value||0);
      if(makat && krat > 0)
        palletMap[makat] = PAL_FACTOR_9.has(makat) ? krat * 9 : krat;
    });
    console.log(`Pallet map loaded: ${Object.keys(palletMap).length} products`);
  }

  // Weight per unit (kg) from FORMULA PALLETS col8
  const weightMap = {};
  {
    const wbPal = new ExcelJS.Workbook();
    await wbPal.xlsx.readFile(path.join(__dirname, 'FORMULA PALLETS.xlsx'));
    wbPal.worksheets[0].eachRow((row,r)=>{
      if(r===1) return;
      const makat = String(row.getCell(1).value||'');
      const wt    = parseFloat(row.getCell(8).value||0);
      if(makat && wt > 0) weightMap[makat] = wt;
    });
  }

  // Load the template (MAHSAN 8.xlsx — 3 sheets)
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, 'MAHSAN 8.xlsx'));

  // Clear yellow/colored separator rows (thin divider rows in template)
  wb.worksheets.forEach(ws => {
    ws.eachRow((row) => {
      if(row.height != null && row.height < 8) {
        row.eachCell({ includeEmpty: false }, cell => {
          cell.fill = { type:'pattern', pattern:'none' };
        });
      }
    });
  });

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
    // All products stay in place — zero-stock shown gray, not compacted out
    const regularAll     = regularKeys.map(k=>KAPUA_PICKS[k]);
    const regularPickNums = picks.filter(p=>!PINNED.has(p));
    const compactedKapua = {};
    regularPickNums.forEach((pick,i)=>{ if(regularAll[i]) compactedKapua[pick]=regularAll[i]; });
    // Pinned: always at their designated physical position (VALESTA + מוסדי)
    pinnedKeys.forEach(k=>{ compactedKapua[k]=KAPUA_PICKS[k]; });
    const kapuaZeroList = Object.values(compactedKapua).filter(p=>p.stock!=null&&p.stock<=0);
    console.log(`\nקפוא picks found: ${picks.length} (${picks[0]}..${picks[picks.length-1]}) | total ORD: ${Math.round(kapuaTotalOrd)} | PAL/d: ${kapuaTotalPal.toFixed(1)}`);
    applyToSheet(shKapua, pickCells, compactedKapua, weightThresh, dayThreshHigh, dayThreshMid, palletMap, true, kapuaTotalOrd);
    addZeroStockTable(shKapua, kapuaZeroList);
    if (newKapuaProds.length)
      addOverflowSection(shKapua, newKapuaProds, palletMap, weightThresh, dayThreshHigh, dayThreshMid);
    shKapua.name = 'MAHSAN 8 קפוא';
    addSeqSheet(wb, 'סדר קפוא', KAPUA_PICKS, 'FFCCE5FF');

    // ── Simplified קפוא sheet ──────────────────────────────────────────────
    const shSimple = wb.addWorksheet('קפוא מינימלי', { views:[{rightToLeft:true}] });
    applySimpleSheet(shSimple, pickCells, compactedKapua, palletMap);
  }

  // Hoisted: saved for JSON export at the end
  let halaviProdMapForJSON = {};
  let dagimProdMapForJSON  = {};

  // ── SHEET: MAHSAN חלבי ─────────────────────────────────────────────────
  const shHalavi = wb.getWorksheet('MAHSAN חלבי');
  {
    // Compact fill: zero-stock products skip slots (same rule as קפוא)
    const halaviZeroList = halaviProds.filter(p => p.stock != null && p.stock <= 0);

    const picksCountScan = Object.keys(collectPickCells(shHalavi)).length;
    const assigned = assignByLogic(halaviProds, picksCountScan);

    const prodMapH = {};
    Object.keys(collectPickCells(shHalavi)).map(Number).sort((a,b)=>a-b)
      .forEach((pick,i) => { if(assigned[i]) prodMapH[pick] = assigned[i]; });

    const halaviTotalOrd = Object.values(prodMapH).reduce((s,p)=>s+(p.dayAvg||0),0);
    addSummaryHeader(shHalavi, 'חלבי', halaviTotalOrd, 0, halaviProds.length - halaviZeroList.length, halaviZeroList.length, grandTotalOrd);
    shHalavi.views = [{...((shHalavi.views||[])[0]||{}), state:'frozen', ySplit:1, topLeftCell:'A2'}];
    // rescan after insert
    const pickCells = collectPickCells(shHalavi);
    const picks     = Object.keys(pickCells).map(Number).sort((a,b)=>a-b);
    const prodMap   = {};
    picks.forEach((pick,i) => { if(assigned[i]) prodMap[pick] = assigned[i]; });
    console.log(`חלבי picks found: ${picks.length} | in-stock: ${halaviProds.length - halaviZeroList.length} | zero: ${halaviZeroList.length} | total ORD: ${Math.round(halaviTotalOrd)}`);
    halaviProdMapForJSON = prodMap; // save for JSON export
    applyToSheet(shHalavi, pickCells, prodMap, weightThresh, dayThreshHigh, dayThreshMid, palletMap, true, halaviTotalOrd);
    addZeroStockTable(shHalavi, halaviZeroList);
    addSeqSheet(wb, 'סדר חלבי', prodMap, 'FFD5F5D5');
  }

  // ── SHEET: MAHSAN דגים ─────────────────────────────────────────────────
  // NORD PORT → R6 (one face), SANTA BREMOR → dock(R5) + R8 + R9 (other face)
  const shDagim = wb.getWorksheet('MAHSAN דגים');
  {
    // Build prodMap first (need it for stats before header insert)
    const preScanPicks = Object.keys(collectPickCells(shDagim)).map(Number).sort((a,b)=>a-b);
    const FACE_A_pre = new Set([10,12,14,16,18,20,22,24,26,28,29,30,31,33,35,37,39,41,43,45,47,49,51,53,55]); // SB (25 slots)
    const FACE_B_pre = new Set([11,13,15,17,19,21,23,25,27,32,34,36,38,40,42,44,46,48,50,52,54,56,57,58]); // NP (24 slots, 57+58=IKRA)
    const BACK_pre   = new Set(); // picks 59-94 = reserve slots, not NP overflow
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
    const FACE_A  = new Set([10,12,14,16,18,20,22,24,26,28,29,30,31,33,35,37,39,41,43,45,47,49,51,53,55]); // SB row6 (25 slots)
    const FACE_B  = new Set([11,13,15,17,19,21,23,25,27,32,34,36,38,40,42,44,46,48,50,52,54,56,57,58]);   // NP row4 (24 slots, 57+58=IKRA)
    const BACK    = new Set();                                                                               // empty — picks 59-94 = reserve
    const DOCK    = new Set([1,2,3,4,5,6,7,8,9]);                                                          // מצונן row3

    // Split by family, filter zero-stock (compact fill — same rule as קפוא/חלבי),
    // sort by weight desc within each
    const inStock = p => !(p.stock != null && p.stock <= 0);
    const nordPortMatz = dagimProds.filter(p=>p.fam==='NORD PORT מצונן').sort((a,b)=>(b.weight||0)-(a.weight||0));
    const nordPort     = dagimProds.filter(p=>p.fam==='NORD PORT'        ).sort((a,b)=>(b.weight||0)-(a.weight||0));
    const santaBremor  = dagimProds.filter(p=>p.fam==='SANTA BREMOR Fish').sort((a,b)=>(b.weight||0)-(a.weight||0));
    const dagimZeroList = dagimProds.filter(p=>p.stock!=null&&p.stock<=0);

    console.log(`  NORD PORT מצונן: ${nordPortMatz.length} | NORD PORT: ${nordPort.length} | SANTA BREMOR: ${santaBremor.length}`);
    console.log(`  DOCK(R5): ${[...DOCK].length} slots (NP מצונן) | Face A(R6): ${[...FACE_A].length} slots (SB) | FaceB+Back: ${[...FACE_B].length+[...BACK].length} slots (NP)`);

    const prodMap = {};

    // NORD PORT מצונן → DOCK (R5, picks 1-9)
    // Reserved for מצונן only — stays פנוי when empty (do NOT fill with regular NORD PORT)
    allPicks.filter(p=>DOCK.has(p))
      .forEach((pick,i) => { if(nordPortMatz[i]) prodMap[pick] = nordPortMatz[i]; });

    // SANTA BREMOR → Face A (R6)
    allPicks.filter(p=>FACE_A.has(p))
      .forEach((pick,i) => { if(santaBremor[i]) prodMap[pick] = santaBremor[i]; });

    // NORD PORT → Face B only (picks 59-94 are reserve, not overflow)
    const npSlots = [...allPicks.filter(p=>FACE_B.has(p))];
    npSlots.forEach((pick,i) => { if(nordPort[i]) prodMap[pick] = nordPort[i]; });

    dagimProdMapForJSON = prodMap; // save for JSON export
    console.log(`דגים total ORD/day: ${dagimTotalOrd.toFixed(0)} | zero: ${dagimZeroList.length}`);
    applyToSheet(shDagim, pickCells, prodMap, weightThresh, dayThreshHigh, dayThreshMid, palletMap, true, dagimTotalOrd);
    addZeroStockTable(shDagim, dagimZeroList);
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
    const sh = wb.addWorksheet('צפון מלאי פחות מ3DAYS SALES');
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

    // ── Table 3: סכנת השמדה — all warehouses (pakuotAll + daySalesAll) ────────
    // Uses all-warehouse stock and all-warehouse sales: "סכנה לכול פקא" logic
    const isDangerProduct = p => {
      const paks = p.pakuotAll && p.pakuotAll.length ? p.pakuotAll : (p.pakuot || []);
      const sales = p.daySalesAll || p.daySales;
      return paks.some(pak => {
        if(pak.daysLeft == null || pak.cartons <= 0) return false;
        const sellDays = (sales && sales > 0) ? pak.cartons / sales : Infinity;
        return pak.daysLeft < sellDays;
      });
    };
    const dangerBatches = p => {
      const paks = p.pakuotAll && p.pakuotAll.length ? p.pakuotAll : (p.pakuot || []);
      const sales = p.daySalesAll || p.daySales;
      return paks.filter(pak => {
        if(pak.daysLeft == null || pak.cartons <= 0) return false;
        const sellDays = (sales && sales > 0) ? pak.cartons / sales : Infinity;
        return pak.daysLeft < sellDays;
      });
    };
    const allMainProds = [
      ...Object.values(KAPUA_PICKS),
      ...newKapuaProds,
      ...halaviProds,
      ...dagimProds,
    ];
    const dangerPicks = allMainProds
      .filter(isDangerProduct)
      .map(p => ({
        makat   : p.makat,
        desc    : p.desc,
        stock   : p.stock || 0,
        daySales: p.daySales,
        pakuot  : dangerBatches(p),
      }))
      .sort((a,b) => {
        const minA = Math.min(...a.pakuot.map(pk => pk.daysLeft??9999));
        const minB = Math.min(...b.pakuot.map(pk => pk.daysLeft??9999));
        return minA - minB;
      });
    renderSakanaSection(sh, dangerPicks, 'סכנת השמדה — Main  (פק"ע פגה לפני מכירה)');

    console.log(`מחסן צפון sheet: under3=${zafn.under3.length} | סכנה Zafn=${zafn.sakana.length} | סכנה Main=${dangerPicks.length}`);
  }

  // Hide sheets not ready for publishing
  if(HIDDEN_SHEETS.length) {
    wb.worksheets.forEach(ws => { if(HIDDEN_SHEETS.includes(ws.name)) ws.state = 'hidden'; });
    if(HIDDEN_SHEETS.length) console.log(`Hidden: ${HIDDEN_SHEETS.join(', ')}`);
  }

  // ── Export product-data.json + kapua-base.json for planogram editor ──────
  {

    // ── refresh-info.json ────────────────────────────────────────────────
    {
      const buildNow = new Date();
      const pad = n => String(n).padStart(2,'0');
      const buildLabel = `${pad(buildNow.getDate())}.${pad(buildNow.getMonth()+1)}.${buildNow.getFullYear()}, ${pad(buildNow.getHours())}:${pad(buildNow.getMinutes())}`;
      let pbiLabel = null;
      if (lastRefreshRaw) {
        const m = String(lastRefreshRaw).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        pbiLabel = m ? `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}` : String(lastRefreshRaw);
      }
      fs.writeFileSync(path.join(__dirname,'..','docs','refresh-info.json'),
        JSON.stringify({ iso: lastRefreshRaw, label: pbiLabel, buildAt: buildNow.toISOString(), buildLabel }), 'utf8');
      console.log(`SERVER DATE TIME (local): ${buildNow.toISOString()} → עודכן: ${buildLabel}`);
    }

    // ── product-data.json ────────────────────────────────────────────────
    // Preserve stable fields from existing file — survives workflow errors/missing Fabric data
    const existingProdDataPath = path.join(__dirname,'..','docs','product-data.json');
    let prevAshdod = {}, prevPackFactor = {}, prevWeightCarton = {}, prevYaveshData = {};
    try {
      const prev = JSON.parse(fs.readFileSync(existingProdDataPath, 'utf8'));
      for (const [mk, v] of Object.entries(prev)) {
        if (v && v.ashdodPalletCartons != null) prevAshdod[mk]     = v.ashdodPalletCartons;
        if (v && v.packFactor          != null) prevPackFactor[mk] = v.packFactor;
        if (v && v.weightCarton        != null) prevWeightCarton[mk] = v.weightCarton;
        if (v && v.yavesh)                      prevYaveshData[mk]  = v;
      }
    } catch {}

    const mkEntry = (p) => {
      const mk  = String(p.makat);
      const krat = palletMap[mk] || 0;
      const wt   = weightMap[mk] || null;
      const dsa  = p.daySalesAll != null ? p.daySalesAll : p.daySales;
      const kd   = kapuaData[mk];
      const pf   = kd?.packFactor || prevPackFactor[mk]   || null;
      const wc   = prevWeightCarton[mk] || (wt && pf ? +(wt * pf).toFixed(2) : null);
      const szafn = p.stockZafn != null ? Math.round(p.stockZafn) : null;
      const strnz = p.stockTrnz != null ? Math.round(p.stockTrnz) : null;
      return {
        stock:               p.stock    != null ? Math.round(p.stock)    : null,
        daySales:            p.daySales != null ? +p.daySales.toFixed(1) : null,
        kratnost:            krat,
        palStock:            (krat > 0 && p.stock > 0) ? +(p.stock / krat).toFixed(1) : null,
        stockZafn:           szafn,
        palStockZafn:        (krat > 0 && szafn > 0)   ? +(szafn / krat).toFixed(1) : null,
        daySalesZafn:        p.daySalesZafn != null ? +p.daySalesZafn.toFixed(1) : null,
        daysStock:           p.daysStock     != null ? Math.round(p.daysStock)     : null,
        daysStockZafn:       p.daysStockZafn != null ? Math.round(p.daysStockZafn) : null,
        stockTrnz:           strnz,
        palStockTrnz:        (krat > 0 && strnz > 0)   ? +(strnz / krat).toFixed(1) : null,
        daySalesTrnz:        p.daySalesTrnz != null ? +p.daySalesTrnz.toFixed(1) : null,
        weight:              wt != null ? +wt.toFixed(3) : null,
        packFactor:          pf,
        weightCarton:        wc,
        daySalesAll:         dsa != null ? +dsa.toFixed(1) : null,
        daysStockAll:        (dsa > 0 && p.stock > 0) ? Math.round(p.stock / dsa) : null,
        nameEn:              nameEnMap[mk] ? fixVisualRTL(nameEnMap[mk].replace(/\s*\([^)]*\)/g, '').trim()) : null,
        fam:                 p.fam ? (p.fam.replace(/[‎‏‪-‮⁦-⁩﻿]/g,'').trim()) || null : null,
        iksGroup:            p.iksGroup || null,
        ashdodPalletCartons: prevAshdod[mk] ?? null,
        pakuot:              (p.pakuot || kd?.pakuot || []).map(b => ({ date: b.date ? new Date(b.date).toISOString().slice(0,10) : null, daysLeft: b.daysLeft, cartons: b.cartons })),
        pakuotZafn:          (p.pakuotZafn || kd?.pakuotZafn || []).map(b => ({ date: b.date ? new Date(b.date).toISOString().slice(0,10) : null, daysLeft: b.daysLeft, cartons: b.cartons })),
        shelfLife:           p.shelfLife ?? kd?.shelfLife ?? null,
        stopSale:            p.stopSale  ?? kd?.stopSale  ?? false,
        spo:                 p.spo > 0 ? p.spo : null,
        openOrders:          p.openOrders > 0 ? p.openOrders : null,
      };
    };

    const prodData = {};
    for (const [, p] of Object.entries(KAPUA_PICKS)) {
      if (!p.makat) continue;
      prodData[String(p.makat)] = mkEntry(p);
    }
    for (const p of newKapuaProds) {
      if (!p.makat) continue;
      prodData[String(p.makat)] = mkEntry(p);
    }
    // Add any kapua-base.json picks not in hardcoded KAPUA_PICKS (e.g. 819-826 חטיף גבינה)
    // Also auto-clean: if same makat appears at 2+ positions within kapua-base.json, keep lowest pick only
    try {
      const kbPath = path.join(__dirname,'..','docs','kapua-base.json');
      const kbJson = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
      const seenMakats = {};
      let kbDupCleaned = 0;
      for (const [bay, p] of Object.entries(kbJson.picks || {})) {
        if (!p || !p.makat) continue;
        const mk = String(p.makat);
        if (seenMakats[mk]) {
          // duplicate within kapua-base.json — remove higher-numbered pick
          const prevBay = seenMakats[mk];
          const removeFrom = Number(bay) > Number(prevBay) ? bay : prevBay;
          if (removeFrom !== bay) seenMakats[mk] = bay;
          kbJson.picks[removeFrom] = null;
          kbDupCleaned++;
          console.log(`🧹 kapua-base.json: removed dup מקט ${mk} from pick ${removeFrom}`);
        } else {
          seenMakats[mk] = bay;
        }
        if (!prodData[mk]) {
          const kd = kapuaData[mk] || {};
          prodData[mk] = mkEntry({ ...p, stock: kd.stock ?? 0, daySales: kd.daySales ?? null, daySalesAll: kd.daySalesAll ?? null, stockZafn: kd.stockZafn ?? null, daySalesZafn: kd.daySalesZafn ?? null, daysStock: kd.daysStock ?? null, daysStockZafn: kd.daysStockZafn ?? null, stockTrnz: kd.stockTrnz ?? null, daySalesTrnz: kd.daySalesTrnz ?? null, pakuot: kd.pakuot || [], pakuotAll: kd.pakuotAll || [], spo: kd.spo ?? null, openOrders: kd.openOrders ?? null });
        }
      }
      if (kbDupCleaned > 0) {
        fs.writeFileSync(kbPath, JSON.stringify(kbJson, null, 2), 'utf8');
        console.log(`kapua-base.json: auto-cleaned ${kbDupCleaned} internal duplicates`);
      }
    } catch(e) { console.warn('kapua-base.json extra picks skipped:', e.message); }

    // ── Auto-rescue: KAPUA_PICKS products with stock/sales missing from kapua-base.json ──
    try {
      const kbPath = path.join(__dirname,'..','docs','kapua-base.json');
      const kbData = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
      const kbMakats = new Set(Object.values(kbData.picks || {}).filter(Boolean).map(p => String(p.makat)));
      const kbReserveStart = kbData.reserveStart || 9999;
      let kbChanged = false;
      for (const [, p] of Object.entries(KAPUA_PICKS)) {
        const mk = String(p.makat);
        if (kbMakats.has(mk)) continue;
        const d = kapuaData[mk] || {};
        if (!(d.stock > 0) && !(d.daySales > 0)) continue;
        const reserveBays = Object.keys(kbData.picks).map(Number).filter(b => b >= kbReserveStart).sort((a,b)=>a-b);
        const emptySlot = reserveBays.find(b => !kbData.picks[String(b)]);
        if (emptySlot != null) {
          kbData.picks[String(emptySlot)] = { makat: mk, fam: p.fam || 'קפוא', name: null };
          kbMakats.add(mk);
          kbChanged = true;
          console.log(`🔧 Auto-rescue קפוא: מקט ${mk} (${p.fam}) → reserve slot ${emptySlot} (stock=${d.stock}, sales/day=${d.daySales})`);
        } else {
          console.warn(`⚠️ Auto-rescue: מקט ${mk} has stock but no empty reserve slot in kapua-base.json`);
        }
      }
      if (kbChanged) {
        kbData.v = new Date().toISOString().slice(0,10) + '-autorescue-kapua';
        fs.writeFileSync(kbPath, JSON.stringify(kbData, null, 2), 'utf8');
      }
    } catch(e) { console.warn('Auto-rescue kapua skipped:', e.message); }

    for (const p of [...halaviProds, ...dagimProds]) {
      if (!p.makat) continue;
      prodData[String(p.makat)] = mkEntry(p);
    }

    // ── דג יבש — fetch stock/sales from Fabric and add to prodData ──────────
    const dagyaveshBase  = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'docs', 'dagim-yavesh-base.json'), 'utf8'));
    const dagyaveshPicks = dagyaveshBase.picks || dagyaveshBase;
    const dagyaveshMakatim = [...new Set(
      Object.values(dagyaveshPicks).filter(Boolean).map(v => String(v.makat)).filter(Boolean)
    )];
    {
      if (dagyaveshMakatim.length) {
        const [dyStockMap, dyShelfLifeMap] = await Promise.all([
          fetchStockMain(dagyaveshMakatim),
          fetchShelfLifeForMakats(dagyaveshMakatim),
        ]);
        for (const [, item] of Object.entries(dagyaveshPicks)) {
          if (!item) continue;
          const mk = String(item.makat);
          if (!mk) continue;
          if (prodData[mk]) continue; // already in another section
          const fm = dyStockMap[mk] || {};
          const p = {
            makat: mk, fam: item.fam, name: item.name,
            stock:         fm.stock         ?? 0,
            daySales:      fm.daySales      ?? null,
            daySalesAll:   fm.daySalesAll   ?? null,
            stockZafn:     fm.stockZafn     ?? null,
            daySalesZafn:  fm.daySalesZafn  ?? null,
            daysStock:     fm.daysStock     ?? null,
            daysStockZafn: fm.daysStockZafn ?? null,
            stockTrnz:     fm.stockTrnz     ?? null,
            daySalesTrnz:  fm.daySalesTrnz  ?? null,
            pakuot: [], pakuotAll: [],
            shelfLife:    dyShelfLifeMap[mk] ?? null,
          };
          const entry = mkEntry(p);
          entry.yavesh = true;
          prodData[mk] = entry;
        }
        console.log(`דג יבש (base): ${dagyaveshMakatim.length} מקטים → product-data.json`);
      }
    }

    // ── דג יבש — merge into product-data.json (cartons only, no pallets) ─────
    // If product-data.json already has yavesh entries with pakuot (= first CI run already fetched fresh data),
    // reuse that data instead of hitting PBI again (second CI run has rate-limit risk from prior queries).
    {
      const yaveshAlreadyFresh = Object.values(prevYaveshData).some(v => v.pakuot && v.pakuot.length > 0);
      let yaveshAdded = 0;
      if (yaveshAlreadyFresh) {
        for (const [mk, v] of Object.entries(prevYaveshData)) { prodData[mk] = v; yaveshAdded++; }
        console.log(`דג יבש: reused ${yaveshAdded} fresh entries from product-data.json (skip re-fetch)`);
      } else {
        const { dagimYaveshData } = await fetchDagimYaveshFromBI(dagyaveshMakatim);
        for (const [mk, d] of Object.entries(dagimYaveshData)) {
          if (d.stock <= 0 && !d.daySales365) continue; // keep if stock OR sold in last 365d
          const stockAll = d.pakuotAll.reduce((s, p) => s + (p.cartons || 0), 0);
          prodData[mk] = {
            stock:        d.stock        || 0,
            daySales:     d.daySales     || null,
            daySales365:  d.daySales365  || null,
            pakuot:       d.pakuot       || [],
            pakuotAll:    d.pakuotAll    || [],
            daySalesAll:  d.daySalesAll  || null,
            daysStockAll: (d.daySalesAll > 0 && stockAll > 0) ? Math.round(stockAll / d.daySalesAll) : null,
            stockZafn:    d.stockZafn    || null,
            daySalesZafn: d.daySalesZafn || null,
            pakuotZafn:   d.pakuotZafn   || [],
            nameEn:       d.nameEn ? fixVisualRTL(d.nameEn) : (d.desc ? fixVisualRTL(d.desc) : null),
            desc:         d.desc  ? fixVisualRTL(d.desc)  : null,
            shelfLife:    d.shelfLife    ?? null,
            yavesh:       true,
          };
          yaveshAdded++;
        }
        console.log(`דג יבש: ${yaveshAdded} מקטים → product-data.json`);
      }

      // Force yavesh:true on all base picks
      for (const [, item] of Object.entries(dagyaveshPicks)) {
        if (!item) continue;
        const mk = String(item.makat);
        if (prodData[mk]) prodData[mk].yavesh = true;
      }

      // ── dagim-yavesh-base.json: auto-sync new products into reserve slots ──
      {
        const ybPath = path.join(__dirname, '..', 'docs', 'dagim-yavesh-base.json');
        const yb = JSON.parse(fs.readFileSync(ybPath, 'utf8'));
        const ybPicks = yb.picks || yb;
        const ybMakatSet = new Set(
          Object.values(ybPicks).filter(Boolean).map(p => String(p.makat))
        );

        // Clean reserve: remove only if stock=0 AND daySales365=0
        let yCleaned = 0;
        for (const [bay, pick] of Object.entries(ybPicks)) {
          if (!pick || Number(bay) < (yb.reserveStart || 54)) continue;
          const d = dagimYaveshData[String(pick.makat)];
          if (!d || ((d.stock || 0) <= 0 && (d.daySales365 || 0) <= 0)) {
            ybPicks[bay] = null;
            yCleaned++;
          }
        }

        const emptySlots = Object.keys(yb.layout || ybPicks)
          .map(Number)
          .sort((a, b) => a - b)
          .filter(pk => pk >= (yb.reserveStart || 54) && (!ybPicks[String(pk)] || ybPicks[String(pk)] === null));

        let slotIdx = 0;
        const added = [];
        const newYaveshProds = Object.entries(dagimYaveshData)
          .filter(([mk, d]) => !ybMakatSet.has(mk) && ((d.stock || 0) > 0 || (d.daySales365 || 0) > 0))
          .sort(([, a], [, b]) => (b.daySales365 || 0) - (a.daySales365 || 0));
        for (const [mk, d] of newYaveshProds) {
          if (slotIdx >= emptySlots.length) break;
          const pk = String(emptySlots[slotIdx++]);
          ybPicks[pk] = { makat: mk, fam: d.fam || 'דג יבש', name: d.nameEn || null };
          added.push(`${mk}→pick${pk}`);
        }

        if (added.length || yCleaned > 0) {
          fs.writeFileSync(ybPath, JSON.stringify(yb, null, 2), 'utf8');
          console.log(`dagim-yavesh-base.json: +${added.length} added, -${yCleaned} cleaned from reserve`);
        } else {
          console.log(`dagim-yavesh-base.json: all ${Object.keys(dagimYaveshData).length} yavesh products mapped, reserve clean`);
        }
      }
    }

    // ── weekly sales trend (last 7 ISO-weeks) ────────────────────────────────
    {
      const allMks = Object.keys(prodData);
      const weekMap = await fetchWeeklySales(allMks).catch(e => {
        console.warn('⚠ fetchWeeklySales (non-fatal):', e.message);
        return {};
      });
      let wkCount = 0;
      for (const [mk, ws] of Object.entries(weekMap)) {
        if (prodData[mk]) { prodData[mk].weekSales = ws; wkCount++; }
      }
      console.log(`weekSales: ${wkCount} מקטים`);
    }

    fs.writeFileSync(path.join(__dirname,'..','docs','product-data.json'),
      JSON.stringify(prodData, null, 2), 'utf8');
    console.log(`product-data.json: ${Object.keys(prodData).length} מקטים`);

    // ── product-photos.json — makat → Priority photo URL ────────────────
    const photoUrls = await fetchPhotoUrls();
    if (Object.keys(photoUrls).length > 0) {
      fs.writeFileSync(path.join(__dirname,'..','docs','product-photos.json'),
        JSON.stringify(photoUrls, null, 2), 'utf8');
      console.log(`product-photos.json: ${Object.keys(photoUrls).length} URLs`);
    } else {
      console.warn('fetchPhotoUrls returned 0 — keeping existing product-photos.json');
    }

    // ── kapua-base.json — all קפוא picks + layout for the HTML editor ────
    const EDITOR_COLS          = 19;
    const EDITOR_OVERFLOW_ROW  = 11; // new products start at row 11 (row 10 = gap/corridor)
    const editorLayout = {
       1:{r:1,c:1},  2:{r:1,c:2},  3:{r:1,c:3},  4:{r:1,c:4},  5:{r:1,c:5},
       6:{r:1,c:6},  7:{r:1,c:7},  8:{r:1,c:8},  9:{r:1,c:9}, 10:{r:1,c:10},
      11:{r:1,c:11},12:{r:1,c:12},13:{r:1,c:13},14:{r:1,c:14},15:{r:1,c:15},
      16:{r:1,c:16},17:{r:1,c:17},
      18:{r:2,c:18},19:{r:2,c:19},
      20:{r:3,c:18},21:{r:3,c:19},
      22:{r:4,c:17},23:{r:4,c:16},24:{r:4,c:15},25:{r:4,c:14},
      26:{r:4,c:13},27:{r:4,c:12},28:{r:4,c:11},29:{r:4,c:10},
      30:{r:4,c:9}, 31:{r:4,c:8}, 32:{r:4,c:7}, 33:{r:4,c:6},
      34:{r:4,c:5}, 35:{r:4,c:4},
      36:{r:5,c:4}, 37:{r:5,c:5}, 38:{r:5,c:6}, 39:{r:5,c:7},
      40:{r:5,c:8}, 41:{r:5,c:9}, 42:{r:5,c:10},43:{r:5,c:11},
      44:{r:5,c:12},45:{r:5,c:13},46:{r:5,c:14},47:{r:5,c:15},
      48:{r:5,c:16},49:{r:5,c:17},
      50:{r:9,c:5}, 51:{r:9,c:4}, 52:{r:9,c:3}, 53:{r:9,c:2}, 54:{r:9,c:1},
    };
    let editorMaxRows = 9;

    const kapuaPicks = {};
    for (const [pickStr, p] of Object.entries(KAPUA_PICKS)) {
      const nameEn = nameEnMap[String(p.makat)] || null;
      kapuaPicks[pickStr] = { makat: p.makat, fam: p.fam, name: nameEn };
    }
    newKapuaProds.forEach((p, i) => {
      const row = EDITOR_OVERFLOW_ROW + Math.floor(i / EDITOR_COLS);
      const col = (i % EDITOR_COLS) + 1;
      if (row > editorMaxRows) editorMaxRows = row;
      const nameEn = nameEnMap[String(p.makat)] || null;
      kapuaPicks[String(p.pick)] = { makat: p.makat, fam: p.fam || 'קפוא', name: nameEn, isNew: true };
      editorLayout[p.pick] = { r: row, c: col };
    });

    // kapua-base.json: structure maintained manually (like halavi). Workflow does NOT overwrite it.
    console.log(`kapua-base.json: NOT overwritten by workflow (manually maintained, ${Object.keys(kapuaPicks).length} picks in PBI)`);

    // ── halavi-base.json ──────────────────────────────────────────────────
    // Snake layout: rows 4→3→2→1, 12 cols, matches MAHSAN חלבי physical planogram
    const HALAVI_LAYOUT = {
       1:{r:4,c:1}, 2:{r:4,c:2}, 3:{r:4,c:3}, 4:{r:4,c:4}, 5:{r:4,c:5}, 6:{r:4,c:6},
       7:{r:4,c:7}, 8:{r:4,c:8}, 9:{r:4,c:9},10:{r:4,c:10},11:{r:4,c:11},12:{r:4,c:12},
      13:{r:3,c:12},14:{r:3,c:11},15:{r:3,c:10},16:{r:3,c:9},17:{r:3,c:8},18:{r:3,c:7},
      19:{r:3,c:6},20:{r:3,c:5},21:{r:3,c:4},22:{r:3,c:3},23:{r:3,c:2},24:{r:3,c:1},
      25:{r:2,c:1},26:{r:2,c:2},27:{r:2,c:3},28:{r:2,c:4},29:{r:2,c:5},30:{r:2,c:6},
      31:{r:2,c:7},32:{r:2,c:8},33:{r:2,c:9},34:{r:2,c:10},35:{r:2,c:11},36:{r:2,c:12},
      37:{r:1,c:12},38:{r:1,c:11},39:{r:1,c:10},40:{r:1,c:9},41:{r:1,c:8},42:{r:1,c:7},
      43:{r:1,c:6},44:{r:1,c:5},45:{r:1,c:4},46:{r:1,c:3},47:{r:1,c:2},48:{r:1,c:1},
    };
    // ── halavi-base.json: auto-sync new products into reserve slots ──────────
    {
      const hbPath = path.join(__dirname, '..', 'docs', 'halavi-base.json');
      const hb = JSON.parse(fs.readFileSync(hbPath, 'utf8'));

      // Makatim already assigned in halavi-base.json
      const hbMakatSet = new Set(
        Object.values(hb.picks).filter(Boolean).map(p => String(p.makat))
      );

      // Clean reserve: remove only if BOTH stock=0 AND daySales180=0
      const halaviProdMap = {};
      for (const p of halaviProds) halaviProdMap[String(p.makat)] = p;
      let hCleaned = 0;
      for (const [bay, pick] of Object.entries(hb.picks)) {
        if (!pick || Number(bay) < (hb.reserveStart || 61)) continue;
        const prod = halaviProdMap[String(pick.makat)];
        if (!prod || ((prod.stock || 0) <= 0 && (prod.daySales180 || 0) <= 0)) {
          hb.picks[bay] = null;
          hCleaned++;
        }
      }

      // Find empty RESERVE pick slots after cleanup
      const emptySlots = Object.keys(hb.layout || hb.picks)
        .map(Number)
        .sort((a, b) => a - b)
        .filter(pk => pk >= (hb.reserveStart || 61) && (!hb.picks[String(pk)] || hb.picks[String(pk)] === null));

      let slotIdx = 0;
      const added = [];
      const newHalaviProds = halaviProds
        .filter(p => !hbMakatSet.has(String(p.makat)) && (p.stock || 0) > 0)
        .sort((a, b) => (b.daySales180 || 0) - (a.daySales180 || 0));
      for (const p of newHalaviProds) {
        if (slotIdx >= emptySlots.length) break;
        const pk = String(emptySlots[slotIdx++]);
        hb.picks[pk] = { makat: p.makat, fam: p.fam || '', name: nameEnMap[String(p.makat)] || null };
        added.push(`${p.makat}→pick${pk}`);
      }

      // Normalize fam in ALL picks using current PBI data (fixes historical visual-RTL garbling)
      let hFamFixed = 0;
      for (const [pk, pick] of Object.entries(hb.picks)) {
        if (!pick) continue;
        const cleanFam = halaviProdMap[String(pick.makat)]?.fam;
        if (cleanFam && cleanFam !== pick.fam) { hb.picks[pk] = { ...pick, fam: cleanFam }; hFamFixed++; }
      }

      if (added.length || hCleaned > 0 || hFamFixed > 0) {
        fs.writeFileSync(hbPath, JSON.stringify(hb, null, 2), 'utf8');
        console.log(`halavi-base.json: +${added.length} added, -${hCleaned} cleaned, ~${hFamFixed} fam fixed`);
      } else {
        console.log(`halavi-base.json: all ${halaviProds.length} halavi products mapped, reserve clean`);
      }
    }

    // ── dagim-base.json: auto-sync new products into reserve slots ────────────
    {
      const dbPath = path.join(__dirname, '..', 'docs', 'dagim-base.json');
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

      const dbMakatSet = new Set(
        Object.values(db.picks).filter(Boolean).map(p => String(p.makat))
      );

      // Clean reserve: remove only if BOTH stock=0 AND daySales180=0
      const dagimProdMap = {};
      for (const p of dagimProds) dagimProdMap[String(p.makat)] = p;
      let dCleaned = 0;
      for (const [bay, pick] of Object.entries(db.picks)) {
        if (!pick || Number(bay) < (db.reserveStart || 59)) continue;
        const prod = dagimProdMap[String(pick.makat)];
        if (!prod || ((prod.stock || 0) <= 0 && (prod.daySales180 || 0) <= 0)) {
          db.picks[bay] = null;
          dCleaned++;
        }
      }

      // NOTE: dagim active-bay cleanup disabled — same reason as dagim-yavesh.
      // PBI can return stock=0/daySales=0 temporarily; cleanup was wiping real products.
      let dActiveCleaned = 0;

      const emptySlots = Object.keys(db.layout || {})
        .map(Number)
        .sort((a, b) => a - b)
        .filter(pk => pk >= (db.reserveStart || 59) && (!db.picks[String(pk)] || db.picks[String(pk)] === null));

      let slotIdx = 0;
      const added = [];
      const newDagimProds = dagimProds
        .filter(p => !dbMakatSet.has(String(p.makat)) && (p.stock || 0) > 0)
        .sort((a, b) => (b.daySales180 || 0) - (a.daySales180 || 0));
      for (const p of newDagimProds) {
        if (slotIdx >= emptySlots.length) break;
        const pk = String(emptySlots[slotIdx++]);
        db.picks[pk] = { makat: p.makat, fam: p.fam || '', name: nameEnMap[String(p.makat)] || null };
        added.push(`${p.makat}→pick${pk}`);
      }

      // Normalize fam in ALL picks using current PBI data
      let dFamFixed = 0;
      for (const [pk, pick] of Object.entries(db.picks)) {
        if (!pick) continue;
        const cleanFam = dagimProdMap[String(pick.makat)]?.fam;
        if (cleanFam && cleanFam !== pick.fam) { db.picks[pk] = { ...pick, fam: cleanFam }; dFamFixed++; }
      }

      if (added.length || dCleaned > 0 || dActiveCleaned > 0 || dFamFixed > 0) {
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
        console.log(`dagim-base.json: +${added.length} added, -${dCleaned} reserve cleaned, -${dActiveCleaned} active cleaned, ~${dFamFixed} fam fixed`);
      } else {
        console.log(`dagim-base.json: all ${dagimProds.length} dagim products mapped, clean`);
      }
    }
  }

  // Write output
  const out = 'MAHSAN PLANOGRAM v41.xlsx';
  await wb.xlsx.writeFile(out);
  console.log('\n✅ Written:', out);
}

main().catch(e => { console.error(e); process.exit(1); });
