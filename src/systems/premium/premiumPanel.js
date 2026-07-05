// src/systems/premium/premiumPanel.js
/**
 * Painel público do /premium — "controle remoto" com 3 containers (main,
 * server, player), navegáveis pelos mesmos dois botões em qualquer um deles.
 * Roteado pelo InteractionHandler via prefixo `premium:` (customId
 * `premium:view:main|server|player`).
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const PremiumSystem = require('./premiumSystem');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const imageManager = require('../../utils/imageManager');

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

function formatExpiry(expiresAt) {
    return `<t:${Math.floor(expiresAt / 1000)}:R>`;
}

const TIER_LABELS = PremiumSystem.GUILD_TIER_DISPLAY;
const PLAYER_TIER_LABELS = { free: 'Free', compy: 'Compy', raptor: 'Raptor' };

// Ícones por "degrau" de tier (mesmo padrão visual pros dois planos: tier
// base/Free, tier médio, tier top) — TapejaraSkull e CarniSkull ainda
// dependem de `npm run sync-emojis` se ainda não tiverem sido sincronizados.
const TIER_ICON = {
    base: EMOJIS.HerbSkull || '🦴',
    medium: EMOJIS.TapejaraSkull || '🟡',
    top: EMOJIS.CarniSkull || '🔴',
};

// Banners de topo por tier de Server Premium (representam o tier ATUAL do
// servidor onde o /premium foi rodado) — assets banner_premium_server_*.
const SERVER_TIER_BANNER_KEYS = {
    free: 'banner_premium_server_free',
    pegada: 'banner_premium_server_rastreador',
    fossil: 'banner_premium_server_cacador',
};

/**
 * Banner de topo representando o tier ATUAL do servidor, no lugar do ícone
 * do servidor. Devolve os attachments extras que o chamador precisa
 * mesclar em payload.files (mesmo padrão do footer abaixo).
 */
function appendServerBanner(builder, guild) {
    const tier = PremiumSystem.getGuildTier(guild.id);
    const key = SERVER_TIER_BANNER_KEYS[tier] || SERVER_TIER_BANNER_KEYS.free;
    const url = imageManager.getUrl(key);
    const attachment = imageManager.getAttachment(key);
    if (!url) return [];
    builder.gallery([url]);
    builder.separator();
    return attachment ? [attachment] : [];
}

/**
 * Imagem de rodapé por tier de Player Premium (assets footer_free/compy/
 * raptor) — substitui o footer de texto ("Produzido por...") em todo
 * container do /premium. Usa o tier do jogador que rodou o comando.
 */
function appendFooterImage(builder, user) {
    const playerTier = PremiumSystem.getPlayerTier(user.id);
    const key = `footer_${playerTier}`;
    const url = imageManager.getUrl(key);
    const attachment = imageManager.getAttachment(key);
    if (!url) return [];
    builder.gallery([url]);
    return attachment ? [attachment] : [];
}

// ==================== SEÇÕES COMPARTILHADAS ====================

function appendStatus(builder, guild, user) {
    const guildInfo = PremiumSystem.getGuildPremiumInfo(guild.id);
    const playerInfo = PremiumSystem.getPlayerPremiumInfo(user.id);

    builder.title(`${EMOJIS.gauge || '📊'} Status`, 2);

    const lines = [
        `${EMOJIS.shield || '🛡️'} **Server Premium (${guild.name}):** ${TIER_LABELS[guildInfo.tier] || guildInfo.tier}` +
            (guildInfo.tier !== 'free' ? ` — expira: ${guildInfo.expires_at ? formatExpiry(guildInfo.expires_at) : 'Vitalício'}` : ''),
        `${EMOJIS.badge || '🏅'} **Seu Player Premium:** ${PLAYER_TIER_LABELS[playerInfo.tier] || playerInfo.tier}` +
            (playerInfo.tier !== 'free' ? ` — expira: ${playerInfo.expires_at ? formatExpiry(playerInfo.expires_at) : 'Vitalício'}` : ''),
    ];
    builder.block(lines);
    return builder;
}

