# История покрытия линии — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Менеджер видит, в какие дни недели его агенты хуже всего проходят линию визитов (FORMULA + ICE BDD), по вечерним снимкам и восстановленному прошлому.

**Architecture:** Чистые функции в `server/coverage.js` (линия дня с переносами, подсчёт, доступ, период) + SQLite-хранилище `server/coverage-db.js`. Сервер пишет один снимок в день (20:07, повтор 20:47), при первом старте восстанавливает период. Страница `docs/coverage-history.html` только читает `/api/coverage-history`. Плитки менеджеров переходят на ту же функцию линии.

**Tech Stack:** Node.js/Express, better-sqlite3, mssql (Priority), node:test, ванильный JS/HTML (RTL), puppeteer для UI-проверки.

**Спека:** `PRD/coverage-history-design.md`

---

## Файлы

| Файл | Что |
|---|---|
| Create `server/coverage.js` | чистые функции: `routeDayOf`, `coveragePeriod`, `lineFor`, `coverageCounts`, `creditedCustsByAgent`, `coverageScope` |
| Create `server/coverage.test.js` | тесты node:test для coverage.js |
| Create `server/coverage-db.js` | `openCoverageDb(file)` → `upsert`, `hasSnapshot`, `hasAnyBackfill`, `datesWithRows`, `readRange` |
| Create `server/coverage-db.test.js` | тесты на временном файле |
| Modify `server/index.js` | team-order-stats FORMULA через `lineFor`; `formulaCoverageRows`; снимок/повтор/досчёт/восстановление; `/api/coverage-history`; отдача страницы |
| Modify `server/bdd-routes.js` | team-order-stats BDD через `lineFor`; `coverageRows(date)`, `ready()` в возвращаемом объекте |
| Create `docs/coverage-history.html` | страница: топ-3 + тепловая карта |
| Modify `docs/formula-road.html` | плитка 📉 и общая функция симметрии сетки |

Запуск тестов везде: `cd server && node --test coverage.test.js coverage-db.test.js bdd.test.js`

---

### Task 1: Чистые функции `server/coverage.js`

**Files:**
- Create: `server/coverage.js`
- Test: `server/coverage.test.js`

- [ ] **Step 1: Написать падающие тесты**

```js
// server/coverage.test.js
const test = require('node:test');
const assert = require('node:assert');
const { routeDayOf, coveragePeriod, lineFor, coverageCounts, creditedCustsByAgent, coverageScope } = require('./coverage');

test('routeDayOf: Sun..Thu → 1..5, Fri/Sat → null', () => {
  assert.strictEqual(routeDayOf('2026-09-27'), 1); // Sunday
  assert.strictEqual(routeDayOf('2026-10-01'), 5); // Thursday
  assert.strictEqual(routeDayOf('2026-10-02'), null); // Friday
  assert.strictEqual(routeDayOf('2026-10-03'), null); // Saturday
});

test('coveragePeriod: 3 full months back + current month to yesterday', () => {
  assert.deepStrictEqual(coveragePeriod('2026-09-30'), { from: '2026-06-01', to: '2026-09-29' });
  assert.deepStrictEqual(coveragePeriod('2026-01-01'), { from: '2025-10-01', to: '2025-12-31' });
  assert.deepStrictEqual(coveragePeriod('2026-03-15'), { from: '2025-12-01', to: '2026-03-14' });
});

test('lineFor: scheduled day minus moved-away plus moved-in', () => {
  const scheduled = [
    { custId: '1', dayNum: 2 }, { custId: '2', dayNum: 2 }, { custId: '3', dayNum: 3 }, { custId: '4', dayNum: 2 },
  ];
  const dayMoves = { '2': { day: 4 }, '3': { day: 2 }, '9': { day: 2 } };
  const line = lineFor({ scheduled, dayMoves, dayNum: 2, movedInOk: id => id !== '9' });
  assert.deepStrictEqual([...line].sort(), ['1', '3', '4']);
});

test('lineFor: no moves = plain scheduled day (negative control vs old denom)', () => {
  const scheduled = [{ custId: '1', dayNum: 2 }, { custId: '2', dayNum: 2 }, { custId: '2', dayNum: 2 }, { custId: '3', dayNum: 3 }];
  const line = lineFor({ scheduled, dayMoves: {}, dayNum: 2, movedInOk: () => true });
  assert.deepStrictEqual([...line].sort(), ['1', '2']);
});

test('coverageCounts: planned / inLine / offLine', () => {
  const r = coverageCounts(new Set(['1', '2', '3']), new Set(['2', '7', '8']));
  assert.deepStrictEqual(r, { planned: 3, inLine: 1, offLine: 2 });
  assert.deepStrictEqual(coverageCounts(new Set(), new Set()), { planned: 0, inLine: 0, offLine: 0 });
});

test('creditedCustsByAgent: roster owner AND entering agent both credited', () => {
  const rows = [
    { custId: '100', dispPrice: 50, enteringAgentCode: '53' },
    { custId: '100', dispPrice: 10, enteringAgentCode: '53' },
    { custId: '200', dispPrice: 5, enteringAgentCode: null },
  ];
  const roster = new Map([['100', '110'], ['200', '53']]);
  const { custs, sums } = creditedCustsByAgent(rows, roster);
  assert.deepStrictEqual([...custs.get('110')], ['100']);
  assert.deepStrictEqual([...custs.get('53')].sort(), ['100', '200']);
  assert.strictEqual(sums.get('110'), 60);
  assert.strictEqual(sums.get('53'), 65);
});

test('coverageScope: super all, team own, bdd team own groups, readonly none', () => {
  assert.deepStrictEqual(coverageScope({ isManager: true, managerRole: 'super' }), { formula: '*', bdd: '*' });
  assert.deepStrictEqual(coverageScope({ isManager: true, managerRole: 'team', managerTeam: 'ALEXEY' }), { formula: ['ALEXEY'], bdd: null });
  assert.deepStrictEqual(
    coverageScope({ isManager: true, managerRole: 'readonly', channel: 'ICE_BDD', bddRole: 'team', managerTeams: ['MATVEY', 'ALMOG'] }),
    { formula: null, bdd: ['MATVEY', 'ALMOG'] });
  assert.deepStrictEqual(coverageScope({ isManager: true, managerRole: 'readonly', bddAccess: true }), { formula: null, bdd: null });
  assert.deepStrictEqual(coverageScope({ isManager: false, agentCode: '53' }), { formula: null, bdd: null });
  assert.deepStrictEqual(coverageScope(null), { formula: null, bdd: null });
});
```

