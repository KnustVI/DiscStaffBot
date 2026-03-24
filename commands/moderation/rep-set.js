const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const ConfigSystem = require('../../systems/configSystem');
const PunishmentSystem = require('../../systems/punishmentSystem'); 
const ErrorLogger = require('../../systems/errorLogger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rep-set')
        .setDescription('Ajusta manualmente os pontos de reputação de um membro.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário alvo').setRequired(true))
        .addIntegerOption(opt => opt.setName('pontos').setDescription('Nova pontuação (0 a 100)').setRequired(true).setMinValue(0).setMaxValue(100))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do ajuste manual').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        const { guild, options, user: staff } = interaction;
        const target = options.getUser('usuario');
        const newPoints = options.getInteger('pontos');
        const reason = options.getString('motivo');

        await interaction.deferReply({ ephemeral: true });

        try {
            // DELEGAÇÃO: O sistema processa a lógica de banco de dados
            const result = await PunishmentSystem.setManualReputation(guild.id, target.id, newPoints);

            // Definição visual baseada no ganho ou perda de pontos
            const isGain = result.diff >= 0;
            const embedColor = isGain ? 0xc1ff72 : 0xff5050;
            const diffText = result.diff > 0 ? `+${result.diff} pts` : result.diff < 0 ? `${result.diff} pts` : `Sem alteração`;
            const statusEmoji = isGain ? (EMOJIS.UP || '📈') : (EMOJIS.DOWN || '📉');

            // 1. LOG DE AUDITORIA (Canal de Staff)
            const logChanId = ConfigSystem.getSetting(guild.id, 'logs_channel');
            if (logChanId) {
                const logChannel = await guild.channels.fetch(logChanId).catch(() => null);
                if (logChannel) {
                    const logDesc = [
                        `# ${statusEmoji} Ajuste de Reputação Manual`,
                        `Uma alteração manual foi registada no sistema.`,
                        '',
                        `- **Usuário Alvo:**`,
                        `<@${target.id}>`,
                        `${target.username} (\`${target.id}\`)`,
                        `- **Responsável:**`,
                        `<@${staff.id}>`,
                        `${interaction.member.displayName} (${staff.id})`,
                        `- **Mudança:** ${diffText}`,
                        `- **Saldo Final:** ${result.newPoints}/100 pts`,
                        `### ${EMOJIS.NOTE || '📝'} Motivo`,
                        `\`\`\`\n${reason}\n\`\`\``
                    ].join('\n');

                    await logChannel.send({ 
                        embeds: [new EmbedBuilder()
                            .setColor(embedColor)
                            .setDescription(logDesc)
                            .setFooter(ConfigSystem.getFooter(guild.name))
                            .setTimestamp()] 
                    });
                }
            }

            // 2. NOTIFICAÇÃO VIA DM
            const dmDesc = [
                `# ${statusEmoji} Atualização de Reputação`,
                `A tua reputação em **${guild.name}** foi editada pela Staff.`,
                '',
                `- **Responsável:** ${interaction.member.displayName} (${staff.tag})`,
                `- **Alteração:** ${diffText}`,
                `- **Novo Saldo:** ${result.newPoints}/100 pts`,
                `### ${EMOJIS.NOTE || '📝'} Motivo`,
                `\`\`\`\n${reason}\n\`\`\``, 
                '',
                `> Esta é uma alteração direta no teu histórico de integridade.`
            ].join('\n');

            await target.send({ 
                embeds: [new EmbedBuilder()
                    .setColor(embedColor)
                    .setDescription(dmDesc)
                    .setFooter(ConfigSystem.getFooter(guild.name)) // CORRIGIDO: guild.name
                    .setTimestamp()] 
            }).catch(() => {});

            // 3. RESPOSTA AO MODERADOR
            await interaction.editReply(`${EMOJIS.CHECK || '✅'} **Sucesso!** Saldo de <@${target.id}> atualizado para \`${result.newPoints} pts\` (\`${diffText}\`).`);

        } catch (err) {
            ErrorLogger.log('RepSet_Command', err); // Logando o erro real para você ver no console
            await interaction.editReply(`${EMOJIS.ERRO || '❌'} Falha ao ajustar pontos. Verifica os logs.`);
        }
    }
};