import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client } from './nearestNeighbor';

interface SavedRoute {
  order: string[];
  dayOverrides: Record<string, number>;
  gpsOverrides: Record<string, { lat: number; lng: number; address: string }>;
  savedAt: string;
}

function key(agentCode: string, dayNum: number) {
  return `route_${agentCode}_day${dayNum}`;
}

export async function saveRoute(agentCode: string, dayNum: number, clients: Client[]): Promise<void> {
  const data: SavedRoute = {
    order: clients.map(c => c.custId),
    dayOverrides: {},
    gpsOverrides: {},
    savedAt: new Date().toISOString(),
  };
  clients.forEach(c => {
    if (c.dayNum !== dayNum) data.dayOverrides[c.custId] = c.dayNum;
    if (c.lat && c.lng) data.gpsOverrides[c.custId] = { lat: c.lat, lng: c.lng, address: c.address };
  });
  await AsyncStorage.setItem(key(agentCode, dayNum), JSON.stringify(data));
}

export async function loadRoute(agentCode: string, dayNum: number): Promise<SavedRoute | null> {
  const raw = await AsyncStorage.getItem(key(agentCode, dayNum));
  return raw ? JSON.parse(raw) : null;
}

export function mergeWithSaved(serverClients: Client[], saved: SavedRoute): Client[] {
  const merged = serverClients.map(c => ({
    ...c,
    dayNum: saved.dayOverrides[c.custId] ?? c.dayNum,
    ...(saved.gpsOverrides[c.custId] ?? {}),
  }));

  if (saved.order.length === 0) return merged;

  const orderMap = new Map(saved.order.map((id, i) => [id, i]));
  const inSaved = merged.filter(c => orderMap.has(c.custId))
    .sort((a, b) => (orderMap.get(a.custId) ?? 999) - (orderMap.get(b.custId) ?? 999));
  const notInSaved = merged.filter(c => !orderMap.has(c.custId));

  return [...inSaved, ...notInSaved];
}

export async function clearRoute(agentCode: string, dayNum: number): Promise<void> {
  await AsyncStorage.removeItem(key(agentCode, dayNum));
}