function appendAcquire(builder) {
    builder.title(`${EMOJIS.wifi || '💬'} Como adquirir`, 2);
    builder.text(`${EMOJIS.messagesquare || 'ℹ️'} A concessão hoje é manual: fale com o desenvolvedor do bot (**/reportarbug**, opção Sugestão, ou contato direto) pra combinar o pagamento e ativar o tier. Uma forma automatizada de pagamento (Ko-fi) está a caminho.`);
    return builder;
}

function navRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('premium:view:main').setLabel('Status').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.gauge || '📊'),
        new ButtonBuilder().setCustomId('premium:view:server').setLabel('Server Premium').setStyle(ButtonStyle.Primary).setEmoji(EMOJIS.tv || '🖥️'),
        new ButtonBuilder().setCustomId('premium:view:player').setLabel('Player Premium').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.badge || '🏅'),
    );
}

// ==================== CONTAINER 1 — VISÃO GERAL ====================

function buildMainContainer(guild, user) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    const extraFiles = [];

    builder.text([
        '# PREMIUM — TITAN\'S PASS',
        'Dois planos independentes: um por jogador, outro por servidor. Use os botões abaixo pra ver os benefícios de cada um.',
    ].join('\n'));
    extraFiles.push(...appendServerBanner(builder, guild));

    appendStatus(builder, guild, user);
    builder.separator();
    appendAcquire(builder);

    builder.separator();
    extraFiles.push(...appendFooterImage(builder, user));
    return { builder, extraFiles };
}

// ==================== CONTAINER 2 — SERVER PREMIUM ====================

function buildServerContainer(guild, user) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    const extraFiles = [];

    builder.text([
        '# SERVER PREMIUM',
        'Plano por servidor Discord — melhora o atendimento e a moderação da comunidade.',
    ].join('\n'));
    extraFiles.push(...appendServerBanner(builder, guild));

    builder.title(`${TIER_ICON.base} Free`, 2);
    builder.block([
        '• Logs de sistemas.',
        '**Sistema básico de reporte:**',
        '• Limite de 1 chat de reporte.',
        '• Limite de 1 revisão de punição.',
        '• Tempo de espera de 1h para abrir chats.',
        '**Sistema básico de punição:**',
        '• Registros de punição.',
        '• Não aplica ações de punição como ban/kick/mute.',
        '**Sistema básico de eventos:**',
        '• Cria evento em fórum de forma padrão, com anexo de imagem.',
    ]);
    builder.separator();

    builder.title(`${TIER_ICON.medium} Rastreador — R$25/mês`, 2);
    builder.block([
        '**Tudo do Free +**',
        '• Logs de jogo.',
        '• Missões mensais do Titan\'s Pass ativadas. *(vindo em breve)*',
        '**Sistema médio de reporte:**',
        '• Limite de 3 chats de reporte.',
        '• Limite de 3 revisões de punição.',
        '• Sem tempo de espera!',
        '• Pontuação de reputação.',
        '**Sistema médio de punição:**',
        '• Cargo temporário de punição.',
        '• Até 5 níveis de punição configuráveis.',
        '• Não aplica ações de punição como ban/kick/mute.',
        '**Sistema médio de eventos:**',
        '• Cria eventos em fóruns.',
        '• Cria evento no Discord.',
        '• Marca jogadores com cargo selecionado.',
        `• ${EMOJIS.badge || '🏅'} **Bônus:** o dono do servidor ganha Player Premium **Compy** de graça.`,
    ]);
    builder.separator();

    builder.title(`${TIER_ICON.top} Caçador — R$40/mês`, 2);
    builder.block([
        '**Tudo do Rastreador +**',
        '• Análise de atividade de staff.',
        '• 1 missão mensal exclusiva do seu servidor. *(vindo em breve)*',
        '• Prioridade de suporte!',
        '**Sistema completo de reporte:**',
        '• Sem limite de chats.',
        '• Sem tempo de espera!',
        '• Resumo de logs dos possíveis envolvidos direto no chat de reporte. *(vindo em breve)*',
        '**Sistema completo de punição:**',
        '• Cargo temporário de punição.',
        '• Níveis de punição totalmente personalizados. *(vindo em breve — hoje ainda são os 5 níveis fixos configuráveis)*',
        '• Cargos de reputação automáticos.',
        '• Sistema de pontos de reputação.',
        '• Históricos de quebras de jogador.',
        '• Aplica punições em jogo ou Discord!',
        '**Sistema completo de eventos:**',
        '• Cria eventos em fórum.',
        '• Cria evento no Discord.',
        '• Anuncia criação, começo e fim do evento. *(vindo em breve)*',
        '• Pode ser configurado um botão de TP para o local do evento. *(vindo em breve)*',
        `• ${EMOJIS.badge || '🏅'} **Bônus:** o dono do servidor ganha Player Premium **Raptor** de graça.`,
    ]);
    builder.separator();

    appendStatus(builder, guild, user);
    builder.separator();
    appendAcquire(builder);

    builder.separator();
    extraFiles.push(...appendFooterImage(builder, user));
    return { builder, extraFiles };
}

