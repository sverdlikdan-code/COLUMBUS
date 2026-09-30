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

module.exports = { routeDayOf, coveragePeriod, lineFor, coverageCounts, creditedCustsByAgent, coverageScope, COVERAGE_EXCLUDED_TEAMS };
