// src/systems/support/supportChatSystem.js
/**
 * Fluxo de atendimento/suporte pessoal do desenvolvedor — painel com
 * instruções > botão (idioma) > modal > thread privada > atendimento >
 * fechar/bloquear. Ativo SÓ no servidor SUPPORT_GUILD_ID (ver
 * src/commands/developer/suportchat.js, que posta o painel lá).
 *
 * Diferente do ReportChatSystem (src/systems/moderation/reportChatSystem.js),
 * que serve para reportes de jogador dentro de cada servidor de cliente,
 * este fluxo é: sem tabela no banco (nada aqui precisa ser listado,
 * paginado ou reaberto — a própria thread é o registro), sem DM, sem
 * painel de staff — só menciona DEVELOPER_ID na abertura da thread com as
 * respostas do modal.
 *
 * O painel é sempre enviado pelo bot PRINCIPAL (ver suportchat.js), nunca
 * pelo bot de developer — só assim os cliques de botão/modal chegam no
 * interactionCreate.js do bot principal, que já suporta esse fluxo (o bot
 * de developer só processa slash commands, ver src/systems/core/devBot.js).
 */
const {
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const SUPPORT_GUILD_ID = '430534418818400266';
const DEVELOPER_ID = '203676076189286412';

const TEXT = {
    pt: {
        flagEmoji: '🇧🇷',
        buttonLabel: 'Português',
        modalTitle: 'Abrir Atendimento',
        field1Label: 'Você procura suporte ou adquirir o premium?',
        field1Desc: 'Nos diga o motivo principal do seu contato.',
        field1Placeholder: 'Ex: Suporte com um bug / Quero comprar o Caçador',
        field2Label: 'Qual o nome e ID do seu servidor?',
        field2Desc: 'Clique com botão direito no servidor > Copiar ID.',
        field2Placeholder: 'Ex: Titan\'s Pass HQ - 430534418818400266',
        field3Label: 'Você é o dono ou representante do servidor?',
        field3Desc: 'Ajuda a confirmar quem pode decidir pelo servidor.',
        field3Placeholder: 'Ex: Sim, sou o dono / Não, sou apenas staff',
        field4Label: 'Fale mais sobre o seu pedido.',
        field4Desc: 'Quanto mais detalhes, mais rápido conseguimos ajudar.',
        field4Placeholder: 'Descreva sua dúvida, problema ou pedido...',
        threadTitle: 'NOVO ATENDIMENTO',
        threadIntro: 'foi aberto por',
        q1: 'Suporte ou Premium?',
        q2: 'Servidor (nome/ID)',
        q3: 'É dono/representante?',
        q4: 'Detalhes',
        closeButtonLabel: 'Fechar Atendimento',
        confirmationMsg: 'Atendimento aberto! A staff foi notificada.',
        closedMsg: 'Atendimento fechado.',
        deniedCloseMsg: 'Apenas o desenvolvedor pode fechar este atendimento.',
    },
    en: {
        flagEmoji: '🇺🇸',
        buttonLabel: 'English',
        modalTitle: 'Open a Ticket',
        field1Label: 'Support request or premium purchase?',
        field1Desc: 'Tell us the main reason for your contact.',
        field1Placeholder: 'Ex: Support with a bug / I want to buy Caçador',
        field2Label: "What's your server's name and ID?",
        field2Desc: 'Right-click the server icon > Copy Server ID.',
        field2Placeholder: "Ex: Titan's Pass HQ - 430534418818400266",
        field3Label: 'Owner or representative of the server?',
        field3Desc: 'Helps us confirm who can decide for the server.',
        field3Placeholder: 'Ex: Yes, I am the owner / No, just staff',
        field4Label: 'Tell us more about your request.',
        field4Desc: 'The more details, the faster we can help.',
        field4Placeholder: 'Describe your question, issue or request...',
        threadTitle: 'NEW TICKET',
        threadIntro: 'was opened by',
        q1: 'Support or Premium?',
        q2: 'Server (name/ID)',
        q3: 'Owner/representative?',
        q4: 'Details',
        closeButtonLabel: 'Close Ticket',
        confirmationMsg: 'Ticket opened! The staff has been notified.',
        closedMsg: 'Ticket closed.',
        deniedCloseMsg: 'Only the developer can close this ticket.',
    },
};

function resolveLang(lang) {
    return TEXT[lang] ? lang : 'pt';
}

/**
 * Container + botões do painel de instruções (fixado no canal escolhido
 * via /suportchat) — bilíngue, já que ainda não sabemos o idioma de quem
 * está lendo (a escolha só acontece no clique do botão).
 */
function buildPanelPayload() {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    builder.title(`${EMOJIS.ticket || '🎫'} Central de Atendimento`, 1);
    builder.separator();
    builder.text([
        '🇧🇷 **Português**',
        'Precisa de suporte ou quer adquirir o Premium? Clique no botão abaixo no seu idioma para abrir um atendimento privado com o desenvolvedor.',
        '',
        '🇺🇸 **English**',
        'Need support or want to purchase Premium? Click the button below in your language to open a private ticket with the developer.',
    ].join('\n'));
    builder.footerRaw("Titan's Pass — Atendimento");

    const ptButton = new ButtonBuilder()
        .setCustomId('suportchat:open:pt')
        .setLabel(TEXT.pt.buttonLabel)
        .setEmoji(TEXT.pt.flagEmoji)
        .setStyle(ButtonStyle.Secondary);

    const enButton = new ButtonBuilder()
        .setCustomId('suportchat:open:en')
        .setLabel(TEXT.en.buttonLabel)
        .setEmoji(TEXT.en.flagEmoji)
        .setStyle(ButtonStyle.Secondary);

    const { components, flags, files } = builder.build();
    return {
        components: [...components, new ActionRowBuilder().addComponents(ptButton, enButton)],
        flags: [flags],
        files,
    };
}

/**
 * Modal de abertura, localizado — o idioma vem do botão clicado
 * (suportchat:open:pt|en) e volta no customId (suportchat:modal:pt|en)
 * pra saber como montar a thread de resposta, sem precisar de sessão/banco.
 */
function getOpenModal(lang) {
    const t = TEXT[resolveLang(lang)];
    const modal = new ModalBuilder().setCustomId(`suportchat:modal:${resolveLang(lang)}`).setTitle(t.modalTitle);
    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel(t.field1Label)
            .setDescription(t.field1Desc)
            .setTextInputComponent(new TextInputBuilder().setCustomId('motivo').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(t.field1Placeholder)),
        new LabelBuilder()
            .setLabel(t.field2Label)
            .setDescription(t.field2Desc)
            .setTextInputComponent(new TextInputBuilder().setCustomId('servidor').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(t.field2Placeholder)),
        new LabelBuilder()
            .setLabel(t.field3Label)
            .setDescription(t.field3Desc)
            .setTextInputComponent(new TextInputBuilder().setCustomId('representante').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(t.field3Placeholder)),
        new LabelBuilder()
            .setLabel(t.field4Label)
            .setDescription(t.field4Desc)
            .setTextInputComponent(new TextInputBuilder().setCustomId('detalhes').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder(t.field4Placeholder))
    );
    return modal;
}

