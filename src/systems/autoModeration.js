const cron = require('node-cron');
const db = require('../database/index');
const { EmbedBuilder } = require('discord.js');
const SessionManager = require('../utils/sessionManager');

// Cores padrão do sistema
const COLORS = {
    DEFAULT: 0xDCA15E,      // Cor padrão
    SUCCESS: 0x00FF00,      // Verde para sucesso
    DANGER: 0xFF0000,       // Vermelho para perigo
    WARNING: 0xFFA500       // Laranja para avisos
};

class AutoModerationSystem {
    constructor(client) {
        this.client = client;
        this.isRunning = false;
        this.stats = {
            lastRun: null,
            totalRepRecovered: 0,
            totalRolesAdded: 0,
            totalRolesRemoved: 0
        };
    }

    // ==================== MÉTODOS PARA HANDLER CENTRAL ====================

    /**
     * Handler para componentes (botões e selects)
     * Chamado pelo InteractionHandler quando customId começa com "automod:"
     */
    async handleComponent(interaction, action, param) {
        try {
            switch (action) {
                case 'toggle':
                    await this.handleToggleAutoMod(interaction);
                    break;
                case 'config':
                    await this.handleAutoModConfig(interaction, param);
                    break;
                case 'report':
                    await this.handleAutoModReport(interaction);
                    break;
                default:
                    await interaction.editReply({
                        content: `❌ Ação "${action}" não reconhecida no sistema de auto moderação.`,
                        components: []
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent do autoModeration:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao processar a auto moderação.',
                components: []
            });
        }
    }

    /**
     * Handler para modais
     * Chamado pelo InteractionHandler quando modal começa com "automod:"
     */
    async handleModal(interaction, action) {
        try {
            switch (action) {
                case 'limits':
                    await this.processLimitConfigModal(interaction);
                    break;
                default:
                    await interaction.editReply({
                        content: `❌ Modal "${action}" não reconhecido no sistema de auto moderação.`,
                        flags: 64
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleModal do autoModeration:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao processar o modal.',
                    
            });
        }
    }

    /**
     * Alterna o estado da auto moderação
     */
    async handleToggleAutoMod(interaction) {
        const ConfigSystem = require('./configSystem');
        const current = ConfigSystem.getSetting(interaction.guildId, 'automod_enabled') === 'true';
        const newValue = !current;
        
        ConfigSystem.setSetting(interaction.guildId, 'automod_enabled', newValue.toString());
        
        const embed = new EmbedBuilder()
            .setColor(COLORS.DEFAULT)
            .setTitle('🛡️ Auto Moderação')
            .setDescription(`Sistema de auto moderação foi **${newValue ? 'ativado' : 'desativado'}** com sucesso!`)
            .setFooter({ text: `Solicitado por ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp();
        
        await interaction.editReply({
            embeds: [embed],
            components: []
        });
    }

    /**
     * Configura limites da auto moderação
     */
    async handleAutoModConfig(interaction, param) {
        const ConfigSystem = require('./configSystem');
        
        if (param === 'limits') {
            // Abrir modal para configurar limites
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
            
            const modal = new ModalBuilder()
                .setCustomId('automod:limits')
                .setTitle('Configurar Limites');
            
            const exemplarLimit = new TextInputBuilder()
                .setCustomId('exemplar_limit')
                .setLabel('Limite para cargo Exemplar (1-100)')
                .setPlaceholder('Ex: 95')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            
            const problematicLimit = new TextInputBuilder()
                .setCustomId('problematic_limit')
                .setLabel('Limite para cargo Problemático (1-100)')
                .setPlaceholder('Ex: 30')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(exemplarLimit),
                new ActionRowBuilder().addComponents(problematicLimit)
            );
            
            await interaction.showModal(modal);
        } else {
            // Mostrar configurações atuais
            const exemplarLimit = ConfigSystem.getSetting(interaction.guildId, 'limit_exemplar') || '95';
            const problematicLimit = ConfigSystem.getSetting(interaction.guildId, 'limit_problematico') || '30';
            const isEnabled = ConfigSystem.getSetting(interaction.guildId, 'automod_enabled') === 'true';
            
            const embed = new EmbedBuilder()
                .setColor(COLORS.DEFAULT)
                .setTitle('⚙️ Configurações da Auto Moderação')
                .addFields(
                    { name: 'Status', value: isEnabled ? '✅ Ativado' : '❌ Desativado', inline: true },
                    { name: '🎖️ Limite Exemplar', value: `${exemplarLimit} pontos`, inline: true },
                    { name: '⚠️ Limite Problemático', value: `${problematicLimit} pontos`, inline: true },
                    { name: '📈 Recuperação Diária', value: '+1 ponto para quem não tem punições nas últimas 24h', inline: false },
                    { name: '🔄 Atualização', value: 'Diariamente às 12:00', inline: true }
                )
                .setFooter({ text: `Sistema Robin • ${interaction.guild.name}` })
                .setTimestamp();
            
            await interaction.editReply({
                embeds: [embed],
                components: []
            });
        }
    }

    /**
     * Processa modal de configuração de limites
     */
    async processLimitConfigModal(interaction) {
        const ConfigSystem = require('./configSystem');
        
        const exemplarLimit = interaction.fields.getTextInputValue('exemplar_limit');
        const problematicLimit = interaction.fields.getTextInputValue('problematic_limit');
        
        // Validações
        const exLimit = parseInt(exemplarLimit);
        const probLimit = parseInt(problematicLimit);
        
        if (isNaN(exLimit) || exLimit < 1 || exLimit > 100) {
            return await interaction.editReply({
                content: '❌ Limite para cargo Exemplar deve ser um número entre 1 e 100.',
                flags: 64
            });
        }
        
        if (isNaN(probLimit) || probLimit < 1 || probLimit > 100) {
            return await interaction.editReply({
                content: '❌ Limite para cargo Problemático deve ser um número entre 1 e 100.',
                flags: 64
            });
        }
        
        if (probLimit >= exLimit) {
            return await interaction.editReply({
                content: '❌ O limite para cargo Problemático deve ser menor que o limite para cargo Exemplar.',
                flags: 64
            });
        }
        
        // Salvar configurações
        ConfigSystem.setSetting(interaction.guildId, 'limit_exemplar', exLimit.toString());
        ConfigSystem.setSetting(interaction.guildId, 'limit_problematico', probLimit.toString());
        
        const embed = new EmbedBuilder()
            .setColor(COLORS.SUCCESS)
            .setTitle('✅ Configurações Atualizadas')
            .addFields(
                { name: '🎖️ Limite Exemplar', value: `${exLimit} pontos`, inline: true },
                { name: '⚠️ Limite Problemático', value: `${probLimit} pontos`, inline: true }
            )
            .setFooter({ text: `Solicitado por ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp();
        
        await interaction.editReply({
            embeds: [embed],
            components: []
        });
    }

    /**
     * Gera relatório da auto moderação
     */
    async handleAutoModReport(interaction) {
        const ConfigSystem = require('./configSystem');
        
        // Buscar estatísticas
        const totalUsers = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM reputation WHERE guild_id = ?`).get(interaction.guildId);
        const avgRep = db.prepare(`SELECT AVG(points) as avg FROM reputation WHERE guild_id = ?`).get(interaction.guildId);
        const exemplars = db.prepare(`SELECT COUNT(*) as count FROM reputation WHERE guild_id = ? AND points >= ?`).get(interaction.guildId, ConfigSystem.getSetting(interaction.guildId, 'limit_exemplar') || 95);
        const problematic = db.prepare(`SELECT COUNT(*) as count FROM reputation WHERE guild_id = ? AND points <= ?`).get(interaction.guildId, ConfigSystem.getSetting(interaction.guildId, 'limit_problematico') || 30);
        
        const embed = new EmbedBuilder()
            .setColor(COLORS.DEFAULT)
            .setTitle('📊 Relatório de Auto Moderação')
            .addFields(
                { name: '👥 Total de Usuários', value: `\`${totalUsers?.count || 0}\``, inline: true },
                { name: '⭐ Reputação Média', value: `\`${Math.round(avgRep?.avg || 0)}/100\``, inline: true },
                { name: '🎖️ Usuários Exemplares', value: `\`${exemplars?.count || 0}\``, inline: true },
                { name: '⚠️ Usuários Problemáticos', value: `\`${problematic?.count || 0}\``, inline: true },
                { name: '🕒 Última Execução', value: this.stats.lastRun ? `<t:${Math.floor(this.stats.lastRun / 1000)}:R>` : 'Nunca executado', inline: true },
                { name: '📈 Total Recuperado', value: `\`${this.stats.totalRepRecovered}\` pontos`, inline: true }
            )
            .setFooter({ text: `Sistema Robin • ${interaction.guild.name}` })
            .setTimestamp();
        
        await interaction.editReply({
            embeds: [embed],
            components: []
        });
    }

    // ==================== FUNÇÕES DE NEGÓCIO ====================

    /**
     * Inicia o worker de auto moderação agendado
     */
    startWorker() {
        if (this.isRunning) {
            console.log('⚠️ [AutoMod] Worker já está rodando');
            return;
        }
        
        // Agendado para Meio-dia (Brasília) - Horário de Brasília
        cron.schedule('0 12 * * *', async () => {
            await this.executeDailyMaintenance();
        }, {
            timezone: "America/Sao_Paulo"
        });
        
        this.isRunning = true;
        console.log("🛡️ [AutoMod] Worker iniciado - Agendado para 12:00 (Brasília)");
    }

    /**
     * Executa a manutenção diária (pode ser chamada manualmente também)
     */
    async executeDailyMaintenance() {
        console.log("🛡️ [AutoMod] Iniciando processamento de integridade diária...");
        this.stats.lastRun = Date.now();
        
        const ConfigSystem = require('./configSystem');
        const stats = {};
        let totalRepRecovered = 0;
        let totalRolesAdded = 0;
        let totalRolesRemoved = 0;

        // --- 1. RECUPERAÇÃO DE REPUTAÇÃO (SQL PURO) ---
        // Aumenta 1 ponto de quem não teve punições nas últimas 24h
        try {
            const result = db.prepare(`
                UPDATE reputation 
                SET points = MIN(100, points + 1)
                WHERE points < 100 
                AND NOT EXISTS (
                    SELECT 1 FROM punishments 
                    WHERE punishments.user_id = reputation.user_id 
                    AND punishments.guild_id = reputation.guild_id
                    AND (strftime('%s','now') * 1000 - punishments.created_at) < 86400000
                )
            `).run();
            
            totalRepRecovered = result.changes;
            console.log(`📈 [AutoMod] ${totalRepRecovered} usuários recuperaram pontos.`);
        } catch (err) {
            console.error('❌ [AutoMod] Erro na recuperação de reputação:', err);
        }

        // --- 2. GERENCIAMENTO DINÂMICO DE CARGOS ---
        try {
            // Buscamos apenas quem está nos extremos (Exemplares ou Problemáticos)
            const users = db.prepare(`SELECT * FROM reputation WHERE points >= 90 OR points <= 40`).all();

            for (const userData of users) {
                const { guild_id: gId, user_id: uId, points: rep } = userData;
                
                const guild = this.client.guilds.cache.get(gId);
                if (!guild) continue;

                if (!stats[gId]) {
                    stats[gId] = { 
                        added: 0, 
                        removed: 0, 
                        guildName: guild.name,
                        exemplarAdded: 0,
                        problematicAdded: 0
                    };
                }

                try {
                    const member = await guild.members.fetch(uId).catch(() => null);
                    if (!member) continue;

                    // Definições de Configuração
                    const roleExId = ConfigSystem.getSetting(gId, 'role_exemplar');
                    const roleProbId = ConfigSystem.getSetting(gId, 'role_problematico');
                    const limitEx = parseInt(ConfigSystem.getSetting(gId, 'limit_exemplar')) || 95;
                    const limitProb = parseInt(ConfigSystem.getSetting(gId, 'limit_problematico')) || 30;

                    // A) Lógica de Cargo Exemplar (Recompensa)
                    if (roleExId) {
                        const hasEx = member.roles.cache.has(roleExId);
                        if (rep >= limitEx && !hasEx) {
                            await member.roles.add(roleExId).catch(() => null);
                            stats[gId].added++;
                            stats[gId].exemplarAdded++;
                            totalRolesAdded++;
                            
                            // DM de notificação
                            await member.send(`✨ Parabéns! Sua conduta em **${guild.name}** é exemplar e você recebeu um cargo especial!`).catch(() => null);
                        } else if (rep < (limitEx - 5) && hasEx) {
                            // Margem de erro de 5 pontos para não ficar tirando/ponto o tempo todo
                            await member.roles.remove(roleExId).catch(() => null);
                            stats[gId].removed++;
                            totalRolesRemoved++;
                        }
                    }

                    // B) Lógica de Cargo Problemático (Aviso)
                    if (roleProbId) {
                        const hasProb = member.roles.cache.has(roleProbId);
                        if (rep <= limitProb && !hasProb) {
                            await member.roles.add(roleProbId).catch(() => null);
                            stats[gId].added++;
                            stats[gId].problematicAdded++;
                            totalRolesAdded++;
                            
                            // DM de aviso
                            await member.send(`⚠️ Sua reputação em **${guild.name}** atingiu um nível crítico. Melhore sua conduta para evitar sanções severas!`).catch(() => null);
                        } else if (rep > 50 && hasProb) {
                            await member.roles.remove(roleProbId).catch(() => null);
                            stats[gId].removed++;
                            totalRolesRemoved++;
                        }
                    }
                } catch (memberError) {
                    continue;
                }
            }
        } catch (err) {
            console.error('❌ [AutoMod] Erro no gerenciamento de cargos:', err);
        }

        // Atualizar estatísticas
        this.stats.totalRepRecovered += totalRepRecovered;
        this.stats.totalRolesAdded += totalRolesAdded;
        this.stats.totalRolesRemoved += totalRolesRemoved;

        // --- 3. RELATÓRIOS NOS CANAIS DE LOG ---
        await this.sendLogReports(stats);
        
        console.log(`✅ [AutoMod] Manutenção concluída - Recuperados: ${totalRepRecovered} | Cargos: +${totalRolesAdded} / -${totalRolesRemoved}`);
    }

    /**
     * Envia relatórios para os canais de log
     */
    async sendLogReports(stats) {
        const ConfigSystem = require('./configSystem');
        
        for (const [gId, data] of Object.entries(stats)) {
            try {
                const logChanId = ConfigSystem.getSetting(gId, 'log_automod');
                if (!logChanId) continue;
                
                const channel = await this.client.channels.fetch(logChanId).catch(() => null);
                if (!channel) continue;

                const embed = new EmbedBuilder()
                    .setAuthor({ name: 'Sistema de Integridade', iconURL: this.client.user.displayAvatarURL() })
                    .setTitle('✅ Manutenção Diária Concluída')
                    .setColor(COLORS.DEFAULT)
                    .setDescription(`O processamento automático de reputação e cargos foi finalizado com sucesso.`)
                    .addFields(
                        { name: '📈 Recuperação', value: `Usuários sem infrações recentes receberam **+1pt**.`, inline: false },
                        { name: '🎭 Alterações de Cargos', value: `\`${data.added}\` Atribuídos\n\`${data.removed}\` Removidos`, inline: true },
                        { name: '📊 Detalhes', value: `🎖️ Exemplares: +${data.exemplarAdded || 0}\n⚠️ Problemáticos: +${data.problematicAdded || 0}`, inline: true }
                    )
                    .setTimestamp();

                await channel.send({ embeds: [embed] });
                
                // Marca a última execução no banco para controle administrativo
                ConfigSystem.setSetting(gId, 'last_automod_run', Date.now().toString());

            } catch (e) {
                // Silenciar erros de envio de log
                console.error(`❌ [AutoMod] Erro ao enviar log para ${gId}:`, e.message);
            }
        }
    }

    /**
     * Obtém estatísticas atuais do sistema
     */
    getStats() {
        return {
            ...this.stats,
            isRunning: this.isRunning,
            uptime: this.isRunning ? (Date.now() - (this.stats.lastRun || Date.now())) : 0
        };
    }

    /**
     * Executa manutenção manualmente (para testes)
     */
    async runManualMaintenance() {
        console.log("🛡️ [AutoMod] Execução manual solicitada");
        await this.executeDailyMaintenance();
        return this.getStats();
    }
}

/// Exporta a função de inicialização (mantém compatibilidade)
module.exports = (client) => {
    const autoMod = new AutoModerationSystem(client);
    autoMod.startWorker();
    return autoMod;
};

// Exporta a classe para uso no handler central
module.exports.AutoModerationSystem = AutoModerationSystem;

// Exporta um objeto com os métodos principais para compatibilidade com o handler
module.exports.handler = {
    handleComponent: async (interaction, action, param) => {
        // Criar uma instância temporária se necessário
        const tempInstance = new AutoModerationSystem(global.client);
        return tempInstance.handleComponent(interaction, action, param);
    },
    handleModal: async (interaction, action) => {
        const tempInstance = new AutoModerationSystem(global.client);
        return tempInstance.handleModal(interaction, action);
    },
    handleToggleAutoMod: async (interaction) => {
        const tempInstance = new AutoModerationSystem(global.client);
        return tempInstance.handleToggleAutoMod(interaction);
    },
    handleAutoModReport: async (interaction) => {
        const tempInstance = new AutoModerationSystem(global.client);
        return tempInstance.handleAutoModReport(interaction);
    },
    handleAutoModConfig: async (interaction, param) => {
        const tempInstance = new AutoModerationSystem(global.client);
        return tempInstance.handleAutoModConfig(interaction, param);
    }
};