#!/bin/bash
# COLUMBUS VPS Setup Script — Debian 12
# Run as root on fresh Hetzner CX21
# Usage: bash setup.sh

set -e
echo "=== COLUMBUS VPS Setup ==="

# ── 1. System update ──────────────────────────────────────────────────────
echo "[1/7] Updating system..."
apt update && apt upgrade -y

# ── 2. Create user ────────────────────────────────────────────────────────
echo "[2/7] Creating 'columbus' user..."
if ! id "columbus" &>/dev/null; then
  adduser --disabled-password --gecos "" columbus
  usermod -aG sudo columbus
  mkdir -p /home/columbus/.ssh
  cp /root/.ssh/authorized_keys /home/columbus/.ssh/ 2>/dev/null || true
  chown -R columbus:columbus /home/columbus/.ssh
  chmod 700 /home/columbus/.ssh
  chmod 600 /home/columbus/.ssh/authorized_keys 2>/dev/null || true
fi

# ── 3. Firewall ───────────────────────────────────────────────────────────
echo "[3/7] Configuring firewall..."
apt install -y ufw
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

# ── 4. Node.js 20 ─────────────────────────────────────────────────────────
echo "[4/7] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version

# ── 5. PM2 ────────────────────────────────────────────────────────────────
echo "[5/7] Installing PM2..."
npm install -g pm2

# ── 6. Cloudflared ────────────────────────────────────────────────────────
echo "[6/7] Installing cloudflared..."
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
dpkg -i /tmp/cloudflared.deb
rm /tmp/cloudflared.deb

# ── 7. Clone repo ─────────────────────────────────────────────────────────
echo "[7/7] Cloning COLUMBUS repository..."
su - columbus -c "git clone https://github.com/sverdlikdan-code/COLUMBUS.git /home/columbus/COLUMBUS"
su - columbus -c "cd /home/columbus/COLUMBUS/server && npm install"

echo ""
echo "=== Setup complete ==="
echo ""
echo "NEXT STEPS:"
echo "1. Upload .env file:"
echo "   scp .env columbus@$(hostname -I | awk '{print $1}'):/home/columbus/COLUMBUS/.env"
echo "   ssh columbus@$(hostname -I | awk '{print $1}') 'chmod 600 /home/columbus/COLUMBUS/.env'"
echo ""
echo "2. Install Cloudflare Tunnel (get token from Cloudflare Dashboard):"
echo "   cloudflared service install <TUNNEL_TOKEN>"
echo "   systemctl start cloudflared && systemctl enable cloudflared"
echo ""
echo "3. Start server:"
echo "   su - columbus"
echo "   cd /home/columbus/COLUMBUS/server"
echo "   pm2 start index.js --name columbus-api"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "4. Run TEST-CHECKLIST.md to verify everything works."
