#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server for Vibe Chat (run as root):
#   curl -fsSL <raw url>/deploy/scripts/setup-ubuntu.sh | bash -s -- app      # app node (nginx + api + worker + admin)
#   bash setup-ubuntu.sh data 10.0.0.0/24                                       # data node; arg 2 = private subnet of app nodes
#   bash setup-ubuntu.sh all                                                    # everything on one server
#
# What it does: Docker Engine + compose plugin, kernel/network tuning for many concurrent
# connections, swap, unattended security upgrades, and a firewall that lets HTTP(S) in only from
# Cloudflare (so nobody can bypass Cloudflare's protection by hitting the origin IP directly).
set -euo pipefail

ROLE="${1:-all}"
PRIVATE_SUBNET="${2:-}"

if [[ $EUID -ne 0 ]]; then echo "run as root"; exit 1; fi

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw unattended-upgrades fail2ban jq git

echo "==> docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" },
  "default-ulimits": { "nofile": { "Name": "nofile", "Soft": 65535, "Hard": 65535 } }
}
EOF
systemctl enable --now docker
systemctl restart docker

echo "==> kernel tuning (many sockets, fast reuse)"
cat > /etc/sysctl.d/90-vibechat.conf <<'EOF'
fs.file-max = 2000000
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 10240 65535
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_slow_start_after_idle = 0
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
vm.swappiness = 10
vm.overcommit_memory = 1
EOF
sysctl --system >/dev/null
cat > /etc/security/limits.d/90-vibechat.conf <<'EOF'
* soft nofile 1048576
* hard nofile 1048576
EOF
# Redis recommends this off
echo never > /sys/kernel/mm/transparent_hugepage/enabled || true

echo "==> swap (2 GB, only if none)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> firewall"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
if [[ "$ROLE" == "app" || "$ROLE" == "all" ]]; then
  # HTTP(S) only from Cloudflare edges
  for ip in $(curl -fsSL https://www.cloudflare.com/ips-v4) $(curl -fsSL https://www.cloudflare.com/ips-v6); do
    ufw allow proto tcp from "$ip" to any port 80,443 comment cloudflare
  done
fi
if [[ "$ROLE" == "data" && -n "$PRIVATE_SUBNET" ]]; then
  ufw allow proto tcp from "$PRIVATE_SUBNET" to any port 5432 comment postgres
  ufw allow proto tcp from "$PRIVATE_SUBNET" to any port 6379 comment redis
fi
ufw --force enable
# Docker publishes ports through iptables and bypasses ufw; the compose file binds Postgres/Redis
# to DATA_BIND_IP (127.0.0.1 by default) so they are never exposed on the public interface.

mkdir -p /opt/vibechat
echo
echo "Done. Next (docs/DEPLOYMENT.md has the details):"
echo "  cd /opt/vibechat/deploy"
echo "  put the Cloudflare Origin Certificate in certs/origin.pem and certs/origin.key"
echo "  cp .env.example .env && nano .env"
case "$ROLE" in
  all)  echo "  docker compose --profile data --profile app --profile minio up -d --build" ;;
  app)  echo "  docker compose --profile app up -d --build" ;;
  data) echo "  docker compose --profile data up -d   (set DATA_BIND_IP to this server's private IP)" ;;
esac
