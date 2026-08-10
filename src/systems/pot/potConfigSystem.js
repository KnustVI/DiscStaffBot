/**
 * potConfigSystem.js
 * 
 * Configurações da integração Path of Titans.
 * Armazena: config do servidor, webhooks Discord por grupo de eventos.
 */
const db = require('../../database/index');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

// ==================== GRUPOS DE EVENTOS ====================
// Definido aqui pois é dado puro (sem imports Discord), acessível
// tanto pelo painel (potWebhookSystem) quanto pelo gateway.
//
// `label` = texto puro (SEM emoji custom) — usado em título de modal e no
// comentário do Game.ini, nenhum dos dois renderiza tag de emoji customizado
// (modal só aceita texto puro; Game.ini é lido pelo servidor PoT/editor de
// texto do host, não pelo Discord).
// `emoji` = emoji customizado já resolvido — usado só em texto que o Discord
// realmente renderiza (painel, `name` legado mantido pra outros usos soltos).
//
// `description` aparece no painel /potserver logs — atualize sempre que uma
// nova funcionalidade do bot passar a usar os dados desse grupo.

const EVENT_GROUPS = [
    {
        id: 'login',
        name: `${EMOJIS.login || '📥'} Login / Logout`,
        label: 'Login / Logout',
        emoji: EMOJIS.login || '📥',
        description: 'Registra entrada/saída e vincula o jogador ao Discord (usado por /registrar e pelo container de login).',
        route: 'login',
        iniEvents: ['PlayerLogin', 'PlayerLogout', 'PlayerLeave']
    },
    {
        // Pedido do dono, 2026-08-09: "Vamos separar as logs de morte e de
        // dano/relatorio de combate em canais diferentes" — antes deste
        // grupo cobria PlayerKilled + PlayerDamagedPlayer juntos, então
        // toda morte (mesmo por ambiente, sem outro jogador envolvido)
        // saía no mesmo canal do relatório de combate agregado. Agora só
        // PlayerDamagedPlayer fica aqui; PlayerKilled tem grupo próprio
        // (ver 'mortes' logo abaixo). O RELATÓRIO agregado
        // (buildDamageReportPayload, disparado quando um "encontro" fecha)
        // sempre usa este grupo pro webhook final, mesmo quando o encontro
        // foi iniciado por uma morte (ver DAMAGE_REPORT_GROUP_ID em
        // gatewayServer.js) — só o AVISO INSTANTÂNEO de morte
        // (buildKillPanel) é que muda de canal.
        id: 'combate',
        name: `${EMOJIS.Atack || '⚔️'} Combate`,
        label: 'Combate',
        emoji: EMOJIS.Atack || '⚔️',
        description: 'Relatório de combate agregado (dano entre jogadores durante um encontro). Avisos de morte têm canal próprio, ver grupo "Mortes" abaixo.',
        route: 'combate',
        iniEvents: ['PlayerDamagedPlayer']
    },
    {
        id: 'mortes',
        name: `${EMOJIS.Dead || '💀'} Mortes`,
        label: 'Mortes',
        emoji: EMOJIS.Dead || '💀',
        description: 'Aviso instantâneo sempre que um jogador morre — em combate contra outro jogador ou por ambiente (queda, fome, afogamento). Separado do Combate pra não misturar mortes sem PvP com o relatório de combate.',
        route: 'mortes',
        iniEvents: ['PlayerKilled']
    },
    {
        id: 'quest',
        name: `${EMOJIS.listchecks || '📜'} Quest`,
        label: 'Quest',
        emoji: EMOJIS.listchecks || '📜',
        description: 'Progresso de missões. Só gera log no Discord por enquanto.',
        route: 'quest',
        iniEvents: ['PlayerQuestComplete', 'PlayerQuestFailed']
    },
    {
        id: 'respawn',
        name: `${EMOJIS.refreshccw || '🔄'} Respawn`,
        label: 'Respawn',
        emoji: EMOJIS.refreshccw || '🔄',
        description: 'Reviver e teletransporte. Só gera log no Discord por enquanto.',
        route: 'respawn',
        iniEvents: ['PlayerRespawn', 'PlayerWaystone']
    },
    {
        id: 'chat',
        name: `${EMOJIS.messagecircle || '💬'} Chat`,
        label: 'Chat',
        emoji: EMOJIS.messagecircle || '💬',
        description: 'Mensagens e profanidade no chat do jogo. Só gera log no Discord por enquanto — útil pra moderação manual.',
        route: 'chat',
        iniEvents: ['PlayerChat', 'PlayerProfanity']
    },
    {
        id: 'comando',
        name: `${EMOJIS.raio || '⚡'} Comandos`,
        label: 'Comandos',
        emoji: EMOJIS.raio || '⚡',
        description: 'Comandos de jogadores (prefixo !). Só gera log no Discord por enquanto.',
        route: 'comando',
        iniEvents: ['PlayerCommand']
    },
    {
        id: 'grupo',
        name: `${EMOJIS.users || '👥'} Grupo`,
        label: 'Grupo',
        emoji: EMOJIS.users || '👥',
        description: 'Formação e dissolução de grupos. Só gera log no Discord por enquanto.',
        route: 'grupo',
        iniEvents: ['PlayerJoinedGroup', 'PlayerLeftGroup']
    },
    {
        id: 'servidor',
        name: `${EMOJIS.tv || '🖥️'} Servidor`,
        label: 'Servidor',
        emoji: EMOJIS.tv || '🖥️',
        description: 'Eventos, alertas e performance do servidor (start, restart, erros, tick baixo). Só gera log no Discord por enquanto — bom pra monitorar a saúde do servidor.',
        route: 'servidor',
        iniEvents: ['ServerStart', 'ServerRestart', 'ServerRestartCountdown', 'ServerModerate', 'ServerError', 'SecurityAlert', 'BadAverageTick']
    },
    {
        id: 'admin',
        name: `${EMOJIS.crown || '👑'} Admin`,
        label: 'Admin',
        emoji: EMOJIS.crown || '👑',
        description: 'Ações administrativas no jogo (espectador, comandos de admin). Só gera log no Discord por enquanto — útil pra auditoria da staff.',
        route: 'admin',
        iniEvents: ['AdminSpectate', 'AdminCommand']
    },
    {
        id: 'nest',
        name: `${EMOJIS.Nest || '🪺'} Nest`,
        label: 'Nest',
        emoji: EMOJIS.Nest || '🪺',
        description: 'Criação e gestão de ninhos. Só gera log no Discord por enquanto.',
        route: 'nest',
        iniEvents: ['CreateNest', 'DestroyNest', 'NestInvite', 'PlayerJoinNest', 'UpdateNest']
    }
];

