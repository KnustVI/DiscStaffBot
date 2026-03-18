const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('revogar')
        .setDescription('Anula uma punição específica, devolve reputação e limpa o histórico do usuário.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addIntegerOption(opt => opt.setName('id').setDescription('O ID da punição (ex: 150)').setRequired(true))
        .addStringOption(opt => opt.setName('ticket').setDescription('Ticket que autorizou a revogação').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Breve motivo da anulação').setRequired(true)),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const punishmentId = interaction.options.getInteger('id');
        const ticketId = interaction.options.getString('ticket');
        const revogReason = interaction.options.getString('motivo');

        // 1. VERIFICAÇÃO DE CONFIGURAÇÃO (Logs)
        const logChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);
        
        await interaction.deferReply({ ephemeral: true });

        try {
            // 2. BUSCA A PUNIÇÃO ORIGINAL NO BANCO
            const punishment = db.prepare(`SELECT * FROM punishments WHERE id = ? AND guild_id = ?`).get(punishmentId, guildId);

            if (!punishment) {
                return interaction.editReply(`❌ Não encontrei nenhuma punição com o ID **#${punishmentId}** neste servidor.`);
            }

            if (punishment.severity === 0) {
                return interaction.editReply(`⚠️ Esta punição (ID **#${punishmentId}**) já foi revogada anteriormente.`);
            }

            // 3. CALCULA QUANTO DE REPUTAÇÃO DEVOLVER
            const metricKey = `punish_${punishment.severity}_rep`;
            const customRep = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, metricKey);
            
            const defaultRep = { 1: 2, 2: 5, 3: 10, 4: 20, 5: 35 };
            const repToRestore = customRep ? parseInt(customRep.value) : (defaultRep[punishment.severity] || 0);

            // 4. ATUALIZA O HISTÓRICO (Marca como Revogada)
            db.prepare(`
                UPDATE punishments 
                SET reason = ?, severity = 0 
                WHERE id = ?
            `).run(`REVOGADA (Ticket #${ticketId}): ${revogReason}`, punishmentId);

            // 5. DEVOLVE OS PONTOS AO USUÁRIO
            db.prepare(`
                UPDATE users 
                SET reputation = MIN(100, reputation + ?),
                    penalties = MAX(0, penalties - 1)
                WHERE user_id = ? AND guild_id = ?
            `).run(repToRestore, punishment.user_id, guildId);

            const userData = db.prepare(`SELECT reputation FROM users WHERE user_id = ? AND guild_id = ?`).get(punishment.user_id, guildId);

            // --- 6. CRIAÇÃO DA EMBED UNIFICADA (IGUAL AO COMANDO PUNIR) ---
            const finalEmbed = new EmbedBuilder()
                .setDescription(`# 🔓 Punição Revogada | ID #${punishmentId}`)
                .setColor(0x00FF00) // Verde para sucesso
                .addFields(
                    { name: "👤 Usuário Beneficiado", value: `<@${punishment.user_id}> (\`${punishment.user_id}\`)`, inline: true },
                    { name: "👮 Revogado por", value: `${interaction.user}`, inline: true },
                    { name: "🎫 Ticket de Ref.", value: `\`#${ticketId}\``, inline: true },
                    { name: "📈 Reputação Atual", value: `\`${userData.reputation} pts (+${repToRestore})\``, inline: true },
                    { name: "📝 Motivo da Revogação", value: `\`\`\`${revogReason}\`\`\`` }
                )
                .setFooter({ 
                    text: interaction.guild.name, 
                    iconURL: interaction.guild.iconURL({ dynamic: true })
                })
                .setTimestamp();

            // Envio para o Canal de Logs Staff
            if (logChannelSetting) {
                const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
                if (logChannel) {
                    await logChannel.send({ embeds: [finalEmbed] }).catch(() => null);
                }
            }

            // --- 7. TENTA AVISAR O USUÁRIO NA DM (MESMA EMBED) ---
            const targetUser = await interaction.client.users.fetch(punishment.user_id).catch(() => null);
            if (targetUser) {
                await targetUser.send({ embeds: [finalEmbed] }).catch(() => null);
            }

            await interaction.editReply(`✅ Punição **#${punishmentId}** revogada com sucesso.`);

        } catch (error) {
            console.error(error);
            await interaction.editReply("❌ Erro técnico ao tentar revogar a punição.");
        }
    }
};