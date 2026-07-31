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
  node --check public/app.js
  npm test
