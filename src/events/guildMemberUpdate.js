// src/events/guildMemberUpdate.js
/**
 * Detecta ganho/perda dos cargos de staff configurados em /config roles
 * (Moderador/Supervisor/Equipe de Eventos — ver ConfigSystem.STAFF_ROLE_KEYS;
 * "Notificação de Eventos" fica de fora de propósito, é só um cargo de
 * avisos, não staff).
 *
 * Dois efeitos independentes:
 * 1. Log de ganho/perda em log_staff — só tier Caçador (analyticsEnabled).
 * 2. Purge do histórico agregado (staff_analytics) quando o membro fica sem
 *    NENHUM dos 3 cargos — independente de tier, é limpeza de dado ligada a
 *    perda de CARGO (fato do Discord), não uma feature paga. Ver
 *    AnalyticsSystem.purgeStaffOnRoleLoss.
 */
const ConfigSystem = require('../systems/core/configSystem');
const PremiumSystem = require('../systems/premium/premiumSystem');
const AnalyticsSystem = require('../systems/moderation/analyticsSystem');
const { AdvancedContainerBuilder, COLORS } = require('../utils/containerBuilder');

let EMOJIS = {};
try {
    EMOJIS = require('../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const ROLE_KEY_LABELS = {
    staff_role: 'Moderador',
    supervisor_role: 'Supervisor',
    event_role: 'Equipe de Eventos',
};

async function logRoleChanges(guild, user, changes) {
    try {
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_staff');
        if (!logChannelId) return;

        const channel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!channel) return;

        const lines = changes.map(c =>
            `${c.gained ? (EMOJIS.circlecheck || '✅') : (EMOJIS.circlealert || '❌')} ${user} ${c.gained ? 'ganhou' : 'perdeu'} o cargo **${ROLE_KEY_LABELS[c.key]}** (<@&${c.roleId}>)`
        );

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.title(`${EMOJIS.shield || '🛡️'} Cargo de Staff Alterado`, 1);
        builder.block(lines);
        builder.footer(guild.name);
        await channel.send(builder.build());
    } catch (err) {
        console.error('❌ [guildMemberUpdate] Erro ao enviar log de cargo:', err.message);
    }
}

module.exports = {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
        try {
            const guild = newMember.guild;
            const oldRoles = oldMember.roles.cache;
            const newRoles = newMember.roles.cache;

            const changes = [];
            for (const key of ConfigSystem.STAFF_ROLE_KEYS) {
                const configuredIds = ConfigSystem.getRoleIds(guild.id, key);
                for (const roleId of configuredIds) {
                    const had = oldRoles.has(roleId);
                    const has = newRoles.has(roleId);
                    if (had === has) continue;
                    changes.push({ key, roleId, gained: has });
                }
            }

            if (changes.length === 0) return;

            if (PremiumSystem.getGuildLimits(guild.id).analyticsEnabled) {
                await logRoleChanges(guild, newMember.user, changes);
            }

            const hadAnyStaffRoleBefore = ConfigSystem.STAFF_ROLE_KEYS.some(key =>
                ConfigSystem.getRoleIds(guild.id, key).some(id => oldRoles.has(id))
            );
            const hasAnyStaffRoleNow = ConfigSystem.memberHasAnyStaffRole(guild.id, newMember);

            if (hadAnyStaffRoleBefore && !hasAnyStaffRoleNow) {
                await AnalyticsSystem.purgeStaffOnRoleLoss(guild, newMember.user);
            }
        } catch (err) {
            console.error('❌ [guildMemberUpdate] Erro ao processar mudança de cargo:', err.message);
        }
    }
};
