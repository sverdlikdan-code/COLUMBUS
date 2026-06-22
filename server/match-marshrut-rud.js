require('dotenv').config({ path: '../.env' });
const ExcelJS = require('exceljs');
const path = require('path');

const DESKTOP = 'C:/Users/d.sverdlik/Desktop';

async function readSheet(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}

function norm(s) {
  return String(s || '')
    .replace(/["''׳ʼ´`'"]/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/ראשל"צ|ראשלצ/g, 'ראשון לציון')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function score(query, candidate, addrQuery, addrCand) {
  const q = norm(query), c = norm(candidate);
  if (c === q) return 100;

  // Branch/seniph number match: "סניף 13" in both
  const sniph = (q.match(/סניף\s*(\d+)/) || [])[1];
  const cSniph = (c.match(/סניף\s*(\d+)/) || [])[1];
  if (sniph && cSniph && sniph !== cSniph) return 0; // different branch → skip

  // Word overlap
  const qw = q.split(' ').filter(w => w.length > 1);
  const cw = c.split(' ');
  const matches = qw.filter(w => cw.some(cw2 => cw2.includes(w) || w.includes(cw2)));
  let s = qw.length ? Math.round((matches.length / qw.length) * 70) : 0;

  // Address boost
  if (addrQuery && addrCand) {
    const aq = norm(addrQuery).split(' ')[0];
    if (aq && norm(addrCand).includes(aq)) s = Math.min(100, s + 25);
  }

  return s;
}

async function main() {
  // ── 1. Load ASHDOD-RISHON ─────────────────────────────────────────────────
  const wbRef = await readSheet(path.join(DESKTOP, 'ASHDOD-RISHON.xlsx'));
  const allRef = new Map();

  wbRef.eachSheet(sheet => {
    sheet.eachRow((row, rn) => {
      if (rn < 4) return;
      const v = row.values;
      const id   = String(v[3] || '').trim();
      const name = String(v[4] || '').trim();
      const type = String(v[6] || '').trim();
      const addr = String(v[7] || '').trim();
      const city = String(v[10] || '').trim();
      if (!id || isNaN(Number(id))) return;
      if (!allRef.has(id)) allRef.set(id, { id, name, type, addr, city });
    });
  });

  const ashdodList  = [...allRef.values()].filter(c => c.city.includes('אשדוד'));
  const rishonList  = [...allRef.values()].filter(c =>
    (c.city.includes('ראשון') || c.city.includes('בת ים') || c.city.includes('בת-ים')) &&
    c.type !== 'חנויות'
  );
  const rishonAll   = [...allRef.values()].filter(c =>
    c.city.includes('ראשון') || c.city.includes('בת ים') || c.city.includes('בת-ים')
  );

  console.log(`Ashdod: ${ashdodList.length} | Rishon (non-חנויות): ${rishonList.length} | Rishon all: ${rishonAll.length}`);

  // ── 2. Load MARSHRUT RUD ──────────────────────────────────────────────────
  const wbRoute = await readSheet(path.join(DESKTOP, 'MARSHRUT RUD.xlsx'));
  const day1 = [], day2 = [];

  wbRoute.eachSheet(sheet => {
    sheet.eachRow((row, rn) => {
      if (rn < 3) return;
      const v = row.values;

      const c3 = String(v[3] || '').trim();
      const c4 = String(v[4] || '').trim();
      if (c3) {
        const m = c3.match(/^(\d{7})\s+(.+)/);
        if (m) day1.push({ raw: c3, existingId: m[1], nameHint: m[2], addr: c4 });
        else    day1.push({ raw: c3, existingId: null, nameHint: c3, addr: c4 });
      }

      const c6 = String(v[6] || '').trim();
      const c7 = String(v[7] || '').trim();
      if (c6) {
        const label = c6.replace(/^\d+\.\s*/, '');
        day2.push({ raw: c6, nameHint: label, addr: c7 });
      }
    });
  });

  // ── 3. Match ──────────────────────────────────────────────────────────────
  function findBest(nameHint, addrHint, existingId, pool) {
    if (existingId && allRef.has(existingId)) {
      const c = allRef.get(existingId);
      return { ...c, matchType: 'ID', confidence: 100 };
    }
    let best = null, bestScore = 0;
    for (const c of pool) {
      const s = score(nameHint, c.name, addrHint, c.addr);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (!best || bestScore < 20) return { id: '???', name: '—', addr: '', city: '', type: '', matchType: 'NO MATCH', confidence: 0 };
    return { ...best, matchType: 'NAME', confidence: bestScore };
  }

  // ── 4. Build Excel output ─────────────────────────────────────────────────
  const outWb = new ExcelJS.Workbook();

  function makeSheet(wsName, rows, pool) {
    const ws = outWb.addWorksheet(wsName);
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];

    const hdr = ws.addRow(['#', 'מס. לקוח', 'שם לקוח', 'סוג', 'עיר', 'כתובת', '%', 'כניסה גולמית']);
    hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3F7C' } };
    hdr.height = 20;
    ws.autoFilter = { from: 'A1', to: 'H1' };

    rows.forEach((r, i) => {
      const m = findBest(r.nameHint, r.addr, r.existingId || null, pool);
      const conf = m.confidence;
      const color = conf === 100 ? 'FFD4EDDA' : conf >= 70 ? 'FFFFF3CD' : conf >= 40 ? 'FFFDE8D8' : 'FFFDD5D5';

      const row = ws.addRow([i + 1, m.id, m.name, m.type, m.city, m.addr, conf + '%', r.raw]);
      [1,2,3,7].forEach(col => row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } });
    });

    ws.columns = [{ width: 4 }, { width: 12 }, { width: 48 }, { width: 16 }, { width: 16 }, { width: 28 }, { width: 7 }, { width: 42 }];
  }

  makeSheet('יום 1 - אשדוד', day1, ashdodList);
  makeSheet('יום 2 - ראשון לציון', day2, rishonList);

  const OUTPUT = path.join(DESKTOP, 'MARSHRUT-RUD-MATCHED.xlsx');
  await outWb.xlsx.writeFile(OUTPUT);
  console.log('\n✅ Saved:', OUTPUT);

  // Print Day 2 results
  console.log('\n=== DAY 2 — ראשון לציון (excluding חנויות) ===');
  day2.forEach((r, i) => {
    const m = findBest(r.nameHint, r.addr, null, rishonList);
    const flag = m.confidence >= 70 ? '✅' : m.confidence >= 40 ? '⚠️' : '❌';
    console.log(`${flag} ${i+1}. [${m.id}] ${m.name} | ${m.type} — ${m.confidence}%`);
    console.log(`      ← "${r.raw}"`);
  });
}

main().catch(console.error);
