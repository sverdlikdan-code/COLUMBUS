// Пульт алярмов (Dan 2026-10-14) — read-only overview only on Dan's PC (desktop shortcut
// "COLUMBUS Alarms.bat" → ssh → this script prints a ready page; NOT inside Formula Road).
// No second source of truth: addresses are read live from /root/run-alert.sh (case blocks) and .env;
// descriptions without addresses — data/alarms-catalog.json (public repo); status — Healthchecks
// via manage.py (kuma-tools/hc-json.py, no API key). Names: VPS-only /root/alarms-people.json + managers.json.
// CLI: node alarms-dashboard.js <hc.json>  → HTML (docs/alarms.html with the data inlined) on stdout.
const fs = require('fs');
const path = require('path');

const RUN_ALERT = process.env.RUN_ALERT_SH || '/root/run-alert.sh';
const PEOPLE_FILE = process.env.ALARMS_PEOPLE || '/root/alarms-people.json';
const CATALOG_FILE = path.join(__dirname, 'data', 'alarms-catalog.json');
const RANK = { to: 3, team: 2, cc: 1 };

const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };

// case "$NAME" in … esac → { block: { VAR: value } } for `export VAR="…"` lines, plus HOUR.
function parseRunAlert(text) {
  const body = text.split(/^case "\$NAME" in$/m)[1]?.split(/^esac$/m)[0] || '';
  const blocks = {};
  for (const m of body.matchAll(/^ {2}([\w-]+)\)\n([\s\S]*?);;/gm)) {
    const vars = {};
    for (const v of m[2].matchAll(/export (\w+)="([^"]*)"/g)) vars[v[1]] = v[2];
    blocks[m[1]] = { vars, hour: m[2].match(/^\s*HOUR=(\d{2})\b/m)?.[1] || null };
  }
  return blocks;
}

// VAR name → how the script uses it: *_MANAGERS = "TEAM=email;…" (each team its own mail),
// *_CC = copy, anything else with an address = To.
function recipientsFromVars(vars) {
  const out = [];
  for (const [name, val] of Object.entries(vars)) {
    if (!val.includes('@')) continue;
    if (/_MANAGERS$/.test(name)) {
      for (const pair of val.split(';')) {
        const [team, email] = pair.split('=');
        if (email) out.push({ email: email.split('|')[0].trim(), role: 'team', team: team.trim() });
      }
    } else {
      const role = /_CC$/.test(name) ? 'cc' : 'to';
      // MEKARER_ASHDOD_RECIPIENTS = "email|personal login link" — only the address, never the link
      for (const item of val.split(',')) { const email = item.split('|')[0].trim(); if (email) out.push({ email, role }); }
    }
  }
  return out;
}

function recipientsFromEnv(spec) {
  const vars = {}, fallback = {};
  for (const [name, role] of Object.entries(spec)) {
    const val = process.env[name] || '';
    if (role === 'fallback') fallback[name] = val;
    else vars[role === 'cc' ? name + '_CC' : name] = val;   // suffix only steers the role
  }
  const out = recipientsFromVars(vars);
  return out.length ? out : recipientsFromVars(fallback);
}

function build(managerRoster, hc) {
  const catalog = readJson(CATALOG_FILE, { alarms: [] }).alarms;
  let blocks = null;
  try { blocks = parseRunAlert(fs.readFileSync(RUN_ALERT, 'utf8')); } catch { /* not on VPS → blocks null */ }
  const hcByName = new Map((hc || []).map(c => [c.name, c]));

  const names = new Map();
  for (const m of managerRoster || []) if (m.email) names.set(m.email.toLowerCase(), m.nameHe || m.name);
  for (const [e, n] of Object.entries(readJson(PEOPLE_FILE, {}))) names.set(e.toLowerCase(), n);
  const nameOf = e => names.get(e.toLowerCase()) || e.split('@')[0];

  const alarms = catalog.map(a => {
    let recipients = null, hour = null;
    if (a.block) {
      const b = blocks?.[a.block];
      if (b) { recipients = recipientsFromVars(b.vars); hour = b.hour; }
    } else if (a.env) recipients = recipientsFromEnv(a.env);
    // one address once per alarm: To beats team beats CC (client-changes lists Yosi in two groups)
    if (recipients) {
      const best = new Map();
      for (const r of recipients) {
        if (a.teamAsTo && r.role === 'team') r.role = 'to';   // noday: managers in one common mail
        const k = r.email.toLowerCase(), cur = best.get(k);
        if (!cur || RANK[r.role] > RANK[cur.role]) best.set(k, r);
      }
      recipients = [...best.values()];
    }
    const c = a.hc ? hcByName.get(a.hc) : null;
    return {
      key: a.key, title: a.title, icon: a.icon, why: a.why, askedBy: a.askedBy || null,
      when: a.when || null, note: a.note || null,
      schedule: a.schedule || null, hour,
      recipients: recipients && recipients.map(r => ({ ...r, name: nameOf(r.email) })),
      unread: !!(a.block || a.env) && !recipients?.length,   // ⚠️ on the page: source not readable
      hc: c ? { status: c.status, last: c.last, next: c.next } : null,
    };
  });

  const people = new Map();
  for (const a of alarms) for (const r of a.recipients || []) {
    const k = r.email.toLowerCase();
    if (!people.has(k)) people.set(k, { name: r.name, email: r.email, alarms: {} });
    people.get(k).alarms[a.key] = r.role;
  }
  return { alarms, people: [...people.values()].sort((x, y) => Object.keys(y.alarms).length - Object.keys(x.alarms).length), hcAvailable: !!hc };
}

module.exports = { build, parseRunAlert, recipientsFromVars };

if (require.main === module) {
  require('dotenv').config({ path: process.env.ALARMS_ENV || '/root/COLUMBUS/.env' });
  // manage.py shell prints a banner line first — the JSON is the last line
  const hcLines = (process.argv[2] && fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2], 'utf8') : '').trim().split('\n');
  let hc = null;
  try { hc = JSON.parse(hcLines[hcLines.length - 1]); } catch { /* HC down → page shows the banner */ }
  const data = build(readJson(path.join(__dirname, 'data', 'managers.json'), []), hc);
  data.generatedAt = new Date().toISOString();
  const page = fs.readFileSync(path.join(__dirname, '..', 'docs', 'alarms.html'), 'utf8');
  // escaped "<" keeps "</script>" inside a value from closing the tag; replacer fn keeps "$&" in data literal
  const inline = '<script>window.ALARMS_DATA=' + JSON.stringify(data).replace(/</g, '\\u003c') + ';</script>\n<script>';
  process.stdout.write(page.replace('<script>', () => inline));
}
