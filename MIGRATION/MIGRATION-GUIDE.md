# COLUMBUS — Migration Guide
## Node.js API Server → Debian Linux VPS (Hetzner)

**Prepared for:** IT Administrator  
**Project:** COLUMBUS / Formula Road  
**Date:** 2026-05-28  
**Contact:** d.sverdlik@dilerbmd.com

---

## Overview

We are migrating the Formula Road API server from a local Windows machine to a Debian 12 VPS.

**What moves to VPS:**
- `server/index.js` — Node.js Express API (port 3000)
- `.env` — environment variables (provided separately by the project owner)
- Cloudflare Tunnel daemon (`cloudflared`)

**What stays where it is:**
- `docs/formula-road.html` — hosted on GitHub Pages (no change)
- Build scripts — remain on Windows machine
- GitHub Actions — already in cloud (no change)

**Current domain:** `api.sverdlik-apps.site` (Cloudflare Tunnel → VPS after migration)

---

## Step 1 — Provision VPS

**Recommended:** Hetzner Cloud CX21  
- 2 vCPU, 4 GB RAM, 40 GB SSD  
- Location: **Helsinki or Frankfurt** (low latency to Israel)  
- OS: **Debian 12 (Bookworm)**  
- Cost: ~€6/month

Create at: https://console.hetzner.cloud  
Add your SSH public key during provisioning.

---

## Step 2 — Initial Server Setup

```bash
# Connect
ssh root@<SERVER_IP>

# Update system
apt update && apt upgrade -y

# Create non-root user
adduser columbus
usermod -aG sudo columbus
mkdir -p /home/columbus/.ssh
cp ~/.ssh/authorized_keys /home/columbus/.ssh/
chown -R columbus:columbus /home/columbus/.ssh
chmod 700 /home/columbus/.ssh

# Basic firewall
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

---

## Step 3 — Install Node.js 20

```bash
# Switch to columbus user
su - columbus

# Install Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # should be v20.x.x
npm --version
```

---

## Step 4 — Install PM2 (process manager)

```bash
sudo npm install -g pm2

# Configure PM2 to start on boot
pm2 startup systemd -u columbus --hp /home/columbus
# Run the command that PM2 prints
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u columbus --hp /home/columbus
```

---

## Step 5 — Clone Repository

```bash
cd /home/columbus

# Clone the repository
git clone https://github.com/sverdlikdan-code/COLUMBUS.git
cd COLUMBUS

# Install server dependencies
cd server
npm install
cd ..
```

---

## Step 6 — Configure Environment Variables

Copy the `.env.template` file from this folder and fill in all values.  
**Get the actual values from the project owner (d.sverdlik@dilerbmd.com).**

```bash
# Upload .env to server (run this from YOUR machine, not the server)
scp .env columbus@<SERVER_IP>:/home/columbus/COLUMBUS/.env

# On the server — verify it's there and not readable by others
chmod 600 /home/columbus/COLUMBUS/.env
ls -la /home/columbus/COLUMBUS/.env
# Should show: -rw------- 1 columbus columbus
```

---

## Step 7 — Install Cloudflare Tunnel

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Login to Cloudflare (opens browser — do this from a machine with a browser,
# or use the token method below)
cloudflared tunnel login
```

**Using tunnel token (recommended — no browser needed on server):**

1. Go to Cloudflare Dashboard → Zero Trust → Networks → Tunnels
2. Find the existing tunnel for `api.sverdlik-apps.site`
3. Click "Configure" → copy the tunnel token
4. On the server:

```bash
sudo cloudflared service install <TUNNEL_TOKEN>
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
sudo systemctl status cloudflared
```

---

## Step 8 — Start the Server

```bash
cd /home/columbus/COLUMBUS/server

# Start with PM2
pm2 start index.js --name "columbus-api"

# Save PM2 process list (survives reboots)
pm2 save

# Check it's running
pm2 status
pm2 logs columbus-api --lines 20
```

---

## Step 9 — Update Cloudflare Tunnel Target

In Cloudflare Dashboard → Zero Trust → Tunnels → your tunnel → Edit:
- Change the service from `http://localhost:3000` (old Windows machine)
- To `http://localhost:3000` on the **new VPS**

The domain `api.sverdlik-apps.site` continues to work — no DNS changes needed.

---

## Step 10 — Verify Everything Works

Run the test checklist: see `TEST-CHECKLIST.md`

---

## Step 11 — Shutdown Old Windows Server

Only after all tests pass:

```bash
# On Windows machine — stop the old server
# Stop the Node.js process running server/index.js
# Stop cloudflared on Windows
```

---

## Maintenance Commands (after migration)

```bash
# View live logs
pm2 logs columbus-api

# Restart server
pm2 restart columbus-api

# Update code from GitHub
cd /home/columbus/COLUMBUS
git pull
pm2 restart columbus-api

# Check server status
pm2 status

# View last 100 access log entries
tail -100 /home/columbus/COLUMBUS/server/access-log.json
```

---

## Directory Structure on VPS

```
/home/columbus/COLUMBUS/
  .env                    ← secrets (chmod 600, not in git)
  server/
    index.js              ← main API server
    access-log.json       ← audit log (auto-created)
    node_modules/
  docs/
    formula-road.html     ← served from GitHub Pages, not from VPS
    formula-road-data.json
```

---

## Security Notes

- `.env` must be `chmod 600` — readable only by `columbus` user
- Firewall: only ports 22, 80, 443 open
- Cloudflare WAF is active — non-Israel traffic blocked before reaching VPS
- All API endpoints require session token (X-Session header)
- Admin endpoints require ADMIN_LOG_KEY

---

## Rollback Plan

If anything goes wrong:
1. Start the old Windows server again (`node index.js` in `server/`)
2. In Cloudflare Tunnel config — point service back to old Windows machine IP
3. Domain stays the same, agents won't notice

The old Windows server stays running in parallel until all tests pass.
