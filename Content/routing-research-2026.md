---
source: multiple (see sources per section)
retrieved: 2026-05-26
language: en
original_title: VRP/TSP Routing Optimization Research — Israel Field Sales
---

# VRP/TSP Routing Optimization for Israel Field Sales

> Research conducted 2026-05-26 for COLUMBUS project — geograf agent upgrade

---

## Resume

Modern open-source VRP solvers have matured significantly beyond simple OSRM /trip/ TSP. The strongest open-source stack for a small Israeli field sales tool (20-40 clients/day) is: **VROOM** as the VRP solver layer on top of the existing **OSRM** backend, optionally switching to **Valhalla** for time-aware routing. OR-Tools is the most powerful solver but requires Node.js server-side bindings. OpenRouteService offers a free hosted alternative that includes a built-in /optimization endpoint. Israel's OSM road data is ~73% complete and actively maintained, making all OSM-based engines viable.

---

## Key Quotes

> "VROOM has full integration with OSRM, Openrouteservice and Valhalla. Using OpenStreetMap data to solve real-life problems, VROOM offers an out-of-the-box integration with OSRM." — VROOM GitHub / vroom-project.org

> "Valhalla is recommended for highly dynamic requests/time-aware routing or devices with low specifications." — gis-ops/tutorials routing engine overview

> "OR-Tools provides a framework and solver to implement and solve VRPs, using distance matrices and constraints to optimize routes." — Google Developers / DEV Community

> "OpenRouteService's optimization endpoint solves the Traveling Salesman Problem (TSP) and Vehicle Routing Problem (VRP)." — openrouteservice.org

---

## Key Points

- OSRM /trip/ is a greedy nearest-neighbor heuristic — adequate for very small sets but not cluster-aware
- VROOM solves CVRP, VRPTW, CVRPTW on top of OSRM — drop-in upgrade, same infrastructure
- Valhalla supports dynamic costing (time of day, traffic) — OSRM does not
- OR-Tools is the most powerful VRP solver but has no native browser support; Node.js bindings exist via mapbox/node-or-tools
- OR-Tools WASM compilation is possible but produces huge file sizes — server-side is the practical path
- OpenRouteService (ORS) hosts a free tier with a /optimization endpoint (powered by VROOM internally) — no self-hosting needed
- Israel OSM data: ~73% road coverage, actively maintained, data age ~2 years, 11% of roads updated in last 6 months
- Geofabrik provides israel-and-palestine.osm.pbf for self-hosted engines

---

## Full Content

### Question 1 — Best open-source VRP solvers for Israel

**Top candidates:**

| Solver | Language | Israel-compatible | Constraints supported | Notes |
|--------|----------|-------------------|----------------------|-------|
| VROOM | C++ (REST API) | Yes — uses OSRM/ORS/Valhalla backend | TSP, CVRP, VRPTW, multi-depot | Best drop-in for existing OSRM stack |
| OR-Tools | C++/Python/Java | Yes — uses any distance matrix | Full VRP suite, time windows, priorities | Most powerful; needs server-side Node.js |
| OptaPlanner (Timefold) | Java | Yes | VRPTW, priority-based | More enterprise-focused |
| Open-VRP | Lisp/Clojure | Limited | TSP, VRP variants | Academic, less maintained |

**Recommendation for COLUMBUS:** VROOM — it speaks directly to OSRM, can be spun up as a Docker container alongside the existing OSRM instance, and solves real VRPTW (with time windows and priorities). The pyvroom Python wrapper and the vroom REST API both work without changing the frontend significantly.

---

### Question 2 — Better alternative to OSRM /trip/ for TSP

OSRM /trip/ uses a greedy nearest-neighbor heuristic. It is fast but produces suboptimal routes, especially when clients cluster in multiple geographic zones. The engine itself is not the problem — the optimization layer on top of it is.

**Practical upgrade path (no engine replacement):**
1. Keep OSRM for distance/time matrix generation (it is the fastest for this)
2. Add VROOM on top — VROOM calls OSRM internally to get real road distances between all client pairs, then runs a proper metaheuristic (local search + LAHC) to find optimal visit sequence
3. Result: same OSRM infrastructure, dramatically better route quality

**If switching engines is acceptable:**

| Engine | Key advantage over OSRM | Self-host complexity | Traffic-aware |
|--------|------------------------|---------------------|---------------|
| Valhalla | Dynamic costing, time-of-day routing, lighter tile updates | Medium (Docker image available) | Yes |
| GraphHopper | Lower memory, fast matrix, good Java ecosystem | Low-Medium | With extension |
| OpenRouteService | Hosted free tier, /optimization built-in | None (hosted) | Partially |

**For Israel specifically:** All three engines consume OSM data from Geofabrik. Valhalla's tile-based approach makes it easier to update Israel road tiles incrementally. OSRM requires full preprocessing on data changes.

---

### Question 3 — OR-Tools in browser/Node.js

**Node.js:** The `mapbox/node-or-tools` package provides Node.js bindings for OR-Tools TSP and VRP solvers. It is a native addon (C++ bindings via nan/napi). This is the practical server-side path for Node.js.