class PoTConfigSystem {

    // ==================== SERVIDOR ====================

    static setServerConfig(guildId, config, userId) {
        db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET
                value = excluded.value,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
        `).run(guildId, 'pot_server_config', JSON.stringify(config), userId, Date.now());
    }

    static getServerConfig(guildId) {
        const result = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, 'pot_server_config');
        if (!result) return null;
        try { return JSON.parse(result.value); } catch { return null; }
    }

    // Lista todos os guild_id com um pot_server_config salvo e enabled=true —
    // usado no boot pra reconectar RCON de todo mundo automaticamente (ver
    // PathOfTitansIntegration.reconnectAllGuilds), já que rconClients é só em
    // memória e some a cada reinício do processo.
    static getAllConfiguredGuildIds() {
        const rows = db.prepare(`SELECT guild_id, value FROM settings WHERE key = 'pot_server_config'`).all();
        const guildIds = [];
        for (const row of rows) {
            try {
                const config = JSON.parse(row.value);
                if (config?.enabled === true) guildIds.push(row.guild_id);
            } catch { /* config corrompida/vazia — ignora essa guild */ }
        }
        return guildIds;
    }

    static isConfigured(guildId) {
        const config = this.getServerConfig(guildId);
        return config !== null && config.enabled === true;
    }

    // ==================== WEBHOOKS POR GRUPO ====================
    // Cada grupo (login, combate, quest...) tem uma URL de webhook Discord.
    // O bot recebe os eventos do PoT e posta nessas URLs já formatados.

    static setWebhookForGroup(guildId, groupId, webhookUrl) {
        db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `).run(guildId, `pot_group_webhook_${groupId}`, webhookUrl, Date.now());
    }

    static getWebhookForGroup(guildId, groupId) {
        const result = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `pot_group_webhook_${groupId}`);
        return result ? result.value : null;
    }

    static getAllGroupWebhooks(guildId) {
        const results = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ? AND key LIKE 'pot_group_webhook_%'`).all(guildId);
        const webhooks = {};
        for (const row of results) {
            webhooks[row.key.replace('pot_group_webhook_', '')] = row.value;
        }
        return webhooks;
    }

    static removeWebhookForGroup(guildId, groupId) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key = ?`).run(guildId, `pot_group_webhook_${groupId}`);
    }

    // ==================== WEBHOOKS LEGADOS (por evento individual) ====================
    // Mantidos para compatibilidade — não usados no fluxo novo de grupos.

    static setWebhookForEvent(guildId, event, webhookUrl) {
        db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(guildId, `pot_webhook_${event}`, webhookUrl, Date.now());
    }

    static getWebhookForEvent(guildId, event) {
        const result = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `pot_webhook_${event}`);
        return result ? result.value : null;
    }

    static getAllWebhookConfigs(guildId) {
        const results = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ? AND key LIKE 'pot_webhook_%'`).all(guildId);
        const configs = {};
        for (const row of results) configs[row.key.replace('pot_webhook_', '')] = row.value;
        return configs;
    }

    static removeWebhook(guildId, event) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key = ?`).run(guildId, `pot_webhook_${event}`);
    }

    static removeAllWebhooks(guildId) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_webhook_%'`).run(guildId);
    }

    // ==================== RCON ====================

    /**
     * PONTO ÚNICO por onde passa TODO comando RCON disparado pelo bot —
     * /strike, /unstrike, /ingame-*, /ingame-buff, /eventos (teleporte e
     * lembrete automático), /registrar e a Loja de Jogo (dashboard web)
     * chamam todos esta função, nunca a integração diretamente (ver
     * PathOfTitansIntegration.executeCommand). Isso é o que permite logar
     * TODO comando RCON num canal único (pedido do dono, 2026-08-09 —
     * ver _logRconExecution), sem precisar espalhar chamada de log em
     * cada um dos ~10 lugares que disparam RCON pelo bot.
     *
     * @param {string} guildId
     * @param {string} command - comando RCON já montado (ex: "kick AGID123 motivo")
     * @param {{actor?: string|null, source?: string}} [context] - opcional,
     *   só pra enriquecer o log (quem disparou / qual comando do bot) —
     *   nunca obrigatório, chamadores sem essa info (cron, automações) só
     *   omitem e o log cai no fallback "Sistema".
     */
    static async executeRconCommand(guildId, command, context = {}) {
        const { getInstance } = require('../../integrations/pathoftitans');
        const potIntegration = getInstance(global.client);
        if (!potIntegration) return { success: false, error: 'Integração não inicializada' };
        const result = await potIntegration.executeCommand(guildId, command);
        await this._logRconExecution(guildId, command, result, context);
        return result;
    }

    /**
     * Log compacto (1 linha, não um Container grande) de um comando RCON —
     * ver executeRconCommand acima. Compacto de propósito: o filtro de
     * chat automático (/config filtro) pode disparar isso em sequência
     * rápida, sem cooldown nenhum, então o formato precisa aguentar volume
     * sem virar um Container gigante por chamada. Best-effort: uma falha
     * aqui NUNCA pode derrubar o comando RCON que já rodou de verdade
     * (por isso o try/catch engole tudo, sem propagar).
     *
     * @param {string} guildId
     * @param {string} command
     * @param {{success: boolean, error?: string}} result
     * @param {{actor?: string|null, source?: string}} context
     */
    static async _logRconExecution(guildId, command, result, context = {}) {
        try {
            const ConfigSystem = require('../core/configSystem');
            const channelId = ConfigSystem.getSetting(guildId, 'log_rcon');
            if (!channelId) return;

            const client = global.client;
            const guild = client?.guilds?.cache?.get(guildId);
            if (!guild) return;
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel) return;

            const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
            const statusIcon = result?.success ? (EMOJIS.circlecheck || '✅') : (EMOJIS.circlealert || '❌');
            const actorText = context.actor || 'Sistema';
            const sourceText = context.source ? ` (${context.source})` : '';

            const builder = new AdvancedContainerBuilder({ accentColor: result?.success ? COLORS.DEFAULT : COLORS.ERROR });
            let line = `${statusIcon} ${actorText}${sourceText}: \`${command}\``;
            if (!result?.success && result?.error) {
                line += `\n${EMOJIS.trianglealert || '⚠️'} ${result.error}`;
            }
            builder.text(line);

            const { components, flags } = builder.build();
            await channel.send({ components, flags: [flags] });
        } catch (err) {
            // Best-effort — nunca deixa uma falha de log derrubar o RCON.
        }
    }

    // ==================== RESET ====================
    // O reset de verdade (chamado pelo botão de confirmação, ver
    // pot_reset_confirm_* em interactionCreate.js) mora em
    // src/commands/pot/reset.js executeReset — não aqui. Um resetConfig()
    // com essa mesma responsabilidade existiu aqui em paralelo, sem
    // NENHUM caller em lugar nenhum do bot, e ficou pra trás quando o
    // formato de chave dos webhooks mudou de 'pot_webhook_%' pra
    // 'pot_group_webhook_%' (fluxo por grupo) — a cópia em reset.js NÃO
    // foi atualizada junto, causando um bug real (reset de "logs"
    // reportava sucesso sem apagar nada de verdade, ver seção 159 do
    // PREMIUM.txt). Removida daqui de propósito: 2 cópias da mesma lógica
    // é exatamente como esse tipo de bug nasce — só reset.js continua
    // existindo agora, e já corrigido.

    static clearAllConfigs(guildId) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_%'`).run(guildId);
    }

    // ==================== STATS / VALIDAÇÃO ====================

    static getStats(guildId) {
        const config = this.getServerConfig(guildId);
        const groupWebhooks = this.getAllGroupWebhooks(guildId);
        return {
            configured: config !== null,
            enabled: config?.enabled || false,
            server_ip: config?.server_ip || null,
            webhook_count: Object.keys(groupWebhooks).length,
            has_rcon: !!(config?.rcon_password && config?.rcon_port)
        };
    }

    static validateConfig(guildId) {
        const config = this.getServerConfig(guildId);
        if (!config) return { valid: false, missing: ['server_config'] };
        const missing = [];
        if (!config.server_ip) missing.push('server_ip');
        if (!config.rcon_password) missing.push('rcon_password');
        if (!config.rcon_port) missing.push('rcon_port');
        return { valid: missing.length === 0 && config.enabled === true, missing, config };
    }
}

// EVENT_GROUPS exportado junto — usado pelo painel e pelo gateway
PoTConfigSystem.EVENT_GROUPS = EVENT_GROUPS;

module.exports = PoTConfigSystem;