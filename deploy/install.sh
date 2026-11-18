#!/usr/bin/env bash
# Vibe Chat — install, or update, on a fresh Ubuntu 24.04 server. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/miladgiotin074/vibechat/main/deploy/install.sh | bash
#
# The first run prepares the server (Docker, tuning, a firewall that only lets Cloudflare in), asks
# a few questions (domain, bot token, ...), generates every secret, takes the Cloudflare Origin
# Certificate, builds and starts everything, and prints what is left to do.
# Running the same command again updates to the latest code and keeps settings, secrets and data.
#
# Options (as environment variables):
#   REPO_URL / BRANCH / DIR    where the code comes from and where it goes (/opt/vibechat)
#   RECONFIGURE=1              ask the questions again (secrets and data are kept)
#   Non-interactive first install: set DOMAIN, BOT_TOKEN (and optionally PREFIX,
#   ADMIN_USERNAME, ADMIN_PASSWORD) and put the certificate files in place first.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/miladgiotin074/vibechat.git}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/vibechat}"
MARKER=/etc/vibechat/server-ready

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Questions go to the terminal even when the script itself comes through a pipe (curl | bash).
TTY=/dev/tty
have_tty() { [[ -r $TTY && -w $TTY ]] && { : <"$TTY"; } 2>/dev/null; }
ask() { # ask <var> <question> [default]
  local __var=$1 q=$2 def=${3:-} ans
  if [[ -n ${!__var:-} ]]; then return; fi
  have_tty || die "$__var is needed: run interactively, or set $__var=..."
  if [[ -n $def ]]; then printf '%s [%s]: ' "$q" "$def" >"$TTY"; else printf '%s: ' "$q" >"$TTY"; fi
  IFS= read -r ans <"$TTY" || true
  printf -v "$__var" '%s' "${ans:-$def}"
}
ask_secret() { # ask_secret <var> <question>   (input not shown)
  local __var=$1 q=$2 ans
  if [[ -n ${!__var:-} ]]; then return; fi
  have_tty || die "$__var is needed: run interactively, or set $__var=..."
  printf '%s: ' "$q" >"$TTY"
  IFS= read -rs ans <"$TTY" || true
  printf '\n' >"$TTY"
  printf -v "$__var" '%s' "$ans"
}
rand() { openssl rand -hex "${1:-32}"; }

