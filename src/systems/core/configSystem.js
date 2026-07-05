// /home/ubuntu/DiscStaffBot/src/systems/core/configSystem.js
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { 
    ActionRowBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    MessageFlags
} = require('discord.js');

const cache = new Map();

let EMOJIS = {};
try {
    const emojisFile = require('../../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

/**
 * Definição dos 3 grupos (abas) do painel /config-roles — separados porque
 * um único painel com os 6 RoleSelectMenus (staff, strike, exemplar,
 * problematico, supervisor, event) ultrapassaria a quantidade segura de
 * ActionRows por mensagem. Cada aba tem no máximo 3 selects + 1 linha de
 * botões de navegação + o container = 5 componentes de topo, mesmo padrão
 * já usado em /config-logs.
 */
const ROLE_TABS = {
    automod: {
        label: 'Reputação Automática',
        icon: 'trendingup',
        headerTitle: '# CARGOS AUTOMÁTICOS - REPUTAÇÃO',
        headerDesc: 'Estes cargos são atribuídos e removidos automaticamente pelo sistema, com base na reputação do membro e nas punições ativas. Não é necessário atribuí-los manualmente.',
        fields: [
            {
                key: 'strike_role', icon: 'shieldalert', label: 'Strike (Temporário)',
                desc: 'Atribuído automaticamente enquanto uma punição temporária está ativa. Removido quando a punição expira ou é anulada.',
                customId: 'config-roles:strike',
            },
            {
                key: 'role_exemplar', icon: 'sparkles', label: 'Exemplar',
                desc: 'Atribuído automaticamente a membros com reputação acima do limite configurado em /config-punishments. Indica bom comportamento.',
                customId: 'config-roles:exemplar',
            },
            {
                key: 'role_problematico', icon: 'trianglealert', label: 'Problemático',
                desc: 'Atribuído automaticamente a membros com reputação abaixo do limite configurado em /config-punishments. Sinaliza comportamento problemático.',
                customId: 'config-roles:problematico',
            },
        ],
    },
    moderation: {
        label: 'Moderação',
        icon: 'shieldcheck',
        headerTitle: '# CARGOS DE MODERAÇÃO',
        headerDesc: 'Cargos que controlam quem pode usar os comandos de moderação e quem pode aprovar as punições mais severas.',
        fields: [
            {
                key: 'staff_role', icon: 'shield', label: 'Staff (obrigatório)',
                desc: 'Permite usar os comandos de moderação (/strike, /unstrike, /historico) e atender reports no ReportChat. Sem esse cargo configurado, a staff não consegue usar o sistema.',
                customId: 'config-roles:staff',
            },
            {
                key: 'supervisor_role', icon: 'shieldban', label: 'Supervisor',
                desc: 'Tem autoridade para aprovar ou aplicar diretamente punições severas (Nível 4 - Severa, ou Nível 5 - Permanente), como bans permanentes ou muito longos. Quando um Staff comum aplica uma punição desse nível, o pedido é enviado para este cargo aprovar no canal de log de punições antes de ser executado.',
                customId: 'config-roles:supervisor',
            },
        ],
    },
    events: {
        label: 'Eventos',
        icon: 'partypopper',
        headerTitle: '# CARGOS DE EVENTOS',
        headerDesc: 'Cargos usados pelo comando /evento: quem pode criar eventos, e quem é avisado quando um novo evento é publicado.',
        fields: [
            {
                key: 'event_role', icon: 'calendardays', label: 'Equipe de Eventos',
                desc: 'Permite usar o comando /evento para criar e publicar eventos da comunidade.',
                customId: 'config-roles:event',
            },
            {
                key: 'event_notify_role', icon: 'megaphone', label: 'Notificação de Eventos',
                desc: 'Marcado automaticamente na postagem do fórum sempre que um novo evento é publicado, para avisar quem tem interesse. Não precisa ter permissão nenhuma, é só um cargo de avisos.',
                customId: 'config-roles:event-notify',
            },
        ],
    },
};

const ROLE_LABELS = Object.fromEntries(
    Object.values(ROLE_TABS).flatMap(tab => tab.fields.map(f => [f.key, f.label])),
);

const ConfigSystem = {
    getSetting(guildId, key) {
        try {
            const cacheKey = `${guildId}_${key}`;
            if (cache.has(cacheKey)) return cache.get(cacheKey);
            const row = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key);
            const val = row ? row.value : null;
            cache.set(cacheKey, val);
            return val;
        } catch (error) {
            console.error(`❌ Erro ao buscar configuração ${key}:`, error);
            return null;
        }
    },

    setSetting(guildId, key, value) {
        try {
            const finalValue = value?.toString() || null;
            db.prepare(`
                INSERT INTO settings (guild_id, key, value) 
                VALUES (?, ?, ?)
                ON CONFLICT(guild_id, key) 
                DO UPDATE SET value = excluded.value
            `).run(guildId, key, finalValue);
            cache.set(`${guildId}_${key}`, finalValue);
            return true;
        } catch (error) {
            console.error(`❌ Erro ao salvar configuração ${key}:`, error);
            return false;
        }
    },

    /**
     * Retorna o canal de log "Geral / AutoMod" unificado.
     *
     * ✅ UNIFICAÇÃO: Geral e AutoMod agora compartilham o mesmo canal,
     * configurado pela chave 'log_channel'. A chave antiga 'log_automod'
     * é mantida como FALLBACK LEGADO apenas: se um servidor antigo já
     * tinha um canal de AutoMod configurado separadamente e nunca
     * configurou 'log_channel', ainda usamos o valor antigo para não
     * quebrar quem já estava em produção. Novas configurações sempre
     * gravam em 'log_channel' (ver setLogChannel).
     *
     * @param {string} guildId
     * @returns {string|null}
     */
    getUnifiedGeneralLogChannel(guildId) {
        const current = this.getSetting(guildId, 'log_channel');
        if (current) return current;
        return this.getSetting(guildId, 'log_automod'); // fallback legado
    },

    /**
     * Envia um registro de "configuração alterada" para o canal de log
     * Geral (mesmo canal usado pelo relatório diário do AutoMod — ver
     * getUnifiedGeneralLogChannel). Usado por qualquer comando
     * administrativo que altere uma configuração do servidor.
     *
     * Falha silenciosamente se o canal não estiver configurado ou não
     * puder ser alcançado — mesmo padrão usado nos demais envios de log.
     *
     * @param {import('discord.js').Interaction} interaction
     * @param {string|string[]} lines - Linha(s) descrevendo a alteração
     */
    async logConfigChange(interaction, lines) {
        const entries = Array.isArray(lines) ? lines : [lines];
        if (entries.length === 0) return;

        try {
            const logChannelId = this.getUnifiedGeneralLogChannel(interaction.guildId);
            if (!logChannelId) return;

            const channel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
            if (!channel) return;

            const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            builder.title(`${EMOJIS.settings || '⚙️'} Configuração Alterada`);
            builder.text(`**Responsável:** ${interaction.user}`);
            builder.separator();
            builder.block(entries);
            builder.footer(interaction.guild.name);

            const { components, flags } = builder.build();
            await channel.send({ components, flags: [flags] });
        } catch (error) {
            console.error('❌ Erro ao enviar log de alteração de configuração:', error);
        }
    },

    getMany(guildId, keys = []) {
        const result = {};
        for (const key of keys) {
            result[key] = this.getSetting(guildId, key);
        }
        return result;
    },

    clearCache(guildId) {
        try {
            for (const key of cache.keys()) {
                if (key.startsWith(`${guildId}_`)) cache.delete(key);
            }
        } catch (error) {
            console.error(`❌ Erro ao limpar cache:`, error);
        }
    },

    async handleComponent(interaction, action, param) {
        try {
            const customId = interaction.customId;
            
            if (customId.startsWith('config-punishments:strike')) {
                await this.handleStrikeModal(interaction);
                return;
            }
            if (customId.startsWith('config-punishments:limites')) {
                await this.handleLimitesModal(interaction);
                return;
            }
            if (customId.startsWith('config-punishments:recovery')) {
                await this.handleRecoveryModal(interaction);
                return;
            }
            if (customId === 'config-punishments:reset') {
                await this.resetPoints(interaction);
                return;
            }
            if (customId === 'config-roles:staff') {
                await this.setRole(interaction, 'staff_role');
                return;
            }
            if (customId === 'config-roles:strike') {
                await this.setRole(interaction, 'strike_role');
                return;
            }
            if (customId === 'config-roles:exemplar') {
                await this.setRole(interaction, 'role_exemplar');
                return;
            }
            if (customId === 'config-roles:problematico') {
                await this.setRole(interaction, 'role_problematico');
                return;
            }
            if (customId === 'config-roles:supervisor') {
                await this.setRole(interaction, 'supervisor_role');
                return;
            }
            if (customId === 'config-roles:event') {
                await this.setRole(interaction, 'event_role');
                return;
            }
            if (customId === 'config-roles:event-notify') {
                await this.setRole(interaction, 'event_notify_role');
                return;
            }
            if (customId.startsWith('config-roles:tab:')) {
                const tab = customId.split(':')[2];
                await this.refreshRolesPanel(interaction, null, tab);
                return;
            }
            if (customId === 'config-logs:geral') {
                // ✅ UNIFICADO: este select agora cobre Geral + AutoMod.
                await this.setLogChannel(interaction, 'log_channel');
                return;
            }
            if (customId === 'config-logs:punishments') {
                await this.setLogChannel(interaction, 'log_punishments');
                return;
            }
            if (customId === 'config-logs:reports') {
                await this.setLogChannel(interaction, 'log_reports');
                return;
            }
            if (customId === 'config-logs:criar') {
                await this.createLogChannels(interaction);
                return;
            }
            
            await ResponseManager.error(interaction, `Ação não reconhecida: ${customId}`);
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await ResponseManager.error(interaction, 'Ocorreu um erro ao processar a configuração.');
        }
    },

    async handleModal(interaction, action) {
        try {
            if (interaction.customId === 'config-punishments:strike:modal:submit') {
                await this.processPointsStrikeModal(interaction);
                return;
            }
            if (interaction.customId === 'config-punishments:limites:modal:submit') {
                await this.processLimitesModal(interaction);
                return;
            }
            if (interaction.customId === 'config-punishments:recovery:modal:submit') {
                await this.processRecoveryModal(interaction);
                return;
            }
            await ResponseManager.error(interaction, 'Modal não reconhecido.');
        } catch (error) {
            console.error('❌ Erro no handleModal:', error);
            await ResponseManager.error(interaction, 'Ocorreu um erro ao processar o modal.');
        }
    },

    async handleStrikeModal(interaction) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }
        
        const guildId = interaction.guildId;
        const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
        
        const pontos = {
            1: parseInt(this.getSetting(guildId, 'strike_points_1')) || DEFAULT_POINTS[1],
            2: parseInt(this.getSetting(guildId, 'strike_points_2')) || DEFAULT_POINTS[2],
            3: parseInt(this.getSetting(guildId, 'strike_points_3')) || DEFAULT_POINTS[3],
            4: parseInt(this.getSetting(guildId, 'strike_points_4')) || DEFAULT_POINTS[4],
            5: parseInt(this.getSetting(guildId, 'strike_points_5')) || DEFAULT_POINTS[5]
        };
        
        const rows = [
            new ActionRowBuilder().addComponents(new TextInputBuilder({ customId: 'nivel1', label: 'Nivel 1 (Leve)', style: TextInputStyle.Short, required: true, value: pontos[1].toString(), placeholder: 'Ex: 10' })),
            new ActionRowBuilder().addComponents(new TextInputBuilder({ customId: 'nivel2', label: 'Nivel 2 (Moderada)', style: TextInputStyle.Short, required: true, value: pontos[2].toString(), placeholder: 'Ex: 10' })),
            new ActionRowBuilder().addComponents(new TextInputBuilder({ customId: 'nivel3', label: 'Nivel 3 (Grave)', style: TextInputStyle.Short, required: true, value: pontos[3].toString(), placeholder: 'Ex: 10' })),
            new ActionRowBuilder().addComponents(new TextInputBuilder({ customId: 'nivel4', label: 'Nivel 4 (Severa)', style: TextInputStyle.Short, required: true, value: pontos[4].toString(), placeholder: 'Ex: 10' })),
            new ActionRowBuilder().addComponents(new TextInputBuilder({ customId: 'nivel5', label: 'Nivel 5 (Perm)', style: TextInputStyle.Short, required: true, value: pontos[5].toString(), placeholder: 'Ex: 10' }))
        ];
        
        const modal = new ModalBuilder({ customId: 'config-punishments:strike:modal:submit', title: 'Configurar Niveis', components: rows });
        await interaction.showModal(modal);
    },

    async handleLimitesModal(interaction) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }
        
        const guildId = interaction.guildId;
        const exemplarLimit = parseInt(this.getSetting(guildId, 'limit_exemplar')) || 95;
        const problematicLimit = parseInt(this.getSetting(guildId, 'limit_problematico')) || 30;
        
        const rows = [
            new ActionRowBuilder().addComponents(new TextInputBuilder({ customId: 'exemplar_limit', label: 'Limite Exemplar (50-100)', style: TextInputStyle.Short, required: true, value: exemplarLimit.toString(), placeholder: 'Ex: 95' })),
            new ActionRowBuilder().addComponents(new TextInputBuilder({ customId: 'problematic_limit', label: 'Limite Problematico (0-50)', style: TextInputStyle.Short, required: true, value: problematicLimit.toString(), placeholder: 'Ex: 30' }))
        ];
        
        const modal = new ModalBuilder({ customId: 'config-punishments:limites:modal:submit', title: 'Configurar Limites', components: rows });
        await interaction.showModal(modal);
    },

    async handleRecoveryModal(interaction) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }

        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.getGuildLimits(interaction.guildId).automodEnabled) {
            return await ResponseManager.error(interaction, 'A personalização da recuperação diária de reputação é um recurso exclusivo do plano Fossil (é a mesma "manutenção diária" do automod, que só roda nesse tier).');
        }

        const guildId = interaction.guildId;
        const recoveryAmount = parseInt(this.getSetting(guildId, 'rep_recovery_amount')) || 1;

        const row = new ActionRowBuilder().addComponents(
            new TextInputBuilder({
                customId: 'recovery_amount',
                label: 'Pontos recuperados por dia (0-100)',
                style: TextInputStyle.Short,
                required: true,
                value: recoveryAmount.toString(),
                placeholder: 'Ex: 1',
            })
        );

        const modal = new ModalBuilder({ customId: 'config-punishments:recovery:modal:submit', title: 'Recuperação Diária de Reputação', components: [row] });
        await interaction.showModal(modal);
    },

    async processRecoveryModal(interaction) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.getGuildLimits(interaction.guildId).automodEnabled) {
            return await ResponseManager.error(interaction, 'A personalização da recuperação diária de reputação é um recurso exclusivo do plano Fossil.');
        }

        const recoveryAmount = parseInt(interaction.fields.getTextInputValue('recovery_amount'));
        if (isNaN(recoveryAmount) || recoveryAmount < 0 || recoveryAmount > 100) {
            return await ResponseManager.error(interaction, 'A recuperação diária deve ser um número entre 0 e 100.');
        }

        const oldValue = this.getSetting(interaction.guildId, 'rep_recovery_amount');
        this.setSetting(interaction.guildId, 'rep_recovery_amount', recoveryAmount.toString());
        this.clearCache(interaction.guildId);

        const changeMessage = oldValue != recoveryAmount
            ? `${EMOJIS.circlecheck || '✅'} **Recuperação diária atualizada:** \`${oldValue || 1}\` → \`${recoveryAmount}\` ponto(s)/dia.`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (oldValue != recoveryAmount) await this.logConfigChange(interaction, [`${EMOJIS.trendingup || '📈'} Recuperação diária: \`${oldValue || 1}\` → \`${recoveryAmount}\` ponto(s)/dia`]);
        await this.refreshPointsPanel(interaction, changeMessage, interaction.guild.name);
    },

    async processPointsStrikeModal(interaction) {
        const novosPontos = {
            1: parseInt(interaction.fields.getTextInputValue('nivel1')),
            2: parseInt(interaction.fields.getTextInputValue('nivel2')),
            3: parseInt(interaction.fields.getTextInputValue('nivel3')),
            4: parseInt(interaction.fields.getTextInputValue('nivel4')),
            5: parseInt(interaction.fields.getTextInputValue('nivel5'))
        };
        
        const changes = [];
        const severityIcons = ['', EMOJIS.severidadebaixa || '🟢', EMOJIS.severidademedia || '🟡', EMOJIS.severidadelaranja || '🟠', EMOJIS.severidadealta || '🔴', EMOJIS.Dead || '💀'];
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        
        for (let i = 1; i <= 5; i++) {
            if (isNaN(novosPontos[i]) || novosPontos[i] < 0 || novosPontos[i] > 100) {
                return await ResponseManager.error(interaction, `Nível ${i} deve ser um número entre 0 e 100.`);
            }
        }
        
        for (let i = 1; i <= 5; i++) {
            const valorAntigo = this.getSetting(interaction.guildId, `strike_points_${i}`);
            if (valorAntigo !== novosPontos[i].toString()) {
                this.setSetting(interaction.guildId, `strike_points_${i}`, novosPontos[i].toString());
                changes.push(`${severityIcons[i]} Nível ${i} (${severityNames[i]}): \`${valorAntigo || 'padrão'}\` → \`${novosPontos[i]}\``);
            }
        }
        
        this.clearCache(interaction.guildId);
        const changeMessage = changes.length > 0
            ? `${EMOJIS.circlecheck || '✅'} **${changes.length} alterações salvas!**\n${changes.join('\n')}`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (changes.length > 0) await this.logConfigChange(interaction, changes);
        await this.refreshPointsPanel(interaction, changeMessage, interaction.guild.name);
    },

    async processLimitesModal(interaction) {
        const exemplarLimit = parseInt(interaction.fields.getTextInputValue('exemplar_limit'));
        const problematicLimit = parseInt(interaction.fields.getTextInputValue('problematic_limit'));
        
        if (isNaN(exemplarLimit) || exemplarLimit < 50 || exemplarLimit > 100) {
            return await ResponseManager.error(interaction, 'Limite Exemplar deve ser entre 50 e 100.');
        }
        if (isNaN(problematicLimit) || problematicLimit < 0 || problematicLimit > 50) {
            return await ResponseManager.error(interaction, 'Limite Problemático deve ser entre 0 e 50.');
        }
        if (problematicLimit >= exemplarLimit) {
            return await ResponseManager.error(interaction, 'O limite Problemático deve ser menor que o limite Exemplar.');
        }
        
        const oldExemplar = this.getSetting(interaction.guildId, 'limit_exemplar');
        const oldProblematic = this.getSetting(interaction.guildId, 'limit_problematico');
        
        this.setSetting(interaction.guildId, 'limit_exemplar', exemplarLimit.toString());
        this.setSetting(interaction.guildId, 'limit_problematico', problematicLimit.toString());
        this.clearCache(interaction.guildId);
        
        const changes = [];
        if (oldExemplar != exemplarLimit) changes.push(`${EMOJIS.sparkles || '🎖️'} Exemplar: \`${oldExemplar || 95}\` → \`${exemplarLimit}\``);
        if (oldProblematic != problematicLimit) changes.push(`${EMOJIS.trianglealert || '⚠️'} Problemático: \`${oldProblematic || 30}\` → \`${problematicLimit}\``);
        
        const changeMessage = changes.length > 0
            ? `${EMOJIS.circlecheck || '✅'} **Limites atualizados!**\n${changes.join('\n')}`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (changes.length > 0) await this.logConfigChange(interaction, changes);
        await this.refreshPointsPanel(interaction, changeMessage, interaction.guild.name);
    },

    async resetPoints(interaction) {
        const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
        for (let i = 1; i <= 5; i++) {
            this.setSetting(interaction.guildId, `strike_points_${i}`, DEFAULT_POINTS[i].toString());
        }
        this.setSetting(interaction.guildId, 'limit_exemplar', '95');
        this.setSetting(interaction.guildId, 'limit_problematico', '30');
        this.setSetting(interaction.guildId, 'rep_recovery_amount', '1');
        this.clearCache(interaction.guildId);
        await this.logConfigChange(interaction, `${EMOJIS.refreshccw || '⚠️'} Pontos de Strike e limites de reputação resetados para o padrão.`);
        await this.refreshPointsPanel(interaction, `${EMOJIS.circlecheck || '✅'} Todos os valores foram resetados para o padrão!`, interaction.guild.name);
    },

    // ==================== PAINÉIS ====================

    /**
     * Envia uma mensagem de sucesso/feedback como followUp EFÊMERO,
     * separada do painel principal.
     *
     * ✅ CORRIGE O BUG: interaction.update() não aceita `content` junto de
     * MessageFlags.IsComponentsV2 ("MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2").
     * Antes, os métodos refresh*Panel tentavam colocar `content: successMessage`
     * no MESMO payload do update()/editReply() que já usa Components V2 —
     * isso fazia a requisição inteira falhar com erro 400, e por isso o
     * painel "não atualizava" (na verdade a edição nunca era aplicada).
     *
     * Agora a mensagem de sucesso vai SEMPRE por aqui, separada, e o painel
     * principal nunca leva `content`.
     */
    async sendFeedback(interaction, message) {
        if (!message) return;
        try {
            await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('❌ Erro ao enviar feedback efêmero:', error);
        }
    },

    async refreshPointsPanel(interaction, successMessage, guildName) {
        const guildId = interaction.guildId;
        const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
        
        const points = {
            1: parseInt(this.getSetting(guildId, 'strike_points_1')) || DEFAULT_POINTS[1],
            2: parseInt(this.getSetting(guildId, 'strike_points_2')) || DEFAULT_POINTS[2],
            3: parseInt(this.getSetting(guildId, 'strike_points_3')) || DEFAULT_POINTS[3],
            4: parseInt(this.getSetting(guildId, 'strike_points_4')) || DEFAULT_POINTS[4],
            5: parseInt(this.getSetting(guildId, 'strike_points_5')) || DEFAULT_POINTS[5]
        };
        
        const exemplarLimit    = parseInt(this.getSetting(guildId, 'limit_exemplar'))    || 95;
        const problematicLimit = parseInt(this.getSetting(guildId, 'limit_problematico')) || 30;
        const recoveryAmount   = parseInt(this.getSetting(guildId, 'rep_recovery_amount')) || 1;
        const severityIcons = ['', EMOJIS.severidadebaixa || '🟢', EMOJIS.severidademedia || '🟡', EMOJIS.severidadelaranja || '🟠', EMOJIS.severidadealta || '🔴', EMOJIS.Dead || '💀'];
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];

        const PremiumSystem = require('../premium/premiumSystem');
        const automodEnabled = PremiumSystem.getGuildLimits(guildId).automodEnabled;

        const cb = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });

        const { components, flags, files } = cb
            .section(
                [
                    '# CONFIGURAÇÃO DE PONTOS E LIMITES',
                    'Gerencie os valores do sistema de reputação.',
                ].join('\n'),
                cb.assetThumbnail('icone_config_punishments') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
            )
            .separator()
            .title(`${EMOJIS.gavel || '🎯'} Níveis de Strike`, 2)
            .block([
                `${severityIcons[1]} **Nível 1 (${severityNames[1]}):** \`${points[1]} pontos\``,
                `${severityIcons[2]} **Nível 2 (${severityNames[2]}):** \`${points[2]} pontos\``,
                `${severityIcons[3]} **Nível 3 (${severityNames[3]}):** \`${points[3]} pontos\``,
                `${severityIcons[4]} **Nível 4 (${severityNames[4]}):** \`${points[4]} pontos\``,
                `${severityIcons[5]} **Nível 5 (${severityNames[5]}):** \`${points[5]} pontos\``,
            ])
            .separator()
            .title(`${EMOJIS.medal || '📊'} Limites de Reputação`, 2)
            .block([
                `${EMOJIS.sparkles || '🎖️'} **Exemplar:** Acima de \`${exemplarLimit}\` pontos`,
                `${EMOJIS.trianglealert  || '⚠️'} **Problemático:** Abaixo de \`${problematicLimit}\` pontos`,
            ])
            .separator()
            .title(`${EMOJIS.trendingup || '📈'} Recuperação Diária de Reputação`, 2)
            .block([
                `${EMOJIS.trendingup || '📈'} **Pontos por dia:** \`${recoveryAmount}\``,
                automodEnabled
                    ? `${EMOJIS.circlecheck || '✅'} Automod diário ativo (recurso do plano Fossil).`
                    : `${EMOJIS.circlealert || '❌'} Automod diário inativo — exclusivo do plano Fossil (ver /premium-status).`,
            ])
            .footer(guildName)
            .build();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('config-punishments:strike:modal').setLabel('Editar Níveis de Strike').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.edit || '✏️'),
            new ButtonBuilder().setCustomId('config-punishments:limites:modal').setLabel('Editar Limites').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.edit || '✏️'),
            new ButtonBuilder().setCustomId('config-punishments:recovery:modal').setLabel('Editar Recuperação Diária').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.edit || '✏️'),
            new ButtonBuilder().setCustomId('config-punishments:reset').setLabel('Resetar Padrão').setStyle(ButtonStyle.Danger).setEmoji(EMOJIS.refreshccw || '⚠️')
        );
        
        // ✅ Painel SEMPRE limpo, sem `content` — mensagem de sucesso vai
        // separada via sendFeedback() (followUp efêmero).
        const replyData = { components: [...components, row], flags, files };

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(replyData);
        } else {
            await interaction.update(replyData);
        }

        await this.sendFeedback(interaction, successMessage);
    },

    /**
     * Descobre em qual aba do /config-roles vive uma determinada chave de
     * cargo (usado para reabrir a mesma aba depois de salvar uma seleção).
     */
    _tabForRoleKey(roleKey) {
        for (const [tabKey, tab] of Object.entries(ROLE_TABS)) {
            if (tab.fields.some(f => f.key === roleKey)) return tabKey;
        }
        return 'moderation';
    },

    async refreshRolesPanel(interaction, successMessage, tab = 'moderation') {
        const guildId = interaction.guildId;
        const tabKey = ROLE_TABS[tab] ? tab : 'moderation';
        const tabData = ROLE_TABS[tabKey];

        const fmt = (roleId) => roleId
            ? `<@&${roleId}>`
            : `${EMOJIS.circlealert || '❌'} Não definido`;

        const rolesBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        rolesBuilder.section(
            [tabData.headerTitle, tabData.headerDesc].join('\n'),
            rolesBuilder.assetThumbnail('icone_discord_roles') || AdvancedContainerBuilder.thumbnail(interaction.guild.iconURL({ size: 128 }))
        );
        rolesBuilder.text(
            `${EMOJIS.messagesquare || 'ℹ️'} **Importante:** os cargos abaixo precisam estar configurados para os comandos correspondentes funcionarem. ` +
            `Eles servem **apenas** para o bot saber quem pode usar cada comando — não precisam ser (nem representar) um cargo "oficial" do servidor. ` +
            `Você pode escolher **qualquer** cargo já existente, ou criar um novo específico só para isso: é 100% customizável.`
        );
        rolesBuilder.separator();

        const selectRows = [];
        for (const field of tabData.fields) {
            const currentId = this.getSetting(guildId, field.key);
            rolesBuilder.text(`**${EMOJIS[field.icon] || ''} ${field.label}** — ${field.desc}`);
            rolesBuilder.text(`${EMOJIS.gauge || '📊'} **Atual:** ${fmt(currentId)}`);
            rolesBuilder.separator();

            selectRows.push(
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId(field.customId).setPlaceholder(`Selecionar cargo: ${field.label}`)
                )
            );
        }

        rolesBuilder.footer(interaction.guild.name);
        const { components, flags, files } = rolesBuilder.build();

        const tabRow = new ActionRowBuilder().addComponents(
            Object.entries(ROLE_TABS).map(([key, data]) =>
                new ButtonBuilder()
                    .setCustomId(`config-roles:tab:${key}`)
                    .setLabel(data.label)
                    .setEmoji(EMOJIS[data.icon] || undefined)
                    .setStyle(key === tabKey ? ButtonStyle.Primary : ButtonStyle.Secondary)
            )
        );

        // ✅ Painel SEMPRE limpo, sem `content`.
        const replyData = { components: [...components, tabRow, ...selectRows], flags, files };

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(replyData);
            } else {
                await interaction.update(replyData);
            }
            await this.sendFeedback(interaction, successMessage);
        } catch (error) {
            console.error('❌ Erro no refreshRolesPanel:', error);
        }
    },

    async setRole(interaction, roleKey) {
        const selectedRoleId = interaction.values[0];
        if (!selectedRoleId) {
            return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Nenhum cargo selecionado.`);
        }

        const role = interaction.guild.roles.cache.get(selectedRoleId);
        if (!role) {
            return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Cargo não encontrado.`);
        }

        const oldRoleId = this.getSetting(interaction.guildId, roleKey);
        this.setSetting(interaction.guildId, roleKey, selectedRoleId);
        this.clearCache(interaction.guildId);

        const oldRoleMention = oldRoleId ? `<@&${oldRoleId}>` : '`não definido`';
        await this.logConfigChange(interaction, `${EMOJIS.shield || '🎭'} Cargo **${ROLE_LABELS[roleKey]}**: ${oldRoleMention} → ${role}`);
        await this.refreshRolesPanel(
            interaction,
            `${EMOJIS.circlecheck || '✅'} **${ROLE_LABELS[roleKey]}** alterado para ${role}`,
            this._tabForRoleKey(roleKey),
        );
    },

    /**
     * Painel de canais de log.
     *
     * ✅ UNIFICADO: removida a linha/seleção de "AutoMod" — o relatório
     * diário do AutoMod agora é enviado no mesmo canal configurado como
     * "Geral" (chave 'log_channel'). Ver autoModeration.js → sendLogReports.
     */
    async refreshLogsPanel(interaction, successMessage, guildName) {
        const guildId = interaction.guildId;
        const logGeral       = this.getUnifiedGeneralLogChannel(guildId);
        const logPunishments = this.getSetting(guildId, 'log_punishments');
        const logReports     = this.getSetting(guildId, 'log_reports');

        const fmt = (channelId) => channelId
            ? `<#${channelId}>`
            : `${EMOJIS.circlealert || '❌'} Não definido`;
        
        const logsBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        const { components, flags, files } = logsBuilder
            .section(
                [
                    '# CANAIS DE LOG',
                    'Configure os canais que recebem os registros de atividade do servidor.',
                ].join('\n'),
                logsBuilder.assetThumbnail('icone_logs') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
            )
            .separator()
            .block([
                '**Geral** — recebe logs de alterações de configuração, atualizações de sistema, eventos diversos e o relatório diário de AutoModeração (recuperação de pontos, cargos atribuídos/removidos, ranking de staff).',
                '**Punições** — recebe logs relacionados a strikes, unstrikes, ajustes de reputação e ações disciplinares.',
                '**ReportChat** — recebe logs de reports feitos pelos usuários. É onde fica o painel de atendimento dos staffs.',
            ])
            .separator()
            .block([
                `${EMOJIS.megaphone  || '📜'} **Geral / AutoMod:** ${fmt(logGeral)}`,
                `${EMOJIS.gavel  || '⚖️'} **Punições:** ${fmt(logPunishments)}`,
                `${EMOJIS.ticket    || '🚩'} **ReportChat:** ${fmt(logReports)}`,
            ])
            .footer(guildName)
            .build();
        
        const geralRow       = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('config-logs:geral').setPlaceholder('Selecionar canal de logs gerais / automod').addChannelTypes(ChannelType.GuildText));
        const punishmentsRow = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('config-logs:punishments').setPlaceholder('Selecionar canal de logs de punições').addChannelTypes(ChannelType.GuildText));
        const reportsRow     = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('config-logs:reports').setPlaceholder('Selecionar canal de logs de reports').addChannelTypes(ChannelType.GuildText));
        const buttonRow      = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config-logs:criar').setLabel('Criar Canais Automaticamente').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.plus || '➕'));
        
        // ✅ Painel SEMPRE limpo, sem `content`.
        const replyData = { components: [...components, geralRow, punishmentsRow, reportsRow, buttonRow], flags, files };

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(replyData);
            } else {
                await interaction.update(replyData);
            }
            await this.sendFeedback(interaction, successMessage);
        } catch (error) {
            console.error('❌ Erro no refreshLogsPanel:', error);
        }
    },

    async setLogChannel(interaction, channelKey) {
        const selectedChannelId = interaction.values[0];
        if (!selectedChannelId) {
            return await ResponseManager.error(interaction, 'Nenhum canal selecionado.');
        }
        
        const channel = interaction.guild.channels.cache.get(selectedChannelId);
        if (!channel) {
            return await ResponseManager.error(interaction, 'Canal não encontrado.');
        }

        const oldChannelId = this.getSetting(interaction.guildId, channelKey);
        this.setSetting(interaction.guildId, channelKey, selectedChannelId);
        this.clearCache(interaction.guildId);

        const channelLabels = {
            log_channel:      `${EMOJIS.megaphone  || '📜'} Canal de logs gerais / automod`,
            log_punishments:  `${EMOJIS.gavel  || '⚖️'} Canal de logs de punições`,
            log_reports:      `${EMOJIS.ticket    || '🚩'} Canal de logs de reports`,
        };

        const oldChannelMention = oldChannelId ? `<#${oldChannelId}>` : '`não definido`';
        await this.logConfigChange(interaction, `${channelLabels[channelKey]}: ${oldChannelMention} → ${channel}`);
        await this.refreshLogsPanel(interaction, `${EMOJIS.circlecheck || '✅'} **${channelLabels[channelKey]}** alterado para ${channel}`, interaction.guild.name);
    },

    /**
     * Cria os canais de log automaticamente.
     *
     * ✅ UNIFICADO: não cria mais um canal separado "logs-automod".
     * O canal "logs-gerais" agora recebe tanto logs gerais quanto o
     * relatório diário do AutoMod.
     */
    async createLogChannels(interaction) {
        try {
            if (!interaction.isRepliable()) {
                console.error('❌ Interação não pode ser respondida');
                return;
            }
            
            const guild = interaction.guild;
            const { PermissionFlagsBits } = require('discord.js');
            
            if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                const msg = `${EMOJIS.circlealert || '❌'} Não tenho permissão para criar canais.`;
                if (interaction.deferred || interaction.replied) {
                    // A mensagem original (painel config-logs) é Components V2 —
                    // depois de deferUpdate(), `content` sozinho é rejeitado
                    // pelo Discord (erro 50035). Precisa ir como container.
                    const errBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR }).text(msg).footer(guild.name);
                    await interaction.editReply(errBuilder.build());
                } else {
                    await interaction.reply({ content: msg, flags: 64 });
                }
                return;
            }
            
            if (!interaction.deferred && !interaction.replied) {
                const loadingPayload = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT })
                    .text(`${EMOJIS.clock || '⏳'} Criando canais de log...`)
                    .footer(guild.name)
                    .build();

                await interaction.reply({ ...loadingPayload, flags: loadingPayload.flags | MessageFlags.Ephemeral });
            }
            
            const category = await guild.channels.create({
                name: '░░🪵 LOGS DO SISTEMA ░░░░░░░░',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
                ]
            });
            
            const geral       = await guild.channels.create({ name: '📜 logs-gerais',   type: ChannelType.GuildText, parent: category.id });
            const punishments = await guild.channels.create({ name: '⚖️ logs-punicoes', type: ChannelType.GuildText, parent: category.id });
            const reports     = await guild.channels.create({ name: '🚩 logs-reports',  type: ChannelType.GuildText, parent: category.id });
            
            this.setSetting(guild.id, 'log_channel',      geral.id);
            this.setSetting(guild.id, 'log_punishments',  punishments.id);
            this.setSetting(guild.id, 'log_reports',      reports.id);
            this.clearCache(guild.id);

            await this.logConfigChange(interaction, [
                `${EMOJIS.megaphone || '📜'} Geral / AutoMod: → ${geral}`,
                `${EMOJIS.gavel || '⚖️'} Punições: → ${punishments}`,
                `${EMOJIS.ticket || '🎫'} Reports: → ${reports}`,
            ]);

            const replyData = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS })
                .title(`${EMOJIS.circlecheck || '✅'} Canais de Log Criados`)
                .text('Os seguintes canais foram criados:')
                .separator()
                .block([
                    `${EMOJIS.megaphone  || '📜'} **Geral / AutoMod:** <#${geral.id}>`,
                    `${EMOJIS.gavel  || '⚖️'} **Punições:** <#${punishments.id}>`,
                    `${EMOJIS.ticket    || '🎫'} **Reports:** <#${reports.id}>`,
                ])
                .footer(guild.name)
                .build();
            
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(replyData);
            } else {
                await interaction.reply({ ...replyData, flags: 64 });
            }
            
        } catch (error) {
            console.error('❌ Erro ao criar canais:', error);
            const msg = `${EMOJIS.circlealert || '❌'} Erro ao criar canais: ${error.message}`;
            try {
                const errorPayload = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                    .text(msg)
                    .footer(interaction.guild?.name)
                    .build();

                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply(errorPayload);
                } else {
                    await interaction.reply({ ...errorPayload, flags: errorPayload.flags | MessageFlags.Ephemeral });
                }
            } catch (err) {
                console.error('❌ Erro ao responder:', err);
            }
        }
    },

    /**
     * @param {string} guildId
     * @param {'geral'|'punishments'|'automod'|'reports'} type
     * ✅ UNIFICADO: 'automod' agora resolve para o mesmo canal de 'geral'.
     */
    getLogChannel(guildId, type) {
        if (type === 'geral' || type === 'automod') {
            return this.getUnifiedGeneralLogChannel(guildId);
        }
        const channelMap = { punishments: 'log_punishments', reports: 'log_reports' };
        const key = channelMap[type];
        if (!key) return null;
        return this.getSetting(guildId, key) || null;
    },

    clearAllCache() {
        try {
            cache.clear();
            console.log('🗑️ Cache completo limpo');
        } catch (error) {
            console.error('❌ Erro ao limpar cache completo:', error);
        }
    }
};

module.exports = ConfigSystem;