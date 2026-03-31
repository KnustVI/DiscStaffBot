const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const SessionManager = require('../../utils/sessionManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unstrike')
        .setDescription('Anula uma punição e devolve os pontos ao usuário.')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID único da punição no banco').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da anulação').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     * @param {import('discord.js').Client} client 
     */
    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;
        
        const punishmentId = options.getInteger('id');
        const reason = options.getString('motivo');
        
        // Obter emojis do sistema (se existirem)
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // 1. GARANTIR QUE USUÁRIO E GUILD EXISTEM NO BANCO
            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // 2. OBTER SISTEMAS
            const ConfigSystem = require('../../systems/configSystem');
            const PunishmentSystem = require('../../systems/punishmentSystem');
            
            // 3. BUSCAR PUNIÇÃO NO BANCO
            const punishment = db.prepare(`
                SELECT * FROM punishments 
                WHERE id = ? AND guild_id = ? AND status = 'active'
            `).get(punishmentId, guildId);
            
            if (!punishment) {
                // Registrar tentativa de anular punição inexistente
                db.logActivity(
                    guildId,
                    staff.id,
                    'unstrike_not_found',
                    null,
                    { 
                        command: 'unstrike',
                        punishmentId,
                        reason,
                        error: 'Punição não encontrada ou já anulada'
                    }
                );
                
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('⚠️ Punição Não Encontrada')
                    .setDescription(`Não foi encontrada uma punição ativa com o ID \`${punishmentId}\` neste servidor.`)
                    .addFields(
                        { name: '💡 Dica', value: 'Verifique o ID correto usando `/historico`' },
                        { name: 'ID da Transação', value: `\`${Date.now()}\``, inline: true }
                    )
                    .setTimestamp();
                
                return await interaction.editReply({ embeds: [errorEmbed] });
            }
            
            // 4. VALIDAÇÃO DE HIERARQUIA (se o alvo ainda estiver no servidor)
            let targetMember = null;
            try {
                targetMember = await guild.members.fetch(punishment.user_id).catch(() => null);
            } catch (err) {
                targetMember = null;
            }
            
            const isStaffHigher = targetMember && 
                targetMember.roles.highest.position >= staffMember.roles.highest.position && 
                staff.id !== guild.ownerId;
            
            if (isStaffHigher) {
                // Registrar tentativa negada
                db.logActivity(
                    guildId,
                    staff.id,
                    'unstrike_denied',
                    punishment.user_id,
                    { 
                        command: 'unstrike',
                        punishmentId,
                        reason: 'Hierarquia insuficiente',
                        targetRolePosition: targetMember.roles.highest.position,
                        staffRolePosition: staffMember.roles.highest.position
                    }
                );
                
                return await interaction.editReply({ 
                    content: `${emojis.ERRO || '❌'} **Erro de Hierarquia:** Você não pode anular punições de um cargo superior ou igual ao seu.` 
                });
            }
            
            // 5. OBTER PONTOS A RESTAURAR (baseado na severidade)
            const pointsMap = {
                1: 10,
                2: 25,
                3: 40,
                4: 60,
                5: 100
            };
            const pointsToRestore = pointsMap[punishment.severity] || 10;
            
            // 6. OBTER REPUTAÇÃO ATUAL DO USUÁRIO
            const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, punishment.user_id)?.points || 100;
            const newPoints = Math.min(100, currentRep + pointsToRestore);
            
            // 7. GERAR UUID ÚNICO PARA ANULAÇÃO (para rastreamento)
            const reversalUuid = db.generateUUID();
            
            // 8. ATUALIZAR PUNIÇÃO (marcar como revogada)
            db.prepare(`
                UPDATE punishments SET 
                    status = 'revoked',
                    revoked_by = ?,
                    revoked_reason = ?,
                    revoked_at = ?
                WHERE id = ? AND guild_id = ?
            `).run(staff.id, reason, Date.now(), punishmentId, guildId);
            
            // 9. RESTAURAR REPUTAÇÃO
            db.prepare(`
                UPDATE reputation SET points = ?, updated_at = ?, updated_by = ?
                WHERE guild_id = ? AND user_id = ?
            `).run(newPoints, Date.now(), staff.id, guildId, punishment.user_id);
            
            // 10. REMOVER CARGO TEMPORÁRIO SE EXISTIR (strike role)
            const strikeRoleId = ConfigSystem.getSetting(guildId, 'strike_role');
            if (strikeRoleId && targetMember && targetMember.roles.cache.has(strikeRoleId)) {
                try {
                    await targetMember.roles.remove(strikeRoleId, `Punição #${punishmentId} anulada`);
                } catch (err) {
                    console.error('❌ Erro ao remover cargo de strike:', err);
                }
            }
            
            // 11. REMOVER TIMEOUT SE EXISTIR
            if (targetMember && targetMember.communicationDisabledUntilTimestamp) {
                try {
                    await targetMember.timeout(null, `Punição #${punishmentId} anulada`);
                } catch (err) {
                    console.error('❌ Erro ao remover timeout:', err);
                }
            }
            
            // 12. REGISTRAR ATIVIDADE NO LOG
            const activityId = db.logActivity(
                guildId,
                staff.id,
                'unstrike',
                punishment.user_id,
                { 
                    command: 'unstrike',
                    punishmentId,
                    punishmentUuid: punishment.uuid,
                    reversalUuid,
                    severity: punishment.severity,
                    pointsRestored: pointsToRestore,
                    oldPoints: currentRep,
                    newPoints,
                    originalReason: punishment.reason,
                    originalModerator: punishment.moderator_id,
                    reversalReason: reason,
                    originalCreatedAt: punishment.created_at,
                    responseTime: Date.now() - startTime
                }
            );
            
            // 13. ATUALIZAR ANALYTICS DO STAFF
            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);
            
            // 14. BUSCAR INFORMAÇÕES DO ALVO
            const targetUser = await client.users.fetch(punishment.user_id).catch(() => null);
            const targetTag = targetUser?.tag || punishment.user_id;
            
            // 15. GERAR EMBED DE CONFIRMAÇÃO
            const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
            const severityIcon = ['', '🟢', '🟡', '🟠', '🔴', '💀'][punishment.severity] || '❓';
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00) // Verde para ganho de reputação
                .setTitle(`${emojis.CHECK || '✅'} Punição Anulada`)
                .setDescription(`**Punição #${punishmentId} foi anulada com sucesso!**`)
                .addFields(
                    { name: '👤 Alvo', value: `${targetTag}\n\`${punishment.user_id}\``, inline: true },
                    { name: '👮 Moderador Original', value: `<@${punishment.moderator_id}>`, inline: true },
                    { name: '⚖️ Gravidade Original', value: `${severityNames[punishment.severity]} (Nível ${punishment.severity})`, inline: true },
                    { name: '📈 Pontos Restaurados', value: `\`+${pointsToRestore} pts\``, inline: true },
                    { name: '⭐ Reputação Final', value: `\`${newPoints}/100\``, inline: true },
                    { name: '📝 Motivo Original', value: `\`${punishment.reason.slice(0, 100)}\``, inline: false },
                    { name: '📝 Motivo da Anulação', value: `\`${reason.slice(0, 100)}\``, inline: false },
                    { name: '🆔 UUID da Punição', value: `\`${punishment.uuid?.slice(0, 8) || 'N/A'}...\``, inline: true },
                    { name: '🆔 ID da Transação', value: `\`${activityId?.slice(0, 8) || 'N/A'}...\``, inline: true }
                )
                .setFooter({ 
                    text: `Anulado por ${staff.tag} • ${ConfigSystem.getFooter(guild.name).text}`,
                    iconURL: ConfigSystem.getFooter(guild.name).iconURL
                })
                .setTimestamp();
            
            // 16. RESPOSTA FINAL
            await interaction.editReply({ embeds: [embed], content: null });
            
            // 17. ENVIAR LOG PARA CANAL DE LOGS (Async)
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_channel');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setAuthor({ name: `✅ Punição Anulada`, iconURL: targetUser?.displayAvatarURL() })
                            .setDescription([
                                `**Punição ID:** #${punishmentId}`,
                                `**UUID:** \`${punishment.uuid}\``,
                                `**Alvo:** <@${punishment.user_id}> (\`${punishment.user_id}\`)`,
                                `**Moderador Original:** <@${punishment.moderator_id}>`,
                                `**Anulado por:** ${staff} (\`${staff.id}\`)`,
                                `**Gravidade:** Nível ${punishment.severity} (${severityNames[punishment.severity]})`,
                                `**Motivo Original:** ${punishment.reason}`,
                                `**Motivo da Anulação:** ${reason}`,
                                `**Pontos Restaurados:** \`+${pointsToRestore}\` → \`${newPoints}/100\``,
                                `**Data Original:** <t:${Math.floor(punishment.created_at / 1000)}:F>`,
                                `**ID Transação:** \`${activityId}\``
                            ].join('\n'))
                            .setFooter({ text: ConfigSystem.getSetting(guildId, 'footer_text') || guild.name })
                            .setTimestamp();
                        
                        await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                    }
                } catch (err) {
                    console.error('❌ Erro ao enviar log para canal:', err);
                }
            }
            
            // 18. NOTIFICAR O USUÁRIO VIA DM (se possível)
            if (targetUser) {
                try {
                    const dmEmbed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('✅ Sua punição foi anulada')
                        .setDescription(`**Servidor:** ${guild.name}`)
                        .addFields(
                            { name: 'Punição Anulada', value: `#${punishmentId}`, inline: true },
                            { name: 'Motivo Original', value: punishment.reason, inline: false },
                            { name: 'Motivo da Anulação', value: reason, inline: false },
                            { name: 'Pontos Restaurados', value: `+${pointsToRestore} pts`, inline: true },
                            { name: 'Reputação Atual', value: `${newPoints}/100`, inline: true }
                        )
                        .setFooter({ text: `Anulado por ${staff.tag}` })
                        .setTimestamp();
                    
                    await targetUser.send({ embeds: [dmEmbed] }).catch(() => null);
                } catch (err) {
                    // Silenciar erro de DM
                }
            }
            
            // Log silencioso de performance
            console.log(`📊 [UNSTRIKE] ${staff.tag} anulou punição #${punishmentId} de ${targetTag} em ${guild.name} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            // 19. TRATAMENTO DE ERRO COM LOG DETALHADO
            console.error('❌ Erro no comando unstrike:', error);
            
            // Registrar erro no sistema de logs
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            // Registrar no banco
            db.logActivity(
                guildId,
                staff.id,
                'error',
                null,
                { 
                    command: 'unstrike',
                    punishmentId,
                    reason,
                    error: error.message,
                    stack: error.stack
                }
            );
            
            // Resposta de erro amigável
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao Anular Punição')
                .setDescription('Ocorreu um erro interno ao processar a anulação. A equipe de staff foi notificada.')
                .addFields(
                    { name: 'ID da Punição', value: `\`${punishmentId}\``, inline: true },
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 50) || 'Desconhecido'}\``, inline: false },
                    { name: 'ID da Transação', value: `\`${Date.now()}\``, inline: true }
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