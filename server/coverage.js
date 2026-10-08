// Line-coverage history (PRD/coverage-history-design.md): pure helpers shared by the
// manager tiles (/api/team-order-stats) and the nightly snapshot.

// Israel route day for a YYYY-MM-DD date: Sun..Thu → 1..5, Fri/Sat → null (no route).
function routeDayOf(dateStr) {
  const wd = new Date(dateStr + 'T12:00:00Z').getUTCDay(); // noon UTC — same calendar day in Israel
  return wd >= 0 && wd <= 4 ? wd + 1 : null;
}

// Every-other-week visits (♠½ polupoker, 2026-10-08). weekIndex = continuous Sun..Sat week
// counter (from Sun 03.01.1988) — only for counting distinct weeks with an order.
function weekIndex(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(((Date.UTC(y, m - 1, d) - Date.UTC(1988, 0, 1)) / 86400000 - 2) / 7);
}
// Dan 2026-10-08: parity = the Israeli week NUMBER (Sunday-based, week 1 holds 1 Jan — same as
// PBI ALL_PARTS[שבוע] / WEEKNUM type 1). 0 = שבוע זוגי (even number), 1 = אי-זוגי.
// ponytail: at some year ends the number goes 53 → 1 (two odd weeks running, first 2029-01-07)
// — a biweekly client then gets two visits in a row; accepted, same as people read it in PBI.
// Same formula in docs/formula-road.html _weekNumIL — keep both in sync (coverage.test.js).
function weekNumIL(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jan1 = Date.UTC(y, 0, 1);
  return Math.floor(((Date.UTC(y, m - 1, d) - jan1) / 86400000 + new Date(jan1).getUTCDay()) / 7) + 1;
}
function weekParity(dateStr) { return weekNumIL(dateStr) % 2; }

// Dan 2026-10-08: a client the agent put on the other week leaves this week's plan —
// unless he ordered anyway (phone call, Solomon promo), then he counts in the plan too:
// 16 planned + 1 off-week order, 16 served → 16/17, not 16/16.
function biweeklyLine(line, biweekly, parity, served) {
  if (!biweekly || parity == null) return line;
  const out = new Set();
  for (const id of line) {
    const b = biweekly[id];
    if (!b || b.parity === parity || served?.has(id)) out.add(id);
  }
  return out;
}

// Screen period: 1st of the month three months before the current one → today
// (today's row exists only once the 20:07 snapshot has run).
function coveragePeriod(todayStr) {
  const [y, m] = todayStr.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1 - 3, 1)).toISOString().slice(0, 10);
  return { from, to: todayStr };
}

// Agent's line for a route day = PBI schedule for that day, minus clients the agent
// moved to another day in the app, plus clients moved INTO this day. Same rule as
// /customers (index.js, bdd-routes.js) — movedInOk says which moved ids belong to
// this channel's pool (FORMULA drops ICE-only clients, like the agent's own ring).
// Does an in-app day move take the client off its scheduled day `dayNum`? A move with
// `from` (agent chose "keep the other visit day" for a 2+ day client) moves only the visit
// on that day; a move without it (every move before 2026-10-05, and "only one day") takes
// the client off all its days. The one rule for /customers, lineFor and export-all-days.
// ponytail: one moved visit per client (dayMoves is keyed by custId) — moving the second
// visit of the same client replaces the first move; key by custId+from if that ever matters.
function movedAwayFrom(mv, dayNum) {
  return !!mv && (mv.from == null || mv.from === dayNum);
}

function lineFor({ scheduled, dayMoves, dayNum, movedInOk }) {
  const moves = dayMoves || {};
  const line = new Set();
  for (const c of scheduled) {
    const id = String(c.custId);
    if (c.dayNum === dayNum && !movedAwayFrom(moves[id], dayNum)) line.add(id);
  }
  for (const [id, mv] of Object.entries(moves)) {
    if (mv && mv.day === dayNum && movedInOk(String(id))) line.add(String(id));
  }
  return line;
}

// Coverage 100% = the line + everyone who bought off it (Dan 2026-10-08) — % never exceeds 100.
// coverage.db keeps planned = line size; readers add off_line, so old snapshots follow the same rule.

function coverageCounts(line, served) {
  let inLine = 0;
  for (const id of served) if (line.has(id)) inLine++;
  return { planned: line.size, inLine, offLine: served.size - inLine };
}

// Snapshot's per-client breakdown (drill-down on the coverage screen): bought in the
// line / bought off the line / in the line but didn't buy — as [custId, custName] pairs.
function coverageClients(line, served, nameOf) {
  const pair = id => [id, nameOf(id) || ''];
  return JSON.stringify({
    in: [...served].filter(id => line.has(id)).map(pair),
    off: [...served].filter(id => !line.has(id)).map(pair),
    miss: [...line].filter(id => !served.has(id)).map(pair),
  });
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

// Only agents under a team manager are tracked (user 2026-09-30): SADRAN+ (סדרנים,
// shelf-only, near-empty line) and BDD YOSI (managers/office, no team manager) are
// never written and never granted.
const COVERAGE_EXCLUDED_TEAMS = new Set(['SADRAN+', 'YOSI']);

// Who sees which teams on the coverage screen. '*' = all, array = those teams, null = none.
function coverageScope(s) {
  const none = { formula: null, bdd: null };
  if (!s?.isManager) return none;
  if (s.managerRole === 'super') return { formula: '*', bdd: '*' };
  const own = teams => { const t = (teams || []).filter(x => x && !COVERAGE_EXCLUDED_TEAMS.has(x)); return t.length ? t : null; };
  return {
    formula: s.managerRole === 'team' ? own([s.managerTeam]) : null,
    bdd: s.channel === 'ICE_BDD' && s.bddRole === 'team' ? own(s.managerTeams) : null,
  };
}

module.exports = { routeDayOf, weekIndex, weekNumIL, weekParity, biweeklyLine, coveragePeriod, lineFor, movedAwayFrom, coverageCounts, coverageClients, creditedCustsByAgent, coverageScope, COVERAGE_EXCLUDED_TEAMS };
