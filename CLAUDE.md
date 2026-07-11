# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Titan's Pass** — Discord bot for managing Path of Titans communities: moderation, punishments/reputation, ticket-style reports, staff analytics, and a game-server integration (RCON + webhooks) with Path of Titans itself. Built on Discord.js, CommonJS, better-sqlite3.

## Commands

- `node index.js` — start the bot (loads commands/events, connects to Discord, optionally starts the web dashboard).
- `node deploy.js` — register slash commands. Registers **per-guild** (not globally) against the IDs hardcoded in the `GUILD_IDS` array at the top of `deploy.js` — update that array when adding a new server.
- `npm run convert-images` — converts any `.png`/`.jpg`/`.jpeg` in `assets/images` to `.webp` (deletes the originals). Run after adding new image assets; see `FERRAMENTAS.txt` for details. Requires the `sharp` devDependency (already in `package.json`).
- No test suite is configured (`npm test` is a placeholder that exits with an error).
- No lint/build step; plain Node CommonJS, run directly.

Required `.env` values (read via `dotenv`): `TOKEN` (bot token, required to boot), `CLIENT_ID` (used by `deploy.js`), `DASHBOARD_CLIENT_ID` / `DASHBOARD_CLIENT_SECRET` / `DASHBOARD_CALLBACK_URL` / `SESSION_SECRET` / `DASHBOARD_PORT` (web dashboard OAuth2), `DEPLOY_COMMANDS=true` (if set, `events/ready.js` also registers commands globally on boot), `POT_GATEWAY_URL` (Path of Titans integration).

## Architecture

### Boot & loading
`index.js` recursively loads every `src/commands/<category>/*.js` file that exports both `data` (a `SlashCommandBuilder`) and `execute`, registers each with `client.commands`, then loads every `src/events/*.js` file (name/execute or name/once/execute). The Path of Titans integration is initialized last, in standby, and failures there are swallowed so the bot still boots without it. `events/ready.js` then wires up the interaction handler cache, the inactive-reports cron job, the web dashboard, auto-moderation worker, and bot presence rotation.

### Interaction routing
All interactions flow through `events/interactionCreate.js`, which delegates to the `InteractionHandler` singleton in `src/systems/handlers.js`:
- Slash commands → `handler.handleCommand()` → deferred reply (ephemeral for a hardcoded list of commands) → `command.execute(interaction, client)`.
- Buttons/selects/modals use a **`system:action:param`** customId convention. `system` must match a key in `InteractionHandler.handlers` (e.g. `punishment`, `config-roles`, `config-logs`, `config-punishments`, `status`, `error`) and is routed either to that system's own `handleComponent`/`handleModal` method, or through the generic `actionMap` (action → method name) if the system doesn't implement its own router.
- A handful of flows are special-cased directly inside `interactionCreate.js` *before* the generic router: report-chat (open/close/rate/join, all colon-delimited customIds starting with recognizable prefixes), Path of Titans reset confirmation (`pot_reset_*`) and the webhook config panel (`pot_webhook:*`). Pagination customIds (`pag_*`) are explicitly ignored here — `utils/paginationBuilder.js` owns its own message component collector, and double-handling causes "Unknown interaction" errors.

### Responses — always go through `ResponseManager`
`src/utils/responseManager.js` is the single choke point for replying to interactions. It normalizes whatever you hand it — an `AdvancedContainerBuilder`, a raw `ContainerBuilder`, an array of components, or a legacy `{content, embeds}` object — into a valid payload, picks `reply`/`editReply`/`followUp`/`update` based on interaction state, and strips `content`/`embeds` from Components V2 payloads (Discord rejects mixing them). Prefer `ResponseManager.send/success/error/warning` over calling `interaction.reply`/`editReply` directly.

### Building UI — always use `containerBuilder.js`
`src/utils/containerBuilder.js` exports `AdvancedContainerBuilder`, the standard chainable builder for Components V2 container responses (`title`, `text`, `block`, `separator`, `section`, `gallery`, `buttons`, `footer`, plus static accessory helpers `thumbnail`/`linkButton`/`primaryButton`/etc.). It is the only place in the codebase that instantiates `ContainerBuilder` directly — every command response should go through it rather than building Components V2 by hand. Keep it simple: extend it only when a genuinely new component shape is needed, and prefer the smallest addition that works. `src/utils/paginationBuilder.js` builds multi-page responses on top of it.

### State between interactions
`src/utils/sessionManager.js` is a short-lived, in-memory, TTL-based store keyed by `(userId, guildId, category, action)`. It's used for multi-step flows that span more than one interaction — e.g. `strike` stages the punishment and only writes it to the DB when the user clicks the confirm button (`punishment:confirm:confirm`, handled via the `confirm` → `handleStrikeConfirmation` entry in `actionMap`). Nothing here is persisted to the database.

### Persistence
`src/database/index.js` wraps `better-sqlite3` (WAL mode) as a singleton (`getInstance()`), exporting the raw `db` handle plus helpers (`ensureUser`, `ensureGuild`, `logActivity`, `prepare`, `transaction`). Schema lives declaratively in `src/database/schema.js` (`SCHEMA` map of `CREATE TABLE IF NOT EXISTS` strings + an `INDEXES` array) and is (re)applied on every boot — there is no migration system, so changing an existing column requires a manual `ALTER TABLE` or handling in code, not just editing `schema.js`. Key tables: `users`, `guilds`, `settings` (per-guild key/value config), `reputation`, `punishments` (strikes), `reports`/`report_messages` (report-chat tickets), `staff_analytics`, `activity_logs`, `temporary_roles`, `feedbacks`, and the `pot_*` tables for the Path of Titans integration.

