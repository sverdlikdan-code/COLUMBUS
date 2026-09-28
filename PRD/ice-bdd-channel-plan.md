# ICE BDD Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ICE BDD managers (Timur, Matvey, Simha) open Formula Road and work with ICE BDD teams — BDD clients, BDD visit days, live V / סגירת יום / line coverage from Priority `icecrea`.

**Architecture:** One app, a second *channel* — but **BDD lives in its own files and its own URL space**. All BDD server routes are an Express router mounted at `/api/bdd` (`server/bdd-routes.js`); pure logic is in `server/bdd.js`; BDD Priority SQL is in `server/bdd-priority.js` with its own connection pool. FORMULA route handlers are **not edited at all**. In the browser, `apiFetch` rewrites a fixed list of paths to `/api/bdd/…` when the saved login has `channel: "ICE_BDD"`; for FORMULA logins it passes URLs through unchanged. A `channel` field on the manager row in `managers.json` is copied into the session.

**Tech Stack:** Node/Express (`server/index.js`), `mssql`, Power BI executeQueries (`server/powerbi.js`), vanilla JS in `docs/formula-road.html` + `docs/day-closing.html`, `node:test`, puppeteer for UI check.

**Spec:** `PRD/ice-bdd-channel-design.md` · **Rollback point:** git tag `checkpoint-before-ice-bdd`

**ISOLATION RULE (user, 2026-09-28, strict): nothing BDD does may affect FORMULA in any way.** Concretely:
- **No FORMULA route handler is edited.** The only edits to existing server code are listed in the "FORMULA touch points" table below; Task 13 checks the diff against it.
- **Own files for all BDD state:** `server/data/route-overrides-bdd.json`, `docs/gps-corrections-bdd.json`, `docs/mekarer-orders-bdd.json`, `server/data/bdd-geocode-resolved.json`. BDD never writes a FORMULA file or FORMULA in-memory cache.
- **FORMULA state is read-only for BDD:** the GPS cascade reads FORMULA's corrections / tablet GPS / PBI coords / resolved cache through a getter; nothing is written back.
- **Own Priority pool** (`bdd-priority.js`), never the pools in `priority-db.js`; `priority-db.js` is not edited.
- **No quota pressure:** BDD PBI load is sequential and starts 2 min after FORMULA's load; no live geocoding for BDD (night job only, max 200, 02:00 Israel).
- **BDD failure = BDD down, FORMULA up:** every BDD entry point (loader, night job, each route) catches its own errors; a BDD exception never propagates into `index.js`.
- Task 13 negative control (FORMULA before/after identical) is a release gate.

**Project rules that apply to every task:** Priority dates are int minutes since 1988-01-01 (`curdateFor` logic); QUANT/1000; never PowerShell for JSON with Hebrew (use Node); after any JS edit inside HTML run the syntax check in Task 11; deploy only via `git push` + VPS `git reset --hard` (never pipe files over ssh); push once at the end (Task 13); ponytail discipline.

---

## File map

| File | Change |
|---|---|
| `server/bdd.js` | **new** — pure: `BDD_GROUPS`, `unreversePbi`, `buildBddCache`, `summarizeBddDocs`, `bddCanWrite`, `resolveBddGps`; PBI loader `loadBddCache` |
| `server/bdd.test.js` | **new** — `node:test` tests for the pure functions |
| `server/bdd-priority.js` | **new** — own mssql pool; `bddDocLinesToday`, `bddClientPromos`, `bddCustFamiliesWithActivePromo` |
| `server/bdd-routes.js` | **new** — `createBdd(deps)` → `{ router, start }`: BDD state, cache load, 75 s docs cache, GPS sources, night geocoding, all `/api/bdd/*` routes, BDD fridge email |
| `server/data/managers.json` | Timur / Matvey / Simha → `channel`, `role: team`, `teams`, `email` |
| `server/index.js` | only the touch points below |
| `server/send-formula-road-invites.js` | `--bdd` mode (roster from managers.json, BDD email text) |
| `docs/formula-road.html` | `_isBdd`, BDD URL rewrite in `apiFetch`, group list, V set, hidden buttons, day-closing type |
| `docs/day-closing.html` | `type=bdd` → BDD endpoint, title/label, returns line instead of new-clients line |

## FORMULA touch points (the complete list of edits to existing server code)

| Where | Edit | Effect on FORMULA sessions |
|---|---|---|
| `index.js` top | `const { createBdd } = require('./bdd-routes');` | none |
| `createSession` (~835) | `if (managerMeta?.channel) { sess.channel = …; sess.managerTeams = …; }` | none — block runs only for BDD rows |
| after `/api/route-overrides` GET (~6025) | `const bdd = createBdd({...}); app.use('/api/bdd', bdd.router);` | none — new URL prefix |
| end of `_loadPBICacheAttempt` success block | `setTimeout(() => bdd.start(), 2 * 60 * 1000);` | none — timer only |
| `_inviteRedirect` (~1064) | append `&_ch=…` **only if** the manager has a channel | none — FORMULA URL byte-identical |
| `/auth/pbi` response (~1140) | add `channel` key only if the manager has one | none — FORMULA JSON identical |

`managerCanWrite` is **not** changed: BDD rows have `role: "team"` but no `team`, so its existing team branch (`clients[0].manager === session.managerTeam`) is already `false` for every FORMULA agent → a BDD session cannot write through any FORMULA route. Task 5 verifies this.

---

### Task 1: `server/bdd.js` — cache builder (TDD)

**Files:**
- Create: `server/bdd.js`
- Test: `server/bdd.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/bdd.test.js
const test = require('node:test');
const assert = require('node:assert');
const { unreversePbi, buildBddCache } = require('./bdd');

const fix = { fixBiDi: s => s, fixBiDiAddress: s => s, expandCityAbbrev: s => s };

test('unreversePbi strips LRO/PDF marks and reverses', () => {
  assert.strictEqual(unreversePbi('‭ליעפ‬'), 'פעיל');
  assert.strictEqual(unreversePbi(''), '');
});

test('buildBddCache groups agents, schedules days, drops unknown agents', () => {
  const cache = buildBddCache({
    teamRows: [
      { '[agentCode]': '98', '[group]': 'MATVEY', '[agentName]': 'אולג ליפייקו' },
      { '[agentCode]': '243', '[group]': 'TIMUR', '[agentName]': 'ולרי קושניר' },
    ],
    clientRows: [
      { '[custId]': '1151126', '[custName]': 'מינימרקט', '[city]': 'ירושלים', '[address]': 'א 1', '[agentCode]': '98', '[agentName]': 'אולג ליפייקו', '[clientType]': 'חנויות' },
      { '[custId]': '1150004', '[custName]': 'בלי יום', '[city]': 'בת ים', '[address]': '', '[agentCode]': '98', '[agentName]': 'אולג ליפייקו', '[clientType]': '' },
      { '[custId]': '9999999', '[custName]': 'פול', '[city]': '', '[address]': '', '[agentCode]': '932', '[agentName]': 'כללי', '[clientType]': '' },
    ],
    gpsRows: [{ '[custId]': '1151126', '[lat]': 31.78, '[lng]': 35.21 }],
    schedRows: [
      { '[custId]': '1151126', '[day]': 'ב', '[status]': '‭ליעפ‬' },
      { '[custId]': '1151126', '[day]': 'ה', '[status]': '‭ליעפ‬' },
      { '[custId]': '1150004', '[day]': 'ש', '[status]': '‭ליעפ‬' },
    ],
    familyRows: [{ '[fam]': '‭םידדוב הדילג‬' }],
  }, fix);

  assert.deepStrictEqual(cache.agentsByGroup.get('MATVEY'), [{ agentCode: '98', agentName: 'אולג ליפייקו' }]);
  assert.strictEqual(cache.agentGroup.get('243'), 'TIMUR');
  const list = cache.byAgent.get('98');
  assert.deepStrictEqual(list.map(c => [c.custId, c.dayNum]), [['1151126', 2], ['1151126', 5], ['1150004', null]]);
  assert.strictEqual(list[0].lat, 31.78);
  assert.strictEqual(list[0].hevra, 'ICE_BDD');
  assert.strictEqual(list[0].manager, 'MATVEY');
  assert.ok(!cache.byAgent.has('932'), 'agent outside TEAMS is dropped');
  assert.ok(cache.families.has('גלידה בודדים'));
  assert.strictEqual(cache.clientById.get('1151126').agentCode, '98');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test server/bdd.test.js`
Expected: FAIL — `Cannot find module './bdd'`

- [ ] **Step 3: Write the implementation**

