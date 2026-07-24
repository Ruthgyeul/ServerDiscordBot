#!/usr/bin/env bash
#
# Convenience installer for ServerDiscordBot.
# Idempotent-ish helper that installs deps, registers the systemd unit and
# (optionally) the sudoers rule. Review it before running — it uses sudo.
#
# Usage:  sudo ./deploy/install.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/serverdiscordbot}"
SERVICE_USER="${SERVICE_USER:-botuser}"
UNIT_NAME="serverdiscordbot"

echo "==> ServerDiscordBot installer"
echo "    App dir:      ${APP_DIR}"
echo "    Service user: ${SERVICE_USER}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

# 1. Create a dedicated system user if missing.
if ! id "${SERVICE_USER}" &>/dev/null; then
  echo "==> Creating system user ${SERVICE_USER}"
  useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

# 2. Install Node dependencies (production only).
echo "==> Installing npm dependencies"
sudo -u "${SERVICE_USER}" -H bash -c "cd '${APP_DIR}' && npm ci --omit=dev"

# 3. Require a .env before enabling the service.
if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "!! ${APP_DIR}/.env not found. Copy .env.example to .env and fill it in, then re-run." >&2
  exit 1
fi

# 4. Install the systemd unit.
echo "==> Installing systemd unit"
install -m 0644 "${APP_DIR}/deploy/${UNIT_NAME}.service" "/etc/systemd/system/${UNIT_NAME}.service"
systemctl daemon-reload

# 5. Optional: install the scoped sudoers rule.
read -r -p "Install scoped sudoers rule (systemctl/journalctl NOPASSWD)? [y/N] " reply
if [[ "${reply}" =~ ^[Yy]$ ]]; then
  install -m 0440 "${APP_DIR}/deploy/${UNIT_NAME}.sudoers" "/etc/sudoers.d/${UNIT_NAME}"
  visudo -c
fi

# 6. Register slash commands, then enable + start.
echo "==> Registering slash commands"
sudo -u "${SERVICE_USER}" -H bash -c "cd '${APP_DIR}' && npm run deploy"

echo "==> Enabling and starting service"
systemctl enable --now "${UNIT_NAME}"
systemctl --no-pager status "${UNIT_NAME}" || true

echo "==> Done. Tail logs with: journalctl -u ${UNIT_NAME} -f"