### Config system
`src/systems/configSystem.js` reads/writes the `settings` table (per guild key/value) through an in-memory `Map` cache. Config UI (role pickers, log-channel pickers, strike-points editors) lives behind the `config-roles:`, `config-logs:`, and `config-punishments:` customId prefixes routed via `InteractionHandler`.

### Path of Titans integration (`src/integrations/pathoftitans/`)
- `gatewayServer.js` — inbound HTTP webhook listener (port from `pot_servers.webhook_port`, default 8080) that receives game-server events.
- `rconClient.js` — outbound RCON connection per guild for sending commands to the game server.
- `tokenManager.js` — per-guild auth tokens (`pot_tokens` table) used to authenticate inbound webhooks.
- `index.js` exposes a `getInstance(client)` singleton (`PathOfTitansIntegration`) coordinating the above; per-guild RCON clients are created via `initializeForGuild()` once a guild has configured its server (`potConfigSystem`/`pot_servers` table).

### Web dashboard (`dashboard.js` + `web/`)
Express + EJS + `passport-discord` OAuth2 app, started from `events/ready.js` after the bot logs in. Reads/writes the same SQLite database directly (settings, punishments, reputation) for a browser-based admin panel.

### Error handling
`src/systems/errorLogger.js` is the central error sink; `InteractionHandler.handleError` and most command `catch` blocks funnel unexpected errors through it, then reply to the user with a generic ephemeral error via `ResponseManager.error`.

## Conventions for this repo

- **Target Discord.js 14.26.4 and Components V2 exclusively.** (Note: `package.json` currently pins `^14.25.1` — check/bump when touching dependency-sensitive code.) Don't mix legacy `content`/`embeds` with Components V2 payloads.
- **Always build container responses through `AdvancedContainerBuilder`** (`src/utils/containerBuilder.js`). Improve it when genuinely needed, but keep its API small and simple — this is the one shared UI primitive for the whole bot.
- **Keep commands and flows simple.** Avoid speculative abstraction, unnecessary indirection, or half-finished generalization — a bug fix or new command doesn't need a new framework.
- **customId format is `system:action:param`** (colon-delimited). New interactive components should follow this so they route through the existing `InteractionHandler` dispatch in `src/systems/handlers.js` instead of adding one-off branches to `interactionCreate.js`.
- **Always use the bot's custom emojis from `src/database/emojis.js`, never a bare unicode literal, in any command/container/message text sent to Discord.** Load them the way existing files already do (`require('.../database/emojis.js').EMOJIS`, commonly aliased `emojis` or `EMOJIS`) and reference them as `` `${emojis.someKey || '🔧'}` `` — the `||` unicode is only a fallback for when a key is missing/undefined, never the primary choice. `emojis.js` is regenerated by `npm run sync-emojis` (which also auto-commits/pushes it) from the bot's application emojis in the Discord Developer Portal, so its available keys change over time — check the current file for the best-fitting key by name before adding new emoji to any message. If no existing key fits the concept well, it's fine to fall back to a generic unicode emoji rather than force a bad match. Don't touch a line that already correctly references an existing `emojis.js` key unless there's an actual bug in how it's wired up.
- **Favor database space economy for derived/aggregated data.** Rows that only exist to summarize something else (e.g. `staff_analytics` counters, which are recomputed/derivable from `punishments`/`report_messages`/PoT webhook events) can and should be deleted once they stop being relevant — e.g. a staff member losing every staff role (see `AnalyticsSystem.purgeStaffOnRoleLoss`, triggered from `events/guildMemberUpdate.js`). This does **not** apply to audit-trail records (`punishments`, `reports`, `report_messages`) — those represent real actions taken against real users and must never be deleted just because the staff member who created them is gone. Also don't apply this to a tier downgrade: losing premium never deletes already-recorded data, it only stops new data from accumulating (see `AnalyticsSystem._isAnalyticsAllowed`) — deletion is tied to a concrete fact (role loss), not to a subscription lapsing.
- **`PREMIUM.txt` is the official reference for the premium tier system, not just a changelog.** Sections 1 ("PLAYER PREMIUM") and 2 ("SERVER PREMIUM") at the top are a living, continuously-updated description of exactly what each tier (Free/Rastreador/Caçador) does *right now* — every bullet is tagged as either already implemented or `"vindo em breve"` (not yet built). When a change affects what any tier includes or excludes (a `GUILD_LIMITS` value in `premiumSystem.js`, a new gated feature, a tier boundary moving), update sections 1–2 in the same change, not just the numbered changelog entry describing the change. The numbered sections from 3 onward are the historical changelog (append-only, one new highest-numbered section per feature/fix) and should **not** be rewritten to match current state — they're a point-in-time record. The in-Discord `/premium` panel shows a static marketing image (`assets/images/TABELA SERVER PREMIUM.webp`, asset key `tabela_server_premium`) that mirrors sections 1–2 but can drift out of sync since it's a binary file only the owner can regenerate/replace — if you find a mismatch between that image and the actual code, fix the code/docs side and flag the image as needing a manual update, don't try to edit the image yourself.