```js
// server/bdd.js
// ICE BDD channel (van-sale) inside Formula Road — see PRD/ice-bdd-channel-design.md.
// Pure builders here; loadBddCache at the bottom is the only I/O (PBI, read-only).
const BDD_GROUPS = ['TIMUR', 'ALMOG', 'MATVEY', 'SIMHA', 'YOSI'];
const DAY_LETTER_TO_NUM = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5 };

// PBI keeps Priority Hebrew as NCHAR(8237)+REVERSE(x)+NCHAR(8236) (see the ICE M code).
// Stripping the marks and reversing restores the exact Priority string, digits included.
function unreversePbi(s) {
  return [...String(s || '').replace(/[‪-‮]/g, '')].reverse().join('');
}

function buildBddCache({ teamRows, clientRows, gpsRows, schedRows, familyRows }, fix) {
  const agentGroup = new Map();
  const agentsByGroup = new Map(BDD_GROUPS.map(g => [g, []]));
  for (const r of teamRows) {
    const agentCode = String(r['[agentCode]'] || '').trim();
    const group = String(r['[group]'] || '').trim();
    if (!agentCode || !agentsByGroup.has(group) || agentGroup.has(agentCode)) continue;
    agentGroup.set(agentCode, group);
    agentsByGroup.get(group).push({ agentCode, agentName: String(r['[agentName]'] || '').trim() });
  }

  const gps = new Map();
  for (const r of gpsRows) {
    const lat = Number(r['[lat]']), lng = Number(r['[lng]']);
    if (lat && lng) gps.set(String(r['[custId]']), { lat, lng });
  }

  const days = new Map(); // custId -> [dayNum...]
  for (const r of schedRows) {
    if (unreversePbi(r['[status]']) !== 'פעיל') continue;
    const dayNum = DAY_LETTER_TO_NUM[String(r['[day]'] || '').trim()];
    if (!dayNum) continue; // ש and blanks fall through to "לא מוגדר"
    const custId = String(r['[custId]'] || '');
    if (!days.has(custId)) days.set(custId, []);
    if (!days.get(custId).includes(dayNum)) days.get(custId).push(dayNum);
  }

  const clientById = new Map();
  const byAgent = new Map();
  for (const r of clientRows) {
    const custId = String(r['[custId]'] || '');
    const agentCode = String(r['[agentCode]'] || '').trim();
    const group = agentGroup.get(agentCode);
    if (!custId || !group) continue;
    const address = fix.expandCityAbbrev(fix.fixBiDiAddress(r['[address]'] || ''));
    const city = fix.expandCityAbbrev(String(r['[city]'] || ''));
    const g = gps.get(custId);
    const base = {
      custId,
      custName: fix.fixBiDi(r['[custName]'] || ''),
      city, address,
      fullAddress: [address, city, 'ישראל'].filter(Boolean).join(', '),
      lat: g ? g.lat : null, lng: g ? g.lng : null,
      agentCode, agentName: String(r['[agentName]'] || '').trim(),
      manager: group, clientType: String(r['[clientType]'] || ''),
      hevra: 'ICE_BDD', iceOnly: false, target: 0, pct: 0,
      monthlySales: 0, avg6Sales: 0, avg6Orders: 0, avg6IceSales: 0, lastOrderDate: null,
    };
    clientById.set(custId, base);
    if (!byAgent.has(agentCode)) byAgent.set(agentCode, []);
    const list = byAgent.get(agentCode);
    const ds = days.get(custId) || [];
    if (ds.length) for (const d of ds) list.push({ ...base, dayNum: d, dayLabel: Object.keys(DAY_LETTER_TO_NUM)[d - 1], priorityOrder: 9000 });
    else list.push({ ...base, dayNum: null, dayLabel: '', priorityOrder: 9500 });
  }

  const familiesRaw = familyRows.map(r => r['[fam]']).filter(Boolean);
  const families = new Set(familiesRaw.map(unreversePbi));
  return { agentGroup, agentsByGroup, byAgent, clientById, families, familiesRaw, loadedAt: new Date() };
}

module.exports = { BDD_GROUPS, unreversePbi, buildBddCache };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test server/bdd.test.js`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add server/bdd.js server/bdd.test.js
git commit -m "feat(formula-road): добавить построение кэша ICE BDD"
```

---

### Task 2: `server/bdd.js` — docs summary, write check, GPS cascade (TDD)

**Files:**
- Modify: `server/bdd.js`
- Test: `server/bdd.test.js`

- [ ] **Step 1: Add the failing tests** (append to `server/bdd.test.js`)

```js
const { summarizeBddDocs, bddCanWrite, resolveBddGps } = require('./bdd');

test('summarizeBddDocs keeps BDD families, nets by executing agent', () => {
  const families = new Set(['גלידה בודדים']);
  const rows = [
    { src: 'INV', docNo: 'IV1', custId: 'A', agentCode: '43', agentName: 'קרבצוב', familyDes: 'גלידה בודדים', amount: 1000 },
    { src: 'INV', docNo: 'IV1', custId: 'A', agentCode: '43', agentName: 'קרבצוב', familyDes: 'משפחתי', amount: 500 },
    { src: 'D',   docNo: 'D7',  custId: 'B', agentCode: '43', agentName: 'קרבצוב', familyDes: 'גלידה בודדים', amount: 300 },
    { src: 'N',   docNo: 'N2',  custId: 'B', agentCode: '43', agentName: 'קרבצוב', familyDes: 'גלידה בודדים', amount: -100 },
    { src: 'INV', docNo: 'CR1', custId: 'C', agentCode: '17', agentName: 'לוחמטוב', familyDes: 'גלידה בודדים', amount: -50 },
  ];
  const s = summarizeBddDocs(rows, families);
  assert.deepStrictEqual([...s.custIds].sort(), ['A', 'B', 'C']);
  const a43 = s.byAgent.get('43');
  assert.strictEqual(a43.custCount, 2);
  assert.strictEqual(a43.sales, 1300);
  assert.strictEqual(a43.returns, -100);
  assert.strictEqual(a43.credits, 0);
  assert.strictEqual(a43.sum, 1200);
  assert.strictEqual(s.byAgent.get('17').credits, -50);
});

test('bddCanWrite: own groups only, super always', () => {
  const cache = { agentGroup: new Map([['98', 'MATVEY'], ['21', 'ALMOG'], ['243', 'TIMUR']]) };
  const matvey = { isManager: true, channel: 'ICE_BDD', managerRole: 'team', managerTeams: ['MATVEY', 'ALMOG'] };
  assert.strictEqual(bddCanWrite(matvey, '98', cache), true);
  assert.strictEqual(bddCanWrite(matvey, '21', cache), true);
  assert.strictEqual(bddCanWrite(matvey, '243', cache), false);
  assert.strictEqual(bddCanWrite({ isManager: true, managerRole: 'super' }, '243', cache), true);
  assert.strictEqual(bddCanWrite({ isManager: true, channel: 'ICE_BDD', managerRole: 'readonly', managerTeams: ['TIMUR'] }, '243', cache), false);
  assert.strictEqual(bddCanWrite(matvey, '98', null), false);
});

test('resolveBddGps: BDD fix > FORMULA knowledge > ICE card > night geocode', () => {
  const ok = (la, lo) => ({ lat: la, lng: lo });
  const src = {
    bddCorr: { A: ok(32.1, 34.8) },
    formulaCorr: { A: ok(1, 1), B: ok(32.2, 34.9) },
    tablet: new Map([['C', ok(32.3, 35.0)]]),
    formulaKnown: new Map([['D', ok(32.4, 35.1)]]),
    bddResolved: { F: ok(32.6, 35.3) },
    isValid: (la, lo) => la > 29 && la < 34 && lo > 34 && lo < 36,
  };
  assert.deepStrictEqual(resolveBddGps({ custId: 'A', lat: 31, lng: 35 }, src), { lat: 32.1, lng: 34.8, gpsSource: 'correction' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'B', lat: 31, lng: 35 }, src), { lat: 32.2, lng: 34.9, gpsSource: 'formula-correction' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'C', lat: null, lng: null }, src), { lat: 32.3, lng: 35.0, gpsSource: 'tablet-order' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'D', lat: null, lng: null }, src), { lat: 32.4, lng: 35.1, gpsSource: 'formula' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'E', lat: 32.5, lng: 35.2 }, src), { lat: 32.5, lng: 35.2, gpsSource: 'pbi' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'F', lat: null, lng: null }, src), { lat: 32.6, lng: 35.3, gpsSource: 'geocoded' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'G', lat: null, lng: null }, src), { lat: null, lng: null, gpsSource: undefined });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test server/bdd.test.js`
Expected: FAIL — `summarizeBddDocs is not a function`

- [ ] **Step 3: Implement** (add to `server/bdd.js` above `module.exports`)

```js
// One Priority result (bddDocLinesToday) feeds V, סגירת יום and line coverage.
// Families are filtered here, not in SQL, so the SQL stays the ICE M code's own shape.
// Sign split: src 'N' = החזרה (DOCS), negative INV = זיכוי, everything else = sale.
function summarizeBddDocs(rows, families) {
  const custIds = new Set();
  const byAgent = new Map();
  for (const r of rows) {
    if (!families.has(r.familyDes)) continue;
    custIds.add(r.custId);
    if (!byAgent.has(r.agentCode)) byAgent.set(r.agentCode, { agentName: r.agentName, custSet: new Set(), sales: 0, returns: 0, credits: 0 });
    const a = byAgent.get(r.agentCode);
    a.custSet.add(r.custId);
    if (r.src === 'N') a.returns += r.amount;
    else if (r.src === 'INV' && r.amount < 0) a.credits += r.amount;
    else a.sales += r.amount;
  }
  const round = n => Math.round(n * 100) / 100;
  for (const a of byAgent.values()) {
    a.custCount = a.custSet.size;
    a.sales = round(a.sales); a.returns = round(a.returns); a.credits = round(a.credits);
    a.sum = round(a.sales + a.returns + a.credits);
  }
  return { custIds, byAgent };
}

function bddCanWrite(session, agentCode, cache) {
  if (!session?.isManager) return false;
  if (session.managerRole === 'super') return true;
  if (session.channel !== 'ICE_BDD' || session.managerRole !== 'team' || !cache) return false;
  const group = cache.agentGroup.get(String(agentCode));
  return !!group && (session.managerTeams || []).includes(group);
}

