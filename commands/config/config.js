const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    RoleSelectMenuBuilder, 
    ChannelSelectMenuBuilder, 
    ChannelType 
} = require('discord.js');

const { EMOJIS } = require('../../database/emojis');
const session = require('../../utils/sessionManager');
const ConfigSystem = require('../../systems/configSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configura os canais e cargos do sistema do bot.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        try {
            // =========================
            // INICIALIZAÇÃO DE SESSÃO
            // =========================
            session.create(interaction.user.id, {
                guildId: interaction.guildId,
                type: 'config_panel'
            });

            // =========================
            // BUSCA DE DADOS ATUAIS (OPCIONAL MAS RECOMENDADO)
            // =========================
            const staffRoleId = ConfigSystem.getSetting(interaction.guildId, 'staff_role');
            const logsChannelId = ConfigSystem.getSetting(interaction.guildId, 'logs_channel');

            // =========================
            // CONSTRUÇÃO DO EMBED
            // =========================
            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CONFIG || '⚙️'} Painel de Configuração`)
                .setDescription('Selecione abaixo os cargos e canais para o funcionamento do bot.')
                .setColor(0xba0054)
                .addFields(
                    { 
                        name: `${EMOJIS.STAFF || '👤'} 1. Cargo Staff`, 
                        value: staffRoleId ? `<@&${staffRoleId}>` : '`Não configurado`', 
                        inline: true 
                    },
                    { 
                        name: `${EMOJIS.TICKET || '📁'} 2. Canal de Logs`, 
                        value: logsChannelId ? `<#${logsChannelId}>` : '`Não configurado`', 
                        inline: true 
                    }
                )
                .setFooter(ConfigSystem.getFooter(interaction.guild.name))
                .setTimestamp();

            // =========================
            // COMPONENTES (SELECT MENUS)
            // =========================
            const rowRole = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('config:set:staff_role')
                    .setPlaceholder('Selecione o cargo de Staff')
            );

            const rowChannel = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('config:set:logs_channel')
                    .addChannelTypes(ChannelType.GuildText)
                    .setPlaceholder('Selecione o canal de logs')
            );

            // Resposta inicial sempre Efêmera para um painel de config
            await interaction.editReply({
                embeds: [embed],
                components: [rowRole, rowChannel],
                ephemeral: true
            });

        } catch (error) {
            console.error('[Config Command Error]', error);
            
            // Se der erro aqui, o interactionCreate ainda não capturou, 
            // então respondemos manualmente
            const errorContent = `❌ Erro ao abrir painel: \`${error.message}\``;
            
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errorContent });
            } else {
                await interaction.editReply({ content: errorContent, ephemeral: true });
            }
        }
    }
};