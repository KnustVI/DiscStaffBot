// /home/ubuntu/DiscStaffBot/src/commands/moderation/unstrike.js
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const { buildIdentityBlock } = require('../../utils/userIdentity');
const PunishmentSystem = require('../../systems/moderation/punishmentSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unstrike')
        .setDescription('Anula uma punição e devolve os pontos ao usuário.')
        // Renomeado de "id" pra "id_strike" (pedido do dono, 2026-08-07:
        // "pedir só ID confundiu com AGID") — o nome curto "id" sozinho
        // levava staff a digitar o Alderon ID do jogador por engano, em
        // vez do número do strike. Descrição também reforça a diferença.
        .addIntegerOption(opt => opt.setName('id_strike').setDescription('Número de ID do Strike a anular — NÃO é o Alderon ID/AGID. É o número mostrado em "Strike #IDN".').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da anulação').setRequired(true))
        // null, não ModerateMembers — mesmo raciocínio do /strike (ver
        // comentário completo em strike/index.js): ModerateMembers como
        // default fazia o Discord bloquear cargos configurados em /config
        // roles sem essa permissão nativa ANTES da interação chegar no bot,
        // sem log nenhum. Checagem real já dentro de execute().
        .setDefaultMemberPermissions(null),

    async execute(interaction, client) {
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;

        const punishmentId = options.getInteger('id_strike');
        const reason = options.getString('motivo');

        let emojis = {};
        try {
            emojis = require('../../database/emojis.js').EMOJIS || {};
        } catch (err) {}

        try {
            // ── Checagem REAL de permissão (pedido do dono, 2026-08-07) —
            // mesmo raciocínio do /strike: exige o cargo Moderador ou
            // Supervisor configurado, ou Administrador de verdade. ────────
            const ConfigSystem = require('../../systems/core/configSystem');
            if (!ConfigSystem.memberHasModOrSupervisorRole(guildId, staffMember) && !staffMember.permissions.has(PermissionFlagsBits.Administrator)) {
                return await ResponseManager.error(interaction, 'Este comando é restrito à equipe do servidor (cargo Moderador ou Supervisor, ver /config roles) ou a Administradores.');
            }

            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

            // ── Busca por strike_number (o número mostrado como "Strike #IDN" em
            // todo o resto do sistema), não pela PK global `id` — `id` é um
            // auto-increment cross-guild, então bater com ele aqui podia
            // encontrar a punição errada assim que o bot atende 2+ servidores. ──
            const punishment = db.prepare(`
                SELECT * FROM punishments WHERE strike_number = ? AND guild_id = ? AND status = 'active'
            `).get(punishmentId, guildId);

            if (!punishment) {
                return await ResponseManager.error(interaction, `Punição #ID${punishmentId} não encontrada ou já anulada.`);
            }

            let targetMember = null;
            try {
                targetMember = await guild.members.fetch(punishment.user_id).catch(() => null);
            } catch (err) {}

            const isStaffHigher = targetMember &&
                targetMember.roles.highest.position >= staffMember.roles.highest.position &&
                staff.id !== guild.ownerId;

            if (isStaffHigher) {
                return await ResponseManager.error(interaction, 'Você não pode anular punições de um cargo superior.');
            }

            const targetUser = await client.users.fetch(punishment.user_id).catch(() => null);
            const pointsToRestore = punishment.points_deducted || 0;
            const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`)
                .get(guildId, punishment.user_id)?.points || 100;
            const previewPoints = Math.min(100, currentRep + pointsToRestore);

            // ── Guarda os dados da anulação pendente. A aplicação real só
            // acontece quando o staff clicar em "Confirmar" (ver
            // punishmentSystem.handleUnstrikeConfirmation). Mesmo padrão do
            // /strike, evita anulações aplicadas por engano com um clique só. ──
            sessionManager.set(staff.id, guildId, 'unstrike_pending', 'unstrike_pending', {
                punishmentId,
                reason,
            }, 120000);

            const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            builder.title(`${emojis.trianglealert || '⚠️'} Confirmar Anulação de Strike`, 1);
            builder.separator();
            builder.section(
                `## JOGADOR\n${buildIdentityBlock(targetUser || { toString: () => `\`${punishment.user_id}\``, username: '?', id: punishment.user_id })}`,
                AdvancedContainerBuilder.thumbnail(targetUser?.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png'),
            );
            builder.separator();
            const severityIcon = PunishmentSystem.severityIconFor({ levelSeverity: punishment.level_severity, severity: punishment.severity });
            builder.text(`${severityIcon} **Strike:** #ID${punishmentId}${punishment.level_name ? ` (${punishment.level_name})` : ''}`);
            builder.text(`**${emojis.messagesquare || '📝'} Motivo original:** ${punishment.reason}`);
            builder.text(`**${emojis.messagesquare || '📝'} Motivo da anulação:** ${reason}`);
            builder.separator();
            if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
                builder.text(`**${emojis.doublearrowup || '📈'} Pontos a restaurar:** +${pointsToRestore} (${currentRep} → ${previewPoints})`);
            }
            builder.footer(guild.name, 'Confirme ou cancele abaixo. Esta confirmação expira em 2 minutos.');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('punishment:unstrike_confirm:confirm').setLabel('Confirmar').setStyle(ButtonStyle.Success).setEmoji(emojis.circlecheck || '✅'),
                new ButtonBuilder().setCustomId('punishment:unstrike_confirm:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji(emojis.circlealert || '❌')
            );

            const { components, flags } = builder.build();
            await interaction.editReply({ components: [...components, row], flags: [flags] });

        } catch (error) {
            console.error('❌ Erro no unstrike:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao preparar anulação de strike. A equipe foi notificada.');
        }
    }
};