// GPS cascade (user-approved 2026-09-28), first hit wins. Pure: every source is
// passed in; FORMULA sources are read-only views, nothing here writes anything.
function resolveBddGps(c, s) {
  const id = String(c.custId);
  const pick = (p, gpsSource) => (p && s.isValid(p.lat, p.lng) ? { lat: p.lat, lng: p.lng, gpsSource } : null);
  return pick(s.bddCorr[id], 'correction')
    || pick(s.formulaCorr[id], 'formula-correction')
    || pick(s.tablet.get(id), 'tablet-order')
    || pick(s.formulaKnown.get(id), 'formula')
    || pick(c, 'pbi')
    || pick(s.bddResolved[id], 'geocoded')
    || { lat: null, lng: null, gpsSource: undefined };
}
```

Replace the export line with:

```js
module.exports = { BDD_GROUPS, unreversePbi, buildBddCache, summarizeBddDocs, bddCanWrite, resolveBddGps };
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test server/bdd.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add server/bdd.js server/bdd.test.js
git commit -m "feat(formula-road): сводка документов, права и каскад GPS для ICE BDD"
```

---

### Task 3: PBI loader for BDD + verify it against live data

**Files:**
- Modify: `server/bdd.js`
- Create (temporary): `.scratch/probe-bdd-cache.js`

- [ ] **Step 1: Add the loader** (in `server/bdd.js`, above `module.exports`; add `loadBddCache` to the export)

```js
// Datasets: FORMULA = default (clients, families, ALL_PARTS sales); ICE = TEAMS, GPS, schedule.
async function loadBddCache(executeDax, iceDatasetId, fix) {
  const T = `'לקוחות FORM+I+INT'`;
  // Sequential on purpose (isolation rule): FORMULA shares the same PBI query quota,
  // a burst of parallel queries is what caused the 429s before.
  const teamRows = await executeDax(`EVALUATE SELECTCOLUMNS('TEAMS', "agentCode", 'TEAMS'[SOHEN NUMBER], "group", 'TEAMS'[מנהל], "agentName", 'TEAMS'[סוכן])`, iceDatasetId);
  const clientRows = await executeDax(`EVALUATE SELECTCOLUMNS(FILTER(${T}, ${T}[HEVRA] = "ICE" && ${T}[סטטוס] = "פעיל"),
      "custId", ${T}[מס. לקוח], "custName", ${T}[שם לקוח], "city", ${T}[עיר], "address", ${T}[כתובת],
      "agentCode", ${T}[סוכן], "agentName", ${T}[שם סוכן], "clientType", ${T}[תאור סוג לקוח])`);
  const gpsRows = await executeDax(`EVALUATE SELECTCOLUMNS(FILTER('משטח_UNICKS', NOT ISBLANK('משטח_UNICKS'[קו רוחב]) && 'משטח_UNICKS'[קו רוחב] <> 0),
      "custId", 'משטח_UNICKS'[מס. לקוח], "lat", 'משטח_UNICKS'[קו רוחב], "lng", 'משטח_UNICKS'[קו אורך])`, iceDatasetId);
  const schedRows = await executeDax(`EVALUATE SELECTCOLUMNS('משטח_ICE', "custId", 'משטח_ICE'[מס.לקוח], "day", 'משטח_ICE'[יום], "status", 'משטח_ICE'[סטטוס])`, iceDatasetId);
  const familyRows = await executeDax(`EVALUATE SELECTCOLUMNS(FILTER(ADIFUT, SEARCH("bdd", ADIFUT[מחלקה], 1, 0) > 0), "fam", ADIFUT[תאור משפחה])`);
  const cache = buildBddCache({ teamRows, clientRows, gpsRows, schedRows, familyRows }, fix);

  // Month + 6-month BDD sales per client (ALL_PARTS, BDD families only).
  if (cache.familiesRaw.length) {
    const famIn = cache.familiesRaw.map(f => `"${String(f).replace(/"/g, '""')}"`).join(', ');
    const now = new Date();
    const s6 = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const e6 = new Date(now.getFullYear(), now.getMonth(), 0);
    const monthRows = await executeDax(`EVALUATE CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
        "s", CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)]), "last", CALCULATE(MAX(ALL_PARTS[תאריך]))),
        ALL_PARTS[תאור משפחת מוצר] IN {${famIn}}, MONTH(ALL_PARTS[תאריך]) = MONTH(TODAY()), YEAR(ALL_PARTS[תאריך]) = YEAR(TODAY()))`);
    const avgRows = await executeDax(`EVALUATE CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
        "s", DIVIDE(CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)]), 6), "o", DIVIDE(CALCULATE(DISTINCTCOUNT(ALL_PARTS[תאריך])), 6)),
        ALL_PARTS[תאור משפחת מוצר] IN {${famIn}},
        ALL_PARTS[תאריך] >= DATE(${s6.getFullYear()},${s6.getMonth() + 1},1), ALL_PARTS[תאריך] <= DATE(${e6.getFullYear()},${e6.getMonth() + 1},${e6.getDate()}))`);
    const patch = (rows, fn) => {
      for (const r of rows) {
        const id = String(r['ALL_PARTS[מספר לקוח]'] || '');
        if (!cache.clientById.has(id)) continue;
        for (const c of cache.byAgent.get(cache.clientById.get(id).agentCode) || []) if (c.custId === id) fn(c, r);
      }
    };
    patch(monthRows, (c, r) => {
      c.monthlySales = Math.round(parseFloat(r['[s]']) || 0);
      c.lastOrderDate = r['[last]'] ? new Date(r['[last]']).toISOString().slice(0, 10) : null;
    });
    patch(avgRows, (c, r) => { c.avg6Sales = Math.round(parseFloat(r['[s]']) || 0); c.avg6Orders = Math.round(parseFloat(r['[o]']) || 0); });
  }
  return cache;
}
```

- [ ] **Step 2: Write the live probe**

```js
// .scratch/probe-bdd-cache.js — delete after Task 3
require('../server/node_modules/dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('../server/powerbi');
const { loadBddCache } = require('../server/bdd');
const fix = { fixBiDi: s => s, fixBiDiAddress: s => s, expandCityAbbrev: s => s };
(async () => {
  const c = await loadBddCache(executeDax, process.env.POWERBI_ICE_DATASET_ID, fix);
  for (const [g, agents] of c.agentsByGroup) {
    const clients = agents.reduce((n, a) => n + new Set((c.byAgent.get(a.agentCode) || []).map(x => x.custId)).size, 0);
    console.log(g, 'agents', agents.length, 'clients', clients);
  }
  const all = [...c.byAgent.values()].flat();
  console.log('rows', all.length, 'noDay', all.filter(x => x.dayNum === null).length, 'withGps', all.filter(x => x.lat).length, 'withMonthSales', all.filter(x => x.monthlySales).length);
  console.log('families', [...c.families].join(' | '));
})().catch(e => console.error('FATAL', e.message));
```

- [ ] **Step 3: Run it**

Run: `node .scratch/probe-bdd-cache.js`
Expected (checked against 2026-09-28 live data): TIMUR 7 agents ≈527 clients, MATVEY 7 ≈593, ALMOG 6 ≈498, SIMHA 5 ≈374, YOSI ≥4 agents. `families` lists only BDD families (Hebrew readable, not reversed). If a group shows 0 clients, the `לקוחות FORM+I+INT[סוכן]` codes don't match `TEAMS[SOHEN NUMBER]` — stop and report, do not patch around it. Also note the `withGps` count: the number without GPS after the full cascade is what the night geocoder will work through (expected small).

- [ ] **Step 4: Cross-check the family list against Priority** — after Task 4 exists, run a one-off script that opens a pool via `server/bdd-priority.js` (`getBddPool('icecrea')`), runs `SELECT FAMILYDES FROM FAMILY`, and prints which of `c.families` are missing. Expected: none missing. A missing name means `unreversePbi` doesn't match the stored form — fix `unreversePbi`, re-run Task 1 tests.

- [ ] **Step 5: Delete the probe and commit**

```bash
rm .scratch/probe-bdd-cache.js
git add server/bdd.js
git commit -m "feat(formula-road): загрузка кэша ICE BDD из PBI"
```

---

### Task 4: `server/bdd-priority.js` — BDD SQL on its own pool

**Files:**
- Create: `server/bdd-priority.js`
- Create (temporary): `.scratch/probe-bdd-docs.js`

`priority-db.js` is **not edited**. SQL is the `ICE INV 23-26` / `ICE DOCS 23-26` M code (`FORMULA PBI DOCS/FORMULA DASHBORD.SemanticModel/definition/tables/`) narrowed to one day, amount formula unchanged, no family filter (done in JS). Promo SQL uses the same SOF_PRICEREC window and CUST/MCUST rule as `clientPromosByCustId` / `custIdsWithActivePromo` in `priority-db.js` (read them first to confirm the window is still identical).

- [ ] **Step 1: Implement**

```js
// server/bdd-priority.js
// ICE BDD Priority queries. Separate module + separate pool on purpose (isolation
// rule): FORMULA's ICE MISH V badge polls icecrea through priority-db.js's pool
// (max 2 connections); a slow BDD query must never hold one of those.
const sql = require('mssql');

// ponytail: config duplicated from priority-db.js (8 lines) instead of exporting it,
// so priority-db.js stays untouched; merge if the DB connection settings ever change.
const cfg = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectTimeout: 10000,
  requestTimeout: 15000,
  pool: { min: 0, max: 2 },
};
const pools = {};
async function getBddPool(dbName) {
  if (pools[dbName]?.connected) return pools[dbName];
  if (!pools[dbName]) pools[dbName] = new sql.ConnectionPool({ ...cfg, database: dbName });
  if (!pools[dbName].connected && !pools[dbName].connecting) await pools[dbName].connect();
  return pools[dbName];
}

// Priority dates: int minutes since 1988-01-01.
function curdateFor(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1988, 0, 1)) / 86400000 * 1440;
}

