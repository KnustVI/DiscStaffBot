/**
 * potWebhookSystem.js
 *
 * Painel de gerenciamento de Webhooks/Canais de Log do Path of Titans.
 *
 * Funciona no padrão "controle remoto": cada clique de botão redesenha
 * a MESMA mensagem (editReply), sem depender de collector com timeout.
 * O roteamento vem do interactionCreate.js (customId prefixo `pot_webhook:`),
 * por isso o painel funciona indefinidamente, mesmo após restart do bot.
 */

const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const PoTConfigSystem = require('./potConfigSystem');
const PoTTokenManager = require('../integrations/pathoftitans/tokenManager');
const { AdvancedContainerBuilder } = require('../utils/containerBuilder');

let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const CATEGORY_NAME = '📊 PATH OF TITANS LOGS';
const ITEMS_PER_PAGE = 3; // limite seguro de Components V2 por Container
const FALLBACK_ICON = 'https://cdn.discordapp.com/embed/avatars/0.png';

const LOG_CHANNELS = [
    { name: '📥 login', event: 'login', endpoint: 'PlayerLogin', description: '🔐 Controle de entrada e saída de jogadores' },
    { name: '💀 killed', event: 'killed', endpoint: 'PlayerKilled', description: '⚔️ Registro de mortes entre jogadores' },
    { name: '💬 chat', event: 'chat', endpoint: 'PlayerChat', description: '💬 Mensagens do chat global' },
    { name: '👥 group', event: 'group', endpoint: 'PlayerJoinedGroup', description: '👥 Formação e saída de grupos' },
    { name: '🪺 nest', event: 'nest', endpoint: 'CreateNest', description: '🪺 Criação e destruição de ninhos' },
    { name: '📜 quest', event: 'quest', endpoint: 'PlayerQuestComplete', description: '📜 Progresso de missões (completo/falha)' },
    { name: '🔄 respawn', event: 'respawn', endpoint: 'PlayerRespawn', description: '🔄 Reviver jogadores' },
    { name: '✨ waystone', event: 'waystone', endpoint: 'PlayerWaystone', description: '✨ Uso de pedras de teletransporte' },
    { name: '⚡ command', event: 'command', endpoint: 'PlayerCommand', description: '⚡ Comandos de jogadores (prefixo !)' },
    { name: '👑 admin_command', event: 'admin_command', endpoint: 'AdminCommand', description: '👑 Comandos administrativos' },
    { name: '⚠️ error', event: 'error', endpoint: 'ServerError', description: '⚠️ Erros e alertas do servidor' }
];

class PoTWebhookSystem {

    // ==================== CRIAÇÃO ====================

    static async getOrCreateCategory(guild) {
        let category = guild.channels.cache.find(
            c => c.name === CATEGORY_NAME && c.type === ChannelType.GuildCategory
        );
        if (!category) {
            category = await guild.channels.create({ name: CATEGORY_NAME, type: ChannelType.GuildCategory });
        }
        return category;
    }

