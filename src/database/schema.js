// /home/ubuntu/DiscStaffBot/src/database/schema.js

const SCHEMA = {
    // ==================== TABELA DE USUÁRIOS GLOBAL ====================
    users: `
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            username TEXT,
            discriminator TEXT,
            avatar TEXT,
            created_at INTEGER,
            first_seen INTEGER DEFAULT (strftime('%s', 'now')),
            last_seen INTEGER DEFAULT (strftime('%s', 'now')),
            is_bot INTEGER DEFAULT 0
        )
    `,

    // ==================== TABELA DE SERVIDORES ====================
    guilds: `
        CREATE TABLE IF NOT EXISTS guilds (
            guild_id TEXT PRIMARY KEY,
            name TEXT,
            icon TEXT,
            owner_id TEXT,
            joined_at INTEGER DEFAULT (strftime('%s', 'now')),
            settings TEXT
        )
    `,

    // ==================== CONFIGURAÇÕES DOS SERVIDORES ====================
    settings: `
        CREATE TABLE IF NOT EXISTS settings (
            guild_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_by TEXT,
            PRIMARY KEY (guild_id, key)
        )
    `,

    // ==================== REPUTAÇÃO DOS USUÁRIOS ====================
    reputation: `
        CREATE TABLE IF NOT EXISTS reputation (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            points INTEGER DEFAULT 100,
            rank TEXT DEFAULT 'normal',
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_by TEXT,
            PRIMARY KEY (guild_id, user_id)
        )
    `,

    // ==================== PUNIÇÕES (STRIKES) - ID POR SERVIDOR ====================
    punishments: `
        CREATE TABLE IF NOT EXISTS punishments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            moderator_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            severity INTEGER NOT NULL,
            points_deducted INTEGER DEFAULT 0,
            report_id TEXT,
            created_at INTEGER NOT NULL,
            expires_at INTEGER,
            status TEXT DEFAULT 'active',
            revoked_by TEXT,
            revoked_reason TEXT,
            revoked_at INTEGER,
            notes TEXT,
            strike_number INTEGER DEFAULT 0
        )
    `,

    // ==================== REPORTS (REPORTCHAT) - ID POR SERVIDOR ====================
    reports: `
        CREATE TABLE IF NOT EXISTS reports (
            guild_id TEXT NOT NULL,
            report_number INTEGER NOT NULL,
            report_id TEXT GENERATED ALWAYS AS ('#R' || report_number) STORED,
            type TEXT NOT NULL DEFAULT 'report',
            punishment_id INTEGER,
            user_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            log_message_id TEXT,
            dm_message_id TEXT,
            thread_message_id TEXT,
            description TEXT,
            status TEXT DEFAULT 'waiting',
            staffs TEXT DEFAULT '[]',
            last_message_at INTEGER,
            last_reply_by TEXT,
            last_reply_at INTEGER,
            closed_by TEXT,
            closed_reason TEXT,
            closed_at INTEGER,
            punishment TEXT,
            rating INTEGER,
            rating_comment TEXT,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, report_number),
            FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )
    `,

    // ==================== MENSAGENS DOS REPORTS ====================
    report_messages: `
        CREATE TABLE IF NOT EXISTS report_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            report_number INTEGER NOT NULL,
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            content TEXT,
            attachments TEXT,
            created_at INTEGER NOT NULL,
            is_staff_reply INTEGER DEFAULT 0,
            FOREIGN KEY (guild_id, report_number) REFERENCES reports(guild_id, report_number) ON DELETE CASCADE
        )
    `,

    // ==================== ANALYTICS DE STAFF ====================
    staff_analytics: `
        CREATE TABLE IF NOT EXISTS staff_analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            period TEXT NOT NULL,
            date TEXT NOT NULL,
            punishments_applied INTEGER DEFAULT 0,
            punishments_revoked INTEGER DEFAULT 0,
            reports_claimed INTEGER DEFAULT 0,
            reports_closed INTEGER DEFAULT 0,
            avg_response_time INTEGER DEFAULT 0,
            avg_resolution_time INTEGER DEFAULT 0,
            satisfaction_score REAL DEFAULT 0,
            metrics TEXT,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            reports_joined INTEGER DEFAULT 0,
            report_messages_count INTEGER DEFAULT 0,
            report_response_seconds_sum INTEGER DEFAULT 0,
            report_response_count INTEGER DEFAULT 0,
            events_created INTEGER DEFAULT 0,
            nametag_toggles_spectating INTEGER DEFAULT 0,
            nametag_toggles_not_spectating INTEGER DEFAULT 0,
            spectator_seconds INTEGER DEFAULT 0,
            UNIQUE(guild_id, user_id, period, date)
        )
    `,

    // ==================== LOGS DE ATIVIDADES ====================
    activity_logs: `
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            guild_id TEXT NOT NULL,
            user_id TEXT,
            action TEXT NOT NULL,
            target_id TEXT,
            details TEXT,
            ip_address TEXT,
            created_at INTEGER NOT NULL
        )
    `,

    // ==================== CARGOS TEMPORÁRIOS ====================
    temporary_roles: `
        CREATE TABLE IF NOT EXISTS temporary_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            punishment_guild_id TEXT,
            punishment_number INTEGER,
            expires_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `,

    // ==================== FEEDBACKS ====================
    feedbacks: `
        CREATE TABLE IF NOT EXISTS feedbacks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            message_id TEXT,
            channel_id TEXT,
            status TEXT DEFAULT 'pending',
            reviewed_by TEXT,
            reviewed_at INTEGER,
            created_at INTEGER NOT NULL
        )
    `,

    // ==================== SEQUÊNCIAS POR SERVIDOR ====================
    sequences: `
        CREATE TABLE IF NOT EXISTS sequences (
            guild_id TEXT NOT NULL,
            table_name TEXT NOT NULL,
            next_value INTEGER DEFAULT 1,
            PRIMARY KEY (guild_id, table_name)
        )
    `,

    // ==================== PATH OF TITANS INTEGRATION ====================
    pot_servers: `
        CREATE TABLE IF NOT EXISTS pot_servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL UNIQUE,
            server_name TEXT,
            server_ip TEXT NOT NULL,
            rcon_port INTEGER,
            rcon_password TEXT,
            webhook_port INTEGER DEFAULT 8080,
            api_key TEXT,
            enabled INTEGER DEFAULT 1,
            last_online INTEGER,
            settings TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `,
    
    pot_players: `
        CREATE TABLE IF NOT EXISTS pot_players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            alderon_id TEXT NOT NULL,
            player_name TEXT NOT NULL,
            discord_id TEXT,
            dinosaur_type TEXT,
            dinosaur_growth REAL DEFAULT 0,
            last_seen INTEGER,
            total_playtime INTEGER DEFAULT 0,
            is_online INTEGER DEFAULT 0,
            linked_at INTEGER,
            first_login_at INTEGER,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            admin_notes TEXT,
            verification_code TEXT,
            verified_ingame INTEGER DEFAULT 0,
            kills INTEGER DEFAULT 0,
            deaths INTEGER DEFAULT 0,
            dinosaur_active INTEGER DEFAULT 0,
            UNIQUE(guild_id, alderon_id)
        )
    `,

    // Contagem de vezes que cada especie foi escolhida (um respawn = um pick),
    // por jogador — usada pra saber o "dinossauro mais jogado" (distinto de
    // pot_players.dinosaur_type, que so guarda o ULTIMO jogado). Guild-scoped
    // igual pot_players; a consulta global (getMostPlayedDinosaur) soma entre
    // guilds pelo mesmo alderon_id.
    pot_dinosaur_picks: `
        CREATE TABLE IF NOT EXISTS pot_dinosaur_picks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            alderon_id TEXT NOT NULL,
            dinosaur_type TEXT NOT NULL,
            pick_count INTEGER DEFAULT 0,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            UNIQUE(guild_id, alderon_id, dinosaur_type)
        )
    `,

    pot_logs: `
        CREATE TABLE IF NOT EXISTS pot_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            event_data TEXT,
            player_name TEXT,
            alderon_id TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `,

    pot_tokens: `
        CREATE TABLE IF NOT EXISTS pot_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL UNIQUE,
            token TEXT NOT NULL UNIQUE,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            last_used INTEGER,
            usage_count INTEGER DEFAULT 0
        )
    `,

    // ==================== VÍNCULO GLOBAL DISCORD <-> ALDERON ID ====================
    // Fonte da verdade da IDENTIDADE do jogador (global, sem guild_id) — usada
    // por /registrar, /perfil, Player Premium, badges/títulos futuros. pot_players
    // (acima) continua guild-scoped, só pra atividade por servidor (webhook, notas).
    player_links: `
        CREATE TABLE IF NOT EXISTS player_links (
            user_id TEXT PRIMARY KEY,
            alderon_id TEXT NOT NULL UNIQUE,
            player_name TEXT,
            banner_message_id TEXT,
            selected_photo_key TEXT,
            verified_ingame INTEGER DEFAULT 0,
            registered_at INTEGER,
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `,

    // ==================== PREMIUM ====================
    player_premium: `
        CREATE TABLE IF NOT EXISTS player_premium (
            user_id TEXT PRIMARY KEY,
            tier TEXT NOT NULL DEFAULT 'free',
            granted_by TEXT,
            granted_at INTEGER,
            expires_at INTEGER,
            notes TEXT,
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `,

    guild_premium: `
        CREATE TABLE IF NOT EXISTS guild_premium (
            guild_id TEXT PRIMARY KEY,
            tier TEXT NOT NULL DEFAULT 'free',
            granted_by TEXT,
            granted_at INTEGER,
            expires_at INTEGER,
            notes TEXT,
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `,

    // ==================== NÍVEIS DE PUNIÇÃO CUSTOMIZADOS (POR SERVIDOR) ====================
    punishment_levels: `
        CREATE TABLE IF NOT EXISTS punishment_levels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            severity TEXT NOT NULL,
            points INTEGER NOT NULL DEFAULT 0,
            duration_str TEXT,
            action TEXT,
            requires_supervisor_approval INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            created_by TEXT,
            updated_at INTEGER,
            updated_by TEXT
        )
    `,

    // ==================== SESSÕES DE MODO ESPECTADOR EM ABERTO (ANALYTICS) ====================
    // Guarda só a sessão ATUALMENTE aberta por admin (guild_id+alderon_id é
    // chave única — sem histórico linha-a-linha, o total acumulado vai pra
    // staff_analytics.spectator_seconds ao fechar). Aberta no primeiro
    // avistamento de bSpectatorMode=true (AdminSpectate); fechada quando o
    // mesmo Alderon ID dá respawn (PlayerRespawn) — ver analyticsSystem.js.
    pot_spectator_sessions: `
        CREATE TABLE IF NOT EXISTS pot_spectator_sessions (
            guild_id TEXT NOT NULL,
            alderon_id TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, alderon_id)
        )
    `,

    // ==================== TP CONFIGURÁVEL DE EVENTO (/evento) ====================
    // Coordenadas de teleporte (RCON `teleport`) configuradas pelo staff na
    // postagem de um evento — até 2 por evento (Herbívoro/Carnívoro), ver
    // eventTeleportSystem.js. Chave é o ID da mensagem da postagem no fórum
    // (única por evento). scheduled_event_id guarda o Evento Agendado do
    // Discord correspondente — é ele que dita se o TP está "ativo agora"
    // (status Active), não um horário calculado à parte.
    event_teleports: `
        CREATE TABLE IF NOT EXISTS event_teleports (
            message_id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            scheduled_event_id TEXT,
            herbivore_coords TEXT,
            carnivore_coords TEXT,
            created_by TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `,

    // Um uso por jogador por evento, independente de qual dos 2 botões
    // (Herbívoro/Carnívoro) ele clicou primeiro — PRIMARY KEY sem a coluna
    // species é o que garante isso (tentar inserir de novo, com a mesma
    // combinação message_id+user_id, sempre falha).
    event_teleport_uses: `
        CREATE TABLE IF NOT EXISTS event_teleport_uses (
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            species TEXT NOT NULL,
            used_at INTEGER NOT NULL,
            PRIMARY KEY (message_id, user_id)
        )
    `,

    // ==================== ANÚNCIO AUTOMÁTICO DE EVENTO (Caçador) ====================
    // Mapeia o Evento Agendado do Discord pra thread do fórum onde ele foi
    // publicado — ver eventAnnounceSystem.js. Início/encerramento chegam via
    // gateway (guildScheduledEventUpdate) bem depois da criação, sem
    // nenhuma referência direta à thread em mãos, daí precisar de uma
    // tabela (em vez de só guardar em memória). Removida quando o evento
    // encerra — nada mais precisa consultar depois disso.
    event_posts: `
        CREATE TABLE IF NOT EXISTS event_posts (
            scheduled_event_id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    `,

    // ==================== BUFFS (RCON setattr em lote) ====================
    // Preset nomeado de alterações de atributo (setattr), aplicado de uma vez
    // num jogador — ver buffSystem.js/buffPanelSystem.js. "Parecido com os
    // níveis de punição" (pedido do dono): um preset configurado uma vez em
    // /config buffs, reaplicado depois via /ingame-buff aplicar.
    buffs: `
        CREATE TABLE IF NOT EXISTS buffs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            created_by TEXT,
            updated_at INTEGER,
            updated_by TEXT
        )
    `,

    // Uma linha por atributo dentro de um buff — UNIQUE(buff_id, attribute)
    // porque adicionar o MESMO atributo de novo deve sobrescrever o valor,
    // nunca duplicar a linha (ver buffSystem.upsertBuffStat).
    buff_stats: `
        CREATE TABLE IF NOT EXISTS buff_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buff_id INTEGER NOT NULL,
            attribute TEXT NOT NULL,
            value TEXT NOT NULL,
            UNIQUE(buff_id, attribute)
        )
    `,

    // ==================== SESSÕES DO DASHBOARD WEB ====================
    // Store de sessão do express-session (login do dashboard, ver
    // dashboard.js/web/sqliteSessionStore.js) — reaproveita a MESMA conexão
    // better-sqlite3 do resto do bot, em vez de um pacote de terceiros
    // (o óbvio, better-sqlite3-session-store, está arquivado/sem manutenção
    // desde 2025) ou de um segundo driver de SQLite (connect-sqlite3 usa o
    // driver `sqlite3` clássico, não o better-sqlite3). `session` guarda o
    // JSON serializado da sessão; `expires` é epoch ms, varrido
    // periodicamente pela própria store.
    sessions: `
        CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            session TEXT NOT NULL,
            expires INTEGER NOT NULL
        )
    `,
};

