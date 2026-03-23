const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const ConfigSystem = require('../../systems/configSystem');
const ErrorLogger = require('../../systems/errorLogger');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rep-set')
        .setDescription('Ajusta manualmente os pontos de reputação de um membro.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário alvo').setRequired(true))
        .addIntegerOption(opt => opt.setName('pontos').setDescription('Nova pontuação (0 a 100)').setRequired(true).setMinValue(0).setMaxValue(100))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do ajuste manual').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        const { guild, options, member: staff } = interaction;
        const target = options.getUser('usuario');
        const newPoints = options.getInteger('pontos');
        const reason = options.getString('motivo');

        // 1. Verificação de Permissão via Cache
        const staffRole = ConfigSystem.getSetting(guild.id, 'staff_role');
        if (!staff.roles.cache.has(staffRole) && !staff.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: `${EMOJIS.ERRO} Apenas a Staff pode ajustar pontos manualmente.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // 2. Banco de Dados (SQLite)
            db.prepare(`
                INSERT INTO reputation (guild_id, user_id, points)
                VALUES (?, ?, ?)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET points = ?
            `).run(guild.id, target.id, newPoints, newPoints);

            // 3. LOG DE AUDITORIA (Staff no Canal de Logs)
            const logChanId = ConfigSystem.getSetting(guild.id, 'logs_channel');
            if (logChanId) {
                const logChannel = await guild.channels.fetch(logChanId).catch(() => null);
                if (logChannel) {
                    const logDesc = [
                        `# ${EMOJIS.UP} Ajuste de Reputação`,
                        `Uma alteração manual de pontos foi realizada.`,
                        '',
                        `- **Usuário:** ${target} (\`${target.id}\`)`,
                        `- **Nova Pontuação:** \`${newPoints}/100 pts\``,
                        `- **Responsável:** ${interaction.user}`,
                        `- **Motivo:** \`${reason}\``
                    ].join('\n');

                    await logChannel.send({ embeds: [new EmbedBuilder().setColor(0x3498DB).setDescription(logDesc).setTimestamp()] });
                }
            }

            // 4. NOTIFICAÇÃO AO PLAYER (DM Privada)
            const dmDesc = [
                `# ${EMOJIS.REPUTATION} Atualização de Cadastro`,
                `Sua reputação no servidor **${guild.name}** foi ajustada manualmente pela Staff.`,
                '',
                `- **Novo Saldo:** \`${newPoints}/100 pts\``,
                `- **Motivo informado:** \`${reason}\``,
                '',
                `> Esta é uma alteração direta no seu histórico de integridade.`
            ].join('\n');

            await target.send({ 
                embeds: [new EmbedBuilder().setColor(0x3498DB).setDescription(dmDesc).setTimestamp()] 
            }).catch(() => {
                console.log(`[DM Fechada] ${target.tag} não pôde ser notificado do ajuste.`);
            });

            await interaction.editReply(`${EMOJIS.CHECK} Reputação de ${target} definida para **${newPoints}**. Usuário e Staff notificados.`);

        } catch (err) {
            ErrorLogger.log('Command_RepSet_Full', err);
            await interaction.editReply(`${EMOJIS.ERRO} Erro ao processar o ajuste. Verifique os logs do sistema.`);
        }
    }
};