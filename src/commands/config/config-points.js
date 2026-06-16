// /home/ubuntu/DiscStaffBot/src/commands/config/config-points.js
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-points')
        .setDescription('⚙️ Configura os pontos dos níveis de Strike e limites de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }
        
        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
        
        const ConfigSystem = require('../../systems/configSystem');
        
        const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
        const points = {
            1: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_1')) || DEFAULT_POINTS[1],
            2: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_2')) || DEFAULT_POINTS[2],
            3: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_3')) || DEFAULT_POINTS[3],
            4: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_4')) || DEFAULT_POINTS[4],
            5: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_5')) || DEFAULT_POINTS[5]
        };
        
        const exemplarLimit = parseInt(ConfigSystem.getSetting(guildId, 'limit_exemplar')) || 95;
        const problematicLimit = parseInt(ConfigSystem.getSetting(guildId, 'limit_problematico')) || 30;
        
        const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        
        const builder = new AdvancedContainerBuilder({ accentColor: 0xDCA15E });
        
        builder.title(`${emojis.Config || '⚙️'} Configuração de Pontos e Limites`, 1);
        builder.text(`Gerencie os valores do sistema de reputação.`);
        builder.separator();
        builder.title(`${emojis.strike || '🎯'} Níveis de Strike`, 2);
        builder.text(`${severityIcons[1]} **Nível 1 (${severityNames[1]}):** \`${points[1]} pontos\``);
        builder.text(`${severityIcons[2]} **Nível 2 (${severityNames[2]}):** \`${points[2]} pontos\``);
        builder.text(`${severityIcons[3]} **Nível 3 (${severityNames[3]}):** \`${points[3]} pontos\``);
        builder.text(`${severityIcons[4]} **Nível 4 (${severityNames[4]}):** \`${points[4]} pontos\``);
        builder.text(`${severityIcons[5]} **Nível 5 (${severityNames[5]}):** \`${points[5]} pontos\``);
        builder.separator();
        builder.title(`${emojis.Rank || '📊'} Limites de Reputação`, 2);
        builder.text(`- **Exemplar:** Acima de \`${exemplarLimit}\` pontos`);
        builder.text(`- **Problemático:** Abaixo de \`${problematicLimit}\` pontos`);
        builder.separator();
        builder.title(`${emojis.Note || '📝'} Valores Padrão`, 2);
        builder.text(`- **Strike:** 10 | 25 | 40 | 60 | 100`);
        builder.text(`- **Limites:** Exemplar > 95 | Problemático <30`);
        builder.footer();
        
        const { components, flags } = builder.build();
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('config-points:strike:modal').setLabel(` Editar Níveis de Strike`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.edit || '✏️'),
            new ButtonBuilder().setCustomId('config-points:limites:modal').setLabel(`Editar Limites`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.edit || '✏️'),
            new ButtonBuilder().setCustomId('config-points:reset').setLabel(`Resetar Padrão`).setStyle(ButtonStyle.Danger).setEmoji(emojis.Reset || '⚠️')
        );
        
        await interaction.editReply({
            components: [components[0], row],
            flags: [flags]
        });
    }
};