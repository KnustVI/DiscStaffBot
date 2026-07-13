// src/systems/premium/premiumSystem.js
/**
 * Sistema de tiers Premium — Player Premium (global, por usuário) e Server
 * Premium (por guild). Concessão é sempre manual por enquanto (sem gateway
 * de pagamento) — ver src/commands/developer/premium-admin.js.
 *
 * Ponto único de consulta pra qualquer feature que precise saber o tier
 * atual de um jogador ou servidor (isPlayerAtLeast/isGuildAtLeast).
 */
const db = require('../../database/index');

const PLAYER_TIERS = { free: 0, compy: 1, raptor: 2 };
const GUILD_TIERS = { free: 0, rastreador: 1, cacador: 2 };

// Bônus de compra: o DONO do servidor Discord ganha o Player Premium
// correspondente ao comprar Server Premium — ver premium-admin.js (guild grant).
const GUILD_TO_PLAYER_TIER = { rastreador: 'compy', cacador: 'raptor' };

// Nomes exibidos ao usuário para cada tier de Server Premium. Os valores
// internos ('free'/'rastreador'/'cacador', usados no banco e em todo o
// código) já batem 1:1 com o rótulo — antes eram 'pegada'/'fossil'
// (nomes de planejamento antigos); migrados nesta revisão, incluindo as
// linhas já gravadas em guild_premium (ver DatabaseManager.createAllTables
// → migrateGuildPremiumTierNames, idempotente).
const GUILD_TIER_DISPLAY = { free: 'Free', rastreador: 'Rastreador', cacador: 'Caçador' };

// Limites concretos por tier de servidor — única fonte da verdade consultada
// pelo reportChatSystem (limite de chats/revisões + cooldown), punishmentSystem
// (reputação, ações no Discord via strike, RCON automático), historico.js
// (histórico de jogador), evento.js (nível do sistema de eventos) e
// autoModeration.js (manutenção diária de reputação/cargos automáticos —
// "automod" só roda de verdade no Caçador). Espelha o planejamento de
// features do /premium (ver premiumPanel.js) — reports e revisões de
// punição têm contadores SEPARADOS (não é mais um limite combinado).
const GUILD_LIMITS = {
    free: {
        maxOpenReports: 1, maxOpenReviews: 1, chatCooldownMs: 21600000,
        discordActionsEnabled: false, autoRcon: false,
        reputationEnabled: false, automodEnabled: false, historyEnabled: false,
        analyticsEnabled: false, temporaryRoleEnabled: false,
        eventTier: 'basic',
        maxPunishmentLevels: 0,
        damageReportEnabled: false,
        // Quantos cargos cada categoria de /config roles aceita (moderação/
        // eventos) — ver configSystem.js ROLE_TABS[*].fields[*].roleLimitKey.
        // Pra tornar uma categoria ilimitada no futuro, basta trocar o valor
        // por Infinity aqui — o painel já limita a UI em 25 (teto do próprio
        // RoleSelectMenu do Discord), sem precisar mudar código nenhum.
        roleLimits: { moderador: 1, supervisor: 1, event: 1, eventNotify: 1 },
        // Catálogo completo de comandos in-game (RCON) do PoT (/ingame-*, ver
        // rconCommandCatalog.js) — diferente de `autoRcon` (só a ação em
        // jogo automática do /strike, já Rastreador+), este libera comandos
        // livres de admin (godmode, restart, whitelist, etc.), por isso é
        // Caçador-exclusivo.
        genericRconEnabled: false,
        // Exigência de aprovação de Supervisor configurável POR NÍVEL (ver
        // punishmentLevels.js, coluna requires_supervisor_approval) — só
        // Caçador. Free/Rastreador continuam na regra automática fixa
        // (severidade Grave/Severa OU duração >72h/permanente, ver
        // punishmentSystem.requiresSupervisorApproval).
        customPunishmentApprovalEnabled: false,
    },
    rastreador: {
        maxOpenReports: 3, maxOpenReviews: 3, chatCooldownMs: 0,
        discordActionsEnabled: true, autoRcon: true,
        reputationEnabled: true, automodEnabled: false, historyEnabled: true,
        analyticsEnabled: false, temporaryRoleEnabled: true,
        eventTier: 'medium',
        maxPunishmentLevels: 4,
        damageReportEnabled: true,
        roleLimits: { moderador: 3, supervisor: 1, event: 3, eventNotify: 1 },
        genericRconEnabled: false,
        customPunishmentApprovalEnabled: false,
    },
    cacador: {
        maxOpenReports: Infinity, maxOpenReviews: Infinity, chatCooldownMs: 0,
        discordActionsEnabled: true, autoRcon: true,
        reputationEnabled: true, automodEnabled: true, historyEnabled: true,
        analyticsEnabled: true, temporaryRoleEnabled: true,
        eventTier: 'full',
        maxPunishmentLevels: 10,
        damageReportEnabled: true,
        roleLimits: { moderador: 5, supervisor: 5, event: 5, eventNotify: 5 },
        genericRconEnabled: true,
        customPunishmentApprovalEnabled: true,
    },
};

function _isExpired(expiresAt) {
    return typeof expiresAt === 'number' && expiresAt < Date.now();
}

function getPlayerTier(userId) {
    if (!userId) return 'free';
    try {
        const row = db.prepare(`SELECT tier, expires_at FROM player_premium WHERE user_id = ?`).get(userId);
        if (!row || _isExpired(row.expires_at)) return 'free';
        return row.tier;
    } catch (error) {
        console.error('❌ [Premium] Erro ao ler tier do jogador:', error);
        return 'free';
    }
}

