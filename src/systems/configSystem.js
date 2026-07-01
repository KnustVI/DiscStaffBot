// /home/ubuntu/DiscStaffBot/src/systems/configSystem.js
const db = require('../database/index');
const sessionManager = require('../utils/sessionManager');
const ResponseManager = require('../utils/responseManager');
const { AdvancedContainerBuilder } = require('../utils/containerBuilder');
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
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

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
            
            if (customId.startsWith('config-points:strike')) {
                await this.handleStrikeModal(interaction);
                return;
            }
            if (customId.startsWith('config-points:limites')) {
                await this.handleLimitesModal(interaction);
                return;
            }
            if (customId === 'config-points:reset') {
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
            if (interaction.customId === 'config-points:strike:modal:submit') {
                await this.processPointsStrikeModal(interaction);
                return;
            }
            if (interaction.customId === 'config-points:limites:modal:submit') {
                await this.processLimitesModal(interaction);
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
        
        const modal = new ModalBuilder({ customId: 'config-points:strike:modal:submit', title: 'Configurar Niveis', components: rows });
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
        
        const modal = new ModalBuilder({ customId: 'config-points:limites:modal:submit', title: 'Configurar Limites', components: rows });
        await interaction.showModal(modal);
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
        const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
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
            ? `${EMOJIS.Check || '✅'} **${changes.length} alterações salvas!**\n${changes.join('\n')}`
            : `${EMOJIS.Note || 'ℹ️'} Nenhuma alteração foi detectada.`;
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
        if (oldExemplar != exemplarLimit) changes.push(`🎖️ Exemplar: \`${oldExemplar || 95}\` → \`${exemplarLimit}\``);
        if (oldProblematic != problematicLimit) changes.push(`⚠️ Problemático: \`${oldProblematic || 30}\` → \`${problematicLimit}\``);
        
        const changeMessage = changes.length > 0
            ? `${EMOJIS.Check || '✅'} **Limites atualizados!**\n${changes.join('\n')}`
            : `${EMOJIS.Note || 'ℹ️'} Nenhuma alteração foi detectada.`;
        await this.refreshPointsPanel(interaction, changeMessage, interaction.guild.name);
    },

    async resetPoints(interaction) {
        const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
        for (let i = 1; i <= 5; i++) {
            this.setSetting(interaction.guildId, `strike_points_${i}`, DEFAULT_POINTS[i].toString());
        }
        this.setSetting(interaction.guildId, 'limit_exemplar', '95');
        this.setSetting(interaction.guildId, 'limit_problematico', '30');
        this.clearCache(interaction.guildId);
        await this.refreshPointsPanel(interaction, `${EMOJIS.Check || '✅'} Todos os valores foram resetados para o padrão!`, interaction.guild.name);
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
        const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        const imageManager = require('../utils/imageManager');
        const bannerUrl = imageManager.getUrl('config_pontos') || imageManager.getUrl('config_punições');
        const bannerAttachment = imageManager.getAttachment('config_pontos') || imageManager.getAttachment('config_punições');

        const cb = new AdvancedContainerBuilder({ accentColor: 0xDCA15E });
        if (bannerUrl) {
            cb.gallery([bannerUrl]);
            cb.separator();
        }

        const { components, flags } = cb
            .title(`${EMOJIS.Config || '⚙️'} Configuração de Pontos e Limites`)
            .text('Gerencie os valores do sistema de reputação.')
            .separator()
            .title(`${EMOJIS.strike || '🎯'} Níveis de Strike`, 2)
            .block([
                `${severityIcons[1]} **Nível 1 (${severityNames[1]}):** \`${points[1]} pontos\``,
                `${severityIcons[2]} **Nível 2 (${severityNames[2]}):** \`${points[2]} pontos\``,
                `${severityIcons[3]} **Nível 3 (${severityNames[3]}):** \`${points[3]} pontos\``,
                `${severityIcons[4]} **Nível 4 (${severityNames[4]}):** \`${points[4]} pontos\``,
                `${severityIcons[5]} **Nível 5 (${severityNames[5]}):** \`${points[5]} pontos\``,
            ])
            .separator()
            .title(`${EMOJIS.Rank || '📊'} Limites de Reputação`, 2)
            .block([
                `${EMOJIS.shinystar || '🎖️'} **Exemplar:** Acima de \`${exemplarLimit}\` pontos`,
                `${EMOJIS.Warning  || '⚠️'} **Problemático:** Abaixo de \`${problematicLimit}\` pontos`,
            ])
            .footer(guildName)
            .build();
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('config-points:strike:modal').setLabel('Editar Níveis de Strike').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.edit || '✏️'),
            new ButtonBuilder().setCustomId('config-points:limites:modal').setLabel('Editar Limites').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.edit || '✏️'),
            new ButtonBuilder().setCustomId('config-points:reset').setLabel('Resetar Padrão').setStyle(ButtonStyle.Danger).setEmoji(EMOJIS.Reset || '⚠️')
        );
        
        // ✅ Painel SEMPRE limpo, sem `content` — mensagem de sucesso vai
        // separada via sendFeedback() (followUp efêmero).
        const replyData = { components: [...components, row], flags };
        if (bannerAttachment) replyData.files = [bannerAttachment];
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(replyData);
        } else {
            await interaction.update(replyData);
        }

        await this.sendFeedback(interaction, successMessage);
    },

    async refreshRolesPanel(interaction, successMessage) {
        const guildId = interaction.guildId;
        const staffRole       = this.getSetting(guildId, 'staff_role');
        const strikeRole      = this.getSetting(guildId, 'strike_role');
        const exemplarRole    = this.getSetting(guildId, 'role_exemplar');
        const problematicoRole = this.getSetting(guildId, 'role_problematico');

        const fmt = (roleId) => roleId
            ? `<@&${roleId}>`
            : `${EMOJIS.Error || '❌'} Não definido`;
        
        const { components, flags } = new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
            .title(`${EMOJIS.staff || '👥'} Cargos do Sistema`)
            .text('É obrigatório que selecione um cargo para sua staff, sem o cargo configurado eles não conseguem usar os comandos de moderação. Os outros cargos são opcionais.')
            .separator()
            .text('Selecione os cargos abaixo:')
            .separator()
            .block([
                `${EMOJIS.staff  || '🛡️'} **Staff:** ${fmt(staffRole)}`,
                `${EMOJIS.strike || '⚠️'} **Strike (Temporário):** ${fmt(strikeRole)}`,
                `${EMOJIS.shinystar || '✨'} **Exemplar:** ${fmt(exemplarRole)}`,
                `${EMOJIS.Warning  || '⚠️'} **Problemático:** ${fmt(problematicoRole)}`,
            ])
            .footer(interaction.guild.name)
            .build();
        
        const staffRow       = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('config-roles:staff').setPlaceholder('Selecionar cargo de Staff'));
        const strikeRow      = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('config-roles:strike').setPlaceholder('Selecionar cargo de Strike'));
        const exemplarRow    = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('config-roles:exemplar').setPlaceholder('Selecionar cargo Exemplar'));
        const problematicoRow = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('config-roles:problematico').setPlaceholder('Selecionar cargo Problemático'));
        
        // ✅ Painel SEMPRE limpo, sem `content`.
        const replyData = { components: [...components, staffRow, strikeRow, exemplarRow, problematicoRow], flags };
        
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
            return await ResponseManager.error(interaction, `${EMOJIS.Error || '❌'} Nenhum cargo selecionado.`);
        }
        
        const role = interaction.guild.roles.cache.get(selectedRoleId);
        if (!role) {
            return await ResponseManager.error(interaction, `${EMOJIS.Error || '❌'} Cargo não encontrado.`);
        }
        
        this.setSetting(interaction.guildId, roleKey, selectedRoleId);
        this.clearCache(interaction.guildId);
        
        const roleLabels = { staff_role: 'Staff', strike_role: 'Strike', role_exemplar: 'Exemplar', role_problematico: 'Problemático' };
        await this.refreshRolesPanel(interaction, `${EMOJIS.Check || '✅'} **${roleLabels[roleKey]}** alterado para ${role}`);
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
            : `${EMOJIS.Error || '❌'} Não definido`;
        
        const { components, flags } = new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
            .title(`${EMOJIS.dashboard || '🪵'} Canais de Log`)
            .block([
                '**Geral** — recebe logs de alterações de configuração, atualizações de sistema, eventos diversos e o relatório diário de AutoModeração (recuperação de pontos, cargos atribuídos/removidos, ranking de staff).',
                '**Punições** — recebe logs relacionados a strikes, unstrikes, ajustes de reputação e ações disciplinares.',
                '**ReportChat** — recebe logs de reports feitos pelos usuários. É onde fica o painel de atendimento dos staffs.',
            ])
            .separator()
            .block([
                `${EMOJIS.global  || '📜'} **Geral / AutoMod:** ${fmt(logGeral)}`,
                `${EMOJIS.strike  || '⚖️'} **Punições:** ${fmt(logPunishments)}`,
                `${EMOJIS.chat    || '🚩'} **ReportChat:** ${fmt(logReports)}`,
            ])
            .footer(guildName)
            .build();
        
        const geralRow       = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('config-logs:geral').setPlaceholder('Selecionar canal de logs gerais / automod').addChannelTypes(ChannelType.GuildText));
        const punishmentsRow = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('config-logs:punishments').setPlaceholder('Selecionar canal de logs de punições').addChannelTypes(ChannelType.GuildText));
        const reportsRow     = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('config-logs:reports').setPlaceholder('Selecionar canal de logs de reports').addChannelTypes(ChannelType.GuildText));
        const buttonRow      = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config-logs:criar').setLabel('Criar Canais Automaticamente').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.plusone || '➕'));
        
        // ✅ Painel SEMPRE limpo, sem `content`.
        const replyData = { components: [...components, geralRow, punishmentsRow, reportsRow, buttonRow], flags };
        
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
        
        this.setSetting(interaction.guildId, channelKey, selectedChannelId);
        this.clearCache(interaction.guildId);
        
        const channelLabels = {
            log_channel:      `${EMOJIS.global  || '📜'} Canal de logs gerais / automod`,
            log_punishments:  `${EMOJIS.strike  || '⚖️'} Canal de logs de punições`,
            log_reports:      `${EMOJIS.chat    || '🚩'} Canal de logs de reports`,
        };
        
        await this.refreshLogsPanel(interaction, `${EMOJIS.Check || '✅'} **${channelLabels[channelKey]}** alterado para ${channel}`, interaction.guild.name);
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
                const msg = `${EMOJIS.Error || '❌'} Não tenho permissão para criar canais.`;
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: msg, components: [] });
                } else {
                    await interaction.reply({ content: msg, flags: 64 });
                }
                return;
            }
            
            if (!interaction.deferred && !interaction.replied) {
                const loadingPayload = new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
                    .text(`${EMOJIS.clock || '⏳'} Criando canais de log...`)
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
            
            const replyData = new AdvancedContainerBuilder({ accentColor: 0x57F287 })
                .title(`${EMOJIS.Check || '✅'} Canais de Log Criados`)
                .text('Os seguintes canais foram criados:')
                .separator()
                .block([
                    `${EMOJIS.global  || '📜'} **Geral / AutoMod:** <#${geral.id}>`,
                    `${EMOJIS.strike  || '⚖️'} **Punições:** <#${punishments.id}>`,
                    `${EMOJIS.chat    || '🎫'} **Reports:** <#${reports.id}>`,
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
            const msg = `${EMOJIS.Error || '❌'} Erro ao criar canais: ${error.message}`;
            try {
                const errorPayload = new AdvancedContainerBuilder({ accentColor: 0xED4245 })
                    .text(msg)
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