# Everything runs inside main(), called on the last line: bash reads the whole script before running
# any of it, so nothing (apt, docker) can swallow the rest of it from the curl pipe.
main() {

[[ $EUID -eq 0 ]] || die "run as root (sudo -i first)"
. /etc/os-release
[[ ${ID:-} == ubuntu ]] || warn "made for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}"

# ------------------------------------------------------------------------------------ code
step "code"
export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null && command -v curl >/dev/null && command -v openssl >/dev/null || {
  apt-get update -y >/dev/null
  apt-get install -y git curl openssl ca-certificates >/dev/null
}
if [[ -d $DIR/.git ]]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" pull --quiet --ff-only origin "$BRANCH" ||
    die "local changes in $DIR block the update; look at them with: git -C $DIR status"
  ok "updated to $(git -C "$DIR" log -1 --format='%h %s')"
elif [[ -e $DIR && -n $(ls -A "$DIR" 2>/dev/null) ]]; then
  die "$DIR exists and isn't a git checkout; move it away (keep deploy/.env and deploy/certs) and run again"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$DIR"
  ok "downloaded to $DIR"
fi
cd "$DIR/deploy"

# ------------------------------------------------------------------------------------ server
if [[ ! -f $MARKER ]]; then
  step "preparing the server (Docker, tuning, firewall) — once"
  bash ./scripts/setup-ubuntu.sh all
  mkdir -p "$(dirname "$MARKER")" && date -u +%FT%TZ >"$MARKER"
else
  ok "server already prepared ($(cat "$MARKER"))"
fi
command -v docker >/dev/null || die "docker is missing; remove $MARKER and run again"

# ------------------------------------------------------------------------------------ settings
# set_env KEY VALUE: writes KEY=VALUE into .env (replacing the line), safe for any characters.
set_env() {
  KEY=$1 VALUE=$2 awk 'BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    index($0, k "=") == 1 { if (!done) { print k "=" v; done = 1 }; next }
    { print }
    END { if (!done) print k "=" v }' .env >.env.tmp && mv .env.tmp .env
}
get_env() { { grep -E "^$1=" .env 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }

if [[ ! -f .env || ${RECONFIGURE:-0} == 1 ]]; then
  step "settings"
  [[ -f .env ]] || { cp .env.example .env; FRESH=1; }
  chmod 600 .env
  bold "The app gets four addresses, one level under your domain (Cloudflare's certificate covers *.domain):"
  ask DOMAIN "Your domain on Cloudflare (e.g. example.com)" "$(get_env APP_DOMAIN | sed -E 's/^[^.]+\.//; /example\.com/d')"
  DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%/}
  [[ $DOMAIN =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "«$DOMAIN» doesn't look like a domain"
  ask PREFIX "Name in front of it" "vibe"
  APP=$PREFIX.$DOMAIN API=$PREFIX-api.$DOMAIN ADMIN=$PREFIX-admin.$DOMAIN MEDIA=$PREFIX-media.$DOMAIN
  printf '  mini app  https://%s\n  api       https://%s\n  admin     https://%s\n  photos    https://%s\n' "$APP" "$API" "$ADMIN" "$MEDIA"

  ask_secret BOT_TOKEN "Bot token from @BotFather$([[ -n $(get_env BOT_TOKEN) ]] && echo " (Enter to keep the current one)")"
  [[ -z $BOT_TOKEN ]] && BOT_TOKEN=$(get_env BOT_TOKEN)
  [[ $BOT_TOKEN =~ ^[0-9]{5,}:[A-Za-z0-9_-]{30,}$ ]] || die "that isn't a bot token"
  BOT_USERNAME=$(curl -fsS --max-time 15 "https://api.telegram.org/bot${BOT_TOKEN}/getMe" 2>/dev/null |
    sed -nE 's/.*"username":"([^"]+)".*/\1/p') || true
  if [[ -n $BOT_USERNAME ]]; then ok "bot: @$BOT_USERNAME"; else
    warn "couldn't reach Telegram to check the token"
    ask BOT_USERNAME "Bot username (without @)"
  fi
  ask ADMIN_USERNAME "Admin panel username" "admin"
  if [[ -z ${ADMIN_PASSWORD:-} && ${FRESH:-0} == 1 ]]; then ADMIN_PASSWORD=$(rand 9); GENERATED_ADMIN=1; fi

  set_env APP_DOMAIN "$APP"; set_env API_DOMAIN "$API"; set_env ADMIN_DOMAIN "$ADMIN"; set_env MEDIA_DOMAIN "$MEDIA"
  set_env PUBLIC_BASE_URL "https://$API"
  set_env CORS_ORIGINS "https://$APP,https://$ADMIN"
  set_env MINIAPP_URL "https://$APP"
  set_env BOT_TOKEN "$BOT_TOKEN"; set_env BOT_USERNAME "$BOT_USERNAME"
  set_env BOT_MODE webhook
  set_env ADMIN_BOOTSTRAP_USERNAME "$ADMIN_USERNAME"
  [[ -n ${ADMIN_PASSWORD:-} ]] && set_env ADMIN_BOOTSTRAP_PASSWORD "$ADMIN_PASSWORD"
  # photos on this server, served on the media address
  if [[ $(get_env STORAGE_DRIVER) == local ]]; then set_env MEDIA_PUBLIC_URL "https://$MEDIA"; fi
  ok "saved in $DIR/deploy/.env"
fi

# Settings written by an older version of this script used the bundled MinIO, which is no longer
# published: move them to photos on this server's disk (nothing was stored there yet).
if [[ $(get_env S3_ENDPOINT) == http://minio:9000 ]]; then
  set_env STORAGE_DRIVER local
  set_env MEDIA_PUBLIC_URL "https://$(get_env MEDIA_DOMAIN)"
  sed -i -E '/^S3_(ENDPOINT|REGION|BUCKET|ACCESS_KEY|SECRET_KEY|FORCE_PATH_STYLE)=/d' .env
  ok "photos are now stored on this server (MinIO is gone)"
fi

# Secrets: generated once, never replaced (changing them would log everyone out or lock the data).
for key in JWT_SECRET ADMIN_JWT_SECRET BOT_WEBHOOK_SECRET POSTGRES_PASSWORD REDIS_PASSWORD; do
  v=$(get_env $key)
  if [[ -z $v || $v == change-me* ]]; then set_env $key "$(rand 32)"; fi
done
if [[ -z $(get_env ADMIN_BOOTSTRAP_PASSWORD) || $(get_env ADMIN_BOOTSTRAP_PASSWORD) == change-me ]]; then
  ADMIN_PASSWORD=$(rand 9); GENERATED_ADMIN=1; set_env ADMIN_BOOTSTRAP_PASSWORD "$ADMIN_PASSWORD"
fi
[[ $(get_env BOT_TOKEN) ]] || die "BOT_TOKEN is empty in .env; run again with RECONFIGURE=1"
chmod 600 .env

# ------------------------------------------------------------------------------------ certificate
read_pem() { # read_pem <file> <end marker>
  local file=$1 end=$2 line
  : >"$file"
  while IFS= read -r line <"$TTY"; do
    printf '%s\n' "$line" >>"$file"
    [[ $line == *"$end"* ]] && break
  done
}
if [[ ! -s certs/origin.pem || ! -s certs/origin.key ]]; then
  step "Cloudflare Origin Certificate"
  have_tty || die "put the certificate in $DIR/deploy/certs/origin.pem and origin.key, then run again"
  cat >"$TTY" <<'EOF'
Cloudflare → SSL/TLS → Origin Server → Create Certificate (RSA, for "domain" and "*.domain").
Paste the «Origin Certificate» below (all of it, from -----BEGIN to -----END), then press Enter:
EOF
  read_pem certs/origin.pem "-----END CERTIFICATE-----"
  openssl x509 -noout -in certs/origin.pem 2>/dev/null || { rm -f certs/origin.pem; die "that isn't a certificate; run again"; }
  printf 'Now paste the «Private Key»:\n' >"$TTY"
  read_pem certs/origin.key "-----END PRIVATE KEY-----"
  openssl pkey -noout -in certs/origin.key 2>/dev/null || { rm -f certs/origin.key; die "that isn't a private key; run again"; }
  [[ $(openssl x509 -noout -pubkey -in certs/origin.pem | openssl sha256) == $(openssl pkey -pubout -in certs/origin.key | openssl sha256) ]] ||
    { rm -f certs/origin.pem certs/origin.key; die "the key doesn't belong to the certificate; run again"; }
  chmod 600 certs/origin.key
  ok "certificate saved (valid until $(openssl x509 -noout -enddate -in certs/origin.pem | cut -d= -f2))"
fi

# ------------------------------------------------------------------------------------ start
PROFILES=(--profile data --profile app)
step "building and starting (the first time takes a few minutes)"
# a slow first start makes «up» give up on the worker (it waits for a healthy API): the loop below
# waits longer and a second «up» starts whatever is left
docker compose "${PROFILES[@]}" up -d --build --remove-orphans || warn "not everything is up yet; waiting"
docker image prune -f >/dev/null 2>&1 || true

printf 'waiting for the API'
for _ in $(seq 1 120); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose "${PROFILES[@]}" ps -q api | head -1)" 2>/dev/null || echo starting)
  [[ $state == healthy ]] && break
  printf '.'; sleep 2
done
printf '\n'
if [[ ${state:-} != healthy ]]; then
  docker compose "${PROFILES[@]}" logs --tail 60 api || true
  die "the API didn't start; the log above says why. Send it, or look again with: cd $DIR/deploy && docker compose logs api"
fi
docker compose "${PROFILES[@]}" up -d >/dev/null
ok "everything is running"

# nightly database backup, once
if ! crontab -l 2>/dev/null | grep -q 'vibechat/deploy/scripts/backup.sh'; then
  (crontab -l 2>/dev/null; echo "0 3 * * * $DIR/deploy/scripts/backup.sh >> /var/log/vibechat-backup.log 2>&1") | crontab -
  ok "nightly database backup at 03:00 (kept 14 days in /var/backups/vibechat)"
fi

# ------------------------------------------------------------------------------------ what's left
APP=$(get_env APP_DOMAIN) API=$(get_env API_DOMAIN) ADMIN=$(get_env ADMIN_DOMAIN) MEDIA=$(get_env MEDIA_DOMAIN)
IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
step "done"
cat <<EOF

  mini app   https://$APP
  admin      https://$ADMIN      user: $(get_env ADMIN_BOOTSTRAP_USERNAME)
EOF
[[ ${GENERATED_ADMIN:-0} == 1 ]] && printf '             password: %s   (write it down; change it after the first login)\n' "$(get_env ADMIN_BOOTSTRAP_PASSWORD)"
cat <<EOF
  health     https://$API/health

If this was the first install:
  1. Cloudflare DNS: A records, proxied (orange cloud), all to $IP:
       ${APP%%.*}   ${API%%.*}   ${ADMIN%%.*}   ${MEDIA%%.*}
     SSL/TLS mode: Full (strict).  Network: WebSockets on.
  2. @BotFather: /mybots → your bot → Bot Settings → Configure Mini App → https://$APP
     (the bot's Main Mini App: every button in the bot's messages opens it)
     /setjoingroups → Enable (so the bot can be added to the Wall group and channels)
  3. Make the bot an admin of the Wall group, then Admin panel → Settings → Wall: pick the group, add its link.
     Without it, inviting friends is hidden in the app.

Update later: run the same install command again.
Logs: cd $DIR/deploy && docker compose logs -f api worker
EOF
}

main "$@" </dev/null
