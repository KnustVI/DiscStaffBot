// /home/ubuntu/DiscStaffBot/src/commands/config/config-points.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-points')
        .setDescription('⚙️ Configura os pontos dos níveis de Strike e limites de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const ConfigSystem = require('../../systems/configSystem.js');

        // ✅ Usa o MESMO painel "vivo" que os botões usam pra editar depois.
        // Antes o comando duplicava a renderização com um banner sem guard
        // (`builder.gallery([bannerUrl])` sem checar null), o que quebrava
        // o comando quando a imagem 'config_punições' não existia.
        // Agora comando e botões nunca ficam dessincronizados.
        await ConfigSystem.refreshPointsPanel(interaction, null, guild.name);
    }
};