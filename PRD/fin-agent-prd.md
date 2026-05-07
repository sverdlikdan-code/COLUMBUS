# Finance Agent — PRD

**Version:** 1.0  
**Date:** 2026-05-04  
**Status:** Draft

---

## Description

`Finance Agent` is the CFO of the COLUMBUS agent system. It tracks Claude API token consumption per agent, calculates USD costs, flags budget overruns, identifies inefficient agents, and proposes concrete prompt optimizations.

Reports to CEO. Controls no agents directly — only recommends.

---

## Problem It Solves

AI agent costs accumulate invisibly. Without tracking, expensive models get used for trivial tasks, bloated prompts burn budget silently, and no one knows which agent is the largest cost center until the invoice arrives.

`Finance Agent` makes token spend visible, actionable, and bounded — before it becomes a problem.

---

## Goals

1. **Visibility** — know exactly what each agent costs per day/week
2. **Budget enforcement** — soft alerts at 80%, hard stop at 100% of daily budget
3. **Efficiency scoring** — identify agents with poor output/input ratio
4. **Model optimization** — recommend downgrade from Opus/Sonnet → Haiku where quality doesn't require it
5. **Weekly report** — finance snapshot to VAULT + CEO summary

---

## Scope

### In Scope

- Token consumption tracking per agent (via Anthropic Console CSV or inline logging)
- Cost calculation by model (input + output tokens × price per million)
- Per-agent daily budget limits
- Alert generation at 80% and 100% thresholds
- Weekly finance report to VAULT/Finance/
- Prompt optimization recommendations
- Prompt caching analysis (which agents benefit most)

### Out of Scope (v1)

- Runtime agent shutdown (CEO decides, Finance recommends)
- API key rotation or access control changes
- Power BI or SQL data access
- Real-time streaming cost tracking (batch log analysis only)

---

## Inputs / Outputs

### Inputs

- Anthropic Console usage export (CSV) — or inline `usage` objects from API responses
- Agent activity log: `VAULT/Finance/token-log.jsonl`
- Budget config: `VAULT/Finance/limits.json`
- Model price table (maintained in AGENT.md, updated manually)

### Outputs

- Daily/weekly Markdown reports in `VAULT/Finance/`
- Alert messages to CEO at 80% and 100% budget
- Optimization recommendations (specific, actionable — not generic)
- Git commit per report

---

## Architecture

```text
Trigger (cron / CEO request)
        │
        ▼
Finance Agent
  ├─ Log Reader (token-log.jsonl or CSV)
  ├─ Cost Calculator (tokens × model price)
  ├─ Budget Comparator (vs limits.json)
  ├─ Efficiency Analyzer (output/input ratio)
  ├─ Report Generator (Markdown)
  ├─ VAULT Writer
  └─ Git Committer
```

---

## Model Price Table (2025)

| Model | Input ($/1M) | Output ($/1M) |
|-------|-------------|--------------|
| claude-opus-4-7 | $15.00 | $75.00 |
| claude-sonnet-4-6 | $3.00 | $15.00 |
| claude-haiku-4-5 | $0.80 | $4.00 |

**Rule:** Opus only for CEO-level decisions. Haiku for QA, routing, formatting. Sonnet for creative and complex reasoning.

---

## Recommended Model Matrix

| Agent | Task type | Recommended model |
|-------|-----------|------------------|
| ceo-agent | Routing & decisions | sonnet |
| analytics | DAX + reports | haiku |
| designer | UX specs | sonnet |
| geograf | Route optimization | haiku |
| chen | Web search + summary | haiku |
| yael | Copywriting | sonnet |
| guy | QA checklist | haiku |
| fin-agent | Cost analysis | haiku |

---

## Budget Defaults

```json
{
  "daily_budget_usd": 5.00,
  "per_agent_daily_usd": {
    "ceo-agent": 2.00,
    "yael": 1.50,
    "chen": 0.50,
    "analytics": 0.30,
    "designer": 0.30,
    "geograf": 0.20,
    "guy": 0.20,
    "fin-agent": 0.10
  },
  "alert_threshold_pct": 80,
  "hard_stop_pct": 100
}
```