    static async createWebhookForEvent(guildId, event, categoryId, interaction) {
        try {
            const guild = interaction.guild;
            const logConfig = LOG_CHANNELS.find(l => l.event === event);
            if (!logConfig) return { success: false, error: 'Evento não encontrado' };

            const existingUrl = PoTConfigSystem.getWebhookForEvent(guildId, event);
            if (existingUrl) return { success: false, error: 'Webhook já configurado para este evento' };

            let channel = guild.channels.cache.find(
                c => c.name === logConfig.name && c.type === ChannelType.GuildText && c.parentId === categoryId
            );

            if (!channel) {
                channel = await guild.channels.create({
                    name: logConfig.name,
                    type: ChannelType.GuildText,
                    parent: categoryId,
                    topic: `📊 Webhook bruto de ${logConfig.event} do Path of Titans`,
                    permissionOverwrites: [
                        { id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }
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

    static async createLogChannelForEvent(guildId, event, categoryId, interaction) {
        try {
            const existing = PoTConfigSystem.getLogChannelForEvent(guildId, event);
            if (existing) return { success: false, error: 'Canal de log já existe para este evento' };

            const logConfig = LOG_CHANNELS.find(l => l.event === event);
            const channel = await interaction.guild.channels.create({
                name: logConfig ? logConfig.name : `log-${event}`,
                type: ChannelType.GuildText,
                parent: categoryId,
                topic: `📊 Logs traduzidos de ${event} do Path of Titans (postados pelo bot)`
            });

            PoTConfigSystem.setLogChannelForEvent(guildId, event, channel.id);
            return { success: true, channel };
        } catch (error) {
            console.error(`❌ [WebhookSystem] Erro ao criar canal de log:`, error);
            return { success: false, error: error.message };
        }
    }

    static async testWebhook(guildId, event, interaction) {
        try {
            const webhookUrl = PoTConfigSystem.getWebhookForEvent(guildId, event);
            if (!webhookUrl) return { success: false, message: 'Nenhum webhook configurado para este evento.' };

            const fetch = require('node-fetch');
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: `🧪 Teste de Webhook | Evento: ${event} | Servidor: ${interaction.guild.name}` })
            });

            if (response.ok) return { success: true, message: 'Webhook testado com sucesso!' };
            const text = await response.text();
            return { success: false, message: `Erro ${response.status}: ${text}` };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    static async removeWebhook(guildId, event) {
        try {
            const webhookUrl = PoTConfigSystem.getWebhookForEvent(guildId, event);
            if (!webhookUrl) return { success: false, message: 'Nenhum webhook configurado.' };

            PoTConfigSystem.removeWebhook(guildId, event);

            try {
                const parts = webhookUrl.split('/');
                const id = parts[parts.length - 2];
                const token = parts[parts.length - 1];
                const fetch = require('node-fetch');
                await fetch(`https://discord.com/api/v10/webhooks/${id}/${token}`, { method: 'DELETE' });
            } catch {}

            return { success: true, message: `Webhook ${event} removido` };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    static getGameIniConfig(guildId) {
        const domain = process.env.POT_PUBLIC_URL || 'https://api.seubot.com';
        let token = PoTTokenManager.getToken(guildId);
        if (!token) token = PoTTokenManager.generateToken(guildId);

        const lines = ['[ServerWebhooks]', 'bEnabled=true', 'Format="General"', ''];
        for (const log of LOG_CHANNELS) {
            lines.push(`${log.endpoint}="${domain}/pot/${log.event}?token=${token}"`);
        }
        return lines.join('\n');
    }

    static getAllWebhookStatus(guildId) {
        const status = {};
        for (const log of LOG_CHANNELS) {
            const url = PoTConfigSystem.getWebhookForEvent(guildId, log.event);
            status[log.event] = { configured: !!url, url: url || null };
        }
        return status;
    }

    // ==================== PAINEL (CONTROLE REMOTO) ====================

    /**
     * Monta o payload COMPLETO do painel (Container + linhas externas),
     * já pronto pra enviar via editReply/reply.
     */
    static buildPanelPayload(interaction, page = 0) {
        const guildId = interaction.guildId;
        const guildName = interaction.guild?.name || 'Servidor';
        const guildIconUrl = interaction.guild?.iconURL({ size: 128 }) || FALLBACK_ICON;

        const webhookStatus = this.getAllWebhookStatus(guildId);
        const logChannels = PoTConfigSystem.getAllLogChannels(guildId);

        const total = LOG_CHANNELS.length;
        const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
        const safePage = Math.min(Math.max(page, 0), totalPages - 1);
        const start = safePage * ITEMS_PER_PAGE;
        const slice = LOG_CHANNELS.slice(start, start + ITEMS_PER_PAGE);

        const webhooksConfigured = Object.values(webhookStatus).filter(s => s.configured).length;
        const channelsConfigured = Object.keys(logChannels).length;

        const builder = new AdvancedContainerBuilder({ accentColor: 0xDCA15E });

        builder
            .title(`${EMOJIS.link || '📡'} GERENCIADOR DE WEBHOOKS`)
            .text('Aqui você gera os webhooks para o bot trazer informações do jogo até você. Você também pode criar um canal no Discord para receber essas informações já traduzidas, em tempo real.')
            .text(`📊 **Status:** ${webhooksConfigured}/${total} webhooks • ${channelsConfigured}/${total} canais de log`)
            .separator();

        for (const log of slice) {
            const s = webhookStatus[log.event];
            const channelId = logChannels[log.event];

            const webhookLine = s.configured ? '✅ Webhook configurado' : '❌ Webhook não configurado';
            const channelLine = channelId ? `📺 Canal: <#${channelId}>` : '📺 Canal de log não criado';

            builder.section(
                `# ${log.name}\n${log.description}\n${webhookLine}\n${channelLine}`,
                AdvancedContainerBuilder.thumbnail(guildIconUrl, log.event)
            );

            const rowButtons = [];
            if (s.configured) {
                rowButtons.push(AdvancedContainerBuilder.primaryButton(`pot_webhook:test:${log.event}:${guildId}:${safePage}`, '🔄 Testar'));
                rowButtons.push(AdvancedContainerBuilder.dangerButton(`pot_webhook:remove:${log.event}:${guildId}:${safePage}`, '🗑️ Remover'));
            } else {
                rowButtons.push(AdvancedContainerBuilder.successButton(`pot_webhook:create:${log.event}:${guildId}:${safePage}`, '📝 Criar Webhook'));
            }
            if (!channelId) {
                rowButtons.push(AdvancedContainerBuilder.secondaryButton(`pot_webhook:logchan:${log.event}:${guildId}:${safePage}`, '📺 Criar Canal de Log'));
            }
            builder.buttons(...rowButtons);
            builder.separator();
        }

        if (totalPages > 1) {
            builder.text(`📄 Página ${safePage + 1}/${totalPages}`);
        }
        builder.footer(guildName);

        const { components, flags } = builder.build();

        // ── Linhas EXTERNAS, fora do Container (sibling no array de components) ──
        const externalButtons = [
            AdvancedContainerBuilder.primaryButton(`pot_webhook:gameini:_:${guildId}:${safePage}`, '📄 Ver Game.ini'),
            AdvancedContainerBuilder.secondaryButton(`pot_webhook:channels:_:${guildId}:${safePage}`, '📺 Ver Canais Criados'),
        ];
        const { ActionRowBuilder } = require('discord.js');
        const externalRow = new ActionRowBuilder().addComponents(...externalButtons);

        const finalComponents = [...components, externalRow];

        if (totalPages > 1) {
            const navButtons = [];
            navButtons.push(
                AdvancedContainerBuilder.secondaryButton(`pot_webhook:page:_:${guildId}:${Math.max(0, safePage - 1)}`, '◀ Anterior')
                    .setDisabled(safePage === 0)
            );
            navButtons.push(
                AdvancedContainerBuilder.secondaryButton(`pot_webhook:page:_:${guildId}:${Math.min(totalPages - 1, safePage + 1)}`, 'Próxima ▶')
                    .setDisabled(safePage === totalPages - 1)
            );
            finalComponents.push(new ActionRowBuilder().addComponents(...navButtons));
        }

        return {
            components: finalComponents,
            flags: flags | MessageFlags.Ephemeral
        };
    }

    /**
     * Redesenha o painel na MESMA mensagem (padrão "controle remoto").
     * Chamado depois de toda ação (criar/testar/remover/etc).
     */
    static async renderPanel(interaction, page = 0) {
        const payload = this.buildPanelPayload(interaction, page);
        await interaction.editReply(payload);
    }

    /**
     * Feedback curto e efêmero (texto puro, sem Container), seguindo o
     * padrão de confirmação do projeto: emoji + bullet.
     */
    static async feedback(interaction, success, text) {
        const emoji = success ? '✅' : '❌';
        try {
            await interaction.followUp({ content: `${emoji} ${text}`, flags: MessageFlags.Ephemeral });
        } catch (err) {
            console.error('❌ [WebhookSystem] Erro ao enviar feedback:', err);
        }
    }

    // ==================== HANDLERS (chamados pelo interactionCreate.js) ====================

    static async handleCreate(interaction, event, guildId, page) {
        try {
            const config = PoTConfigSystem.getServerConfig(guildId);
            if (!config) {
                await this.feedback(interaction, false, 'Configure o servidor primeiro com `/potserver setup`.');
                return this.renderPanel(interaction, page);
            }

            const category = await this.getOrCreateCategory(interaction.guild);
            const result = await this.createWebhookForEvent(guildId, event, category.id, interaction);

            await this.feedback(
                interaction,
                result.success,
                result.success
                    ? `Webhook criado para **${event}**. Veja a URL em "📄 Ver Game.ini".`
                    : result.error
            );
        } catch (error) {
            await this.feedback(interaction, false, error.message);
        }
        await this.renderPanel(interaction, page);
    }

    static async handleTest(interaction, event, guildId, page) {
        const result = await this.testWebhook(guildId, event, interaction);
        await this.feedback(interaction, result.success, result.message);
        await this.renderPanel(interaction, page);
    }

    static async handleRemove(interaction, event, guildId, page) {
        const result = await this.removeWebhook(guildId, event);
        await this.feedback(interaction, result.success, result.message);
        await this.renderPanel(interaction, page);
    }

    static async handleCreateLogChannel(interaction, event, guildId, page) {
        try {
            const category = await this.getOrCreateCategory(interaction.guild);
            const result = await this.createLogChannelForEvent(guildId, event, category.id, interaction);

            await this.feedback(
                interaction,
                result.success,
                result.success ? `Canal de log criado: <#${result.channel.id}>` : result.error
            );
        } catch (error) {
            await this.feedback(interaction, false, error.message);
        }
        await this.renderPanel(interaction, page);
    }

    static async handleGameIni(interaction) {
        const config = this.getGameIniConfig(interaction.guildId);
        const b = new AdvancedContainerBuilder({ accentColor: 0x00AAFF });
        b.title('📄 Game.ini').text('```ini\n' + config + '\n```').footer(interaction.guild.name);

        const payload = b.build();
        payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
        await interaction.followUp(payload);
    }

    static async handleShowChannels(interaction) {
        const guildId = interaction.guildId;
        const channels = PoTConfigSystem.getAllLogChannels(guildId);
        const entries = Object.entries(channels);

        const b = new AdvancedContainerBuilder({ accentColor: 0x00AAFF });
        b.title('📺 Canais de Log Criados');

        if (entries.length === 0) {
            b.text('Nenhum canal de log criado ainda. Use o botão "📺 Criar Canal de Log" em cada evento do painel.');
        } else {
            for (const [event, channelId] of entries) {
                b.text(`**${event}:** <#${channelId}>`);
            }
        }
        b.footer(interaction.guild.name);

        const payload = b.build();
        payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
        await interaction.followUp(payload);
    }
}

module.exports = PoTWebhookSystem;