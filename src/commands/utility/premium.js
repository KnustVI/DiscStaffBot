// src/commands/utility/premium.js
/**
 * Vitrine pública do Premium — mostra todos os tiers (Player e Server),
 * benefícios, valores, como adquirir, e o status atual (deste servidor e
 * de quem rodou o comando). Concessão continua manual, via /premium-admin
 * (restrito ao desenvolvedor do bot) — ver aquisição abaixo.
 */
const { SlashCommandBuilder } = require('discord.js');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

function formatExpiry(expiresAt) {
    if (!expiresAt) return 'Vitalício';
    return `<t:${Math.floor(expiresAt / 1000)}:R>`;
}

const TIER_LABELS = { free: 'Free', pegada: 'Pegada', fossil: 'Fossil' };
const PLAYER_TIER_LABELS = { free: 'Free', compy: 'Compy', raptor: 'Raptor' };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('🏅 Conheça os planos Premium (jogador e servidor) e veja seu status atual.'),

    async execute(interaction, client) {
        const { guild, user } = interaction;

        const guildInfo = PremiumSystem.getGuildPremiumInfo(guild.id);
        const limits = PremiumSystem.getGuildLimits(guild.id);
        const playerTier = PremiumSystem.getPlayerTier(user.id);

        const builder = new AdvancedContainerBuilder({ accentColor: guildInfo.tier === 'free' ? COLORS.DEFAULT : COLORS.SUCCESS });

        builder.section(
            [
                '# PREMIUM — TITAN\'S PASS',
                'Dois planos independentes: um por jogador, outro por servidor.',
            ].join('\n'),
            AdvancedContainerBuilder.thumbnail(guild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
        );
        builder.separator();

        // ==================== STATUS ATUAL ====================
        builder.title(`${EMOJIS.gauge || '📊'} Seu status atual`, 2);
        builder.block([
            `${EMOJIS.shield || '🛡️'} **Server Premium (${guild.name}):** ${TIER_LABELS[guildInfo.tier] || guildInfo.tier} — expira: ${formatExpiry(guildInfo.expires_at)}`,
            `${EMOJIS.badge || '🏅'} **Seu Player Premium:** ${PLAYER_TIER_LABELS[playerTier] || playerTier}`,
        ]);
        builder.separator();

        // ==================== PLAYER PREMIUM ====================
        builder.title(`${EMOJIS.badge || '🏅'} Player Premium (por jogador, global)`, 2);
        builder.block([
            '**Free** — perfil sincronizado com Discord (banner e avatar padrão do tier), badges e títulos de missão de servidor. *(badges/títulos: vindo em breve)*',
            '**Compy — R$10/mês** — banner de perfil próprio do tier, badge exclusivo, títulos exclusivos, descontos e sorteio mensal de skin do PoT. *(loja, badge, títulos e sorteio: vindo em breve)*',
            '**Raptor — R$25/mês** — tudo do Compy + banner 100% personalizado (puxa do Discord ou upload via `/perfil-banner`) e imagens exclusivas.',
        ]);
        builder.separator();

        // ==================== SERVER PREMIUM ====================
        builder.title(`${EMOJIS.tv || '🖥️'} Server Premium (por servidor)`, 2);
        builder.block([
            '**Free** — logs de strike/unstrike/reportchat/config; 1 chat aberto por vez (4h de cooldown); sem reputação, sem RCON automático, sem automod, sem histórico.',
            '**Pegada — R$25/mês** — logs de jogo, 3 chats sem cooldown, sistema de reputação ativado (5 níveis configuráveis), `/historico` e `/evento` liberados.',
            '**Fossil — R$40/mês** — chats ilimitados, automod diário (recuperação + cargos automáticos), análise de staff, RCON automático em punições, recuperação diária configurável e (em breve) níveis de punição 100% personalizáveis.',
        ]);
        builder.separator();

        // ==================== LIMITES CONCRETOS DESTE SERVIDOR ====================
        builder.title(`${EMOJIS.clipboardlist || '📋'} Limites concretos de ${guild.name} agora`, 2);
        builder.block([
            `${EMOJIS.ticket || '🎫'} **Chats simultâneos:** ${limits.maxOpenChats === Infinity ? 'Ilimitado' : limits.maxOpenChats}`,
            `${EMOJIS.clockalert || '⏳'} **Cooldown entre chats:** ${limits.chatCooldownMs > 0 ? `${limits.chatCooldownMs / 3600000}h` : 'Sem cooldown'}`,
            `${EMOJIS.star || '⭐'} **Reputação:** ${limits.reputationEnabled ? 'Ativada' : 'Desativada'}`,
            `${EMOJIS.history || '📜'} **/historico e /evento:** ${limits.historyEnabled ? 'Liberados' : 'Bloqueados'}`,
            `${EMOJIS.shieldcheck || '🛡️'} **Automod diário:** ${limits.automodEnabled ? 'Ativado' : 'Desativado'}`,
            `${EMOJIS.game || '🎮'} **RCON automático:** ${limits.autoRcon ? 'Ativado' : 'Desativado'}`,
        ]);
        builder.separator();

        // ==================== COMO ADQUIRIR ====================
        builder.title(`${EMOJIS.wifi || '💬'} Como adquirir`, 2);
        builder.text(`${EMOJIS.messagesquare || 'ℹ️'} A concessão hoje é manual: fale com o desenvolvedor do bot (**/reportarbug**, opção Sugestão, ou contato direto) pra combinar o pagamento e ativar o tier. Uma forma automatizada de pagamento (Ko-fi) está a caminho.`);

        builder.footer(guild.name);

        const payload = builder.build();
        await interaction.editReply(payload);
    },
};
