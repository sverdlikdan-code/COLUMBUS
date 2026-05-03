import { haversineKm } from './haversine';

// Israel bounding box — coordinates outside this are invalid
const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
export function isValidIsraelGps(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (!lat || !lng) return false;
  return lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

export interface Client {
  custId: string;
  custName: string;
  city: string;
  address: string;
  fullAddress: string;
  lat: number;
  lng: number;
  status: string;
  kosher: string;
  agentCode: string;
  agentName: string;
  priorityOrder: number;
  param7: string;
  dayNum: number;
  dayLabel: string;
  lastOrderDate?: string | null;
  monthlySales?: number;
  totalSales?: number;
  lastSaleDate?: string | null;
}

export function nearestNeighborSort(clients: Client[], startCity?: { lat: number; lng: number }): Client[] {
  const withCoords = clients.filter(c => isValidIsraelGps(c.lat, c.lng));
  const noCoords = clients.filter(c => !isValidIsraelGps(c.lat, c.lng));

  if (withCoords.length === 0) return clients;

  const visited = new Set<string>();
  const result: Client[] = [];

  // Start from startCity if given, otherwise first client
  let currentLat = startCity?.lat ?? withCoords[0].lat;
  let currentLng = startCity?.lng ?? withCoords[0].lng;

  while (result.length < withCoords.length) {
    let nearest: Client | null = null;
    let minDist = Infinity;

    for (const c of withCoords) {
      if (visited.has(c.custId)) continue;
      const dist = haversineKm(currentLat, currentLng, c.lat, c.lng);
      if (dist < minDist) {
        minDist = dist;
        nearest = c;
      }
    }

    if (!nearest) break;
    visited.add(nearest.custId);
    result.push(nearest);
    currentLat = nearest.lat;
    currentLng = nearest.lng;
  }

  return [...result, ...noCoords];
}
