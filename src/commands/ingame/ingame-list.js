// src/commands/ingame/ingame-list.js
/**
 * Comandos in-game (RCON) de consulta/listagem do PoT (categoria "List",
 * junta listroles que antes era de Admin e listpoi/listquests/
 * listcreatormode que antes eram de Map) — plano Caçador. Catálogo em
 * rconCommandCatalog.js.
 *
 * Diferente dos outros comandos de categoria: `listplayers` é liberado pra
 * QUALQUER membro do servidor (não só Staff, ver `publicAccess` no
 * catálogo), então este comando não usa ModerateMembers como permissão
 * padrão do Discord — fica aberto a todo mundo, e cada subcomando é gated
 * internamente dentro de executeRconSubcommand.
 */
const { SlashCommandBuilder } = require('discord.js');
const { LIST_COMMANDS, buildSubcommandOption, executeRconSubcommand } = require('../../systems/pot/rconCommandCatalog');

const data = new SlashCommandBuilder()
    .setName('ingame-list')
    .setDescription('📋 Comandos in-game (RCON) de listagem/consulta do PoT.')
    .setDefaultMemberPermissions(null); // listplayers é aberto a todo mundo; os demais são gated dentro de executeRconSubcommand

for (const entry of LIST_COMMANDS) {
    data.addSubcommand(sub => buildSubcommandOption(sub, entry));
}

module.exports = {
    data,
    async execute(interaction, client) {
        const entry = LIST_COMMANDS.find(e => e.name === interaction.options.getSubcommand());
        if (!entry) return;
        await executeRconSubcommand(interaction, entry, 'List');
    },
};
