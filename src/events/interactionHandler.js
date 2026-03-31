const { EmbedBuilder } = require('discord.js');

module.exports = {
    /**
     * O grande roteador de componentes (Botões e Menus)
     * @param {import('discord.js').AnySelectMenuInteraction} interaction 
     */
    async handle(interaction) {
        const { client, customId, values, guildId, user } = interaction;
        
        // Ponto 2: Acesso rápido aos sistemas em memória
        const ConfigSystem = client.systems.config;
        const Session = client.systems.sessions;
        const EMOJIS = client.systems.emojis || {};

        // Ponto 3: Verificação de Sessão (Contexto)
        // Só processa se o usuário tiver uma sessão ativa de 'config_panel' neste servidor
        const userSession = Session ? Session.get(guildId, user.id, 'config_panel') : null;
        
        if (!userSession) {
            return await interaction.editReply({
                content: `${EMOJIS.ERROR || '❌'} Sua sessão expirou ou é inválida. Use \`/config\` novamente.`,
                components: []
            });
        }

        try {
            // --- LÓGICA DE ROTEAMENTO POR CUSTOMID ---
            
            // 1. Configuração do Cargo Staff
            if (customId === 'config:set_staff') {
                const roleId = values[0];
                ConfigSystem.updateSetting(guildId, 'staff_role', roleId); // Ponto 6: Síncrono no cache
                
                return await interaction.editReply({
                    content: `${EMOJIS.SUCCESS || '✅'} Cargo Staff atualizado para <@&${roleId}>!`,
                    components: [] // Fecha o painel após a ação ou atualiza a embed
                });
            }

            // 2. Configuração do Canal de Logs
            if (customId === 'config:set_logs') {
                const channelId = values[0];
                ConfigSystem.updateSetting(guildId, 'logs_channel', channelId);
                
                return await interaction.editReply({
                    content: `${EMOJIS.SUCCESS || '✅'} Canal de Logs definido para <#${channelId}>!`,
                    components: []
                });
            }

            // 3. Configuração de Cargos de Reputação (Exemplar/Prob/Strike)
            if (customId === 'config:set_rep_roles') {
                const roleId = values[0];
                // Aqui você pode decidir qual cargo salvar baseado no 'step' da sessão
                // Por agora, vamos salvar como strike_role como exemplo:
                ConfigSystem.updateSetting(guildId, 'strike_role', roleId);

                return await interaction.editReply({
                    content: `${EMOJIS.SUCCESS || '✅'} Cargo de Strike configurado com sucesso!`,
                    components: []
                });
            }

        } catch (error) {
            console.error('💥 Erro no InteractionHandler:', error);
            if (client.systems.logger) client.systems.logger.log('Handler_Error', error);
            
            await interaction.editReply({
                content: '❌ Houve um erro ao processar sua seleção.',
                components: []
            });
        }
    },
/**
     * GERA OS BOTÕES DE NAVEGAÇÃO (PONTO 2: IDs Inteligentes)
     */
    generateHistoryButtons(targetId, currentPage, totalPages) {
        if (totalPages <= 1) return null;

        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder();

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`history_${targetId}_${currentPage - 1}`)
                .setLabel('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            
            new ButtonBuilder()
                .setCustomId('page_info')
                .setLabel(`Página ${currentPage}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),

            new ButtonBuilder()
                .setCustomId(`history_${targetId}_${currentPage + 1}`)
                .setLabel('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === totalPages)
        );

        return row;
    },

    /**
     * HANDLER GLOBAL DE PAGINAÇÃO (PONTO 4: Limpeza e Rapidez)
     */
    async handlePagination(interaction, targetId, newPage) {
        try {
            const { guildId, client, user } = interaction;
            const Session = client.systems.sessions;

            // 1. Verificação de Segurança (Apenas quem usou o comando pode paginar)
            // Se você não quiser essa trava, pode remover o check de Session
            const userSession = Session ? Session.get(guildId, user.id, 'history') : null;
            if (userSession && userSession.targetId !== targetId) {
                return interaction.reply({ content: "❌ Esta consulta não pertence a você.", ephemeral: true });
            }

            // 2. Busca os novos dados no Banco (Rápido/Síncrono)
            const history = await this.getUserHistory(guildId, targetId, newPage);
            const targetUser = await client.users.fetch(targetId);

            // 3. Atualiza a UI (Editando a mensagem original)
            const embed = this.generateHistoryEmbed(targetUser, history, newPage);
            const components = this.generateHistoryButtons(targetId, newPage, history.totalPages);

            // Ponto 6: update() é mais rápido que editReply() para botões
            await interaction.update({ 
                embeds: [embed], 
                components: components ? [components] : [] 
            });

            // 4. Atualiza a sessão na memória
            if (Session) {
                Session.set(guildId, user.id, 'history', { 
                    targetId, 
                    currentPage: newPage, 
                    totalPages: history.totalPages 
                });
            }

        } catch (err) {
            console.error("❌ Erro na Paginação:", err);
            await interaction.followUp({ content: "Erro ao trocar de página.", ephemeral: true });
        }
    },

    /**
     * DB: BUSCA HISTÓRICO COM PAGINAÇÃO (PONTO 5: SQL Otimizado)
     */
    async getUserHistory(guildId, userId, page = 1) {
        const db = require('../database/index.js');
        const limit = 5; // Punições por página
        const offset = (page - 1) * limit;

        // Buscamos a Reputação e o Total de Punições em paralelo
        const reputation = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
        const total = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
        
        const totalPages = Math.ceil(total.count / limit);

        // Busca as punições daquela página específica
        const punishments = db.prepare(`
            SELECT * FROM punishments 
            WHERE guild_id = ? AND user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `).all(guildId, userId, limit, offset);

        return {
            reputation: reputation ? reputation.points : 100,
            punishments: punishments,
            totalRecords: total.count,
            totalPages: totalPages
        };
    }
};