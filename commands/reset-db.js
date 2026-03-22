const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../database/database');
const { EMOJIS } = require('../database/emojis');

// Substitua pelo seu ID real do Discord
const DEVELOPER_ID = 'SEU_ID_AQUI'; 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-db')
        .setDescription('⚠️ LIMPEZA TOTAL: Apaga todos os dados de reputação e punições DESTE servidor.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => 
            opt.setName('confirmar')
                .setDescription('Digite "LIMPAR TUDO" para confirmar a ação')
                .setRequired(true)),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const confirmacao = interaction.options.getString('confirmar');

        // --- TRAVA DE DESENVOLVEDOR (KNUSTVI ONLY) ---
        if (interaction.user.id !== DEVELOPER_ID) {
            return interaction.reply({ 
                content: `${EMOJIS.ERRO} **Acesso Negado.** Apenas o desenvolvedor principal pode executar este comando de destruição.`, 
                ephemeral: true 
            });
        }

        if (confirmacao !== 'LIMPAR TUDO') {
            return interaction.reply({ 
                content: `${EMOJIS.ERRO} Ação cancelada. Você precisa digitar corretamente "LIMPAR TUDO".`,
                ephemeral: true 
            });
        }

        try {
            // --- 1. FILTRO POR GUILD_ID (SEGURANÇA) ---
            db.prepare('DELETE FROM users WHERE guild_id = ?').run(guildId);
            db.prepare('DELETE FROM punishments WHERE guild_id = ?').run(guildId);
            
            db.pragma('vacuum');

            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CLEAN} Database Resetada`)
                .setDescription('Todos os dados de **reputação** e **histórico de punições** deste servidor foram apagados permanentemente.')
                .setColor(0xFF3C72)
                .setFooter({ 
                    text: `✧ Executado por Desenvolvedor: KnustVI`, 
                    iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
                })
                .setTimestamp();

            // --- 2. NOTIFICAR NO CANAL DE ALERTAS ---
            const settings = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'alert_channel'`).get(guildId);
            if (settings) {
                const alertChannel = interaction.guild.channels.cache.get(settings.value);
                if (alertChannel) {
                    const alertEmbed = new EmbedBuilder()
                        .setTitle(`${EMOJIS.WARNING} ALERTA CRÍTICO: BANCO DE DADOS LIMPO`)
                        .setDescription(`O desenvolvedor ${interaction.user} resetou todo o histórico do servidor.\n\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
                        .setColor(0xFF3C72)
                        .setTimestamp();
                    alertChannel.send({ embeds: [alertEmbed] }).catch(() => null);
                }
            }

            return interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error(err);
            return interaction.reply({ content: `${EMOJIS.AVISO} Erro ao tentar resetar o banco de dados.`, ephemeral: true });
        }
    }
};