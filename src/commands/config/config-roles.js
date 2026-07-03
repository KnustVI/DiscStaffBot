// /home/ubuntu/DiscStaffBot/src/commands/config/config-roles.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-roles')
        .setDescription('⚙️ Configura os cargos do sistema.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const ConfigSystem = require('../../systems/core/configSystem');

        // Painel dividido em 3 abas (Reputação Automática, Moderação, Eventos)
        // — ver ROLE_TABS em configSystem.js. Começa na aba de Moderação, que
        // tem o cargo obrigatório (Staff).
        await ConfigSystem.refreshRolesPanel(interaction, null, 'moderation');
    }
};
