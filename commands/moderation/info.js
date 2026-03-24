const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');
const ErrorLogger = require('../../systems/errorLogger');
const ConfigSystem = require('../../systems/configSystem'); // <--- CORREÇÃO: Faltava importar

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
        const { guild, guildId } = interaction;

        try {
            // 2. Consulta de Dados (Otimizada: Buscamos apenas o necessário)
            const repData = db.prepare(`SELECT points FROM reputation WHERE user_id = ? AND guild_id = ?`).get(target.id, guild.id);
            
            const lastPunishments = db.prepare(`
                SELECT id, reason, created_at FROM punishments 
                WHERE user_id = ? AND guild_id = ? 
                ORDER BY created_at DESC LIMIT 3
            `).all(target.id, guild.id);

            // 3. Montagem da Descrição (Seguindo o seu padrão visual)
            const description = [
                `# ${EMOJIS.USER || '👤'} ${target.username}`,
                `Consultando registros de punição no servidor **${guild.name}**.`,
                `### ${EMOJIS.REPUTATION || '📊'} Status de Integridade`,
                `- **Reputação Atual:** \`${repData?.points ?? 100}/100 pts\``,
                `- **ID do Usuário:** \`${target.id}\``,];
            if (lastPunishments.length > 0) {
                description.push(`### ${EMOJIS.TICKET || '📝'} Últimos 3 Registros`);
                lastPunishments.forEach(p => {
                    const date = p.created_at ? `<t:${Math.floor(p.created_at / 1000)}:d>` : 'N/A';
                    const shortReason = p.reason.length > 40 ? p.reason.substring(0, 37) + '...' : p.reason;
                    description.push(`- [${date}] **ID #${p.id}**: \`${shortReason}\``);
                });
            } else {
                description.push(`- *Este usuário não possui registros de punição.*`);
            }

            const embed = new EmbedBuilder()
                .setColor(0xba0054)
                .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
                .setDescription(description)    
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            // 4. Respondemos usando editReply
            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            ErrorLogger.log('Command_Info_Fatal', err);
            
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} Erro técnico ao processar o dossiê. Verifique os logs do sistema.` 
            });
        }
    }
};