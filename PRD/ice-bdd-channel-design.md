# ICE BDD channel in Formula Road — design

**Date:** 2026-09-28 · **Status:** approved by user, not implemented

## Goal

ICE BDD managers (TIMUR, MATVEY, SIMHA) work with their field teams inside the
existing Formula Road app — no second app. ICE BDD is a van-sale channel: the
driver-agent prints a חשבונית / תעודת משלוח on the spot, there is no open-order
stage.

## Approach

A second *channel* inside Formula Road, **in its own files and URL space**. A manager
row in `server/data/managers.json` gets `channel: "ICE_BDD"`; it is copied into the
session. All BDD server routes are a separate Express router at `/api/bdd`
(`server/bdd-routes.js`, logic in `server/bdd.js`, Priority SQL in
`server/bdd-priority.js` on its own pool). FORMULA route handlers are not edited; the
frontend's `apiFetch` sends a fixed list of paths to `/api/bdd/…` for BDD logins only.
UI is shared, BDD-irrelevant actions are hidden. Chosen over a separate app
(2026-09-28): no duplicated auth/invites/map/geocoding/UI to maintain; over branches
inside FORMULA routes: zero diff in FORMULA handlers, rollback = remove one `app.use`.

## Data — PBI, loaded once a day next to the FORMULA cache

| What | Source |
|---|---|
| Clients, agent names | FORMULA dataset → `לקוחות FORM+I+INT`, `HEVRA = "ICE"`, `סטטוס = "פעיל"` |
| Group → agents | ICE dataset → `TEAMS` (`מנהל`, `סוכן`, key `SOHEN NUMBER`) |
| GPS | cascade, first hit wins: ① BDD's own 📍 (`docs/gps-corrections-bdd.json`) → ② what FORMULA / ICE מישפחתי already know for the same custId (FORMULA 📍, tablet GPS, PBI coord, FORMULA resolved cache) — **read-only** → ③ ICE card `משטח_UNICKS[קו רוחב/קו אורך]` → ④ BDD night geocoding (own resolved file, max 200/night, 02:00 Israel). Nothing found → NO GPS |
| Visit day | ICE dataset → `משטח_ICE[יום]` (one row per client-day, א–ה; ש → "לא מוגדר") |
| Month / 6-month sales | FORMULA dataset → `ALL_PARTS`, BDD families only |
| BDD family list | FORMULA dataset → `ADIFUT[מחלקה]` containing `bdd` (same rule as `classifyLastOrderCompany`) |

Verified live 2026-09-28:
- `SOHEN NUMBER` = `משטח_UNICKS[סוכן]` = `משטח_ICE[סוכן]` (243, 21, 17…). `TEAMS[מספר סוכן]` is a warehouse number, not used.
- `משטח_ICE`: 2998 rows / 2851 distinct clients. No `סדר ביקור` column.
- `לקוחות FORM+I+INT[מנהל FORMULA]` is the FORMULA manager, not the BDD one — BDD manager comes from `TEAMS`.
- Agent 932 "כללי - אייס - בודדים" (903 clients, no manager) belongs to no group — excluded.

**Storage:** BDD data is kept in its own maps (`bddByAgent`, `bddAgentsByManager`), never merged
into `pbiCache.byAgent` — BDD and FORMULA agent codes overlap (e.g. 53).

## Live data — Priority `icecrea`, 75 s cache

SQL is taken **as-is** from the FORMULA DASHBORD M code (`ICE INV 23-26`, `ICE DOCS 23-26`
in `FORMULA PBI DOCS/FORMULA DASHBORD.SemanticModel`), narrowed to: date = today,
client in BDD roster, `FAMILY.FAMILYDES` in BDD family list.

- `ICE INV`: `INVOICES.FINAL='Y'`, `TYPE<>'R'`, `IVTYPES.OTYPE='C'`; `DEBIT='C'` → negative
  (זיכוי); `CREDITFLAG='Y'` → 0; amount `IVCOST`; date `COALESCE(NULLIF(DOCUMENTS2.CURDATE,0), IVDATE)`.
- `ICE DOCS`: `TRANSORDER.TYPE` D (תעודת משלוח) / N (החזרה, negative) / X,V; `TRANSORDER.IV = 0`
  (not yet invoiced — no double count with INV); `DOCUMENTS.FINAL='Y'`; date `TRANSORDER.CURDATE`.

One cached query result (75 s) feeds all of these:
- **V badge** — client has any BDD movement today.
- **סגירת יום** — net for today **by the executing agent** (`AGENTS.AGENTCODE` on the
  document line), sales minus החזרות/זיכויים. No roster matching, no "new clients" /
  "belongs to another agent" sections.
- **Line coverage % ("X מתוך Y")** — agent banner and team tiles: denominator = agent's
  clients scheduled today in `משטח_ICE`, numerator = distinct clients that agent executed
  a BDD document for today.
- **🏷️ מבצעים** — existing `SOF_PRICEREC` logic, `icecrea` only, parts in BDD families only.

Priority down → V badges stay off, סגירת יום shows an error; nothing else breaks
(same contract as `custIdsWithOpenOrderToday`).

## Access

| Manager | Sees | Can edit |
|---|---|---|
| Timur | all 5 BDD groups | TIMUR |
| Matvey | all 5 BDD groups | MATVEY, ALMOG |
| Simha | all 5 BDD groups | SIMHA |

- Groups shown: TIMUR, ALMOG, MATVEY, SIMHA, YOSI.
- `role: "team"` with `teams: [...]` (array); `managerCanWrite` checks the BDD roster for BDD sessions.
- Invite link (`/i/:code`) and PBI click-through both open BDD only — these three no longer see FORMULA.
- Almog left the company — no account. His group stays visible, editable by Matvey.

## Screen

- **Shown:** teams → agents → route, map, V, client search, Waze/Google, 📍 GPS edit,
  🧊 fridge order, 🏷️ מבצעים, סגירת יום, 🚫 exclude from route, 📅 change visit day.
- **Sort:** "AI Google" by default, "Priority" button hidden (no visit order in source).
- **Hidden:** זיכוי, ניתוח יום, client AI analysis, יעדים, blank history.
- 🚫 is browser-only state (no server write). 📅 writes BDD's own
  `server/data/route-overrides-bdd.json` — never FORMULA's `route-overrides.json`
  (BDD and FORMULA agent codes overlap).

## Fridge order

Same form, same 6 models, same recipient (`NOTIFY_EMAIL`). Email and Excel carry an
"ICE BDD" label and the BDD manager name.

## Safety / testing

- Isolation rule (user, strict): nothing BDD does may affect FORMULA. All BDD code is in
  new files under `/api/bdd`; `/api/bdd` answers 403 to non-BDD sessions; BDD writes
  only its own files; FORMULA state is read-only for BDD; a BDD failure is caught
  inside the BDD module and leaves FORMULA fully working.
- Existing-code edits are limited to a fixed list (plan: "FORMULA touch points");
  the pre-deploy diff against `checkpoint-before-ice-bdd` must show nothing else.
- Before deploy: puppeteer screenshots of both a FORMULA and a BDD login (phone + tablet).
- Negative check: FORMULA manager session still sees FORMULA groups and FORMULA V.
- סגירת יום sanity: yesterday's BDD net per agent vs `ALL_PARTS` in PBI after refresh.
