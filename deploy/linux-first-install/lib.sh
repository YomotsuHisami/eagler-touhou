#!/usr/bin/env bash
set -euo pipefail

load_config() {
  local config_path=${1:?config path is required}
  if [[ ! -f "$config_path" ]]; then
    echo "Config not found: $config_path" >&2
    exit 2
  fi
  set -a
  # shellcheck disable=SC1090
  source "$config_path"
  set +a
  : "${SITE_HOST:?SITE_HOST is required}"
  : "${ORIGIN_LISTEN:?ORIGIN_LISTEN is required}"
  : "${SITE_ROOT:?SITE_ROOT is required}"
  : "${SITE_CONFIG_NAME:?SITE_CONFIG_NAME is required}"
  : "${MIGRATION_MAP_ID:?MIGRATION_MAP_ID is required}"
  RELAY_MODE=${RELAY_MODE:-local}
  TURN_MODE=${TURN_MODE:-local}
  KEEP_RELEASES=${KEEP_RELEASES:-3}
  case "$RELAY_MODE" in local|external|disabled) ;; *) echo "Invalid RELAY_MODE: $RELAY_MODE" >&2; exit 2;; esac
  case "$TURN_MODE" in local|external|disabled) ;; *) echo "Invalid TURN_MODE: $TURN_MODE" >&2; exit 2;; esac
  [[ "$SITE_ROOT" == /* && "$SITE_ROOT" != / && "$SITE_ROOT" != /srv ]] || {
    echo "SITE_ROOT must be a dedicated absolute directory below /: $SITE_ROOT" >&2
    exit 2
  }
  [[ "$SITE_CONFIG_NAME" =~ ^[a-zA-Z0-9._-]+$ ]] || {
    echo "Unsafe SITE_CONFIG_NAME: $SITE_CONFIG_NAME" >&2
    exit 2
  }
  [[ "$MIGRATION_MAP_ID" =~ ^[a-zA-Z0-9_]{1,12}$ ]] || {
    echo "MIGRATION_MAP_ID must be a unique 1-12 character identifier." >&2
    exit 2
  }
  [[ "$ORIGIN_LISTEN" =~ ^([0-9]{1,5}|[a-zA-Z0-9_.:-]+:[0-9]{1,5})$ ]] || {
    echo "Invalid ORIGIN_LISTEN: $ORIGIN_LISTEN" >&2
    exit 2
  }
  [[ "$SITE_HOST" != *.example.com ]] || {
    echo "Replace the example SITE_HOST before deployment." >&2
    exit 2
  }
  if [[ "$RELAY_MODE" != disabled ]]; then
    [[ ${RELAY_UPSTREAM:-} =~ ^(https?|wss?)://[^[:space:]]+$ ]] || {
      echo "RELAY_UPSTREAM must be an http://, https://, ws://, or wss:// URL when relay is enabled." >&2
      exit 2
    }
  fi
  if [[ "$RELAY_MODE" == local ]]; then
    [[ ${NODE_RUNTIME_ARCH:-x64} == x64 ]] || {
      echo "This bundle supports NODE_RUNTIME_ARCH=x64; build another bundle for the target architecture." >&2
      exit 2
    }
    [[ $(uname -m) == x86_64 ]] || {
      echo "The bundled x64 Node runtime cannot run on $(uname -m)." >&2
      exit 2
    }
  fi
  if [[ "$TURN_MODE" == local && "$RELAY_MODE" != local ]]; then
    echo "Local TURN requires local relay for short-lived credential issuance." >&2
    exit 2
  fi
  if [[ "$RELAY_MODE" == local && "$TURN_MODE" != disabled ]]; then
    [[ ${TURN_URLS:-} == turn:* || ${TURN_URLS:-} == turns:* ]] || {
      echo "TURN_URLS is required when a local relay advertises TURN." >&2
      exit 2
    }
    [[ ${TURN_URLS:-} != *example.com* ]] || {
      echo "Replace the example TURN_URLS before deployment." >&2
      exit 2
    }
  fi
  if [[ "$TURN_MODE" == local ]]; then
    TURN_LISTENING_PORT=${TURN_LISTENING_PORT:-3478}
    case ${TURN_EXTERNAL_IP:-} in
      192.0.2.*|198.51.100.*|203.0.113.*|*/192.0.2.*|*/198.51.100.*|*/203.0.113.*)
        echo "TURN_EXTERNAL_IP still contains a documentation-only TEST-NET address: ${TURN_EXTERNAL_IP}" >&2
        exit 2
        ;;
    esac
    [[ $TURN_LISTENING_PORT =~ ^[0-9]+$ ]] &&
      (( TURN_LISTENING_PORT >= 1 && TURN_LISTENING_PORT <= 65535 )) || {
        echo "TURN_LISTENING_PORT must be an integer in 1..65535." >&2
        exit 2
      }
  fi
  if [[ "$RELAY_MODE" == local && "$TURN_MODE" == external ]]; then
    if [[ -z ${TURN_SHARED_SECRET:-} && ( -z ${TURN_USERNAME:-} || -z ${TURN_CREDENTIAL:-} ) ]]; then
      echo "External TURN requires TURN_SHARED_SECRET or TURN_USERNAME plus TURN_CREDENTIAL." >&2
      exit 2
    fi
  fi
}

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    echo "Run this command as root." >&2
    exit 2
  fi
}

validate_site_package() {
  local package_dir=${1:?site package path is required}
  python3 - "$package_dir" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
manifest_path = root / "deployment.json"
if not manifest_path.is_file():
    raise SystemExit(f"deployment.json not found in {root}")
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
if manifest.get("format") != "eagler-touhou-deployment/1" or not isinstance(manifest.get("files"), list):
    raise SystemExit("invalid deployment manifest")
declared = set()
for item in manifest["files"]:
    rel = item.get("path")
    if not isinstance(rel, str) or rel.startswith(("/", "\\")) or ".." in pathlib.PurePosixPath(rel).parts:
        raise SystemExit(f"unsafe deployment path: {rel!r}")
    path = (root / pathlib.PurePosixPath(rel)).resolve()
    if root not in path.parents or not path.is_file():
        raise SystemExit(f"deployment file missing: {rel}")
    if isinstance(item.get("bytes"), int) and path.stat().st_size != item["bytes"]:
        raise SystemExit(f"deployment file size mismatch: {rel}")
    declared.add(rel)
if "eagler-touhou/index.html" not in declared or "eagler-touhou/app.js" not in declared:
    raise SystemExit("Launcher entry files are absent from deployment.json")
actual = {
    p.relative_to(root).as_posix()
    for p in root.rglob("*") if p.is_file() and p != manifest_path
}
extra = sorted(actual - declared)
if extra:
    raise SystemExit("undeclared deployment files: " + ", ".join(extra[:10]))
print(json.dumps({"valid": True, "resourceMode": manifest.get("resourceMode", "hosted"), "files": len(declared)}))
PY
}
