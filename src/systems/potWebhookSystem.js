/**
 * potWebhookSystem.js
 * 
 * Sistema especializado em gerenciamento de webhooks do Path of Titans.
 * Responsabilidades:
 * - Criar canais e webhooks
 * - Testar webhooks
 * - Remover webhooks
 * - Gerar containers visuais para o painel
 * - Gerenciar status de cada webhook
 */

const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const PoTConfigSystem = require('./potConfigSystem');
const PoTTokenManager = require('../integrations/pathoftitans/tokenManager');
const { AdvancedContainerBuilder } = require('../utils/containerBuilder');

// Emojis
let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

// ==================== CONFIGURAÇÃO DOS EVENTOS ====================

const LOG_CHANNELS = [
    { 
        name: '📥 login', 
        event: 'login', 
        endpoint: 'PlayerLogin',
        description: '🔐 Controle de entrada e saída de jogadores',
        emoji: '📥'
    },
    { 
        name: '💀 killed', 
        event: 'killed', 
        endpoint: 'PlayerKilled',
        description: '⚔️ Registro de mortes entre jogadores',
        emoji: '💀'
    },
    { 
        name: '💬 chat', 
        event: 'chat', 
        endpoint: 'PlayerChat',
        description: '💬 Mensagens do chat global',
        emoji: '💬'
    },
    { 
        name: '👥 group', 
        event: 'group', 
        endpoint: 'PlayerJoinedGroup',
        description: '👥 Formação e saída de grupos',
        emoji: '👥'
    },
    { 
        name: '🪺 nest', 
        event: 'nest', 
        endpoint: 'CreateNest',
        description: '🪺 Criação e destruição de ninhos',
        emoji: '🪺'
    },
    { 
        name: '📜 quest', 
        event: 'quest', 
        endpoint: 'PlayerQuestComplete',
        description: '📜 Progresso de missões (completo/falha)',
        emoji: '📜'
    },
    { 
        name: '🔄 respawn', 
        event: 'respawn', 
        endpoint: 'PlayerRespawn',
        description: '🔄 Reviver jogadores',
        emoji: '🔄'
    },
    { 
        name: '✨ waystone', 
        event: 'waystone', 
        endpoint: 'PlayerWaystone',
        description: '✨ Uso de pedras de teletransporte',
        emoji: '✨'
    },
    { 
        name: '⚡ command', 
        event: 'command', 
        endpoint: 'PlayerCommand',
        description: '⚡ Comandos de jogadores (prefixo !)',
        emoji: '⚡'
    },
    { 
        name: '👑 admin', 
        event: 'admin_command', 
        endpoint: 'AdminCommand',
        description: '👑 Comandos administrativos',
        emoji: '👑'
    },
    { 
        name: '⚠️ error', 
        event: 'error', 
        endpoint: 'ServerError',
        description: '⚠️ Erros e alertas do servidor',
        emoji: '⚠️'
    }
];

// ==================== CUSTOM IDS PARA INTERACTION HANDLER ====================
const CUSTOM_IDS = {
    CREATE: 'pot_webhook_create',
    TEST: 'pot_webhook_test',
    REMOVE: 'pot_webhook_remove',
    GAMEINI: 'pot_webhook_gameini'
};

// ==================== SISTEMA PRINCIPAL ====================

class PoTWebhookSystem {

    // ==================== GERENCIAMENTO DE WEBHOOKS ====================

    /**
     * Cria um webhook para um evento específico
     */
    static async createWebhookForEvent(guildId, event, categoryId, interaction) {
        try {
            const guild = interaction.guild;
            
            const logConfig = LOG_CHANNELS.find(l => l.event === event);
            if (!logConfig) {
                return { success: false, error: 'Evento não encontrado' };
            }

            const existingUrl = PoTConfigSystem.getWebhookForEvent(guildId, event);
            if (existingUrl) {
                return { success: false, error: 'Webhook já configurado para este evento' };
            }

            let channel = guild.channels.cache.find(
                c => c.name === logConfig.name && 
                c.type === ChannelType.GuildText &&
                c.parentId === categoryId
            );

            if (!channel) {
                channel = await guild.channels.create({
                    name: logConfig.name,
                    type: ChannelType.GuildText,
                    parent: categoryId,
                    topic: `📊 Logs de ${logConfig.event} do Path of Titans`,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
                        }
                    ]
                });
            }

