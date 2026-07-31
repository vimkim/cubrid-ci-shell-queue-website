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
the derived `estimatedWaitSeconds`. To return only one PR's current state and
entry, pass its number:

```sh
just queue 7588
```

The focused response has a stable `state` of `running`, `queued`, `preparing`,
`finished`, `attention`, or `not_found`. `npm run queue -- --pr 7588` and
`node queue.mjs --pr=7588` are equivalent forms.

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
