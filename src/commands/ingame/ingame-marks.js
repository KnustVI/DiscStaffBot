// src/commands/ingame/ingame-marks.js
/**
 * Comandos in-game (RCON) de marcas (categoria "Marks" do site oficial) —
 * plano Caçador. Catálogo em rconCommandCatalog.js.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { MARKS_COMMANDS, buildSubcommandOption, executeRconSubcommand } = require('../../systems/pot/rconCommandCatalog');

const data = new SlashCommandBuilder()
    .setName('ingame-marks')
    .setDescription('🔒 Comandos in-game (RCON) de marcas do PoT (plano Caçador).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

for (const entry of MARKS_COMMANDS) {
    data.addSubcommand(sub => buildSubcommandOption(sub, entry));
}

module.exports = {
    data,
    async execute(interaction, client) {
        const entry = MARKS_COMMANDS.find(e => e.name === interaction.options.getSubcommand());
        if (!entry) return;
        await executeRconSubcommand(interaction, entry, 'Marks');
    },
};
