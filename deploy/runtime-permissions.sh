#!/usr/bin/env bash
# Root-owned runtime artifacts: service account may read, never write code/dependencies.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]]
getent group vibefinance >/dev/null
targets=(/opt/vibefinance/node_modules /opt/vibefinance/server/dist /opt/vibefinance/shared/dist)
if [[ -d /opt/vibefinance/docs/evaluation ]]; then
  [[ "$(realpath /opt/vibefinance/docs)" == /opt/vibefinance/docs ]]
  chown root:vibefinance /opt/vibefinance/docs
  chmod g+rx,g-w /opt/vibefinance/docs
  targets+=(/opt/vibefinance/docs/evaluation)
fi
for target in "${targets[@]}"; do
  [[ -d "$target" && "$(realpath "$target")" == "$target" ]]
  chown -R root:vibefinance "$target"
  chmod -R g+rX,g-w "$target"
done
