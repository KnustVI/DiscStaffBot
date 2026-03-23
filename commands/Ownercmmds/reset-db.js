const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');
const ConfigSystem = require('../../systems/configSystem');
const ErrorLogger = require('../../systems/errorLogger');

const DEVELOPER_ID = '203676076189286412'; 

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
        const { guild, user, options } = interaction;
        const confirmacao = options.getString('confirmar');

        // 1. Trava de Segurança e Defer (Anti-Lag)
        if (user.id !== DEVELOPER_ID) {
            return interaction.reply({ 
                content: `${EMOJIS.ERRO} **Acesso Negado.** Comando restrito ao desenvolvedor.`, 
                ephemeral: true 
            });
        }

        await interaction.deferReply(); // Reset pode ser lento, evitamos o erro de resposta

        if (confirmacao !== 'LIMPAR TUDO') {
            return interaction.editReply({ 
                content: `${EMOJIS.ERRO} Ação cancelada. Digite exatamente "LIMPAR TUDO".`
            });
        }

        try {
            // 2. Execução da Limpeza (Usando os nomes novos das tabelas)
            // Usamos uma transação para garantir que apague tudo ou nada
            const clearDB = db.transaction(() => {
                db.prepare('DELETE FROM reputation WHERE guild_id = ?').run(guild.id);
                db.prepare('DELETE FROM punishments WHERE guild_id = ?').run(guild.id);
            });
            
            clearDB();

            // Opcional: Otimiza o arquivo .db no disco da Oracle Cloud
            db.pragma('vacuum');

            // 3. Notificação no Canal de Alertas (Usando seu ConfigSystem/Cache)
            const alertChanId = ConfigSystem.getSetting(guild.id, 'alert_channel');
            if (alertChanId) {
                const alertChannel = guild.channels.cache.get(alertChanId);
                if (alertChannel) {
                    const alertEmbed = new EmbedBuilder()
                        .setTitle(`${EMOJIS.WARNING} ALERTA CRÍTICO: BANCO DE DADOS LIMPO`)
                        .setDescription(`# LIMPEZA TOTAL\nO desenvolvedor ${user} resetou todo o histórico do servidor.\n\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
                        .setColor(0xFF3C72)
                        .setTimestamp();
                    
                    await alertChannel.send({ embeds: [alertEmbed] }).catch(() => null);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CLEAN} Database Resetada`)
                .setDescription(`# Operação Concluída\nTodos os dados de **reputação** e **punições** de **${guild.name}** foram apagados permanentemente.`)
                .setColor(0xFF3C72)
                .setFooter({ text: `✧ Executado por: KnustVI`, iconURL: user.displayAvatarURL() })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } catch (err) {
            ErrorLogger.log('Command_ResetDB_Fatal', err);
            return interaction.editReply({ content: `${EMOJIS.AVISO} Erro crítico ao resetar o banco. Verifique o ErrorLogger.` });
        }
    }
};