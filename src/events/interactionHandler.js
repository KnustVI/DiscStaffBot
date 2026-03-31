const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    /**
     * O grande roteador de componentes (Botões e Menus)
     * @param {import('discord.js').AnySelectMenuInteraction | import('discord.js').ButtonInteraction} interaction 
     */
    async handle(interaction) {
        const { client, customId, values, guildId, user } = interaction;
        
        // 1. Lookup de Sistemas (RAM)
        const { config, sessions, emojis, logger, punishment } = client.systems;
        const EMOJIS = emojis || {};

        // 2. Verificação de Sessão (Contexto)
        // Evita que usuários aleatórios cliquem em botões de configurações antigas
        const userSession = sessions ? sessions.get(guildId, user.id, 'config_panel') : null;
        
        // Se for um componente de configuração e não houver sessão, bloqueia
        if (customId.startsWith('config:') && !userSession) {
            return await interaction.reply({
                content: `${EMOJIS.ERRO || '❌'} Sua sessão de configuração expirou. Use \`/config\` novamente.`,
                ephemeral: true
            });
        }

        try {
            // --- ROTEAMENTO POR PREFIXO DE CUSTOMID ---

            // A) CONFIGURAÇÕES (Menus de Seleção)
            if (customId.startsWith('config:')) {
                const settingKey = customId.split(':')[1]; // Ex: set_staff, set_logs
                const newValue = values[0];

                // Mapeamento de chaves do banco
                const keyMap = {
                    'set_staff': 'staff_role',
                    'set_logs': 'logs_channel',
                    'set_rep_roles': 'strike_role'
                };

                const dbKey = keyMap[settingKey];
                if (dbKey) {
                    config.updateSetting(guildId, dbKey, newValue);
                    
                    return await interaction.update({
                        content: `${EMOJIS.CHECK || '✅'} Configuração **${dbKey}** atualizada para <@${newValue.includes('&') ? newValue : '&' + newValue}>!`,
                        components: [] // Remove componentes para evitar cliques duplos
                    });
                }
            }

            // B) PAGINAÇÃO DE HISTÓRICO (Botões)
            if (customId.startsWith('history_')) {
                const [ , targetId, pageStr] = customId.split('_');
                return await this.handlePagination(interaction, targetId, parseInt(pageStr));
            }

        } catch (error) {
            if (logger) logger.log('InteractionHandler_Error', error);
            console.error('💥 Erro no InteractionHandler:', error);
            
            const errAction = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
            await interaction[errAction]({
                content: `${EMOJIS.ERRO || '❌'} Erro ao processar ação: \`${error.message}\``,
                components: [],
                ephemeral: true
            }).catch(() => null);
        }
    },

    /**
     * HANDLER GLOBAL DE PAGINAÇÃO (Performance: SQL Otimizado + Update)
     */
    async handlePagination(interaction, targetId, newPage) {
        const { client, guildId } = interaction;
        const { punishment } = client.systems;

        try {
            // 1. Busca os novos dados (Offset/Limit no SQL)
            const history = await this.getUserHistory(guildId, targetId, newPage);
            const targetUser = await client.users.fetch(targetId).catch(() => null);

            if (!targetUser) return;

            // 2. Gera a nova UI
            const embed = punishment.generateHistoryEmbed(targetUser, history, newPage);
            const components = this.generateHistoryButtons(targetId, newPage, history.totalPages);

            // 3. Update nativo (Mais rápido e suave que editReply)
            await interaction.update({ 
                embeds: [embed], 
                components: components ? [components] : [] 
            });

        } catch (err) {
            console.error("❌ Erro na Paginação:", err);
            await interaction.followUp({ content: "Erro ao carregar página.", ephemeral: true });
        }
    },

    /**
     * GERA OS BOTÕES DE NAVEGAÇÃO
     */
    generateHistoryButtons(targetId, currentPage, totalPages) {
        if (totalPages <= 1) return null;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`history_${targetId}_${currentPage - 1}`)
                .setLabel('⬅️ Anterior')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            
            new ButtonBuilder()
                .setCustomId('page_indicator')
                .setLabel(`Pág. ${currentPage}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),

            new ButtonBuilder()
                .setCustomId(`history_${targetId}_${currentPage + 1}`)
                .setLabel('Próxima ➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === totalPages)
        );

        return row;
    },

    /**
     * DB: BUSCA HISTÓRICO COM PAGINAÇÃO
     */
    async getUserHistory(guildId, userId, page = 1) {
        const db = require('../database/index.js');
        const limit = 5; 
        const offset = (page - 1) * limit;

        // Query única para contagem e pontos (Otimização de I/O)
        const reputation = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
        const total = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
        
        const totalPages = Math.ceil((total?.count || 0) / limit);

        // Busca paginada
        const punishments = db.prepare(`
            SELECT * FROM punishments 
            WHERE guild_id = ? AND user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `).all(guildId, userId, limit, offset);

        return {
            reputation: reputation ? reputation.points : 100,
            punishments: punishments || [],
            totalRecords: total?.count || 0,
            totalPages: totalPages || 1
        };
    }
};