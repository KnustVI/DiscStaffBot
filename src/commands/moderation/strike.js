const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const SessionManager = require('../../utils/sessionManager');
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
        .addStringOption(opt => opt.setName('ticket').setDescription('ID do Ticket (Opcional)').setRequired(false))
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

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     * @param {import('discord.js').Client} client 
     */
    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, options, channel, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;
        
        // Obter emojis do sistema
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        // Extração de Opções
        const targetUser = options.getUser('usuario');
        const severity = options.getInteger('gravidade');
        const reason = options.getString('motivo');
        const durationStr = options.getString('duracao');
        const discordAct = options.getString('discord_act') || 'none';
        const jogoAct = options.getString('jogo_act') || 'none';
        
        // Lógica de Ticket Inteligente
        const ticketId = options.getString('ticket') || 
            (channel.name.includes('ticket') ? channel.name.split('-')[1] || channel.name : null);
        
        // Mapeamento de pontos por severidade
        const pointsMap = {
            1: 10,
            2: 25,
            3: 40,
            4: 60,
            5: 100
        };
        const pointsToLose = pointsMap[severity] || 10;
        
        try {
            // 1. VALIDAR SE O USUÁRIO EXISTE
            if (!targetUser) {
                return await interaction.editReply({ 
                    content: `${emojis.Error || '❌'} Usuário não encontrado.`
                });
            }
            
            // 2. GARANTIR QUE USUÁRIOS E GUILD EXISTEM NO BANCO
            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureUser(targetUser.id, targetUser.username, targetUser.discriminator, targetUser.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // 3. OBTER SISTEMAS
            const ConfigSystem = require('../../systems/configSystem');
            const PunishmentSystem = require('../../systems/punishmentSystem');
            
            // 4. VALIDAÇÃO DE HIERARQUIA
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
                db.logActivity(
                    guildId,
                    staff.id,
                    'strike_denied',
                    targetUser.id,
                    { 
                        command: 'strike',
                        reason: 'Hierarquia insuficiente',
                        severity,
                        pointsToLose,
                        motivo: reason,
                        duration: durationStr,
                        discordAct,
                        jogoAct
                    }
                );
                
                return await interaction.editReply({ 
                    content: `${emojis.Error || '❌'} **Erro de Hierarquia:** Você não pode punir este membro.` 
                });
            }
            
            // 5. OBTER REPUTAÇÃO ATUAL
            const currentRep = ConfigSystem.getSetting(guildId, `rep_${targetUser.id}`) || 
                db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, targetUser.id)?.points || 100;
            
            const newPoints = Math.max(0, currentRep - pointsToLose);
            
            // 6. CALCULAR EXPIRAÇÃO
            let expiresAt = null;
            let durationMs = 0;
            if (durationStr !== '0' && durationStr.toLowerCase() !== 'perm') {
                durationMs = PunishmentSystem.parseDuration(durationStr);
                if (durationMs > 0) {
                    expiresAt = Date.now() + durationMs;
                }
            }
            
            // 7. GERAR UUID ÚNICO PARA PUNIÇÃO
            const punishmentUuid = db.generateUUID();
            
            // 8. APLICAR PUNIÇÃO NO BANCO
            const strikeId = db.prepare(`
                INSERT INTO punishments (
                    uuid, guild_id, user_id, moderator_id, reason, severity, 
                    points_deducted, ticket_id, created_at, expires_at, status, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                punishmentUuid, guildId, targetUser.id, staff.id, reason, severity,
                pointsToLose, ticketId || null, Date.now(), expiresAt, 'active',
                JSON.stringify({ discordAct, jogoAct, duration: durationStr })
            ).lastInsertRowid;
            
            // 9. ATUALIZAR REPUTAÇÃO
            db.prepare(`
                UPDATE reputation SET points = ?, updated_at = ?, updated_by = ?
                WHERE guild_id = ? AND user_id = ?
            `).run(newPoints, Date.now(), staff.id, guildId, targetUser.id);
            
            // 10. APLICAR AÇÕES DO DISCORD
            let discordActionResult = null;
            if (discordAct !== 'none' && targetMember) {
                try {
                    switch (discordAct) {
                        case 'timeout':
                            const timeoutDuration = durationMs > 0 ? durationMs : 60000;
                            await targetMember.timeout(timeoutDuration, reason);
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
            
            // 11. REGISTRAR ATIVIDADE NO LOG
            const activityId = db.logActivity(
                guildId,
                staff.id,
                'strike',
                targetUser.id,
                { 
                    command: 'strike',
                    punishmentId: strikeId,
                    punishmentUuid,
                    severity,
                    pointsLost: pointsToLose,
                    oldPoints: currentRep,
                    newPoints,
                    reason,
                    duration: durationStr,
                    expiresAt,
                    discordAct,
                    jogoAct,
                    ticketId: ticketId || null,
                    discordActionResult,
                    responseTime: Date.now() - startTime
                }
            );
            
            // 12. ATUALIZAR ANALYTICS DO STAFF
            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);
            
            // 13. GERAR EMBED UNIFICADO (DM + LOG)
            const unifiedEmbed = PunishmentSystem.generateStrikeUnifiedEmbed(
                targetUser,
                staff,
                strikeId,
                severity,
                reason,
                ticketId || null,
                pointsToLose,
                newPoints,
                discordAct,
                discordActionResult
            );
            
            // 14. ENVIAR DM PARA O USUÁRIO
            if (targetMember) {
                try {
                    await targetMember.send({ embeds: [unifiedEmbed] }).catch(() => null);
                } catch (err) {
                    console.error('❌ Erro ao enviar DM:', err);
                }
            }
            
            // 15. ENVIAR LOG PARA CANAL DE LOGS
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_channel');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        // Adicionar menção do moderador no log
                        const logEmbed = new EmbedBuilder(unifiedEmbed.toJSON());
                        logEmbed.setDescription(
                            unifiedEmbed.description + 
                            `\n\n## ${emojis.staff || '👮'} Moderador\n<@${staff.id}>`
                        );
                        await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                    }
                } catch (err) {
                    console.error('❌ Erro ao enviar log:', err);
                }
            }
            
            // 16. RESPOSTA NO CANAL
            const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
            const severityIcon = ['', '🟢', '🟡', '🟠', '🔴', '💀'][severity] || '❓';
            
            await interaction.editReply({ 
                content: `${severityIcon} **Strike #${strikeId} aplicado em ${targetUser.username}**\n📉 ${pointsToLose} pts perdidos | ⭐ Reputação: ${newPoints}/100\n📝 Motivo: ${reason.slice(0, 100)}`,
                embeds: [],
                components: []
            });
            
            // Log silencioso de performance
            console.log(`📊 [STRIKE] ${staff.tag} puniu ${targetUser.tag} em ${guild.name} | Nível ${severity} | #${strikeId} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            // 17. TRATAMENTO DE ERRO
            console.error('❌ Erro no comando strike:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            db.logActivity(
                guildId,
                staff.id,
                'error',
                targetUser?.id || null,
                { 
                    command: 'strike',
                    targetTag: targetUser?.tag || 'unknown',
                    severity,
                    reason,
                    duration: durationStr,
                    discordAct,
                    jogoAct,
                    error: error.message,
                    stack: error.stack
                }
            );
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao Aplicar Strike')
                .setDescription('Ocorreu um erro interno ao processar a punição. A equipe de staff foi notificada.')
                .addFields(
                    { name: 'Alvo', value: targetUser?.tag || 'Desconhecido', inline: true },
                    { name: 'Gravidade', value: `Nível ${severity}`, inline: true },
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 50) || 'Desconhecido'}\``, inline: false }
                )
                .setFooter({ text: 'Caso persista, contate um administrador.' })
                .setTimestamp();
            
            await interaction.editReply({ 
                embeds: [errorEmbed],
                content: null
            }).catch(() => null);
        }
    }
};