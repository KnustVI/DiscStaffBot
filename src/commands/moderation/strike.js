// /home/ubuntu/DiscStaffBot/src/commands/moderation/strike.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const imageManager = require('../../utils/imageManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('Aplica uma punição rápida e remove pontos de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('usuario').setDescription('Membro infrator').setRequired(true))
        .addIntegerOption(opt => opt.setName('gravidade').setDescription('Nível da infração').setRequired(true)
            .addChoices(
                { name: 'Nível 1 (-10 pts)', value: 1 },
                { name: 'Nível 2 (-25 pts)', value: 2 },
                { name: 'Nível 3 (-40 pts)', value: 3 },
                { name: 'Nível 4 (-60 pts)', value: 4 },
                { name: 'Nível 5 (-100 pts)', value: 5 }
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
        const startTime = Date.now();
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        const targetUser = options.getUser('usuario');
        const severity = options.getInteger('gravidade');
        const reason = options.getString('motivo');
        const durationStr = options.getString('duracao');
        const discordAct = options.getString('discord_act') || 'none';
        const jogoAct = options.getString('jogo_act') || 'none';
        const reportId = options.getString('report') || null;
        
        try {
            if (!targetUser) {
                return await ResponseManager.error(interaction, 'Usuário não encontrado.');
            }
            
            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureUser(targetUser.id, targetUser.username, targetUser.discriminator, targetUser.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            const PunishmentSystem = require('../../systems/punishmentSystem');
            
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
            const newPoints = Math.max(0, currentRep - pointsToLose);
            
            let expiresAt = null;
            let durationMs = 0;
            if (durationStr !== '0' && durationStr.toLowerCase() !== 'perm') {
                durationMs = PunishmentSystem.parseDuration(durationStr);
                if (durationMs > 0) expiresAt = Date.now() + durationMs;
            }
            
            const strikeId = PunishmentSystem.applyPunishment(
                guildId, 
                targetUser.id, 
                staff.id, 
                reason, 
                severity, 
                reportId || null, 
                pointsToLose
            );
            
            if (!strikeId) {
                return await ResponseManager.error(interaction, 'Erro ao aplicar punição no banco de dados.');
            }
            
            let discordActionResult = null;
            if (discordAct !== 'none' && targetMember) {
                try {
                    switch (discordAct) {
                        case 'timeout':
                            await targetMember.timeout(durationMs > 0 ? durationMs : 60000, reason);
                            discordActionResult = `Timeout de ${durationStr || '1 minuto'} aplicado`;
                            break;
                        case 'kick':
                            await targetMember.kick(reason);
                            discordActionResult = 'Expulsão aplicada';
                            break;
                        case 'ban':
                            await targetMember.ban({ reason });
                            discordActionResult = 'Banimento aplicado';
                            break;
                    }
                } catch (err) {
                    discordActionResult = `❌ Erro: ${err.message}`;
                }
            }

            // ── Cargo temporário de Strike (config-roles → strike_role) ─────────
            // Aplicado apenas se a punição NÃO for permanente (durationMs > 0).
            // O registro em temporary_roles garante remoção automática pelo
            // worker em PunishmentSystem.initWorker().
            const roleResult = await PunishmentSystem.applyTemporaryRole(guild, targetMember, durationMs);

            db.logActivity(guildId, staff.id, 'strike', targetUser.id, {
                command: 'strike', punishmentId: strikeId, severity, pointsLost: pointsToLose,
                oldPoints: currentRep, newPoints, reason, duration: durationStr, discordAct, jogoAct,
                temporaryRoleApplied: roleResult.applied
            });
            
            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);
            
            const containerBuilder = PunishmentSystem.generateStrikeUnifiedContainer(
                targetUser,
                staff,
                strikeId,
                severity,
                reason,
                reportId || null,
                pointsToLose,
                newPoints,
                discordAct,
                discordActionResult,
                guild.name,
                null
            );

            const { components, flags } = containerBuilder.build();

            // ── Banner de título: attachment buscado uma vez, reenviado em
            // toda mensagem que usa este container (DM e canal de log) ────────
            const bannerAttachment = imageManager.getAttachment('title_strike');
            const filesPayload = bannerAttachment ? [bannerAttachment] : [];

            // ── DM do usuário — captura o resultado REAL do envio (não engole
            // o erro), para sabermos se a DM foi entregue de fato e avisar o
            // staff corretamente. Discord não tem "verificar antes de enviar":
            // a única forma confiável é tentar enviar e checar o resultado. ────
            let dmDelivered = false;
            if (targetMember) {
                try {
                    await targetMember.send({ components, flags: [flags], files: filesPayload });
                    dmDelivered = true;
                } catch (err) {
                    // Erro 50007 = "Cannot send messages to this user" → DMs bloqueadas/fechadas.
                    dmDelivered = false;
                    console.warn(`⚠️ [STRIKE] Não foi possível enviar DM para ${targetUser.tag}: ${err.message}`);
                }
            }

            // ── Log no canal configurado (log_punishments) ──────────────────────
            let logSent = false;
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_punishments');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        await logChannel.send({ components, flags: [flags], files: filesPayload });
                        logSent = true;
                    } else {
                        console.warn(`⚠️ [STRIKE] Canal de log de punições (${logChannelId}) não encontrado/acessível.`);
                    }
                } catch (err) {
                    console.error('❌ Erro ao enviar log de punição no canal:', err);
                }
            } else {
                console.warn(`⚠️ [STRIKE] Canal de log de punições não configurado para a guild ${guildId}.`);
            }

            // ── Monta o aviso para o staff que aplicou o strike ──────────────────
            const dmStatusMsg = dmDelivered
                ? `${emojis.Check || '✅'} O jogador foi notificado em sua DM.`
                : `${emojis.Error || '❌'} O jogador tem as DM bloqueadas e não recebeu a notificação do strike.`;

            const roleStatusMsg = roleResult.applied
                ? `${emojis.strike || '⚠️'} Cargo de Strike aplicado temporariamente.`
                : (roleResult.error ? `${emojis.Note || 'ℹ️'} Cargo de Strike não aplicado: ${roleResult.error}` : null);

            const summaryLines = [
                `✅ **Strike #${strikeId} aplicado em ${targetUser.username}**`,
                `📉 ${pointsToLose} pts perdidos`,
                `⭐ Reputação: ${newPoints}/100`,
                dmStatusMsg,
            ];
            if (roleStatusMsg) summaryLines.push(roleStatusMsg);
            if (!logSent) summaryLines.push(`${emojis.Warning || '⚠️'} A mensagem de log não foi enviada ao canal (verifique a configuração em /config-logs).`);

            await interaction.editReply({ 
                content: summaryLines.join('\n'),
                components: []
            });
            
            console.log(`📊 [STRIKE] ${staff.tag} puniu ${targetUser.tag} | #${strikeId} | DM:${dmDelivered} | Log:${logSent} | Cargo:${roleResult.applied} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no strike:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao aplicar strike. A equipe foi notificada.');
        }
    }
};