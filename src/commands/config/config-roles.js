const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, RoleSelectMenuBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const EmbedFormatter = require('../../utils/embedFormatter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-roles')
        .setDescription('⚙️ Configura os cargos do sistema.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        
        // Carregar emojis do servidor
        let EMOJIS = {};
        try {
            const emojisFile = require('../database/emojis.js');
            EMOJIS = emojisFile.EMOJIS || {};
        } catch (err) {
            EMOJIS = {};
        }
        
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }
        
        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
        
        const ConfigSystem = require('../../systems/configSystem');
        
        const staffRole = ConfigSystem.getSetting(guildId, 'staff_role');
        const strikeRole = ConfigSystem.getSetting(guildId, 'strike_role');
        const exemplarRole = ConfigSystem.getSetting(guildId, 'role_exemplar');
        const problematicoRole = ConfigSystem.getSetting(guildId, 'role_problematico');
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(
                `# ${emojis.staff || '👥'} Cargos do Sistema`,
                'Selecione os cargos abaixo:')
            .addFields(
                { name: `${emojis.staff || '🛡️'} Staff`, value: staffRole ? `<@&${staffRole}>` : `${emojis.Error || '❌'} Não definido`, inline: true },
                { name: `${emojis.strike || '⚠️'} Strike (Temporário)`, value: strikeRole ? `<@&${strikeRole}>` : `${emojis.Error || '❌'} Não definido`, inline: true },
                { name: `${emojis.shinystar || '✨'} Exemplar`, value: exemplarRole ? `<@&${exemplarRole}>` : `${emojis.Error || '❌'} Não definido`, inline: true },
                { name: `${emojis.Warning || '⚠️'} Problemático`, value: problematicoRole ? `<@&${problematicoRole}>` : `${emojis.Error || '❌'} Não definido`, inline: true }
            )
            .setTimestamp();
            embed.setFooter(EmbedFormatter.getFooter(guild.name));
        
        const staffRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config-roles:staff')
                .setPlaceholder(`Selecionar cargo de Staff`)
        );
        
        const strikeRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config-roles:strike')
                .setPlaceholder(`Selecionar cargo de Strike`)
        );
        
        const exemplarRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config-roles:exemplar')
                .setPlaceholder(`Selecionar cargo Exemplar`)
        );
        
        const problematicoRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config-roles:problematico')
                .setPlaceholder(`Selecionar cargo Problemático`)
        );
        
        await ResponseManager.send(interaction, {
            embeds: [embed],
            components: [staffRow, strikeRow, exemplarRow, problematicoRow]
        });
    }
};