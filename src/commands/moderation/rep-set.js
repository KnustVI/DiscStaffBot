const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('repset') // Removido o hífen para padronizar chamadas internas
        .setDescription('Ajusta manualmente os pontos de reputação.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Alvo').setRequired(true))
        .addIntegerOption(opt => opt.setName('pontos').setDescription('Nova pontuação (0-100)').setRequired(true).setMinValue(0).setMaxValue(100))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do ajuste').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        const { client, guild, options, user: staff, member } = interaction;
        const EMOJIS = client.systems.emojis || {};
        const Config = client.systems.config;
        const Punishment = client.systems.punishment;

        const auth = Config.checkAuth(interaction);
        if (!auth.authorized) return interaction.editReply({ content: auth.message });

        const target = options.getUser('usuario');
        const newPoints = options.getInteger('pontos');
        const reason = options.getString('motivo');

        try {
            const result = await Punishment.setManualReputation(guild.id, target.id, newPoints);

            const isGain = result.diff >= 0;
            const statusEmoji = isGain ? (EMOJIS.UP || '📈') : (EMOJIS.DOWN || '📉');
            const diffText = result.diff > 0 ? `+${result.diff}` : `${result.diff}`;

            // 1. Log Interno
            const logChanId = Config.getSetting(guild.id, 'logs_channel');
            if (logChanId) {
                const logChannel = await guild.channels.fetch(logChanId).catch(() => null);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(isGain ? 0x00FF7F : 0xFF4500)
                        .setDescription([
                            `# ${statusEmoji} Ajuste Manual`,
                            `- **Usuário:** <@${target.id}>`,
                            `- **Responsável:** <@${staff.id}>`,
                            `- **Mudança:** \`${diffText} pts\``,
                            `- **Saldo:** \`${result.newPoints}/100 pts\``,
                            `### Motivo`,
                            `\`\`\`\n${reason}\n\`\`\``
                        ].join('\n'))
                        .setFooter(Config.getFooter(guild.name));
                    
                    await logChannel.send({ embeds: [logEmbed] });
                }
            }

            await interaction.editReply({
                content: `${EMOJIS.CHECK || '✅'} Saldo de <@${target.id}> atualizado: \`${result.newPoints} pts\` (\`${diffText}\`).`
            });

        } catch (err) {
            await interaction.editReply({ content: `❌ Erro: ${err.message}` });
        }
    }
};