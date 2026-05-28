# Security Agent — PRD

**Version:** 1.0  
**Date:** 2026-05-28  
**Status:** Active

---

## Description

`Security Agent` is the security officer of the COLUMBUS system. It audits web applications, API servers, and infrastructure for vulnerabilities, implements protective measures, and produces professional security reports.

Primary focus: Formula Road PWA + Express API server (server/index.js) + Cloudflare configuration.

Reports to CEO. Implements changes directly in code but coordinates infrastructure decisions with the user.

---

## Problem It Solves

Web applications and APIs accumulate security debt silently. Without dedicated review:
- New endpoints get added without authentication
- Sensitive data leaks into public static files
- Passwords end up in client-side code
- Logs grow unbounded and expose internal data
- No one tracks what the threat model actually is

`Security Agent` ensures every new surface is reviewed, every risk is documented, and the current security posture is always visible.

---

## Goals

1. **Audit** — structured review of any new code or endpoint against OWASP Top 10
2. **Hardening** — implement authentication, rate limiting, validation, secure headers
3. **Visibility** — professional HTML security reports with threat model and residual risks
4. **Incident response** — read access logs, identify anomalies, recommend mitigation
5. **Documentation** — maintain accurate security state in AGENT.md and VAULT

---

## Scope

### In Scope

- Node.js/Express API security (session management, rate limiting, CORS, input validation)
- Client-side security (no secrets in HTML/JS, apiFetch with token injection, auto-logout on 401)
- HTTP security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.)
- Cloudflare WAF rules (geo-blocking, custom firewall expressions)
- Audit logging (access-log.json: login/logout/GPS-save/planogram-save events)
- Security reports (HTML format, current-state baseline, no "was broken / fixed" language)
- Static data review (formula-road-data.json: prevent sensitive data in public files)
- `.gitignore` and `.env` hygiene

### Out of Scope (v1)

- SSL certificate management (handled by Cloudflare)
- Database security (no SQL database in Formula Road)
- Mobile app security (designer/analytics handles the React Native app)
- Penetration testing with exploitation tools
- Automated CI/CD security scanning

---

## Inputs / Outputs

### Inputs

- `server/index.js` — Express API server
- `docs/formula-road.html` — PWA client
- `docs/formula-road-data.json` — public static data
- `.env` — environment variables (structure only, not values)
- `server/access-log.json` — audit trail
- Cloudflare dashboard screenshots / user reports

### Outputs

- Modified `server/index.js` with security measures implemented
- Modified `docs/formula-road.html` with token handling
- `SECURITY-REPORT-{Project}-{Year}.html` in project root
- Updated `.gitignore`
- VAULT session note with security posture summary
- Git commit via `/commit`

---

## Architecture

```text
Trigger (security task / new feature / incident)
        │
        ▼
Security Agent
  ├─ Code Reader (server/index.js, formula-road.html)
  ├─ Audit Checker (SKILL.md checklist)
  ├─ Hardening Implementer (code changes)
  ├─ Report Generator (HTML security report)
  ├─ VAULT Writer (session note, agent-security-agent.md)
  └─ CEO Notifier (residual risks + recommendations)
```

---

## Security Measures Implemented (Formula Road, 2026-05-28)

### Authentication & Authorization
- Session tokens (UUID v4, 8h TTL) via X-Session header
- Unified /auth endpoint — validates both manager password and agent codes
- requireAuth middleware on all 6 API data endpoints
- isManager authorization check on /save-kapua (planogram writes)
- Manager password stored in .env (not in source code)

### Network Security
- Cloudflare WAF: Block non-Israel geo-rule (Active)
- CORS whitelist: sverdlikdan-code.github.io + localhost only
- HTTPS enforced via Cloudflare (Full SSL)

### Anti-abuse
- Rate limiting: 10 auth attempts/min/IP (loginAttempts Map)
- Rate limiting: 60 data requests/min/IP (generalRequests Map)
- Payload limit: 512KB JSON body maximum

### Application Security
- Input validation: agentCode `/^\d{1,10}$/`, managerName charset whitelist, day 1-5
- XSS prevention: esc() HTML-escaping function in /admin/logs
- No sensitive data in public static file (routes + agents removed from formula-road-data.json)
- DEMO_AGENTS cleared (no real employee names/codes in HTML source)
- HTTP security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, X-XSS-Protection, Permissions-Policy

### Monitoring & Logging
- Audit log: GPS corrections logged (who/when/what)
- Audit log: Planogram saves logged
- Login/logout events logged to server/access-log.json
- Log limited to 2000 entries (auto-prune)
- Admin log accessible via GET /admin/logs?key=KEY (key in .env)
- access-log.json in .gitignore

---

## Residual Risks

| ID | Risk | Level | Recommendation |
|----|------|-------|----------------|
| R-01 | Server runs on local machine (single point of failure, physical access) | Medium | Migrate to VPS (Azure B1s / DigitalOcean Droplet) |
| R-02 | Disk not encrypted (no BitLocker) | Medium | Enable BitLocker on C: drive |
| R-03 | Old git history may contain stale passwords | Low | git filter-repo or BFG to scrub history |
| R-04 | No /admin/revoke — session invalidation requires server restart | Low | Add POST /admin/revoke?agentCode=X endpoint |

---

## Security Report Format

Files: `SECURITY-REPORT-{Project}-{Year}.html` (project root, not in docs/)

Sections:
1. Summary stats (active measures / residual risks / critical open)
2. System stack (architecture table by layer)
3. Active protections (by category)
4. Residual risks (with level and recommendation)
5. Access monitoring (recent events table)
6. Threat model (11 scenarios, each marked Closed/Open)

Language rule: current-state baseline only. No "was broken", "fixed today", "vulnerability found" — the report describes how the system IS, not how it became that way.

---

## Quality / Acceptance Criteria

- [ ] All API endpoints have requireAuth middleware
- [ ] No secrets or real employee data in client-side code
- [ ] CORS restricted to known origins
- [ ] Rate limiting active on /auth
- [ ] All 5 HTTP security headers set
- [ ] Input validation on all query/body parameters
- [ ] XSS prevention in any HTML-output endpoint
- [ ] Audit log captures login + critical write operations
- [ ] Security report generated and stored in project root
- [ ] Residual risks documented with owner and recommendation

---

## Future Enhancements (v2+)

1. POST /admin/revoke for session invalidation without restart (R-04)
2. Migrate server to VPS with auto-restart (R-01)
3. Content Security Policy (CSP) header
4. Webhook alert on >50 failed login attempts per hour
5. Scheduled weekly security scan via Claude remote routine
