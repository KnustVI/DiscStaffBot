const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetrep')
        .setDescription('Reseta completamente a reputação e histórico local de um usuário.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('usuario').setDescription('O usuário que terá a ficha limpa').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do reset (para os logs)').setRequired(true)),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const target = interaction.options.getUser('usuario');
        const reason = interaction.options.getString('motivo');

        // 1. Verificação de Configuração
        const logChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);
        
        // Apenas Admins podem resetar (conforme definido no Data)
        await interaction.deferReply({ ephemeral: true });

        try {
            // 2. Executa o Reset no Banco de Dados (Transação)
            // É recomendável usar uma transação para garantir que ambos os deletes ocorram
            const deleteUser = db.prepare('DELETE FROM users WHERE user_id = ? AND guild_id = ?');
            const deleteHistory = db.prepare('DELETE FROM punishments WHERE user_id = ? AND guild_id = ?');

            // Iniciando a limpeza
            const userReset = deleteUser.run(target.id, guildId);
            deleteHistory.run(target.id, guildId); // Limpa o histórico de punições também

            if (userReset.changes === 0) {
                return interaction.editReply(`⚠️ O usuário **${target.displayName}** já possui uma ficha limpa (sem registros ativos no banco).`);
            }

            // 3. Envio de Log para a Staff (Padronizado)
            if (logChannelSetting) {
                const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setDescription("# 🧹 Ficha Limpa: Reset de Reputação")
                        .setColor(0x3498db) // Azul claro para diferenciar de punição/revogação
                        .addFields(
                            { name: "👤 Usuário Resetado", value: `${target} (\`${target.id}\`)`, inline: true },
                            { name: "👮 Responsável", value: `${interaction.user}`, inline: true },
                            { name: "📉 Status Anterior", value: `\`Ficha Deletada\``, inline: true },
                            { name: "📝 Motivo do Reset", value: `\`\`\`${reason}\`\`\`` }
                        )
                        .setFooter({ 
                            text: interaction.guild.name, 
                            iconURL: interaction.guild.iconURL({ forceStatic: false }) 
                        })
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }

            await interaction.editReply({ 
                content: `✅ O histórico e a reputação de **${target.displayName}** foram completamente apagados.` 
            });

        } catch (error) {
            console.error(error);
            await interaction.editReply("❌ Erro técnico ao tentar resetar os dados no SQLite.");
        }
    }
};