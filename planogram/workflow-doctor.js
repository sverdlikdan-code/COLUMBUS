/**
 * COLUMBUS Workflow Doctor — zero-cost log analysis + diagnostics
 * Reads workflow.log → detects patterns → checks GitHub Actions commits → writes docs/health-report.json
 * Run: node planogram/workflow-doctor.js
 */
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

const LOG_FILE    = path.join(__dirname, '..', 'workflow.log');
const REPORT_FILE = path.join(__dirname, '..', 'docs', 'health-report.json');
const TODAY       = new Date().toISOString().slice(0, 10);

// Parse dd/mm/yyyy from bat DATE output
function parseDate(line) {
  const m = line.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function parseSessions(logText) {
  const sessions = [];
  let cur = null;
  for (const line of logText.split('\n')) {
    if (line.includes('===== START =====')) {
      cur = { date: parseDate(line), lines: [line], errors: [], pushed: false, done: false, noChanges: false };
      sessions.push(cur);
    } else if (cur) {
      cur.lines.push(line);
      if (line.includes('===== DONE ====='))   { cur.done = true; }
      if (line.includes('Pushed'))              { cur.pushed = true; }
      if (line.includes('No changes'))         { cur.noChanges = true; }
      if (line.includes('ERROR:'))             { cur.errors.push(line.trim()); }
      if (line.includes('rejected'))           { cur.errors.push('push rejected: remote ahead'); }
      if (line.includes('failed to push'))     { cur.errors.push('failed to push'); }
      if (line.includes('cannot pull with rebase')) { cur.errors.push('pull failed: unstaged changes'); }
      if (line.includes('Authentication failed'))   { cur.errors.push('git auth failed'); }
      if (line.includes('ECONNREFUSED') || line.includes('ENOTFOUND') || line.includes('network')) {
        cur.errors.push('network error');
      }
    }
  }
  return sessions;
}

const KNOWN_PATTERNS = [
  {
    match: s => s.errors.some(e => e.includes('push rejected') || e.includes('failed to push')),
    level: 'warning',
    code: 'PUSH_REJECTED',
    msg: 'Push rejected — remote had newer commits',
    fix: 'run-workflow.bat теперь делает auto-retry. Если повторяется — кто-то пушит вручную пока workflow работает.',
  },
  {
    match: s => s.errors.some(e => e.includes('unstaged changes')),
    level: 'warning',
    code: 'PULL_UNSTAGED',
    msg: 'Pull завалился: были unstaged изменения',
    fix: 'Исправлено в bat — теперь сначала commit, потом pull.',
  },
  {
    match: s => s.errors.some(e => e.includes('csv-to-base failed')),
    level: 'critical',
    code: 'CSV_FAILED',
    msg: 'csv-to-base.js упал',
    fix: 'Проверь CSV файлы в PLANOGRAM MAHSAN FORMULA — возможно один из них повреждён или переименован.',
  },
  {
    match: s => s.errors.some(e => e.includes('build-planogram failed')),
    level: 'critical',
    code: 'BUILD_FAILED',
    msg: 'build-planogram.js упал',
    fix: 'Проверь .env файл — токены PBI/Fabric могли истечь. Запусти node build-planogram.js вручную для деталей.',
  },
  {
    match: s => s.errors.some(e => e.includes('git auth failed')),
    level: 'critical',
    code: 'GIT_AUTH',
    msg: 'Git аутентификация провалилась',
    fix: 'GitHub Personal Access Token истёк. Обнови в git credential manager.',
  },
  {
    match: s => s.errors.some(e => e.includes('network')),
    level: 'warning',
    code: 'NETWORK',
    msg: 'Сетевая ошибка во время workflow',
    fix: 'Проблема с интернетом в момент запуска (06:00). Watchdog в 07:30 должен поймать и поретраить.',
  },
  {
    match: s => s.done && !s.pushed && !s.noChanges && !s.errors.length,
    level: 'info',
    code: 'DONE_NO_PUSH',
    msg: 'Workflow завершился без push и без ошибок',
    fix: 'Нормально — данные в PBI не изменились с прошлого раза.',
  },
];

// ── GitHub Actions health check via git log ───────────────────────────────
function checkGitActionsHealth() {
  const result = { lastActionsCommit: null, lastActionsAuthor: null, hoursSinceLastActions: null, status: 'unknown', warning: null };
  try {
    const ROOT = path.join(__dirname, '..');
    // Try both bot authors
    const authors = ['COLUMBUS Bot', 'Planogram Bot'];
    let latestTs = 0;
    let latestAuthor = null;
    for (const author of authors) {
      try {
        const out = execSync(`git log --author="${author}" -1 --format=%cI`, { cwd: ROOT, timeout: 5000 }).toString().trim();
        if (out) {
          const ts = new Date(out).getTime();
          if (ts > latestTs) { latestTs = ts; latestAuthor = author; }
        }
      } catch(_) {}
    }
    if (latestTs > 0) {
      result.lastActionsCommit = new Date(latestTs).toISOString();
      result.lastActionsAuthor = latestAuthor;
      const hoursAgo = (Date.now() - latestTs) / 3600000;
      result.hoursSinceLastActions = Math.round(hoursAgo * 10) / 10;
      // Active hours: 16:00–23:00 Israel = 13:00–20:00 UTC
      const nowUtcHour = new Date().getUTCHours();
      const inActiveWindow = nowUtcHour >= 13 && nowUtcHour <= 21;
      if (inActiveWindow && hoursAgo > 3) {
        result.status = 'warning';
        result.warning = `GitHub Actions не коммитил ${result.hoursSinceLastActions}ч — последний: ${latestAuthor} в ${result.lastActionsCommit}`;
      } else if (!inActiveWindow && hoursAgo > 14) {
        result.status = 'warning';
        result.warning = `GitHub Actions не коммитил более 14ч (${result.hoursSinceLastActions}ч)`;
      } else {
        result.status = 'ok';
      }
    } else {
      result.status = 'warning';
      result.warning = 'Не найдено ни одного коммита от GitHub Actions ботов';
    }
  } catch(e) {
    result.status = 'unknown';
    result.warning = `git log failed: ${e.message}`;
  }
  return result;
}

if (!fs.existsSync(LOG_FILE)) {
  console.log('workflow.log not found — nothing to analyze');
  process.exit(0);
}

const logText  = fs.readFileSync(LOG_FILE, 'utf8');
const sessions = parseSessions(logText);

const gitActions = checkGitActionsHealth();

const report = {
  generatedAt: new Date().toISOString(),
  date: TODAY,
  totalSessions: sessions.length,
  last7days: [],
  patterns: {},
  recentIssues: [],
  status: 'ok',
  githubActions: gitActions,
};

// Last 7 sessions analysis
const recent = sessions.slice(-14);
for (const s of recent) {
  const matches = KNOWN_PATTERNS.filter(p => p.match(s));
  const entry = {
    date: s.date,
    done: s.done,
    pushed: s.pushed,
    noChanges: s.noChanges,
    errorCount: s.errors.length,
    errors: [...new Set(s.errors)],
    findings: matches.map(p => ({ level: p.level, code: p.code, msg: p.msg, fix: p.fix })),
  };
  report.last7days.push(entry);
  for (const m of matches) {
    report.patterns[m.code] = (report.patterns[m.code] || 0) + 1;
  }
}

// Overall status — merge local log + GitHub Actions health
const criticals = report.last7days.filter(d => d.findings.some(f => f.level === 'critical'));
const warnings  = report.last7days.filter(d => d.findings.some(f => f.level === 'warning'));
if (criticals.length > 0) report.status = 'critical';
else if (warnings.length > 0) report.status = 'warning';

if (gitActions.status === 'warning') {
  report.recentIssues.push({ level: 'warning', msg: gitActions.warning, fix: 'Проверь GitHub Actions: https://github.com/sverdlikdan-code/COLUMBUS/actions — ищи failed runs', code: 'ACTIONS_STALE' });
  if (report.status === 'ok') report.status = 'warning';
}

// Recurring patterns — flag if same error 3+ times in last 14 sessions
for (const [code, count] of Object.entries(report.patterns)) {
  if (count >= 3) {
    const p = KNOWN_PATTERNS.find(x => x.code === code);
    report.recentIssues.push({
      level: 'warning',
      msg: `Повторяется ${count}x за последние 14 запусков: ${p.msg}`,
      fix: p.fix,
      code,
    });
  }
}

// Today's status
const todaySessions = sessions.filter(s => s.date === TODAY);
if (todaySessions.length === 0) {
  report.recentIssues.push({ level: 'warning', msg: 'Сегодня workflow не запускался', fix: 'Проверь scheduled task COLUMBUS-Daily-06 или запусти run-workflow.bat вручную', code: 'NO_RUN_TODAY' });
  report.status = 'warning';
} else {
  const last = todaySessions[todaySessions.length - 1];
  if (!last.done) {
    report.recentIssues.push({ level: 'critical', msg: 'Сегодняшний workflow не завершился (нет DONE)', fix: 'Workflow упал посередине. Запусти вручную.', code: 'INCOMPLETE_TODAY' });
    report.status = 'critical';
  } else if (last.errors.length > 0 && !last.pushed) {
    report.recentIssues.push({ level: 'warning', msg: `Сегодня были ошибки: ${[...new Set(last.errors)].join(', ')}`, fix: 'Watchdog должен был поретраить в 07:30.', code: 'ERRORS_TODAY' });
  }
}

fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');

// Console output
console.log(`\n🩺 Workflow Doctor — ${TODAY}`);
console.log(`   Статус: ${report.status === 'ok' ? '✅ OK' : report.status === 'warning' ? '⚠️  WARNING' : '🔴 CRITICAL'}`);
console.log(`   Всего запусков в логе: ${sessions.length}`);
if (report.recentIssues.length > 0) {
  console.log('   Проблемы:');
  report.recentIssues.forEach(i => console.log(`     ${i.level === 'critical' ? '🔴' : '⚠️ '} ${i.msg}`));
  console.log('   Рекомендации:');
  report.recentIssues.forEach(i => console.log(`     → ${i.fix}`));
}
if (Object.keys(report.patterns).length > 0) {
  console.log('   Паттерны ошибок:', JSON.stringify(report.patterns));
}
// GitHub Actions summary
const ga = report.githubActions;
if (ga.lastActionsCommit) {
  const icon = ga.status === 'ok' ? '✅' : '⚠️ ';
  console.log(`\n🤖 GitHub Actions: ${icon} последний коммит ${ga.hoursSinceLastActions}ч назад (${ga.lastActionsAuthor})`);
} else {
  console.log('\n🤖 GitHub Actions: ❓ нет коммитов от ботов');
}
