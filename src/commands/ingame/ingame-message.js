// src/commands/ingame/ingame-message.js
/**
 * Comandos in-game (RCON) de mensagens do PoT (categoria "Message" do site
 * oficial) — plano Caçador. Catálogo em rconCommandCatalog.js.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { MESSAGE_COMMANDS, buildSubcommandOption, executeRconSubcommand } = require('../../systems/pot/rconCommandCatalog');

const data = new SlashCommandBuilder()
    .setName('ingame-message')
    .setDescription('🔒 Comandos in-game (RCON) de mensagens do PoT (plano Caçador).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers); // checagem real do cargo Staff é feita dentro de executeRconSubcommand

for (const entry of MESSAGE_COMMANDS) {
    data.addSubcommand(sub => buildSubcommandOption(sub, entry));
}

module.exports = {
    data,
    async execute(interaction, client) {
        const entry = MESSAGE_COMMANDS.find(e => e.name === interaction.options.getSubcommand());
        if (!entry) return;
        await executeRconSubcommand(interaction, entry, 'Message');
    },
};
