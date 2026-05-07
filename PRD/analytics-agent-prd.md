# Analytics Agent — PRD

**Version:** 1.0  
**Date:** 2026-05-04  
**Status:** Draft

---

## Description

`Analytics Agent` connects to Power BI Fabric via service principal, runs DAX queries, generates business insights per manager/agent, and distributes reports by email. Saves all reports to Obsidian VAULT and git-versions them.

Operates on schedule (daily + weekly) or on-demand by request.

---

## Problem It Solves

Managers receive no automatic signal when a client hasn't ordered in 13+ days, when an agent is below 60% of monthly target, or when weekly sales trends shift.  
Manual Power BI browsing is time-consuming, inconsistent, and person-dependent.

`Analytics Agent` pushes the right data to the right manager at the right time — without anyone opening a dashboard.

---

## Goals

1. **Automated morning brief** — daily at 07:00 per manager, with client list and anomalies
2. **Overdue alert** — daily flag of clients with no order >13 days
3. **Weekly report** — every Friday 17:00 — sales volume, goal %, top/bottom clients
4. **Segmentation** — each manager sees only their own agents and clients
5. **VAULT + Git persistence** — every report saved and version-controlled

---

## Scope

### In Scope

- Power BI Fabric DAX query execution via REST API
- MSAL OAuth2 authentication (service principal)
- Report generation: daily brief, weekly report, overdue alert
- Per-manager segmentation (ALEXEY, ANATOL, NATALYA, SADRAN+, SVETA, VLAD)
- Email delivery via nodemailer / SendGrid
- Report persistence: `VAULT/Analytics/daily/`, `weekly/`, `alerts/`
- Git commit per report with date in message

### Out of Scope (v1)

- Power BI dataset refresh (read-only agent)
- Modifying data in Fabric or SQL Server
- Push notifications / WhatsApp / Telegram (email only)
- Real-time streaming — scheduled batch only

---

## Inputs / Outputs

### Inputs

- `.env` credentials: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- `POWERBI_WORKSPACE_ID`, `POWERBI_DATASET_ID`
- DAX query templates (hardcoded + parametrized by day/manager)
- Manager → agent mapping (config)
- Manager → email mapping (config)

### Outputs

- Markdown report files in `VAULT/Analytics/`
- Git commit per report
- Email to each manager with their segment's data
- Summary in chat (2–3 lines max)

---

## Architecture

```text
Scheduler (cron) / User request
        │
        ▼
Analytics Agent
  ├─ MSAL Token Provider (service principal)
  ├─ DAX Executor (Power BI REST API)
  ├─ Report Generator (Markdown per manager)
  ├─ VAULT Writer (VAULT/Analytics/)
  ├─ Git Committer
  └─ Email Sender (nodemailer / SendGrid)
```

---

## Reports

### 1. Daily Brief (07:00)
Per manager:
- Client count today by agent
- Clients with no order >13 days (⚠ red list)
- Top-3 clients by % of monthly target
- 1–2 insights in plain language

### 2. Overdue Alert (daily)
If any client hasn't ordered >13 days → their agent gets a targeted alert.

### 3. Weekly Report (Friday 17:00)
- Weekly sales volume by agent
- % of monthly target completion
- Top-5 and bottom-5 clients
- Lost clients (no order >30 days)

---

## DAX Integration

Key table: `משטח עם כפולות` (visit matrix with agents/days)  
Sales table: `ALL_PARTS` (order history with dates and amounts)

DAX queries parametrized by:
- `[יום]` — day of week for visit schedule
- `YEAR(TODAY())`, `MONTH(TODAY())` — for monthly target calculation
- Manager/agent filter applied post-query in JS

---

## Core Workflow

1. Trigger (cron or user command)
2. Acquire MSAL token
3. Run DAX query for today's data
4. Group results by manager → agent → client
5. Apply anomaly detection (>13 days, <60% target)
6. Generate Markdown report per manager
7. Save to `VAULT/Analytics/[type]/YYYY-MM-DD-*.md`
8. `git commit -m "analytics: daily brief YYYY-MM-DD"`
9. Send email to each manager (their data only)
10. Return summary to chat

---

## Configuration

```env
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
POWERBI_WORKSPACE_ID=fa961d5f-21c6-4faa-aab6-12964ab3bf5b
POWERBI_DATASET_ID=457ddbf6-86f3-4d1f-8505-f4fd6ee0fb84
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=reports@diler.co.il
SMTP_PASS=...
REPORT_RECIPIENTS={"ALEXEY":"alexey@diler.co.il","VLAD":"vlad@diler.co.il",...}
```

---

## VAULT Structure

```
VAULT/Analytics/
  daily/     YYYY-MM-DD-brief.md
  weekly/    YYYY-WXX-report.md
  alerts/    YYYY-MM-DD-overdue.md
  _index.md
```

---

## Error Handling

- Expired `AZURE_CLIENT_SECRET` → fail with clear message + no email sent
- DAX query error → log error, skip report, alert CEO
- Email delivery failure → retry once, then log to VAULT without email
- Empty result set → send "no data" report (don't skip silently)

---

## Security

- All credentials from `.env` — never hardcoded
- Each manager receives only their own agent's data — no cross-manager leakage
- No PII (client names/addresses) in git commit messages

---

## Quality / Acceptance Criteria

- [ ] Daily brief delivered to each manager by 07:15
- [ ] Overdue list is accurate (>13 days since last order date in `ALL_PARTS`)
- [ ] Each manager sees only their agents
- [ ] Report saved to VAULT and committed to git
- [ ] No hardcoded credentials in any file
- [ ] Empty/error states handled without silent failure

---

## Future Enhancements (v2+)

1. WhatsApp / Telegram delivery option
2. Manager-configurable thresholds (currently hardcoded 13 days)
3. Trend charts (text-based ASCII or image via Yuval agent)
4. Automatic Power BI refresh trigger before query
5. DAX query cache (1-hour TTL to reduce API calls ~60%)
