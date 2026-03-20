const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis'); // Importe os emojis

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-db')
        .setDescription('LIMPEZA TOTAL: Apaga todos os dados de reputação e punições DESTE servidor.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => 
            opt.setName('confirmar')
               .setDescription('Digite "LIMPAR TUDO" para confirmar a ação')
               .setRequired(true)),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const confirmacao = interaction.options.getString('confirmar');

        if (confirmacao !== 'LIMPAR TUDO') {
            return interaction.reply({ 
                content: `${EMOJIS.ERRO} Ação cancelada. Você precisa digitar "LIMPAR TUDO".`,
                ephemeral: true 
            });
        }

        try {
            // --- 1. FILTRO POR GUILD_ID (SEGURANÇA) ---
            // IMPORTANTE: Sem o WHERE, você apagaria os dados de todos os clientes do bot!
            db.prepare('DELETE FROM users WHERE guild_id = ?').run(guildId);
            db.prepare('DELETE FROM punishments WHERE guild_id = ?').run(guildId);
            
            // Otimiza o arquivo do banco (O vacuum reconstrói o arquivo para economizar espaço)
            db.pragma('vacuum');

            const embed = new EmbedBuilder()
                .setDescription(
                    `${EMOJIS.CLEAN} **Database Resetada**\n` +
                    'Todos os dados de **reputação** e **histórico de punições** deste servidor foram apagados.')
                .setColor(0xFF3C72)
                .setFooter({ 
                    text: `✧ BOT by: KnustVI`, 
                    iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
                })
                .setTimestamp();

            // --- 2. NOTIFICAR NO CANAL DE ALERTAS (AUDITORIA) ---
            const alertChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'alert_channel'`).get(guildId);
            if (alertChannelSetting) {
                const alertChannel = interaction.guild.channels.cache.get(alertChannelSetting.value);
                if (alertChannel) {
                    const alertEmbed = new EmbedBuilder()
                        .setDescription(
                            `# ${EMOJIS.WARNING} ALERTA: BANCO DE DADOS LIMPO\n` +
                            `O administrador ${interaction.user} acabou de resetar todo o histórico de punições e reputação do servidor.`)
                        .setColor(0xFF3C72)
                        .setTimestamp();
                    alertChannel.send({ embeds: [alertEmbed] }).catch(() => null);
                }
            }

            return interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error(err);
            return interaction.reply({ content: '${EMOJIS.AVISO} Erro ao tentar resetar o banco de dados.', ephemeral: true });
        }
    }
};