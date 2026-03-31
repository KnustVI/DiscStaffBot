const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('repset')
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

        const target = options.getUser('usuario');
        const targetMember = await guild.members.fetch(target.id).catch(() => null);

        // Trava de Hierarquia (Ponto 3)
        if (targetMember && targetMember.roles.highest.position >= member.roles.highest.position && staff.id !== guild.ownerId) {
            return interaction.editReply({ content: `${EMOJIS.ERRO || '❌'} Você não tem autoridade para ajustar a reputação deste membro.` });
        }

        try {
            const result = await Punishment.setManualReputation(guild.id, target.id, options.getInteger('pontos'));
            const diffText = result.diff >= 0 ? `+${result.diff}` : `${result.diff}`;

            // Log de Canal
            const logChanId = Config.getSetting(guild.id, 'logs_channel');
            if (logChanId) {
                const logChannel = await guild.channels.fetch(logChanId).catch(() => null);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(result.diff >= 0 ? 0x00FF7F : 0xFF4500)
                        .setTitle(`${EMOJIS.UP || '📈'} Ajuste de Reputação`)
                        .setDescription(`**Usuário:** ${target}\n**Responsável:** ${staff}\n**Alteração:** \`${diffText} pts\`\n**Saldo Final:** \`${result.newPoints}/100\``)
                        .addFields({ name: 'Motivo', value: options.getString('motivo') })
                        .setFooter(Config.getFooter(guild.name));
                    
                    await logChannel.send({ embeds: [logEmbed] });
                }
            }

            await interaction.editReply({
                content: `${EMOJIS.CHECK || '✅'} Reputação de **${target.username}** definida para \`${result.newPoints} pts\`.`
            });
        } catch (err) {
            await interaction.editReply({ content: `❌ Erro: ${err.message}` });
        }
    }
};