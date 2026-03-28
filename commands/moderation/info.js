const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');
const ErrorLogger = require('../../systems/errorLogger');
const ConfigSystem = require('../../systems/configSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Consulta técnica de um usuário no banco de dados.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário para consulta').setRequired(true)),

    async execute(interaction) {
        // ==========================================================
        // REMOVIDO: await interaction.deferReply({ ephemeral: true }); 
        // (Já está sendo feito no seu interactionCreate.js)
        // ==========================================================

        // 2. Verificação de Autorização
        const auth = await ConfigSystem.checkAuth(interaction);
        if (!auth.authorized) {
            // Usamos editReply pois o defer global já foi enviado
            return await interaction.editReply({ content: auth.message });
        }

        const target = interaction.options.getUser('usuario');
        const { guild } = interaction;

        try {
            // 3. Consulta de Dados
            const repData = db.prepare(`SELECT points FROM reputation WHERE user_id = ? AND guild_id = ?`).get(target.id, guild.id);
            
            const lastPunishments = db.prepare(`
                SELECT id, reason, created_at FROM punishments 
                WHERE user_id = ? AND guild_id = ? 
                ORDER BY created_at DESC LIMIT 3
            `).all(target.id, guild.id);

            // 4. Montagem da Descrição
            const descriptionArray = [
                `# ${EMOJIS.USER || '👤'} ${target.username}`,
                `Consultando registros de integridade no servidor **${guild.name}**.`,
                `### ${EMOJIS.REPUTATION || '📊'} Status de Integridade`,
                `- **Reputação Atual:** \`${repData?.points ?? 100}/100 pts\``,
                `- **ID do Usuário:** \`${target.id}\``,
                ''
            ];

            if (lastPunishments.length > 0) {
                descriptionArray.push(`### ${EMOJIS.TICKET || '📝'} Últimos 3 Registros`);
                lastPunishments.forEach(p => {
                    const date = p.created_at ? `<t:${Math.floor(p.created_at / 1000)}:d>` : 'N/A';
                    const shortReason = p.reason.length > 40 ? p.reason.substring(0, 37) + '...' : p.reason;
                    descriptionArray.push(`- [${date}] **ID #${p.id}**: \`${shortReason}\``);
                });
            } else {
                descriptionArray.push(`- *Este usuário não possui registros de punição.*`);
            }

            // 5. Criação da Embed
            const embed = new EmbedBuilder()
                .setColor(0xba0054)
                .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
                .setDescription(descriptionArray.join('\n'))    
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            // 6. Resposta Final (Sempre editReply)
            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            ErrorLogger.log('Command_Info_Fatal', err);
            console.error(`[Info Error]`, err);
            
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} **Erro técnico ao processar o Info:**\n\`${err.message}\`` 
            });
        }
    }
};