// Van-sale documents for one day — V badge, סגירת יום and line coverage all read this
// one result (bdd.js summarizeBddDocs). Two branches, same as ALL_PARTS' ICE part:
// INV = final customer invoices (DEBIT='C' → negative = זיכוי), DOCS = delivery notes (D)
// and returns (N, negative) not yet invoiced (TRANSORDER.IV=0, so nothing counts twice).
// Agent = executing agent on the line.
// ponytail: ILS only (CURRENCY=-1) — BDD invoices are shekel; non-ILS lines come back with
// NULL amount and are logged; upgrade to the M code's FNCTRANS/CURREGITEMS rate chain if that log ever fires.
async function bddDocLinesToday(dbName, dateStr) {
  const pool = await getBddPool(dbName);
  const today = curdateFor(dateStr);
  const inv = await pool.request().input('today', sql.BigInt, today).query(`
    SELECT N'INV' AS src, I.IVNUM AS docNo,
      COALESCE(NULLIF(CD.CUSTNAME, ''), C.CUSTNAME) AS custId,
      A.AGENTCODE AS agentCode, A.AGENTNAME AS agentName, F.FAMILYDES AS familyDes,
      SUM(IIT.IVCOST * CASE WHEN I.DEBIT = N'C' THEN -1 ELSE 1 END
                     * CASE WHEN IIT.CREDITFLAG = N'Y' THEN 0 ELSE 1 END
                     * CASE WHEN I.CURRENCY = -1 THEN 1 ELSE NULL END) AS amount
    FROM INVOICES I
    JOIN INVOICEITEMS IIT ON IIT.IV = I.IV
    JOIN ORDERITEMS OI ON OI.ORDI = IIT.ORDI
    JOIN IVTYPES T ON T.TYPE = I.TYPE AND T.DEBIT = I.DEBIT
    JOIN CUSTOMERS C ON C.CUST = I.CUST
    JOIN TRANSORDER TR ON TR.TRANS = IIT.TRANS
    JOIN PART P ON P.PART = IIT.PART
    JOIN FAMILY F ON F.FAMILY = P.FAMILY
    JOIN AGENTS A ON A.AGENT = IIT.AGENT
    LEFT JOIN DOCUMENTS D2 ON D2.DOC = TR.DOC
    LEFT JOIN CUSTOMERS CD ON CD.CUST = D2.CUST
    WHERE I.FINAL = N'Y' AND I.TYPE <> N'R' AND T.OTYPE = N'C'
      AND COALESCE(NULLIF(D2.CURDATE, 0), I.IVDATE) = @today
    GROUP BY I.IVNUM, COALESCE(NULLIF(CD.CUSTNAME, ''), C.CUSTNAME), A.AGENTCODE, A.AGENTNAME, F.FAMILYDES
  `);
  const docs = await pool.request().input('today', sql.BigInt, today).query(`
    SELECT TR.TYPE AS src, D.DOCNO AS docNo, C.CUSTNAME AS custId,
      A.AGENTCODE AS agentCode, A.AGENTNAME AS agentName, F.FAMILYDES AS familyDes,
      SUM(TR.PRICE * TR.TQUANT / 1000.0 * (100 - TR.T$PERCENT) / 100.0
          * (100 - CASE WHEN F.RECYCLINGFLAG = N'Y' THEN 0 ELSE D.T$PERCENT END) / 100.0
          * TR.IEXCHANGE * CASE WHEN TR.TYPE = N'N' THEN -1 ELSE 1 END) AS amount
    FROM TRANSORDER TR
    JOIN DOCUMENTS D ON D.DOC = TR.DOC
    JOIN CUSTOMERS C ON C.CUST = D.CUST
    JOIN ORDERITEMS OI ON OI.ORDI = TR.ORDI
    JOIN ORDERS O ON O.ORD = OI.ORD
    JOIN PART P ON P.PART = TR.PART
    JOIN FAMILY F ON F.FAMILY = P.FAMILY
    JOIN AGENTS A ON A.AGENT = CASE WHEN O.AGENT <> 0 THEN O.AGENT ELSE D.AGENT END
    WHERE TR.TYPE IN (N'D', N'N') AND TR.IV = 0 AND TR.FLAG = N'Y'
      AND D.FINAL = N'Y' AND D.FLAG = N'Y' AND TR.CURDATE = @today
    GROUP BY TR.TYPE, D.DOCNO, C.CUSTNAME, A.AGENTCODE, A.AGENTNAME, F.FAMILYDES
  `);
  const rows = [...inv.recordset, ...docs.recordset].map(r => ({
    src: String(r.src).trim(), docNo: String(r.docNo || '').trim(), custId: String(r.custId),
    agentCode: String(r.agentCode || '').trim(), agentName: String(r.agentName || '').trim(),
    familyDes: String(r.familyDes || '').trim(), amount: r.amount === null ? null : Number(r.amount),
  }));
  const nonIls = rows.filter(r => r.amount === null).length;
  if (nonIls) console.warn(`[bdd-priority] ${nonIls} non-ILS line(s) skipped — see ponytail note`);
  return rows.filter(r => r.amount !== null);
}

const PROMO_WINDOW = `
  YEAR(CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date)) = YEAR(GETDATE())
  AND ((CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) <= CAST(GETDATE() AS date)
        AND CAST(DATEADD(MINUTE, SP.TODATE, '19880101') AS date) >= CAST(GETDATE() AS date))
    OR (CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) > CAST(GETDATE() AS date)
        AND CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) <= DATEADD(DAY, 18, CAST(GETDATE() AS date))))`;

async function bddClientPromos(dbName, custId) {
  try {
    const pool = await getBddPool(dbName);
    const result = await pool.request().input('custId', sql.NVarChar, String(custId)).query(`
      SELECT P.PARTNAME AS sku, P.PARTDES AS name, SP.PRICEREC AS price, SP.QUANTPRICE / 1000.0 AS qty,
        CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) AS fromDate,
        CAST(DATEADD(MINUTE, SP.TODATE,   '19880101') AS date) AS toDate,
        PD.PRICEDESCDESC AS promoType, F.FAMILYDES AS familyDes
      FROM SOF_PRICEREC SP
      JOIN PART P ON P.PART = SP.PART
      JOIN FAMILY F ON F.FAMILY = P.FAMILY
      LEFT JOIN SOF_PRICEDESC PD ON PD.PRICEDESID = SP.PRICEDESID
      WHERE SP.CUST IN (
          SELECT CUST FROM CUSTOMERS WHERE CUSTNAME = @custId
          UNION
          SELECT MCUST FROM CUSTOMERS WHERE CUSTNAME = @custId AND MCUST IS NOT NULL AND MCUST <> 0)
        AND ${PROMO_WINDOW}
      ORDER BY P.PARTDES
    `);
    return result.recordset.map(r => ({
      company: 'ICE_BDD', sku: String(r.sku), name: String(r.name || ''),
      price: Number(r.price) || 0, qty: Number(r.qty) || 0,
      fromDate: r.fromDate ? new Date(r.fromDate).toISOString().slice(0, 10) : '',
      toDate: r.toDate ? new Date(r.toDate).toISOString().slice(0, 10) : '',
      promoType: String(r.promoType || ''), familyDes: String(r.familyDes || '').trim(),
    }));
  } catch (e) {
    console.error(`[bdd-priority] promo lookup failed (cust=${custId}): ${e.message}`);
    return [];
  }
}

// Clients with an active promo, with the family, so the route keeps BDD families only.
async function bddCustFamiliesWithActivePromo(dbName) {
  try {
    const pool = await getBddPool(dbName);
    const result = await pool.request().query(`
      WITH ACTIVE AS (
        SELECT SP.CUST, F.FAMILYDES FROM SOF_PRICEREC SP
        JOIN PART P ON P.PART = SP.PART JOIN FAMILY F ON F.FAMILY = P.FAMILY
        WHERE ${PROMO_WINDOW}
      )
      SELECT DISTINCT C.CUSTNAME, A.FAMILYDES FROM CUSTOMERS C
      JOIN ACTIVE A ON A.CUST = C.CUST OR (C.MCUST <> 0 AND A.CUST = C.MCUST)
    `);
    return result.recordset.map(r => ({ custId: String(r.CUSTNAME), familyDes: String(r.FAMILYDES || '').trim() }));
  } catch (e) {
    console.error(`[bdd-priority] promo list failed: ${e.message}`);
    return null;
  }
}

