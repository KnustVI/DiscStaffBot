// /home/ubuntu/DiscStaffBot/src/commands/config/config-roles.js
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, RoleSelectMenuBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-roles')
        .setDescription('⚙️ Configura os cargos do sistema.')
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
        
        const staffRole = ConfigSystem.getSetting(guildId, 'staff_role');
        const strikeRole = ConfigSystem.getSetting(guildId, 'strike_role');
        const exemplarRole = ConfigSystem.getSetting(guildId, 'role_exemplar');
        const problematicoRole = ConfigSystem.getSetting(guildId, 'role_problematico');

        const builder = new AdvancedContainerBuilder({ accentColor: 0xDCA15E });

        builder.section(
            [
                '# CARGOS DO SISTEMA',
                'É obrigatório que selecione um cargo para sua staff, sem o cargo configurado eles não conseguem usar os comandos de moderação. Os outros cargos são opcionais.',
                'Para maior filtro de outros comandos de moderação é recomendado configurar seu uso pelo próprio Discord, em ***configurações do servidor*** > ***integrações*** > ***comandos***.',
                'O cargo de Strike é recomendado para marcar os membros que receberam punições temporárias, isso facilita a identificação e aplicação de punições progressivas.',
                'Os cargos de Exemplar e Problemático são opcionais, mas podem ser usados para destacar membros que se destacam positivamente ou negativamente na comunidade, respectivamente.',
                'Recomendamos configurar esses cargos para melhor organização e controle dentro do servidor.'
            ].join('\n'),
            builder.assetThumbnail('icone_discord_roles') || AdvancedContainerBuilder.thumbnail(guild.iconURL({ size: 128 }))
        );
        builder.separator();
        builder.title(`Selecione os cargos abaixo:`);
        builder.text(`${emojis.shield || '🛡️'} **Staff:** ${staffRole ? `<@&${staffRole}>` : `${emojis.circlealert || '❌'} Não definido`}`);
        builder.text(`${emojis.gavel || '⚠️'} **Strike (Temporário):** ${strikeRole ? `<@&${strikeRole}>` : `${emojis.circlealert || '❌'} Não definido`}`);
        builder.text(`${emojis.sparkles || '✨'} **Exemplar:** ${exemplarRole ? `<@&${exemplarRole}>` : `${emojis.circlealert || '❌'} Não definido`}`);
        builder.text(`${emojis.trianglealert || '⚠️'} **Problemático:** ${problematicoRole ? `<@&${problematicoRole}>` : `${emojis.circlealert || '❌'} Não definido`}`);
        builder.footer(`Server: ${guild.name}`);
        
        const { components, flags, files } = builder.build();
        
        const staffRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:staff').setPlaceholder('Selecionar cargo de Staff')
        );
        const strikeRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:strike').setPlaceholder('Selecionar cargo de Strike')
        );
        const exemplarRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:exemplar').setPlaceholder('Selecionar cargo Exemplar')
        );
        const problematicoRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId('config-roles:problematico').setPlaceholder('Selecionar cargo Problemático')
        );
        
        await interaction.editReply({
            components: [components[0], staffRow, strikeRow, exemplarRow, problematicoRow],
            flags: [flags],
            files
        });
    }
};