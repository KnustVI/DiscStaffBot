const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delpunir')
        .setDescription('Anula uma punição, remove do histórico e devolve a reputação local.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addIntegerOption(opt => 
            opt.setName('id')
                .setDescription('O número da punição (ex: 12)')
                .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('motivo')
                .setDescription('Justificativa para anular esta punição')
                .setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const punishmentId = interaction.options.getInteger('id');
        const voidReason = interaction.options.getString('motivo');

        // 1. Verificação de Permissão (Staff ou Admin)
        const staffSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasStaffRole = staffSetting ? interaction.member.roles.cache.has(staffSetting.value) : false;

        if (!isAdmin && !hasStaffRole) {
            return interaction.reply({ 
                content: "❌ Você não tem permissão para anular punições ou o cargo de Staff não foi configurado.", 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // 2. Busca os dados da punição ANTES de deletar
            const punishment = db.prepare(`SELECT * FROM punishments WHERE id = ? AND guild_id = ?`).get(punishmentId, guildId);

            if (!punishment) {
                return interaction.editReply(`❌ Nenhuma punição encontrada com o ID **#${punishmentId}** neste servidor.`);
            }

            // 3. Define os pontos a serem devolvidos com base na gravidade gravada
            const penaltyValues = { 1: 2, 2: 5, 3: 10, 4: 20, 5: 35 };
            const repToRestore = penaltyValues[punishment.severity] || 0;

            // --- INÍCIO DA TRANSAÇÃO NO BANCO ---
            
            // 4. Deleta o registro da punição
            db.prepare(`DELETE FROM punishments WHERE id = ? AND guild_id = ?`).run(punishmentId, guildId);

            // 5. Devolve os pontos na tabela de usuários (FILTRANDO POR GUILD_ID)
            db.prepare(`
                UPDATE users 
                SET reputation = MIN(100, reputation + ?),
                    penalties = MAX(0, penalties - 1)
                WHERE user_id = ? AND guild_id = ?
            `).run(repToRestore, punishment.user_id, guildId);

            // 6. Envio do Log para o canal configurado
            const logSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);
            
            if (logSetting) {
                const logChannel = interaction.guild.channels.cache.get(logSetting.value);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("♻️ Punição Anulada (Sistema de Reputação)")
                        .setColor(0x34d399) // Verde Água/Turquesa
                        .setThumbnail(interaction.guild.iconURL())
                        .addFields(
                            { name: "🆔 ID Anulado", value: `\`#${punishmentId}\``, inline: true },
                            { name: "👤 Usuário Beneficiado", value: `<@${punishment.user_id}>\n(\`${punishment.user_id}\`)`, inline: true },
                            { name: "👮 Staff Responsável", value: `${interaction.user}`, inline: true },
                            { name: "📈 Reputação Restaurada", value: `\`+${repToRestore} pontos\``, inline: true },
                            { name: "📝 Motivo da Anulação", value: `\`\`\`${voidReason}\`\`\`` }
                        )
                        .setFooter({ text: "Esta ação é irreversível e foi registrada no log de auditoria." })
                        .setTimestamp();

                    logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }

            await interaction.editReply({
                content: `✅ Punição **#${punishmentId}** removida com sucesso!\nO usuário <@${punishment.user_id}> recuperou **${repToRestore}** pontos de reputação local.`
            });

        } catch (error) {
            console.error("Erro crítico no delpunir:", error);
            await interaction.editReply("❌ Erro ao processar a anulação no banco de dados. Verifique o console.");
        }
    }
};