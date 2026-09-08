# CUBRID `test_shell` queue

A small internal dashboard that estimates the shared CircleCI `test_shell`
queue for `CUBRID/cubrid`.

It uses CircleCI's public v1.1 project API and GitHub's public REST API. No
token or login is required. Queue positions are estimates because CircleCI
does not publish the self-hosted runner's canonical task order.

Each entry shows the PR title and GitHub author when GitHub metadata is
available, plus the commit message reported by CircleCI. GitHub metadata is
cached for 10 minutes to stay within anonymous API limits. `GITHUB_TOKEN` can
optionally be set to use a higher GitHub API rate limit.

## Run

Requires Node.js 20 or newer. On the Linux server, run:

```sh
just start
```

Open <http://192.168.4.2:4173> from another machine on the same network.

`just start` only lives as long as its terminal. To keep the site running
across logouts, crashes, and reboots, install it as a systemd user service:

```sh
just install-service
just service-status
```

Without login lingering, user services stop when the last session ends and
do not start at boot. Enable lingering once with
`sudo loginctl enable-linger $USER`. `just uninstall-service` removes the
service again.

For localhost-only access:

```sh
just local
```

## CLI for agents

Print the same live queue snapshot as machine-readable JSON without starting
the website:

```sh
just queue
```

Queue entries include `position`, `estimatedStartAt`, `estimatedFinishAt`, and
the derived `estimatedWaitSeconds`. All CLI timestamps contain explicit `utc`,
`kst`, and `epochSeconds` representations. To return only one PR's current
state and entry, pass its number:

```sh
just queue 7588
```

The focused response has a stable `state` of `running`, `queued`, `preparing`,
`finished`, `attention`, or `not_found`. `npm run queue -- --pr 7588` and
`node queue.mjs --pr=7588` are equivalent forms.

For a compact response containing only one PR's estimated queue timing, use:

```sh
just eta 7588
```

This returns `state`, `position`, `estimatedWaitSeconds`, `estimatedStart`,
`estimatedFinish`, and estimate `confidence` as JSON. Every timestamp contains
an explicit UTC value, Korean time with a `+09:00` offset, and Unix epoch
seconds, so consumers never need to infer a timezone. `npm run eta -- 7588` is
equivalent.

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

The dashboard reads ten pages of CircleCI builds and displays up to 24
recently finished shell workflows.

## Estimation model

- Groups `download-build` and `test_shell` jobs by CircleCI workflow.
- Treats `download-build` as a prerequisite task on the shared
  `cubrid/ramdisk` resource class.
- Simulates ready tasks in observed queue/readiness order.
- Uses recent median durations for build preparation and `test_shell`.
- Excludes jobs that have reported `running` for more than three hours from
  ETA calculations and lists them under **Needs attention**.

## Troubleshooting

**The page shows "Could not refresh the queue. fetch failed"** and the CLI
prints `fetch failed`. Node's `fetch` reports this when a connection to
`circleci.com` or `api.github.com` could not be made. On this network the
usual cause is a dropped DNS reply: glibc waits 5 seconds before retrying a
lookup, and two drops in a row exceed Node's 10 second connect timeout. The
clients now retry each request up to three times and fetch at most four
CircleCI pages at once, so a single stall no longer fails a refresh. If it
still happens often, check `/etc/resolv.conf`; `options timeout:2 attempts:3`
shortens the resolver's wait.

**Nothing answers on port 4173.** The server process is not running. Check
`just service-status`, or start it with `just start`.
