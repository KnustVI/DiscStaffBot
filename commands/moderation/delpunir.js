const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delpunir')
        .setDescription('Apaga uma punição específica do histórico (Uso restrito)')
        .addIntegerOption(opt => 
            opt.setName('id')
                .setDescription('O ID da punição (encontrado no comando /historico)')
                .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('motivo')
                .setDescription('Motivo da remoção (para os logs)')
                .setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // --- VERIFICAÇÃO DE STAFF/ADM ---
        const staffSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasStaffRole = staffSetting ? interaction.member.roles.cache.has(staffSetting.value) : false;

        if (!isAdmin && !hasStaffRole) {
            return interaction.reply({ content: "❌ Você não tem permissão para remover punições.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const punishmentId = interaction.options.getInteger('id');
        const reasonRemoval = interaction.options.getString('motivo');

        try {
            // 1. Verificar se a punição existe (Aqui usamos guild_id pois punições são por servidor)
            const punishment = db.prepare(`SELECT * FROM punishments WHERE id = ? AND guild_id = ?`).get(punishmentId, guildId);

            if (!punishment) {
                return interaction.editReply(`❌ Nenhuma punição encontrada com o ID **#${punishmentId}** neste servidor.`);
            }

            // 2. Deletar a punição
            db.prepare(`DELETE FROM punishments WHERE id = ? AND guild_id = ?`).run(punishmentId, guildId);

            // 3. Restaurar Reputação (TABELA USERS NÃO TEM GUILD_ID)
            const penaltyValues = { 1: 2, 2: 5, 3: 10, 4: 20, 5: 35 };
            const repToRestore = penaltyValues[punishment.severity] || 0;

            db.prepare(`
                UPDATE users 
                SET reputation = MIN(100, reputation + ?),
                    penalties = MAX(0, penalties - 1)
                WHERE user_id = ?
            `).run(repToRestore, punishment.user_id);

            // 4. Enviar log da remoção
            const logSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);
            if (logSetting) {
                const logChannel = interaction.guild.channels.cache.get(logSetting.value);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("🗑️ Punição Removida")
                        .setColor(0x00FF00)
                        .addFields(
                            { name: "🆔 ID Punição", value: `#${punishmentId}`, inline: true },
                            { name: "👤 Usuário", value: `<@${punishment.user_id}>`, inline: true },
                            { name: "👮 Staff", value: `${interaction.user}`, inline: true },
                            { name: "📉 Restauro", value: `+${repToRestore} pontos`, inline: true },
                            { name: "📝 Motivo", value: reasonRemoval }
                        )
                        .setTimestamp();

                    logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }

            await interaction.editReply(`✅ A punição **#${punishmentId}** foi removida e a reputação de <@${punishment.user_id}> foi restaurada.`);

        } catch (error) {
            console.error("Erro ao deletar punição:", error);
            await interaction.editReply("❌ Ocorreu um erro ao processar o banco de dados.");
        }
    }
};