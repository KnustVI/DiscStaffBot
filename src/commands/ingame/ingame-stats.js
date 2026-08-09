// src/commands/ingame/ingame-stats.js
/**
 * Comandos in-game (RCON) de atributos/status do PoT (categoria "Change
 * Stats" do site oficial) — plano Caçador. Catálogo em rconCommandCatalog.js.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { STATS_COMMANDS, buildSubcommandOption, executeRconSubcommand } = require('../../systems/pot/rconCommandCatalog');

const data = new SlashCommandBuilder()
    .setName('ingame-stats')
    .setDescription('🔒 Comandos in-game (RCON) de atributos/status do PoT (plano Caçador).')
    // null, não ModerateMembers — mesmo raciocínio do /strike (ver
    // comentário completo em strike/index.js). Checagem real já dentro
    // de executeRconSubcommand.
    .setDefaultMemberPermissions(null);

for (const entry of STATS_COMMANDS) {
    data.addSubcommand(sub => buildSubcommandOption(sub, entry));
}

module.exports = {
    data,
    async execute(interaction, client) {
        const entry = STATS_COMMANDS.find(e => e.name === interaction.options.getSubcommand());
        if (!entry) return;
        await executeRconSubcommand(interaction, entry, 'Change Stats');
    },
};
