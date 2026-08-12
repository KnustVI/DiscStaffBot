// src/commands/config/punishments.js — subcomando /config punishments
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const ConfigSystem = require('../../systems/core/configSystem');

module.exports = {
    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!ConfigSystem.memberIsGuildAdmin(guild.id, member)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        if (!PremiumSystem.isGuildAtLeast(guild.id, 'rastreador')) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        // Usa o MESMO painel "vivo" que os botões usam pra editar depois,
        // assim comando e botões nunca ficam dessincronizados.
        await ConfigSystem.refreshPointsPanel(interaction, null, guild.name);
    },
};
