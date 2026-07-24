# ServerDiscordBot

A Discord bot for managing a Linux host, its **systemd services** (websites and
other apps), and the **websites** it serves — all from Discord. Written in
**TypeScript** on Node.js + [discord.js](https://discord.js.org), compiled with
`tsc`.

## What it does

- **📊 Host monitoring** — CPU, memory, swap, disk usage, uptime and pending
  reboots at a glance (`/status`, with trends against the last hour), the
  heaviest processes (`/top`), and interfaces / listening ports (`/net`).
- **⚙️ Service control** — start / stop / restart / enable / disable / inspect
  the systemd units you register, plus tail their journal logs and list every
  failed unit on the host (`/service …`). Only units on your configured
  allowlist can be _controlled_; the failed-unit view is read-only and covers
  the whole machine, so breakage in something you forgot to register still
  shows up.
- **🌐 Website health checks** — HTTP status, latency, uptime percentage and
  **TLS certificate expiry** for the sites you host (`/sites`).
- **▶️ Allowlisted commands** — expose the shell commands you keep SSHing in to
  run (`/run`), defined in config, executed without a shell.
- **📄 Allowlisted files** — tail nginx logs or any other file you list
  (`/file`), with an optional text filter.
- **🚨 Automated alerts** — a background monitor watches resource thresholds,
  service state, website availability and certificate expiry, and posts to an
  alert channel when something breaks (and again when it recovers), with
  cooldowns to avoid spam. Inspect, test and mute it with `/alerts`.
- **♻️ Hot reload** — `/config reload` re-reads `.env` and `config.json` live,
  and `disabledCommands` switches a command off without a redeploy.
- **🟢 Health at a glance** — with `BOT_DYNAMIC_PRESENCE`, the bot's activity
  text carries a live health summary, so a problem is visible in the member
  list without anyone running a command.
- **🛡️ Guardrails** — stopping a service marked `critical`, or running a command
  marked `confirm`, requires a button confirmation. Every privileged action is
  written to the journal and, optionally, mirrored to an audit channel.

## Design principles

- **One place to change things.** `.env` holds the bot's identity, secrets and
  host-access mode; `config.json` holds everything about the server —
  services, websites, commands, files, thresholds. Adding a capability is a
  config edit, not a code change.
- **Extensible** — drop a new file in `src/commands/<category>/` or
  `src/events/` and it is auto-loaded. No central registry to edit.
- **Safe by default** — host commands run via `execFile` (no shell, no
  injection) and only against config-defined allowlists. Privileged commands
  require an admin user/role that you configure explicitly.
- **Fails closed, never fatally** — a malformed config entry is dropped and
  reported (`/config issues`) rather than half-loaded or crashing the bot.
- **Readable** — small, single-purpose modules with a clear service/command
  split and dependency-injected context instead of globals.
- **Operable** — structured JSON logs to stdout, graceful shutdown on SIGTERM
  (with a startup/shutdown notice), so any process supervisor can manage it.
- **Tested where it counts** — the config validators and argument parsing are
  security boundaries, so they have unit tests (`npm test`).

## Project layout

```
src/
├── index.ts                 # entry point: boot, login, signal handling
├── client.ts                # builds the Discord client + shared context
├── logger.ts                # pino logger (pretty in dev, JSON in prod)
├── deploy-commands.ts       # registers slash commands with Discord
├── types/
│   ├── config.ts            # the configuration model
│   ├── bot.ts               # command / event / context contracts
│   └── index.ts             # single import surface for both
├── config/
│   ├── index.ts             # assembles + hot-reloads the live config, lookups
│   ├── env.ts               # typed, forgiving .env readers
│   └── schema.ts            # validates & normalizes config.json (fail closed)
├── handlers/
│   ├── commandLoader.ts     # recursively auto-loads commands
│   └── eventLoader.ts       # auto-loads + wires gateway events
├── events/                  # ready, interactionCreate (dispatch + autocomplete)
├── commands/
│   ├── general/             # ping, help
│   ├── system/              # status, top, net
│   ├── service/             # service (list/status/start/stop/restart/logs)
│   ├── web/                 # sites
│   ├── ops/                 # run, file
│   └── admin/               # config, alerts
├── services/                # domain logic (no Discord types leak in here)
│   ├── host/                # everything that touches the local machine
│   │   ├── systemMonitor.ts     # metrics, processes, network, reboot state
│   │   ├── serviceManager.ts    # systemctl / journalctl wrapper + allowlist
│   │   ├── commandRunner.ts     # allowlisted command execution
│   │   └── fileViewer.ts        # allowlisted, bounded file tailing
│   ├── web/                 # everything that makes outbound requests
│   │   ├── webMonitor.ts        # HTTP health checks
│   │   └── certMonitor.ts       # TLS certificate expiry
│   ├── monitor/             # the periodic loop and what it remembers
│   │   ├── alertScheduler.ts    # monitor pass + alert state machine
│   │   ├── metricsHistory.ts    # in-memory samples -> trends and uptime
│   │   └── presence.ts          # static or health-reflecting presence
│   ├── audit.ts             # audit trail for privileged actions
│   └── notify.ts            # last-resort owner DM when all else fails
└── lib/                     # shell, permissions, embeds, autocomplete,
                             # confirm, limits, formatting
dist/                        # compiled JS output (tsc), git-ignored
config.example.json          # the inventory template — copy to config.json
```

Sources are `.ts`; `npm run build` compiles them to `dist/`, which is what you
run in production. During development `npm run dev` runs the `.ts` sources
directly via [tsx](https://tsx.is) with hot-reload — no build step needed. The
command/event loaders accept both `.ts` (dev) and compiled `.js` (prod), so the
same drop-in extension model works in either mode.

## Commands

| Command                                | Access   | Description                                   |
| -------------------------------------- | -------- | --------------------------------------------- |
| `/ping`                                | everyone | Liveness + latency                            |
| `/status`                              | everyone | Host CPU / memory / swap / disk / uptime      |
| `/sites [name]`                        | everyone | Website health + TLS expiry                   |
| `/help`                                | everyone | List commands                                 |
| `/top [sort] [count]`                  | admin    | Heaviest processes by CPU or memory           |
| `/net interfaces\|ports`               | admin    | Interfaces + throughput, or listening ports   |
| `/service list`                        | admin    | All managed services + state                  |
| `/service status <name>`               | admin    | Detailed status for one service               |
| `/service start\|stop\|restart <name>` | admin    | Control a service                             |
| `/service enable\|disable <name>`      | admin    | Control whether it starts at boot             |
| `/service failed`                      | admin    | Every failed unit on the host, managed or not |
| `/service logs <name> [lines] [prio]`  | admin    | Recent journal logs                           |
| `/run list`                            | admin    | Show allowlisted commands                     |
| `/run exec <name> [args]`              | admin    | Run an allowlisted command                    |
| `/file list`                           | admin    | Show allowlisted files                        |
| `/file tail <name> [lines] [contains]` | admin    | Tail an allowlisted file                      |
| `/alerts state`                        | admin    | Monitor state + currently active alerts       |
| `/alerts check`                        | admin    | Run a monitoring pass immediately             |
| `/alerts history [count]`              | admin    | Recent alerts that fired or recovered         |
| `/alerts test`                         | admin    | Verify the alert channel works                |
| `/alerts mute <minutes>` / `unmute`    | admin    | Suppress alerts during maintenance            |
| `/config show`                         | admin    | Effective configuration (secrets hidden)      |
| `/config reload`                       | admin    | Re-read `.env` + `config.json` live           |
| `/config issues`                       | admin    | Problems found in the current config          |

Access is enforced in `src/lib/permissions.ts`: a user is an admin if their ID
is in `ADMIN_USER_IDS` or they hold a role in `ADMIN_ROLE_IDS`. Commands default
to **admin-only** unless they explicitly opt into `Permission.EVERYONE`, and
autocomplete is gated the same way — non-admins never see the inventory.

## Configuration

Two files, one job each.

| File          | Holds                                                          | Applied by                       |
| ------------- | -------------------------------------------------------------- | -------------------------------- |
| `.env`        | Identity, secrets, access control, host-access mode            | `/config reload` (some: restart) |
| `config.json` | The inventory: services, websites, commands, files, monitoring | `/config reload`                 |

Both are validated at load. Invalid entries are **dropped**, not partially
loaded — these lists are security allowlists — and every problem is reported
at once in the logs and via `/config issues`.

### `.env`

| Variable                       | Required | Purpose                                               |
| ------------------------------ | -------- | ----------------------------------------------------- |
| `DISCORD_TOKEN`                | ✅       | Bot token _(restart to change)_                       |
| `DISCORD_CLIENT_ID`            | ✅       | Application ID (command registration)                 |
| `DISCORD_GUILD_ID`             |          | Register commands to one guild (instant)              |
| `ALERT_CHANNEL_ID`             |          | Channel for alerts + startup/shutdown notices         |
| `AUDIT_CHANNEL_ID`             |          | Channel mirroring the privileged-action audit trail   |
| `OWNER_USER_ID`                |          | User DMed on failures the bot cannot otherwise report |
| `ADMIN_USER_IDS`               |          | Comma-separated admin user IDs                        |
| `ADMIN_ROLE_IDS`               |          | Comma-separated admin role IDs                        |
| `BOT_NAME`                     |          | Display name in embeds / User-Agent                   |
| `BOT_DESCRIPTION`              |          | One-line description shown in `/help`                 |
| `BOT_PRESENCE_STATUS`          |          | `online` \| `idle` \| `dnd` \| `invisible`            |
| `BOT_ACTIVITY_TYPE`            |          | `Playing`/`Watching`/`Listening`/`Competing`/`Custom` |
| `BOT_ACTIVITY_TEXT`            |          | Text after the activity verb                          |
| `BOT_ACCENT_COLOR`             |          | Hex accent for info embeds (e.g. `#5865F2`)           |
| `BOT_EMBED_FOOTER`             |          | Optional footer added to every embed                  |
| `BOT_DYNAMIC_PRESENCE`         |          | Put a live health summary in the activity text        |
| `BOT_PRESENCE_REFRESH_SECONDS` |          | How often to refresh it (default 60)                  |
| `SYSTEMCTL_SUDO`               |          | `true` to prefix systemctl with `sudo -n`             |
| `SYSTEMCTL_SCOPE`              |          | `system` (default) or `user` units                    |
| `COMMAND_TIMEOUT_MS`           |          | Default host-command timeout (default 15000)          |
| `CONFIG_PATH`                  |          | Override the inventory file location                  |
| `LOG_LEVEL`                    |          | `trace`..`fatal` (default `info`) _(restart)_         |
| `NODE_ENV`                     |          | `production` for JSON logs _(restart)_                |

The bot's Discord account username and avatar are set in the Developer Portal,
not at runtime — everything else about how it presents itself is above.

### `config.json`

```jsonc
{
  "monitor": {
    "enabled": true,
    "intervalSeconds": 60, // 10–3600
    "alertCooldownMinutes": 15, // re-alert interval while still broken
    "checks": {
      // turn individual passes off
      "resources": true,
      "services": true,
      "websites": true,
      "certificates": true,
    },
    "thresholds": {
      "cpuPercent": 85,
      "memoryPercent": 90,
      "diskPercent": 90,
      "certExpiryDays": 14, // warn this long before a cert expires
      "responseMs": 3000, // flag slow sites; 0 disables
    },
    "ignoreMounts": ["/boot", "/snap"],
    "historyHours": 24, // in-memory retention for trends + uptime
  },

  "services": [
    {
      "name": "web",
      "label": "Main site",
      "unit": "web.service",
      "description": "Front-end application",
      "critical": true,
    },
  ],

  "websites": [
    {
      "name": "main",
      "label": "Main site",
      "url": "https://example.com",
      "expectStatus": 200,
      "timeoutMs": 8000,
      "checkCert": true,
      "service": "web",
    }, // links the site to the unit behind it
  ],

  "commands": [
    {
      "name": "disk",
      "label": "Disk usage",
      "command": "df",
      "args": ["-h"],
      "sudo": false,
      "allowArgs": false,
      "confirm": false,
      "timeoutMs": 15000,
    },
  ],

  "files": [
    {
      "name": "nginx-error",
      "label": "Nginx error log",
      "path": "/var/log/nginx/error.log",
      "maxLines": 200,
    },
  ],
}
```

Every `name` is the key used in commands and autocomplete: letters, digits,
`.`, `-`, `_`, up to 64 characters, starting with a letter or digit. Case is
preserved for display but **matched case-insensitively**, so `WebApp` and
`webapp` both resolve to the same entry — and two entries differing only by
case are rejected as duplicates. Naming an entry after its unit file
(`"name": "WebApp"`, `"unit": "WebApp.service"`) is fine.

Only `name` plus the section's own required field (`unit`, `url`, `command`,
`path`) are mandatory — everything else has a default.

**These lists are the security boundary.** The bot never runs `systemctl`
against a unit, executes a binary, or reads a path that is not listed here, and
Discord users select a _key_ — they never supply a unit name, argv or path.

Two flags add a second gate on top of the allowlist:

- `"critical": true` on a service — `/service stop` and `/service restart` ask
  for a button confirmation first. Mark anything whose downtime takes other
  things with it (nginx, a database).
- `"confirm": true` on a command — `/run exec` asks before running it. Use it
  for anything that changes state rather than just reporting it.

Only the invoking user can answer their own prompt, and it expires after 30
seconds.

### Adding something new

Adding a website, service, command or file needs **no restart and no
redeploy** — command options are served by autocomplete from the live config:

```bash
vim config.json            # add the entry
# then, in Discord:
/config reload
```

Only three things need more than that: the Discord token and log level (restart),
and _new slash commands_ or changed command definitions (`npm run deploy`).

## Setup

### 1. Create the Discord application

1. Go to the [Developer Portal](https://discord.com/developers/applications),
   create an application, add a **Bot**, and copy its **token**.
2. Copy the **Application ID** (client ID).
3. Invite the bot with the `applications.commands` and `bot` scopes.
   Only the **Guilds** gateway intent is required — no privileged intents.

### 2. Configure

```bash
git clone https://github.com/ruthgyeul/serverdiscordbot.git /opt/serverdiscordbot
cd /opt/serverdiscordbot
npm ci

cp .env.example .env                  # tokens, IDs, admins, identity
cp config.example.json config.json    # your services/sites/commands/files
```

### 3. Build

```bash
npm run build        # tsc -> dist/
npm test             # unit tests for the config validators (optional)
```

### 4. Register slash commands

```bash
npm run deploy               # runs dist/deploy-commands.js (build first)
npm run deploy:dev           # or, without building: the .ts source via tsx
npm run deploy -- --dry-run  # report what would change, write nothing
npm run deploy:clear         # remove every registration, register nothing
```

With `DISCORD_GUILD_ID` set, commands appear instantly in that server. Without
it, they register globally (up to ~1h to propagate).

**Stale registrations are cleared automatically.** Publishing is a full
replacement, so a command renamed or deleted in code disappears from the scope
it was published to. What that alone does not fix is the _other_ scope: guild
and global command sets are independent, so setting or clearing
`DISCORD_GUILD_ID` would otherwise leave the old set behind and show every
command twice. The deploy script wipes the scope it is not publishing to, then
registers, and reports exactly what was added and removed.

If a stale entry still appears in the picker after a clean deploy, that is the
Discord _client's_ own cache — reload it with Ctrl/Cmd+R.

### 5. Run

```bash
npm run dev      # development: tsx watch, hot-reload on change
npm start        # production: runs compiled dist/index.js (build first)
```

## Letting the bot control services

If the bot runs as a non-root user, grant it a **scoped** sudoers rule so it can
call `systemctl`/`journalctl` only:

```bash
sudo visudo -f /etc/sudoers.d/serverdiscordbot
```

```
botuser ALL=(root) NOPASSWD: /usr/bin/systemctl, /usr/bin/journalctl
```

Then set `SYSTEMCTL_SUDO=true` in `.env`. For tighter control, replace the
blanket rule with per-unit entries, e.g.
`botuser ALL=(root) NOPASSWD: /usr/bin/systemctl start nginx.service`. If the
bot runs as root or manages **user** units (`SYSTEMCTL_SCOPE=user`), you can
skip sudo entirely.

Commands in the `commands` list that set `"sudo": true` need their own rule for
that binary — grant them one at a time, not blanket `ALL`.

Files in the `files` list are read with the bot user's own permissions. For
`/var/log/nginx`, adding the bot user to the `adm` group is usually enough:

```bash
sudo usermod -aG adm botuser
```

## Extending the bot

Add a command by creating `src/commands/<category>/<name>.ts`:

```ts
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import type { CommandModule } from '../../types.js';

const command: CommandModule = {
  permission: Permission.ADMIN, // omit to default to admin
  data: new SlashCommandBuilder().setName('foo').setDescription('Does foo.'),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply('foo!');
  },
};

export default command;
```

To offer config-backed choices, add an `autocomplete` handler and mark the
option with `.setAutocomplete(true)`:

```ts
async autocomplete(interaction) {
  await respondWithEntries(interaction, config.websites); // any NamedEntry[]
}
```

> Note: keep the `.js` extension in relative imports even from `.ts` files —
> that is how NodeNext ESM resolves the compiled output.

Then `npm run build && npm run deploy` to register it. The loader, dispatcher,
permission check and error handling are all automatic. The `context` argument
(second parameter) gives you `context.commands`, `context.client` and
`context.alertScheduler`.

Before reaching for code, check whether config already covers it: a recurring
shell command belongs in `commands`, a log you keep reading belongs in `files`.

### Tests

```bash
npm test             # node --test via tsx
npm run test:watch
```

Tests live next to their subject as `*.test.ts` and are excluded from the
build. The suite covers the config validators and argument parsing — the code
where a mistake widens an allowlist — rather than chasing coverage of the
Discord plumbing, which is better verified by running the bot.

## Security model

What the boundaries actually are, and where they stop.

**Host commands never touch a shell.** Everything runs through `execFile` with
an explicit argv, so quoting, `;`, `&&`, backticks and globs have no special
meaning and cannot escape into a second command.

**Config is the allowlist.** The bot will not run `systemctl` against a unit,
execute a binary, or read a path that is not listed in `config.json`. Discord
users select a _key_; they never supply a unit name, argv or path.

**Commands are guild-only**, applied centrally in the command loader. The
public commands (`/status`, `/sites`) report the hostname, distro, kernel, disk
layout and every hosted URL, and a DM has no member to run the admin check
against.

**Untrusted output is escaped.** Journal lines, command stdout and web-server
logs are echoed into Discord. A web log contains request paths and user-agents
supplied verbatim by whoever made the request, so a stranger can put ``` into
one; code blocks escape their content, and the client resolves no mentions at
all.

### Where you can still shoot yourself

These are configuration decisions the bot cannot make for you:

- **`allowArgs`** lets a caller append arguments. The character check stops
  shell injection, but not _argument_ injection — `/etc/shadow` contains no
  dangerous characters, so `allowArgs` on a command that reads files walks
  around the `files` allowlist entirely. Use **`argPattern`** to constrain what
  the arguments may mean:

  ```json
  {
    "name": "tail-syslog",
    "command": "tail",
    "args": ["-n", "50", "/var/log/syslog"],
    "allowArgs": true,
    "argPattern": "^[0-9]{1,4}$"
  }
  ```

  Arguments are additionally capped at 8 per call and 256 characters each.

- **`"sudo": true`** grants whatever the sudoers rule grants. Scope rules to a
  single binary, and prefer per-unit `systemctl` entries over a blanket rule.

- **`files` entries are followed, symlinks included.** The bot reads with its
  own permissions, so an allowlisted path pointing somewhere sensitive is
  readable. List real paths.

- **Admin is your list, not Discord's.** `ADMIN_USER_IDS` / `ADMIN_ROLE_IDS`
  are deliberately independent of Discord's Administrator permission, so bot
  control can be delegated without granting server-wide power — and equally,
  a Discord admin who is not on your list has no bot access.

## Rate limiting

Commands that touch the host declare a per-user cooldown (`cooldownSeconds` on
the command module): `/status` 5s, `/top`, `/net` and `/sites` 10s. These walk
the process table, sweep every site, or shell out per unit, and an impatient
double-click should not become two probes of a machine that is already
struggling. It protects the host from accidents — it is not a security control,
and admins remain admins.

## Notes on monitoring history

`/status` trends and `/sites` uptime come from samples the monitor takes on
each tick, held in memory for `monitor.historyHours`. Two consequences worth
knowing:

- History starts empty after a restart. Both commands say so rather than
  reporting a misleading 100%.
- With `monitor.enabled: false` there are no samples at all, since nothing is
  taking them.

## License

MIT