Stored in: `VAULT/Finance/limits.json` — versioned in git.

---

## Token Logging (inline)

Add to every Claude API call in agent code:

```js
const usage = response.usage;
await logTokenUsage({
  agent: 'yael',
  model: 'claude-sonnet-4-6',
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
  costUsd: calcCost(usage, 'claude-sonnet-4-6'),
  timestamp: new Date().toISOString(),
  task: taskDescription,
});
// Appends one JSON object per line to VAULT/Finance/token-log.jsonl
```

---

## Alert Protocol

**At 80% daily budget:**
```
⚠️ Finance Alert: 80% daily budget used ($4.02/$5.00)
Top spender: yael — $1.82 (36%)
Recommendation: pause non-critical tasks until reset
```

**At 100% daily budget:**
```
🛑 Finance Hard Stop: Daily budget exhausted ($5.00/$5.00)
Only CEO-priority tasks allowed until midnight reset
```

CEO receives alert in chat. Decision to pause agents belongs to CEO — Finance only flags.

---

## Efficiency Analysis

**Input/output ratio > 10:1** = inefficient (too much context per token of output)  
**Output < 100 tokens with input > 2,000** = suspected prompt waste

### Common Optimizations

| Problem | Solution | Savings |
|---------|----------|---------|
| Long system prompt repeated every call | Anthropic prompt caching | Up to 90% |
| Whole VAULT passed as context | Load only relevant files | 40–70% |
| Sonnet used for QA/formatting | Downgrade to Haiku | 75% |
| Repeated data fetches | Cache with TTL | 30–60% |
| Full table passed to agent | Pass only needed columns | 20–40% |

---

## Weekly Report Format

`VAULT/Finance/weekly/YYYY-WXX.md`

```markdown
# Finance Report — Week XX, YYYY

## Total Spend
- This week: $X.XX
- Month to date: $X.XX
- Budget remaining: $X.XX (XX%)

## By Agent
| Agent | Calls | Input | Output | Cost |
|-------|-------|-------|--------|------|
| yael  | 12    | 48K   | 24K    | $0.72|

## Efficiency Score (output/input ratio)
- Best: geograf (0.45)
- Worst: ceo-agent (0.12)

## Recommendations
1. [specific agent]: switch from sonnet → haiku — saves ~$X.XX/day
2. [specific agent]: add prompt caching — saves ~X% on context
```

---

## VAULT Structure

```
VAULT/Finance/
  weekly/     YYYY-WXX.md
  daily/      YYYY-MM-DD.md
  token-log.jsonl    ← raw per-call data
  limits.json        ← budget config (versioned)
  _index.md
```

---

## Error Handling

- Missing `token-log.jsonl` → report with note "no usage data yet, set up inline logging"
- `limits.json` not found → use defaults, warn CEO
- Cost calculation for unknown model → flag as "unknown model, cost not calculated"

---

## Security

- No credentials needed (reads local log files only)
- `limits.json` committed to git — changes are auditable
- Token log contains no user content — only metadata (agent, model, token counts, cost)

---

## Quality / Acceptance Criteria

- [ ] Weekly report generated every Friday with correct per-agent costs
- [ ] Alert fires at 80% and 100% of daily budget
- [ ] Efficiency score calculated for each active agent
- [ ] Recommendations are specific (name agent, model, estimated savings)
- [ ] All reports saved to VAULT and committed to git
- [ ] `limits.json` is the single source of truth for budgets — no hardcoded values

---

## Future Enhancements (v2+)

1. Bedrock Cost Explorer integration (if migrated to AWS)
2. Per-task cost breakdown (not just per-agent)
3. Anomaly detection — flag sudden 3× spike vs rolling average
4. Monthly budget rollover tracking
5. Automated prompt caching rollout recommendations with code snippets
