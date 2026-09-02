#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
require_root
CONFIG_PATH=${1:?usage: rollback-release.sh CONFIG}
load_config "$CONFIG_PATH"
CURRENT="$SITE_ROOT/current"
PREVIOUS="$SITE_ROOT/previous"
[[ -L "$CURRENT" && -L "$PREVIOUS" ]] || { echo "No rollback release is available." >&2; exit 2; }
current_target=$(readlink -f -- "$CURRENT")
previous_target=$(readlink -f -- "$PREVIOUS")
[[ -d "$current_target" && -d "$previous_target" ]] || { echo "Rollback link target is missing." >&2; exit 2; }
ln -sfnT -- "$previous_target" "$CURRENT.next"
mv -Tf -- "$CURRENT.next" "$CURRENT"
if ! nginx -t; then
  ln -sfnT -- "$current_target" "$CURRENT"
  echo "Rollback target failed Nginx validation; current release restored." >&2
  exit 1
fi
ln -sfnT -- "$current_target" "$PREVIOUS.next"
mv -Tf -- "$PREVIOUS.next" "$PREVIOUS"
systemctl reload nginx
echo "Rolled back to: $previous_target"
