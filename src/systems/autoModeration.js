// /home/ubuntu/DiscStaffBot/src/systems/autoModeration.js
const cron = require('node-cron');
const db = require('../database/index');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const SessionManager = require('../utils/sessionManager');
const ContainerFormatter = require('../utils/ContainerFormatter');

let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const COLORS = {
    DEFAULT: 0xDCA15E,
    SUCCESS: 0x00FF00,
    DANGER: 0xFF0000,
    WARNING: 0xFFA500
};

class AutoModerationSystem {
    constructor(client) {
        this.client = client;
        this.isRunning = false;
        this.isProcessing = false;
        this.stats = {
            lastRun: null,
            totalRepRecovered: 0,
            totalRolesAdded: 0,
            totalRolesRemoved: 0
        };
    }

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
                        content: `${EMOJIS.Error || '❌'} Ação "${action}" não reconhecida.`,
                        components: []
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await interaction.editReply({
                content: `${EMOJIS.Error || '❌'} Ocorreu um erro.`,
                components: []
            });
        }
    }

    async handleModal(interaction, action) {
        try {
            switch (action) {
                case 'limits':
                    await this.processLimitConfigModal(interaction);
                    break;
                default:
                    await interaction.editReply({
                        content: `${EMOJIS.Error || '❌'} Modal "${action}" não reconhecido.`,
                        flags: 64
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleModal:', error);
            await interaction.editReply({
                content: `${EMOJIS.Error || '❌'} Ocorreu um erro.`,
                flags: 64
            });
        }
    }

    async handleToggleAutoMod(interaction) {
        const ConfigSystem = require('./configSystem');
        const current = ConfigSystem.getSetting(interaction.guildId, 'automod_enabled') === 'true';
        const newValue = !current;
        
        ConfigSystem.setSetting(interaction.guildId, 'automod_enabled', newValue.toString());
        
        const builder = ContainerFormatter.createBuilder(interaction.guild.name, COLORS.DEFAULT);
        builder.addTitle(`${EMOJIS.AutoMod || '🛡️'} Auto Moderação`, 1);
        builder.addText(`Sistema de auto moderação foi **${newValue ? 'ativado' : 'desativado'}** com sucesso!`);
        builder.addFooter(`Solicitado por ${interaction.user.tag}`);
        
        await interaction.editReply({ components: [builder.build()], flags: ['IsComponentsV2'] });
    }

    async handleAutoModConfig(interaction, param) {
        const ConfigSystem = require('./configSystem');
        
        if (param === 'limits') {
            const modal = new ModalBuilder()
                .setCustomId('automod:limits')
                .setTitle(`${EMOJIS.Config || '⚙️'} Configurar Limites`);
            
            const exemplarLimit = new TextInputBuilder()
                .setCustomId('exemplar_limit')
                .setLabel(`${EMOJIS.shinystar || '🎖️'} Limite para cargo Exemplar (1-100)`)
                .setPlaceholder('Ex: 95')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            
            const problematicLimit = new TextInputBuilder()
                .setCustomId('problematic_limit')
                .setLabel(`${EMOJIS.Warning || '⚠️'} Limite para cargo Problemático (1-100)`)
                .setPlaceholder('Ex: 30')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(exemplarLimit),
                new ActionRowBuilder().addComponents(problematicLimit)
            );
            
            await interaction.showModal(modal);
        } else {
            const exemplarLimit = ConfigSystem.getSetting(interaction.guildId, 'limit_exemplar') || '95';
            const problematicLimit = ConfigSystem.getSetting(interaction.guildId, 'limit_problematico') || '30';
            const isEnabled = ConfigSystem.getSetting(interaction.guildId, 'automod_enabled') === 'true';
            
            const builder = ContainerFormatter.createBuilder(interaction.guild.name, COLORS.DEFAULT);
            builder.addTitle(`${EMOJIS.Config || '⚙️'} Configurações da Auto Moderação`, 1);
            builder.addSeparator();
            builder.addText(`${EMOJIS.Status || '📊'} **Status:** ${isEnabled ? `${EMOJIS.Check || '✅'} Ativado` : `${EMOJIS.Error || '❌'} Desativado`}`);
            builder.addText(`${EMOJIS.shinystar || '🎖️'} **Limite Exemplar:** ${exemplarLimit} pontos`);
            builder.addText(`${EMOJIS.Warning || '⚠️'} **Limite Problemático:** ${problematicLimit} pontos`);
            builder.addText(`${EMOJIS.gain || '📈'} **Recuperação Diária:** +1 ponto para quem não tem punições nas últimas 24h`);
            builder.addText(`${EMOJIS.Reset || '🔄'} **Atualização:** Diariamente às 12:00`);
            builder.addFooter();
            
            await interaction.editReply({ components: [builder.build()], flags: ['IsComponentsV2'] });
        }
    }

    async processLimitConfigModal(interaction) {
        const ConfigSystem = require('./configSystem');
        
        const exemplarLimit = interaction.fields.getTextInputValue('exemplar_limit');
        const problematicLimit = interaction.fields.getTextInputValue('problematic_limit');
        
        const exLimit = parseInt(exemplarLimit);
        const probLimit = parseInt(problematicLimit);
        
        if (isNaN(exLimit) || exLimit < 1 || exLimit > 100) {
            return await interaction.editReply({
                content: `${EMOJIS.Error || '❌'} Limite para cargo Exemplar deve ser um número entre 1 e 100.`,
                flags: 64
            });
        }
        
        if (isNaN(probLimit) || probLimit < 1 || probLimit > 100) {
            return await interaction.editReply({
                content: `${EMOJIS.Error || '❌'} Limite para cargo Problemático deve ser um número entre 1 e 100.`,
                flags: 64
            });
        }
        
        if (probLimit >= exLimit) {
            return await interaction.editReply({
                content: `${EMOJIS.Error || '❌'} O limite para cargo Problemático deve ser menor que o limite para cargo Exemplar.`,
                flags: 64
            });
        }
        
        ConfigSystem.setSetting(interaction.guildId, 'limit_exemplar', exLimit.toString());
        ConfigSystem.setSetting(interaction.guildId, 'limit_problematico', probLimit.toString());
        
        const builder = ContainerFormatter.createBuilder(interaction.guild.name, COLORS.SUCCESS);
        builder.addTitle(`${EMOJIS.Check || '✅'} Configurações Atualizadas`, 1);
        builder.addSeparator();
        builder.addText(`${EMOJIS.shinystar || '🎖️'} **Limite Exemplar:** ${exLimit} pontos`);
        builder.addText(`${EMOJIS.Warning || '⚠️'} **Limite Problemático:** ${probLimit} pontos`);
        builder.addFooter(`Solicitado por ${interaction.user.tag}`);
        
        await interaction.editReply({ components: [builder.build()], flags: ['IsComponentsV2'] });
    }

    async handleAutoModReport(interaction) {
        const ConfigSystem = require('./configSystem');
        
        const totalUsers = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM reputation WHERE guild_id = ?`).get(interaction.guildId);
        const avgRep = db.prepare(`SELECT AVG(points) as avg FROM reputation WHERE guild_id = ?`).get(interaction.guildId);
        const exemplars = db.prepare(`SELECT COUNT(*) as count FROM reputation WHERE guild_id = ? AND points >= ?`).get(interaction.guildId, ConfigSystem.getSetting(interaction.guildId, 'limit_exemplar') || 95);
        const problematic = db.prepare(`SELECT COUNT(*) as count FROM reputation WHERE guild_id = ? AND points <= ?`).get(interaction.guildId, ConfigSystem.getSetting(interaction.guildId, 'limit_problematico') || 30);
        
        const builder = ContainerFormatter.createBuilder(interaction.guild.name, COLORS.DEFAULT);
        builder.addTitle(`${EMOJIS.Rank || '📊'} Relatório de Auto Moderação`, 1);
        builder.addSeparator();
        builder.addText(`${EMOJIS.user || '👥'} **Total de Usuários:** \`${totalUsers?.count || 0}\``);
        builder.addText(`${EMOJIS.star || '⭐'} **Reputação Média:** \`${Math.round(avgRep?.avg || 0)}/100\``);
        builder.addText(`${EMOJIS.shinystar || '🎖️'} **Usuários Exemplares:** \`${exemplars?.count || 0}\``);
        builder.addText(`${EMOJIS.Warning || '⚠️'} **Usuários Problemáticos:** \`${problematic?.count || 0}\``);
        builder.addText(`${EMOJIS.Date || '🕒'} **Última Execução:** ${this.stats.lastRun ? `<t:${Math.floor(this.stats.lastRun / 1000)}:R>` : 'Nunca executado'}`);
        builder.addText(`${EMOJIS.gain || '📈'} **Total Recuperado:** \`${this.stats.totalRepRecovered}\` pontos`);
        builder.addFooter();
        
        await interaction.editReply({ components: [builder.build()], flags: ['IsComponentsV2'] });
    }

    startWorker() {
        if (this.isRunning) {
            console.log('⚠️ [AutoMod] Worker já está rodando');
            return;
        }
        
        cron.schedule('0 12 * * *', async () => {
            console.log("🕛 [AutoMod] Executando manutenção agendada das 12:00");
            await this.executeDailyMaintenance();
        }, { timezone: "America/Sao_Paulo" });
        
        this.isRunning = true;
        console.log("🛡️ [AutoMod] Worker iniciado - Agendado para 12:00 (Brasília)");
    }

    async executeDailyMaintenance() {
        if (this.isProcessing) {
            console.log('⚠️ [AutoMod] Manutenção já em andamento, ignorando...');
            return;
        }
        
        this.isProcessing = true;
        console.log("🛡️ [AutoMod] Iniciando processamento de integridade diária...");
        this.stats.lastRun = Date.now();
        
        const ConfigSystem = require('./configSystem');
        const stats = {};
        let totalRepRecovered = 0;
        let totalRolesAdded = 0;
        let totalRolesRemoved = 0;

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

        try {
            const users = db.prepare(`SELECT * FROM reputation WHERE points >= 90 OR points <= 40`).all();

            for (const userData of users) {
                const { guild_id: gId, user_id: uId, points: rep } = userData;
                const guild = this.client.guilds.cache.get(gId);
                if (!guild) continue;

                if (!stats[gId]) {
                    stats[gId] = { added: 0, removed: 0, guildName: guild.name, exemplarAdded: 0, problematicAdded: 0 };
                }

                try {
                    const member = await guild.members.fetch(uId).catch(() => null);
                    if (!member) continue;

                    const roleExId = ConfigSystem.getSetting(gId, 'role_exemplar');
                    const roleProbId = ConfigSystem.getSetting(gId, 'role_problematico');
                    const limitEx = parseInt(ConfigSystem.getSetting(gId, 'limit_exemplar')) || 95;
                    const limitProb = parseInt(ConfigSystem.getSetting(gId, 'limit_problematico')) || 30;

                    if (roleExId) {
                        const hasEx = member.roles.cache.has(roleExId);
                        if (rep >= limitEx && !hasEx) {
                            await member.roles.add(roleExId).catch(() => null);
                            stats[gId].added++;
                            stats[gId].exemplarAdded++;
                            totalRolesAdded++;
                            await member.send(`${EMOJIS.shinystar || '✨'} Parabéns! Sua conduta em **${guild.name}** é exemplar e você recebeu um cargo especial!`).catch(() => null);
                        } else if (rep < (limitEx - 5) && hasEx) {
                            await member.roles.remove(roleExId).catch(() => null);
                            stats[gId].removed++;
                            totalRolesRemoved++;
                        }
                    }

                    if (roleProbId) {
                        const hasProb = member.roles.cache.has(roleProbId);
                        if (rep <= limitProb && !hasProb) {
                            await member.roles.add(roleProbId).catch(() => null);
                            stats[gId].added++;
                            stats[gId].problematicAdded++;
                            totalRolesAdded++;
                            await member.send(`${EMOJIS.Warning || '⚠️'} Sua reputação em **${guild.name}** atingiu um nível crítico. Melhore sua conduta para evitar sanções severas!`).catch(() => null);
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

        this.stats.totalRepRecovered += totalRepRecovered;
        this.stats.totalRolesAdded += totalRolesAdded;
        this.stats.totalRolesRemoved += totalRolesRemoved;

        await this.sendLogReports(stats);
        console.log(`✅ [AutoMod] Manutenção concluída - Recuperados: ${totalRepRecovered} | Cargos: +${totalRolesAdded} / -${totalRolesRemoved}`);
        this.isProcessing = false;
    }

    async sendLogReports(stats) {
        const ConfigSystem = require('./configSystem');
        
        for (const [gId, data] of Object.entries(stats)) {
            try {
                const logChanId = ConfigSystem.getSetting(gId, 'log_automod');
                if (!logChanId) continue;
                
                const channel = await this.client.channels.fetch(logChanId).catch(() => null);
                if (!channel) continue;

                const builder = ContainerFormatter.createBuilder(data.guildName, COLORS.DEFAULT);
                builder.addTitle(`${EMOJIS.Check || '✅'} Manutenção Diária Concluída`, 1);
                builder.addSeparator();
                builder.addText(`${EMOJIS.gain || '📈'} **Recuperação:** Usuários sem infrações recentes receberam **+1pt**.`);
                builder.addText(`${EMOJIS.Leadboard || '🎭'} **Alterações de Cargos:** \`${data.added}\` Atribuídos / \`${data.removed}\` Removidos`);
                builder.addText(`${EMOJIS.Rank || '📊'} **Detalhes:** ${EMOJIS.shinystar || '🎖️'} Exemplares: +${data.exemplarAdded || 0} | ${EMOJIS.Warning || '⚠️'} Problemáticos: +${data.problematicAdded || 0}`);
                builder.addFooter();

                await channel.send({ components: [builder.build()], flags: ['IsComponentsV2'] });
                console.log(`✅ [AutoMod] Log enviado para ${data.guildName}`);
                ConfigSystem.setSetting(gId, 'last_automod_run', Date.now().toString());
            } catch (e) {
                console.error(`❌ [AutoMod] Erro ao enviar log para ${gId}:`, e.message);
            }
        }
    }

    getStats() {
        return { ...this.stats, isRunning: this.isRunning, uptime: this.isRunning ? (Date.now() - (this.stats.lastRun || Date.now())) : 0 };
    }

    async runManualMaintenance() {
        console.log("🛡️ [AutoMod] Execução manual solicitada");
        await this.executeDailyMaintenance();
        return this.getStats();
    }
}

module.exports = (client) => {
    const autoMod = new AutoModerationSystem(client);
    autoMod.startWorker();
    return autoMod;
};

module.exports.AutoModerationSystem = AutoModerationSystem;

module.exports.handler = {
    handleComponent: async (interaction, action, param) => {
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