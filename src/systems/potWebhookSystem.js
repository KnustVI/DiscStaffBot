/**
 * potWebhookSystem.js
 */

const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const PoTConfigSystem = require('./potConfigSystem');
const PoTTokenManager = require('../integrations/pathoftitans/tokenManager');
const { AdvancedContainerBuilder } = require('../utils/containerBuilder');

// Carregar emojis
let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

// ==================== CONFIGURAÇÃO DOS EVENTOS ====================

const LOG_CHANNELS = [
    { name: '📥 login', event: 'login', endpoint: 'PlayerLogin', description: '🔐 Controle de entrada e saída de jogadores', emoji: '📥' },
    { name: '💀 killed', event: 'killed', endpoint: 'PlayerKilled', description: '⚔️ Registro de mortes entre jogadores', emoji: '💀' },
    { name: '💬 chat', event: 'chat', endpoint: 'PlayerChat', description: '💬 Mensagens do chat global', emoji: '💬' },
    { name: '👥 group', event: 'group', endpoint: 'PlayerJoinedGroup', description: '👥 Formação e saída de grupos', emoji: '👥' },
    { name: '🪺 nest', event: 'nest', endpoint: 'CreateNest', description: '🪺 Criação e destruição de ninhos', emoji: '🪺' },
    { name: '📜 quest', event: 'quest', endpoint: 'PlayerQuestComplete', description: '📜 Progresso de missões (completo/falha)', emoji: '📜' },
    { name: '🔄 respawn', event: 'respawn', endpoint: 'PlayerRespawn', description: '🔄 Reviver jogadores', emoji: '🔄' },
    { name: '✨ waystone', event: 'waystone', endpoint: 'PlayerWaystone', description: '✨ Uso de pedras de teletransporte', emoji: '✨' },
    { name: '⚡ command', event: 'command', endpoint: 'PlayerCommand', description: '⚡ Comandos de jogadores (prefixo !)', emoji: '⚡' },
    { name: '👑 admin', event: 'admin_command', endpoint: 'AdminCommand', description: '👑 Comandos administrativos', emoji: '👑' },
    { name: '⚠️ error', event: 'error', endpoint: 'ServerError', description: '⚠️ Erros e alertas do servidor', emoji: '⚠️' }
];

class PoTWebhookSystem {

    static async createWebhookForEvent(guildId, event, categoryId, interaction) {
        try {
            const guild = interaction.guild;

            const logConfig = LOG_CHANNELS.find(l => l.event === event);
            if (!logConfig) return { success: false, error: 'Evento não encontrado' };

            const existingUrl = PoTConfigSystem.getWebhookForEvent(guildId, event);
            if (existingUrl) return { success: false, error: 'Webhook já configurado para este evento' };

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

            return { success: true, channel, webhook, url: webhook.url };

        } catch (error) {
            console.error(`❌ [WebhookSystem] Erro ao criar webhook:`, error);
            return { success: false, error: error.message };
        }
    }

