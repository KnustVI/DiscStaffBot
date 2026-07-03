/**
 * potWebhookSystem.js
 *
 * Painel de gerenciamento de Webhooks do Path of Titans.
 *
 * Padrão "controle remoto": cada botão redesenha a MESMA mensagem (editReply).
 * Roteado pelo interactionCreate.js via prefixo `pot_webhook:`.
 * Funciona indefinidamente — sem collector, sem timeout.
 */

const {
    MessageFlags,
    ModalBuilder,
    ActionRowBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const PoTConfigSystem = require('./potConfigSystem');
const PoTTokenManager = require('../integrations/pathoftitans/tokenManager');
const { AdvancedContainerBuilder } = require('../utils/containerBuilder');

const EVENT_GROUPS = PoTConfigSystem.EVENT_GROUPS;
const ITEMS_PER_PAGE = 3;
const FALLBACK_ICON = 'https://cdn.discordapp.com/embed/avatars/0.png';

let EMOJIS = {};
try { EMOJIS = require('../database/emojis.js').EMOJIS || {}; } catch (err) {}

class PoTWebhookSystem {

    // ==================== GAME.INI ====================

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

        for (const group of EVENT_GROUPS) {
            lines.push(`; ${group.name}`);
            for (const iniEvent of group.iniEvents) {
                // evt= permite ao gateway saber qual evento PoT específico chegou,
                // mesmo que vários eventos compartilhem a mesma rota de grupo.
                lines.push(`${iniEvent}="${domain}/pot/${group.route}?token=${token}&evt=${iniEvent}"`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    // ==================== TESTE DE WEBHOOK DISCORD ====================

    static async testDiscordWebhook(webhookUrl, guildName = 'Servidor') {
        try {
            const fetch = require('node-fetch');
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `🧪 **Teste de Webhook** — ${guildName} via Titan's Pass`
                })
            });
            if (response.ok) return { success: true };
            const text = await response.text();
            return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 100)}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ==================== MODAL DE CONFIGURAÇÃO ====================

    /**
     * Exibe o modal para o usuário colar a URL do webhook Discord.
     * Chamado ANTES de qualquer deferral — showModal é a primeira resposta.
     */
    static async handleShowConfigModal(interaction, groupId, guildId, page) {
        const group = EVENT_GROUPS.find(g => g.id === groupId);
        const existingUrl = PoTConfigSystem.getWebhookForGroup(guildId, groupId);

        const input = new TextInputBuilder()
            .setCustomId('webhook_url')
            .setLabel('URL do Webhook Discord')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://discord.com/api/webhooks/ID/TOKEN')
            .setRequired(true);

        if (existingUrl) input.setValue(existingUrl);

        const modal = new ModalBuilder()
            .setCustomId(`pot_webhook:url_modal:${groupId}:${guildId}:${page}`)
            .setTitle(`Webhook — ${group?.name || groupId}`)
            .addComponents(new ActionRowBuilder().addComponents(input));

        await interaction.showModal(modal);
    }

    /**
     * Processa o submit do modal de URL.
     * Valida → testa → salva → redesenha o painel.
     */
    static async handleUrlModalSubmit(interaction) {
        // customId: pot_webhook:url_modal:<groupId>:<guildId>:<page>
        const parts = interaction.customId.split(':');
        const groupId = parts[2];
        const guildId = parts[3];
        const page = parseInt(parts[4]) || 0;

        await interaction.deferReply({ flags: 64 });

        const webhookUrl = interaction.fields.getTextInputValue('webhook_url').trim();

        if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
            await interaction.editReply({
                content: [
                    '❌ URL inválida. Deve ser um webhook do Discord.',
                    'Como criar: **Canal → Configurações → Integrações → Criar Webhook → Copiar URL**'
                ].join('\n')
            });
            return;
        }

        const test = await this.testDiscordWebhook(webhookUrl, interaction.guild?.name);
        if (!test.success) {
            await interaction.editReply({ content: `❌ Webhook não respondeu: ${test.error}` });
            return;
        }

        PoTConfigSystem.setWebhookForGroup(guildId, groupId, webhookUrl);

        // Redesenha o painel com o novo estado
        const payload = this.buildPanelPayload(interaction, page);
        await interaction.editReply(payload);
    }

    // ==================== PAINEL (CONTROLE REMOTO) ====================

    static buildPanelPayload(interaction, page = 0) {
        const guildId = interaction.guildId;
        const guildName = interaction.guild?.name || 'Servidor';
        const guildIconUrl = interaction.guild?.iconURL({ size: 128 }) || FALLBACK_ICON;

        const groupWebhooks = PoTConfigSystem.getAllGroupWebhooks(guildId);
        const total = EVENT_GROUPS.length;
        const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
        const safePage = Math.min(Math.max(page, 0), totalPages - 1);
        const slice = EVENT_GROUPS.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);
        const configured = Object.keys(groupWebhooks).length;

        const builder = new AdvancedContainerBuilder({ accentColor: 0xDCA15E });

        builder
            .title(`${EMOJIS.wifi || '📡'} GERENCIADOR DE WEBHOOKS`)
            .text('Aqui você gera os webhooks para o bot trazer informações do jogo até você. Você também pode criar um canal no Discord para receber essas informações já traduzidas, em tempo real.')
            .text(`📊 **Status:** ${configured}/${total} grupos configurados`)
            .separator();

        for (const group of slice) {
            const webhookUrl = groupWebhooks[group.id];
            const isConfigured = !!webhookUrl;

            builder.section(
                [
                    `# ${group.name}`,
                    group.description,
                    isConfigured ? '✅ Webhook configurado' : '❌ Não configurado',
                    `-# Eventos: ${group.iniEvents.join(', ')}`
                ].join('\n'),
                AdvancedContainerBuilder.thumbnail(guildIconUrl, group.id)
            );

            if (isConfigured) {
                builder.buttons(
                    AdvancedContainerBuilder.secondaryButton(
                        `pot_webhook:config:${group.id}:${guildId}:${safePage}`, '✏️ Alterar'
                    ),
                    AdvancedContainerBuilder.primaryButton(
                        `pot_webhook:test:${group.id}:${guildId}:${safePage}`, '🔄 Testar'
                    ),
                    AdvancedContainerBuilder.dangerButton(
                        `pot_webhook:remove:${group.id}:${guildId}:${safePage}`, '🗑️ Remover'
                    )
                );
            } else {
                builder.buttons(
                    AdvancedContainerBuilder.successButton(
                        `pot_webhook:config:${group.id}:${guildId}:${safePage}`, '🔗 Configurar Webhook'
                    )
                );
            }

            builder.separator();
        }

        if (totalPages > 1) {
            builder.text(`📄 Página ${safePage + 1}/${totalPages}`);
        }
        builder.footer(guildName);

        const { components, flags } = builder.build();

        // Botões de info FORA do Container (sibling) — sempre visíveis
        const infoRow = new ActionRowBuilder().addComponents(
            AdvancedContainerBuilder.primaryButton(
                `pot_webhook:gameini:_:${guildId}:${safePage}`, '📄 Game.ini'
            ),
            AdvancedContainerBuilder.secondaryButton(
                `pot_webhook:webhooks:_:${guildId}:${safePage}`, '🔗 Ver Webhooks'
            )
        );

        const finalComponents = [...components, infoRow];

        // Navegação de página (só aparece quando há mais de uma página)
        if (totalPages > 1) {
            finalComponents.push(
                new ActionRowBuilder().addComponents(
                    AdvancedContainerBuilder.secondaryButton(
                        `pot_webhook:page:_:${guildId}:${Math.max(0, safePage - 1)}`, '◀ Anterior'
                    ).setDisabled(safePage === 0),
                    AdvancedContainerBuilder.secondaryButton(
                        `pot_webhook:page:_:${guildId}:${Math.min(totalPages - 1, safePage + 1)}`, 'Próxima ▶'
                    ).setDisabled(safePage === totalPages - 1)
                )
            );
        }

        return { components: finalComponents, flags: flags | MessageFlags.Ephemeral };
    }

    static async renderPanel(interaction, page = 0) {
        const payload = this.buildPanelPayload(interaction, page);
        await interaction.editReply(payload);
    }

    // ==================== HANDLERS ====================

    static async handleTest(interaction, groupId, guildId, page) {
        const webhookUrl = PoTConfigSystem.getWebhookForGroup(guildId, groupId);

        if (!webhookUrl) {
            await interaction.followUp({ content: '❌ Nenhum webhook configurado para este grupo.', flags: 64 });
        } else {
            const result = await this.testDiscordWebhook(webhookUrl, interaction.guild?.name);
            await interaction.followUp({
                content: result.success
                    ? '✅ Webhook testado com sucesso!'
                    : `❌ Falhou: ${result.error}`,
                flags: 64
            });
        }

        await this.renderPanel(interaction, page);
    }

    static async handleRemove(interaction, groupId, guildId, page) {
        PoTConfigSystem.removeWebhookForGroup(guildId, groupId);
        await interaction.followUp({ content: '✅ Webhook removido.', flags: 64 });
        await this.renderPanel(interaction, page);
    }

    static async handleGameIni(interaction) {
        const config = this.getGameIniConfig(interaction.guildId);
        const b = new AdvancedContainerBuilder({ accentColor: 0x00AAFF });

        b.title('📄 Game.ini')
            .text('Cole este conteúdo no arquivo `Game.ini` do seu servidor PoT.\nCaminho: `AldronGames/PathOfTitans/Saved/Config/LinuxServer/Game.ini`')
            .text('```ini\n' + config + '\n```')
            .footer(interaction.guild?.name || 'Servidor');

        await interaction.editReply(b.build());
    }

    static async handleShowWebhooks(interaction) {
        const guildId = interaction.guildId;
        const webhooks = PoTConfigSystem.getAllGroupWebhooks(guildId);
        const entries = Object.entries(webhooks);

        const b = new AdvancedContainerBuilder({ accentColor: 0x00AAFF });
        b.title('🔗 Webhooks Configurados');

        if (entries.length === 0) {
            b.text('Nenhum webhook configurado ainda.\nUse **🔗 Configurar Webhook** em cada grupo do painel.');
        } else {
            for (const [groupId, url] of entries) {
                const group = EVENT_GROUPS.find(g => g.id === groupId);
                // Mostra só o início da URL por segurança
                const masked = url.split('/').slice(0, 7).join('/') + '/...';
                b.text(`**${group?.name || groupId}**\n\`${masked}\``);
                b.separator();
            }
        }

        b.footer(interaction.guild?.name || 'Servidor');
        await interaction.editReply(b.build());
    }
}

module.exports = PoTWebhookSystem;