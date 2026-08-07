// src/commands/moderation/staffonline.js
/**
 * Pedido do dono, 2026-08-07: "Crie um comando para visualizar os
 * staffs onlines pelo discord, e a quanto tempo eles estão online.
 * Comando de uso da moderação e supervisão." — mostra quem, dentre os
 * membros com cargo Moderador OU Supervisor (ver /config roles), está
 * online/ausente/não perturbe no Discord agora, e há quanto tempo cada
 * um está nessa sessão contínua (ver staffPresenceSystem.js pra como
 * essa duração é rastreada — a API do Discord não guarda isso sozinha).
 *
 * Ephemeral (ver ephemeralCommands em handlers.js) — quem está
 * online/ausente é informação só pra staff, não pro canal inteiro.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const ConfigSystem = require('../../systems/core/configSystem');
const StaffPresenceSystem = require('../../systems/moderation/staffPresenceSystem');

let emojis = {};
try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

const STATUS_DOT = { online: '🟢', idle: '🟡', dnd: '🔴' };
const STATUS_LABEL = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe' };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('staffonline')
        .setDescription('Mostra quais staffs (Moderador/Supervisor) estão online no Discord agora, e há quanto tempo.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers), // só sugestão de default no Discord — checagem real do cargo Moderador/Supervisor (ou Administrador) é feita dentro de execute()

    async execute(interaction, client) {
        const { guild, member } = interaction;
        try {
            if (!ConfigSystem.memberHasModOrSupervisorRole(guild.id, member) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await ResponseManager.error(interaction, 'Este comando é restrito à equipe do servidor (cargo Moderador ou Supervisor, ver /config roles) ou a Administradores.');
            }

            const staffRoleIds = [...new Set([
                ...ConfigSystem.getRoleIds(guild.id, 'staff_role'),
                ...ConfigSystem.getRoleIds(guild.id, 'supervisor_role'),
            ])];
            if (staffRoleIds.length === 0) {
                return await ResponseManager.error(interaction, 'Nenhum cargo de Moderador ou Supervisor configurado ainda — veja /config roles.');
            }

            // Fetch cheio (não tem endpoint de "membros com o cargo X" na API
            // do Discord) — cai pro cache se o fetch falhar em vez de quebrar
            // o comando por causa de uma falha passageira da API.
            const guildMembers = await guild.members.fetch().catch(() => guild.members.cache);
            const staffMembers = guildMembers.filter(m => !m.user.bot && staffRoleIds.some(id => m.roles.cache.has(id)));

            const onlineRows = StaffPresenceSystem.getOnlineStaff(guild.id, [...staffMembers.keys()]);

            const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            builder.title(`${emojis.wifi || '📶'} Staff Online`, 1);
            builder.separator();

            if (onlineRows.length === 0) {
                builder.text(`${emojis.wifioff || '📴'} Nenhum staff está online no Discord agora (${staffMembers.size} configurado${staffMembers.size === 1 ? '' : 's'}).`);
            } else {
                const now = Date.now();
                const lines = onlineRows.map(row => {
                    const dot = STATUS_DOT[row.status] || '⚪';
                    const label = STATUS_LABEL[row.status] || row.status;
                    const duration = StaffPresenceSystem.formatDuration(now - row.startedAt);
                    return `${dot} <@${row.userId}> — ${label} · ${emojis.clock || '🕒'} ${duration} online`;
                });
                builder.block(lines);
                builder.separator();
                builder.text(`${emojis.users || '👥'} ${onlineRows.length} de ${staffMembers.size} staff configurado${staffMembers.size === 1 ? '' : 's'} está${onlineRows.length === 1 ? '' : 'ão'} online.`);
            }

            builder.footer(guild.name, 'Duração calculada desde a última vez que ficou offline (reseta a cada restart do bot).');
            await ResponseManager.send(interaction, builder);
        } catch (error) {
            console.error('❌ Erro no staffonline:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao consultar staff online.');
        }
    },
};
