// src/events/guildCreate.js
/**
 * Registra os slash commands automaticamente assim que o bot entra num
 * servidor novo — sem isso, os comandos só aparecem depois de rodar
 * `node deploy.js` manualmente com o ID do servidor adicionado em
 * GUILD_IDS (deploy.js), o que é fácil de esquecer.
 */
const { REST, Routes } = require('discord.js');
const ErrorLogger = require('../systems/core/errorLogger');

module.exports = {
    name: 'guildCreate',
    async execute(guild, client) {
        try {
            const commands = [...client.commands.values()].map(cmd => cmd.data.toJSON());
            const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
                { body: commands }
            );

            console.log(`✅ [GuildCreate] ${commands.length} comandos registrados automaticamente em "${guild.name}" (${guild.id})`);
        } catch (error) {
            ErrorLogger.error('guild_create', 'registerCommands', error, { guildId: guild.id, guildName: guild.name });
        }
    }
};
