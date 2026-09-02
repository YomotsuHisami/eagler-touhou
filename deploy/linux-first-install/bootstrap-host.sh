#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
require_root
CONFIG_PATH=${1:?usage: bootstrap-host.sh CONFIG SITE_PACKAGE}
SITE_PACKAGE=${2:?usage: bootstrap-host.sh CONFIG SITE_PACKAGE}
load_config "$CONFIG_PATH"

if [[ ${INSTALL_OS_PACKAGES:-1} == 1 ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  packages=(nginx rsync curl python3 ca-certificates)
  if [[ "$RELAY_MODE" == local ]]; then packages+=(xz-utils openssl); fi
  if [[ "$TURN_MODE" == local ]]; then packages+=(coturn); fi
  apt-get install -y --no-install-recommends "${packages[@]}"
fi
for command in nginx rsync curl python3; do command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 2; }; done

install -d -m 0755 "$SITE_ROOT/releases"
install -d -m 0755 /etc/eagler-touhou
install -m 0600 "$CONFIG_PATH" "/etc/eagler-touhou/$SITE_CONFIG_NAME.env"

if [[ "$RELAY_MODE" == disabled ]]; then
  relay_location='    location /eagler-netplay/ { return 404; }'
else
  : "${RELAY_UPSTREAM:?RELAY_UPSTREAM is required when relay is enabled}"
  relay_proxy_upstream=$RELAY_UPSTREAM
  case "$relay_proxy_upstream" in
    ws://*) relay_proxy_upstream="http://${relay_proxy_upstream#ws://}" ;;
    wss://*) relay_proxy_upstream="https://${relay_proxy_upstream#wss://}" ;;
  esac
  relay_location=$(cat <<EOF
    location /eagler-netplay/ {
        proxy_pass $relay_proxy_upstream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_ssl_server_name on;
        proxy_ssl_name \$proxy_host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
EOF
)
fi

map_id=$MIGRATION_MAP_ID
python3 - "$SCRIPT_DIR/nginx-site.conf.template" "/etc/nginx/sites-available/$SITE_CONFIG_NAME" \
  "$ORIGIN_LISTEN" "$SITE_HOST" "$SITE_ROOT/current" "$relay_location" "$map_id" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
replacements = {
    '@@ORIGIN_LISTEN@@': sys.argv[3],
    '@@SITE_HOST@@': sys.argv[4],
    '@@CURRENT_ROOT@@': sys.argv[5],
    '@@RELAY_LOCATION@@': sys.argv[6],
    '@@MAP_ID@@': sys.argv[7],
}
for key, value in replacements.items(): source = source.replace(key, value)
pathlib.Path(sys.argv[2]).write_text(source)
PY
python3 - "$SCRIPT_DIR/nginx-http-migration-map.conf.template" "/etc/nginx/conf.d/$SITE_CONFIG_NAME-migration-map.conf" "$map_id" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text().replace('@@MAP_ID@@', sys.argv[3])
pathlib.Path(sys.argv[2]).write_text(source)
PY

ln -sfn "/etc/nginx/sites-available/$SITE_CONFIG_NAME" "/etc/nginx/sites-enabled/$SITE_CONFIG_NAME"
if [[ ${DISABLE_DEFAULT_NGINX_SITE:-0} == 1 ]]; then rm -f /etc/nginx/sites-enabled/default; fi

if [[ "$RELAY_MODE" == local ]]; then
  node_archive="$SCRIPT_DIR/../runtime/node-linux-x64.tar.xz"
  [[ -f "$node_archive" ]] || { echo "Bundled Linux Node runtime is missing: $node_archive" >&2; exit 2; }
  id eaglernet >/dev/null 2>&1 || useradd --system --home /nonexistent --shell /usr/sbin/nologin eaglernet
  install -d -o root -g root -m 0755 /opt/eagler-netplay/app /opt/eagler-netplay/runtime /etc/eagler-netplay
  install -d -o eaglernet -g eaglernet -m 0750 /var/log/eagler-netplay
  node_stage=/opt/eagler-netplay/runtime/node.staging
  rm -rf -- "$node_stage"
  install -d -m 0755 "$node_stage"
  tar -xJf "$node_archive" --strip-components=1 -C "$node_stage"
  "$node_stage/bin/node" -e 'const major=Number(process.versions.node.split(".")[0]); if(major<22) process.exit(1)'
  if [[ -d /opt/eagler-netplay/runtime/node ]]; then
    rm -rf -- /opt/eagler-netplay/runtime/node.previous
    mv -- /opt/eagler-netplay/runtime/node /opt/eagler-netplay/runtime/node.previous
  fi
  mv -- "$node_stage" /opt/eagler-netplay/runtime/node
  node_bin=/opt/eagler-netplay/runtime/node/bin/node
  install -m 0644 "$SCRIPT_DIR/../relay/lan-relay.cjs" /opt/eagler-netplay/app/lan-relay.cjs
  install -d -m 0755 /opt/eagler-netplay/app/node_modules
  rm -rf -- /opt/eagler-netplay/app/node_modules/ws
  cp -a -- "$SCRIPT_DIR/../relay/node_modules/ws" /opt/eagler-netplay/app/node_modules/ws
  secret=${TURN_SHARED_SECRET:-}
  if [[ "$TURN_MODE" == local && -z "$secret" ]]; then
    if [[ -s /etc/eagler-netplay/turn-secret ]]; then secret=$(cat /etc/eagler-netplay/turn-secret); else secret=$(openssl rand -hex 32); fi
    printf '%s' "$secret" > /etc/eagler-netplay/turn-secret
    chmod 0600 /etc/eagler-netplay/turn-secret
  fi
  turn_urls_for_relay=""
  if [[ "$TURN_MODE" != disabled ]]; then turn_urls_for_relay=${TURN_URLS:-}; fi
  umask 077
  cat > /etc/eagler-netplay/netplay.env <<EOF
TH07_RELAY_HOST=${RELAY_LISTEN_HOST:-127.0.0.1}
TH07_RELAY_PORT=${RELAY_LISTEN_PORT:-18142}
TH07_RTC_TIMEOUT_MS=4500
TH07_STUN_URLS=${STUN_URLS:-stun:stun.cloudflare.com:3478}
TH07_TURN_URLS=$turn_urls_for_relay
TH07_TURN_SHARED_SECRET=$secret
TH07_TURN_USERNAME=${TURN_USERNAME:-}
TH07_TURN_CREDENTIAL=${TURN_CREDENTIAL:-}
TH07_TURN_TTL_SECONDS=3600
TH07_TURN_REALM=${TURN_REALM:-eagler-touhou}
TH07_TURN_LISTENING_PORT=${TURN_LISTENING_PORT:-3478}
TH07_TURN_LISTENING_IP=${TURN_LISTENING_IP:-0.0.0.0}
TH07_TURN_RELAY_IP=${TURN_RELAY_IP:-0.0.0.0}
TH07_TURN_EXTERNAL_IP=${TURN_EXTERNAL_IP:-}
TH07_TURN_MIN_PORT=${TURN_MIN_PORT:-49160}
TH07_TURN_MAX_PORT=${TURN_MAX_PORT:-49559}
TH07_TURN_USER_QUOTA=12
TH07_TURN_TOTAL_QUOTA=256
TH07_TURN_MAX_BPS=131072
TH07_TURN_BPS_CAPACITY=786432
EOF
  install -m 0644 "$SCRIPT_DIR/eagler-netplay.service" /etc/systemd/system/eagler-netplay.service
  systemctl daemon-reload
  systemctl enable eagler-netplay.service
  systemctl restart eagler-netplay.service
fi

if [[ "$TURN_MODE" == local ]]; then
  [[ "$RELAY_MODE" == local ]] || { echo "Local TURN requires local relay for REST credential issuance." >&2; exit 2; }
  install -m 0644 "$SCRIPT_DIR/../relay/render-coturn-config.cjs" /opt/eagler-netplay/app/render-coturn-config.cjs
  set -a
  # shellcheck disable=SC1091
  source /etc/eagler-netplay/netplay.env
  set +a
  "$node_bin" /opt/eagler-netplay/app/render-coturn-config.cjs --output /etc/turnserver.conf
  if grep -qE '^#?TURNSERVER_ENABLED=' /etc/default/coturn 2>/dev/null; then
    sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  else
    printf '\nTURNSERVER_ENABLED=1\n' >> /etc/default/coturn
  fi
  systemctl enable coturn.service
  systemctl restart coturn.service
fi

bash "$SCRIPT_DIR/deploy-release.sh" "$CONFIG_PATH" "$SITE_PACKAGE" first-$(date -u +%Y%m%dT%H%M%SZ)
echo "Host bootstrap complete. Run verify-host.sh next."
