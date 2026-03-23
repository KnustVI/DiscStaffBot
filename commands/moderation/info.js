const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');
const ErrorLogger = require('../../systems/errorLogger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Consulta técnica de um usuário no banco de dados.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário para consulta').setRequired(true)),

    async execute(interaction) {
        const target = interaction.options.getUser('usuario');
        const guildId = interaction.guild.id;

        try {
            // 1. Consulta de Reputação (Tabela: reputation)
            const repData = db.prepare(`SELECT * FROM reputation WHERE user_id = ? AND guild_id = ?`).get(target.id, guildId);
            
            // 2. Consulta de Histórico (Tabela: punishments)
            const lastPunishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE user_id = ? AND guild_id = ? 
                ORDER BY created_at DESC LIMIT 3
            `).all(target.id, guildId);

            if (!repData && lastPunishments.length === 0) {
                return interaction.reply({ content: `${EMOJIS.ERRO} Este usuário não possui nenhum registro no banco de dados.`, ephemeral: true });
            }

            // 3. Formatação da Descrição com Headings
            const description = [
                `# ${EMOJIS.USUARIO} Dossiê: ${target.username}`,
                `Consultando registros de integridade para o servidor **${interaction.guild.name}**.`,
                '',
                `### 📊 Status de Integridade`,
                `- **Reputação Atual:** \`${repData?.points ?? 100}/100 pts\``,
                `- **Total de Ocorrências:** \`${lastPunishments.length}\` (últimas registradas)`,
                `- **ID do Usuário:** \`${target.id}\``,
                '',
            ];

            if (lastPunishments.length > 0) {
                description.push(`### ${EMOJIS.NOTE} Últimos Registros`);
                lastPunishments.forEach(p => {
                    // Formatação de data simples para o Discord
                    const date = p.created_at ? `<t:${Math.floor(p.created_at / 1000)}:d>` : 'Data N/A';
                    description.push(`- [${date}] **ID #${p.id}**: \`${p.reason.substring(0, 40)}${p.reason.length > 40 ? '...' : ''}\``);
                });
            } else {
                description.push(`- *Nenhum histórico de punição encontrado.*`);
            }

            const embed = new EmbedBuilder()
                .setColor(0x2B2D31) // Cor Dark para parecer terminal técnico
                .setThumbnail(target.displayAvatarURL({ dynamic: true }))
                .setDescription(description.join('\n'))
                .setFooter({ text: `Consulta realizada por ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (err) {
            // Registro de erro técnico
            ErrorLogger.log('Command_Info_Execute', err);
            await interaction.reply({ 
                content: `${EMOJIS.ERRO} Erro técnico ao processar o dossiê. Verifique os logs do sistema.`, 
                ephemeral: true 
            });
        }
    }
};