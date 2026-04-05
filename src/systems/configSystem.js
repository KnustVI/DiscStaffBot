const db = require('../database/index');
const sessionManager = require('../utils/sessionManager');
const ResponseManager = require('../utils/responseManager');
const { EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');

/**
 * Cache em memória
 * Chave: {guildId}_{key}
 */
const cache = new Map();

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
            text: `By:KnustVI • ${guildName}`,
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png'
        };
    },

    // ==================== HANDLER PRINCIPAL CONFIGS ====================

            async handleComponent(interaction, action, param) {
            try {
                // Identificar o sistema pelo customId
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
                if (customId === 'config-logs:criar') {
                    await this.createLogChannels(interaction);
                    return;
                }
                
                // Fallback para outros casos
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
            .setTitle('⚙️ Configurar Níveis de Strike');
        
        const fields = [
            { id: 'nivel1', label: '🟢 Nível 1 (Leve)', value: pontos[1] },
            { id: 'nivel2', label: '🟡 Nível 2 (Moderada)', value: pontos[2] },
            { id: 'nivel3', label: '🟠 Nível 3 (Grave)', value: pontos[3] },
            { id: 'nivel4', label: '🔴 Nível 4 (Severa)', value: pontos[4] },
            { id: 'nivel5', label: '💀 Nível 5 (Permanente)', value: pontos[5] }
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
            .setTitle('📊 Configurar Limites de Reputação');
        
        const exemplarInput = new TextInputBuilder()
            .setCustomId('exemplar_limit')
            .setLabel('🎖️ Limite Exemplar (50-100)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(exemplarLimit.toString())
            .setPlaceholder('Ex: 95');
        
        const problematicInput = new TextInputBuilder()
            .setCustomId('problematic_limit')
            .setLabel('⚠️ Limite Problemático (0-50)')
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
            `# ⚙️ Configuração de Pontos e Limites`,
            `Gerencie os valores do sistema de reputação.`,
            ``,
            `## 🎯 Níveis de Strike`,
            `${severityIcons[1]} **Nível 1 (${severityNames[1]}):** \`${points[1]} pontos\``,
            `${severityIcons[2]} **Nível 2 (${severityNames[2]}):** \`${points[2]} pontos\``,
            `${severityIcons[3]} **Nível 3 (${severityNames[3]}):** \`${points[3]} pontos\``,
            `${severityIcons[4]} **Nível 4 (${severityNames[4]}):** \`${points[4]} pontos\``,
            `${severityIcons[5]} **Nível 5 (${severityNames[5]}):** \`${points[5]} pontos\``,
            ``,
            `## 📊 Limites de Reputação`,
            `**🎖️ Exemplar:** Acima de \`${exemplarLimit}\` pontos`,
            `**⚠️ Problemático:** Abaixo de \`${problematicLimit}\` pontos`
        ].join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(description)
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config-points:strike:modal')
                .setLabel('🎯 Editar Níveis de Strike')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✏️'),
            new ButtonBuilder()
                .setCustomId('config-points:limites:modal')
                .setLabel('📊 Editar Limites')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✏️'),
            new ButtonBuilder()
                .setCustomId('config-points:reset')
                .setLabel('Resetar Padrão')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('⚠️')
        );
        
         if (interaction.deferred) {
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

    async refreshRolesPanel(interaction, successMessage) {
        const guildId = interaction.guildId;
        
        const staffRole = this.getSetting(guildId, 'staff_role');
        const strikeRole = this.getSetting(guildId, 'strike_role');
        const exemplarRole = this.getSetting(guildId, 'role_exemplar');
        const problematicoRole = this.getSetting(guildId, 'role_problematico');
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle('👥 Cargos do Sistema')
            .setDescription('Selecione os cargos abaixo:')
            .addFields(
                { name: '🛡️ Staff', value: staffRole ? `<@&${staffRole}>` : '`❌ Não definido`', inline: true },
                { name: '⚠️ Strike (Temporário)', value: strikeRole ? `<@&${strikeRole}>` : '`❌ Não definido`', inline: true },
                { name: '✨ Exemplar', value: exemplarRole ? `<@&${exemplarRole}>` : '`❌ Não definido`', inline: true },
                { name: '⚠️ Problemático', value: problematicoRole ? `<@&${problematicoRole}>` : '`❌ Não definido`', inline: true }
            )
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();
        
        const { ActionRowBuilder, RoleSelectMenuBuilder } = require('discord.js');
        
        const staffRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:staff').setPlaceholder('Selecionar cargo de Staff')
        );
        const strikeRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:strike').setPlaceholder('Selecionar cargo de Strike')
        );
        const exemplarRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:exemplar').setPlaceholder('Selecionar cargo Exemplar')
        );
        const problematicoRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:problematico').setPlaceholder('Selecionar cargo Problemático')
        );
        
        await interaction.update({
            content: successMessage || null,
            embeds: [embed],
            components: [staffRow, strikeRow, exemplarRow, problematicoRow]
        });
    },

    // ==================== CONFIG-LOGS ====================

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
        
        await this.refreshLogsPanel(interaction, `✅ **Canal de logs** alterado para ${channel}`);
    },

    async createLogChannels(interaction) {
        const guild = interaction.guild;
        
        const category = await guild.channels.create({
            name: '📊 LOGS DO SISTEMA',
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
            ]
        });
        
        const channels = {
            geral: await guild.channels.create({ name: '📜 logs-gerais', type: ChannelType.GuildText, parent: category.id }),
            automod: await guild.channels.create({ name: '🛡️ logs-automod', type: ChannelType.GuildText, parent: category.id }),
            punishments: await guild.channels.create({ name: '⚖️ logs-punicoes', type: ChannelType.GuildText, parent: category.id }),
            tickets: await guild.channels.create({ name: '🎫 logs-tickets', type: ChannelType.GuildText, parent: category.id })
        };
        
        this.setSetting(guild.id, 'log_channel', channels.geral.id);
        this.setSetting(guild.id, 'log_automod', channels.automod.id);
        this.setSetting(guild.id, 'log_punishments', channels.punishments.id);
        this.setSetting(guild.id, 'log_tickets', channels.tickets.id);
        this.clearCache(guild.id);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Canais de Log Criados')
            .setDescription('Os seguintes canais foram criados:')
            .addFields(
                { name: '📜 Geral', value: `<#${channels.geral.id}>`, inline: true },
                { name: '🛡️ AutoMod', value: `<#${channels.automod.id}>`, inline: true },
                { name: '⚖️ Punições', value: `<#${channels.punishments.id}>`, inline: true },
                { name: '🎫 Tickets', value: `<#${channels.tickets.id}>`, inline: true }
            )
            .setFooter(this.getFooter(guild.name))
            .setTimestamp();
        
        await interaction.update({ embeds: [embed], components: [] });
    },

    async refreshLogsPanel(interaction, successMessage) {
        const guildId = interaction.guildId;
        
        const logGeral = this.getSetting(guildId, 'log_channel');
        const logAutomod = this.getSetting(guildId, 'log_automod');
        const logPunishments = this.getSetting(guildId, 'log_punishments');
        const logTickets = this.getSetting(guildId, 'log_tickets');
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle('📝 Canais de Log')
            .setDescription('Configure os canais para cada sistema:')
            .addFields(
                { name: '📜 Geral', value: logGeral ? `<#${logGeral}>` : '`❌ Não definido`', inline: false },
                { name: '🛡️ AutoModeração', value: logAutomod ? `<#${logAutomod}>` : '`❌ Não definido`', inline: true },
                { name: '⚖️ Punições', value: logPunishments ? `<#${logPunishments}>` : '`❌ Não definido`', inline: true },
                { name: '🎫 Tickets', value: logTickets ? `<#${logTickets}>` : '`❌ Não definido`', inline: true }
            )
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();
        
        const row1 = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:geral')
                .setPlaceholder('Selecionar canal de logs gerais')
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config-logs:criar')
                .setLabel('➕ Criar Canais Automaticamente')
                .setStyle(ButtonStyle.Success)
                .setEmoji('➕')
        );
        
        await interaction.update({
            content: successMessage || null,
            embeds: [embed],
            components: [row1, row2]
        });
    },

        clearAllCache() {
        try {
            cache.clear();
            console.log('🗑️ Cache completo limpo');
        } catch (error) {
            console.error('❌ Erro ao limpar cache:', error);
        }
    }
};



module.exports = ConfigSystem;