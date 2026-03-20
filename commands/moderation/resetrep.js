const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetrep')
        .setDescription('Reseta completamente a reputação e histórico local de um usuário.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Trava visual (esconde o comando)
        .addUserOption(opt => opt.setName('usuario').setDescription('O usuário que terá a ficha limpa').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do reset (para os logs)').setRequired(true)),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const target = interaction.options.getUser('usuario');
        const reason = interaction.options.getString('motivo');

        // --- 1. VERIFICAÇÃO DE SEGURANÇA MANUAL ---
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: `${EMOJIS.ERRO} Apenas administradores do servidor podem utilizar este comando.`, 
                ephemeral: true 
            });
        }

        const logChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);
        
        await interaction.deferReply({ ephemeral: true });

        try {
            // --- 2. EXECUÇÃO EM TRANSAÇÃO (SQLite) ---
            // Usamos transaction para garantir integridade: ou apaga tudo, ou nada.
            const performReset = db.transaction((userId, gId) => {
                const userDeleted = db.prepare('DELETE FROM users WHERE user_id = ? AND guild_id = ?').run(userId, gId);
                db.prepare('DELETE FROM punishments WHERE user_id = ? AND guild_id = ?').run(userId, gId);
                return userDeleted.changes;
            });

            const resultChanges = performReset(target.id, guildId);

            if (resultChanges === 0) {
                return interaction.editReply(`${EMOJIS.AVISO} O usuário **${target.displayName}** não possui registros ativos no banco de dados.`);
            }

            // --- 3. ENVIO DE LOG PARA A STAFF ---
            if (logChannelSetting) {
                const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setDescription(`# ${EMOJIS.CLEAN} Reset de Reputação`)
                        .setColor(0x3498db) 
                        .addFields(
                            { name: `${EMOJIS.USUARIO} Usuário Resetado`, value: `${target} (\`${target.id}\`)`, inline: true },
                            { name: `${EMOJIS.STAFF} Responsável`, value: `${interaction.user}`, inline: true },
                            { name: `${EMOJIS.STATUS} Status Anterior`, value: `\`Ficha Deletada\``, inline: false },
                            { name: `${EMOJIS.NOTE} Motivo do Reset`, value: `\`\`\`${reason}\`\`\`` }
                        )
                        .setFooter({ 
                            text: `✧ BOT by: KnustVI`, 
                            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
                        })
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }

            await interaction.editReply({ 
                content: `${EMOJIS.CHECK} O histórico e a reputação de **${target.displayName}** foram completamente apagados com sucesso.` 
            });

        } catch (error) {
            console.error("Erro no comando resetrep:", error);
            await interaction.editReply(`${EMOJIS.ERRO} Erro técnico ao tentar resetar os dados no SQLite.`);
        }
    }
};