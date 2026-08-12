// src/commands/config/logs.js — subcomando /config logs
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const ConfigSystem = require('../../systems/core/configSystem');

module.exports = {
    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!ConfigSystem.memberIsGuildAdmin(guild.id, member)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        // Painel único (sem abas) — ver LOG_FIELDS/refreshLogsPanel em
        // configSystem.js.
        await ConfigSystem.refreshLogsPanel(interaction, null, guild.name);
    },
};
