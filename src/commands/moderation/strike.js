// /home/ubuntu/DiscStaffBot/src/commands/moderation/strike.js
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PremiumSystem = require('../../systems/premium/premiumSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('Aplica uma punição rápida e remove pontos de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('usuario').setDescription('Membro infrator').setRequired(true))
        .addIntegerOption(opt => opt.setName('gravidade').setDescription('Nível da infração').setRequired(true)
            .addChoices(
                { name: 'Nível 1 (Leve)', value: 1 },
                { name: 'Nível 2 (Moderada)', value: 2 },
                { name: 'Nível 3 (Grave)', value: 3 },
                { name: 'Nível 4 (Severa)', value: 4 },
                { name: 'Nível 5 (Permanente)', value: 5 }
            ))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true))
        .addStringOption(opt => opt.setName('duracao').setDescription('Tempo (Ex: 10m, 1h, 3d, 0 para Perm)').setRequired(true))
        .addStringOption(opt => opt.setName('report').setDescription('ID do Report (Opcional)').setRequired(false))
        .addStringOption(opt => opt.setName('discord_act').setDescription('Ação imediata no Discord')
            .addChoices(
                { name: 'Nenhuma', value: 'none' },
                { name: 'Mute (Timeout)', value: 'timeout' },
                { name: 'Expulsar (Kick)', value: 'kick' },
                { name: 'Banir (Ban)', value: 'ban' }
            ))
        .addStringOption(opt => opt.setName('jogo_act').setDescription('Ação imediata In-Game')
            .addChoices(
                { name: 'Nenhuma', value: 'none' },
                { name: 'Aviso na Tela', value: 'rcon_warn' },
                { name: 'Kick do Jogo', value: 'rcon_kick' },
                { name: 'Slay (Matar)', value: 'rcon_slay' },
                { name: 'Ban do Jogo', value: 'rcon_ban' }
            )),

    async execute(interaction, client) {
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;

        let emojis = {};
        try {
            emojis = require('../../database/emojis.js').EMOJIS || {};
        } catch (err) {}

        const targetUser = options.getUser('usuario');
        const severity = options.getInteger('gravidade');
        const reason = options.getString('motivo');
        const durationStr = options.getString('duracao');
        const discordAct = options.getString('discord_act') || 'none';
        const jogoAct = options.getString('jogo_act') || 'none';
        let reportId = options.getString('report') || null;

        try {
            if (!targetUser) {
                return await ResponseManager.error(interaction, 'Usuário não encontrado.');
            }

            // ── Report continua opcional (staff pode punir sem denúncia
            // formal por trás), mas quando informado precisa existir de fato
            // — evita punições "linkadas" a um report inexistente/digitado
            // errado. Aceita "#R5", "R5" ou só "5". ─────────────────────────
            if (reportId) {
                const match = reportId.trim().match(/^#?R?(\d+)$/i);
                if (!match) {
                    return await ResponseManager.error(interaction, 'ID de Report inválido. Use o formato #R5 (ou apenas 5).');
                }
                const reportNumber = parseInt(match[1]);
                const reportExists = db.prepare(`SELECT 1 FROM reports WHERE guild_id = ? AND report_number = ?`).get(guildId, reportNumber);
                if (!reportExists) {
                    return await ResponseManager.error(interaction, `Report #R${reportNumber} não encontrado neste servidor.`);
                }
                reportId = `#R${reportNumber}`;
            }

            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureUser(targetUser.id, targetUser.username, targetUser.discriminator, targetUser.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

            const ConfigSystem = require('../../systems/core/configSystem');

            const pointsMap = {
                1: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_1')) || 10,
                2: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_2')) || 25,
                3: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_3')) || 40,
                4: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_4')) || 60,
                5: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_5')) || 100
            };
            const pointsToLose = pointsMap[severity] || 10;

            let targetMember = null;
            try {
                targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            } catch (err) {
                targetMember = null;
            }

            const isStaffHigher = targetMember &&
                targetMember.roles.highest.position >= staffMember.roles.highest.position &&
                staff.id !== guild.ownerId;

            if (isStaffHigher) {
                db.logActivity(guildId, staff.id, 'strike_denied', targetUser.id, {
                    command: 'strike', reason: 'Hierarquia insuficiente', severity, pointsToLose
                });
                return await ResponseManager.error(interaction, 'Você não pode punir este membro.');
            }

            const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, targetUser.id)?.points || 100;
            const previewPoints = Math.max(0, currentRep - pointsToLose);

            // ── Guarda os dados da punição pendente. A aplicação real só
            // acontece quando o staff clicar em "Confirmar" (ver
            // punishmentSystem.handleStrikeConfirmation). Isso evita
            // punições aplicadas por engano com um clique só. ────────────────
            sessionManager.set(staff.id, guildId, 'strike_pending', 'strike_pending', {
                targetId: targetUser.id,
                reason,
                severity,
                durationStr,
                reportId,
                discordAct,
                jogoAct,
                pointsLost: pointsToLose
            }, 120000);

            const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
            const severityIcons = ['', emojis.severidadebaixa || '🟢', emojis.severidademedia || '🟡', emojis.severidadelaranja || '🟠', emojis.severidadealta || '🔴', emojis.Dead || '💀'];
            const discordActNames = { none: 'Nenhuma', timeout: 'Timeout (Mute)', kick: 'Expulsão', ban: 'Banimento' };
            const jogoActNames = { none: 'Nenhuma', rcon_warn: 'Aviso na Tela', rcon_kick: 'Kick do Jogo', rcon_slay: 'Slay (Matar)', rcon_ban: 'Ban do Jogo' };
            const isPermanent = durationStr === '0' || durationStr.toLowerCase() === 'perm';

            const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            builder.title(`${emojis.trianglealert || '⚠️'} Confirmar Aplicação de Strike`, 1);
            builder.separator();
            const { buildIdentityBlock } = require('../../utils/userIdentity');
            builder.section(
                `## JOGADOR\n${buildIdentityBlock(targetUser)}`,
                AdvancedContainerBuilder.thumbnail(targetUser.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png'),
            );
            builder.separator();
            builder.text(`${severityIcons[severity]} **Severidade:** ${severityNames[severity]}`);
            builder.text(`**${emojis.messagesquare || '📝'} Motivo:** ${reason}`);
            builder.text(`**${emojis.clockalert || '⏳'} Duração:** ${isPermanent ? 'Permanente' : durationStr}`);
            if (reportId) builder.text(`**${emojis.ticket || '🎫'} Report:** ${reportId}`);
            builder.separator();
            if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
                builder.text(`**${emojis.doublearrowdown || '📉'} Pontos a perder:** -${pointsToLose} (${currentRep} → ${previewPoints})`);
            }
            builder.text(`**${emojis.raio || '⚡'} Ação no Discord:** ${discordActNames[discordAct] || discordAct}`);
            builder.text(`**${emojis.game || '🎮'} Ação In-Game:** ${jogoActNames[jogoAct] || jogoAct}`);

            // ── Nível 4/5 OU duração >72h/permanente exigem aprovação de um
            // Supervisor (vale pra qualquer tier — ver
            // PunishmentSystem.requiresSupervisorApproval). Avisa o staff
            // ANTES de ele confirmar, já que quem não é Supervisor terá o
            // pedido enviado para aprovação em vez de aplicado na hora. ──────
            const PunishmentSystem = require('../../systems/moderation/punishmentSystem');
            if (PunishmentSystem.requiresSupervisorApproval({ severity, durationStr }) && !(await PunishmentSystem.memberHasSupervisorRole(guild, staffMember))) {
                builder.separator();
                builder.text(
                    `${emojis.shieldban || '🛡️'} **Requer aprovação de Supervisor**\n` +
                    `Esta punição é **${severityNames[severity]}** e/ou tem duração longa (>72h ou permanente). Como você não possui o cargo Supervisor (/config-roles), ao confirmar o pedido será enviado para o canal de log de punições, marcando o cargo Supervisor — a punição só será aplicada depois de aprovada.`
                );
            }

            builder.footer(guild.name, 'Confirme ou cancele abaixo. Esta confirmação expira em 2 minutos.');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('punishment:confirm:confirm').setLabel('Confirmar').setStyle(ButtonStyle.Success).setEmoji(emojis.circlecheck || '✅'),
                new ButtonBuilder().setCustomId('punishment:confirm:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji(emojis.circlealert || '❌')
            );

            const { components, flags } = builder.build();
            await interaction.editReply({ components: [...components, row], flags: [flags] });

        } catch (error) {
            console.error('❌ Erro no strike:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao preparar aplicação de strike. A equipe foi notificada.');
        }
    }
};