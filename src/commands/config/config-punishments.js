// /home/ubuntu/DiscStaffBot/src/commands/config/config-punishments.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager.js');
const PremiumSystem = require('../../systems/premium/premiumSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-punishments')
        .setDescription('⚙️ Configura os pontos dos níveis de Strike e limites de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        if (!PremiumSystem.isGuildAtLeast(guild.id, 'pegada')) {
            return await ResponseManager.error(interaction, 'A configuração de punições/reputação é um recurso a partir do plano **Pegada** — no Free, o strike é só registro (sem pontos de reputação). Use `/premium-status` para ver o tier atual deste servidor.');
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const ConfigSystem = require('../../systems/core/configSystem.js');

        // Usa o MESMO painel "vivo" que os botões usam pra editar depois,
        // assim comando e botões nunca ficam dessincronizados.
        await ConfigSystem.refreshPointsPanel(interaction, null, guild.name);
    }
};