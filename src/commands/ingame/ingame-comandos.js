// src/commands/ingame/ingame-comandos.js — /ingame-comandos
/**
 * Lista completa dos ~57 subcomandos /ingame-* (RCON), por categoria —
 * comando dedicado só pra isso (era uma aba do /ajuda, mas o texto de TODAS
 * as categorias somado passava do limite agregado de 4000 caracteres de
 * texto por mensagem do Discord — "COMPONENT_DISPLAYABLE_TEXT_SIZE_EXCEEDED",
 * mesmo com cada bloco individual bem abaixo do limite por componente).
 * Uma categoria por página via PaginationBuilder resolve isso de vez, já
 * que cada categoria sozinha é pequena.
 *
 * Liberado pro cargo Staff (mesmo critério de quem pode USAR os comandos
 * /ingame-*, ver rconCommandCatalog.js) — não exige tier, é só documentação.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { PaginationBuilder } = require('../../utils/paginationBuilder');
const ResponseManager = require('../../utils/responseManager');
const RconCatalog = require('../../systems/pot/rconCommandCatalog');

let emojis = {};
try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

const CATEGORIES = [
    { command: '/ingame-stats', label: 'Change Stats', entries: RconCatalog.STATS_COMMANDS },
    { command: '/ingame-marks', label: 'Marks', entries: RconCatalog.MARKS_COMMANDS },
    { command: '/ingame-admin', label: 'Admin', entries: RconCatalog.ADMIN_COMMANDS },
    { command: '/ingame-list', label: 'List', entries: RconCatalog.LIST_COMMANDS },
    { command: '/ingame-map', label: 'Map', entries: RconCatalog.MAP_COMMANDS },
    { command: '/ingame-event', label: 'Event', entries: RconCatalog.EVENT_COMMANDS },
    { command: '/ingame-message', label: 'Message', entries: RconCatalog.MESSAGE_COMMANDS },
];

function buildCategoryPage(guildName, category, isFirst) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });

    if (isFirst) {
        builder.section(
            [
                '# COMANDOS INGAME',
                `Catálogo completo dos comandos de admin do servidor PoT disponíveis via **/ingame-***, plano **Caçador**. ` +
                `Todo subcomando aceita **usuario** (Discord vinculado) OU **agid** (Alderon ID/nome, se não estiver vinculado) — nenhum dos dois informado usa você mesmo, quando fizer sentido. ` +
                `${emojis.lock || '🔒'} marca os subcomandos restritos ao cargo Supervisor (ver /config roles).`,
            ].join('\n'),
            builder.assetThumbnail('icone_help') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png'),
        );
        builder.separator();
    }

    builder.title(`${emojis.rcon || '🔗'} ${category.command} — ${category.label}`, 2);
    builder.block(category.entries.map((entry) =>
        `• \`${entry.name}\`${entry.supervisorOnly ? ` ${emojis.lock || '🔒'}` : ''} — ${entry.description}`
    ));

    if (category.label === 'List') {
        builder.separator();
        builder.text(
            `ℹ️ **/ingame-list listplayers é liberado pra qualquer membro do servidor**, não só Staff — os demais subcomandos desta categoria continuam restritos à equipe.`
        );
    }

    if (category.label === 'Message') {
        builder.separator();
        builder.text(
            `${emojis.trianglealert || '⚠️'} **kick, ban, unban, ServerMute e ServerUnmute não estão aqui** — continuam exclusivos de **/strike** e **/unstrike**, ` +
            `que já aplicam a ação em jogo automaticamente (e recarregam bans/mutes) junto com a punição no Discord.`
        );
    }

    builder.footer(guildName);
    return builder;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ingame-comandos')
        .setDescription('📖 Lista completa dos comandos in-game (RCON), por categoria.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction, client) {
        const ConfigSystem = require('../../systems/core/configSystem');
        if (!ConfigSystem.memberHasAnyStaffRole(interaction.guildId, interaction.member)) {
            return await ResponseManager.error(interaction, `${emojis.circlealert || '❌'} Este comando é restrito à equipe do servidor (cargo Staff, ver /config roles).`);
        }

        const guildName = interaction.guild?.name || 'Servidor';
        const pagination = new PaginationBuilder({ accentColor: COLORS.DEFAULT });
        CATEGORIES.forEach((category, index) => {
            pagination.addPage(() => buildCategoryPage(guildName, category, index === 0));
        });

        await pagination.start(interaction);
    },
};