// ==================== ÍNDICES ====================
const INDEXES = [
    // Punishments
    `CREATE INDEX IF NOT EXISTS idx_punishments_guild_user ON punishments(guild_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_punishments_moderator ON punishments(moderator_id)`,
    `CREATE INDEX IF NOT EXISTS idx_punishments_created ON punishments(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_punishments_status ON punishments(status)`,
    `CREATE INDEX IF NOT EXISTS idx_punishments_strike_number ON punishments(guild_id, strike_number)`,
    
    // Reports (ReportChat)
    `CREATE INDEX IF NOT EXISTS idx_reports_guild ON reports(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_last_message ON reports(last_message_at)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_last_reply ON reports(last_reply_at)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_closed ON reports(closed_at)`,
    
    // Report Messages
    `CREATE INDEX IF NOT EXISTS idx_report_messages_guild ON report_messages(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_report_messages_created ON report_messages(created_at)`,
    
    // Reputation
    `CREATE INDEX IF NOT EXISTS idx_reputation_guild_user ON reputation(guild_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reputation_points ON reputation(points)`,
    
    // Staff Analytics
    `CREATE INDEX IF NOT EXISTS idx_staff_analytics_guild_user ON staff_analytics(guild_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_staff_analytics_date ON staff_analytics(date)`,
    
    // Activity Logs
    `CREATE INDEX IF NOT EXISTS idx_activity_logs_guild ON activity_logs(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at)`,
    
    // Temporary Roles
    `CREATE INDEX IF NOT EXISTS idx_temporary_roles_expires ON temporary_roles(expires_at)`,
    
    // Feedbacks
    `CREATE INDEX IF NOT EXISTS idx_feedbacks_status ON feedbacks(status)`,
    `CREATE INDEX IF NOT EXISTS idx_feedbacks_created ON feedbacks(created_at)`,

    // Path of Titans indexes
    `CREATE INDEX IF NOT EXISTS idx_pot_players_guild ON pot_players(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pot_players_alderon ON pot_players(alderon_id)`,
    // ✅ NOVO: acelera consultas por vínculo Discord (ex: "qual o perfil PoT deste membro?")
    `CREATE INDEX IF NOT EXISTS idx_pot_players_discord ON pot_players(guild_id, discord_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pot_logs_guild ON pot_logs(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pot_logs_type ON pot_logs(event_type)`,
    `CREATE INDEX IF NOT EXISTS idx_pot_dinosaur_picks_alderon ON pot_dinosaur_picks(alderon_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pot_servers_guild ON pot_servers(guild_id)`,
    
    // Sequences
    `CREATE INDEX IF NOT EXISTS idx_sequences_guild ON sequences(guild_id)`,

    // Player links (registro global)
    `CREATE INDEX IF NOT EXISTS idx_player_links_alderon ON player_links(alderon_id)`,

    // Premium
    `CREATE INDEX IF NOT EXISTS idx_player_premium_tier ON player_premium(tier)`,
    `CREATE INDEX IF NOT EXISTS idx_player_premium_expires ON player_premium(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_premium_tier ON guild_premium(tier)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_premium_expires ON guild_premium(expires_at)`,

    // Punishment Levels
    `CREATE INDEX IF NOT EXISTS idx_punishment_levels_guild ON punishment_levels(guild_id)`,

    // Spectator sessions (analytics)
    `CREATE INDEX IF NOT EXISTS idx_pot_spectator_sessions_guild ON pot_spectator_sessions(guild_id)`,

    // Event teleports
    `CREATE INDEX IF NOT EXISTS idx_event_teleports_guild ON event_teleports(guild_id)`,

    // Event posts (anúncio automático)
    `CREATE INDEX IF NOT EXISTS idx_event_posts_guild ON event_posts(guild_id)`,

    // Buffs
    `CREATE INDEX IF NOT EXISTS idx_buffs_guild ON buffs(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_buff_stats_buff ON buff_stats(buff_id)`,

    // Sessões do dashboard web
    `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)`,
];

module.exports = { SCHEMA, INDEXES };