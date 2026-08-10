// src/commands/moderation/staffonline.js
/**
 * Pedido do dono, 2026-08-07: "Crie um comando para visualizar os
 * staffs onlines pelo discord, e a quanto tempo eles estão online.
 * Comando de uso da moderação e supervisão." — mostra quem, dentre os
 * membros com cargo Moderador OU Supervisor (ver /config roles), está
 * online AGORA NO JOGO (Path of Titans), e há quanto tempo.
 *
 * AJUSTE, mesmo dia: a versão original checava presença do DISCORD
 * (online/ausente/não perturbe, via staffPresenceSystem.js) — o dono
 * pediu presença real NO JOGO. A fonte agora é pot_players.is_online
 * (populado ao vivo pelos webhooks PlayerLogin/PlayerLogout/PlayerLeave,
 * ver potPlayerRegistry.js), cruzado com player_links (vínculo Discord
 * <-> Alderon ID de /registrar) — por isso 3 estados, não 2: online no
 * jogo, vinculado mas offline no jogo, ou nunca vinculou o Discord a
 * uma conta do jogo (sem sinal de presença possível pra esse caso).
 * staffPresenceSystem.js continua existindo intacto (formatDuration é
 * reaproveitado por ser um formatador genérico de duração, sem nada
 * específico de presença do Discord) — só não é mais a fonte do status.
 *
 * Ephemeral (ver ephemeralCommands em handlers.js) — quem está
 * online/offline/não vinculado é informação só pra staff, não pro
 * canal inteiro.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const ConfigSystem = require('../../systems/core/configSystem');
const StaffPresenceSystem = require('../../systems/moderation/staffPresenceSystem');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const db = require('../../database/index');

let emojis = {};
try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

const STATUS_DOT = {
    online: emojis.powerverde || '🟢',
    offline: emojis.powervermelho || '🔴',
    unlinked: emojis.userx || '⚪',
};
const STATUS_LABEL = {
    online: 'Online no jogo',
    offline: 'Offline no jogo',
    unlinked: 'Não vinculado',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('staffonline')
        .setDescription('Mostra quais staffs (Moderador/Supervisor) estão online AGORA no jogo, e há quanto tempo.')
        // null, não ModerateMembers — mesmo raciocínio do /strike (ver
        // comentário completo em strike/index.js). Checagem real já dentro
        // de execute().
        .setDefaultMemberPermissions(null),

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

            // Presença real NO JOGO por staff: sem vínculo (/registrar) não há
            // nenhum sinal de presença possível — por isso 3 estados, não 2
            // (ver docblock no topo do arquivo).
            const staffStatuses = [...staffMembers.values()].map(m => {
                const link = PlayerRegistry.getPlayerByDiscordId(m.id);
                if (!link) return { userId: m.id, state: 'unlinked', startedAt: null };

                const potPlayer = db.prepare(`
                    SELECT is_online, session_started_at FROM pot_players WHERE guild_id = ? AND alderon_id = ?
                `).get(guild.id, link.alderon_id);

                return potPlayer?.is_online
                    ? { userId: m.id, state: 'online', startedAt: potPlayer.session_started_at }
                    : { userId: m.id, state: 'offline', startedAt: null };
            });

            const STATE_PRIORITY = { online: 0, offline: 1, unlinked: 2 };
            staffStatuses.sort((a, b) => {
                if (STATE_PRIORITY[a.state] !== STATE_PRIORITY[b.state]) return STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
                if (a.state === 'online') return (a.startedAt || 0) - (b.startedAt || 0); // quem está online há mais tempo primeiro
                return 0;
            });

            const onlineCount = staffStatuses.filter(s => s.state === 'online').length;

            const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            builder.title(`${emojis.wifi || '📶'} Staff Online no Jogo`, 1);
            builder.separator();

            if (staffMembers.size === 0) {
                builder.text(`${emojis.wifioff || '📴'} Nenhum membro com cargo de Moderador ou Supervisor encontrado neste servidor.`);
            } else {
                const now = Date.now();
                const lines = staffStatuses.map(s => {
                    const dot = STATUS_DOT[s.state] || '⚪';
                    const label = STATUS_LABEL[s.state] || s.state;
                    const durationSuffix = (s.state === 'online' && s.startedAt)
                        ? ` · ${emojis.clock || '🕒'} ${StaffPresenceSystem.formatDuration(now - s.startedAt)} online`
                        : '';
                    return `${dot} <@${s.userId}> — ${label}${durationSuffix}`;
                });
                builder.block(lines);
                builder.separator();
                builder.text(`${emojis.users || '👥'} ${onlineCount} de ${staffMembers.size} staff configurado${staffMembers.size === 1 ? '' : 's'} está${onlineCount === 1 ? '' : 'ão'} online no jogo agora.`);
            }

            builder.footer(guild, 'Status e duração vêm da sessão atual no jogo (webhooks do Path of Titans) — staff sem /registrar aparece como "Não vinculado".');
            await ResponseManager.send(interaction, builder);
        } catch (error) {
            console.error('❌ Erro no staffonline:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao consultar staff online.');
        }
    },
};
