// src/systems/premium/premiumSystem.js
/**
 * Sistema de tiers Premium — Player Premium (global, por usuário) e Server
 * Premium (por guild). Concessão é sempre manual por enquanto (sem gateway
 * de pagamento) — ver src/commands/developer/premium.js.
 *
 * Ponto único de consulta pra qualquer feature que precise saber o tier
 * atual de um jogador ou servidor (isPlayerAtLeast/isGuildAtLeast).
 */
const db = require('../../database/index');

const PLAYER_TIERS = { free: 0, compy: 1, raptor: 2 };
const GUILD_TIERS = { free: 0, pegada: 1, fossil: 2 };

// Limites concretos por tier de servidor — única fonte da verdade consultada
// pelo reportChatSystem (limite/cooldown de chats), punishmentSystem
// (reputação, RCON automático), historico.js (histórico de jogador) e
// autoModeration.js (manutenção diária de reputação/cargos automáticos —
// "automod" só roda de verdade no Fossil).
const GUILD_LIMITS = {
    free: { maxOpenChats: 1, chatCooldownMs: 14400000, autoRcon: false, reputationEnabled: false, automodEnabled: false, historyEnabled: false },
    pegada: { maxOpenChats: 3, chatCooldownMs: 0, autoRcon: false, reputationEnabled: true, automodEnabled: false, historyEnabled: true },
    fossil: { maxOpenChats: Infinity, chatCooldownMs: 0, autoRcon: true, reputationEnabled: true, automodEnabled: true, historyEnabled: true },
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
    getPlayerTier,
    getGuildTier,
    isPlayerAtLeast,
    isGuildAtLeast,
    getGuildLimits,
    grantPlayerPremium,
    grantGuildPremium,
    revokePlayerPremium,
    revokeGuildPremium,
    getPlayerPremiumInfo,
    getGuildPremiumInfo,
};