function getGuildTier(guildId) {
    if (!guildId) return 'free';
    try {
        const row = db.prepare(`SELECT tier, expires_at FROM guild_premium WHERE guild_id = ?`).get(guildId);
        if (!row || _isExpired(row.expires_at)) return 'free';
        return row.tier;
    } catch (error) {
        console.error('❌ [Premium] Erro ao ler tier do servidor:', error);
        return 'free';
    }
}

function isPlayerAtLeast(userId, tier) {
    return (PLAYER_TIERS[getPlayerTier(userId)] ?? 0) >= (PLAYER_TIERS[tier] ?? 0);
}

function isGuildAtLeast(guildId, tier) {
    return (GUILD_TIERS[getGuildTier(guildId)] ?? 0) >= (GUILD_TIERS[tier] ?? 0);
}

function getGuildLimits(guildId) {
    return GUILD_LIMITS[getGuildTier(guildId)];
}

/**
 * Limite de cargos configuráveis por categoria em /config roles
 * ('moderador'|'supervisor'|'event'|'eventNotify' — ver configSystem.js
 * ROLE_TABS). 1 se a categoria não existir no tier atual (defensivo).
 */
function getRoleLimit(guildId, categoryKey) {
    return getGuildLimits(guildId).roleLimits?.[categoryKey] ?? 1;
}

/**
 * Mensagem padrão exibida por QUALQUER comando/botão bloqueado pelo tier
 * atual do servidor — sempre no mesmo formato genérico, apontando pro
 * /premium (não cita mais o tier específico do servidor).
 */
function getGuildDenialMessage(guildId) {
    return 'Este comando está disponível apenas para servidores com um plano Premium ativo. Use /premium para conhecer os benefícios e opções disponíveis.';
}

function grantPlayerPremium(userId, tier, days, grantedBy, notes = null) {
    const now = Date.now();
    const expiresAt = days ? now + days * 86400000 : null;
    db.prepare(`
        INSERT INTO player_premium (user_id, tier, granted_by, granted_at, expires_at, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            tier = excluded.tier,
            granted_by = excluded.granted_by,
            granted_at = excluded.granted_at,
            expires_at = excluded.expires_at,
            notes = excluded.notes,
            updated_at = excluded.updated_at
    `).run(userId, tier, grantedBy, now, expiresAt, notes, Math.floor(now / 1000));
}

function grantGuildPremium(guildId, tier, days, grantedBy, notes = null) {
    const now = Date.now();
    const expiresAt = days ? now + days * 86400000 : null;
    db.prepare(`
        INSERT INTO guild_premium (guild_id, tier, granted_by, granted_at, expires_at, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
            tier = excluded.tier,
            granted_by = excluded.granted_by,
            granted_at = excluded.granted_at,
            expires_at = excluded.expires_at,
            notes = excluded.notes,
            updated_at = excluded.updated_at
    `).run(guildId, tier, grantedBy, now, expiresAt, notes, Math.floor(now / 1000));
}

function revokePlayerPremium(userId, revokedBy) {
    const now = Date.now();
    db.prepare(`
        UPDATE player_premium SET tier = 'free', expires_at = ?, granted_by = ?, updated_at = ?
        WHERE user_id = ?
    `).run(now, revokedBy, Math.floor(now / 1000), userId);
}

function revokeGuildPremium(guildId, revokedBy) {
    const now = Date.now();
    db.prepare(`
        UPDATE guild_premium SET tier = 'free', expires_at = ?, granted_by = ?, updated_at = ?
        WHERE guild_id = ?
    `).run(now, revokedBy, Math.floor(now / 1000), guildId);
}

function getPlayerPremiumInfo(userId) {
    try {
        const row = db.prepare(`SELECT * FROM player_premium WHERE user_id = ?`).get(userId);
        if (!row) return { user_id: userId, tier: 'free', granted_by: null, granted_at: null, expires_at: null, notes: null };
        return row;
    } catch (error) {
        console.error('❌ [Premium] Erro ao ler info de premium do jogador:', error);
        return { user_id: userId, tier: 'free', granted_by: null, granted_at: null, expires_at: null, notes: null };
    }
}

function getGuildPremiumInfo(guildId) {
    try {
        const row = db.prepare(`SELECT * FROM guild_premium WHERE guild_id = ?`).get(guildId);
        if (!row) return { guild_id: guildId, tier: 'free', granted_by: null, granted_at: null, expires_at: null, notes: null };
        return row;
    } catch (error) {
        console.error('❌ [Premium] Erro ao ler info de premium do servidor:', error);
        return { guild_id: guildId, tier: 'free', granted_by: null, granted_at: null, expires_at: null, notes: null };
    }
}

module.exports = {
    PLAYER_TIERS,
    GUILD_TIERS,
    GUILD_LIMITS,
    GUILD_TO_PLAYER_TIER,
    GUILD_TIER_DISPLAY,
    getPlayerTier,
    getGuildTier,
    isPlayerAtLeast,
    isGuildAtLeast,
    getGuildLimits,
    getRoleLimit,
    getGuildDenialMessage,
    grantPlayerPremium,
    grantGuildPremium,
    revokePlayerPremium,
    revokeGuildPremium,
    getPlayerPremiumInfo,
    getGuildPremiumInfo,
};