**Browser / WebAssembly:** Technically possible (GitHub issue #4443 and community project `kjartanm/wasm-or-tools` confirm this) but:
- OR-Tools WASM binary is very large (tens of MB)
- Build process is complex via Emscripten
- Not production-ready for browser delivery

**Practical verdict for COLUMBUS:** Run OR-Tools (or VROOM) as a microservice in Node.js or Python on the same server as OSRM. The frontend (Leaflet) only receives the optimized ordered waypoints — it does not need to run the solver. A lightweight `/optimize` REST endpoint in Express.js calling node-or-tools or a local VROOM instance is the cleanest architecture.

---

### Question 4 — Valhalla vs OSRM for Israeli roads

| Dimension | OSRM | Valhalla |
|-----------|------|----------|
| Speed (matrix queries) | Fastest (contraction hierarchies) | Slower but acceptable |
| Memory usage | High (full preprocessed graph in RAM) | Low (tile-based, loads on demand) |
| Traffic / time-of-day | No | Yes (dynamic costing) |
| Data update cycle | Full re-preprocessing on any OSM change | Incremental tile updates |
| Israeli road data | OSM (Geofabrik israel-and-palestine.pbf) | Same OSM source |
| Self-hosted Docker | Yes (official image) | Yes (official image) |
| Hosted free option | None official | Stadia Maps (free tier available) |

**Israel data quality:** OSM Israel coverage is ~73% of total road network, actively maintained by local community, public transport aligned with Ministry of Transportation data. Sufficient for routing commercial vehicles between business addresses in urban/suburban Israel (Tel Aviv metro, Haifa, Beer Sheva, Jerusalem corridors).

**Verdict:** For time-of-day awareness (morning rush in Tel Aviv vs afternoon Haifa), Valhalla is the better long-term engine. For the immediate problem of bad /trip/ routes, replacing the optimization layer (adding VROOM) gives bigger gains than switching routing engines.

---

### Question 5 — Hosted free-tier APIs supporting Israel

| Service | Free Tier | VRP/Optimization | Israel coverage | Notes |
|---------|-----------|-----------------|-----------------|-------|
| OpenRouteService (ORS) | Yes — daily limits, matrix up to 3500 locations (50x50), 25 dynamic | Yes — /optimization endpoint (VROOM-powered) | Yes (OSM) | Best free hosted option; HeiGIT/Heidelberg University |
| GraphHopper Cloud | 500 credits/day, 5 locations/request, non-commercial only | Yes — Route Optimization API | Yes (OSM) | Credits too low for 40-client daily runs |
| Stadia Maps | Free tier (Valhalla-based) | Routing only, no VRP | Yes | Good for tile+routing, no optimization |
| Mapbox | Free tier (100k requests/month) | No native VRP | Yes | Too expensive for matrix at scale |
| HERE Routing | Freemium | Yes (advanced) | Yes | Proprietary, not OSM |

**Recommendation:** OpenRouteService hosted free tier is the best zero-infrastructure option for a small internal tool. The `/optimization` endpoint handles up to 40 jobs + 1 vehicle per request, which fits the COLUMBUS use case exactly. No API key cost, no server to maintain.

---

## Architecture Recommendation for COLUMBUS

**Short-term (minimal change):**
```
Frontend (Leaflet) 
  → POST /optimize (Express.js microservice)
    → VROOM REST API (Docker, same server as OSRM)
      → OSRM (existing, for distance matrix)
    ← Ordered waypoints
  ← Render optimized route on Leaflet
```

**Medium-term (add time awareness):**
- Replace OSRM backend in VROOM config with ORS hosted or self-hosted Valhalla
- Enables departure-time-aware routing (avoid Tel Aviv rush hour)

**Free hosted alternative (no self-hosting):**
- Use ORS /optimization endpoint directly from Node.js backend
- ORS handles both matrix and VRP optimization
- Zero infrastructure change needed

---

## Sources

- [VROOM GitHub — VROOM-Project/vroom](https://github.com/VROOM-Project/vroom)
- [VROOM project site — vroom-project.org](http://vroom-project.org/)
- [OR-Tools VRP documentation — Google Developers](https://developers.google.com/optimization/routing/vrp)
- [mapbox/node-or-tools — Node.js OR-Tools bindings](https://github.com/mapbox/node-or-tools)
- [OR-Tools WASM issue #4443 — google/or-tools](https://github.com/google/or-tools/issues/4443)
- [gis-ops routing engines comparison — GitHub](https://github.com/gis-ops/tutorials/blob/master/general/foss_routing_engines_overview.md)
- [Telenav OSRM vs Valhalla comparison](https://github.com/Telenav/open-source-spec/blob/master/osrm/doc/osrm-vs-valhalla.md)
- [Valhalla GitHub](https://github.com/valhalla/valhalla)
- [OpenRouteService GitHub — GIScience/openrouteservice](https://github.com/GIScience/openrouteservice)
- [OpenRouteService API restrictions / free tier](https://openrouteservice.org/restrictions/)
- [HeiGIT account plans — ORS pricing](https://account.heigit.org/info/plans)
- [Israel — OpenStreetMap Wiki](https://wiki.openstreetmap.org/wiki/Israel)
- [Geofabrik — Israel and Palestine OSM extract](https://download.geofabrik.de/asia/israel-and-palestine.html)
- [GraphHopper open source](https://www.graphhopper.com/open-source/)
- [Comparing VRP Solvers: OR-Tools, OptaPlanner, SaaS — singdata.com](https://www.singdata.com/trending/comparing-vrp-solvers-ortools-optaplanner-saas/)
- [Solving VRP with OpenStreetMap and OR-Tools — Medium](https://medium.com/@albertferrevidal/solving-the-vehicle-routing-problem-with-openstreetmap-and-or-tools-9c32a5dbc4f1)
- [OR-Tools vs SCIP for VRP — edana.ch 2026](https://edana.ch/en/2026/02/01/route-optimization-or-tools-vs-scip-which-solver-for-your-complex-vehicle-routing-problems/)
- [Top 10 open-source route optimization tools 2025 — NextBillion.ai](https://nextbillion.ai/blog/top-open-source-tools-for-route-optimization)
