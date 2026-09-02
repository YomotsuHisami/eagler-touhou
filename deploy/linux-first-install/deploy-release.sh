#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
CONFIG_PATH=${1:?usage: deploy-release.sh CONFIG SITE_PACKAGE [RELEASE_ID]}
SITE_PACKAGE=${2:?usage: deploy-release.sh CONFIG SITE_PACKAGE [RELEASE_ID]}
RELEASE_ID=${3:-$(date -u +%Y%m%dT%H%M%SZ)}
load_config "$CONFIG_PATH"
validate_site_package "$SITE_PACKAGE"
[[ "$RELEASE_ID" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo "Unsafe release id: $RELEASE_ID" >&2; exit 2; }

RELEASES_ROOT="$SITE_ROOT/releases"
STAGING="$RELEASES_ROOT/.staging-$RELEASE_ID"
FINAL="$RELEASES_ROOT/$RELEASE_ID"
CURRENT="$SITE_ROOT/current"
PREVIOUS="$SITE_ROOT/previous"
install -d -m 0755 "$RELEASES_ROOT"
[[ ! -e "$FINAL" && ! -e "$STAGING" ]] || { echo "Release already exists: $RELEASE_ID" >&2; exit 2; }
install -d -m 0755 "$STAGING"
trap 'rm -rf -- "$STAGING"' EXIT
rsync -a --delete -- "$SITE_PACKAGE/" "$STAGING/"
validate_site_package "$STAGING"
mv -- "$STAGING" "$FINAL"
trap - EXIT

old_target=""
if [[ -L "$CURRENT" ]]; then
  old_target=$(readlink -f -- "$CURRENT")
fi
ln -sfnT -- "$FINAL" "$CURRENT.next"
mv -Tf -- "$CURRENT.next" "$CURRENT"
if [[ -n "$old_target" && -d "$old_target" ]]; then
  ln -sfnT -- "$old_target" "$PREVIOUS.next"
  mv -Tf -- "$PREVIOUS.next" "$PREVIOUS"
fi

if ! nginx -t; then
  if [[ -n "$old_target" && -d "$old_target" ]]; then
    ln -sfnT -- "$old_target" "$CURRENT"
  else
    rm -f -- "$CURRENT"
  fi
  echo "Nginx validation failed; current release restored." >&2
  exit 1
fi
systemctl reload nginx

python3 - "$RELEASES_ROOT" "$CURRENT" "$PREVIOUS" "$KEEP_RELEASES" <<'PY'
import pathlib, shutil, sys
root = pathlib.Path(sys.argv[1]).resolve()
keep = max(2, int(sys.argv[4]))
protected = set()
for link in map(pathlib.Path, sys.argv[2:4]):
    if link.is_symlink(): protected.add(link.resolve())
releases = sorted((p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".staging-")), key=lambda p: p.stat().st_mtime, reverse=True)
for path in releases[keep:]:
    resolved = path.resolve()
    if root not in resolved.parents or resolved in protected: continue
    shutil.rmtree(resolved)
PY

echo "Activated release: $FINAL"
