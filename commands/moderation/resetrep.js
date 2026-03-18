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

        // 1. Verificação de Configuração (Mesma trava do /punir)
        const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const logChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);

        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasRole = staffRoleSetting ? interaction.member.roles.cache.has(staffRoleSetting.value) : false;

        if (!isAdmin && !hasRole) {
            return interaction.reply({ content: "❌ Você não tem permissão para resetar reputações.", ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            // 2. Executa o Reset no Banco de Dados
            // Deletamos o registro do usuário na tabela 'users' para aquele servidor.
            // Quando ele usar /perfil novamente, o bot o verá como um "visitante" (100 rep).
            const result = db.prepare('DELETE FROM users WHERE user_id = ? AND guild_id = ?').run(target.id, guildId);

            if (result.changes === 0) {
                return interaction.editReply(`⚠️ O usuário **${target.username}** já possui uma ficha limpa (sem registros no banco).`);
            }

            // 3. Envio de Log para a Staff
            if (logChannelSetting) {
                const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("🧹 Reputação Resetada")
                        .setColor(0xff2e6c)
                        .addFields(
                            { name: "👤 Usuário Resetado", value: `${target} (\`${target.id}\`)`, inline: true },
                            { name: "👮 Responsável", value: `${interaction.user}`, inline: true },
                            { name: "📝 Motivo do Reset", value: `\`\`\`${reason}\`\`\`` }
                        )
                        .setTimestamp();

                    logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }

            await interaction.editReply({ 
                content: `✅ A reputação e estatísticas de **${target.username}** foram resetadas com sucesso neste servidor.` 
            });

        } catch (error) {
            console.error(error);
            await interaction.editReply("❌ Erro ao tentar resetar a reputação no banco de dados.");
        }
    }
};