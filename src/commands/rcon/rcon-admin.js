// src/commands/rcon/rcon-admin.js
/**
 * Comandos RCON administrativos do PoT (categoria "Admin" do site oficial,
 * exceto kick/ban/unban/ServerMute/ServerUnmute — esses ficam exclusivos de
 * /strike e /unstrike) — plano Caçador. Catálogo em rconCommandCatalog.js.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ADMIN_COMMANDS, buildSubcommandOption, executeRconSubcommand } = require('../../systems/pot/rconCommandCatalog');

const data = new SlashCommandBuilder()
    .setName('rcon-admin')
    .setDescription('🔒 Comandos RCON administrativos do PoT (plano Caçador).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

for (const entry of ADMIN_COMMANDS) {
    data.addSubcommand(sub => buildSubcommandOption(sub, entry));
}

module.exports = {
    data,
    async execute(interaction, client) {
        const entry = ADMIN_COMMANDS.find(e => e.name === interaction.options.getSubcommand());
        if (!entry) return;
        await executeRconSubcommand(interaction, entry, 'Admin');
    },
};
