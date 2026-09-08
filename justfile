set dotenv-load := true

host := env_var_or_default("HOST", "0.0.0.0")
port := env_var_or_default("PORT", "4173")
lan_ip := env_var_or_default("LAN_IP", "192.168.4.2")

# List the available local convenience commands
default:
  @just --list

# Start for other machines on the LAN
start:
  @echo "Open http://{{lan_ip}}:{{port}}"
  HOST="{{host}}" PORT="{{port}}" npm start

# Start for this machine only
local:
  @echo "Open http://127.0.0.1:{{port}}"
  HOST="127.0.0.1" PORT="{{port}}" npm start

# Start on the LAN and restart when source files change
dev:
  @echo "Open http://{{lan_ip}}:{{port}}"
  HOST="{{host}}" PORT="{{port}}" npm run dev

# Print the live queue as JSON; optionally focus on one PR number
queue pr="":
  @node queue.mjs {{pr}}

# Print only one PR's estimated queue timing as JSON
eta pr:
  @node queue.mjs --eta "{{pr}}"

# Install, enable, and start a systemd user service that keeps the site running
install-service:
  mkdir -p ~/.config/systemd/user
  printf '%s\n' \
    '[Unit]' \
    'Description=CUBRID test_shell queue dashboard' \
    'After=network-online.target' \
    'Wants=network-online.target' \
    '' \
    '[Service]' \
    'WorkingDirectory={{justfile_directory()}}' \
    'Environment=HOST={{host}} PORT={{port}}' \
    'EnvironmentFile=-{{justfile_directory()}}/.env' \
    'ExecStart={{require("node")}} server.mjs' \
    'Restart=always' \
    'RestartSec=5' \
    '' \
    '[Install]' \
    'WantedBy=default.target' \
    > ~/.config/systemd/user/cubrid-shell-queue.service
  systemctl --user daemon-reload
  systemctl --user enable --now cubrid-shell-queue.service
  @echo "Open http://{{lan_ip}}:{{port}}"
  @echo "To start at boot without a login session: sudo loginctl enable-linger $USER"

# Show the systemd user service state and its recent log lines
service-status:
  systemctl --user status cubrid-shell-queue.service --no-pager || true
  journalctl --user -u cubrid-shell-queue.service -n 20 --no-pager

# Stop, disable, and remove the systemd user service
uninstall-service:
  systemctl --user disable --now cubrid-shell-queue.service || true
  rm -f ~/.config/systemd/user/cubrid-shell-queue.service
  systemctl --user daemon-reload

# Run the automated tests
test:
  npm test

# Check JavaScript syntax and run all tests
check:
  node --check server.mjs
  node --check queue.mjs
  node --check src/cli.js
  node --check src/circleci.js
  node --check src/github.js
  node --check src/live-queue.js
  node --check src/queue.js
  node --check src/resilient-fetch.js
  node --check public/app.js
  npm test
