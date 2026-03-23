const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const PunishmentSystem = require('../../systems/punishment/punishmentSystem');
const ConfigSystem = require('../../systems/configSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetrep')
        .setDescription('Reseta completamente a reputação e histórico de um usuário.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário alvo').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do reset').setRequired(true)),

    async execute(interaction) {
        const { guild, options, user: staff } = interaction;
        const target = options.getUser('usuario');
        const reason = options.getString('motivo');

        await interaction.deferReply({ ephemeral: true });

        try {
            const hasData = await PunishmentSystem.resetUserFicha(guild.id, target.id);
            if (!hasData) return interaction.editReply(`${EMOJIS.AVISO} Sem registros ativos.`);

            // BUSCA CANAIS NO CACHE
            const logId = ConfigSystem.getSetting(guild.id, 'logs_channel');
            const alertId = ConfigSystem.getSetting(guild.id, 'alert_channel');

            const logEmbed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CLEAN} Reset de Ficha Técnica`)
                .setColor(0x3498db)
                .addFields(
                    { name: `${EMOJIS.USUARIO} Usuário`, value: `${target}`, inline: true },
                    { name: `${EMOJIS.STAFF} Responsável`, value: `${staff}`, inline: true },
                    { name: `${EMOJIS.NOTE} Motivo`, value: `\`\`\`${reason}\`\`\`` }
                )
                .setTimestamp();

            // 1. Log Padrão
            if (logId) {
                const chan = await guild.channels.fetch(logId).catch(() => null);
                if (chan) await chan.send({ embeds: [logEmbed] });
            }

            // 2. Staff Log (Alerta Crítico)
            if (alertId && alertId !== logId) {
                const staffChan = await guild.channels.fetch(alertId).catch(() => null);
                if (staffChan) {
                    const alertEmbed = EmbedBuilder.from(logEmbed).setColor(0xFFAA00).setTitle(`${EMOJIS.ALERT} ALERTA: Ficha Resetada`);
                    await staffChan.send({ embeds: [alertEmbed] });
                }
            }

            await interaction.editReply(`${EMOJIS.CHECK} Ficha de **${target.username}** resetada.`);
        } catch (error) {
            console.error(error);
            await interaction.editReply(`${EMOJIS.ERRO} Erro ao processar reset.`);
        }
    }
};