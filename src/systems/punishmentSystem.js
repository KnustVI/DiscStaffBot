const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/index.js');
const emojisFile = require('../database/emojis.js');
const SessionManager = require('../utils/sessionManager');

const EMOJIS = emojisFile.EMOJIS || {};

// Cores padrão do sistema
const COLORS = {
    DEFAULT: 0xDCA15E,      // Cor padrão
    SUCCESS: 0x00FF00,      // Verde para ganho de reputação
    DANGER: 0xFF0000,       // Vermelho para perda de reputação
    WARNING: 0xFFA500       // Laranja para avisos
};

const PunishmentSystem = {
    
    // ==================== FUNÇÕES DE BUSCA E BANCO ====================
    
    /**
     * Busca histórico de punições de um usuário com paginação
     */
    async getUserHistory(guildId, userId, page = 1) {
        try {
            const limit = 5; // Punições por página
            const offset = (page - 1) * limit;

            // Busca reputação
            let rep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const points = rep ? rep.points : 100;

            // Busca total de punições para paginação
            const total = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const totalRecords = total.count;
            const totalPages = Math.ceil(totalRecords / limit);

            // Busca punições da página atual
            const punishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE guild_id = ? AND user_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(guildId, userId, limit, offset);

            return {
                reputation: points,
                punishments,
                totalRecords,
                totalPages
            };
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            return {
                reputation: 100,
                punishments: [],
                totalRecords: 0,
                totalPages: 0
            };
        }
    },
    
    /**
     * Busca dados completos de um usuário (reputação + últimas punições)
     */
    async getUserData(guildId, userId) {
        try {
            const rep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const points = rep ? rep.points : 100;
            
            const lastPunishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE guild_id = ? AND user_id = ? 
                ORDER BY created_at DESC 
                LIMIT 3
            `).all(guildId, userId);
            
            const totalStrikes = db.prepare(`
                SELECT COUNT(*) as count FROM punishments 
                WHERE guild_id = ? AND user_id = ?
            `).get(guildId, userId);
            
            return {
                reputation: points,
                lastPunishments,
                totalStrikes: totalStrikes?.count || 0
            };
        } catch (error) {
            console.error('❌ Erro ao buscar dados do usuário:', error);
            return {
                reputation: 100,
                lastPunishments: [],
                totalStrikes: 0
            };
        }
    },
    
    // ==================== GERADORES DE UI ====================
    
    /**
     * Gera embed de histórico com cores dinâmicas baseadas na reputação
     */
    generateHistoryEmbed(target, history, page) {
        // Define cor baseada na reputação
        let color = COLORS.DEFAULT;
        if (history.reputation > 70) color = COLORS.SUCCESS;
        else if (history.reputation < 30) color = COLORS.DANGER;
        else if (history.reputation < 50) color = COLORS.WARNING;
        
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Histórico de ${target.tag}`, iconURL: target.displayAvatarURL() })
            .setColor(color)
            .setDescription(`${EMOJIS.REP || '⭐'} **Reputação Atual:** \`${history.reputation}/100\``)
            .setThumbnail(target.displayAvatarURL())
            .setFooter({ text: `Página ${page} de ${history.totalPages} • Total: ${history.totalRecords} registros` })
            .setTimestamp();

        if (history.punishments.length === 0) {
            embed.addFields({ name: '📋 Registros', value: 'Nenhuma punição encontrada.' });
        } else {
            history.punishments.forEach(p => {
                const date = `<t:${Math.floor(p.created_at / 1000)}:d>`;
                const severityIcon = ['⚪', '🟢', '🟡', '🟠', '🔴', '💀'][p.severity] || '❓';
                embed.addFields({
                    name: `${severityIcon} Caso #${p.id} | ${date}`,
                    value: `**Motivo:** ${p.reason}\n**Moderador:** <@${p.moderator_id}>\n**Ticket:** \`${p.ticket_id || 'N/A'}\``
                });
            });
        }

        return embed;
    },
    
    /**
     * Gera botões de paginação para histórico
     */
    generateHistoryButtons(targetId, currentPage, totalPages) {
        if (totalPages <= 1) return null;
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`punishment:history:prev:${targetId}:${currentPage - 1}`)
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`punishment:history:next:${targetId}:${currentPage + 1}`)
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === totalPages)
        );
        
        return row;
    },
    
    /**
     * Gera embed de confirmação de strike (vermelho para perda)
     */
    generateStrikeEmbed(target, moderator, reason, severity, pointsLost) {
        const severityNames = ['Visualização', 'Leve', 'Moderado', 'Grave', 'Severo', 'Permanente'];
        const severityIcon = ['⚪', '🟢', '🟡', '🟠', '🔴', '💀'][severity] || '❓';
        
        const embed = new EmbedBuilder()
            .setTitle(`${severityIcon} Strike Aplicado`)
            .setColor(COLORS.DANGER) // Vermelho para perda de reputação
            .setDescription(`**Usuário:** ${target.tag}\n**Moderador:** ${moderator.tag}\n**Severidade:** ${severityNames[severity] || severity}\n**Motivo:** ${reason}`)
            .addFields({ name: '📉 Pontos Perdidos', value: `\`-${pointsLost} pontos\``, inline: true })
            .setThumbnail(target.displayAvatarURL())
            .setFooter({ text: `ID: ${target.id}`, iconURL: moderator.displayAvatarURL() })
            .setTimestamp();
        
        return embed;
    },
    
    /**
     * Gera embed de remoção de strike (verde para ganho)
     */
    generateUnstrikeEmbed(target, moderator, reason, pointsRestored) {
        const embed = new EmbedBuilder()
            .setTitle('✅ Strike Removido')
            .setColor(COLORS.SUCCESS) // Verde para ganho de reputação
            .setDescription(`**Usuário:** ${target.tag}\n**Moderador:** ${moderator.tag}\n**Motivo:** ${reason}`)
            .addFields({ name: '📈 Pontos Restaurados', value: `\`+${pointsRestored} pontos\``, inline: true })
            .setThumbnail(target.displayAvatarURL())
            .setFooter({ text: `ID: ${target.id}`, iconURL: moderator.displayAvatarURL() })
            .setTimestamp();
        
        return embed;
    },
    
    /**
     * Gera embed de status do sistema
     */
    generateSystemStatusEmbed(guildName, stats) {
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Status do Sistema de Punições')
            .setColor(COLORS.DEFAULT)
            .setDescription(`**Servidor:** ${guildName}`)
            .addFields(
                { name: '📊 Total de Punições', value: `\`${stats.totalPunishments}\``, inline: true },
                { name: '👥 Usuários Penalizados', value: `\`${stats.totalUsers}\``, inline: true },
                { name: '⭐ Reputação Média', value: `\`${stats.avgReputation}/100\``, inline: true },
                { name: '⚠️ Strikes Ativos (30d)', value: `\`${stats.recentStrikes}\``, inline: true }
            )
            .setFooter({ text: `Sistema Robin • ${guildName}` })
            .setTimestamp();
        
        return embed;
    },
    
    // ==================== MÉTODOS PARA HANDLER CENTRAL ====================
    
    /**
     * Handler para componentes (botões e selects)
     * Chamado pelo InteractionHandler quando customId começa com "punishment:"
     */
    async handleComponent(interaction, action, param) {
        try {
            const [subAction, targetId, page] = param ? param.split(':') : [];
            
            switch (action) {
                case 'history':
                    await this.handleHistoryPagination(interaction, subAction, targetId, parseInt(page));
                    break;
                case 'confirm':
                    await this.handleStrikeConfirmation(interaction, subAction);
                    break;
                default:
                    await interaction.editReply({
                        content: `❌ Ação "${action}" não reconhecida no sistema de punições.`,
                        components: []
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent do punishmentSystem:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao processar a punição.',
                components: []
            });
        }
    },
    
    /**
     * Handler para modais
     * Chamado pelo InteractionHandler quando modal começa com "punishment:"
     */
    async handleModal(interaction, action) {
        try {
            switch (action) {
                case 'strike':
                    await this.processStrikeModal(interaction);
                    break;
                case 'unstrike':
                    await this.processUnstrikeModal(interaction);
                    break;
                default:
                    await interaction.editReply({
                        content: `❌ Modal "${action}" não reconhecido no sistema de punições.`,
                        ephemeral: true
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleModal do punishmentSystem:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao processar o modal.',
                ephemeral: true
            });
        }
    },
    
    /**
     * Processa paginação do histórico
     */
    async handleHistoryPagination(interaction, direction, targetId, newPage) {
        try {
            const guildId = interaction.guildId;
            const target = await interaction.client.users.fetch(targetId).catch(() => null);
            
            if (!target) {
                return await interaction.editReply({
                    content: '❌ Usuário não encontrado.',
                    components: []
                });
            }
            
            const history = await this.getUserHistory(guildId, targetId, newPage);
            const embed = this.generateHistoryEmbed(target, history, newPage);
            const buttons = this.generateHistoryButtons(targetId, newPage, history.totalPages);
            
            await interaction.editReply({
                embeds: [embed],
                components: buttons ? [buttons] : []
            });
        } catch (error) {
            console.error('❌ Erro na paginação:', error);
            await interaction.editReply({
                content: '❌ Erro ao carregar página do histórico.',
                components: []
            });
        }
    },
    
    /**
     * Processa confirmação de strike (botões de confirmar/cancelar)
     */
    async handleStrikeConfirmation(interaction, action) {
        const session = SessionManager.get(
            interaction.user.id,
            interaction.guildId,
            'strike_pending'
        );
        
        if (!session) {
            return await interaction.editReply({
                content: '❌ Sessão expirada ou inválida. Por favor, execute o comando novamente.',
                components: []
            });
        }
        
        if (action === 'cancel') {
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending');
            return await interaction.editReply({
                content: '❌ Aplicação de strike cancelada.',
                components: [],
                embeds: []
            });
        }
        
        if (action === 'confirm') {
            // Aplicar o strike
            const { targetId, reason, severity, ticketId } = session;
            const pointsLost = this.getPointsBySeverity(severity);
            
            const strikeId = this.applyPunishment(
                interaction.guildId,
                targetId,
                interaction.user.id,
                reason,
                severity,
                ticketId,
                pointsLost
            );
            
            const target = await interaction.client.users.fetch(targetId).catch(() => null);
            const moderator = interaction.user;
            
            const embed = this.generateStrikeEmbed(target, moderator, reason, severity, pointsLost);
            
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending');
            
            await interaction.editReply({
                embeds: [embed],
                components: []
            });
            
            // Registrar no canal de logs se configurado
            await this.logPunishment(interaction.guildId, strikeId, target, moderator, 'strike');
        }
    },
    
    /**
     * Processa modal de strike
     */
    async processStrikeModal(interaction) {
        const session = SessionManager.get(
            interaction.user.id,
            interaction.guildId,
            'strike_modal'
        );
        
        if (!session) {
            return await interaction.editReply({
                content: '❌ Sessão expirada. Por favor, execute o comando /strike novamente.',
                ephemeral: true
            });
        }
        
        const reason = interaction.fields.getTextInputValue('reason');
        const severity = parseInt(session.severity);
        const pointsLost = this.getPointsBySeverity(severity);
        
        // Salvar na sessão de confirmação
        SessionManager.set(
            interaction.user.id,
            interaction.guildId,
            'strike_pending',
            {
                targetId: session.targetId,
                reason,
                severity,
                ticketId: session.ticketId,
                pointsLost
            },
            120000 // 2 minutos para confirmar
        );
        
        // Criar embed de confirmação
        const target = await interaction.client.users.fetch(session.targetId).catch(() => null);
        const severityNames = ['Visualização', 'Leve', 'Moderado', 'Grave', 'Severo', 'Permanente'];
        
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Confirmar Aplicação de Strike')
            .setColor(COLORS.WARNING)
            .setDescription(`**Usuário:** ${target?.tag || session.targetId}\n**Severidade:** ${severityNames[severity]}\n**Motivo:** ${reason}\n**Pontos a perder:** \`-${pointsLost}\``)
            .setFooter({ text: 'Confirme para aplicar o strike' });
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`punishment:confirm:confirm`)
                .setLabel('✅ Confirmar')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`punishment:confirm:cancel`)
                .setLabel('❌ Cancelar')
                .setStyle(ButtonStyle.Danger)
        );
        
        await interaction.editReply({
            embeds: [embed],
            components: [row],
            content: null
        });
        
        SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_modal');
    },
    
    /**
     * Processa modal de unstrike
     */
    async processUnstrikeModal(interaction) {
        const session = SessionManager.get(
            interaction.user.id,
            interaction.guildId,
            'unstrike_modal'
        );
        
        if (!session) {
            return await interaction.editReply({
                content: '❌ Sessão expirada. Por favor, execute o comando /unstrike novamente.',
                ephemeral: true
            });
        }
        
        const reason = interaction.fields.getTextInputValue('reason');
        const strikeId = session.strikeId;
        
        // Buscar o strike para saber quantos pontos restaurar
        const strike = db.prepare(`SELECT * FROM punishments WHERE id = ? AND guild_id = ?`).get(strikeId, interaction.guildId);
        
        if (!strike) {
            return await interaction.editReply({
                content: '❌ Strike não encontrado.',
                ephemeral: true
            });
        }
        
        const pointsRestored = this.getPointsBySeverity(strike.severity);
        
        // Remover o strike
        db.prepare(`DELETE FROM punishments WHERE id = ? AND guild_id = ?`).run(strikeId, interaction.guildId);
        
        // Restaurar pontos
        db.prepare(`
            UPDATE reputation SET points = MIN(100, points + ?) 
            WHERE guild_id = ? AND user_id = ?
        `).run(pointsRestored, interaction.guildId, strike.user_id);
        
        const target = await interaction.client.users.fetch(strike.user_id).catch(() => null);
        const moderator = interaction.user;
        
        const embed = this.generateUnstrikeEmbed(target, moderator, reason, pointsRestored);
        
        await interaction.editReply({
            embeds: [embed],
            content: null
        });
        
        // Registrar no canal de logs
        await this.logPunishment(interaction.guildId, strikeId, target, moderator, 'unstrike', reason);
        
        SessionManager.delete(interaction.user.id, interaction.guildId, 'unstrike_modal');
    },
    
    // ==================== MÉTODOS DE NEGÓCIO EXISTENTES ====================
    
    /**
     * Converte string de duração para milissegundos
     */
    parseDuration(durationStr) {
        if (!durationStr || ['0', 'perm'].includes(durationStr.toLowerCase())) return 0;
        const timeValue = parseInt(durationStr);
        const type = durationStr.slice(-1).toLowerCase();
        const multipliers = { 'm': 60000, 'h': 3600000, 'd': 86400000 };
        return (multipliers[type] || 3600000) * timeValue;
    },
    
    /**
     * Retorna pontos perdidos baseado na severidade
     */
    getPointsBySeverity(severity) {
        const pointsMap = {
            0: 0,   // Visualização
            1: 5,   // Leve
            2: 15,  // Moderado
            3: 30,  // Grave
            4: 50,  // Severo
            5: 100  // Permanente
        };
        return pointsMap[severity] || 10;
    },
    
    /**
     * Aplica uma punição no banco de dados
     */
    applyPunishment(guildId, targetId, moderatorId, reason, severity, ticketId, points) {
        try {
            const trans = db.transaction(() => {
                const res = db.prepare(`
                    INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(guildId, targetId, moderatorId, reason, severity, ticketId, Date.now());
                
                db.prepare(`
                    INSERT INTO reputation (guild_id, user_id, points) VALUES (?, ?, 100)
                    ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
                `).run(guildId, targetId, points);
                
                return res.lastInsertRowid;
            });
            return trans();
        } catch (error) {
            console.error('❌ Erro ao aplicar punição:', error);
            return null;
        }
    },
    
    /**
     * Registra punição no canal de logs
     */
    async logPunishment(guildId, strikeId, target, moderator, action, extraReason = null) {
        try {
            const ConfigSystem = require('./configSystem');
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_channel');
            
            if (!logChannelId) return;
            
            const guild = await global.client?.guilds.cache.get(guildId);
            if (!guild) return;
            
            const logChannel = guild.channels.cache.get(logChannelId);
            if (!logChannel) return;
            
            const embed = new EmbedBuilder()
                .setColor(action === 'strike' ? COLORS.DANGER : COLORS.SUCCESS)
                .setTitle(action === 'strike' ? '⚠️ Strike Aplicado' : '✅ Strike Removido')
                .addFields(
                    { name: 'Usuário', value: target?.tag || 'Desconhecido', inline: true },
                    { name: 'Moderador', value: moderator.tag, inline: true },
                    { name: 'ID do Caso', value: `#${strikeId}`, inline: true }
                )
                .setTimestamp();
            
            if (extraReason) {
                embed.addFields({ name: 'Motivo da Remoção', value: extraReason });
            }
            
            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Erro ao logar punição:', error);
        }
    },
    
    /**
     * Inicia o worker de expiração de punições temporárias
     */
    initWorker(client) {
        console.log('⚖️ [Worker] Sistema de Punições Ativo');
        
        // Salvar client globalmente para uso nos logs
        global.client = client;
        
        setInterval(async () => {
            try {
                const now = Date.now();
                const expiredRoles = db.prepare(`SELECT * FROM temporary_roles WHERE expires_at <= ?`).all(now);
                
                for (const entry of expiredRoles) {
                    const guild = client.guilds.cache.get(entry.guild_id);
                    if (guild) {
                        try {
                            const member = await guild.members.fetch(entry.user_id);
                            await member.roles.remove(entry.role_id, "Strike Expirado");
                        } catch (err) {
                            // Usuário não está mais no servidor
                        }
                    }
                    db.prepare(`DELETE FROM temporary_roles WHERE id = ?`).run(entry.id);
                }
            } catch (error) {
                console.error('❌ Erro no worker de expiração:', error);
            }
        }, 30000);
    }
};

module.exports = PunishmentSystem;