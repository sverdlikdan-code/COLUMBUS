# ICE BDD channel in Formula Road — design

**Date:** 2026-09-28 · **Status:** approved by user, not implemented

## Goal

ICE BDD managers (TIMUR, MATVEY, SIMHA) work with their field teams inside the
existing Formula Road app — no second app. ICE BDD is a van-sale channel: the
driver-agent prints a חשבונית / תעודת משלוח on the spot, there is no open-order
stage.

## Approach

A second *channel* inside Formula Road. A manager row in
`server/data/managers.json` gets `channel: "ICE_BDD"`; it is copied into the
session and every data route picks its source by channel. UI is shared,
BDD-irrelevant actions are hidden. FORMULA sessions are untouched.

## Data — PBI, loaded once a day next to the FORMULA cache

| What | Source |
|---|---|
| Clients, agent names | FORMULA dataset → `לקוחות FORM+I+INT`, `HEVRA = "ICE"`, `סטטוס = "פעיל"` |
| Group → agents | ICE dataset → `TEAMS` (`מנהל`, `סוכן`, key `SOHEN NUMBER`) |
| GPS | ICE dataset → `משטח_UNICKS[קו רוחב/קו אורך]` (FORM+I+INT has 0) |
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

Used for:
- **V badge** — client has any BDD movement today.
- **סגירת יום** — net per agent for today: sales minus החזרות/זיכויים.
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
  🧊 fridge order, 🏷️ מבצעים, סגירת יום.
- **Sort:** "AI Google" by default, "Priority" button hidden (no visit order in source).
- **Hidden:** זיכוי, 🚫, 📅, ניתוח יום, client AI analysis, יעדים, blank history.

## Fridge order

Same form, same 6 models, same recipient (`NOTIFY_EMAIL`). Email and Excel carry an
"ICE BDD" label and the BDD manager name.

## Safety / testing

- All new code paths run only for `channel === "ICE_BDD"` sessions; a BDD load failure
  logs and leaves FORMULA fully working.
- Before deploy: puppeteer screenshots of both a FORMULA and a BDD login (phone + tablet).
- Negative check: FORMULA manager session still sees FORMULA groups and FORMULA V.
- סגירת יום sanity: yesterday's BDD net per agent vs `ALL_PARTS` in PBI after refresh.
