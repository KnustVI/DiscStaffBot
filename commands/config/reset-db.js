const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

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
                content: '❌ Ação cancelada. Você precisa digitar exatamente "LIMPAR TUDO" para confirmar.', 
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
                .setTitle('💣 Database Resetada')
                .setDescription('Todos os dados de **reputação** e **histórico de punições** deste servidor foram apagados.')
                .setColor(0xff2e6c)
                .setFooter({ text: `Executado por: ${interaction.user.tag}` })
                .setTimestamp();

            // --- 2. NOTIFICAR NO CANAL DE ALERTAS (AUDITORIA) ---
            const alertChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'alert_channel'`).get(guildId);
            if (alertChannelSetting) {
                const alertChannel = interaction.guild.channels.cache.get(alertChannelSetting.value);
                if (alertChannel) {
                    const alertEmbed = new EmbedBuilder()
                        .setTitle('🚨 ALERTA: BANCO DE DADOS LIMPO')
                        .setDescription(`O administrador ${interaction.user} acabou de resetar todo o histórico de punições e reputação do servidor.`)
                        .setColor(0xFF0000)
                        .setTimestamp();
                    alertChannel.send({ embeds: [alertEmbed] }).catch(() => null);
                }
            }

            return interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error(err);
            return interaction.reply({ content: '❌ Erro ao tentar resetar o banco de dados.', ephemeral: true });
        }
    }
};