// ==================== CONTAINER 3 — PLAYER PREMIUM ====================

function buildPlayerContainer(guild, user) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    const extraFiles = [];

    builder.section(
        [
            '# PLAYER PREMIUM',
            'Plano por jogador, global — vale em qualquer servidor com o bot.',
        ].join('\n'),
        AdvancedContainerBuilder.thumbnail(guild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
    );
    builder.separator();

    builder.title(`${TIER_ICON.base} Free`, 2);
    builder.block([
        '• Perfil sincronizado com Discord.',
        '• Server Badges. *(vindo em breve)*',
        '• Títulos de missões de servers. *(vindo em breve)*',
        '• Farme de caçadas por hora de jogo. *(vindo em breve)*',
    ]);
    builder.separator();

    builder.title(`${TIER_ICON.medium} Compy — R$10/mês`, 2);
    builder.block([
        '**Tudo do Free +**',
        '• Perfil personalizável pela loja. *(vindo em breve)*',
        '• Badge exclusivo. *(vindo em breve)*',
        '• Títulos exclusivos. *(vindo em breve)*',
        '• Boost de farm por troféu entregue. *(vindo em breve)*',
    ]);
    builder.separator();

    builder.title(`${TIER_ICON.top} Raptor — R$25/mês`, 2);
    builder.block([
        '**Tudo do Compy +**',
        '• Perfil 100% personalizável com suas próprias imagens: puxa do Discord automaticamente, ou envie o seu via `/perfil-banner`.',
        '• Boost de farm por missão Titan concluída. *(vindo em breve)*',
        '• Sorteio semanal de pacote de skins do Path of Titans. *(vindo em breve)*',
    ]);
    builder.separator();

    appendStatus(builder, guild, user);
    builder.separator();
    appendAcquire(builder);

    builder.separator();
    extraFiles.push(...appendFooterImage(builder, user));
    return { builder, extraFiles };
}

// ==================== ENVIO / NAVEGAÇÃO ====================

function payloadFor(view, guild, user) {
    const { builder, extraFiles } = view === 'server' ? buildServerContainer(guild, user)
        : view === 'player' ? buildPlayerContainer(guild, user)
        : buildMainContainer(guild, user);

    const { components, flags, files } = builder.build();
    return { components: [...components, navRow()], flags, files: [...(files || []), ...extraFiles] };
}

async function sendPanel(interaction, view = 'main') {
    const payload = payloadFor(view, interaction.guild, interaction.user);
    await interaction.editReply(payload);
}

async function handleComponent(interaction, action, param) {
    if (action !== 'view') {
        const unknownBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
            .text(`${EMOJIS.circlealert || '❌'} Ação desconhecida.`)
            .footer(interaction.guild?.name);
        return await interaction.editReply(unknownBuilder.build()).catch(() => {});
    }
    const payload = payloadFor(param || 'main', interaction.guild, interaction.user);
    await interaction.editReply(payload);
}

module.exports = {
    buildMainContainer,
    buildServerContainer,
    buildPlayerContainer,
    sendPanel,
    handleComponent,
};
