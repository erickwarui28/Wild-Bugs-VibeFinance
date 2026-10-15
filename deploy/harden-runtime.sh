#!/usr/bin/env bash
# Migrate only VibeFinance from root PM2 to a restricted systemd service.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" == 0 ]] || { echo 'Run as administrator'; exit 1; }
cd /opt/vibefinance
[[ -f server/.env && -d server/data && -f server/dist/index.js ]]
[[ "$(realpath server/data)" == '/opt/vibefinance/server/data' ]]
[[ -z "$(find /opt/vibefinance/server/data -type l -print -quit)" ]] || { echo 'Data symlinks require review'; exit 1; }
if getent passwd vibefinance >/dev/null; then
  [[ "$(getent passwd vibefinance | cut -d: -f6)" == '/nonexistent' ]]
  [[ "$(getent passwd vibefinance | cut -d: -f7)" == '/usr/sbin/nologin' ]]
else
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin vibefinance
fi
# Code remains administrator-owned. Only the database directory is writable.
chown -R vibefinance:vibefinance /opt/vibefinance/server/data
chmod 700 /opt/vibefinance/server/data
find /opt/vibefinance/server/data -type f -exec chmod 600 {} +
chown root:vibefinance server/.env
chmod 640 server/.env
bash deploy/runtime-permissions.sh
# Fail before stopping the working runtime if the new user cannot resolve dependencies.
(
  cd server
  runuser -u vibefinance -- /usr/local/bin/node --input-type=module -e "await import('./dist/app.js'); console.log('Restricted dependency preflight passed.');"
)
install -m 644 deploy/vibefinance.service /etc/systemd/system/vibefinance.service
install -m 644 deploy/vibefinance-monitor.service /etc/systemd/system/vibefinance-monitor.service
install -m 644 deploy/vibefinance-monitor.timer /etc/systemd/system/vibefinance-monitor.timer
install -m 644 deploy/vibefinance-backup.service /etc/systemd/system/vibefinance-backup.service
install -m 644 deploy/vibefinance-backup.timer /etc/systemd/system/vibefinance-backup.timer
install -m 644 deploy/vibefinance-retention.service /etc/systemd/system/vibefinance-retention.service
install -m 644 deploy/vibefinance-retention.timer /etc/systemd/system/vibefinance-retention.timer
install -d -m 755 /etc/systemd/journald@vibefinance.conf.d
install -m 644 deploy/journald-vibefinance.conf /etc/systemd/journald@vibefinance.conf.d/retention.conf
install -d -m 700 /var/lib/vibefinance-ops
systemctl daemon-reload
systemctl try-restart systemd-journald@vibefinance.service
systemd-analyze verify /etc/systemd/system/vibefinance.service /etc/systemd/system/vibefinance-monitor.service /etc/systemd/system/vibefinance-monitor.timer
rollback() {
  trap - ERR
  systemctl disable --now vibefinance.service || true
  pm2 start deploy/ecosystem.config.cjs
  pm2 save --force
  echo 'Migration failed: previous VibeFinance PM2 runtime restored. Database was not replaced.'
  exit 1
}
trap rollback ERR
if pm2 describe vibefinance >/dev/null 2>&1; then
  pm2 delete vibefinance
  pm2 save --force
fi
systemctl enable --now vibefinance.service
curl --fail --retry 5 --retry-delay 2 --retry-connrefused --max-time 10 http://127.0.0.1:8080/api/health
trap - ERR
systemctl enable --now vibefinance-monitor.timer
systemctl enable --now vibefinance-backup.timer
systemctl start vibefinance-backup.service
systemctl start vibefinance-monitor.service
systemctl enable --now vibefinance-retention.timer
echo 'Restricted runtime, local diagnostics and approved release/log retention enabled. Database history is preserved.'
