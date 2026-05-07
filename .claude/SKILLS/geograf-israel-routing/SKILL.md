---
name: geograf-israel-routing
description: Use when building or updating client visit routing for Israel with SQL data, Hebrew addresses, start-city-first flow, and operational road constraints.
---

# Geograf Israel Routing

## Overview

Builds reliable visit order (`סדר ביקור`) for Israeli field operations from SQL data.
Core principle: do not optimize route before asking and validating the agent start city.

## When to Use

Use this skill when:
- Route planning is based on SQL records (`agent + date + clients`)
- Addresses include Hebrew or mixed Hebrew/English tokens
- Dispatch requires deterministic visit order per day
- Business asks for road-closure awareness and operational constraints
- Team needs parity or superiority vs route-planning competitors (e.g. Ascomy)

Do not use this skill for:
- Single-stop routing
- Generic global TSP research without Israel-specific data quality issues

## Required Inputs

- `agent_id`
- `visit_date`
- `start_city` (mandatory)
- Client rows with address and optional `latitude`/`longitude`
- Optional road alerts source (closures, truck restrictions, toll policy)

## Core Workflow

1. **Load and validate SQL data**
   - Pull only target agent/day rows
   - Reject empty dataset early with explicit reason
2. **Ask start city before optimization**
   - If missing: ask one question, stop routing
   - Normalize city naming (Hebrew variants, abbreviations)
3. **Resolve coordinates**
   - Use valid stored coordinates first
   - Geocode unresolved addresses with Hebrew-aware normalization
4. **Score route candidates**
   - Distance baseline + operational penalties
   - Penalties: road closure risk, forbidden vehicle segment, hard time-window violations
5. **Assign deterministic visit order**
   - Produce `visit_order` / `סדר ביקור` with stable tie-breakers
6. **Return and optionally persist**
   - Output ordered list + warnings + confidence
   - Optionally write `visit_order` back to SQL

## Hebrew Address Handling

- Normalize punctuation, extra spaces, and mixed directionality
- Preserve semantic tokens: city, street, house number, industrial zone
- Detect weak addresses and mark for manual review
- Keep original address and normalized address in output for auditability

## Israel Constraints Checklist

- Commercial vehicle restrictions on specific roads
- Toll policy (allow/avoid)
- Turn constraints (U-turn restrictions where relevant)
- Temporary police/municipal closure alerts
- End-of-day destination (depot vs driver home)

## Deterministic Tie-Breakers

When two next stops are equivalent by cost:
1. Higher geocode confidence
2. Lower incremental detour
3. Stable ordering by `client_id`

This prevents unstable daily route ordering.

## SQL Contract (Minimum)

- Read columns:
  - `client_id`
  - `agent_id`
  - `visit_date`
  - `address_text`
  - `latitude` (nullable)
  - `longitude` (nullable)
- Optional write-back:
  - `visit_order`
  - `routing_run_id`
  - `routing_updated_at`

## Error Policy

- Missing `start_city` -> blocking validation error
- Unresolved geocode -> include warning, configurable placement at end
- SQL connectivity failure -> actionable error with retry guidance
- No valid stops -> return empty route with reason, do not crash

## Competitive Parity Targets (Ascomy-Informed)

Match or exceed these capabilities:
- Multi-stop optimization from uploaded or SQL-fed workloads
- Dynamic route changes and manual override support
- Real-time operational visibility hooks
- Vehicle capability constraints per customer
- Static route assignment support
- End location flexibility (not only return-to-depot)

Reference: `ascomy-benchmark.md` in this skill folder.

## On-the-fly Geocoding (клиенты без GPS)

Когда клиент в SQL не имеет координат — Географ геокодирует **на месте** перед построением маршрута.

### Модуль

```js
require('dotenv').config({ path: '../.env' });
const { resolveClient, sleep } = require('./geocoder');
```

### Один клиент

```js
const result = await resolveClient({
  custId:      row.client_id,
  address:     row.address_text,
  city:        row.city,
  existingLat: row.latitude,
  existingLng: row.longitude,
});
// result = { lat, lng, source: 'existing'|'azure', cityMatch: true/false }
// result = null → клиент не геокодирован, ставить в конец маршрута
```

### Пакетная обработка всех клиентов дня

```js
const geocoder = require('./geocoder');

async function resolveAllClients(clients) {
  const resolved = [];
  for (const c of clients) {
    const geo = await geocoder.resolveClient({
      custId:      c.client_id,
      address:     c.address_text,
      city:        c.city,
      existingLat: c.latitude,
      existingLng: c.longitude,
    });
    resolved.push({
      ...c,
      lat:        geo?.lat || null,
      lng:        geo?.lng || null,
      geoSource:  geo?.source || 'failed',
      geoValid:   !!geo,
    });
    if (!c.latitude) await geocoder.sleep(150); // rate limit только для новых
  }
  return resolved;
}
```

### Правила

- Клиенты с `geoValid: false` → включить в маршрут последними + добавить в warnings
- `source: 'existing'` → доверять, не перезаписывать в SQL
- `source: 'azure'` + `cityMatch: true` → можно записать в SQL как кэш (опционально)
- `source: 'azure'` + `cityMatch: false` → использовать для маршрута но НЕ записывать в SQL

### Конфигурация

Переменная в `.env` (уже есть в COLUMBUS):
```
AZURE_MAPS_KEY=...
```

Модуль: `server/geocoder.js` — единый для всей системы COLUMBUS.

## Common Mistakes

- Starting optimization without start city
- Treating all geocodes as equal confidence
- Ignoring Hebrew normalization and storing only one canonical string
- Using non-deterministic sorting, causing unstable `סדר ביקור`
- Failing silently when road-alert feed is unavailable

