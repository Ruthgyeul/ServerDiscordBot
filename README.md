# ServerDiscordBot

A Discord bot for managing a Linux host, its **systemd services** (websites and
other apps), and the **websites** it serves — all from Discord. Written in
**TypeScript** on Node.js + [discord.js](https://discord.js.org), compiled with
`tsc` and designed to run under systemd.

## What it does

- **📊 Host monitoring** — CPU, memory, disk usage and uptime at a glance
  (`/status`).
- **⚙️ Service control** — start / stop / restart / inspect the systemd units
  you register, plus tail their journal logs (`/service …`). Only units on your
  configured allowlist can ever be touched.
- **🌐 Website health checks** — HTTP checks for the sites you host, with
  response codes and latency (`/sites`).
- **🚨 Automated alerts** — a background monitor watches resource thresholds,
  service state and website availability, and posts to an alert channel when
  something breaks (and again when it recovers), with cooldowns to avoid spam.

## Design principles

- **Extensible** — drop a new file in `src/commands/<category>/` or
  `src/events/` and it is auto-loaded. No central registry to edit.
- **Safe by default** — system commands run via `execFile` (no shell, no
  injection) and only against a config-defined allowlist. Privileged commands
  require an admin user/role that you configure explicitly.
- **Readable** — small, single-purpose modules with a clear service/command
  split and dependency-injected context instead of globals.
- **Operable** — structured JSON logs to journald, graceful shutdown on
  SIGTERM, restart-on-failure via systemd.

## Project layout

```
src/
├── index.ts                # entry point: boot, login, signal handling
├── client.ts               # builds the Discord client + shared context
├── config.ts               # env + config.json loading and validation
├── logger.ts               # pino logger (pretty in dev, JSON in prod)
├── types.ts                # shared interfaces (config, command/event contracts)
├── deploy-commands.ts       # registers slash commands with Discord
├── handlers/
│   ├── commandLoader.ts     # recursively auto-loads commands
│   └── eventLoader.ts       # auto-loads + wires gateway events
├── events/                  # ready, interactionCreate (command dispatch)
├── commands/
│   ├── general/             # ping, help
│   ├── system/              # status
│   ├── service/             # service (list/status/start/stop/restart/logs)
│   └── web/                 # sites
├── services/                # domain logic (no Discord types leak in here)
│   ├── systemMonitor.ts     # host metrics via systeminformation
│   ├── serviceManager.ts    # systemctl / journalctl wrapper + allowlist
│   ├── webMonitor.ts        # HTTP health checks
│   └── alertScheduler.ts    # periodic monitor + alert state machine
└── lib/                     # shell, permissions, embeds, formatting helpers
dist/                        # compiled JS output (tsc), git-ignored
tsconfig.json                # TypeScript compiler config (NodeNext, strict)
deploy/                      # systemd unit, sudoers rule, install script
config/config.example.json   # services / websites / thresholds template
```

Sources are `.ts`; `npm run build` compiles them to `dist/` which is what
systemd runs. During development `npm run dev` runs the `.ts` sources directly
via [tsx](https://tsx.is) with hot-reload — no build step needed. The
command/event loaders accept both `.ts` (dev) and compiled `.js` (prod), so the
same drop-in extension model works in either mode.

## Commands

| Command                                | Access   | Description                       |
| -------------------------------------- | -------- | --------------------------------- |
| `/ping`                                | everyone | Liveness + latency                |
| `/status`                              | everyone | Host CPU / memory / disk / uptime |
| `/sites [name]`                        | everyone | Website health checks             |
| `/help`                                | everyone | List commands                     |
| `/service list`                        | admin    | All managed services + state      |
| `/service status <name>`               | admin    | Detailed status for one service   |
| `/service start\|stop\|restart <name>` | admin    | Control a service                 |
| `/service logs <name> [lines]`         | admin    | Recent journal logs               |

Access is enforced in `src/lib/permissions.js`: a user is an admin if their ID
is in `ADMIN_USER_IDS` or they hold a role in `ADMIN_ROLE_IDS`. Commands default
to **admin-only** unless they explicitly opt into `Permission.EVERYONE`.

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

cp .env.example .env                                # fill in tokens, IDs, admins
cp config/config.example.json config/config.json    # list your services/sites
```

Edit `config/config.json` to describe **your** services and websites:

```json
{
  "services": [{ "name": "blog", "label": "Blog", "unit": "blog.service" }],
  "websites": [{ "name": "blog", "label": "Blog", "url": "https://blog.example.com" }]
}
```

The `unit` values form the **allowlist** — the bot will never run `systemctl`
against a unit that isn't listed here.

### 3. Build

```bash
npm run build        # tsc -> dist/
```

### 4. Register slash commands

```bash
npm run deploy       # runs dist/deploy-commands.js (build first)
# or, without building:
npm run deploy:dev   # runs the .ts source via tsx
```

With `DISCORD_GUILD_ID` set, commands appear instantly in that server. Without
it, they register globally (up to ~1h to propagate).

### 5. Run

```bash
npm run dev      # development: tsx watch, hot-reload on change
npm start        # production: runs compiled dist/index.js (build first)
```

## Running under systemd

```bash
# Put the code at /opt/serverdiscordbot, then:
sudo ./deploy/install.sh
```

Or manually:

```bash
npm ci && npm run build          # compile to dist/ (the unit runs dist/index.js)
sudo cp deploy/serverdiscordbot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now serverdiscordbot
journalctl -u serverdiscordbot -f
```

### Letting the bot control services

If the bot runs as a non-root user, grant it a **scoped** sudoers rule so it can
call `systemctl`/`journalctl` only:

```bash
sudo install -m 0440 deploy/serverdiscordbot.sudoers /etc/sudoers.d/serverdiscordbot
sudo visudo -c        # validate
```

Then set `SYSTEMCTL_SUDO=true` in `.env`. For tighter control, replace the
blanket rule with per-unit entries (examples in the sudoers file). If the bot
runs as root or manages **user** units, you can skip sudo entirely.

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

> Note: keep the `.js` extension in relative imports even from `.ts` files —
> that is how NodeNext ESM resolves the compiled output.

Then `npm run build && npm run deploy` to register it. The loader, dispatcher,
permission check and error handling are all automatic. The `context` argument
(second parameter) gives you `context.commands`, `context.client` and
`context.alertScheduler`.

## Configuration reference

`.env`

| Variable              | Required | Purpose                                               |
| --------------------- | -------- | ----------------------------------------------------- |
| `DISCORD_TOKEN`       | ✅       | Bot token                                             |
| `DISCORD_CLIENT_ID`   | ✅       | Application ID (command registration)                 |
| `DISCORD_GUILD_ID`    |          | Register commands to one guild (instant)              |
| `ALERT_CHANNEL_ID`    |          | Channel for automated alerts                          |
| `ADMIN_USER_IDS`      |          | Comma-separated admin user IDs                        |
| `ADMIN_ROLE_IDS`      |          | Comma-separated admin role IDs                        |
| `BOT_NAME`            |          | Display name in embeds / User-Agent                   |
| `BOT_DESCRIPTION`     |          | One-line description shown in `/help`                 |
| `BOT_PRESENCE_STATUS` |          | `online` \| `idle` \| `dnd` \| `invisible`            |
| `BOT_ACTIVITY_TYPE`   |          | `Playing`/`Watching`/`Listening`/`Competing`/`Custom` |
| `BOT_ACTIVITY_TEXT`   |          | Text after the activity verb                          |
| `BOT_EMBED_FOOTER`    |          | Optional footer added to every embed                  |
| `SYSTEMCTL_SUDO`      |          | `true` to prefix systemctl with `sudo -n`             |
| `LOG_LEVEL`           |          | `trace`..`fatal` (default `info`)                     |
| `NODE_ENV`            |          | `production` for JSON logs                            |

Bot identity (name, description, presence/activity, embed footer) is fully
driven by `.env` — see the **Bot branding & presence** block in `.env.example`.
The bot's actual Discord account username and avatar are set in the Developer
Portal, not at runtime.

`config/config.json` — `monitor` (interval, cooldown, thresholds), `services`
(name/label/unit), `websites` (name/label/url/expectStatus/timeoutMs).

## License

MIT
