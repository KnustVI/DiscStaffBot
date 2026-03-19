const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis'); // Importe os emojis

module.exports = {
    data: new SlashCommandBuilder()
        .setName('revogar')
        .setDescription('Anula uma punição específica, devolve reputação e limpa o histórico do usuário.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addIntegerOption(opt => opt.setName('id').setDescription('O ID da punição (ex: 150)').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Breve motivo da anulação').setRequired(true)),
        // Removido o argumento de ticket para não pedir ao usuário

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const punishmentId = interaction.options.getInteger('id');
        const revogReason = interaction.options.getString('motivo');

        const logChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);
        
        await interaction.deferReply({ ephemeral: true });

        try {
            // 1. BUSCA A PUNIÇÃO ORIGINAL PARA PEGAR OS DADOS E O TICKET ANTIGO
            const punishment = db.prepare(`SELECT * FROM punishments WHERE id = ? AND guild_id = ?`).get(punishmentId, guildId);

            if (!punishment) {
                return interaction.editReply(`${EMOJIS.AVISO} Não encontrei nenhuma punição com o ID **#${punishmentId}** neste servidor.`);
            }

            if (punishment.severity === 0) {
                return interaction.editReply(`${EMOJIS.AVISO} Esta punição (ID **#${punishmentId}**) já foi revogada anteriormente.`);
            }

            // Pega o ticket da punição original (se existir no banco)
            const originalTicket = punishment.ticket_id || 'N/A';

            // 2. CÁLCULO DE REPUTAÇÃO
            const metricKey = `punish_${punishment.severity}_rep`;
            const customRep = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, metricKey);
            
            const defaultRep = { 1: 2, 2: 5, 3: 10, 4: 20, 5: 35 };
            const repToRestore = customRep ? parseInt(customRep.value) : (defaultRep[punishment.severity] || 0);

            // 3. ATUALIZA O BANCO (Mantendo o ticket original no registro de revogação)
            db.prepare(`
                UPDATE punishments 
                SET reason = ?, severity = 0 
                WHERE id = ?
            `).run(`REVOGADA: ${revogReason}`, punishmentId);

            // 4. DEVOLVE OS PONTOS
            db.prepare(`
                UPDATE users 
                SET reputation = MIN(100, reputation + ?),
                    penalties = MAX(0, penalties - 1)
                WHERE user_id = ? AND guild_id = ?
            `).run(repToRestore, punishment.user_id, guildId);

            const userData = db.prepare(`SELECT reputation FROM users WHERE user_id = ? AND guild_id = ?`).get(punishment.user_id, guildId);

            // --- 5. EMBED DE LOG PADRONIZADA ---
            const finalEmbed = new EmbedBuilder()
                .setDescription(`# ${EMOJIS.REFAZER} Punição Revogada | ID #${punishmentId}`)
                .setColor(0x00FF00)
                .addFields(
                    { name: `${EMOJIS.USUARIO} Usuário Beneficiado`, value: `<@${punishment.user_id}> (\`${punishment.user_id}\`)`, inline: true },
                    { name: `${EMOJIS.DISTINTIVO} Revogado por`, value: `${interaction.user}`, inline: true },
                    { name: `${EMOJIS.LIVRO} Ticket Originário`, value: `\`#${originalTicket}\``, inline: true }, // Puxado do banco
                    { name: `${EMOJIS.STATUS_SISTEMA} Reputação Atual`, value: `\`${userData.reputation} pts (+${repToRestore})\``, inline: true },
                    { name: `${EMOJIS.NOTA} Motivo da Revogação`, value: `\`\`\`${revogReason}\`\`\`` }
                )
                .setFooter({ 
                    text: interaction.guild.name, 
                    iconURL: interaction.guild.iconURL({ forceStatic: false }) || null
                })
                .setTimestamp();

            // Logs Staff
            if (logChannelSetting) {
                const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
                if (logChannel) {
                    await logChannel.send({ embeds: [finalEmbed] }).catch(() => null);
                }
            }

            // DM Usuário
            const targetUser = await interaction.client.users.fetch(punishment.user_id).catch(() => null);
            if (targetUser) {
                await targetUser.send({ embeds: [finalEmbed] }).catch(() => null);
            }

            await interaction.editReply(`${EMOJIS.SIM} Punição **#${punishmentId}** revogada com sucesso.`);

        } catch (error) {
            console.error(error);
            await interaction.editReply(`${EMOJIS.AVISO} Erro técnico ao tentar revogar a punição.`);
        }
    }
};