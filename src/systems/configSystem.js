const db = require('../database/index');
const SessionManager = require('../utils/sessionManager');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Cache em memória para evitar queries repetitivas ao SQLite.
 * Chave: {guildId}_{key}
 */
const cache = new Map();

const ConfigSystem = {
    /**
     * Busca uma configuração.
     * Prioriza Cache -> Fallback para DB -> Default null.
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
     * Salva ou Atualiza uma configuração.
     * Atualiza DB (Atomic) e Cache simultaneamente.
     */
    setSetting(guildId, key, value) {
        try {
            // Garantimos que o valor seja sempre string no banco para evitar conflitos de tipo
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
     * Busca um conjunto de configurações de uma vez (Performance para embeds).
     */
    getMany(guildId, keys = []) {
        const result = {};
        for (const key of keys) {
            result[key] = this.getSetting(guildId, key);
        }
        return result;
    },

    /**
     * Remove o cache de um servidor específico.
     * Útil para reset de banco ou quando o bot sai de um servidor.
     */
    clearCache(guildId) {
        try {
            for (const key of cache.keys()) {
                if (key.startsWith(`${guildId}_`)) {
                    cache.delete(key);
                }
            }
        } catch (error) {
            console.error(`❌ Erro ao limpar cache do servidor ${guildId}:`, error);
        }
    },

    /**
     * Carrega todos os caches de um servidor (pré-load)
     */
    async loadCache(guildId) {
        try {
            const rows = db.prepare('SELECT key, value FROM settings WHERE guild_id = ?').all(guildId);
            for (const row of rows) {
                cache.set(`${guildId}_${row.key}`, row.value);
            }
            return rows.length;
        } catch (error) {
            console.error(`❌ Erro ao carregar cache do servidor ${guildId}:`, error);
            return 0;
        }
    },

    // ==================== MÉTODOS PARA HANDLER CENTRAL ====================

    /**
     * Handler para componentes (botões e selects)
     * Chamado pelo InteractionHandler quando customId começa com "config:"
     */
    async handleComponent(interaction, action, param) {

        console.log(`🔍 [CONFIG] handleComponent chamado!`);
        console.log(`🔍 [CONFIG] action=${action}, param=${param}`);
        console.log(`🔍 [CONFIG] interaction.customId=${interaction.customId}`);

        try {
            switch (action) {
                case 'menu':
                     console.log(`🔍 [CONFIG] Caso 'menu'`);
                    await this.handleConfigMenu(interaction, param);
                    break;
                case 'set':
                    console.log(`🔍 [CONFIG] Caso 'set'`);
                    await this.handleSetConfig(interaction, param);
                    break;
                case 'reset':
                    console.log(`🔍 [CONFIG] Caso 'reset'`);
                    await this.handleResetConfig(interaction, param);
                    break;
                default:
                    console.log(`🔍 [CONFIG] Ação desconhecida: ${action}`);
                    await interaction.editReply({
                        content: `❌ Ação "${action}" não reconhecida no sistema de configuração.`,
                        components: []
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent do configSystem:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao processar a configuração.',
                components: []
            });
        }
    },

    /**
     * Handler para modais
     * Chamado pelo InteractionHandler quando modal começa com "config:"
     */
    async handleModal(interaction, action) {
        try {
            switch (action) {
                case 'set':
                    await this.processConfigModal(interaction);
                    break;
                default:
                    await interaction.editReply({
                        content: `❌ Modal "${action}" não reconhecido no sistema de configuração.`,
                        flags: 64
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleModal do configSystem:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao processar o modal de configuração.',
                flags: 64
            });
        }
    },

    /**
     * Exibe o menu principal de configuração
     */
    async handleConfigMenu(interaction, param) {
        const guildId = interaction.guildId;
        
        // Buscar configurações atuais
        const prefix = this.getSetting(guildId, 'prefix') || '/';
        const staffRole = this.getSetting(guildId, 'staff_role') || 'Não definido';
        const logChannel = this.getSetting(guildId, 'log_channel') || 'Não definido';
        const autoMod = this.getSetting(guildId, 'automod_enabled') === 'true' ? '✅ Ativado' : '❌ Desativado';

        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle('⚙️ Painel de Configuração')
            .setDescription('Configure o bot de acordo com as necessidades do seu servidor.')
            .addFields(
                { name: '📝 Prefixo', value: `\`${prefix}\``, inline: true },
                { name: '👥 Cargo Staff', value: `<@&${staffRole}>` || staffRole, inline: true },
                { name: '📋 Canal de Logs', value: `<#${logChannel}>` || logChannel, inline: true },
                { name: '🛡️ Auto Moderação', value: autoMod, inline: true }
            )
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`config:set:menu`)
            .setPlaceholder('Selecione uma opção para configurar')
            .addOptions([
                { label: 'Prefixo', value: 'prefix', description: 'Alterar o prefixo do bot', emoji: '📝' },
                { label: 'Cargo Staff', value: 'staff_role', description: 'Definir cargo da equipe de moderação', emoji: '👥' },
                { label: 'Canal de Logs', value: 'log_channel', description: 'Definir canal para logs', emoji: '📋' },
                { label: 'Auto Moderação', value: 'automod_enabled', description: 'Ativar/Desativar auto moderação', emoji: '🛡️' },
                { label: 'Resetar Tudo', value: 'reset_all', description: 'Resetar todas as configurações', emoji: '⚠️' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });
    },

    /**
     * Processa a seleção de uma configuração para alterar
     */
    async handleSetConfig(interaction, configKey) {
        console.log(`🔍 [CONFIG] handleSetConfig chamado com configKey: ${configKey}`);
        console.log(`🔍 [CONFIG] Tipo de interação: ${interaction.constructor.name}`);
        console.log(`🔍 [CONFIG] isRoleSelectMenu: ${interaction.isRoleSelectMenu?.()}`);
        console.log(`🔍 [CONFIG] isChannelSelectMenu: ${interaction.isChannelSelectMenu?.()}`);
        console.log(`🔍 [CONFIG] isStringSelectMenu: ${interaction.isStringSelectMenu?.()}`);
        
        if (!configKey) {
            return await interaction.editReply({
                content: '❌ Configuração inválida.',
                components: []
            });
        }

        // ==================== PROCESSAR ROLE SELECT MENU ====================
        if (interaction.isRoleSelectMenu && interaction.isRoleSelectMenu()) {
            const selectedRoleId = interaction.values[0];
            if (!selectedRoleId) {
                return await interaction.editReply({
                    content: '❌ Nenhum cargo selecionado.',
                    components: []
                });
            }
            
            // Verificar se o cargo existe
            const role = interaction.guild.roles.cache.get(selectedRoleId);
            if (!role) {
                return await interaction.editReply({
                    content: '❌ Cargo não encontrado.',
                    components: []
                });
            }
            
            // Salvar configuração
            this.setSetting(interaction.guildId, configKey, selectedRoleId);
            
            // Confirmar alteração
            const configLabels = {
                staff_role: 'Cargo Staff',
                strike_role: 'Cargo de Strike'
            };
            
            const label = configLabels[configKey] || configKey;
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Configuração Atualizada')
                .setDescription(`**${label}** alterado para:\n<@&${selectedRoleId}>`)
                .setFooter(this.getFooter(interaction.guild.name))
                .setTimestamp();
            
            // Atualizar o painel com os novos valores
            await this.refreshConfigPanel(interaction);
            
            return await interaction.editReply({
                embeds: [embed],
                components: [],
                content: null
            });
        }
        
        // ==================== PROCESSAR CHANNEL SELECT MENU ====================
        if (interaction.isChannelSelectMenu && interaction.isChannelSelectMenu()) {
            const selectedChannelId = interaction.values[0];
            if (!selectedChannelId) {
                return await interaction.update({
                    content: '❌ Nenhum canal selecionado.',
                    components: []
                });
            }
            
            // Verificar se o canal existe
            const channel = interaction.guild.channels.cache.get(selectedChannelId);
            if (!channel) {
                return await interaction.update({
                    content: '❌ Canal não encontrado.',
                    components: []
                });
            }
            
            // Salvar configuração
            this.setSetting(interaction.guildId, configKey, selectedChannelId);
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Configuração Atualizada')
                .setDescription(`**Canal de Logs** alterado para:\n<#${selectedChannelId}>`)
                .setFooter(this.getFooter(interaction.guild.name))
                .setTimestamp();
            
            // Atualizar o painel com os novos valores
            await this.refreshConfigPanel(interaction);
            
            return await interaction.update({
                embeds: [embed],
                components: [],
                content: null
            });
        }
        
        // ==================== PROCESSAR STRING SELECT MENU (menu de opções) ====================
        if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
            const selectedValue = interaction.values[0];
            
            // Se for reset all, chama o método de reset
            if (selectedValue === 'reset_all') {
                return await this.handleResetConfig(interaction, 'all');
            }
            
            // Se for automod_enabled, faz toggle direto (sem modal)
            if (selectedValue === 'automod_enabled') {
                const current = this.getSetting(interaction.guildId, 'automod_enabled') === 'true';
                const newValue = !current;
                this.setSetting(interaction.guildId, 'automod_enabled', newValue.toString());
                
                const status = newValue ? '✅ ativada' : '❌ desativada';
                
                // Atualizar o painel
                await this.refreshConfigPanel(interaction);
                
                return await interaction.update({
                    content: `🛡️ Auto moderação ${status} com sucesso!`,
                    components: [],
                    embeds: []
                });
            }
            
            // Para prefixo, abrir modal
            if (selectedValue === 'prefix') {
                // Salvar qual config está sendo editada na sessão
                SessionManager.set(
                    interaction.user.id,
                    interaction.guildId,
                    'config_editing',
                    { configKey: selectedValue, originalInteractionId: interaction.id },
                    300000
                );
                
                // Criar modal para entrada de valor
                const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
                
                const modal = new ModalBuilder()
                    .setCustomId(`config:set:${selectedValue}`)
                    .setTitle(`Configurar Prefixo`);
                
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
            
            // Para staff_role e log_channel, não deveriam vir aqui (são tratados pelos menus específicos)
            // Mas se vierem, mostrar mensagem
            return await interaction.update({
                content: `❌ Selecione a opção usando os menus específicos abaixo.`,
                components: []
            });
        }
        
        // Fallback para outros tipos (não deveria acontecer)
        return await interaction.update({
            content: `❌ Tipo de interação não suportado para configuração.`,
            components: []
        });
    },

        /**
     * Atualiza o painel de configuração com os valores atuais
     */
    async refreshConfigPanel(interaction) {
        const guildId = interaction.guildId;
        
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
            .setDescription('Selecione abaixo os cargos e canais que o bot deve utilizar para o sistema de reputação.')
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
        
        // Criar os menus novamente
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
        
        // Usar update para atualizar a mensagem original
        await interaction.editReply({
            embeds: [embed],
            components: [staffRow, logRow, strikeRow]
        });
    },

    /**
     * Processa o modal enviado pelo usuário
     */
    async processConfigModal(interaction) {
        const [_, __, configKey] = interaction.customId.split(':');
        
        // Verificar sessão
        const session = SessionManager.get(
            interaction.user.id,
            interaction.guildId,
            'config_editing'
        );

        if (!session || session.configKey !== configKey) {
            return await interaction.editReply({
                content: '❌ Sessão expirada ou inválida. Por favor, inicie a configuração novamente.',
                flags: 64
            });
        }

        const newValue = interaction.fields.getTextInputValue('value');

        // Validação específica por tipo
        if (configKey === 'staff_role' || configKey === 'log_channel') {
            if (!/^\d+$/.test(newValue)) {
                return await interaction.editReply({
                    content: '❌ Por favor, insira um ID válido (apenas números).',
                    flags: 64
                });
            }
            
            // Verificar se o cargo/canal existe
            if (configKey === 'staff_role') {
                const role = interaction.guild.roles.cache.get(newValue);
                if (!role) {
                    return await interaction.editReply({
                        content: '❌ Cargo não encontrado. Verifique o ID e tente novamente.',
                        flags: 64
                    });
                }
            } else if (configKey === 'log_channel') {
                const channel = interaction.guild.channels.cache.get(newValue);
                if (!channel) {
                    return await interaction.editReply({
                        content: '❌ Canal não encontrado. Verifique o ID e tente novamente.',
                        flags: 64
                    });
                }
            }
        }

        // Salvar configuração
        this.setSetting(interaction.guildId, configKey, newValue);
        
        // Limpar sessão
        SessionManager.delete(interaction.user.id, interaction.guildId, 'config_editing');

        // Confirmar alteração
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle('✅ Configuração Atualizada')
            .setDescription(`**${this.getConfigLabel(configKey)}** alterado para:\n\`${newValue}\``)
            .setFooter(this.getFooter(interaction.guild.name))
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: [],
            content: null
        });
    },

    /**
     * Reseta configurações
     */
    async handleResetConfig(interaction, param) {
        if (param === 'all') {
            // Resetar todas as configurações
            db.prepare('DELETE FROM settings WHERE guild_id = ?').run(interaction.guildId);
            this.clearCache(interaction.guildId);
            
            const embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setTitle('⚠️ Configurações Resetadas')
                .setDescription('Todas as configurações do bot foram resetadas para o padrão.')
                .setFooter(this.getFooter(interaction.guild.name))
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                components: []
            });
        } else {
            // Resetar configuração específica
            this.setSetting(interaction.guildId, param, null);
            
            const embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setTitle('⚠️ Configuração Resetada')
                .setDescription(`**${this.getConfigLabel(param)}** foi resetado para o valor padrão.`)
                .setFooter(this.getFooter(interaction.guild.name))
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                components: []
            });
        }
    },

    /**
     * Helper para padronização visual das Embeds.
     */
    getFooter(guildName) {
        return {
            text: `Sistema Robin • ${guildName}`,
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png'
        };
    },

    /**
     * Retorna o label amigável de uma configuração
     */
    getConfigLabel(configKey) {
        const labels = {
            prefix: 'Prefixo',
            staff_role: 'Cargo Staff',
            log_channel: 'Canal de Logs',
            automod_enabled: 'Auto Moderação'
        };
        return labels[configKey] || configKey;
    },

    /**
     * Verifica se um usuário tem permissão de staff
     */
    isStaff(userId, guildId) {
        try {
            const staffRoleId = this.getSetting(guildId, 'staff_role');
            if (!staffRoleId) return false;
            
            const member = client?.guilds.cache.get(guildId)?.members.cache.get(userId);
            if (!member) return false;
            
            return member.roles.cache.has(staffRoleId);
        } catch (error) {
            console.error('❌ Erro ao verificar staff:', error);
            return false;
        }
    }
};

module.exports = ConfigSystem;