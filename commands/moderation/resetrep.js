const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');
const PunishmentSystem = require('../../systems/punishmentSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetrep')
        .setDescription('Reseta completamente a reputação e histórico de um usuário.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário que terá a ficha limpa').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do reset').setRequired(true)),

    async execute(interaction) {
        const { guild, options, user: staff } = interaction;
        const target = options.getUser('usuario');
        const reason = options.getString('motivo');

        await interaction.deferReply({ ephemeral: true });

        try {
            // Executa o reset via System
            const hasData = await PunishmentSystem.resetUserFicha(guild.id, target.id);

            if (!hasData) {
                return interaction.editReply(`${EMOJIS.AVISO} O usuário **${target.username}** não possui registros ativos.`);
            }

            // Log no canal de monitoramento
            const logId = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guild.id)?.value;
            
            if (logId) {
                const logChannel = guild.channels.cache.get(logId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle(`${EMOJIS.CLEAN} Reset de Ficha Técnica`)
                        .setColor(0x3498db)
                        .setThumbnail(target.displayAvatarURL())
                        .addFields(
                            { name: `${EMOJIS.USUARIO} Usuário`, value: `${target} (\`${target.id}\`)`, inline: true },
                            { name: `${EMOJIS.STAFF} Responsável`, value: `${staff}`, inline: true },
                            { name: `${EMOJIS.NOTE} Motivo do Reset`, value: `\`\`\`${reason}\`\`\`` }
                        )
                        .setFooter({ text: `✧ BOT by: KnustVI`, iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' })
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }

            await interaction.editReply(`${EMOJIS.CHECK} Ficha de **${target.username}** foi completamente resetada.`);

        } catch (error) {
            console.error("Erro no resetrep:", error);
            await interaction.editReply(`${EMOJIS.ERRO} Erro ao processar o reset no banco de dados.`);
        }
    }
};