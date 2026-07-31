# CUBRID `test_shell` queue

A small internal dashboard that estimates the shared CircleCI `test_shell`
queue for `CUBRID/cubrid`.

It uses CircleCI's public v1.1 project API. No CircleCI token, GitHub token, or
login is required. Queue positions are estimates because CircleCI does not
publish the self-hosted runner's canonical task order.

## Run

Requires Node.js 20 or newer. On the Linux server, run:

```sh
just start
```

Open <http://192.168.4.2:4173> from another machine on the same network.

For localhost-only access:

```sh
just local
```

## Development

```sh
just dev
just test
just check
```

Run `just` to list the available commands. `HOST`, `PORT`, and `LAN_IP` can be
overridden as environment variables when needed.

The dashboard refreshes every 30 seconds. The local server caches CircleCI
responses for 30 seconds and falls back to the last successful snapshot if a
refresh fails.

## Estimation model

- Groups `download-build` and `test_shell` jobs by CircleCI workflow.
- Treats `download-build` as a prerequisite task on the shared
  `cubrid/ramdisk` resource class.
- Simulates ready tasks in observed queue/readiness order.
- Uses recent median durations for build preparation and `test_shell`.
- Excludes jobs that have reported `running` for more than three hours from
  ETA calculations and lists them under **Needs attention**.
