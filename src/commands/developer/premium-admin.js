// src/commands/developer/premium-admin.js
/**
 * Concessão/revogação/consulta de Premium — restrito ao desenvolvedor do bot.
 * Pagamento é manual por enquanto (Pix/fora do bot): o dono recebe o
 * pagamento e concede o tier aqui. Nenhum admin de servidor pode conceder
 * premium pra si mesmo ou pros próprios jogadores.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

function formatExpiry(expiresAt) {
    if (!expiresAt) return 'Vitalício';
    return `<t:${Math.floor(expiresAt / 1000)}:R>`;
}

function buildInfoContainer(title, info, idLabel, idValue, tierLabel = null) {
    const builder = new AdvancedContainerBuilder({ accentColor: info.tier === 'free' ? COLORS.DEFAULT : COLORS.SUCCESS });
    builder.text(`# ${title}`);
    builder.separator();
    builder.text(`**${idLabel}:** \`${idValue}\``);
    builder.text(`**Tier:** ${tierLabel || info.tier}`);
    builder.text(`**Expira:** ${formatExpiry(info.expires_at)}`);
    if (info.granted_by) builder.text(`**Concedido por:** <@${info.granted_by}>`);
    if (info.notes) builder.text(`**Observações:** ${info.notes}`);
    return builder;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium-admin')
        .setDescription('🔒 Gerencia Premium (restrito ao desenvolvedor do bot)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommandGroup(group => group
            .setName('player')
            .setDescription('Player Premium (global, por usuário)')
            .addSubcommand(sub => sub
                .setName('grant')
                .setDescription('Concede Player Premium a um usuário')
                .addUserOption(opt => opt.setName('usuario').setDescription('Usuário').setRequired(true))
                .addStringOption(opt => opt.setName('tier').setDescription('Tier').setRequired(true)
                    .addChoices({ name: 'Compy', value: 'compy' }, { name: 'Raptor', value: 'raptor' }))
                .addIntegerOption(opt => opt.setName('dias').setDescription('Duração em dias (vazio = vitalício)').setRequired(false))
                .addStringOption(opt => opt.setName('observacao').setDescription('Observação (ex: forma de pagamento)').setRequired(false)))
            .addSubcommand(sub => sub
                .setName('revoke')
                .setDescription('Revoga o Player Premium de um usuário')
                .addUserOption(opt => opt.setName('usuario').setDescription('Usuário').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('check')
                .setDescription('Consulta o Player Premium de um usuário')
                .addUserOption(opt => opt.setName('usuario').setDescription('Usuário').setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('guild')
            .setDescription('Server Premium (por servidor)')
            .addSubcommand(sub => sub
                .setName('grant')
                .setDescription('Concede Server Premium a um servidor')
                .addStringOption(opt => opt.setName('servidor_id').setDescription('ID do servidor Discord').setRequired(true))
                .addStringOption(opt => opt.setName('tier').setDescription('Tier').setRequired(true)
                    .addChoices({ name: 'Rastreador', value: 'rastreador' }, { name: 'Caçador', value: 'cacador' }))
                .addIntegerOption(opt => opt.setName('dias').setDescription('Duração em dias (vazio = vitalício)').setRequired(false))
                .addStringOption(opt => opt.setName('observacao').setDescription('Observação (ex: forma de pagamento)').setRequired(false)))
            .addSubcommand(sub => sub
                .setName('revoke')
                .setDescription('Revoga o Server Premium de um servidor')
                .addStringOption(opt => opt.setName('servidor_id').setDescription('ID do servidor Discord').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('check')
                .setDescription('Consulta o Server Premium de um servidor')
                .addStringOption(opt => opt.setName('servidor_id').setDescription('ID do servidor (padrão: este servidor)').setRequired(false)))),

    async execute(interaction, client) {
        const { user, guild } = interaction;

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(guild?.id || null, user.id, 'premium_denied', null, { command: 'premium-admin' });
            const denied = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Este comando é restrito ao desenvolvedor do bot.`)
                .footer(guild?.name || 'Servidor');
            const { components, flags } = denied.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        const group = interaction.options.getSubcommandGroup();
        const sub = interaction.options.getSubcommand();

        let builder;

        if (group === 'player') {
            const targetUser = interaction.options.getUser('usuario');

            if (sub === 'grant') {
                const tier = interaction.options.getString('tier');
                const dias = interaction.options.getInteger('dias');
                const observacao = interaction.options.getString('observacao');
                PremiumSystem.grantPlayerPremium(targetUser.id, tier, dias, user.id, observacao);
                db.logActivity(guild?.id || null, user.id, 'premium_grant', targetUser.id, { scope: 'player', tier, dias });
                builder = buildInfoContainer('PLAYER PREMIUM CONCEDIDO', PremiumSystem.getPlayerPremiumInfo(targetUser.id), 'Usuário', targetUser.tag);
            } else if (sub === 'revoke') {
                PremiumSystem.revokePlayerPremium(targetUser.id, user.id);
                db.logActivity(guild?.id || null, user.id, 'premium_revoke', targetUser.id, { scope: 'player' });
                builder = buildInfoContainer('PLAYER PREMIUM REVOGADO', PremiumSystem.getPlayerPremiumInfo(targetUser.id), 'Usuário', targetUser.tag);
            } else {
                builder = buildInfoContainer('PLAYER PREMIUM', PremiumSystem.getPlayerPremiumInfo(targetUser.id), 'Usuário', targetUser.tag);
            }
        } else if (group === 'guild') {
            const servidorId = interaction.options.getString('servidor_id') || guild?.id;

            if (!servidorId) {
                const errBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                    .text(`${EMOJIS.circlealert || '❌'} Informe \`servidor_id\`.`)
                    .footer(guild?.name || 'Servidor');
                const { components, flags } = errBuilder.build();
                await interaction.editReply({ components, flags: [flags] });
                return;
            }

            if (sub === 'grant') {
                const tier = interaction.options.getString('tier');
                const dias = interaction.options.getInteger('dias');
                const observacao = interaction.options.getString('observacao');
                PremiumSystem.grantGuildPremium(servidorId, tier, dias, user.id, observacao);
                db.logActivity(servidorId, user.id, 'premium_grant', null, { scope: 'guild', tier, dias });
                builder = buildInfoContainer('SERVER PREMIUM CONCEDIDO', PremiumSystem.getGuildPremiumInfo(servidorId), 'Servidor', servidorId, PremiumSystem.GUILD_TIER_DISPLAY[tier]);

                // ── Bônus: o DONO do servidor ganha o Player Premium
                // correspondente (Rastreador→Compy, Caçador→Raptor), sem rebaixar
                // um tier melhor que ele já tenha por conta própria. Expira
                // junto com o Server Premium (mesma quantidade de dias). ────
                const bonusPlayerTier = PremiumSystem.GUILD_TO_PLAYER_TIER[tier];
                if (bonusPlayerTier) {
                    const targetGuild = client.guilds.cache.get(servidorId) || await client.guilds.fetch(servidorId).catch(() => null);
                    if (targetGuild?.ownerId) {
                        if (!PremiumSystem.isPlayerAtLeast(targetGuild.ownerId, bonusPlayerTier)) {
                            PremiumSystem.grantPlayerPremium(
                                targetGuild.ownerId, bonusPlayerTier, dias, user.id,
                                `Bônus por Server Premium ${tier} em ${servidorId}`
                            );
                            db.logActivity(servidorId, user.id, 'premium_grant', targetGuild.ownerId, { scope: 'player', tier: bonusPlayerTier, dias, reason: 'guild_owner_bonus' });
                            builder.text(`${EMOJIS.badge || '🏅'} **Bônus:** o dono do servidor (<@${targetGuild.ownerId}>) recebeu Player Premium **${bonusPlayerTier}** junto.`);
                        } else {
                            builder.text(`${EMOJIS.messagesquare || 'ℹ️'} O dono do servidor já tinha Player Premium igual ou melhor — bônus não aplicado.`);
                        }
                    } else {
                        builder.text(`${EMOJIS.trianglealert || '⚠️'} Não foi possível identificar o dono do servidor (bot não está nele) — bônus de Player Premium não aplicado automaticamente.`);
                    }
                }
            } else if (sub === 'revoke') {
                PremiumSystem.revokeGuildPremium(servidorId, user.id);
                db.logActivity(servidorId, user.id, 'premium_revoke', null, { scope: 'guild' });
                builder = buildInfoContainer('SERVER PREMIUM REVOGADO', PremiumSystem.getGuildPremiumInfo(servidorId), 'Servidor', servidorId, PremiumSystem.GUILD_TIER_DISPLAY.free);
            } else {
                const guildInfo = PremiumSystem.getGuildPremiumInfo(servidorId);
                builder = buildInfoContainer('SERVER PREMIUM', guildInfo, 'Servidor', servidorId, PremiumSystem.GUILD_TIER_DISPLAY[guildInfo.tier]);
            }
        }

        builder.footer(guild?.name || 'Servidor');
        const { components, flags } = builder.build();
        await interaction.editReply({ components, flags: [flags] });
    },
};
