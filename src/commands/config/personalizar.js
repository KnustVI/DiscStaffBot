// src/commands/config/personalizar.js — subcomando /config personalizar
const { PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');

module.exports = {
    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        if (!PremiumSystem.isGuildAtLeast(guild.id, 'cacador')) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const ConfigSystem = require('../../systems/core/configSystem');

        // Usa o MESMO painel "vivo" que os selects/botões usam pra editar
        // depois, assim comando e componentes nunca ficam dessincronizados.
        await ConfigSystem.refreshPersonalizarPanel(interaction, null, guild.name);
    },
};
