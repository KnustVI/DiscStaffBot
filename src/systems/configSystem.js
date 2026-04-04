const db = require('../database/index');
const sessionManager = require('../utils/sessionManager');
const ResponseManager = require('../utils/responseManager');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

/**
 * Cache em memória com TTL
 * Chave: {guildId}_{key}
 */
const cache = new Map();

const ConfigSystem = {
    /**
     * Busca uma configuração
     */
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

    /**
     * Salva ou Atualiza uma configuração
     */
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
     * Busca múltiplas configurações
     */
    getMany(guildId, keys = []) {
        const result = {};
        for (const key of keys) {
            result[key] = this.getSetting(guildId, key);
        }
        return result;
    },

    /**
     * Remove cache de um servidor
     */
    clearCache(guildId) {
        try {
            for (const key of cache.keys()) {
                if (key.startsWith(`${guildId}_`)) {
                    cache.delete(key);
                }
            }
        } catch (error) {
            console.error(`❌ Erro ao limpar cache:`, error);
        }
    },

    /**
     * Carrega cache do servidor
     */
    async loadCache(guildId) {
        try {
            const rows = db.prepare('SELECT key, value FROM settings WHERE guild_id = ?').all(guildId);
            for (const row of rows) {
                cache.set(`${guildId}_${row.key}`, row.value);
            }
            return rows.length;
        } catch (error) {
            console.error(`❌ Erro ao carregar cache:`, error);
            return 0;
        }
    },

    // ==================== HANDLER PRINCIPAL ====================

    /**
     * Handler para componentes
     */
    async handleComponent(interaction, action, param) {
        try {
            switch (action) {
                case 'menu':
                    await this.handleConfigMenu(interaction);
                    break;
                case 'set':
                    await this.handleSetConfig(interaction, param);
                    break;
                case 'reset':
                    await this.handleResetConfig(interaction, param);
                    break;
                case 'edit':      // Botão: config-strike:edit:modal
                    await this.handleStrikeEdit(interaction);
                    break;
                case 'reset-strike':  // Botão: config-strike:reset-strike
                    await this.handleStrikeReset(interaction);
                    break;
                default:
                    await ResponseManager.error(interaction, `Ação "${action}" não reconhecida.`);
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await ResponseManager.error(interaction, 'Ocorreu um erro ao processar a configuração.');
        }
    },

        
        //Handler para componentes do config-strike

        /**
         * Processa o modal unificado de edição de níveis do strike
         */
            async processStrikeModal(interaction) {
            // Extrair valores de todos os campos
            const novosPontos = {
                1: parseInt(interaction.fields.getTextInputValue('nivel1')),
                2: parseInt(interaction.fields.getTextInputValue('nivel2')),
                3: parseInt(interaction.fields.getTextInputValue('nivel3')),
                4: parseInt(interaction.fields.getTextInputValue('nivel4')),
                5: parseInt(interaction.fields.getTextInputValue('nivel5'))
            };
            
            const changes = [];
            const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
            const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
            
            // Validar cada nível
            for (let i = 1; i <= 5; i++) {
                if (isNaN(novosPontos[i]) || novosPontos[i] < 0 || novosPontos[i] > 100) {
                    return await ResponseManager.error(interaction, `Nível ${i} deve ser um número entre 0 e 100.`);
                }
            }
            
            // Salvar configurações
            for (let i = 1; i <= 5; i++) {
                const valorAntigo = this.getSetting(interaction.guildId, `strike_points_${i}`);
                if (valorAntigo !== novosPontos[i].toString()) {
                    this.setSetting(interaction.guildId, `strike_points_${i}`, novosPontos[i].toString());
                    changes.push(`${severityIcons[i]} Nível ${i} (${severityNames[i]}): \`${valorAntigo || 'padrão'}\` → \`${novosPontos[i]}\``);
                }
            }
            
            this.clearCache(interaction.guildId);
            
            // Registrar atividade
            const db = require('../database/index');
            db.logActivity(interaction.guildId, interaction.user.id, 'config_strike_set', null, {
                changes: novosPontos
            });
            
            // Atualizar o painel
            const changeMessage = changes.length > 0 
                ? `✅ **${changes.length} alterações salvas!**\n${changes.join('\n')}`
                : 'ℹ️ Nenhuma alteração foi detectada.';
            
            // ⚠️ IMPORTANTE: O modal já respondeu com reply, agora usamos editReply
            await this.refreshStrikePanel(interaction, changeMessage);
        },


        async handleStrikeEdit(interaction) {
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
                .setCustomId('config-strike:modal')
                .setTitle('⚙️ Configurar Níveis de Strike');
            
            const nivel1 = new TextInputBuilder()
                .setCustomId('nivel1')
                .setLabel('🟢 Nível 1 (Leve) - Pontos')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(pontos[1].toString())
                .setPlaceholder('Ex: 10');
            
            const nivel2 = new TextInputBuilder()
                .setCustomId('nivel2')
                .setLabel('🟡 Nível 2 (Moderada) - Pontos')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(pontos[2].toString())
                .setPlaceholder('Ex: 25');
            
            const nivel3 = new TextInputBuilder()
                .setCustomId('nivel3')
                .setLabel('🟠 Nível 3 (Grave) - Pontos')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(pontos[3].toString())
                .setPlaceholder('Ex: 40');
            
            const nivel4 = new TextInputBuilder()
                .setCustomId('nivel4')
                .setLabel('🔴 Nível 4 (Severa) - Pontos')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(pontos[4].toString())
                .setPlaceholder('Ex: 60');
            
            const nivel5 = new TextInputBuilder()
                .setCustomId('nivel5')
                .setLabel('💀 Nível 5 (Permanente) - Pontos')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(pontos[5].toString())
                .setPlaceholder('Ex: 100');
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(nivel1),
                new ActionRowBuilder().addComponents(nivel2),
                new ActionRowBuilder().addComponents(nivel3),
                new ActionRowBuilder().addComponents(nivel4),
                new ActionRowBuilder().addComponents(nivel5)
            );
            
            await interaction.showModal(modal);
        },

        async handleStrikeReset(interaction) {
            const guildId = interaction.guildId;
            const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
            
            for (let i = 1; i <= 5; i++) {
                this.setSetting(guildId, `strike_points_${i}`, DEFAULT_POINTS[i].toString());
            }
            this.clearCache(guildId);
            
            await this.refreshStrikePanel(interaction, '✅ Todos os níveis foram resetados para os valores padrão!');
        },

                /**
         * Atualiza o painel do config-strike após alterações
         */
        async refreshStrikePanel(interaction, successMessage) {
            const guildId = interaction.guildId;
            const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
            
            const points = {
                1: parseInt(this.getSetting(guildId, 'strike_points_1')) || DEFAULT_POINTS[1],
                2: parseInt(this.getSetting(guildId, 'strike_points_2')) || DEFAULT_POINTS[2],
                3: parseInt(this.getSetting(guildId, 'strike_points_3')) || DEFAULT_POINTS[3],
                4: parseInt(this.getSetting(guildId, 'strike_points_4')) || DEFAULT_POINTS[4],
                5: parseInt(this.getSetting(guildId, 'strike_points_5')) || DEFAULT_POINTS[5]
            };
            
            const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
            const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
            
            let emojis = {};
            try {
                const emojisFile = require('../database/emojis.js');
                emojis = emojisFile.EMOJIS || {};
            } catch (err) {}
            
            const description = [
                `# ${emojis.Config || '⚙️'} Configuração dos Níveis de Strike`,
                `Gerencie quantos pontos cada nível remove.`,
                ``,
                `## ${emojis.strike || '⚠️'} Valores Atuais`,
                `${severityIcons[1]} **Nível 1 (${severityNames[1]}):** \`${points[1]} pontos\``,
                `${severityIcons[2]} **Nível 2 (${severityNames[2]}):** \`${points[2]} pontos\``,
                `${severityIcons[3]} **Nível 3 (${severityNames[3]}):** \`${points[3]} pontos\``,
                `${severityIcons[4]} **Nível 4 (${severityNames[4]}):** \`${points[4]} pontos\``,
                `${severityIcons[5]} **Nível 5 (${severityNames[5]}):** \`${points[5]} pontos\``,
                ``,
                `## ${emojis.Note || '📝'} Valores Padrão`,
                `Nível 1: 10 pts | Nível 2: 25 pts | Nível 3: 40 pts | Nível 4: 60 pts | Nível 5: 100 pts`
            ].join('\n');
            
            const embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(description)
                .setFooter(this.getFooter(interaction.guild.name))
                .setTimestamp();
            
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config-strike:edit:modal')
                    .setLabel('✏️ Editar Todos os Níveis')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✏️')
            );
            
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config-strike:reset')
                    .setLabel('⚠️ Resetar Padrão')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⚠️')
            );
            
            // Usar update para atualizar a mensagem original
            await interaction.update({
                content: successMessage || null,
                embeds: [embed],
                components: [row1, row2]
            });
        },

        /**
         * Handler para modais
         */
        async handleModal(interaction, action) {
            try {
                // Verificar se é modal do config-strike
                if (interaction.customId === 'config-strike:modal') {  // ← SEM o :all no final
                    await this.processStrikeModal(interaction);
                    return;
                }
                
                if (action === 'set') {
                    await this.processConfigModal(interaction);
                } else {
                    await ResponseManager.error(interaction, `Modal "${action}" não reconhecido.`);
                }
            } catch (error) {
                console.error('❌ Erro no handleModal:', error);
                await ResponseManager.error(interaction, 'Ocorreu um erro ao processar o modal.');
            }
        },

    // ==================== MENU PRINCIPAL ====================

    /**
     * Exibe o menu principal de configuração
     */
    async handleConfigMenu(interaction) {
        const guildId = interaction.guildId;
        
        const prefix = this.getSetting(guildId, 'prefix') || '/';
        const staffRole = this.getSetting(guildId, 'staff_role');
        const logChannel = this.getSetting(guildId, 'log_channel');
        const autoMod = this.getSetting(guildId, 'automod_enabled') === 'true' ? '✅ Ativado' : '❌ Desativado';

        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle('⚙️ Painel de Configuração')
            .setDescription('Configure o bot de acordo com as necessidades do seu servidor.')
            .addFields(
                { name: '📝 Prefixo', value: `\`${prefix}\``, inline: true },
                { name: '👥 Cargo Staff', value: staffRole ? `<@&${staffRole}>` : '`❌ Não definido`', inline: true },
                { name: '📋 Canal de Logs', value: logChannel ? `<#${logChannel}>` : '`❌ Não definido`', inline: true },
                { name: '🛡️ Auto Moderação', value: autoMod, inline: true }
            )
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('config:set:menu')
            .setPlaceholder('Selecione uma opção para configurar')
            .addOptions([
                { label: 'Prefixo', value: 'prefix', description: 'Alterar o prefixo do bot', emoji: '📝' },
                { label: 'Cargo Staff', value: 'staff_role', description: 'Definir cargo da equipe', emoji: '👥' },
                { label: 'Canal de Logs', value: 'log_channel', description: 'Definir canal para logs', emoji: '📋' },
                { label: 'Auto Moderação', value: 'automod_enabled', description: 'Ativar/Desativar', emoji: '🛡️' },
                { label: 'Resetar Tudo', value: 'reset_all', description: 'Resetar todas as configurações', emoji: '⚠️' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await ResponseManager.send(interaction, {
            embeds: [embed],
            components: [row]
        });
    },

    // ==================== PROCESSAMENTO DE CONFIGURAÇÃO ====================

    /**
     * Processa a seleção de uma configuração
     */
    async handleSetConfig(interaction, configKey) {
        if (!configKey) {
            return await ResponseManager.error(interaction, 'Configuração inválida.');
        }

        // Role Select Menu
        if (interaction.isRoleSelectMenu()) {
            const selectedRoleId = interaction.values[0];
            if (!selectedRoleId) {
                return await ResponseManager.error(interaction, 'Nenhum cargo selecionado.');
            }
            
            this.setSetting(interaction.guildId, configKey, selectedRoleId);
            return await this.updateConfigPanel(interaction, `✅ **${this.getConfigLabel(configKey)}** alterado para <@&${selectedRoleId}>`);
        }
        
        // Channel Select Menu
        if (interaction.isChannelSelectMenu()) {
            const selectedChannelId = interaction.values[0];
            if (!selectedChannelId) {
                return await ResponseManager.error(interaction, 'Nenhum canal selecionado.');
            }
            
            this.setSetting(interaction.guildId, configKey, selectedChannelId);
            return await this.updateConfigPanel(interaction, `✅ **${this.getConfigLabel(configKey)}** alterado para <#${selectedChannelId}>`);
        }
        
        // String Select Menu (menu de opções)
        if (interaction.isStringSelectMenu()) {
            const selectedValue = interaction.values[0];
            
            if (selectedValue === 'reset_all') {
                return await this.handleResetConfig(interaction, 'all');
            }
            
            if (selectedValue === 'automod_enabled') {
                const current = this.getSetting(interaction.guildId, 'automod_enabled') === 'true';
                const newValue = !current;
                this.setSetting(interaction.guildId, 'automod_enabled', newValue.toString());
                const status = newValue ? '✅ ativada' : '❌ desativada';
                return await this.updateConfigPanel(interaction, `🛡️ Auto moderação ${status} com sucesso!`);
            }
            
            if (selectedValue === 'prefix') {
                // Criar sessão com isolamento total
                sessionManager.set(
                    interaction.user.id,
                    interaction.guildId,
                    'config',
                    'prefix_edit',
                    { configKey: selectedValue },
                    300000
                );
                
                const modal = new ModalBuilder()
                    .setCustomId(`config:set:${selectedValue}`)
                    .setTitle('Configurar Prefixo');
                
                const input = new TextInputBuilder()
                    .setCustomId('value')
                    .setLabel('Novo prefixo para o bot')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('Ex: !, /, ?');
                
                const row = new ActionRowBuilder().addComponents(input);
                modal.addComponents(row);
                
                return await interaction.showModal(modal);
            }
            
            return await ResponseManager.error(interaction, `Opção "${selectedValue}" não reconhecida.`);
        }
        
        return await ResponseManager.error(interaction, 'Tipo de interação não suportado.');
    },

    /**
     * Processa modal de configuração
     */
    async processConfigModal(interaction) {
        const [, , configKey] = interaction.customId.split(':');
        
        // Verificar sessão com isolamento total
        const session = sessionManager.get(
            interaction.user.id,
            interaction.guildId,
            'config',
            'prefix_edit'
        );

        if (!session || session.configKey !== configKey) {
            return await ResponseManager.error(interaction, 'Sessão expirada. Inicie a configuração novamente.');
        }

        const newValue = interaction.fields.getTextInputValue('value');

        // Validação para prefixo
        if (!newValue || newValue.trim().length === 0) {
            return await ResponseManager.error(interaction, 'O prefixo não pode estar vazio.');
        }

        if (newValue.length > 5) {
            return await ResponseManager.error(interaction, 'O prefixo deve ter no máximo 5 caracteres.');
        }

        // Salvar configuração
        this.setSetting(interaction.guildId, configKey, newValue);
        
        // Limpar sessão
        sessionManager.delete(interaction.user.id, interaction.guildId, 'config', 'prefix_edit');

        // Confirmar alteração
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Configuração Atualizada')
            .setDescription(`**${this.getConfigLabel(configKey)}** alterado para:\n\`${newValue}\``)
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();

        await ResponseManager.send(interaction, {
            embeds: [embed],
            components: []
        });
    },

    /**
     * Reseta configurações
     */
    async handleResetConfig(interaction, param) {
        if (param === 'all') {
            db.prepare('DELETE FROM settings WHERE guild_id = ?').run(interaction.guildId);
            this.clearCache(interaction.guildId);
            return await this.updateConfigPanel(interaction, '⚠️ **Todas as configurações foram resetadas para o padrão!**');
        } else {
            this.setSetting(interaction.guildId, param, null);
            return await this.updateConfigPanel(interaction, `⚠️ **${this.getConfigLabel(param)}** foi resetado para o valor padrão.`);
        }
    },

    /**
     * Atualiza o painel com mensagem de sucesso (UMA ÚNICA RESPOSTA)
     */
    async updateConfigPanel(interaction, successMessage) {
        const guildId = interaction.guildId;
        
        // Forçar recarregamento do cache
        this.clearCache(guildId);
        
        // Buscar configurações atuais
        const staffRole = this.getSetting(guildId, 'staff_role');
        const logChannel = this.getSetting(guildId, 'log_channel');
        const strikeRole = this.getSetting(guildId, 'strike_role');
        const automodEnabled = this.getSetting(guildId, 'automod_enabled') === 'true';
        const exemplarLimit = this.getSetting(guildId, 'limit_exemplar') || '95';
        const problematicLimit = this.getSetting(guildId, 'limit_problematico') || '30';
        
        // Obter emojis
        let emojis = {};
        try {
            const emojisFile = require('../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`${emojis.Config || '⚙️'} Configuração do Servidor`)
            .setColor(0xDCA15E)
            .setDescription('Selecione abaixo os cargos e canais que o bot deve utilizar.')
            .addFields(
                { name: '🛡️ Cargo Staff', value: staffRole ? `<@&${staffRole}>` : '`❌ Não definido`', inline: true },
                { name: '📜 Canal de Logs', value: logChannel ? `<#${logChannel}>` : '`❌ Não definido`', inline: true },
                { name: '⚠️ Cargo de Strike', value: strikeRole ? `<@&${strikeRole}>` : '`❌ Não definido`', inline: true },
                { name: '🛡️ Auto Moderação', value: automodEnabled ? '✅ Ativada' : '❌ Desativada', inline: true },
                { name: '🎖️ Limite Exemplar', value: `\`${exemplarLimit} pontos\``, inline: true },
                { name: '⚠️ Limite Problemático', value: `\`${problematicLimit} pontos\``, inline: true }
            )
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();
        
        // Criar menus
        const { ActionRowBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
        
        const staffRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config:set:staff_role')
                .setPlaceholder('Selecionar Cargo de Moderadores')
        );
        
        const logRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config:set:log_channel')
                .setPlaceholder('Selecionar Canal de Logs')
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const strikeRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config:set:strike_role')
                .setPlaceholder('Selecionar Cargo de Strike')
        );
        
        // RESPOSTA ÚNICA - usando ResponseManager
        await ResponseManager.send(interaction, {
            content: successMessage,
            embeds: [embed],
            components: [staffRow, logRow, strikeRow]
        });
    },

    // ==================== UTILITÁRIOS ====================

    getFooter(guildName) {
        return {
            text: `Sistema Robin • ${guildName}`,
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png'
        };
    },

    getConfigLabel(configKey) {
        const labels = {
            prefix: 'Prefixo',
            staff_role: 'Cargo Staff',
            log_channel: 'Canal de Logs',
            strike_role: 'Cargo de Strike',
            automod_enabled: 'Auto Moderação',
            limit_exemplar: 'Limite Exemplar',
            limit_problematico: 'Limite Problemático'
        };
        return labels[configKey] || configKey;
    },

    isStaff(userId, guildId, client) {
        try {
            const staffRoleId = this.getSetting(guildId, 'staff_role');
            if (!staffRoleId) return false;
            if (!client) return false;
            
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return false;
            
            const member = guild.members.cache.get(userId);
            if (!member) return false;
            
            return member.roles.cache.has(staffRoleId);
        } catch (error) {
            console.error('❌ Erro ao verificar staff:', error);
            return false;
        }
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