module.exports = { getBddPool, bddDocLinesToday, bddClientPromos, bddCustFamiliesWithActivePromo };
```

- [ ] **Step 2: Verify against PBI for a closed day** — `.scratch/probe-bdd-docs.js`

```js
require('../server/node_modules/dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('../server/powerbi');
const { bddDocLinesToday } = require('../server/bdd-priority');
const { loadBddCache, summarizeBddDocs } = require('../server/bdd');
const DAY = process.argv[2]; // e.g. 2026-09-27 — a day PBI has already refreshed
const fix = { fixBiDi: s => s, fixBiDiAddress: s => s, expandCityAbbrev: s => s };
(async () => {
  const cache = await loadBddCache(executeDax, process.env.POWERBI_ICE_DATASET_ID, fix);
  const s = summarizeBddDocs(await bddDocLinesToday('icecrea', DAY), cache.families);
  const famIn = cache.familiesRaw.map(f => `"${f.replace(/"/g, '""')}"`).join(', ');
  const pbi = await executeDax(`EVALUATE CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(ALL_PARTS, ALL_PARTS[קוד סוכן]),
    "s", SUM(ALL_PARTS[סכום (שח)])), ALL_PARTS[תאור משפחת מוצר] IN {${famIn}}, ALL_PARTS[תאריך] = DATEVALUE("${DAY}"))`);
  const pbiMap = new Map(pbi.map(r => [String(r['ALL_PARTS[קוד סוכן]']), Math.round(r['[s]'])]));
  for (const [code, a] of s.byAgent) console.log(code, a.agentName, 'priority', Math.round(a.sum), 'pbi', pbiMap.get(code) ?? '-');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
```

Run: `node .scratch/probe-bdd-docs.js 2026-09-27` (use the latest day PBI already contains)
Expected: per agent, `priority` equals `pbi` within ₪1. Column names `ALL_PARTS[קוד סוכן]` / `[סכום (שח)]` come from the M code; if DAX says a column doesn't exist, list `ALL_PARTS` columns with `EVALUATE TOPN(1, ALL_PARTS)` and use the real names. A mismatch on some agents → compare that agent's lines by `src` (X/V DOCS types are deliberately excluded — if the gap equals their sum, report to the user before deciding); do not ship until equal.

Then run Task 3 Step 4 (family cross-check).

- [ ] **Step 3: Delete the probe and commit**

```bash
rm .scratch/probe-bdd-docs.js
git add server/bdd-priority.js
git commit -m "feat(formula-road): SQL ICE BDD из M-кода ALL_PARTS на отдельном пуле"
```

---

### Task 5: Managers roster + session channel

**Files:**
- Modify: `server/data/managers.json` (via Node, not PowerShell)
- Modify: `server/index.js` — `createSession` (~835)

- [ ] **Step 1: Update the roster with Node**

```bash
cd server && node -e "
const fs=require('fs');const f='data/managers.json';const m=JSON.parse(fs.readFileSync(f,'utf8'));
const set={timur:{teams:['TIMUR'],email:'dilerformula84@gmail.com'},'matvey-perlman':{teams:['MATVEY','ALMOG'],email:'dilerformula99@gmail.com'},'simha-arbel':{teams:['SIMHA'],email:'dilerformula231@gmail.com'}};
for(const r of m){const s=set[r.id];if(!s)continue;Object.assign(r,{role:'team',channel:'ICE_BDD',teams:s.teams,email:s.email});delete r.team;}
fs.writeFileSync(f,JSON.stringify(m,null,2)+'\n','utf8');
console.log(m.filter(r=>r.channel).map(r=>r.id+' '+r.teams.join(',')+' team='+r.team).join('\n'));"
```

Expected output: `timur TIMUR team=undefined`, `matvey-perlman MATVEY,ALMOG team=undefined`, `simha-arbel SIMHA team=undefined`. (If an id is missing from the output, open `managers.json` and use the real ids.) `team` must be absent — that is what keeps FORMULA's `managerCanWrite` closed for these sessions.

- [ ] **Step 2: Carry channel/teams into the session** — in `createSession`, inside `if (managerMeta) { … }`, after `sess.managerTeam = managerMeta.team;` add:

```js
    // ICE BDD managers only — FORMULA sessions keep exactly the fields they had.
    if (managerMeta.channel) {
      sess.channel = managerMeta.channel;
      sess.managerTeams = managerMeta.teams || [];
    }
```

- [ ] **Step 3: Prove FORMULA writes are closed for a BDD session** — `.scratch/probe-bdd-write.js`: `require` nothing from index.js; copy `managerCanWrite`'s `team` branch as a function and call it with `{ isManager: true, managerRole: 'team', managerTeam: undefined, channel: 'ICE_BDD' }` against every `pbiCache.byAgent`-like entry `{ manager: 'VLAD' }` etc. Expected: `false` for all. Delete the probe.

- [ ] **Step 4: Check + commit**

Run: `node --check server/index.js`
Expected: no output.

```bash
git add server/data/managers.json server/index.js
git commit -m "feat(formula-road): канал ICE_BDD в сессии менеджера"
```

---

### Task 6: `server/bdd-routes.js` — state, loaders, read routes

**Files:**
- Create: `server/bdd-routes.js`

Everything BDD-stateful lives here. `index.js` passes in only what BDD needs to **read**; FORMULA state arrives through getter functions, never as writable references to reassign.

- [ ] **Step 1: Module skeleton + state + loaders**

```js
// server/bdd-routes.js
// ICE BDD channel: all state, background jobs and /api/bdd/* routes.
// Isolation rule (PRD/ice-bdd-channel-design.md): BDD reads FORMULA state through
// deps.formulaGps() and never writes FORMULA files or caches; every entry point
// catches its own errors so a BDD failure never reaches FORMULA.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { BDD_GROUPS, summarizeBddDocs, bddCanWrite, resolveBddGps, loadBddCache } = require('./bdd');
const { bddDocLinesToday, bddClientPromos, bddCustFamiliesWithActivePromo } = require('./bdd-priority');

const DB = () => process.env.DB_ICECREA || 'icecrea';
const FILES = {
  overrides: path.join(__dirname, 'data', 'route-overrides-bdd.json'),
  geocoded: path.join(__dirname, 'data', 'bdd-geocode-resolved.json'),
  gps: path.join(__dirname, '..', 'docs', 'gps-corrections-bdd.json'),
  mekarer: path.join(__dirname, '..', 'docs', 'mekarer-orders-bdd.json'),
};
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return dflt; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), 'utf8');

// Serializes BDD file writes. Own queue — FORMULA's withGpsCorrectionsLock is not shared.
let writeChain = Promise.resolve();
const withBddLock = fn => (writeChain = writeChain.then(fn, fn));

const BDD_DOCS_CACHE_MS = 75 * 1000;
const BDD_GEOCODE_NIGHT_CAP = 200; // user 2026-09-28: few BDD clients will need it

function createBdd(deps) {
  let cache = null;
  let docsCache = { date: null, at: 0, summary: null };
  let promoIdsCache = { date: null, ids: [] };

  async function load() {
    try {
      const ICE_DS = process.env.POWERBI_ICE_DATASET_ID;
      if (!ICE_DS) return;
      cache = await loadBddCache(deps.executeDax, ICE_DS, deps.fix);
      const n = [...cache.byAgent.values()].reduce((s, a) => s + a.length, 0);
      console.log(`[BDD] cache loaded: ${cache.agentGroup.size} agents, ${n} client-day rows, ${cache.families.size} families`);
    } catch (e) {
      console.error('[BDD] cache load failed:', e.message); // keep previous cache
    }
  }

  async function docsToday() {
    const today = deps.todayIsraelDate();
    const fresh = docsCache.date === today && (Date.now() - docsCache.at) < BDD_DOCS_CACHE_MS;
    if (!fresh && cache) {
      try {
        docsCache = { date: today, at: Date.now(), summary: summarizeBddDocs(await bddDocLinesToday(DB(), today), cache.families) };
      } catch (e) {
        console.error('[BDD] docs query failed:', e.message); // keep last same-day summary
        if (docsCache.date !== today) docsCache = { date: today, at: 0, summary: null };
      }
    }
    return docsCache.summary;
  }

  function gpsSources() {
    const f = deps.formulaGps(); // read-only view of FORMULA state
    const formulaKnown = new Map();
    for (const src of f.clientMaps) {
      if (!src) continue;
      for (const [, list] of src) for (const c of list) if (c.lat && c.lng && !formulaKnown.has(c.custId)) formulaKnown.set(c.custId, { lat: c.lat, lng: c.lng });
    }
    for (const [id, r] of f.resolved) if (!formulaKnown.has(id)) formulaKnown.set(id, r);
    return {
      bddCorr: readJson(FILES.gps, {}),
      formulaCorr: readJson(f.correctionsFile, {}),
      tablet: f.tablet, formulaKnown,
      bddResolved: readJson(FILES.geocoded, {}),
      isValid: deps.isValidIL,
    };
  }

  // 02:00 Israel, sequential, max BDD_GEOCODE_NIGHT_CAP. geocodeAddressCascade's own
  // address cache is keyed by the query string, so an entry added here only ever
  // returns the same answer FORMULA would get for that exact string.
  async function nightGeocode() {
    if (!cache) return;
    const sources = gpsSources();
    const todo = [...cache.clientById.values()].filter(c => !resolveBddGps(c, sources).lat && c.address);
    const resolved = readJson(FILES.geocoded, {});
    let done = 0;
    for (const c of todo.slice(0, BDD_GEOCODE_NIGHT_CAP)) {
      try {
        const r = await deps.geocodeAddressCascade(c.address, c.city);
        if (r && deps.isValidIL(r.lat, r.lng)) { resolved[c.custId] = { lat: r.lat, lng: r.lng, cityCenter: !!r.cityCenter, at: new Date().toISOString() }; done++; }
      } catch (e) { console.error('[BDD geocode]', c.custId, e.message); }
    }
    await withBddLock(() => writeJson(FILES.geocoded, resolved));
    console.log(`[BDD geocode] ${done}/${Math.min(todo.length, BDD_GEOCODE_NIGHT_CAP)} resolved, ${todo.length} were missing`);
  }
  function scheduleNight() {
    setTimeout(() => { nightGeocode().catch(e => console.error('[BDD geocode]', e.message)); scheduleNight(); }, deps.msUntilNextIsraelTime(2, 0));
  }

  let started = false;
  function start() {
    load();
    if (!started) { started = true; scheduleNight(); }
  }

  const router = express.Router();
  // Every /api/bdd route: logged-in BDD manager (or super, for Dan's checks).
  router.use(deps.requireAuth, (req, res, next) => {
    const s = req.session;
    if (s?.channel === 'ICE_BDD' || s?.managerRole === 'super') return next();
    return res.status(403).json({ ok: false, error: 'forbidden' });
  });
  // Async handler wrapper: a thrown error answers 500 here and never escapes the router.
  const h = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
    console.error('[BDD route]', req.path, e.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'server_error' });
  });
  const needCache = res => (cache ? false : (res.status(503).json({ ok: false, error: 'cache_loading' }), true));
  const validAgent = a => /^\d{1,6}$/.test(a);
  const validCust = c => /^\d{1,15}$/.test(c);

  // --- read routes (Task 6) ---
  // --- live routes (Task 7) ---
  // --- write routes (Task 8) ---

  return { router, start };
}

module.exports = { createBdd };
```

- [ ] **Step 2: Read routes** — replace the `// --- read routes (Task 6) ---` line with:

