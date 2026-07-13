// src/commands/ingame/ingame-map.js
/**
 * Comandos in-game (RCON) de mapa/mundo do PoT (categoria "Map" do site
 * oficial) — plano Caçador. Catálogo em rconCommandCatalog.js.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { MAP_COMMANDS, buildSubcommandOption, executeRconSubcommand } = require('../../systems/pot/rconCommandCatalog');

const data = new SlashCommandBuilder()
    .setName('ingame-map')
    .setDescription('🔒 Comandos in-game (RCON) de mapa/mundo do PoT (plano Caçador).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers); // checagem real do cargo Staff é feita dentro de executeRconSubcommand

for (const entry of MAP_COMMANDS) {
    data.addSubcommand(sub => buildSubcommandOption(sub, entry));
}

module.exports = {
    data,
    async execute(interaction, client) {
        const entry = MAP_COMMANDS.find(e => e.name === interaction.options.getSubcommand());
        if (!entry) return;
        await executeRconSubcommand(interaction, entry, 'Map');
    },
};
