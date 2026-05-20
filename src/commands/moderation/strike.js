// /home/ubuntu/DiscStaffBot/src/commands/moderation/strike.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');

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
            
            const currentRep = ConfigSystem.getSetting(guildId, `rep_${targetUser.id}`) || 
                db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, targetUser.id)?.points || 100;
            
            const newPoints = Math.max(0, currentRep - pointsToLose);
            
            let expiresAt = null;
            let durationMs = 0;
            if (durationStr !== '0' && durationStr.toLowerCase() !== 'perm') {
                durationMs = PunishmentSystem.parseDuration(durationStr);
                if (durationMs > 0) expiresAt = Date.now() + durationMs;
            }
            
            const punishmentUuid = db.generateUUID();
            const strikeId = db.prepare(`
                INSERT INTO punishments (uuid, guild_id, user_id, moderator_id, reason, severity, 
                    points_deducted, report_id, created_at, expires_at, status, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(punishmentUuid, guildId, targetUser.id, staff.id, reason, severity,
                pointsToLose, reportId || null, Date.now(), expiresAt, 'active',
                JSON.stringify({ discordAct, jogoAct, duration: durationStr })
            ).lastInsertRowid;
            
            db.prepare(`UPDATE reputation SET points = ?, updated_at = ?, updated_by = ?
                WHERE guild_id = ? AND user_id = ?`).run(newPoints, Date.now(), staff.id, guildId, targetUser.id);
            
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
            
            db.logActivity(guildId, staff.id, 'strike', targetUser.id, {
                command: 'strike', punishmentId: strikeId, severity, pointsLost: pointsToLose,
                oldPoints: currentRep, newPoints, reason, duration: durationStr, discordAct, jogoAct
            });
            
            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);
            
            // ==================== GERAR CONTAINER UNIFICADO ====================
            console.log('🔍 [DEBUG] Gerando container unificado...');
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
        console.log('🔍 [DEBUG] containerBuilder:', containerBuilder ? 'existe' : 'null');
        console.log('🔍 [DEBUG] containerBuilder.build:', typeof containerBuilder?.build);
        console.log('🔍 [DEBUG] builtContainer components:', JSON.stringify(builtContainer.components?.length));
            // ==================== ENVIAR DM PARA O USUÁRIO ====================
            if (targetMember) {
                try {
                    const builtContainer = containerBuilder.build();
                    console.log('🔍 [DEBUG] builtContainer:', builtContainer ? 'ok' : 'null');
                    
                    await targetMember.send({
                        components: [builtContainer],
                        flags: ['IsComponentsV2']
                    }).catch(() => null);
                    console.log('✅ [DEBUG] DM enviada para ${targetUser.tag}');
                } catch (err) {
                    console.error('❌ Erro ao enviar DM:', err);
                }
            } else {
                console.log('⚠️ [DEBUG] targetMember não encontrado, DM não enviada');
            }


            // ==================== ENVIAR LOG PARA O CANAL ====================
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_punishments');
            console.log('🔍 [DEBUG] logChannelId:', logChannelId);
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    console.log('🔍 [DEBUG] logChannel:', logChannel ? logChannel.name : 'não encontrado');
                    if (logChannel) {
                        const builtContainer = containerBuilder.build();
                        await logChannel.send({
                            components: [builtContainer],
                            flags: ['IsComponentsV2']
                        }).catch(() => null);
                        console.log('✅ [DEBUG] Log enviado para canal ${logChannel.name}');
                    }
                } catch (err) {
                    console.error('❌ Erro ao enviar log:', err);
                }
            } else {
                console.log('⚠️ [DEBUG] logChannelId não configurado');
            }

            // ==================== RESPOSTA NO CANAL ====================
            await interaction.editReply({ 
                content: `✅ **Strike #${strikeId} aplicado em ${targetUser.username}**\n📉 ${pointsToLose} pts perdidos\n⭐ Reputação: ${newPoints}/100`,
                components: []
            });
            
            console.log(`📊 [STRIKE] ${staff.tag} puniu ${targetUser.tag} | #${strikeId} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no strike:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao aplicar strike. A equipe foi notificada.');
        }
    }
};