```js
  router.get('/managers', deps.dataRateLimit, (req, res) => res.json(BDD_GROUPS.map(m => ({ managerCode: m }))));

  router.get('/manager-agents', deps.dataRateLimit, h((req, res) => {
    const manager = String(req.query.manager || '');
    if (!BDD_GROUPS.includes(manager)) return res.status(400).json({ error: 'invalid manager' });
    if (needCache(res)) return;
    const agents = cache.agentsByGroup.get(manager) || [];
    res.json([...agents].sort((a, b) => (a.agentName || '').localeCompare(b.agentName || '')));
  }));

  router.get('/agent-exists', deps.dataRateLimit, (req, res) => {
    const agent = String(req.query.agent || '');
    if (!validAgent(agent)) return res.status(400).json({ error: 'invalid agent code' });
    if (!cache) return res.json({ exists: null, reason: 'loading' });
    const list = cache.byAgent.get(agent) || [];
    res.json({ exists: list.length > 0, count: list.length });
  });

  router.get('/customers', deps.dataRateLimit, h((req, res) => {
    const agent = String(req.query.agent || '');
    if (!validAgent(agent)) return res.status(400).json({ error: 'invalid agent code' });
    if (needCache(res)) return;
    const dayNum = req.query.day === undefined ? null : parseInt(req.query.day, 10);
    const all = cache.byAgent.get(agent) || [];
    const dayMoves = readJson(FILES.overrides, {})[agent]?.dayMoves || {};
    const movedAway = new Set(Object.keys(dayMoves));
    const clients = dayNum === 0 ? all.filter(c => c.dayNum === null && !movedAway.has(c.custId))
      : dayNum ? all.filter(c => c.dayNum === dayNum && !movedAway.has(c.custId))
      : all.slice();
    if (dayNum) {
      for (const [id, mv] of Object.entries(dayMoves)) {
        if (mv?.day !== dayNum || clients.some(c => c.custId === id)) continue;
        const found = all.find(c => c.custId === id);
        if (found) clients.push({ ...found, dayNum, priorityOrder: 9500 });
      }
    }
    // No live geocoding here — it spends quota FORMULA depends on; gaps are filled at night.
    const sources = gpsSources();
    res.json(clients.map(c => ({ ...c, ...resolveBddGps(c, sources) })));
  }));

  router.get('/route-overrides', deps.dataRateLimit, (req, res) => {
    const agent = String(req.query.agent || '');
    if (!validAgent(agent)) return res.status(400).json({ ok: false, error: 'invalid agent code' });
    const entry = readJson(FILES.overrides, {})[agent] || { order: {}, dayMoves: {} };
    res.json({ ok: true, order: entry.order || {}, dayMoves: entry.dayMoves || {} });
  });
```

Before writing `/customers`, read FORMULA's `/customers` handler (`index.js` ~2218) and confirm how it parses `day` (the value the frontend sends for "לא מוגדר" and for "all days"); mirror exactly that parsing in the line `const dayNum = …`. Same check for `validAgent`: copy the regex from `validateAgentCode` in `index.js`.

- [ ] **Step 3: Check**

Run: `node --check server/bdd-routes.js && node -e "const {createBdd}=require('./server/bdd-routes'); const b=createBdd({requireAuth:(q,s,n)=>n(),dataRateLimit:(q,s,n)=>n()}); console.log(typeof b.router, typeof b.start)"`
Expected: `function function`

- [ ] **Step 4: Commit**

```bash
git add server/bdd-routes.js
git commit -m "feat(formula-road): роутер ICE BDD — кэш, координаты, маршрут агента"
```

---

### Task 7: `bdd-routes.js` — live routes (V, coverage, סגירת יום)

**Files:**
- Modify: `server/bdd-routes.js`

- [ ] **Step 1: Replace `// --- live routes (Task 7) ---` with:**

```js
  // Same response keys as FORMULA's /api/today-orders + `bdd`, so the frontend poll
  // code runs unchanged and only reads the extra key.
  router.get('/api/today-orders', deps.dataRateLimit, h(async (req, res) => {
    const s = await docsToday();
    res.json({ ok: true, formula: [], iceMish: [], bdd: s ? [...s.custIds] : [] });
  }));

  // Line coverage: denominator = agent's clients scheduled today (משטח_ICE),
  // numerator/sum = what that agent executed today (BDD families). Same shape as FORMULA.
  router.get('/api/team-order-stats', deps.dataRateLimit, h(async (req, res) => {
    if (needCache(res)) return;
    const s = await docsToday();
    const todayDay = deps.todayRouteDay();
    const byAgent = {}, byManager = {};
    for (const [group, agents] of cache.agentsByGroup) {
      const acc = { denom: 0, numer: 0, sum: 0 };
      for (const a of agents) {
        const denom = (cache.byAgent.get(a.agentCode) || []).filter(c => c.dayNum === todayDay).length;
        const d = s?.byAgent.get(a.agentCode);
        byAgent[a.agentCode] = { denom, numer: d?.custCount || 0, sum: d?.sum || 0 };
        acc.denom += denom; acc.numer += byAgent[a.agentCode].numer; acc.sum += byAgent[a.agentCode].sum;
      }
      byManager[group] = acc;
    }
    res.json({ ok: true, byAgent, byManager });
  }));

  // סגירת יום: by executing agent, net of החזרות/זיכויים, no new-clients section.
  router.get('/api/day-closing', deps.dataRateLimit, h(async (req, res) => {
    const agentCode = String(req.query.agentCode || '');
    if (!validAgent(agentCode)) return res.status(400).json({ ok: false, error: 'agentCode required' });
    const s = await docsToday();
    if (!s) return res.status(503).json({ ok: false, error: 'priority_unavailable' });
    const a = s.byAgent.get(agentCode);
    res.json({ ok: true, type: 'bdd', custCount: a?.custCount || 0, sum: a?.sum || 0,
      sales: a?.sales || 0, returns: a?.returns || 0, credits: a?.credits || 0, items: [], byClient: [], byAgent: [] });
  }));
```

Before writing `/api/day-closing`, read the keys FORMULA's `/api/day-closing` returns (`index.js` ~5816) and what `docs/day-closing.html` reads from the response; add any key the page reads unconditionally (with an empty/zero value) so the page renders without errors.

- [ ] **Step 2: Check + commit**

Run: `node --check server/bdd-routes.js` → no output.

```bash
git add server/bdd-routes.js
git commit -m "feat(formula-road): V, покрытие линии и סגירת יום ICE BDD из Priority"
```

---

### Task 8: `bdd-routes.js` — write routes (day move, GPS, fridge, promos)

**Files:**
- Modify: `server/bdd-routes.js`

- [ ] **Step 1: Replace `// --- write routes (Task 8) ---` with:**

```js
  router.post('/api/route-day-move', deps.dayMoveRateLimit, h(async (req, res) => {
    const { custId, day, client, agentCode } = req.body || {};
    const a = String(agentCode || '');
    if (!validAgent(a)) return res.status(400).json({ ok: false, error: 'invalid agent code' });
    if (!bddCanWrite(req.session, a, cache)) return res.status(403).json({ ok: false, error: 'forbidden' });
    if (!custId || typeof custId !== 'string') return res.status(400).json({ ok: false, error: 'invalid custId' });
    const dayNum = parseInt(day, 10);
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 5) return res.status(400).json({ ok: false, error: 'invalid day' });
    const id = custId.slice(0, 20);
    await withBddLock(() => {
      const data = readJson(FILES.overrides, {});
      if (!data[a]) data[a] = { order: {}, dayMoves: {} };
      if (client && typeof client === 'object') data[a].dayMoves[id] = { day: dayNum, client, movedAt: new Date().toISOString() };
      else delete data[a].dayMoves[id]; // no client payload = moved back to its original day
      writeJson(FILES.overrides, data);
    });
    deps.writeLog({ ts: new Date().toISOString(), event: 'route-day-move-bdd', agentCode: a, custId: id, day: dayNum, ip: deps.getRealIp(req) });
    res.json({ ok: true });
  }));

  router.post('/save-gps', deps.dataRateLimit, h(async (req, res) => {
    const { custId, lat, lng, name, city, address } = req.body || {};
    if (!custId || !lat || !lng) return res.status(400).json({ error: 'missing custId/lat/lng' });
    if (!validCust(String(custId))) return res.status(400).json({ error: 'invalid custId' });
    if (!deps.isValidIL(lat, lng)) return res.status(400).json({ error: 'coordinates outside Israel' });
    const client = cache?.clientById.get(String(custId));
    if (!client || !bddCanWrite(req.session, client.agentCode, cache)) return res.status(403).json({ error: 'forbidden' });
    const total = await withBddLock(() => {
      const current = readJson(FILES.gps, {});
      current[String(custId)] = { lat, lng, correctedAt: new Date().toISOString(), name: name || '', city: city || '', address: address || '' };
      writeJson(FILES.gps, current);
      return Object.keys(current).length;
    });
    res.json({ ok: true, total });
  }));

  router.post('/api/mekarer-order', h(async (req, res) => {
    const body = req.body || {};
    const client = cache?.clientById.get(String(body.custId || ''));
    if (!client || !bddCanWrite(req.session, client.agentCode, cache)) return res.status(403).json({ error: 'forbidden' });
    const order = {
      channel: 'ICE BDD', custId: client.custId, custName: String(body.custName || client.custName).substring(0, 100),
      city: String(body.city || client.city).substring(0, 60), agentName: client.agentName, manager: client.manager,
      contactName: String(body.contactName || '').substring(0, 80), phone: String(body.phone || '').substring(0, 20),
      location: String(body.location || '').substring(0, 200),
      mekarerim: Array.isArray(body.mekarerim) ? body.mekarerim.slice(0, 50) : [],
    };
    const id = Date.now();
    await withBddLock(() => {
      const list = readJson(FILES.mekarer, []);
      list.push({ id, ...order, submittedAt: new Date().toISOString(), managerId: req.session.managerId || null });
      writeJson(FILES.mekarer, list);
    });
    deps.writeLog({ ts: new Date().toISOString(), event: 'mekarer-order-bdd', id, custId: order.custId, ip: deps.getRealIp(req) });
    res.json({ ok: true, id });
    if (deps.resend && process.env.NOTIFY_EMAIL) sendMekarerEmail(order, id).catch(e => console.error('[mekarer-bdd] email', e.message));
  }));

  router.get('/api/promo-cust-ids', deps.dataRateLimit, h(async (req, res) => {
    const today = deps.todayIsraelDate();
    if (promoIdsCache.date !== today && cache) {
      const rows = await bddCustFamiliesWithActivePromo(DB());
      if (rows) promoIdsCache = { date: today, ids: [...new Set(rows.filter(r => cache.families.has(r.familyDes)).map(r => r.custId))] };
    }
    // Key names match FORMULA's response; BDD clients are flagged through iceMish.
    res.json({ ok: true, formula: [], iceMish: promoIdsCache.ids });
  }));

  router.get('/api/client-promos/:custId', h(async (req, res) => {
    const custId = String(req.params.custId || '').trim();
    if (!validCust(custId)) return res.status(400).json({ ok: false, error: 'invalid custId' });
    const promos = (await bddClientPromos(DB(), custId)).filter(p => cache?.families.has(p.familyDes));
    res.json({ ok: true, promos });
  }));
```

