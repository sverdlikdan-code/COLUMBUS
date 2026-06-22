# COLUMBUS — Post-Migration Test Checklist

Run all tests BEFORE shutting down the old Windows server.

**VPS IP:** `<SERVER_IP>`  
**Domain:** `https://api.sverdlik-apps.site`  
**Admin key:** see `.env` → `ADMIN_LOG_KEY`

---

## 1. Server Health

```bash
# On VPS
pm2 status
# Expected: columbus-api | online | ↺ 0
```

```bash
# From any machine
curl -I https://api.sverdlik-apps.site/health
# Expected: HTTP 200 or 404 (server is responding)
```

---

## 2. Cloudflare Tunnel

- [ ] `sudo systemctl status cloudflared` → **active (running)**
- [ ] `curl -I https://api.sverdlik-apps.site` → responds (no timeout)

---

## 3. Authentication

```bash
# Test login with manager password
curl -s -X POST https://api.sverdlik-apps.site/auth \
  -H "Content-Type: application/json" \
  -d '{"code":"YOUR_MANAGER_PASS"}' | jq .
# Expected: {"ok":true,"type":"manager","token":"..."}
```

- [ ] Returns `ok: true`
- [ ] Returns a token (UUID format)

---

## 4. Session Token

```bash
# Use the token from step 3
TOKEN="<token-from-above>"

curl -s "https://api.sverdlik-apps.site/managers" \
  -H "X-Session: $TOKEN" | jq .
# Expected: JSON list of managers
```

- [ ] Returns data (not 401)

---

## 5. Rate Limiting

```bash
# Run 15 bad auth attempts — should get 429 after 10
for i in {1..12}; do
  curl -s -X POST https://api.sverdlik-apps.site/auth \
    -H "Content-Type: application/json" \
    -d '{"code":"wrong"}' | jq .ok
done
# Expected: first 10 return false, then 429 rate_limit
```

- [ ] Rate limit kicks in after 10 attempts

---

## 6. Geo-block (from non-Israel IP)

- [ ] Ask someone outside Israel to try: `curl https://api.sverdlik-apps.site/auth`
- [ ] Expected: Cloudflare block page (403 or connection refused)
- [ ] In Cloudflare Dashboard → Security → WAF → Events: blocked requests visible

---

## 7. Admin Endpoints

```bash
ADMIN_KEY="<ADMIN_LOG_KEY from .env>"

# View logs
curl "https://api.sverdlik-apps.site/admin/logs?key=$ADMIN_KEY" -H "Accept: text/html"
# Expected: HTML table with login events

# Test revoke (use a non-existent code to avoid disrupting real agents)
curl -X POST "https://api.sverdlik-apps.site/admin/revoke?key=$ADMIN_KEY&agentCode=0000000000"
# Expected: {"ok":true,"agentCode":"0000000000","revokedSessions":0}
```

- [ ] `/admin/logs` returns HTML table
- [ ] `/admin/revoke` returns ok: true
- [ ] Both return 403 without key

---

## 8. Access Log

```bash
# On VPS
cat /home/columbus/COLUMBUS/server/access-log.json | python3 -m json.tool | tail -20
# Expected: recent login events in JSON array
```

- [ ] Log file exists and contains events from tests above

---

## 9. Formula Road App — End to End

Open `https://sverdlikdan-code.github.io/COLUMBUS/formula-road.html` in browser:

- [ ] Login screen loads
- [ ] Manager login works (enter manager password)
- [ ] Agent list loads from API
- [ ] Agent login works
- [ ] Customer list loads for an agent

---

## 10. Reboot Test

```bash
sudo reboot
# Wait 60 seconds, then:
pm2 status
curl -s -X POST https://api.sverdlik-apps.site/auth \
  -H "Content-Type: application/json" \
  -d '{"code":"wrong"}' | jq .ok
# Expected: false (server is running and responding)
```

- [ ] Server auto-starts after reboot
- [ ] API responds without manual intervention

---

## All Tests Passed?

- [ ] Yes → shut down old Windows server, notify d.sverdlik@dilerbmd.com
- [ ] No → keep old Windows server running, troubleshoot VPS issues

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| 502 Bad Gateway | `pm2 status` — is server running? `pm2 logs columbus-api` |
| 403 from all requests | Cloudflare WAF — check if your IP is blocked |
| 401 on all API calls | Server started OK? Token TTL not expired? |
| DB connection error | `pm2 logs` — check SQL Server connection string in `.env` |
| Tunnel not connecting | `systemctl status cloudflared` — check token is correct |
