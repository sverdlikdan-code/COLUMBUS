// Reads server/data/events.jsonl (pulled from VPS via scp) and reports
// zikuy-form usage stats: fill time, abandonment rate, per-agent activity.
// Run manually: node server/analyze-zikuy-events.js
// Refresh the data first: scp root@31.154.67.58:/root/COLUMBUS/server/data/events.jsonl server/data/events.jsonl
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'events.jsonl');
const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean);
const events = lines.map(l => JSON.parse(l));

// Group by custId, sorted by time — sessions are short (minutes), so
// pairing "started" with the next terminal event for the same custId is
// reliable even when agentCode is missing on some events.
const byCust = new Map();
for (const e of events) {
  if (!byCust.has(e.custId)) byCust.set(e.custId, []);
  byCust.get(e.custId).push(e);
}

const sessions = []; // {custId, agentCode, startTs, endTs, outcome, itemCount, durationSec}
for (const [custId, evs] of byCust) {
  evs.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  let pending = null;
  for (const e of evs) {
    if (e.event === 'zikuy_form_started') {
      if (pending) sessions.push({ ...pending, outcome: 'unmatched' }); // started twice, no terminal in between
      pending = { custId, agentCode: e.agentCode, startTs: e.ts, itemCount: e.itemCount };
    } else if (e.event === 'zikuy_form_submitted' || e.event === 'zikuy_form_abandoned') {
      if (pending) {
        sessions.push({
          ...pending,
          agentCode: pending.agentCode || e.agentCode,
          endTs: e.ts,
          outcome: e.event === 'zikuy_form_submitted' ? 'submitted' : 'abandoned',
          itemCount: e.itemCount,
          durationSec: (new Date(e.ts) - new Date(pending.startTs)) / 1000,
        });
        pending = null;
      }
    }
  }
  if (pending) sessions.push({ ...pending, outcome: 'unmatched' });
}

const submitted = sessions.filter(s => s.outcome === 'submitted');
const abandoned = sessions.filter(s => s.outcome === 'abandoned');
const unmatched = sessions.filter(s => s.outcome === 'unmatched');

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}
function fmtSec(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m > 0 ? `${m}м ${r}с` : `${r}с`;
}

const dates = events.map(e => e.ts.slice(0, 10));
const dayRange = [...new Set(dates)].sort();

console.log('=== ZIKUY — период данных:', dayRange.join(' → '), `(${dayRange.length} дн.) ===\n`);
console.log(`Всего сессий (started): ${sessions.length}`);
console.log(`  Завершено (submitted): ${submitted.length}`);
console.log(`  Брошено (abandoned):   ${abandoned.length}`);
console.log(`  Без терминального события (открыл и не закрыл вкладку явно): ${unmatched.length}`);
const closedTotal = submitted.length + abandoned.length;
console.log(`  Abandonment rate (из завершённых попыток): ${closedTotal ? (100 * abandoned.length / closedTotal).toFixed(0) : 0}%\n`);

if (submitted.length) {
  const durs = submitted.map(s => s.durationSec);
  console.log('--- Время на заполнение бланка (только submitted) ---');
  console.log(`  Медиана: ${fmtSec(percentile(durs, 50))}`);
  console.log(`  p25:     ${fmtSec(percentile(durs, 25))}`);
  console.log(`  p75:     ${fmtSec(durs.length > 1 ? percentile(durs, 75) : durs[0])}`);
  console.log(`  Мин/Макс: ${fmtSec(Math.min(...durs))} / ${fmtSec(Math.max(...durs))}\n`);
}

// Per-agent activity
const byAgent = new Map();
for (const s of sessions) {
  const key = s.agentCode || '—(не определён)';
  if (!byAgent.has(key)) byAgent.set(key, { total: 0, submitted: 0, abandoned: 0, unmatched: 0, durs: [] });
  const a = byAgent.get(key);
  a.total++;
  a[s.outcome === 'unmatched' ? 'unmatched' : s.outcome]++;
  if (s.outcome === 'submitted') a.durs.push(s.durationSec);
}
console.log('--- Активность по агентам (agentCode) ---');
const rows = [...byAgent.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [agent, a] of rows) {
  const medDur = a.durs.length ? fmtSec(percentile(a.durs, 50)) : '—';
  console.log(`  ${agent.padEnd(18)} всего:${a.total}  submitted:${a.submitted}  abandoned:${a.abandoned}  unmatched:${a.unmatched}  медиана-время:${medDur}`);
}

// itemCount vs duration, rough bucket
console.log('\n--- Размер бланка vs время (submitted) ---');
for (const s of submitted) {
  console.log(`  custId:${s.custId}  agent:${s.agentCode || '—'}  товаров:${s.itemCount}  время:${fmtSec(s.durationSec)}`);
}