- [ ] **Step 2: Match response/request shapes to FORMULA** — read these FORMULA handlers and align the BDD versions (keys only; do not edit the FORMULA handlers):
  - `/api/mekarer-order` (`index.js` ~3268): the request body field names the fridge form sends (`custId`, `mekarerim`, …) and the success response.
  - `/api/client-promos/:custId` (~6240): it returns `cached.data`; find what `data` looks like (`grep -n "clientPromosCache.set" server/index.js`) and return the same top-level keys and per-promo item keys (photos may be empty).
  - `/api/promo-cust-ids` (~6365): confirm the frontend treats `iceMish` ids as "has promo" for any client (`grep -n "promo-cust-ids" -A8 docs/formula-road.html`); if it filters by `c.iceOnly`, return BDD ids in the key the frontend checks for `hevra==='ICE_BDD'` rows and note it in Task 10.

- [ ] **Step 3: Fridge email** — add `async function sendMekarerEmail(order, id)` inside `createBdd` (before `return`): copy the FORMULA handler's email block (Excel build + `deps.resend.emails.send`) verbatim, then change only: title `הזמנת מקרר חדשה — ICE BDD — ${order.custName}`, first info row `['ערוץ', 'ICE BDD']`, add row `['מנהל', order.manager]`, subject prefixed `[ICE BDD] `. `require` in `bdd-routes.js` whatever the block uses (e.g. `exceljs`) — the same packages `index.js` already requires. Do **not** refactor the FORMULA block to share code.

- [ ] **Step 4: Check + commit**

Run: `node --check server/bdd-routes.js` → no output.

```bash
git add server/bdd-routes.js
git commit -m "feat(formula-road): перенос дня, GPS, холодильник и акции ICE BDD"
```

---

### Task 9: Mount the router + channel to the browser (`index.js`)

**Files:**
- Modify: `server/index.js` — exactly the "FORMULA touch points" table, nothing else

- [ ] **Step 1: Require** — next to the other `require('./…')` lines at the top:

```js
const { createBdd } = require('./bdd-routes');
```

- [ ] **Step 2: Mount** — directly after the `/api/route-overrides` GET handler (~6025; any spot after `requireAuth`, the rate limiters, `geocodeResolvedCache`, `tabletGpsCache` and `todayRouteDay` are defined works — `grep -n` each to confirm they are above this line):

```js
// ICE BDD channel — own router, own files; see server/bdd-routes.js (isolation rule).
const bdd = createBdd({
  requireAuth, dataRateLimit, dayMoveRateLimit, executeDax,
  fix: { fixBiDi, fixBiDiAddress, expandCityAbbrev },
  todayIsraelDate, todayRouteDay, msUntilNextIsraelTime, isValidIL, geocodeAddressCascade,
  writeLog, getRealIp, resend,
  formulaGps: () => ({ // read-only view for the BDD GPS cascade
    clientMaps: [pbiCache?.byAgent, pbiCache?.noScheduleByAgent, pbiCache?.iceByAgent],
    resolved: geocodeResolvedCache, tablet: tabletGpsCache,
    correctionsFile: path.join(__dirname, '..', 'docs', 'gps-corrections.json'),
  }),
});
app.use('/api/bdd', bdd.router);
```

Confirm the map names `noScheduleByAgent` / `iceByAgent` exist on `pbiCache` (`grep -n "pbiCache = {" -A20 server/index.js`); drop any that don't. `geocodeResolvedCache` must be a `Map` of custId → `{lat,lng}` — check its declaration (~1444) and adapt the loop in `gpsSources` if its values differ.

- [ ] **Step 3: Start after FORMULA's load** — in `_loadPBICacheAttempt`, right after the `console.log(\`[PBI] Cache loaded: …\`)` line:

```js
    // BDD 2 min after FORMULA: its DAX never competes with FORMULA's load or first requests.
    setTimeout(() => bdd.start(), 2 * 60 * 1000);
```

(`bdd` is declared further down the file but this runs asynchronously after module init, so it is defined by then; `start()` is idempotent for the night scheduler and just reloads the cache on each FORMULA reload.)

- [ ] **Step 4: Invite redirect** — in `_inviteRedirect`, replace the final `return res.redirect(…)` with:

```js
  const ch = managerMeta?.channel ? `&_ch=${encodeURIComponent(managerMeta.channel)}` : '';
  return res.redirect(302, `https://api.sverdlik-apps.site/formula-road?_inv=${inv}&_ac=${code}&_an=${name}&_im=${isManager ? '1' : '0'}${ch}`);
```

(Read the function first: use whatever variable already holds the resolved manager row; if it isn't in scope, resolve it the same way the function does for `managerMeta` in `createSession`.)

- [ ] **Step 5: `/auth/pbi`** — change the success `res.json` to:

```js
  return res.json({ ok: true, managerName: managerMeta ? (managerMeta.nameHe || managerMeta.name) : null, token, ...(managerMeta?.channel ? { channel: managerMeta.channel } : {}) });
```

- [ ] **Step 6: Check the diff is only the touch points**

Run: `node --check server/index.js && git diff --stat server/index.js && git diff server/index.js`
Expected: `--check` silent; the diff shows only Steps 1-5 plus Task 5 Step 2. Anything else → revert it.

- [ ] **Step 7: Commit**

```bash
git add server/index.js
git commit -m "feat(formula-road): подключить роутер /api/bdd и передать канал при входе"
```

---

### Task 10: Frontend — URL rewrite, groups, V, hidden buttons, day-closing

**Files:**
- Modify: `docs/formula-road.html`
- Modify: `docs/day-closing.html`

- [ ] **Step 1: Channel in saved login** — read the invite handling block (~1975, `_im`/`_an`/`_ac` params). Where it builds `{isManager:true, code:'mgr', name:…}`, add `channel: new URLSearchParams(location.search).get('_ch') || null`. In the `/auth/pbi` branch (~2075) the saved object becomes:

```js
        localStorage.setItem('frAgent', JSON.stringify({code:'mgr',name:_mgrName,isManager:true,channel:j.channel||null}));
