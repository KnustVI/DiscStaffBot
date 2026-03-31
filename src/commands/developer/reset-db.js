const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

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
        const { client, guild, user, options } = interaction;
        const confirmacao = options.getString('confirmar');
        
        // Ponto 2: Acesso centralizado
        const db = require('../../../database/index.js'); // Use o caminho central do seu index
        const EMOJIS = client.systems.emojis || {};
        const Config = client.systems.config;

        // 1. Trava de Segurança (Sem defer se não for o dono)
        if (user.id !== DEVELOPER_ID) {
            return interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} **Acesso Negado.** Comando restrito ao desenvolvedor.`
            });
        }

        if (confirmacao !== 'LIMPAR TUDO') {
            return interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} Ação cancelada. Digite exatamente "LIMPAR TUDO".`
            });
        }

        try {
            // 2. Execução da Limpeza em Transação (Performance e Segurança)
            const clearDB = db.transaction(() => {
                db.prepare('DELETE FROM reputation WHERE guild_id = ?').run(guild.id);
                db.prepare('DELETE FROM punishments WHERE guild_id = ?').run(guild.id);
            });
            
            clearDB();

            // Ponto 4: Limpa o cache para este servidor
            if (Config.clearCache) Config.clearCache(guild.id);
            db.pragma('vacuum');

            // 3. Notificação de Log
            const logChanId = Config.getSetting(guild.id, 'logs_channel');
            if (logChanId) {
                const logChannel = await guild.channels.fetch(logChanId).catch(() => null);
                if (logChannel) {
                    const alertEmbed = new EmbedBuilder()
                        .setTitle(`${EMOJIS.WARNING || '⚠️'} ALERTA CRÍTICO: BANCO DE DADOS LIMPO`)
                        .setDescription(`O desenvolvedor ${user} executou um reset global nos dados de reputação e punições.\n\n**O histórico foi apagado permanentemente.**`)
                        .setColor(0xFF3C72)
                        .setFooter(Config.getFooter(guild.name))
                        .setTimestamp();
                    
                    await logChannel.send({ embeds: [alertEmbed] }).catch(() => null);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CLEAN || '🧹'} Database Resetada`)
                .setDescription(`### Operação Concluída com Sucesso\nTodos os dados de **reputação** e **punições** de **${guild.name}** foram removidos.`)
                .setColor(0x00FF7F)
                .setFooter(Config.getFooter(guild.name))
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } catch (err) {
            if (client.systems.logger) client.systems.logger.log('Command_ResetDB_Fatal', err);
            return interaction.editReply({ content: `⚠️ Erro crítico ao resetar o banco.` });
        }
    }
};