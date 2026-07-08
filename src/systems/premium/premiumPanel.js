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

function navRow(activeView = 'main') {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('premium:view:main').setLabel('Status').setStyle(activeView === 'main' ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji(EMOJIS.gauge || '📊'),
        new ButtonBuilder().setCustomId('premium:view:server').setLabel('Server Premium').setStyle(activeView === 'server' ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji(EMOJIS.tv || '🖥️'),
        new ButtonBuilder().setCustomId('premium:view:player').setLabel('Player Premium').setStyle(activeView === 'player' ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji(EMOJIS.badge || '🏅'),
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
        'Melhore tudo que puder no seu servidor! Plano por servidor Discord, independente do Player Premium.',
    ].join('\n'));
    extraFiles.push(...appendServerBanner(builder, guild));

    const tabelaUrl = imageManager.getUrl('tabela_server_premium');
    const tabelaAttachment = imageManager.getAttachment('tabela_server_premium');
    if (tabelaUrl) {
        builder.gallery([tabelaUrl]);
        if (tabelaAttachment) extraFiles.push(tabelaAttachment);
        builder.separator();
    }

    appendStatus(builder, guild, user);
    builder.separator();
    appendAcquire(builder);
    builder.text(`${EMOJIS.trianglealert || '⚠️'} Necessário ser um Host de Path of Titans pra adquirir o Server Premium.`);

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
            'Personalize seu perfil e participe das missões mensais do bot! Vale globalmente, em qualquer servidor com o bot.',
        ].join('\n'),
        AdvancedContainerBuilder.thumbnail(guild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
    );
    builder.separator();

    const viewUrl = imageManager.getUrl('view_player_premium');
    const viewAttachment = imageManager.getAttachment('view_player_premium');
    if (viewUrl) {
        builder.gallery([viewUrl]);
        if (viewAttachment) extraFiles.push(viewAttachment);
        builder.separator();
    }

    appendStatus(builder, guild, user);
    builder.separator();
    appendAcquire(builder);

    builder.separator();
    extraFiles.push(...appendFooterImage(builder, user));
    return { builder, extraFiles };
}

// ==================== ENVIO / NAVEGAÇÃO ====================

function payloadFor(view, guild, user) {
    const resolvedView = view === 'server' ? 'server' : view === 'player' ? 'player' : 'main';
    const { builder, extraFiles } = resolvedView === 'server' ? buildServerContainer(guild, user)
        : resolvedView === 'player' ? buildPlayerContainer(guild, user)
        : buildMainContainer(guild, user);

    const { components, flags, files } = builder.build();
    return { components: [...components, navRow(resolvedView)], flags, files: [...(files || []), ...extraFiles] };
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
