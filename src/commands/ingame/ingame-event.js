// src/commands/ingame/ingame-event.js
/**
 * Comandos in-game (RCON) de eventos/criaturas do PoT (categoria "Event" do
 * site oficial) — plano Caçador. Catálogo em rconCommandCatalog.js.
 *
 * Não confundir com o comando /evento (agendamento de eventos da
 * comunidade, feature totalmente diferente) — nome escolhido com o
 * prefixo ingame- justamente pra evitar essa colisão.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { EVENT_COMMANDS, buildSubcommandOption, executeRconSubcommand } = require('../../systems/pot/rconCommandCatalog');

const data = new SlashCommandBuilder()
    .setName('ingame-event')
    .setDescription('🔒 Comandos in-game (RCON) de eventos/criaturas do PoT (plano Caçador).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers); // checagem real do cargo Staff é feita dentro de executeRconSubcommand

for (const entry of EVENT_COMMANDS) {
    data.addSubcommand(sub => buildSubcommandOption(sub, entry));
}

module.exports = {
    data,
    async execute(interaction, client) {
        const entry = EVENT_COMMANDS.find(e => e.name === interaction.options.getSubcommand());
        if (!entry) return;
        await executeRconSubcommand(interaction, entry, 'Event');
    },
};
