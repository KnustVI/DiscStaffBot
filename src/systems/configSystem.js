const db = require('../database/index');
const sessionManager = require('../utils/sessionManager');
const ResponseManager = require('../utils/responseManager');
const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    PermissionFlagsBits,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder      
} = require('discord.js');

/**
 * Cache em memória
 * Chave: {guildId}_{key}
 */
const cache = new Map();

// Carregar emojis do servidor
let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const ConfigSystem = {
    // ==================== MÉTODOS BASE ====================

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
     * Busca múltiplas configurações de uma vez
     */
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

    getFooter(guildName) {
        return {
            text: `[By:KnustVI](https://github.com/KnustVI) • ${guildName}`,
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png'
        };
    },

    // ==================== HANDLER PRINCIPAL ====================

    async handleComponent(interaction, action, param) {
        try {
            const customId = interaction.customId;
            
            // CONFIG-POINTS
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
            
            // CONFIG-ROLES
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
            
            // CONFIG-LOGS
            if (customId === 'config-logs:geral') {
                await this.setLogChannel(interaction, 'log_channel');
                return;
            }
            if (customId === 'config-logs:punishments') {
                await this.setLogChannel(interaction, 'log_punishments');
                return;
            }
            if (customId === 'config-logs:automod') {
                await this.setLogChannel(interaction, 'log_automod');
                return;
            }
            if (customId === 'config-logs:tickets') {
                await this.setLogChannel(interaction, 'log_tickets');
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
            if (interaction.customId === 'config-points:strike:modal') {
                await this.processPointsStrikeModal(interaction);
                return;
            }
            if (interaction.customId === 'config-points:limites:modal') {
                await this.processLimitesModal(interaction);
                return;
            }
            await ResponseManager.error(interaction, 'Modal não reconhecido.');
        } catch (error) {
            console.error('❌ Erro no handleModal:', error);
            await ResponseManager.error(interaction, 'Ocorreu um erro ao processar o modal.');
        }
    },

    // ==================== CONFIG-POINTS ====================

    async handleStrikeModal(interaction) {
        const guildId = interaction.guildId;
        const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
        
        const pontos = {
            1: parseInt(this.getSetting(guildId, 'strike_points_1')) || DEFAULT_POINTS[1],
            2: parseInt(this.getSetting(guildId, 'strike_points_2')) || DEFAULT_POINTS[2],
            3: parseInt(this.getSetting(guildId, 'strike_points_3')) || DEFAULT_POINTS[3],
            4: parseInt(this.getSetting(guildId, 'strike_points_4')) || DEFAULT_POINTS[4],
            5: parseInt(this.getSetting(guildId, 'strike_points_5')) || DEFAULT_POINTS[5]
        };
        
        const modal = new ModalBuilder()
            .setCustomId('config-points:strike:modal')
            .setTitle(`${EMOJIS.Config || '⚙️'} Configurar Níveis de Strike`);
        
        const fields = [
            { id: 'nivel1', label: `🟢 Nível 1 (Leve)`, value: pontos[1] },
            { id: 'nivel2', label: `🟡 Nível 2 (Moderada)`, value: pontos[2] },
            { id: 'nivel3', label: `🟠 Nível 3 (Grave)`, value: pontos[3] },
            { id: 'nivel4', label: `🔴 Nível 4 (Severa)`, value: pontos[4] },
            { id: 'nivel5', label: `💀 Nível 5 (Permanente)`, value: pontos[5] }
        ];
        
        for (const field of fields) {
            const input = new TextInputBuilder()
                .setCustomId(field.id)
                .setLabel(field.label)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(field.value.toString())
                .setPlaceholder('Ex: 10');
            modal.addComponents(new ActionRowBuilder().addComponents(input));
        }
        
        await interaction.showModal(modal);
    },

    async handleLimitesModal(interaction) {
        const guildId = interaction.guildId;
        const exemplarLimit = parseInt(this.getSetting(guildId, 'limit_exemplar')) || 95;
        const problematicLimit = parseInt(this.getSetting(guildId, 'limit_problematico')) || 30;
        
        const modal = new ModalBuilder()
            .setCustomId('config-points:limites:modal')
            .setTitle(`${EMOJIS.Rank || '📊'} Configurar Limites de Reputação`);
        
        const exemplarInput = new TextInputBuilder()
            .setCustomId('exemplar_limit')
            .setLabel(`${EMOJIS.shinystar || '🎖️'} Limite Exemplar (50-100)`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(exemplarLimit.toString())
            .setPlaceholder('Ex: 95');
        
        const problematicInput = new TextInputBuilder()
            .setCustomId('problematic_limit')
            .setLabel(`${EMOJIS.Warning || '⚠️'} Limite Problemático (0-50)`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(problematicLimit.toString())
            .setPlaceholder('Ex: 30');
        
        modal.addComponents(
            new ActionRowBuilder().addComponents(exemplarInput),
            new ActionRowBuilder().addComponents(problematicInput)
        );
        
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
            ? `✅ **${changes.length} alterações salvas!**\n${changes.join('\n')}`
            : 'ℹ️ Nenhuma alteração foi detectada.';
        
        await this.refreshPointsPanel(interaction, changeMessage);
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
            ? `✅ **Limites atualizados!**\n${changes.join('\n')}`
            : 'ℹ️ Nenhuma alteração foi detectada.';
        
        await this.refreshPointsPanel(interaction, changeMessage);
    },

    async resetPoints(interaction) {
        const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
        for (let i = 1; i <= 5; i++) {
            this.setSetting(interaction.guildId, `strike_points_${i}`, DEFAULT_POINTS[i].toString());
        }
        this.setSetting(interaction.guildId, 'limit_exemplar', '95');
        this.setSetting(interaction.guildId, 'limit_problematico', '30');
        this.clearCache(interaction.guildId);
        await this.refreshPointsPanel(interaction, '✅ Todos os valores foram resetados para o padrão!');
    },

    async refreshPointsPanel(interaction, successMessage) {
        const guildId = interaction.guildId;
        const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
        
        const points = {
            1: parseInt(this.getSetting(guildId, 'strike_points_1')) || DEFAULT_POINTS[1],
            2: parseInt(this.getSetting(guildId, 'strike_points_2')) || DEFAULT_POINTS[2],
            3: parseInt(this.getSetting(guildId, 'strike_points_3')) || DEFAULT_POINTS[3],
            4: parseInt(this.getSetting(guildId, 'strike_points_4')) || DEFAULT_POINTS[4],
            5: parseInt(this.getSetting(guildId, 'strike_points_5')) || DEFAULT_POINTS[5]
        };
        
        const exemplarLimit = parseInt(this.getSetting(guildId, 'limit_exemplar')) || 95;
        const problematicLimit = parseInt(this.getSetting(guildId, 'limit_problematico')) || 30;
        
        const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        
        const description = [
            `# ${EMOJIS.Config || '⚙️'} Configuração de Pontos e Limites`,
            `Gerencie os valores do sistema de reputação.`,
            ``,
            `## ${EMOJIS.strike || '🎯'} Níveis de Strike`,
            `${severityIcons[1]} **Nível 1 (${severityNames[1]}):** \`${points[1]} pontos\``,
            `${severityIcons[2]} **Nível 2 (${severityNames[2]}):** \`${points[2]} pontos\``,
            `${severityIcons[3]} **Nível 3 (${severityNames[3]}):** \`${points[3]} pontos\``,
            `${severityIcons[4]} **Nível 4 (${severityNames[4]}):** \`${points[4]} pontos\``,
            `${severityIcons[5]} **Nível 5 (${severityNames[5]}):** \`${points[5]} pontos\``,
            ``,
            `## ${EMOJIS.Rank || '📊'} Limites de Reputação`,
            `**${EMOJIS.shinystar || '🎖️'} Exemplar:** Acima de \`${exemplarLimit}\` pontos`,
            `**${EMOJIS.Warning || '⚠️'} Problemático:** Abaixo de \`${problematicLimit}\` pontos`
        ].join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(description)
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config-points:strike:modal')
                .setLabel(`${EMOJIS.strike || '🎯'} Editar Níveis de Strike`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji(EMOJIS.edit || '✏️'),
            new ButtonBuilder()
                .setCustomId('config-points:limites:modal')
                .setLabel(`${EMOJIS.Rank || '📊'} Editar Limites`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji(EMOJIS.edit || '✏️'),
            new ButtonBuilder()
                .setCustomId('config-points:reset')
                .setLabel(`${EMOJIS.Reset || '⚠️'} Resetar Padrão`)
                .setStyle(ButtonStyle.Danger)
                .setEmoji(EMOJIS.Reset || '⚠️')
        );
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: successMessage || null,
                embeds: [embed],
                components: [row]
            });
        } else {
            await interaction.update({
                content: successMessage || null,
                embeds: [embed],
                components: [row]
            });
        }
    },

    // ==================== CONFIG-ROLES ====================

    async refreshRolesPanel(interaction, successMessage) {
        const guildId = interaction.guildId;
        
        const staffRole = this.getSetting(guildId, 'staff_role');
        const strikeRole = this.getSetting(guildId, 'strike_role');
        const exemplarRole = this.getSetting(guildId, 'role_exemplar');
        const problematicoRole = this.getSetting(guildId, 'role_problematico');
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle(`${EMOJIS.staff || '👥'} Cargos do Sistema`)
            .setDescription('Selecione os cargos abaixo:')
            .addFields(
                { name: `${EMOJIS.staff || '🛡️'} Staff`, value: staffRole ? `<@&${staffRole}>` : `${EMOJIS.Error || '❌'} Não definido`, inline: true },
                { name: `${EMOJIS.strike || '⚠️'} Strike (Temporário)`, value: strikeRole ? `<@&${strikeRole}>` : `${EMOJIS.Error || '❌'} Não definido`, inline: true },
                { name: `${EMOJIS.shinystar || '✨'} Exemplar`, value: exemplarRole ? `<@&${exemplarRole}>` : `${EMOJIS.Error || '❌'} Não definido`, inline: true },
                { name: `${EMOJIS.Warning || '⚠️'} Problemático`, value: problematicoRole ? `<@&${problematicoRole}>` : `${EMOJIS.Error || '❌'} Não definido`, inline: true }
            )
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();
        
        const staffRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:staff').setPlaceholder(`${EMOJIS.staff || '🛡️'} Selecionar cargo de Staff`)
        );
        const strikeRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:strike').setPlaceholder(`${EMOJIS.strike || '⚠️'} Selecionar cargo de Strike`)
        );
        const exemplarRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:exemplar').setPlaceholder(`${EMOJIS.shinystar || '✨'} Selecionar cargo Exemplar`)
        );
        const problematicoRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:problematico').setPlaceholder(`${EMOJIS.Warning || '⚠️'} Selecionar cargo Problemático`)
        );
        
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: successMessage || null,
                    embeds: [embed],
                    components: [staffRow, strikeRow, exemplarRow, problematicoRow]
                });
            } else {
                await interaction.update({
                    content: successMessage || null,
                    embeds: [embed],
                    components: [staffRow, strikeRow, exemplarRow, problematicoRow]
                });
            }
        } catch (error) {
            console.error('❌ Erro no refreshRolesPanel:', error);
        }
    },

    async setRole(interaction, roleKey) {
        const selectedRoleId = interaction.values[0];
        if (!selectedRoleId) {
            return await ResponseManager.error(interaction, 'Nenhum cargo selecionado.');
        }
        
        const role = interaction.guild.roles.cache.get(selectedRoleId);
        if (!role) {
            return await ResponseManager.error(interaction, 'Cargo não encontrado.');
        }
        
        this.setSetting(interaction.guildId, roleKey, selectedRoleId);
        this.clearCache(interaction.guildId);
        
        const roleLabels = {
            staff_role: 'Staff',
            strike_role: 'Strike',
            role_exemplar: 'Exemplar',
            role_problematico: 'Problemático'
        };
        
        await this.refreshRolesPanel(interaction, `✅ **${roleLabels[roleKey]}** alterado para ${role}`);
    },

    // ==================== CONFIG-LOGS ====================

    async refreshLogsPanel(interaction, successMessage) {
        const guildId = interaction.guildId;
        
        const logGeral = this.getSetting(guildId, 'log_channel');
        const logPunishments = this.getSetting(guildId, 'log_punishments');
        const logAutomod = this.getSetting(guildId, 'log_automod');
        const logTickets = this.getSetting(guildId, 'log_tickets');
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle(`${EMOJIS.dashboard || '📝'} Canais de Log`)
            .setDescription('Selecione os canais abaixo:')
            .addFields(
                { name: `${EMOJIS.global || '📜'} Geral`, value: logGeral ? `<#${logGeral}>` : `${EMOJIS.Error || '❌'} Não definido`, inline: true },
                { name: `${EMOJIS.strike || '⚖️'} Punições`, value: logPunishments ? `<#${logPunishments}>` : `${EMOJIS.Error || '❌'} Não definido`, inline: true },
                { name: `${EMOJIS.AutoMod || '🛡️'} AutoMod`, value: logAutomod ? `<#${logAutomod}>` : `${EMOJIS.Error || '❌'} Não definido`, inline: true },
                { name: `${EMOJIS.Ticket || '🎫'} Tickets`, value: logTickets ? `<#${logTickets}>` : `${EMOJIS.Error || '❌'} Não definido`, inline: true }
            )
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();
        
        const geralRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:geral')
                .setPlaceholder(`${EMOJIS.global || '📜'} Selecionar canal de logs gerais`)
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const punishmentsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:punishments')
                .setPlaceholder(`${EMOJIS.strike || '⚖️'} Selecionar canal de logs de punições`)
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const automodRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:automod')
                .setPlaceholder(`${EMOJIS.AutoMod || '🛡️'} Selecionar canal de logs de automoderação`)
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const ticketsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:tickets')
                .setPlaceholder(`${EMOJIS.Ticket || '🎫'} Selecionar canal de logs de tickets`)
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config-logs:criar')
                .setLabel('Criar Canais Automaticamente')
                .setStyle(ButtonStyle.Success)
                .setEmoji(EMOJIS.plusone || '➕')
        );
        
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: successMessage || null,
                    embeds: [embed],
                    components: [geralRow, punishmentsRow, automodRow, ticketsRow, buttonRow]
                });
            } else {
                await interaction.update({
                    content: successMessage || null,
                    embeds: [embed],
                    components: [geralRow, punishmentsRow, automodRow, ticketsRow, buttonRow]
                });
            }
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
            log_channel: `${EMOJIS.global || '📜'} Canal de logs gerais`,
            log_punishments: `${EMOJIS.strike || '⚖️'} Canal de logs de punições`,
            log_automod: `${EMOJIS.AutoMod || '🛡️'} Canal de logs de automoderação`,
            log_tickets: `${EMOJIS.Ticket || '🎫'} Canal de logs de tickets`
        };
        
        await this.refreshLogsPanel(interaction, `✅ **${channelLabels[channelKey]}** alterado para ${channel}`);
    },

    async createLogChannels(interaction) {
        try {
            if (!interaction.isRepliable()) {
                console.error('❌ Interação não pode ser respondida');
                return;
            }
            
            const guild = interaction.guild;
            
            if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Não tenho permissão para criar canais.`, components: [] });
                } else {
                    await interaction.reply({ content: `${EMOJIS.Error || '❌'} Não tenho permissão para criar canais.`, flags: 64 });
                }
                return;
            }
            
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({ content: `${EMOJIS.clock || '⏳'} Criando canais de log...`, flags: 64 });
            }
            
            const category = await guild.channels.create({
                name: '📊 LOGS DO SISTEMA',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
                ]
            });
            
            const geral = await guild.channels.create({
                name: `${EMOJIS.global || '📜'} logs-gerais`,
                type: ChannelType.GuildText,
                parent: category.id
            });
            
            const automod = await guild.channels.create({
                name: `${EMOJIS.AutoMod || '🛡️'} logs-automod`,
                type: ChannelType.GuildText,
                parent: category.id
            });
            
            const punishments = await guild.channels.create({
                name: `${EMOJIS.strike || '⚖️'} logs-punicoes`,
                type: ChannelType.GuildText,
                parent: category.id
            });
            
            const tickets = await guild.channels.create({
                name: `${EMOJIS.Ticket || '🎫'} logs-tickets`,
                type: ChannelType.GuildText,
                parent: category.id
            });
            
            this.setSetting(guild.id, 'log_channel', geral.id);
            this.setSetting(guild.id, 'log_automod', automod.id);
            this.setSetting(guild.id, 'log_punishments', punishments.id);
            this.setSetting(guild.id, 'log_tickets', tickets.id);
            this.clearCache(guild.id);
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle(`${EMOJIS.Check || '✅'} Canais de Log Criados`)
                .setDescription('Os seguintes canais foram criados:')
                .addFields(
                    { name: `${EMOJIS.global || '📜'} Geral`, value: `<#${geral.id}>`, inline: true },
                    { name: `${EMOJIS.AutoMod || '🛡️'} AutoMod`, value: `<#${automod.id}>`, inline: true },
                    { name: `${EMOJIS.strike || '⚖️'} Punições`, value: `<#${punishments.id}>`, inline: true },
                    { name: `${EMOJIS.Ticket || '🎫'} Tickets`, value: `<#${tickets.id}>`, inline: true }
                )
                .setFooter(this.getFooter(guild.name))
                .setTimestamp();
            
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [embed], components: [] });
            } else {
                await interaction.reply({ embeds: [embed], flags: 64 });
            }
            
        } catch (error) {
            console.error('❌ Erro ao criar canais:', error);
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Erro ao criar canais: ${error.message}`, components: [] });
                } else {
                    await interaction.reply({ content: `${EMOJIS.Error || '❌'} Erro ao criar canais: ${error.message}`, flags: 64 });
                }
            } catch (err) {
                console.error('❌ Erro ao responder:', err);
            }
        }
    },

    getLogChannel(guildId, type) {
        const channelMap = {
            geral: 'log_channel',
            punishments: 'log_punishments',
            automod: 'log_automod',
            tickets: 'log_tickets'
        };
        
        const key = channelMap[type];
        if (!key) return null;
        
        const channelId = this.getSetting(guildId, key);
        if (!channelId) return null;
        
        return channelId;
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