```

Next to `_loadAuth` add:

```js
function _isBdd(){ return _loadAuth()?.channel==='ICE_BDD'; }
// BDD sessions: these endpoints are served by the /api/bdd router. FORMULA: URL unchanged.
const BDD_PATHS=['/customers','/manager-agents','/agent-exists','/save-gps','/api/today-orders','/api/team-order-stats','/api/day-closing','/api/promo-cust-ids','/api/client-promos/','/api/route-overrides','/api/route-day-move','/api/mekarer-order'];
function _bddUrl(url){
  if(!_isBdd()) return url;
  const p=String(url).startsWith(API)?String(url).slice(API.length):String(url);
  return BDD_PATHS.some(b=>p===b||p.startsWith(b+'?')||(b.endsWith('/')&&p.startsWith(b))) ? API+'/api/bdd'+p : url;
}
```

- [ ] **Step 2: Route `apiFetch` through it** — in `apiFetch` (~1409) change `r = await fetch(url, …)` to `r = await fetch(_bddUrl(url), …)`, and the retry `fetch(url, { ...opts, headers: newHeaders })` (~1452) to `fetch(_bddUrl(url), …)`. Check that the fridge form submit uses `apiFetch` (`grep -n "mekarer-order" docs/formula-road.html`); if it calls `fetch` directly, wrap its URL in `_bddUrl(…)` too.

- [ ] **Step 3: Group list** — after `const DEMO_MANAGERS = [...]` (~1565):

```js
const BDD_GROUPS = ['TIMUR','ALMOG','MATVEY','SIMHA','YOSI'];
function _mgrList(){ return _isBdd() ? BDD_GROUPS : DEMO_MANAGERS; }
```

Replace every `DEMO_MANAGERS.map(` / `DEMO_MANAGERS.forEach(` in `renderLogin`, `_clearTeamStatsTiles`, `_refreshTeamStats` with `_mgrList().map(` / `_mgrList().forEach(` (`grep -n "DEMO_MANAGERS\." docs/formula-road.html`). In `selectManager`, change `if(STATIC_DATA?.agentsByManager?.[mgr]){` to `if(!_isBdd() && STATIC_DATA?.agentsByManager?.[mgr]){`.

- [ ] **Step 4: V set** — in the `st` initializer add `todayOrdersBdd: new Set(),`. In the today-orders poll after `st.todayOrdersIce=…` add `st.todayOrdersBdd=new Set((d.bdd||[]).map(String));` and next to `markSeen(st.todayOrdersIce,'I_');` add `markSeen(st.todayOrdersBdd,'B_');`. The V line (~3501) becomes:

```js
    const hasOrderToday=(c.hevra==='ICE_BDD'?st.todayOrdersBdd:c.iceOnly?st.todayOrdersIce:st.todayOrdersFormula).has(String(c.custId));
```

- [ ] **Step 5: Banner + day-closing type** — in `_updateFormulaBanner` change `&type=formula` to `&type=${_isBdd()?'bdd':'formula'}` (the URL goes through `apiFetch` → rewritten to `/api/bdd/api/day-closing`). Find the סגירת יום buttons (`grep -n "openDayClosing(" docs/formula-road.html`, ~3566) and make the FORMULA one call `openDayClosing(_isBdd()?'bdd':'formula')`; give the ICE one `class="dc-ice-btn"` if it has no id.

- [ ] **Step 6: Hide what BDD doesn't use** — add to the main `<style>`:

```css
body.bdd .zikuy-btn, body.bdd .ai-insight-btn, body.bdd #day-briefing-btn, body.bdd #yedaim-btn,
body.bdd #blank-history-btn, body.bdd #sort-btn-priority, body.bdd .dc-ice-btn,
body.bdd .km-more-item[onclick^="openYedaim"], body.bdd .km-more-item[onclick^="openBlankHistory"]{display:none!important}
```

Verify each selector exists in the file (`grep -n` the class/id); replace any that don't with the real selector of that button. At startup (right after `loadStaticData()` is first called) add `document.body.classList.toggle('bdd', _isBdd());`. Where the route first renders (`initRoute` or equivalent), when `_isBdd()` call `setSort('ai')`.

- [ ] **Step 7: `docs/day-closing.html`** — it has its own `apiFetch(path)` (~226). Read how `type` is obtained from the URL, then:

The fetch (~`apiFetch(\`/api/day-closing?agentCode=…`) becomes:
```js
apiFetch(`${type==='bdd'?'/api/bdd':''}/api/day-closing?agentCode=${encodeURIComponent(agentCode)}&type=${type}`
```
(keep the rest of the existing query string as it is.) Title (~244):
```js
document.getElementById('page-title').textContent = type==='bdd' ? 'סגירת יום ICE BDD' : type==='ice' ? 'סגירת יום ICE' : 'סגירת יום פורמולה';
```
Label (~279):
```js
  document.getElementById('dc-type').textContent = type==='bdd' ? 'ICE BDD' : type==='ice' ? 'ICE' : 'FORMULA';
```
The `dc-new-line` block (~292-299) becomes:
```js
  const newLine = document.getElementById('dc-new-line');
  newLine.style.display = '';
  if(type==='bdd'){
    const ret = Math.round((d.returns||0) + (d.credits||0));
    newLine.innerHTML = `החזרות וזיכויים: <b>${ret ? '−₪'+Math.abs(ret).toLocaleString('he-IL') : '0'}</b>`;
  } else if(d.newCustCount > 0){
    const newSumText = Number(d.newSum||0).toLocaleString('he-IL',{maximumFractionDigits:0});
    newLine.innerHTML = `מתוכם לקוחות חדשים: <b>${d.newCustCount}</b> — ₪<b>${newSumText}</b>`;
  } else {
    newLine.innerHTML = `לקוחות חדשים: <b>0</b>`;
  }
```

- [ ] **Step 8: Commit**

```bash
git add docs/formula-road.html docs/day-closing.html
git commit -m "feat(formula-road): экран ICE BDD — группы, V, скрытые кнопки, סגירת יום"
```

---

### Task 11: JS syntax check + local UI check (puppeteer)

**Files:**
- Create (temporary): `.scratch/syntax-check.js`, `.scratch/ui-bdd.js`

- [ ] **Step 1: Syntax-check inline scripts** (catches smart quotes from edits)

```js
// .scratch/syntax-check.js
const fs = require('fs'); const vm = require('vm');
for (const f of ['docs/formula-road.html', 'docs/day-closing.html']) {
  const html = fs.readFileSync(f, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  scripts.forEach((s, i) => { try { new vm.Script(s); } catch (e) { console.log(f, 'script', i, e.message); process.exitCode = 1; } });
}
console.log('done');
```

Run: `node .scratch/syntax-check.js` → Expected: only `done`.

- [ ] **Step 2: `_bddUrl` unit check** — in the same puppeteer page (Step 3), `page.evaluate` with channel ICE_BDD: `_bddUrl(API+'/customers?agent=1&day=2')` → `…/api/bdd/customers?agent=1&day=2`; `_bddUrl(API+'/api/route-order')` → unchanged; `_bddUrl(API+'/api/client-promos/123')` → `…/api/bdd/api/client-promos/123`. With channel null: all three unchanged.

- [ ] **Step 3: Screenshot BDD + FORMULA** — `.scratch/ui-bdd.js` opens `docs/formula-road.html` from a local static server (`npx http-server docs -p 8099 -s`, run in background), sets `localStorage.frAgent` to `{"code":"mgr","name":"טימור","isManager":true,"channel":"ICE_BDD"}` via `page.evaluateOnNewDocument`, uses a normal Chrome user agent, intercepts `api.sverdlik-apps.site` requests with `page.setRequestInterception(true)` and answers `/api/bdd/manager-agents` and `/api/bdd/api/team-order-stats` with the TIMUR agents from Task 3's probe (and logs any intercepted request that is **not** under `/api/bdd/` while in BDD mode — expected: only `/auth*`, `/log-access`, `/api/event`, `/api/client-error`). Screenshot the manager screen at 390×844 (phone) and 820×1180 (tablet) to `.scratch/bdd-*.png`. Repeat with `channel:null` → `.scratch/formula-*.png`; in that run, log any request that **is** under `/api/bdd/` — expected: none. Look at all four screenshots.

Expected: BDD shows 5 tiles TIMUR/ALMOG/MATVEY/SIMHA/YOSI; FORMULA shows its 6 tiles unchanged. Route screen in BDD: no זיכוי / 🔍 AI / ניתוח / יעדים / Priority-sort buttons; 🚫 📅 📍 🧊 W present.

- [ ] **Step 4: Delete scratch files** (`rm .scratch/syntax-check.js .scratch/ui-bdd.js .scratch/*.png`). No commit.

---

### Task 12: Invite script `--bdd` mode

**Files:**
- Modify: `server/send-formula-road-invites.js`

- [ ] **Step 1: BDD roster + text** — after `const ONLY_TO = …` add:

```js
const BDD = process.argv.includes('--bdd');
```

In `emailHtml`, add a `bdd` parameter; when true, replace the `<li>` items with:

```js
    <li><b>כל צוותי ICE BDD</b> — סוכנים, לקוחות וימי ביקור לפי משטח ICE</li>
    <li><b>מסלול חכם</b> — סדר ביקורים לפי GPS, מפה, ניווט ב-Waze/Google</li>
    <li><b>✔️ חי מ-Priority</b> — לקוח שקיבל היום חשבונית או תעודת משלוח מסומן תוך דקה</li>
    <li><b>סגירת יום ואחוז כיסוי קו</b> — מכירה נטו של הסוכן להיום, אחרי החזרות וזיכויים</li>
    <li><b>מבצעים והזמנת מקרר</b> — ישירות מכרטיס הלקוח</li>
```

and the scope line with `'הקישור למטה בשבילך — נכנס אוטומטית עם הרשאת מנהל ICE BDD. עריכה פתוחה עבור הצוות שלך.'`.

In `main()`, when `BDD` is set, build `rows` from `server/data/managers.json` instead of the xlsx (skip the xlsx read):

```js
  if (BDD) {
    const roster = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'managers.json'), 'utf8'));
    rows.push(...roster.filter(m => m.channel === 'ICE_BDD' && m.email)
      .map(m => ({ agentCode: '', agentName: m.name, email: m.email, isManager: true })));
  }
```

`agentName` must be `m.name` exactly — `_inviteRedirect` resolves the manager by name. Subject for BDD: `'FORMULA ROAD — ICE BDD · כלי עבודה חדש למנהלים'`.

- [ ] **Step 2: Dry run locally**

Run: `cd server && node send-formula-road-invites.js --bdd`
Expected: `DRY RUN — 3 recipient(s)` and three `[MANAGER]` lines (Timur, Matvey, Simha). Dry run still writes links into the local `short-invites.json` — revert that file afterwards (`git checkout server/data/short-invites.json` if tracked, else delete the new keys). Real links are created on the VPS (Task 13).

- [ ] **Step 3: Commit**

```bash
git add server/send-formula-road-invites.js
git commit -m "feat(formula-road): рассылка инвайтов менеджерам ICE BDD (--bdd)"
```

---

### Task 13: Deploy, verify on prod, send invites

- [ ] **Step 1: Isolation diff gate** — `git diff checkpoint-before-ice-bdd --stat -- server/ docs/` : changed existing files must be only `server/index.js`, `server/data/managers.json`, `server/send-formula-road-invites.js`, `docs/formula-road.html`, `docs/day-closing.html`; `server/priority-db.js` must **not** appear. `git diff checkpoint-before-ice-bdd -- server/index.js` = only the touch-points table.

- [ ] **Step 2: Baseline FORMULA before deploy** — with Dan's PBI session, save the JSON of `/api/team-order-stats`, `/manager-agents?manager=VLAD` and `/customers?agent=<one FORMULA agent>&day=<today>` to `.scratch/before-*.json`.

- [ ] **Step 3: Push once** — `git push` (all commits). Do **not** dispatch any build workflow manually.

- [ ] **Step 4: Deploy on VPS** (PowerShell, ssh-agent):
`ssh root@31.154.67.58 "cd /root/COLUMBUS && git fetch && git reset --hard origin/master && pm2 restart columbus-api"`

- [ ] **Step 5: Verify** — `curl https://api.sverdlik-apps.site/health` → 200; after ~3 min `ssh … "pm2 logs columbus-api --lines 80 --nostream"` shows `[PBI] Cache loaded` **and** `[BDD] cache loaded: … agents`. No `[BDD] cache load failed`.

- [ ] **Step 6: Negative control (release gate)** — repeat Step 2 into `.scratch/after-*.json`; `manager-agents` and `customers` must be identical, `team-order-stats` identical apart from live-order movement since the baseline (compare `denom` exactly). Log in as a FORMULA manager in the browser: groups VLAD/ALEXEY/…, V and סגירת יום as before. `curl` any `/api/bdd/customers?agent=1` with a FORMULA manager token → 403.

- [ ] **Step 7: Test invite to Dan first** — on the VPS create a short invite for Timur's manager name (`makeShortInvite`), Dan opens it and checks the BDD screens (groups, agents, route, V, סגירת יום, fridge form). Dan approves → on the VPS `cd /root/COLUMBUS/server && node send-formula-road-invites.js --bdd --send` (3 emails, CC Dan).

- [ ] **Step 8: Vault + cleanup** — update the Formula Road topic file in `VAULT/Meeting Notes/` with a dated `[shipped]` entry; delete the `.scratch` leftovers.
