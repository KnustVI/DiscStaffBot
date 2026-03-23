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
        // 1. Damos o sinal de espera para evitar o timeout do Discord
        await interaction.deferReply({ ephemeral: true });

        const target = interaction.options.getUser('usuario');
        const guildId = interaction.guild.id;

        try {
            // 2. Consulta de Reputação
            const repData = db.prepare(`SELECT points FROM reputation WHERE user_id = ? AND guild_id = ?`).get(target.id, guildId);
            
            // 3. Consulta de Histórico (Limite de 3 para o Dossiê)
            const lastPunishments = db.prepare(`
                SELECT id, reason, created_at FROM punishments 
                WHERE user_id = ? AND guild_id = ? 
                ORDER BY created_at DESC LIMIT 3
            `).all(target.id, guildId);

            // 4. Montagem da Descrição
            const description = [
                `# ${EMOJIS.USUARIO} Dossiê: ${target.username}`,
                `Consultando registros para o servidor **${interaction.guild.name}**.`,
                '',
                `### 📊 Status de Integridade`,
                `- **Reputação Atual:** \`${repData?.points ?? 100}/100 pts\``,
                `- **ID:** \`${target.id}\``,
                '',
            ];

            if (lastPunishments.length > 0) {
                description.push(`### ${EMOJIS.NOTE} Últimos Registros`);
                lastPunishments.forEach(p => {
                    const date = p.created_at ? `<t:${Math.floor(p.created_at / 1000)}:d>` : 'N/A';
                    description.push(`- [${date}] **ID #${p.id}**: \`${p.reason.substring(0, 35)}...\``);
                });
            } else {
                description.push(`- *Este usuário não possui registros de punição.*`);
            }

            const embed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setThumbnail(target.displayAvatarURL({ dynamic: true }))
                .setDescription(description.join('\n'))
                .setTimestamp();

            // 5. Respondemos usando editReply
            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            // Isso vai gravar o erro exato no seu arquivo logs_erro_system.log
            ErrorLogger.log('Command_Info_Fatal', err);
            
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO} Erro técnico ao processar o dossiê. Verifique os logs do sistema.` 
            });
        }
    }
};