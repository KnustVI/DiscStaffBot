// /home/ubuntu/DiscStaffBot/src/systems/moderation/autoModeration.js
const cron = require('node-cron');
const db = require('../../database/index');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const SessionManager = require('../../utils/sessionManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let EMOJIS = {};
try {
    const emojisFile = require('../../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

// ============================================
// SINGLETON - CONTROLE DE INSTÂNCIA ÚNICA
// ============================================
let instance = null;
let isWorkerStarted = false;

class AutoModerationSystem {
    constructor(client) {
        if (instance) {
            console.log('⚠️ [AutoMod] Tentativa de criar nova instância - retornando existente');
            return instance;
        }

        this.client = client;
        this.isRunning = false;
        this.isProcessing = false;
        this.stats = {
            lastRun: null,
            totalRepRecovered: 0,
            totalRolesAdded: 0,
            totalRolesRemoved: 0
        };

        instance = this;
        
        console.log('🛡️ [AutoMod] Instância criada (worker será iniciado separadamente)');
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
                        content: `${EMOJIS.circlealert || '❌'} Ação "${action}" não reconhecida.`,
                        components: []
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await interaction.editReply({
                content: `${EMOJIS.circlealert || '❌'} Ocorreu um erro.`,
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
                        content: `${EMOJIS.circlealert || '❌'} Modal "${action}" não reconhecido.`,
                        flags: 64
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleModal:', error);
            await interaction.editReply({
                content: `${EMOJIS.circlealert || '❌'} Ocorreu um erro.`,
                flags: 64
            });
        }
    }

    async handleToggleAutoMod(interaction) {
        const ConfigSystem = require('../core/configSystem');
        const current = ConfigSystem.getSetting(interaction.guildId, 'automod_enabled') === 'true';
        const newValue = !current;

        ConfigSystem.setSetting(interaction.guildId, 'automod_enabled', newValue.toString());
        await ConfigSystem.logConfigChange(interaction, `${EMOJIS.shieldcheck || '🛡️'} Auto Moderação: ${newValue ? 'ativada' : 'desativada'}`);

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.title(`${EMOJIS.shieldcheck || '🛡️'} Auto Moderação`, 1);
        builder.text(`Sistema de auto moderação foi **${newValue ? 'ativado' : 'desativado'}** com sucesso!`);
        builder.footer(interaction.guild?.name, `Solicitado por ${interaction.user.tag}`);
        
        const { components, flags } = builder.build();
        await interaction.editReply({ components, flags: [flags] });
    }

    async handleAutoModConfig(interaction, param) {
        const ConfigSystem = require('../core/configSystem');
        
        if (param === 'limits') {
            const modal = new ModalBuilder()
                .setCustomId('automod:limits')
                .setTitle('⚙️ Configurar Limites');
            
            const exemplarLimit = new TextInputBuilder()
                .setCustomId('exemplar_limit')
                .setLabel(`${EMOJIS.sparkles || '🎖️'} Limite para cargo Exemplar (1-100)`)
                .setPlaceholder('Ex: 95')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            
            const problematicLimit = new TextInputBuilder()
                .setCustomId('problematic_limit')
                .setLabel(`${EMOJIS.trianglealert || '⚠️'} Limite para cargo Problemático (1-100)`)
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
            
            const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            builder.title(`${EMOJIS.settings || '⚙️'} Configurações da Auto Moderação`, 1);
            builder.separator();
            builder.text(`${EMOJIS.circledot || '📊'} **Status:** ${isEnabled ? `${EMOJIS.toggleon || '✅'} Ativado` : `${EMOJIS.toggleoff || '❌'} Desativado`}`);
            builder.text(`${EMOJIS.sparkles || '🎖️'} **Limite Exemplar:** ${exemplarLimit} pontos`);
            builder.text(`${EMOJIS.trianglealert || '⚠️'} **Limite Problemático:** ${problematicLimit} pontos`);
            builder.text(`${EMOJIS.trendingup || '📈'} **Recuperação Diária:** +1 ponto para quem não tem punições nas últimas 24h`);
            builder.text(`${EMOJIS.refreshccw || '🔄'} **Atualização:** Diariamente às 12:00`);
            builder.footer(interaction.guild?.name);
            
            const { components, flags } = builder.build();
            await interaction.editReply({ components, flags: [flags] });
        }
    }

    async processLimitConfigModal(interaction) {
        const ConfigSystem = require('../core/configSystem');
        
        const exemplarLimit = interaction.fields.getTextInputValue('exemplar_limit');
        const problematicLimit = interaction.fields.getTextInputValue('problematic_limit');
        
        const exLimit = parseInt(exemplarLimit);
        const probLimit = parseInt(problematicLimit);
        
        if (isNaN(exLimit) || exLimit < 1 || exLimit > 100) {
            return await interaction.editReply({
                content: `${EMOJIS.circlealert || '❌'} Limite para cargo Exemplar deve ser um número entre 1 e 100.`,
                flags: 64
            });
        }
        
        if (isNaN(probLimit) || probLimit < 1 || probLimit > 100) {
            return await interaction.editReply({
                content: `${EMOJIS.circlealert || '❌'} Limite para cargo Problemático deve ser um número entre 1 e 100.`,
                flags: 64
            });
        }
        
        if (probLimit >= exLimit) {
            return await interaction.editReply({
                content: `${EMOJIS.circlealert || '❌'} O limite para cargo Problemático deve ser menor que o limite para cargo Exemplar.`,
                flags: 64
            });
        }
        
        const oldExemplar = ConfigSystem.getSetting(interaction.guildId, 'limit_exemplar');
        const oldProblematic = ConfigSystem.getSetting(interaction.guildId, 'limit_problematico');

        ConfigSystem.setSetting(interaction.guildId, 'limit_exemplar', exLimit.toString());
        ConfigSystem.setSetting(interaction.guildId, 'limit_problematico', probLimit.toString());
        await ConfigSystem.logConfigChange(interaction, [
            `${EMOJIS.sparkles || '🎖️'} Limite Exemplar: \`${oldExemplar || 95}\` → \`${exLimit}\``,
            `${EMOJIS.trianglealert || '⚠️'} Limite Problemático: \`${oldProblematic || 30}\` → \`${probLimit}\``,
        ]);

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
        builder.title(`${EMOJIS.circlecheck || '✅'} Configurações Atualizadas`, 1);
        builder.separator();
        builder.text(`${EMOJIS.sparkles || '🎖️'} **Limite Exemplar:** ${exLimit} pontos`);
        builder.text(`${EMOJIS.trianglealert || '⚠️'} **Limite Problemático:** ${probLimit} pontos`);
        builder.footer(interaction.guild?.name, `Solicitado por ${interaction.user.tag}`);
        
        const { components, flags } = builder.build();
        await interaction.editReply({ components, flags: [flags] });
    }

    async handleAutoModReport(interaction) {
        const ConfigSystem = require('../core/configSystem');
        
        const totalUsers = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM reputation WHERE guild_id = ?`).get(interaction.guildId);
        const avgRep = db.prepare(`SELECT AVG(points) as avg FROM reputation WHERE guild_id = ?`).get(interaction.guildId);
        const exemplars = db.prepare(`SELECT COUNT(*) as count FROM reputation WHERE guild_id = ? AND points >= ?`).get(interaction.guildId, ConfigSystem.getSetting(interaction.guildId, 'limit_exemplar') || 95);
        const problematic = db.prepare(`SELECT COUNT(*) as count FROM reputation WHERE guild_id = ? AND points <= ?`).get(interaction.guildId, ConfigSystem.getSetting(interaction.guildId, 'limit_problematico') || 30);
        
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.title(`${EMOJIS.medal || '📊'} Relatório de Auto Moderação`, 1);
        builder.separator();
        builder.text(`${EMOJIS.user || '👥'} **Total de Usuários:** \`${totalUsers?.count || 0}\``);
        builder.text(`${EMOJIS.star || '⭐'} **Reputação Média:** \`${Math.round(avgRep?.avg || 0)}/100\``);
        builder.text(`${EMOJIS.sparkles || '🎖️'} **Usuários Exemplares:** \`${exemplars?.count || 0}\``);
        builder.text(`${EMOJIS.trianglealert || '⚠️'} **Usuários Problemáticos:** \`${problematic?.count || 0}\``);
        builder.text(`${EMOJIS.calendar || '🕒'} **Última Execução:** ${this.stats.lastRun ? `<t:${Math.floor(this.stats.lastRun / 1000)}:R>` : 'Nunca executado'}`);
        builder.text(`${EMOJIS.trendingup || '📈'} **Total Recuperado:** \`${this.stats.totalRepRecovered}\` pontos`);
        builder.footer(interaction.guild?.name);
        
        const { components, flags } = builder.build();
        await interaction.editReply({ components, flags: [flags] });
    }

    startWorker() {
        if (this.isRunning || isWorkerStarted) {
            console.log('⚠️ [AutoMod] Worker já está rodando');
            return;
        }
        
        isWorkerStarted = true;
        this.isRunning = true;
        
        cron.schedule('0 12 * * *', async () => {
            console.log("🕛 [AutoMod] Executando manutenção agendada das 12:00");
            await this.executeDailyMaintenance();
        }, { timezone: "America/Sao_Paulo" });
        
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
        
        const ConfigSystem = require('../core/configSystem');
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
                            await member.send(`${EMOJIS.sparkles || '✨'} Parabéns! Sua conduta em **${guild.name}** é exemplar e você recebeu um cargo especial!`).catch(() => null);
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
                            await member.send(`${EMOJIS.trianglealert || '⚠️'} Sua reputação em **${guild.name}** atingiu um nível crítico. Melhore sua conduta para evitar sanções severas!`).catch(() => null);
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

    /**
     * Envia o relatório diário consolidado.
     *
     * ✅ UNIFICADO: o relatório agora vai para o canal "Geral" (chave
     * 'log_channel'), via ConfigSystem.getUnifiedGeneralLogChannel().
     * Antes ia para 'log_automod', que deixou de ser configurável
     * separadamente no painel /config-logs (mantido só como fallback legado
     * para guilds que já tinham configurado antes da unificação).
     *
     * ✅ EXPANDIDO: além do resumo de recuperação/cargos que já existia,
     * o relatório agora também inclui:
     *  - Status atual do servidor (total de exemplares e alerta de
     *    problemáticos no momento, não só os que mudaram hoje)
     *  - Top 5 staffs por punições aplicadas nos últimos 7 dias
     *    (via AnalyticsSystem.getStaffRanking)
     */
    async sendLogReports(stats) {
        const ConfigSystem = require('../core/configSystem');
        const AnalyticsSystem = require('./analyticsSystem');

        for (const [gId, data] of Object.entries(stats)) {
            try {
                const logChanId = ConfigSystem.getUnifiedGeneralLogChannel(gId);
                if (!logChanId) continue;
                
                const channel = await this.client.channels.fetch(logChanId).catch(() => null);
                if (!channel) continue;

                // ── Status atual do servidor (contagem total, não só do dia) ────
                const limitProb = parseInt(ConfigSystem.getSetting(gId, 'limit_problematico')) || 30;
                const problematicCount = db.prepare(`
                    SELECT COUNT(*) as count FROM reputation 
                    WHERE guild_id = ? AND points <= ?
                `).get(gId, limitProb)?.count || 0;

                const limitEx = parseInt(ConfigSystem.getSetting(gId, 'limit_exemplar')) || 95;
                const exemplarCount = db.prepare(`
                    SELECT COUNT(*) as count FROM reputation 
                    WHERE guild_id = ? AND points >= ?
                `).get(gId, limitEx)?.count || 0;

                // ── Ranking de staff (top 5 por punições aplicadas, 7 dias) ──────
                let rankingLines = [];
                try {
                    const ranking = await AnalyticsSystem.getStaffRanking(gId, 'punishments_applied', 'week', 5);
                    rankingLines = ranking
                        .filter(r => r.total > 0)
                        .map((r, i) => {
                            const medal = i === 0 ? (EMOJIS.medalha1 || '🥇') : (i === 1 ? (EMOJIS.medalha2 || '🥈') : (i === 2 ? (EMOJIS.medalha3 || '🥉') : `${i + 1}º`));
                            return `${medal} <@${r.user_id}>: \`${r.total}\` punições (7d)`;
                        });
                } catch (err) {
                    console.error('❌ [AutoMod] Erro ao buscar ranking de staff:', err);
                }

                const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
                builder.title(`${EMOJIS.circlecheck || '✅'} Manutenção Diária Concluída`, 1);
                builder.separator();
                builder.text(`${EMOJIS.trendingup || '📈'} **Recuperação:** Usuários sem infrações recentes receberam **+1pt**.`);
                builder.text(`${EMOJIS.trophy || '🎭'} **Alterações de Cargos:** \`${data.added}\` Atribuídos / \`${data.removed}\` Removidos`);
                builder.text(`${EMOJIS.medal || '📊'} **Detalhes:** ${EMOJIS.sparkles || '🎖️'} Exemplares: +${data.exemplarAdded || 0} | ${EMOJIS.trianglealert || '⚠️'} Problemáticos: +${data.problematicAdded || 0}`);
                builder.separator();

                builder.title(`${EMOJIS.trianglealert || '⚠️'} Status Atual do Servidor`, 2);
                builder.text(`${EMOJIS.sparkles || '🎖️'} **Exemplares atualmente:** \`${exemplarCount}\``);
                if (problematicCount > 0) {
                    builder.text(`${EMOJIS.trianglealert || '⚠️'} **Alerta — Jogadores Problemáticos:** \`${problematicCount}\` usuário(s) com reputação ≤ ${limitProb} pontos.`);
                } else {
                    builder.text(`${EMOJIS.circlecheck || '✅'} **Problemáticos:** Nenhum usuário em estado crítico no momento.`);
                }
                builder.separator();

                builder.title(`${EMOJIS.trophy || '🏆'} Top Staff (últimos 7 dias)`, 2);
                if (rankingLines.length > 0) {
                    builder.text(rankingLines.join('\n'));
                } else {
                    builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Sem punições registradas nos últimos 7 dias.`);
                }
                builder.footer(data.guildName);

                const { components, flags } = builder.build();
                await channel.send({ components, flags: [flags] });
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

// ============================================
// FUNÇÃO DE INICIALIZAÇÃO (SINGLETON)
// ============================================
function initializeAutoModeration(client) {
    if (!global.autoModInstance) {
        console.log('🛡️ [AutoMod] Inicializando sistema pela primeira vez...');
        global.autoModInstance = new AutoModerationSystem(client);
        global.autoModInstance.startWorker();
        console.log('🛡️ [AutoMod] Sistema inicializado e worker iniciado');
    } else {
        console.log('🛡️ [AutoMod] Sistema já inicializado, reutilizando instância');
        if (!global.autoModInstance.isRunning) {
            global.autoModInstance.startWorker();
        }
    }
    return global.autoModInstance;
}

// ============================================
// EXPORTAÇÕES
// ============================================

module.exports = initializeAutoModeration;
module.exports.AutoModerationSystem = AutoModerationSystem;
module.exports.getInstance = function() {
    return global.autoModInstance || null;
};

module.exports.handler = {
    handleComponent: async (interaction, action, param) => {
        if (!global.autoModInstance) {
            throw new Error('AutoModerationSystem não foi inicializado');
        }
        return global.autoModInstance.handleComponent(interaction, action, param);
    },
    handleModal: async (interaction, action) => {
        if (!global.autoModInstance) {
            throw new Error('AutoModerationSystem não foi inicializado');
        }
        return global.autoModInstance.handleModal(interaction, action);
    },
    handleToggleAutoMod: async (interaction) => {
        if (!global.autoModInstance) {
            throw new Error('AutoModerationSystem não foi inicializado');
        }
        return global.autoModInstance.handleToggleAutoMod(interaction);
    },
    handleAutoModReport: async (interaction) => {
        if (!global.autoModInstance) {
            throw new Error('AutoModerationSystem não foi inicializado');
        }
        return global.autoModInstance.handleAutoModReport(interaction);
    },
    handleAutoModConfig: async (interaction, param) => {
        if (!global.autoModInstance) {
            throw new Error('AutoModerationSystem não foi inicializado');
        }
        return global.autoModInstance.handleAutoModConfig(interaction, param);
    }
};