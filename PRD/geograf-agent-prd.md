# Geograf Agent — PRD

**Version:** 1.0  
**Date:** 2026-04-29  
**Status:** Draft

---

## Description

`Geograf Agent` is a specialist agent for route planning of client visits in Israel.  
It receives client data from SQL Server, resolves latitude/longitude for each client, asks for the agent's start city, and calculates `סדר ביקור` (visit order) per agent/day.

The agent is designed to handle Hebrew addresses and local geographic constraints in Israel (city naming, regional road structure, and temporary road-closure alerts).

---

## Problem It Solves

Field agents lose time when client visits are not ordered geographically.  
Manual ordering is slow, error-prone, and does not account for start location or current road conditions.

`Geograf Agent` automates this workflow:

1. Pull day-specific client list from SQL Server
2. Normalize/geocode addresses into coordinates
3. Ask start city before route calculation
4. Compute optimized visit sequence
5. Write/return `סדר ביקור` for operational use

---

## Goals

1. **Automatic day routing** — calculate visit order per `agent + date`
2. **Mandatory start city** — do not compute route before start location is provided
3. **Hebrew address support** — robust parsing/geocoding for Israeli addresses
4. **Operational realism** — account for known road closures/constraints where available
5. **SQL Server integration** — seamless read/write with existing client data model

---

## Scope

### In Scope

- SQL Server data fetch for planned visits
- Geocoding for missing coordinates
- Visit-order optimization (`סדר ביקור`)
- Start city prompt (interactive step before optimization)
- Optional persistence of computed order back to SQL

### Out of Scope (v1)

- Real-time full traffic ETA optimization from paid providers
- Multi-agent global dispatch optimization (cross-agent balancing)
- Automatic rescheduling/rebooking logic

---

## Inputs / Outputs

### Inputs

- `agent_id`
- `visit_date`
- `start_city` (mandatory)
- SQL rows with client identifiers + address fields + optional lat/lon
- Optional road-closure feed (e.g., Israel Police traffic notices)

### Outputs

- Ordered client list with:
  - `visit_order` / `סדר ביקור`
  - normalized address
  - latitude/longitude used
- Route metadata (distance estimate, warnings, skipped/problematic records)
- Optional DB update of `visit_order`

---

## Architecture

```text
User / Ops UI
     │
     ▼
Geograf Agent
  ├─ SQL Server Connector
  ├─ Address Normalizer (Hebrew-aware)
  ├─ Geocoder (Israel-focused)
  ├─ Route Optimizer
  └─ Road Alerts Adapter (optional)
     │
     ▼
Result: Ordered visits with סדר ביקור
```

---

## Core Workflow

1. Receive request for `agent_id + date`
2. Fetch relevant clients from SQL Server
3. Validate that `start_city` is provided
   - If missing: ask one clear question and stop optimization
4. Resolve coordinates:
   - Use existing lat/lon when valid
   - Geocode missing coordinates (Hebrew + Israel context)
5. Apply routing strategy:
   - Build route from start city point
   - Compute nearest feasible next stop (with closure penalties if available)
   - Produce deterministic `visit_order`
6. Return and/or write back `visit_order`
7. Emit warnings for incomplete/unresolved rows

---

## Routing Strategy (v1)

- Baseline: nearest-neighbor heuristic from start city
- Tie-breakers:
  1. highest data confidence (exact geocode > partial)
  2. shortest detour from current leg
  3. stable fallback by client id
- Road closures:
  - If closure feed exists: penalize/avoid affected segments
  - If no feed: proceed with baseline and return warning

---

## SQL Server Integration Requirements

- Connection via configured DSN/connection string
- Minimal required columns:
  - `client_id`
  - `agent_id`
  - `visit_date`
  - `address_text` (or split address columns)
  - `latitude` (nullable)
  - `longitude` (nullable)
- Optional write-back target:
  - `visit_order`
  - `routing_run_id`
  - `routing_updated_at`

---

## Error Handling

- Missing `start_city` -> blocking validation error (ask user)
- Ungeocodable address -> mark row as unresolved, exclude or place last (configurable)
- SQL timeout/connection error -> fail with actionable diagnostic
- Zero valid clients for day -> return empty result with reason

---

## Quality / Acceptance Criteria

- [ ] For a given `agent_id + date + start_city`, returns deterministic `סדר ביקור`
- [ ] Works with Hebrew addresses (including mixed Hebrew/English tokens)
- [ ] Handles partial data gracefully (missing lat/lon, malformed address)
- [ ] Does not start optimization until start city is known
- [ ] Supports SQL Server read path and optional write-back path
- [ ] Provides clear warnings for data quality and closure-feed availability

---

## Security / Compliance Notes

- No hardcoded DB credentials in repository
- Connection secrets loaded from environment or secret manager
- Log PII carefully; avoid full-address exposure in debug logs unless explicitly enabled

---

## Future Enhancements (v2+)

1. ETA-based routing with live traffic API
2. Multi-stop optimization (2-opt / VRP improvements)
3. Region-specific heuristics per district
4. Automatic retry queue for unresolved geocoding records
5. Interactive map output for dispatcher review

