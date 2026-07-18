// src/commands/developer/suportchat.js
/**
 * Posta o painel de atendimento/suporte (ver src/systems/support/
 * supportChatSystem.js) num canal do servidor pessoal do dono
 * (SUPPORT_GUILD_ID, hardcoded — este fluxo nunca deve rodar em outro
 * servidor). Só posta o painel: os cliques de botão/modal/thread que vêm
 * depois são tratados no interactionCreate.js do bot PRINCIPAL, não aqui
 * (o bot de developer só processa slash commands, ver
 * src/systems/core/devBot.js) — por isso o painel é sempre enviado
 * usando o client PRINCIPAL, nunca este client privado.
 */
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../database/index');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { SUPPORT_GUILD_ID, DEVELOPER_ID, buildPanelPayload } = require('../../systems/support/supportChatSystem');

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suportchat')
        .setDescription('🔒 Posta o painel de atendimento/suporte no servidor principal')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt.setName('canal')
            .setDescription('Canal onde o painel de atendimento será postado')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)),

    // client aqui é sempre o bot PRINCIPAL (já está no servidor de suporte) —
    // ver src/systems/core/devBot.js.
    async execute(interaction, client) {
        const { user, options } = interaction;

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(null, user.id, 'suportchat_denied', null, { command: 'suportchat' });
            const denied = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Este comando é restrito ao desenvolvedor do bot.`)
                .footer('Bot de Developer');
            const { components, flags } = denied.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        try {
            const guild = client.guilds.cache.get(SUPPORT_GUILD_ID);
            if (!guild) {
                const errBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                    .text(`${EMOJIS.circlealert || '❌'} O bot principal não está no servidor de suporte configurado.`)
                    .footer('Bot de Developer');
                const { components, flags } = errBuilder.build();
                await interaction.editReply({ components, flags: [flags] });
                return;
            }

            const channelOption = options.getChannel('canal');
            const channel = await client.channels.fetch(channelOption.id).catch(() => null);
            if (!channel || channel.guildId !== SUPPORT_GUILD_ID) {
                const errBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                    .text(`${EMOJIS.circlealert || '❌'} Canal inválido — precisa ser um canal do servidor de suporte.`)
                    .footer('Bot de Developer');
                const { components, flags } = errBuilder.build();
                await interaction.editReply({ components, flags: [flags] });
                return;
            }

            const payload = buildPanelPayload();
            await channel.send(payload);

            db.logActivity(null, user.id, 'suportchat_panel_posted', null, { command: 'suportchat', channelId: channel.id });

            const successBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS })
                .text(`${EMOJIS.circlecheck || '✅'} Painel de atendimento postado em ${channel}.`)
                .footer('Bot de Developer');
            const { components, flags } = successBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
        } catch (error) {
            console.error('❌ Erro ao postar painel de suportchat:', error);

            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');

            db.logActivity(null, user.id, 'error', null, { command: 'suportchat', error: error.message });

            const errorBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`# ${EMOJIS.circlealert || '❌'} ERRO AO POSTAR PAINEL\n\`${error.message?.slice(0, 150) || 'Desconhecido'}\``)
                .footer('Bot de Developer');
            const { components, flags } = errorBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
        }
    },
};