            const webhook = await channel.createWebhook({
                name: `PoT ${logConfig.name.split(' ')[0]} Logger`,
                reason: `Webhook para logs de ${logConfig.event}`
            });

            PoTConfigSystem.setWebhookForEvent(guildId, event, webhook.url);

            return { 
                success: true, 
                channel, 
                webhook,
                url: webhook.url
            };

        } catch (error) {
            console.error(`❌ [WebhookSystem] Erro ao criar webhook para ${event}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Testa um webhook específico
     */
    static async testWebhook(guildId, event, interaction) {
        try {
            const webhookUrl = PoTConfigSystem.getWebhookForEvent(guildId, event);
            
            if (!webhookUrl) {
                return { success: false, message: '❌ Nenhum webhook configurado para este evento.' };
            }

            const fetch = require('node-fetch');
            
            const testMessage = {
                content: `🧪 **Teste de Webhook**\nEvento: ${event}\nServidor: ${interaction.guild.name}\nHorário: ${new Date().toLocaleString('pt-BR')}\n\n✅ Webhook está funcionando corretamente!`
            };

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testMessage)
            });

            if (response.ok) {
                return { success: true, message: '✅ Webhook testado com sucesso! Mensagem enviada.' };
            } else {
                const errorText = await response.text();
                return { success: false, message: `❌ Erro ao testar webhook: ${response.status} - ${errorText}` };
            }

        } catch (error) {
            console.error(`❌ [WebhookSystem] Erro ao testar webhook ${event}:`, error);
            return { success: false, message: `❌ Erro ao testar webhook: ${error.message}` };
        }
    }

    /**
     * Remove um webhook específico
     */
    static async removeWebhook(guildId, event, interaction) {
        try {
            const webhookUrl = PoTConfigSystem.getWebhookForEvent(guildId, event);
            
            if (!webhookUrl) {
                return { success: false, message: '❌ Nenhum webhook configurado para este evento.' };
            }

            PoTConfigSystem.removeWebhook(guildId, event);

            try {
                const urlParts = webhookUrl.split('/');
                const webhookId = urlParts[urlParts.length - 2];
                const webhookToken = urlParts[urlParts.length - 1];
                
                const fetch = require('node-fetch');
                await fetch(`https://discord.com/api/v10/webhooks/${webhookId}/${webhookToken}`, {
                    method: 'DELETE'
                });
            } catch (deleteError) {
                console.warn(`⚠️ [WebhookSystem] Não foi possível deletar webhook do Discord:`, deleteError.message);
            }

            return { success: true, message: `✅ Webhook para **${event}** removido com sucesso!` };

        } catch (error) {
            console.error(`❌ [WebhookSystem] Erro ao remover webhook ${event}:`, error);
            return { success: false, message: `❌ Erro ao remover webhook: ${error.message}` };
        }
    }

    /**
     * Gera a configuração do Game.ini
     */
    static getGameIniConfig(guildId) {
        const publicDomain = process.env.POT_PUBLIC_URL || 'https://api.seubot.com';
        let token = PoTTokenManager.getToken(guildId);
        
        if (!token) {
            token = PoTTokenManager.generateToken(guildId);
        }

        const lines = [
            '[ServerWebhooks]',
            'bEnabled=true',
            'Format="General"',
            ''
        ];

        for (const log of LOG_CHANNELS) {
            lines.push(`${log.endpoint}="${publicDomain}/pot/${log.event}?token=${token}"`);
        }

        return lines.join('\n');
    }

    /**
     * Verifica se um webhook está configurado
     */
    static isWebhookConfigured(guildId, event) {
        const url = PoTConfigSystem.getWebhookForEvent(guildId, event);
        return !!url && url.trim() !== '';
    }

    /**
     * Obtém o status de todos os webhooks
     */
    static getAllWebhookStatus(guildId) {
        const status = {};
        for (const log of LOG_CHANNELS) {
            status[log.event] = {
                configured: this.isWebhookConfigured(guildId, log.event),
                url: PoTConfigSystem.getWebhookForEvent(guildId, log.event) || null
            };
        }
        return status;
    }

    // ==================== CONTAINERS VISUAIS ====================

    /**
     * Gera o container do painel completo de webhooks
     */
    static getLogsPanelContainer(guildId, guildName, page = 0, itemsPerPage = 5) {
        const status = this.getAllWebhookStatus(guildId);
        const token = PoTTokenManager.getToken(guildId);
        const totalWebhooks = Object.values(status).filter(s => s.configured).length;
        const totalPages = Math.ceil(LOG_CHANNELS.length / itemsPerPage);

        const builder = new AdvancedContainerBuilder({ accentColor: 0xDCA15E });

        builder
            .title('📋 GERENCIADOR DE WEBHOOKS')
            .text('Gerencie os webhooks do seu servidor Path of Titans.')
            .separator()
            .text(`${EMOJIS.Status || '📊'} **Status:** ${totalWebhooks}/${LOG_CHANNELS.length} webhooks configurados`);

        if (token) {
            const maskedToken = token.length > 20 ? `${token.substring(0, 10)}...${token.substring(token.length - 6)}` : token;
            builder.text(`${EMOJIS.rcon || '🔑'} **Token Atual:** \`${maskedToken}\``);
        }

        builder.separator();

        const startIndex = page * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, LOG_CHANNELS.length);
        const currentEvents = LOG_CHANNELS.slice(startIndex, endIndex);

        for (const log of currentEvents) {
            const isConfigured = status[log.event]?.configured || false;
            const url = status[log.event]?.url || null;
            
            const sectionText = `${log.emoji} **${log.event.toUpperCase()}**`;
            
            const section = this._createSection(sectionText, log.description);
            builder.components.push({
                kind: 'section',
                payload: section
            });

            if (isConfigured && url) {
                const shortUrl = url.length > 50 ? `${url.substring(0, 47)}...` : url;
                builder.text(`✅ Configurado | 🔗 ${shortUrl}`);
                builder.buttons(
                    AdvancedContainerBuilder.primaryButton(
                        `${CUSTOM_IDS.TEST}_${log.event}_${guildId}`,
                        '🔄 Testar'
                    ),
                    AdvancedContainerBuilder.dangerButton(
                        `${CUSTOM_IDS.REMOVE}_${log.event}_${guildId}`,
                        '🗑️ Remover'
                    )
                );
            } else {
                builder.text('❌ Não configurado');
                builder.buttons(
                    AdvancedContainerBuilder.successButton(
                        `${CUSTOM_IDS.CREATE}_${log.event}_${guildId}`,
                        '📝 Criar'
                    )
                );
            }

            if (log !== currentEvents[currentEvents.length - 1]) {
                builder.separator();
            }
        }

        builder.separator();

        builder.buttons(
            AdvancedContainerBuilder.primaryButton(
                `${CUSTOM_IDS.GAMEINI}_${guildId}`,
                '📄 Gerar Game.ini'
            )
        );

        if (totalPages > 1) {
            builder.separator();
            const pageInfo = `📄 Página ${page + 1} de ${totalPages}`;
            builder.text(pageInfo);
        }

        builder.footer(`${guildName} • Use os botões para gerenciar os webhooks`);

        return builder;
    }

    /**
     * Cria uma section para o container
     */
    static _createSection(title, description) {
        return {
            text: `**${title}**\n${description}`,
            accessory: null
        };
    }

    // ==================== HANDLERS PARA INTERAÇÕES (USANDO CONTAINER) ====================

    /**
     * Handler para criar webhook
     */
    static async handleCreate(interaction, event) {
        try {
            const guildId = interaction.guildId;
            
            const config = PoTConfigSystem.getServerConfig(guildId);
            if (!config) {
                const builder = new AdvancedContainerBuilder({ accentColor: 0xFFA500 });
                builder
                    .title('❌ Servidor não configurado')
                    .text('Configure o servidor primeiro com `/potserver setup`')
                    .footer(interaction.guild.name);
                await interaction.editReply(builder.build());
                return;
            }

            let category = interaction.guild.channels.cache.find(
                c => c.name === '📊 PATH OF TITANS LOGS' && c.type === ChannelType.GuildCategory
            );

            if (!category) {
                category = await interaction.guild.channels.create({
                    name: '📊 PATH OF TITANS LOGS',
                    type: ChannelType.GuildCategory
                });
            }

            const result = await this.createWebhookForEvent(guildId, event, category.id, interaction);

            if (result.success) {
                const builder = new AdvancedContainerBuilder({ accentColor: 0x00FF00 });
                builder
                    .title('✅ Webhook Criado')
                    .text(`Webhook para **${event}** criado com sucesso!`)
                    .text(`📌 Canal: ${result.channel.name}`)
                    .footer(interaction.guild.name);
                await interaction.editReply(builder.build());

                // Reenviar o painel atualizado
                const panelBuilder = this.getLogsPanelContainer(guildId, interaction.guild.name);
                await interaction.followUp(panelBuilder.build());

            } else {
                const builder = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });
                builder
                    .title('❌ Erro ao criar webhook')
                    .text(`Erro: ${result.error}`)
                    .footer(interaction.guild.name);
                await interaction.editReply(builder.build());
            }

        } catch (error) {
            console.error('❌ [WebhookSystem] Erro no handleCreate:', error);
            const builder = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });
            builder
                .title('❌ Erro')
                .text(`Erro ao criar webhook: ${error.message}`)
                .footer(interaction.guild.name);
            await interaction.editReply(builder.build());
        }
    }

    /**
     * Handler para testar webhook
     */
    static async handleTest(interaction, event) {
        try {
            const guildId = interaction.guildId;
            
            const result = await this.testWebhook(guildId, event, interaction);

            const color = result.success ? 0x00FF00 : 0xFF0000;
            const builder = new AdvancedContainerBuilder({ accentColor: color });
            builder
                .title(result.success ? '✅ Teste Concluído' : '❌ Teste Falhou')
                .text(result.message)
                .footer(interaction.guild.name);
            await interaction.editReply(builder.build());

        } catch (error) {
            console.error('❌ [WebhookSystem] Erro no handleTest:', error);
            const builder = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });
            builder
                .title('❌ Erro')
                .text(`Erro ao testar webhook: ${error.message}`)
                .footer(interaction.guild.name);
            await interaction.editReply(builder.build());
        }
    }

    /**
     * Handler para remover webhook
     */
    static async handleRemove(interaction, event) {
        try {
            const guildId = interaction.guildId;
            
            const result = await this.removeWebhook(guildId, event, interaction);

            if (result.success) {
                const builder = new AdvancedContainerBuilder({ accentColor: 0x00FF00 });
                builder
                    .title('✅ Webhook Removido')
                    .text(result.message)
                    .footer(interaction.guild.name);
                await interaction.editReply(builder.build());

                // Reenviar o painel atualizado
                const panelBuilder = this.getLogsPanelContainer(guildId, interaction.guild.name);
                await interaction.followUp(panelBuilder.build());

            } else {
                const builder = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });
                builder
                    .title('❌ Erro ao remover webhook')
                    .text(result.message)
                    .footer(interaction.guild.name);
                await interaction.editReply(builder.build());
            }

        } catch (error) {
            console.error('❌ [WebhookSystem] Erro no handleRemove:', error);
            const builder = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });
            builder
                .title('❌ Erro')
                .text(`Erro ao remover webhook: ${error.message}`)
                .footer(interaction.guild.name);
            await interaction.editReply(builder.build());
        }
    }

    /**
     * Handler para gerar Game.ini
     */
    static async handleGameIni(interaction) {
        try {
            const guildId = interaction.guildId;
            
            const config = this.getGameIniConfig(guildId);
            const token = PoTTokenManager.getToken(guildId);

            const builder = new AdvancedContainerBuilder({ accentColor: 0x00AAFF });
            
            builder
                .title('📄 Configuração para Game.ini')
                .text('Copie e cole estas configurações no arquivo `Game.ini` do seu servidor.')
                .separator()
                .text('```ini\n' + config + '\n```')
                .separator()
                .text(`🔑 **Token:** \`${token}\``)
                .text('⚠️ **Importante:** Substitua `https://api.seubot.com` pelo seu domínio/IP público')
                .text('📌 **Exemplo:** `http://192.168.1.100:8080`')
                .separator()
                .text('💡 **Dica:** O servidor PoT precisa conseguir acessar esta URL!')
                .footer(interaction.guild.name);

            await interaction.editReply(builder.build());

        } catch (error) {
            console.error('❌ [WebhookSystem] Erro no handleGameIni:', error);
            const builder = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });
            builder
                .title('❌ Erro')
                .text(`Erro ao gerar Game.ini: ${error.message}`)
                .footer(interaction.guild.name);
            await interaction.editReply(builder.build());
        }
    }

    /**
     * Obtém o container do painel com paginação
     */
    static getPaginatedPanelContainer(guildId, guildName, page = 0) {
        return this.getLogsPanelContainer(guildId, guildName, page, 5);
    }
}

// ==================== EXPORTAR CONSTANTES PARA O INTERACTION HANDLER ====================
module.exports = {
    PoTWebhookSystem,
    CUSTOM_IDS,
    LOG_CHANNELS
};