/**
 * Cria a thread privada de atendimento no canal onde o painel foi clicado,
 * menciona DEVELOPER_ID com as respostas do modal (sem DM, sem painel de
 * staff separado — só essa mensagem), e responde a interação (ephemeral)
 * confirmando pro usuário.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {string} lang - 'pt' ou 'en'
 * @param {{motivo: string, servidor: string, representante: string, detalhes: string}} data
 */
async function openTicket(interaction, lang, data) {
    const t = TEXT[resolveLang(lang)];
    const { channel, user } = interaction;

    const threadName = `🎫-suporte-${user.username}`.toLowerCase().replace(/[^a-z0-9\-]/g, '-').slice(0, 90);

    const thread = await channel.threads.create({
        name: threadName,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Atendimento aberto por ${user.tag}`,
    });
    await thread.members.add(user.id).catch(() => {});
    await thread.members.add(DEVELOPER_ID).catch(() => {});

    const threadBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    threadBuilder.title(`${EMOJIS.ticket || '🎫'} ${t.threadTitle}`, 1);
    threadBuilder.text(`<@${DEVELOPER_ID}> — atendimento ${t.threadIntro} ${user}.`);
    threadBuilder.separator();
    threadBuilder.text(`**${t.q1}**\n${data.motivo}`);
    threadBuilder.text(`**${t.q2}**\n${data.servidor}`);
    threadBuilder.text(`**${t.q3}**\n${data.representante}`);
    threadBuilder.text(`**${t.q4}**\n${data.detalhes}`);
    threadBuilder.footerRaw("Titan's Pass — Atendimento");

    const closeButton = new ButtonBuilder()
        .setCustomId('suportchat:close')
        .setLabel(t.closeButtonLabel)
        .setEmoji(EMOJIS.lock || '🔒')
        .setStyle(ButtonStyle.Danger);

    const { components, flags, files } = threadBuilder.build();
    // Deduplicado: se o próprio developer abrir o atendimento (self-test),
    // user.id === DEVELOPER_ID e a Discord API rejeita ids repetidos em
    // allowed_mentions.users com 50035 "Invalid Form Body".
    const mentionUserIds = [...new Set([DEVELOPER_ID, user.id])];
    await thread.send({
        components: [...components, new ActionRowBuilder().addComponents(closeButton)],
        flags: [flags],
        files,
        allowedMentions: { users: mentionUserIds },
    });

    await interaction.editReply({
        content: `${EMOJIS.circlecheck || '✅'} ${t.confirmationMsg} ${thread.url}`,
        flags: [MessageFlags.Ephemeral],
    });
}

/**
 * Fecha/bloqueia a thread de atendimento — só DEVELOPER_ID pode (mesmo
 * padrão dos outros comandos de developer: gate por ID, não por cargo,
 * já que esse fluxo é pessoal do dono, sem staff intermediária).
 *
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function closeTicket(interaction) {
    const t = TEXT.pt;
    const tEn = TEXT.en;

    if (interaction.user.id !== DEVELOPER_ID) {
        await interaction.editReply({
            content: `${EMOJIS.circlealert || '❌'} ${t.deniedCloseMsg} / ${tEn.deniedCloseMsg}`,
            flags: [MessageFlags.Ephemeral],
        });
        return;
    }

    const thread = interaction.channel;
    await thread.send({
        content: `${EMOJIS.lock || '🔒'} ${t.closedMsg} / ${tEn.closedMsg} (${interaction.user})`,
        allowedMentions: { users: [] },
    }).catch(() => {});
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true).catch(() => {});

    await interaction.editReply({
        content: `${EMOJIS.circlecheck || '✅'} ${t.closedMsg}`,
        flags: [MessageFlags.Ephemeral],
    });
}

module.exports = {
    SUPPORT_GUILD_ID,
    DEVELOPER_ID,
    buildPanelPayload,
    getOpenModal,
    openTicket,
    closeTicket,
};