- [ ] **Step 2: Запустить — должно упасть**

Run: `cd server && node --test coverage.test.js`
Expected: FAIL — `Cannot find module './coverage'`

- [ ] **Step 3: Реализация**

```js
// server/coverage.js
// Line-coverage history (PRD/coverage-history-design.md): pure helpers shared by the
// manager tiles (/api/team-order-stats), the nightly snapshot and the one-time backfill.

// Israel route day for a YYYY-MM-DD date: Sun..Thu → 1..5, Fri/Sat → null (no route).
function routeDayOf(dateStr) {
  const wd = new Date(dateStr + 'T12:00:00Z').getUTCDay(); // noon UTC — same calendar day in Israel
  return wd >= 0 && wd <= 4 ? wd + 1 : null;
}

// Screen period: 1st of the month three months before the current one → yesterday.
function coveragePeriod(todayStr) {
  const [y, m] = todayStr.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1 - 3, 1)).toISOString().slice(0, 10);
  const t = new Date(todayStr + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1);
  return { from, to: t.toISOString().slice(0, 10) };
}

// Agent's line for a route day = PBI schedule for that day, minus clients the agent
// moved to another day in the app, plus clients moved INTO this day. Same rule as
// /customers (index.js, bdd-routes.js) — movedInOk says which moved ids belong to
// this channel's pool (FORMULA drops ICE-only clients, like the agent's own ring).
function lineFor({ scheduled, dayMoves, dayNum, movedInOk }) {
  const moves = dayMoves || {};
  const line = new Set();
  for (const c of scheduled) {
    const id = String(c.custId);
    if (c.dayNum === dayNum && !(id in moves)) line.add(id);
  }
  for (const [id, mv] of Object.entries(moves)) {
    if (mv && mv.day === dayNum && movedInOk(String(id))) line.add(String(id));
  }
  return line;
}

function coverageCounts(line, served) {
  let inLine = 0;
  for (const id of served) if (line.has(id)) inLine++;
  return { planned: line.size, inLine, offLine: served.size - inLine };
}

// FORMULA "served" credit: an order counts for the client's roster owner AND for
// whoever entered it (Oleg/Alexey case 2026-08-31, see /api/team-order-stats).
function creditedCustsByAgent(rows, rosterAgentByCust) {
  const custs = new Map(), sums = new Map();
  for (const row of rows) {
    const credited = new Set();
    const roster = rosterAgentByCust.get(row.custId);
    if (roster) credited.add(roster);
    if (row.enteringAgentCode) credited.add(row.enteringAgentCode);
    for (const ag of credited) {
      if (!custs.has(ag)) custs.set(ag, new Set());
      custs.get(ag).add(row.custId);
      sums.set(ag, (sums.get(ag) || 0) + row.dispPrice);
    }
  }
  return { custs, sums };
}

// Who sees which teams on the coverage screen. '*' = all, array = those teams, null = none.
function coverageScope(s) {
  const none = { formula: null, bdd: null };
  if (!s?.isManager) return none;
  if (s.managerRole === 'super') return { formula: '*', bdd: '*' };
  return {
    formula: s.managerRole === 'team' && s.managerTeam ? [s.managerTeam] : null,
    bdd: s.channel === 'ICE_BDD' && s.bddRole === 'team' && s.managerTeams?.length ? [...s.managerTeams] : null,
  };
}

module.exports = { routeDayOf, coveragePeriod, lineFor, coverageCounts, creditedCustsByAgent, coverageScope };
```

- [ ] **Step 4: Тесты проходят**

Run: `cd server && node --test coverage.test.js`
Expected: `# pass 7`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add server/coverage.js server/coverage.test.js
git commit -m "feat(formula-road): coverage.js — линия дня с переносами, подсчёт, доступ, период"
```

---

### Task 2: Хранилище `server/coverage-db.js`

**Files:**
- Create: `server/coverage-db.js`
- Test: `server/coverage-db.test.js`

- [ ] **Step 1: Падающий тест**

```js
// server/coverage-db.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openCoverageDb } = require('./coverage-db');

const row = (o = {}) => ({ date: '2026-09-29', channel: 'bdd', agentCode: '63', agentName: 'סימחה', team: 'SIMHA',
  dayNum: 3, planned: 22, inLine: 0, offLine: 11, source: 'snapshot', ...o });

test('coverage-db: upsert, snapshot beats backfill, range read', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-')), 'c.db');
  const db = openCoverageDb(file);
  assert.strictEqual(db.hasAnyBackfill(), false);
  db.upsert([row({ source: 'backfill', inLine: 5 })]);
  assert.strictEqual(db.hasAnyBackfill(), true);
  assert.strictEqual(db.hasSnapshot('2026-09-29', 'bdd'), false);
  db.upsert([row()]); // snapshot replaces backfill row
  assert.strictEqual(db.hasSnapshot('2026-09-29', 'bdd'), true);
  db.upsert([row({ source: 'backfill', inLine: 9 })]); // backfill never overwrites a snapshot
  const got = db.readRange('bdd', '2026-09-01', '2026-09-30');
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].in_line, 0);
  assert.strictEqual(got[0].source, 'snapshot');
  assert.deepStrictEqual([...db.datesWithRows('bdd')], ['2026-09-29']);
  assert.strictEqual(db.readRange('formula', '2026-09-01', '2026-09-30').length, 0);
  db.close();
});
```

- [ ] **Step 2: Запуск — падает**

Run: `cd server && node --test coverage-db.test.js`
Expected: FAIL — `Cannot find module './coverage-db'`

- [ ] **Step 3: Реализация**

```js
// server/coverage-db.js
// Line-coverage history store (PRD/coverage-history-design.md §3). One row per
// date × channel × agent. A snapshot row replaces a backfill row; a backfill row
// never replaces a snapshot.
const Database = require('better-sqlite3');

function openCoverageDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS coverage_daily (
      date TEXT NOT NULL, channel TEXT NOT NULL, agent_code TEXT NOT NULL,
      agent_name TEXT, team TEXT, day_num INTEGER,
      planned INTEGER NOT NULL, in_line INTEGER NOT NULL, off_line INTEGER NOT NULL,
      source TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (date, channel, agent_code)
    );
    CREATE INDEX IF NOT EXISTS idx_cov_channel_date ON coverage_daily(channel, date);
  `);
  const ins = db.prepare(`
    INSERT INTO coverage_daily (date, channel, agent_code, agent_name, team, day_num, planned, in_line, off_line, source, created_at)
    VALUES (@date, @channel, @agentCode, @agentName, @team, @dayNum, @planned, @inLine, @offLine, @source, @createdAt)
    ON CONFLICT (date, channel, agent_code) DO UPDATE SET
      agent_name = excluded.agent_name, team = excluded.team, day_num = excluded.day_num,
      planned = excluded.planned, in_line = excluded.in_line, off_line = excluded.off_line,
      source = excluded.source, created_at = excluded.created_at
    WHERE coverage_daily.source <> 'snapshot' OR excluded.source = 'snapshot'
  `);
  const upsert = db.transaction(rows => {
    const createdAt = new Date().toISOString();
    for (const r of rows) ins.run({ ...r, createdAt });
  });
  const snapQ = db.prepare(`SELECT 1 FROM coverage_daily WHERE date = ? AND channel = ? AND source = 'snapshot' LIMIT 1`);
  const bfQ = db.prepare(`SELECT 1 FROM coverage_daily WHERE source = 'backfill' LIMIT 1`);
  const datesQ = db.prepare(`SELECT DISTINCT date FROM coverage_daily WHERE channel = ?`);
  const rangeQ = db.prepare(`SELECT date, agent_code, agent_name, team, day_num, planned, in_line, off_line, source
    FROM coverage_daily WHERE channel = ? AND date BETWEEN ? AND ? ORDER BY date`);
  return {
    upsert,
    hasSnapshot: (date, channel) => !!snapQ.get(date, channel),
    hasAnyBackfill: () => !!bfQ.get(),
    datesWithRows: channel => new Set(datesQ.all(channel).map(r => r.date)),
    readRange: (channel, from, to) => rangeQ.all(channel, from, to),
    close: () => db.close(),
  };
}

module.exports = { openCoverageDb };
```

- [ ] **Step 4: Тест проходит**

