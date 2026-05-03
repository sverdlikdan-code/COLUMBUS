const BASE_URL = 'https://api.sverdlik-apps.site';

async function get(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const fetchManagers = () => get('/managers');
export const fetchManagerAgents = (manager: string) =>
  get(`/manager-agents?manager=${encodeURIComponent(manager)}`);
export const fetchAgents = () => get('/agents');
export const fetchCustomers = (agentCode: string, day?: number) => {
  const params = new URLSearchParams({ agent: agentCode });
  if (day != null) params.set('day', String(day));
  return get(`/customers?${params}`);
};
