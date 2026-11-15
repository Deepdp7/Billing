#!/usr/bin/env bash
# Apna Billing license server + Admin Panel on a shared VPS. Safe to re-run.
#
# Touches ONLY:
#   /home/apna-billing/...                       everything (app, data, keys, certificate, updates, backups)
#   system user "apnabilling"                    runs the service (no login shell)
#   /etc/systemd/system/apna-license.service     its own service
#   /etc/cron.d/apna-billing                     nightly backup of its own database
# It does not touch nginx, other websites, PostgreSQL, pm2 or the firewall. It listens on its own port ($PORT).
set -euo pipefail

BASE=/home/apna-billing
PORT="${PORT:-7443}"
IP="${PUBLIC_IP:?set PUBLIC_IP}"

if ss -ltn "sport = :$PORT" | grep -q LISTEN && ! systemctl is-active --quiet apna-license; then
  echo "Port $PORT is already used by another program. Choose another PORT in deploy/vps.json." >&2
  exit 1
fi

id apnabilling >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin apnabilling
mkdir -p "$BASE"/{license-server,admin-panel,data,keys,tls,updates,backups}

# HTTPS without a domain: a private certificate authority + a certificate for this IP (10 years).
# Only the CA *certificate* leaves this server (it is built into the desktop app, which then trusts exactly it).
if [ ! -f "$BASE/tls/server.crt" ]; then
  cd "$BASE/tls"
  openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes -keyout ca.key -out ca.crt \
    -subj "/CN=Apna Billing Server CA" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=$IP" 2>/dev/null
  printf "subjectAltName=IP:%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n" "$IP" > server.ext
  openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 3650 -sha256 -extfile server.ext 2>/dev/null
  rm -f server.csr server.ext
  echo "Created HTTPS certificate for $IP"
fi

cat > "$BASE/license.env" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=$PORT
DB_CLIENT=sqlite
SQLITE_FILE=$BASE/data/license.db
LICENSE_SIGNING_PRIVATE_KEY_FILE=$BASE/keys/signing-private.pem
TLS_CERT_FILE=$BASE/tls/server.crt
TLS_KEY_FILE=$BASE/tls/server.key
UPDATES_DIR=$BASE/updates
UPDATER_PUBLIC_KEY_FILE=$BASE/keys/updater.pub
PUBLIC_URL=https://$IP:$PORT
ADMIN_PANEL_DIR=$BASE/admin-panel
EOF

cat > /etc/systemd/system/apna-license.service <<EOF
[Unit]
Description=Apna Billing license server and Admin Panel
After=network-online.target
Wants=network-online.target

[Service]
User=apnabilling
Group=apnabilling
WorkingDirectory=$BASE/license-server
EnvironmentFile=$BASE/license.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$BASE/data $BASE/backups $BASE/updates

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/cron.d/apna-billing <<EOF
# Nightly copy of the Apna Billing license database (keeps 30 days).
30 2 * * * apnabilling cd $BASE/license-server && /usr/bin/node backup-db.cjs >> $BASE/backups/backup.log 2>&1
EOF

chown -R apnabilling:apnabilling "$BASE"
chown root:root "$BASE/license.env" "$BASE/tls/ca.key" 2>/dev/null || true
chgrp apnabilling "$BASE/license.env"
chmod 640 "$BASE/license.env"
chmod 700 "$BASE/keys" "$BASE/tls"
chmod 600 "$BASE/tls/ca.key" "$BASE/tls/server.key"
[ -f "$BASE/keys/signing-private.pem" ] && chmod 600 "$BASE/keys/signing-private.pem"
[ -f "$BASE/keys/updater.pub" ] && chmod 644 "$BASE/keys/updater.pub"
chmod 644 "$BASE/tls/server.crt" "$BASE/tls/ca.crt"

systemctl daemon-reload
systemctl enable apna-license >/dev/null 2>&1
systemctl is-active --quiet apna-license && systemctl restart apna-license
echo "Setup done."
