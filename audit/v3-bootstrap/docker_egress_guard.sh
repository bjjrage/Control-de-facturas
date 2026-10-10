#!/usr/bin/env bash
# Fail-closed outbound restrictions for ephemeral Docker containers.
# Runs ONLY on dedicated GitHub-hosted Ubuntu runners. Does not change production.
set -euo pipefail
: "${1:?Pass evidence directory}"
EVIDENCE="$1"
mkdir -p "$EVIDENCE"
[[ "${GITHUB_ACTIONS:-}" == "true" && "${RUNNER_OS:-}" == "Linux" ]] || {
  echo "Docker firewall requires Github Actions Linux runner" >&2; exit 4;
}
command -v docker >/dev/null
command -v sudo >/dev/null
docker info >/dev/null 2>&1 || { echo "Docker daemon unavailable" >&2; exit 4; }
if [[ "$(docker network inspect bridge --format '{{.EnableIPv6}}')" != "false" ]]; then
  echo "Default Docker bridge has IPv6 enabled: fail closed" >&2
  exit 4
fi
sudo -n iptables -S DOCKER-USER >/dev/null || {
  echo "DOCKER-USER chain is unavailable; cannot attest Docker egress controls" >&2; exit 4;
}
# Deny new container connections outside Docker private IP range. Supabase containers
# communicate through Docker-private addresses. Public registry/image downloads happen
# from host Docker daemon, not via containers.
for subnet in 172.16.0.0/12 192.168.0.0/16 10.0.0.0/8; do
  sudo -n iptables -I DOCKER-USER 1 -s "$subnet" -m conntrack --ctstate NEW ! -d "$subnet" -j REJECT
done
# Fail closed if a rule cannot be read back.
for subnet in 172.16.0.0/12 192.168.0.0/16 10.0.0.0/8; do
  sudo -n iptables -C DOCKER-USER -s "$subnet" -m conntrack --ctstate NEW ! -d "$subnet" -j REJECT
done
{
  echo "DOCKER_EGRESS_GUARD=INSTALLED"
  echo "DEFAULT_BRIDGE_IPV6=DISABLED"
  echo "HOST_FIREWALL_SCOPE=DOCKER-USER"
  echo "NOTE=No application or source-supplied process receives production credentials."
  echo "NOTE=This restricts Docker-originated egress; npm dependency fetch is from a clean host environment."
  sudo -n iptables -S DOCKER-USER | head -n 25
} > "$EVIDENCE/DOCKER_EGRESS_GUARD.txt"
echo "DOCKER_EGRESS_GUARD=PASS"
