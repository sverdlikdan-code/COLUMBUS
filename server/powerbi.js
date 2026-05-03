const { ConfidentialClientApplication } = require('@azure/msal-node');

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

async function executeDax(daxQuery) {
  const token = await getPowerBIToken();
  const workspaceId = process.env.POWERBI_WORKSPACE_ID;
  const datasetId = process.env.POWERBI_DATASET_ID;

  const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      queries: [{ query: daxQuery }],
      serializerSettings: { includeNulls: true },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Power BI API error ${response.status}: ${err}`);
  }

  const json = await response.json();
  return json.results[0].tables[0].rows;
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

module.exports = { executeDax, getPowerBIToken, getTableNames };
