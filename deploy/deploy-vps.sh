#!/usr/bin/env bash
# Run on the existing VPS. Backups stay outside the public repository.
set -Eeuo pipefail
umask 077
cd /opt/vibefinance
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Deployment stopped: VPS checkout has local changes."
  exit 1
fi
backup_dir="/opt/vibefinance-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
git rev-parse HEAD > "$backup_dir/previous-revision.txt"
cp -a server/dist "$backup_dir/server-dist"
cp -a shared/dist "$backup_dir/shared-dist"
if [[ -d web/dist ]]; then cp -a web/dist "$backup_dir/web-dist"; fi
cp -a node_modules "$backup_dir/node-modules"
export VF_BACKUP_DIR="$backup_dir"
(
  cd server
  node --input-type=module <<'NODE'
import Database from 'better-sqlite3';
import path from 'node:path';
import { getConfig } from './dist/config.js';
const database = new Database(path.resolve(getConfig().DB_PATH));
await database.backup(path.join(process.env.VF_BACKUP_DIR, 'vibefinance.db'));
database.close();
console.log('Database backup created.');
NODE
)
rollback() {
  trap - ERR
  echo "Deployment failed; restoring the previous compiled release."
  if systemctl is-enabled --quiet vibefinance.service 2>/dev/null; then
    systemctl stop vibefinance.service
  else
    pm2 stop vibefinance
  fi
  if [[ -d /opt/vibefinance/node_modules ]]; then
    mv /opt/vibefinance/node_modules "$backup_dir/failed-node-modules"
  fi
  cp -a "$backup_dir/node-modules" /opt/vibefinance/node_modules
  mv /opt/vibefinance/server/dist "$backup_dir/failed-server-dist"
  mv /opt/vibefinance/shared/dist "$backup_dir/failed-shared-dist"
  cp -a "$backup_dir/server-dist" /opt/vibefinance/server/dist
  cp -a "$backup_dir/shared-dist" /opt/vibefinance/shared/dist
  if [[ -d "$backup_dir/web-dist" ]]; then
    if [[ -d /opt/vibefinance/web/dist ]]; then mv /opt/vibefinance/web/dist "$backup_dir/failed-web-dist"; fi
    cp -a "$backup_dir/web-dist" /opt/vibefinance/web/dist
  fi
  restart_runtime
  curl --fail --retry 5 --retry-delay 2 --retry-connrefused --max-time 10 http://127.0.0.1:8080/api/health
  echo "Database backup preserved; additive schema changes are not reversed automatically."
  exit 1
}
restart_runtime() {
  if systemctl is-enabled --quiet vibefinance.service 2>/dev/null; then
    bash /opt/vibefinance/deploy/runtime-permissions.sh
    systemctl restart vibefinance.service
  else
    pm2 restart vibefinance --update-env
  fi
}
trap rollback ERR
git pull --ff-only origin main
npm ci
npm run build -w shared
npm run build -w server
npm run build -w web
restart_runtime
curl --fail --retry 5 --retry-delay 2 --retry-connrefused --max-time 10 http://127.0.0.1:8080/api/health
if ! systemctl is-enabled --quiet vibefinance.service 2>/dev/null; then pm2 save; fi
git rev-parse HEAD > "$backup_dir/deployed-revision.txt"
echo "Deployment verified. Backups: $backup_dir"