    static async testWebhook(guildId, event, interaction) {
        try {
            const webhookUrl = PoTConfigSystem.getWebhookForEvent(guildId, event);
            if (!webhookUrl) return { success: false, message: '❌ Nenhum webhook configurado para este evento.' };

            const fetch = require('node-fetch');

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `🧪 Teste de Webhook\nEvento: ${event}\nServidor: ${interaction.guild.name}`
                })
            });

            if (response.ok) {
                return { success: true, message: '✅ Webhook testado com sucesso!' };
            }

            const text = await response.text();
            return { success: false, message: `❌ Erro: ${response.status} - ${text}` };

        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    static async removeWebhook(guildId, event) {
        try {
            const webhookUrl = PoTConfigSystem.getWebhookForEvent(guildId, event);
            if (!webhookUrl) return { success: false, message: '❌ Nenhum webhook configurado.' };

            PoTConfigSystem.removeWebhook(guildId, event);

            try {
                const parts = webhookUrl.split('/');
                const id = parts[parts.length - 2];
                const token = parts[parts.length - 1];

                const fetch = require('node-fetch');
                await fetch(`https://discord.com/api/v10/webhooks/${id}/${token}`, {
                    method: 'DELETE'
                });
            } catch {}

            return { success: true, message: `✅ Webhook ${event} removido` };

        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    static getGameIniConfig(guildId) {
        const domain = process.env.POT_PUBLIC_URL || 'https://api.seubot.com';
        let token = PoTTokenManager.getToken(guildId);

        if (!token) token = PoTTokenManager.generateToken(guildId);

        const lines = [
            '[ServerWebhooks]',
            'bEnabled=true',
            'Format="General"',
            ''
        ];

        for (const log of LOG_CHANNELS) {
            lines.push(`${log.endpoint}="${domain}/pot/${log.event}?token=${token}"`);
        }

        return lines.join('\n');
    }

    static getAllWebhookStatus(guildId) {
        const status = {};

        for (const log of LOG_CHANNELS) {
            const url = PoTConfigSystem.getWebhookForEvent(guildId, log.event);
            status[log.event] = {
                configured: !!url,
                url: url || null
            };
        }

        return status;
    }

    static getLogsPanelContainer(guildId, guildName, page = 0, itemsPerPage = 5) {
        const status = this.getAllWebhookStatus(guildId);
        const token = PoTTokenManager.getToken(guildId);

        const total = LOG_CHANNELS.length;
        const totalPages = Math.ceil(total / itemsPerPage);

        const builder = new AdvancedContainerBuilder({ accentColor: 0xDCA15E });

        builder
            .title(`${EMOJIS.link || '📋'} GERENCIADOR DE WEBHOOKS`)
            .text(`Status: ${Object.values(status).filter(s => s.configured).length}/${total}`)
            .separator();

        if (token) {
            const masked = token.length > 20 ? token.slice(0, 10) + '...' + token.slice(-6) : token;
            builder.text(`🔑 Token: \`${masked}\``);
        }

        const start = page * itemsPerPage;
        const slice = LOG_CHANNELS.slice(start, start + itemsPerPage);

        for (const log of slice) {
            const s = status[log.event];

            // ✅ FIX: era builder.section(...) sem acessório — Components V2
            // exige thumbnail OU botão em toda Section, senão a API rejeita
            // com "Invalid Form Body" (aparecia como "Received one or more
            // errors" no Discord). Texto simples não precisa de Section.
            builder.text(`${log.emoji} **${log.event.toUpperCase()}**\n${log.description}`);

            if (s.configured) {
                builder.text('✅ Configurado');
                builder.buttons(
                    AdvancedContainerBuilder.primaryButton(`pot_webhook_test_${log.event}_${guildId}`, '🔄 Testar'),
                    AdvancedContainerBuilder.dangerButton(`pot_webhook_remove_${log.event}_${guildId}`, '🗑️ Remover')
                );
            } else {
                builder.text('❌ Não configurado');
                builder.buttons(
                    AdvancedContainerBuilder.successButton(`pot_webhook_create_${log.event}_${guildId}`, '📝 Criar')
                );
            }

            builder.separator();
        }

        builder.buttons(
            AdvancedContainerBuilder.primaryButton(`pot_webhook_gameini_${guildId}`, '📄 Game.ini')
        );

        if (totalPages > 1) {
            builder.text(`Página ${page + 1}/${totalPages}`);
        }

        builder.footer(guildName);

        return builder;
    }

    static async handleCreate(interaction, event) {
        try {
            const guildId = interaction.guildId;

            const config = PoTConfigSystem.getServerConfig(guildId);
            if (!config) {
                const b = new AdvancedContainerBuilder({ accentColor: 0xFFA500 });
                b.title('❌ Erro').text('Servidor não configurado').footer(interaction.guild.name);

                const payload = b.build();
                payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
                return interaction.editReply(payload);
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

            const b = new AdvancedContainerBuilder({
                accentColor: result.success ? 0x00FF00 : 0xFF0000
            });

            b.title(result.success ? '✅ Criado' : '❌ Erro')
                .text(result.success ? 'Webhook criado' : result.error)
                .footer(interaction.guild.name);

            const payload = b.build();
            payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

            await interaction.editReply(payload);

        } catch (error) {
            const b = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });
            b.title('❌ Erro').text(error.message).footer(interaction.guild.name);

            const payload = b.build();
            payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

            await interaction.editReply(payload);
        }
    }

    static async handleTest(interaction, event) {
        const result = await this.testWebhook(interaction.guildId, event, interaction);

        const b = new AdvancedContainerBuilder({
            accentColor: result.success ? 0x00FF00 : 0xFF0000
        });

        b.title(result.success ? '✅ Teste OK' : '❌ Falhou')
            .text(result.message)
            .footer(interaction.guild.name);

        const payload = b.build();
        payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

        await interaction.editReply(payload);
    }

    static async handleRemove(interaction, event) {
        const result = await this.removeWebhook(interaction.guildId, event);

        const b = new AdvancedContainerBuilder({
            accentColor: result.success ? 0x00FF00 : 0xFF0000
        });

        b.title(result.success ? '✅ Removido' : '❌ Erro')
            .text(result.message)
            .footer(interaction.guild.name);

        const payload = b.build();
        payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

        await interaction.editReply(payload);
    }

    static async handleGameIni(interaction) {
        const config = this.getGameIniConfig(interaction.guildId);

        const b = new AdvancedContainerBuilder({ accentColor: 0x00AAFF });

        b.title('📄 Game.ini')
            .text('```ini\n' + config + '\n```')
            .footer(interaction.guild.name);

        const payload = b.build();
        payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

        await interaction.editReply(payload);
    }
}

module.exports = PoTWebhookSystem;