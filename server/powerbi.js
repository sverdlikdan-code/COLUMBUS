const { ConfidentialClientApplication } = require('@azure/msal-node');
const https = require('https');

const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
  },
};

let msalClient = null;

function getMsalClient() {
  if (!msalClient) msalClient = new ConfidentialClientApplication(msalConfig);
  return msalClient;
}

async function getPowerBIToken() {
  const result = await getMsalClient().acquireTokenByClientCredential({
    scopes: ['https://analysis.windows.net/powerbi/api/.default'],
  });
  return result.accessToken;
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = Buffer.from(body, 'utf8');
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST', timeout: 60000,
      headers: { ...headers, 'Content-Length': payload.length },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON response, text preserved */ }
        if (!json && res.statusCode >= 400) console.error('PBI raw error response:', res.statusCode, text.slice(0, 500));
        resolve({ status: res.statusCode, ok: res.statusCode < 400, text, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('PBI request timeout (60s)')); });
    req.write(payload);
    req.end();
  });
}

// Сетевой сбой до ответа PBI (DNS/обрыв) — повторить; HTTP-ошибки (429!) и 60с-таймаут не повторяем,
// чтобы не жечь DAX-квоту. 19.10 разовый ENOTFOUND api.powerbi.com молча выбросил ICE из алярма תוקף.
const NET_ERR = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|network_error/i;
async function executeDax(daxQuery, datasetId, workspaceIdOverride) {
  for (const wait of [2000, 5000, 15000]) {
    try { return await executeDaxOnce(daxQuery, datasetId, workspaceIdOverride); }
    catch (e) {
      if (!NET_ERR.test(`${e.code || ''} ${e.errorCode || ''} ${e.message}`)) throw e;
      console.error(`PBI network error (${e.code || e.errorCode || e.message}), retry in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  return executeDaxOnce(daxQuery, datasetId, workspaceIdOverride);
}

async function executeDaxOnce(daxQuery, datasetId, workspaceIdOverride) {
  const token = await getPowerBIToken();
  const workspaceId = workspaceIdOverride || process.env.POWERBI_WORKSPACE_ID;
  const dsId = datasetId || process.env.POWERBI_DATASET_ID;

  const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${dsId}/executeQueries`;

  const res = await httpsPost(url, {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }, JSON.stringify({
    queries: [{ query: daxQuery }],
    serializerSettings: { includeNulls: true },
  }));

  if (!res.ok) throw new Error(`Power BI API error ${res.status}: ${res.text}`);
  return res.json.results[0].tables[0].rows;
}

async function getTableNames() {
  // Try to probe known table names from the SQL schema
  const candidates = ['CUSTOMERS', 'AGENTS', 'CUSTCALLFREQUENCY', 'CUSTSTATS', 'CUSTSPEC'];
  const found = [];
  for (const t of candidates) {
    try {
      await executeDax(`EVALUATE TOPN(1, '${t}')`);
      found.push(t);
    } catch {
      found.push(`${t} (not found)`);
    }
  }
  return found;
}

async function getDatasetRefreshTime(datasetId) {
  try {
    const token = await getPowerBIToken();
    const workspaceId = process.env.POWERBI_WORKSPACE_ID;
    const dsId = datasetId || process.env.POWERBI_DATASET_ID;
    const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${dsId}/refreshes?$top=1`;
    return await new Promise((resolve) => {
      const u = new URL(url);
      const req = https.request({
        hostname: u.hostname, path: u.pathname + u.search,
        method: 'GET', timeout: 15000,
        headers: { Authorization: `Bearer ${token}` },
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const last = json.value?.[0];
            resolve(last?.endTime || last?.startTime || null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  } catch { return null; }
}

module.exports = { executeDax, getPowerBIToken, getTableNames, getDatasetRefreshTime };
