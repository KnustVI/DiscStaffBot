// src/commands/utility/premium-status.js
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
        .setName('premium-status')
        .setDescription('📊 Mostra o tier Premium deste servidor e o seu próprio.'),

    async execute(interaction, client) {
        const { guild, user } = interaction;

        const guildInfo = PremiumSystem.getGuildPremiumInfo(guild.id);
        const limits = PremiumSystem.getGuildLimits(guild.id);
        const playerTier = PremiumSystem.getPlayerTier(user.id);

        const builder = new AdvancedContainerBuilder({ accentColor: guildInfo.tier === 'free' ? COLORS.DEFAULT : COLORS.SUCCESS });

        builder.section(
            [
                '# STATUS PREMIUM',
                `Tier atual deste servidor e o seu, pessoalmente.`,
            ].join('\n'),
            AdvancedContainerBuilder.thumbnail(guild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
        );
        builder.separator();

        builder.text(`${EMOJIS.shield || '🛡️'} **Server Premium:** ${TIER_LABELS[guildInfo.tier] || guildInfo.tier}`);
        builder.text(`${EMOJIS.clock || '🕐'} **Expira:** ${formatExpiry(guildInfo.expires_at)}`);
        builder.separator();
        builder.text(`${EMOJIS.ticket || '🎫'} **Chats simultâneos (report + revisão):** ${limits.maxOpenChats === Infinity ? 'Ilimitado' : limits.maxOpenChats}`);
        builder.text(`${EMOJIS.clockalert || '⏳'} **Cooldown entre chats:** ${limits.chatCooldownMs > 0 ? `${limits.chatCooldownMs / 3600000}h` : 'Sem cooldown'}`);
        builder.text(`${EMOJIS.star || '⭐'} **Sistema de reputação:** ${limits.reputationEnabled ? 'Ativado' : 'Desativado (a partir do Pegada)'}`);
        builder.text(`${EMOJIS.history || '📜'} **Histórico de jogador (/historico):** ${limits.historyEnabled ? 'Liberado' : 'Bloqueado (a partir do Pegada)'}`);
        builder.text(`${EMOJIS.shieldcheck || '🛡️'} **Automod diário (reputação/cargos automáticos):** ${limits.automodEnabled ? 'Ativado' : 'Desativado (só no Fossil)'}`);
        builder.text(`${EMOJIS.game || '🎮'} **RCON automático em punição:** ${limits.autoRcon ? 'Ativado' : 'Desativado (a partir do Fossil)'}`);
        builder.separator();

        builder.text(`${EMOJIS.badge || '🏅'} **Seu Player Premium:** ${PLAYER_TIER_LABELS[playerTier] || playerTier}`);

        builder.footer(guild.name);

        const payload = builder.build();
        await interaction.editReply(payload);
    },
};