Run: `cd server && node --test coverage-db.test.js`
Expected: `# pass 1`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add server/coverage-db.js server/coverage-db.test.js
git commit -m "feat(formula-road): coverage-db — SQLite-хранилище истории покрытия"
```

---

### Task 3: Плитки менеджеров — знаменатель с переносами

Формат плиток не меняется (решение 7). Меняется только `denom` (FORMULA и BDD) и `offLine` (BDD).

**Files:**
- Modify: `server/index.js` — `/api/team-order-stats` (~5759–5799), новая `formulaLineFor` рядом
- Modify: `server/bdd-routes.js` — `/api/team-order-stats` (~284–305), новая `bddLineFor`

- [ ] **Step 1: FORMULA — добавить `formulaLineFor` и перевести team-order-stats**

В `server/index.js` рядом с `require('./events-db')` (~строка 697) добавить:

```js
const { routeDayOf, coveragePeriod, lineFor, coverageCounts, creditedCustsByAgent, coverageScope } = require('./coverage');
```

Перед `app.get('/api/team-order-stats'` вставить:

```js
// FORMULA line of an agent for a route day — PBI schedule + the agent's in-app day
// moves, FORMULA clients only (ICE-only clients never count, same as the agent's
// own ring in formula-road.html _renderFormulaBanner). Shared with the coverage
// snapshot/backfill so tiles and history can't drift apart.
function formulaLineFor(agentCode, dayNum, overrides) {
  const scheduled = pbiCache.byAgent.get(agentCode) || [];
  const formulaIds = new Set([...scheduled, ...(pbiCache.noScheduleByAgent?.get(agentCode) || [])].map(c => String(c.custId)));
  const iceIds = new Set((pbiCache.iceByAgent?.get(agentCode) || []).map(c => String(c.custId)));
  const dayMoves = (overrides || readRouteOverrides())[agentCode]?.dayMoves || {};
  return lineFor({ scheduled, dayMoves, dayNum, movedInOk: id => formulaIds.has(id) || !iceIds.has(id) });
}
```

Заменить тело `/api/team-order-stats` (от `const custSetByAgent = new Map();` до конца цикла `byAgent`) на:

```js
  const { custs: custSetByAgent, sums: sumByAgent } = creditedCustsByAgent(ordersCache.rows, rosterAgentByCust);
  const overrides = readRouteOverrides(); // read once per request, not per agent

  const byAgent = {};
  for (const [agentCode] of pbiCache.byAgent) {
    const numer = custSetByAgent.get(agentCode)?.size || 0;
    const sum = Math.round((sumByAgent.get(agentCode) || 0) * 100) / 100;
    byAgent[agentCode] = { denom: formulaLineFor(agentCode, todayDay, overrides).size, numer, sum };
  }
```

Остальное (цикл `byManager`, `res.json`) без изменений.

- [ ] **Step 2: BDD — `bddLineFor` и team-order-stats**

В `server/bdd-routes.js` вверху добавить:

```js
const { lineFor, coverageCounts } = require('./coverage');
```

Внутри `createBdd` после `const validAgent = ...` (~строка 192) вставить:

```js
  // BDD line for a route day — PBI schedule + agent's in-app day moves (same rule as
  // /customers below). Shared by team-order-stats and the coverage snapshot.
  function bddLineFor(agentCode, dayNum, overrides) {
    const all = cache.byAgent.get(String(agentCode)) || [];
    const ids = new Set(all.map(c => String(c.custId)));
    const dayMoves = (overrides || readJson(FILES.overrides, {}))[agentCode]?.dayMoves || {};
    return lineFor({ scheduled: all, dayMoves, dayNum, movedInOk: id => ids.has(id) });
  }
```

В `/api/team-order-stats` заменить внутренний цикл по агентам на:

```js
    const overrides = readJson(FILES.overrides, {});
    for (const [group, agents] of cache.agentsByGroup) {
      const acc = { denom: 0, numer: 0, sum: 0, offLine: 0 };
      for (const a of agents) {
        const line = bddLineFor(a.agentCode, todayDay, overrides);
        const d = s?.byAgent.get(a.agentCode);
        const served = new Set((d?.byClient || []).map(c => String(c.custId)));
        // % stays served/planned (user 2026-09-30); offLine is shown next to it.
        const { planned: denom, offLine } = coverageCounts(line, served);
        byAgent[a.agentCode] = { denom, numer: d?.custCount || 0, sum: d?.sum || 0, offLine };
        acc.denom += denom; acc.numer += byAgent[a.agentCode].numer; acc.sum += byAgent[a.agentCode].sum; acc.offLine += offLine;
      }
```

(закрывающие строки цикла `byManager[group] = acc;` и `res.json` — как были.)

- [ ] **Step 3: Синтаксис и тесты**

Run: `cd server && node --check index.js && node --check bdd-routes.js && node --test coverage.test.js coverage-db.test.js bdd.test.js`
Expected: без ошибок, `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add server/index.js server/bdd-routes.js
git commit -m "fix(formula-road): план дня на плитках менеджеров учитывает переносы агентов"
```

---

### Task 4: Строки снимка + расписание + восстановление

**Files:**
- Modify: `server/bdd-routes.js` — `coverageRows(dateStr)`, `ready()` в `return`
- Modify: `server/index.js` — `formulaCoverageRows`, `coverageDb`, `writeCoverageDay`, расписание, досчёт, восстановление

- [ ] **Step 1: BDD `coverageRows`**

В `server/bdd-routes.js` внутри `createBdd` (перед `return { router, start };`):

```js
  // Coverage snapshot/backfill rows for one date (PRD/coverage-history-design.md).
  // Queries Priority directly for that date — independent of the 75 s docsToday cache.
  async function coverageRows(dateStr, dayNum) {
    if (!cache) throw new Error('bdd cache not loaded');
    const summary = summarizeBddDocs(await bddDocLinesToday(DB(), dateStr), cache.families);
    const overrides = readJson(FILES.overrides, {});
    const rows = [];
    for (const [group, agents] of cache.agentsByGroup) {
      for (const a of agents) {
        const d = summary.byAgent.get(a.agentCode);
        const served = new Set((d?.byClient || []).map(c => String(c.custId)));
        const c = coverageCounts(bddLineFor(a.agentCode, dayNum, overrides), served);
        rows.push({ date: dateStr, channel: 'bdd', agentCode: String(a.agentCode), agentName: a.agentName || '', team: group, dayNum, ...c });
      }
    }
    return rows;
  }
```

И заменить `return { router, start };` на:

```js
  return { router, start, coverageRows, ready: () => !!cache };
```

- [ ] **Step 2: FORMULA `formulaCoverageRows` + хранилище**

В `server/index.js` после `formulaLineFor` (Task 3):

```js
const { openCoverageDb } = require('./coverage-db');
const coverageDb = openCoverageDb(path.join(__dirname, 'data', 'coverage.db'));

async function formulaCoverageRows(dateStr, dayNum) {
  if (!pbiCache) throw new Error('pbi cache not loaded');
  const orders = await dayClosingOrdersToday(process.env.DB_NAME || 'form', dateStr);
  if (!orders) throw new Error('priority orders query failed'); // dayClosingOrdersToday returns null on error
  const { custs } = creditedCustsByAgent(orders, custIdToRosterAgent());
  const overrides = readRouteOverrides();
  const rows = [];
  for (const [manager, agents] of pbiCache.agentsByManager) {
    for (const a of agents) {
      const c = coverageCounts(formulaLineFor(a.agentCode, dayNum, overrides), custs.get(a.agentCode) || new Set());
      rows.push({ date: dateStr, channel: 'formula', agentCode: String(a.agentCode), agentName: a.agentName || '', team: manager, dayNum, ...c });
    }
  }
  return rows;
}
```

Примечание: `custIdToRosterAgent` и `formulaLineFor` объявлены через `function` — поднимаются, порядок в файле не важен. `coverageDb` открывается при загрузке модуля (как events.db).

- [ ] **Step 3: Запись дня, расписание 20:07 / 20:47, досчёт**

Там же, после `formulaCoverageRows`:

```js
// One write per channel per day (user 2026-09-30): skipped if today's snapshot already exists.
async function writeCoverageDay(dateStr, source) {
  const dayNum = routeDayOf(dateStr);
  if (!dayNum) return;
  const builders = { formula: formulaCoverageRows, bdd: (d, n) => bdd.coverageRows(d, n) };
  for (const [channel, build] of Object.entries(builders)) {
    if (source === 'snapshot' && coverageDb.hasSnapshot(dateStr, channel)) continue;
    try {
      const rows = await build(dateStr, dayNum);
      coverageDb.upsert(rows.map(r => ({ ...r, source })));
      console.log(`[coverage-${source}] ${channel} ${dateStr}: ${rows.length} agents`);
    } catch (e) {
      console.error(`[coverage-${source}] ${channel} ${dateStr} failed:`, e.message);
    }
  }
}
function scheduleCoverageSnapshot(hour, minute) {
  setTimeout(() => {
    writeCoverageDay(todayIsraelDate(), 'snapshot');
    scheduleCoverageSnapshot(hour, minute);
  }, msUntilNextIsraelTime(hour, minute));
}
function israelHHMM() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
```

- [ ] **Step 4: Восстановление периода (один раз)**

Там же:

```js
// First start with an empty backfill: fill the screen period (3 months + current, up to
// yesterday) from Priority, one date at a time, skipping dates that already have rows.
async function backfillCoverageOnce() {
  if (coverageDb.hasAnyBackfill()) return;
  const { from, to } = coveragePeriod(todayIsraelDate());
  const done = { formula: coverageDb.datesWithRows('formula'), bdd: coverageDb.datesWithRows('bdd') };
  const t0 = Date.now();
  for (let d = new Date(from + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const dayNum = routeDayOf(dateStr);
    if (!dayNum) continue;
    for (const channel of ['formula', 'bdd']) {
      if (done[channel].has(dateStr)) continue;
      try {
        const rows = channel === 'formula' ? await formulaCoverageRows(dateStr, dayNum) : await bdd.coverageRows(dateStr, dayNum);
        coverageDb.upsert(rows.map(r => ({ ...r, source: 'backfill' })));
      } catch (e) { console.error(`[coverage-backfill] ${channel} ${dateStr} failed:`, e.message); }
    }
  }
  console.log(`[coverage-backfill] ${from}..${to} done in ${Math.round((Date.now() - t0) / 1000)}s`);
}
```

- [ ] **Step 5: Запуск при старте**

В `server/index.js` сразу **после** строки `app.use('/api/bdd', bdd.router);` (~6212) добавить. Выше ставить нельзя: `const bdd` объявлен на ~6199, обращение раньше — ReferenceError (TDZ) при старте сервера:

```js
scheduleCoverageSnapshot(20, 7);
scheduleCoverageSnapshot(20, 47); // retry — no-op when 20:07 already wrote the day
// Caches ready (FORMULA PBI + BDD) → catch up tonight's missed snapshot, then backfill once.
(function coverageStartup(tries = 0) {
  if (!pbiCache || !bdd.ready()) {
    if (tries < 30) setTimeout(() => coverageStartup(tries + 1), 60 * 1000);
    return;
  }
  const hhmm = israelHHMM();
  const late = hhmm >= '20:07' && hhmm <= '23:59';
  (late ? writeCoverageDay(todayIsraelDate(), 'snapshot') : Promise.resolve())
    .then(() => backfillCoverageOnce())
    .catch(e => console.error('[coverage-startup] failed:', e.message));
})();
```

- [ ] **Step 6: Проверка синтаксиса и тесты**

Run: `cd server && node --check index.js && node --check bdd-routes.js && node --test coverage.test.js coverage-db.test.js bdd.test.js`
Expected: без ошибок, `# fail 0`

- [ ] **Step 7: Commit**

```bash
git add server/index.js server/bdd-routes.js
git commit -m "feat(formula-road): снимок покрытия 20:07 (повтор 20:47) и разовое восстановление периода"
```

---

### Task 5: API `/api/coverage-history` и отдача страницы

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Эндпоинт**

После `backfillCoverageOnce` вставить:

```js
// GET /api/coverage-history?channel=formula|bdd — read-only (coverage.db), never Priority/PBI.
// ?probe=1 → which channels this session may open (manager-grid tile uses it).
app.get('/api/coverage-history', requireAuth, dataRateLimit, (req, res) => {
  const scope = coverageScope(req.session);
  const channels = ['formula', 'bdd'].filter(ch => scope[ch]);
  if (!channels.length) return res.status(403).json({ ok: false, error: 'forbidden' });
  if (req.query.probe) return res.json({ ok: true, channels });
  const channel = String(req.query.channel || channels[0]);
  if (!channels.includes(channel)) return res.status(403).json({ ok: false, error: 'forbidden' });
  const { from, to } = coveragePeriod(todayIsraelDate());
  const teams = scope[channel];
  const rows = coverageDb.readRange(channel, from, to).filter(r => teams === '*' || teams.includes(r.team));
  res.json({ ok: true, channel, channels, from, to, rows });
});
```

Проверить, что `req.session` выставляется в `requireAuth` (mekarerAdminAccess уже читает `req.session`) — да, используется так же.

- [ ] **Step 2: Отдача страницы**

Рядом с `app.get('/mekarer-admin.html', ...)` (~строка 4732):

```js
app.get('/coverage-history.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'coverage-history.html'));
});
```

- [ ] **Step 3: Security-проверка нового маршрута**

- auth: `requireAuth` ✔
- rate-limit: `dataRateLimit` ✔
- SQL: только prepared statements в coverage-db, `channel` проверен по белому списку ✔
- XSS: сервер отдаёт JSON; страница экранирует имена (Task 6 `esc`) ✔

- [ ] **Step 4: Синтаксис**

Run: `cd server && node --check index.js`
Expected: без вывода

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(formula-road): /api/coverage-history — чтение истории покрытия по доступу менеджера"
```

---

### Task 6: Страница `docs/coverage-history.html`

**Files:**
- Create: `docs/coverage-history.html`

- [ ] **Step 1: Страница**

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>כיסוי לפי ימים — FORMULA</title>
<style>
:root{--blue:#1565C0;--blue-dark:#0D47A1;--green:#2E7D32;--green-bg:#E8F5E9;--yellow-bg:#FFF4D6;--yellow:#8A6100;
  --red:#C62828;--red-bg:#FFEBEE;--grey-bg:#F0F2F5;--text:#1A1A2E;--light:#78909C;--bg:#F5F7FA;--card:#fff;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);font-family:'Segoe UI',system-ui,sans-serif;color:var(--text);min-height:100vh;}
.top-bar{background:linear-gradient(135deg,var(--blue-dark),var(--blue));color:#fff;padding:10px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,.2);}
.back-btn{background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:8px;width:34px;height:34px;font-size:18px;cursor:pointer;}
.top-title{font-size:17px;font-weight:800;}
.wrap{max-width:760px;margin:0 auto;padding:14px 16px 40px;}
.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;}
.seg{display:flex;background:#fff;border:1px solid #CFD8DC;border-radius:10px;overflow:hidden;}
.seg button{border:none;background:none;padding:7px 14px;font-weight:700;font-size:13px;color:var(--blue);cursor:pointer;}
.seg button.on{background:var(--blue);color:#fff;}
.period{font-size:12px;color:var(--light);margin-inline-start:auto;}
h2{font-size:14px;font-weight:800;margin:14px 0 8px;}
.top3{display:flex;flex-direction:column;gap:6px;}
.worst{background:var(--card);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);border-inline-start:4px solid var(--red);}
.worst .n{font-weight:900;color:var(--red);font-size:15px;min-width:44px;text-align:center;}
.worst .t{font-size:14px;font-weight:700;}
.worst .s{font-size:12px;color:var(--light);}
.tbl-wrap{overflow-x:auto;background:var(--card);border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);}
table{border-collapse:collapse;width:100%;min-width:340px;}
th,td{padding:6px 4px;text-align:center;font-size:12px;border-bottom:1px solid #ECEFF1;}
th{background:#FAFBFC;font-weight:800;color:var(--light);}
td.ag{text-align:right;font-weight:700;white-space:nowrap;padding-inline-start:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;}
td.c{cursor:pointer;}
td.c .p{font-size:14px;font-weight:900;}
td.c .o{font-size:10px;color:var(--light);}
.r{background:var(--red-bg);} .r .p{color:var(--red);}
.y{background:var(--yellow-bg);} .y .p{color:var(--yellow);}
.g{background:var(--green-bg);} .g .p{color:var(--green);}
.x{background:var(--grey-bg);color:var(--light);}
tr.team td{font-weight:800;border-top:2px solid #CFD8DC;}
td.c.sel{outline:2px solid var(--blue);outline-offset:-2px;}
.detail{margin-top:10px;background:var(--card);border-radius:10px;padding:10px 12px;box-shadow:0 1px 3px rgba(0,0,0,.08);font-size:13px;}
.detail .row{display:flex;gap:8px;padding:3px 0;border-bottom:1px dashed #ECEFF1;}
.detail .row:last-child{border:none;}
.msg{padding:40px 10px;text-align:center;color:var(--light);}
</style>
</head>
<body>
<div class="top-bar">
  <button class="back-btn" onclick="history.length>1?history.back():location.href='/formula-road'" title="חזרה">→</button>
  <div class="top-title">📉 כיסוי לפי ימים</div>
</div>
<div class="wrap" id="wrap"><div class="msg">טוען...</div></div>
<script>
const API = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '' : 'https://api.sverdlik-apps.site';
const TOKEN = localStorage.getItem('frToken') || '';
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה'];
let DATA = null, SEL = null;

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (i, p) => p ? Math.round(i / p * 100) : null;
const cls = v => v === null ? 'x' : v < 50 ? 'r' : v < 75 ? 'y' : 'g';
const fmtD = ymd => ymd.slice(8, 10) + '.' + ymd.slice(5, 7);

async function load(channel) {
  document.getElementById('wrap').innerHTML = '<div class="msg">טוען...</div>';
  try {
    const r = await fetch(API + '/api/coverage-history' + (channel ? '?channel=' + channel : ''), { headers: { 'X-Session': TOKEN } });
    if (r.status === 403 || r.status === 401) { document.getElementById('wrap').innerHTML = '<div class="msg">אין הרשאה לדף זה</div>'; return; }
    DATA = await r.json(); SEL = null; render();
  } catch (e) { document.getElementById('wrap').innerHTML = '<div class="msg">שגיאת טעינה — נסה שוב</div>'; }
}

// agent → day(1..5) → {p, i, o, dates:[row]}; plus team totals per day. Σ-based %, not mean of %.
function aggregate(rows) {
  const agents = new Map(), team = {};
  for (const r of rows) {
    if (!agents.has(r.agent_code)) agents.set(r.agent_code, { code: r.agent_code, name: r.agent_name, days: {}, p: 0, i: 0 });
    const a = agents.get(r.agent_code);
    const d = a.days[r.day_num] ||= { p: 0, i: 0, o: 0, dates: [] };
    d.p += r.planned; d.i += r.in_line; d.o += r.off_line; d.dates.push(r);
    a.p += r.planned; a.i += r.in_line;
    const t = team[r.day_num] ||= { p: 0, i: 0, o: 0 };
    t.p += r.planned; t.i += r.in_line; t.o += r.off_line;
  }
  const list = [...agents.values()].sort((x, y) => (pct(x.i, x.p) ?? 101) - (pct(y.i, y.p) ?? 101));
  return { list, team };
}

function cell(d, key) {
  if (!d || !d.p) return `<td class="x">—</td>`;
  const v = pct(d.i, d.p);
  const sel = SEL === key ? ' sel' : '';
  return `<td class="c ${cls(v)}${sel}" onclick="pick('${key}')"><div class="p">${v}%</div>${d.o ? `<div class="o">+${d.o} מחוץ לקו</div>` : ''}</td>`;
}

function render() {
  const { list, team } = aggregate(DATA.rows);
  const chBtns = DATA.channels.length > 1 ? `<div class="seg">${DATA.channels.map(ch =>
    `<button class="${ch === DATA.channel ? 'on' : ''}" onclick="load('${ch}')">${ch === 'bdd' ? 'ICE BDD' : 'FORMULA'}</button>`).join('')}</div>` : '';
  const worst = [];
  for (const a of list) for (const dn of [1, 2, 3, 4, 5]) { const d = a.days[dn]; if (d?.p) worst.push({ a, dn, d, v: pct(d.i, d.p) }); }
  worst.sort((x, y) => x.v - y.v);
  const top3 = worst.slice(0, 3).map(w => `<div class="worst"><div class="n">${w.v}%</div><div>
      <div class="t">${esc(w.a.name)} — יום ${DAYS[w.dn - 1]}׳</div>
      <div class="s">${w.d.i} מתוך ${w.d.p} בקו · ${w.d.dates.length} ימים${w.d.o ? ` · +${w.d.o} מחוץ לקו` : ''}</div></div></div>`).join('');
  const rowsHtml = list.map(a => `<tr><td class="ag" title="${esc(a.name)}">${esc(a.name)}</td>${[1, 2, 3, 4, 5].map(dn => cell(a.days[dn], a.code + ':' + dn)).join('')}</tr>`).join('');
  const teamRow = `<tr class="team"><td class="ag">צוות</td>${[1, 2, 3, 4, 5].map(dn => {
    const t = team[dn]; if (!t || !t.p) return '<td class="x">—</td>';
    const v = pct(t.i, t.p); return `<td class="${cls(v)}"><div class="p">${v}%</div>${t.o ? `<div class="o">+${t.o}</div>` : ''}</td>`; }).join('')}</tr>`;
  document.getElementById('wrap').innerHTML = `
    <div class="bar">${chBtns}<div class="period">${fmtD(DATA.from)}.${DATA.from.slice(0, 4)} – ${fmtD(DATA.to)}.${DATA.to.slice(0, 4)}</div></div>
    ${list.length ? `<h2>הכי חלשים</h2><div class="top3">${top3 || '<div class="msg">אין נתונים</div>'}</div>
    <h2>כיסוי קו לפי יום בשבוע</h2>
    <div class="tbl-wrap"><table><thead><tr><th></th>${DAYS.map(d => `<th>${d}׳</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}${teamRow}</tbody></table></div>
    <div id="detail"></div>` : '<div class="msg">אין עדיין נתונים לתקופה</div>'}`;
  if (SEL) showDetail(list);
}

function pick(key) { SEL = SEL === key ? null : key; render(); }

function showDetail(list) {
  const [code, dn] = SEL.split(':');
  const a = list.find(x => x.code === code); const d = a?.days[dn];
  if (!d) return;
  const lines = d.dates.slice().sort((x, y) => y.date.localeCompare(x.date)).map(r =>
    `<div class="row"><b>${fmtD(r.date)}</b><span>${r.in_line}/${r.planned}${r.off_line ? ` · +${r.off_line}` : ''}</span>${r.source === 'backfill' ? '<span title="משוחזר לפי הקווים של היום">↺</span>' : ''}</div>`).join('');
  document.getElementById('detail').innerHTML = `<div class="detail"><b>${esc(a.name)} — יום ${DAYS[dn - 1]}׳</b>${lines}</div>`;
}

const qCh = new URLSearchParams(location.search).get('ch');
load(qCh === 'bdd' || qCh === 'formula' ? qCh : '');
</script>
</body>
</html>
```

- [ ] **Step 2: Синтаксис JS и кавычки**

Run:
```bash
node -e "const h=require('fs').readFileSync('docs/coverage-history.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);new Function(m[1]);console.log('ok',(h.match(/[“”‘’]/g)||[]).length,'smart quotes')"
```
Expected: `ok 0 smart quotes`

- [ ] **Step 3: Commit**

```bash
git add docs/coverage-history.html
git commit -m "feat(formula-road): страница истории покрытия — топ-3 провалов и тепловая карта"
```

---

### Task 7: Плитка 📉 и симметрия сетки менеджера

**Files:**
- Modify: `docs/formula-road.html` (~2185–2211 `_maybeRenderMekarerAdminBtn`, ~2384 вызов)

- [ ] **Step 1: Общая функция симметрии + убрать span из плитки 🧊**

В `_maybeRenderMekarerAdminBtn` удалить строки:

```js
  const n=grid.children.length;
```
и
```js
  if(n%2===0) t.style.gridColumn='1/-1';
```

и после `grid.appendChild(t);` добавить `_fixMgrGridSpan(grid);`. Обновить комментарий над функцией: «spans handled by _fixMgrGridSpan».

Перед `_maybeRenderMekarerAdminBtn` вставить:

```js
// Extra tiles (🧊, 📉) after the manager tiles: fixed order 🧊 then 📉; only the last
// tile left without a pair spans the full row — symmetric for any team count/role.
function _fixMgrGridSpan(grid){
  const cov=grid.querySelector('.coverage-tile'), mek=grid.querySelector('.mekarer-admin-tile');
  if(cov&&mek&&mek.compareDocumentPosition(cov)&Node.DOCUMENT_POSITION_PRECEDING) grid.appendChild(cov);
  [...grid.children].forEach(el=>{ if(el.classList.contains('mekarer-admin-tile')||el.classList.contains('coverage-tile')) el.style.gridColumn=''; });
  const last=grid.lastElementChild;
  if(grid.children.length%2===1&&last&&(last.classList.contains('mekarer-admin-tile')||last.classList.contains('coverage-tile'))) last.style.gridColumn='1/-1';
}
// "📉 כיסוי לפי ימים" — server decides who sees it (/api/coverage-history?probe=1):
// team managers (own team, own channel), BDD team managers, super. Readonly: no tile.
let _coverageProbe=null;
async function _maybeRenderCoverageBtn(){
  const token=_getToken();
  if(!token) return;
  if(!_coverageProbe) _coverageProbe=fetch(API+'/api/coverage-history?probe=1',{headers:{'X-Session':token}}).then(r=>r.ok?r.json():null).catch(()=>null);
  const p=await _coverageProbe;
  const ch=_isBdd()?'bdd':'formula';
  if(!p?.channels?.includes(ch) || st.step!=='manager') return;
  const grid=document.querySelector('#login-body .mgr-grid');
  if(!grid || grid.querySelector('.coverage-tile')) return;
  const t=document.createElement('div');
  t.className='mgr-tile coverage-tile';
  t.setAttribute('role','button');
  t.setAttribute('aria-label','כיסוי לפי ימים');
  t.innerHTML=`<div class="mgr-tile-ring-wrap">
      <svg class="mgr-tile-ring" viewBox="0 0 64 64"><circle class="mgr-tile-ring-track" cx="32" cy="32" r="28"/></svg>
      <div class="mgr-tile-av" style="font-size:22px">📉</div>
    </div>
    <div class="mgr-tile-name">כיסוי לפי ימים</div>
    <div class="mgr-tile-stats"></div>`;
  t.onclick=()=>window.open('coverage-history.html?ch='+ch,'_blank');
  grid.appendChild(t);
  _fixMgrGridSpan(grid);
}
```

- [ ] **Step 2: Вызов**

После `_maybeRenderMekarerAdminBtn();` (~строка 2384) добавить:

```js
    _maybeRenderCoverageBtn();
```

- [ ] **Step 3: Синтаксис**

Run:
```bash
node -e "const h=require('fs').readFileSync('docs/formula-road.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,b=0;while((m=re.exec(h))){try{new Function(m[1])}catch(e){b++;console.log(e.message)}}console.log('bad',b,'smart',(h.match(/[“”‘’]/g)||[]).length)"
```
Expected: `bad 0 smart 0`

- [ ] **Step 4: Commit**

```bash
git add docs/formula-road.html
git commit -m "feat(formula-road): плитка 📉 כיסוי לפי ימים, 🧊 и 📉 делят ряд симметрично"
```

---

### Task 8: UI-проверка puppeteer (до деплоя)

**Files:**
- Create (временно): `.scratch/cov/shot.js` — удалить после проверки

- [ ] **Step 1: Скрипт**

Страница открывается с localhost (`python -m http.server 8767 --bind 127.0.0.1` из `docs/`), `fetch` подменяется через `page.setRequestInterception` на мок-ответ `/api/coverage-history`.

```js
// .scratch/cov/shot.js
const puppeteer = require('puppeteer');
const days = [];
for (let d = new Date('2026-06-01T12:00:00Z'); d <= new Date('2026-09-29T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  const wd = d.getUTCDay(); if (wd > 4) continue; days.push([d.toISOString().slice(0, 10), wd + 1]);
}
const agents = [['63', 'סימחה ארבל'], ['98', 'אולג ליפייקו'], ['243', 'ולרי קושניר'], ['41', 'מקסים קרילוב'], ['21', 'אנה לוי']];
const rows = [];
for (const [date, dn] of days) for (const [code, name] of agents) {
  const planned = 18 + (Number(code) % 7);
  const weak = (code === '63' && dn === 1) || (code === '98' && dn === 3);
  const inLine = weak ? Math.round(planned * 0.2) : Math.round(planned * (0.55 + (Number(code) % 4) * 0.1));
  rows.push({ date, agent_code: code, agent_name: name, team: 'SIMHA', day_num: dn, planned, in_line: inLine, off_line: code === '63' ? 4 : 1, source: date < '2026-09-30' ? 'backfill' : 'snapshot' });
}
const body = JSON.stringify({ ok: true, channel: 'formula', channels: ['formula', 'bdd'], from: '2026-06-01', to: '2026-09-29', rows });
(async () => {
  const b = await puppeteer.launch();
  for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 1024, height: 768 }]]) {
    const p = await b.newPage(); await p.setViewport({ ...vp, deviceScaleFactor: 2 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.setRequestInterception(true);
    p.on('request', r => r.url().includes('/api/coverage-history') ? r.respond({ status: 200, contentType: 'application/json', body }) : r.continue());
    await p.goto('http://127.0.0.1:8767/coverage-history.html', { waitUntil: 'networkidle0' });
    await p.screenshot({ path: `.scratch/cov/${name}.png`, fullPage: true });
    await p.evaluate(() => document.querySelector('td.c').click());
    await p.screenshot({ path: `.scratch/cov/${name}-detail.png`, fullPage: true });
    console.log(name, 'errors:', errs);
    await p.close();
  }
  await b.close();
})();
```

- [ ] **Step 2: Прогон и просмотр**

Run: `node .scratch/cov/shot.js`
Expected: `phone errors: []`, `tablet errors: []`. Просмотреть PNG: топ-3 = סימחה יום א׳ и אולג יום ג׳ первые; клетки красные/жёлтые/зелёные; строка צוות; раскрытие дат с ↺; на 390 px нет горизонтального скролла страницы (таблица скроллится внутри `.tbl-wrap`).

- [ ] **Step 3: Сетка менеджера**

Отдельным скриптом по образцу из сессии 30.09 (карта): открыть `formula-road.html` с localhost, выставить `st.step='manager'`, отрисовать экран менеджера с 6 командами (FORMULA) и с 5 (BDD, `_isBdd` → true через `frAgent.channel='ICE_BDD'` в localStorage), замокать ответы `/api/mekarer-admin?probe=1` (200) и `/api/coverage-history?probe=1` (`{channels:['formula','bdd']}`), затем readonly-вариант (coverage 403). Скриншоты: 6 команд → 🧊|📉 в одном ряду; 5 команд → 🧊 рядом с 5-й, 📉 во всю ширину; readonly → как сейчас. Для `clip`-скриншотов — `captureBeyondViewport:false`.

- [ ] **Step 4: Удалить `.scratch/cov/`, остановить http.server**

---

### Task 9: Деплой и проверка на проде

- [ ] **Step 1: Push одним разом** (все коммиты Task 1–7; `git pull --rebase --autostash` при отказе)

```bash
git push origin master
```

- [ ] **Step 2: CI и health**

```bash
gh run list --limit 3
curl -s https://api.sverdlik-apps.site/health
```
Expected: Server Deploy — success; health `{"ok":true,...}`.

- [ ] **Step 3: Восстановление прошло**

Через ~10 минут после старта (caches → backfill), на VPS (PowerShell, скрипт через base64 как в сессии 30.09):

```js
const D=require('/root/COLUMBUS/server/node_modules/better-sqlite3');const db=new D('/root/COLUMBUS/server/data/coverage.db',{readonly:true});
console.log(db.prepare("SELECT channel, source, COUNT(*) n, MIN(date) a, MAX(date) b FROM coverage_daily GROUP BY channel, source").all());
```
и `pm2 logs columbus-api --lines 200 --nostream | grep coverage`
Expected: `formula backfill` и `bdd backfill` c `a=2026-06-01`, `b=2026-09-29`; строка `[coverage-backfill] ... done`.

- [ ] **Step 4: Вечер дня деплоя — снимок**

После 20:07 IL: в логах `[coverage-snapshot] formula <date>: N agents` и `bdd ...`; `SELECT ... WHERE source='snapshot'` — строки за сегодня. Сверить `planned` 2–3 агентов каждого канала с плитками менеджеров того же вечера (скриншот от Дана).

- [ ] **Step 5: Vault**

Добавить запись сессии в `VAULT/Meeting Notes/formula-road-app.md` со статус-тегом, коммит.
