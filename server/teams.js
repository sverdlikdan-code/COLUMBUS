const XLSX = require('xlsx');
const path = require('path');

let teamsMap = null; // agentCode → { managerCode, agentName }
let managersMap = null; // managerCode → [{ agentCode, agentName }]

function loadTeams() {
  if (teamsMap) return;

  const wb = XLSX.readFile(path.join(__dirname, 'TEAMS.xlsx'));
  const ws = wb.Sheets['Sheet1'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  teamsMap = {};
  managersMap = {};

  for (const row of rows) {
    const manager = row[1];
    const agentCode = row[2];
    const agentName = row[4]; // שם סוכן (FORM column)

    if (!manager || !agentCode || !agentName) continue;
    if (manager === 'קבוצה' || manager === 'N סוכן') continue;

    const code = String(agentCode).trim();
    const mgr = String(manager).trim();
    const name = String(agentName).trim();

    teamsMap[code] = { managerCode: mgr, agentName: name };

    if (!managersMap[mgr]) managersMap[mgr] = [];
    managersMap[mgr].push({ agentCode: code, agentName: name });
  }
}

function getManagerForAgent(agentCode) {
  loadTeams();
  return teamsMap[String(agentCode)]?.managerCode ?? null;
}

function getAgentsForManager(managerCode) {
  loadTeams();
  return managersMap[String(managerCode)] ?? [];
}

function getAllManagers() {
  loadTeams();
  return Object.keys(managersMap).map(code => ({ managerCode: code }));
}

function getTeamsMap() {
  loadTeams();
  return teamsMap;
}

module.exports = { getManagerForAgent, getAgentsForManager, getAllManagers, getTeamsMap };
