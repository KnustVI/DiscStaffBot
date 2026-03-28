const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');
const ConfigSystem = require('../../systems/configSystem');
const ConfigCache = require('../../systems/configCache'); // Adicionado
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

        // 1. Trava de Segurança
        if (user.id !== DEVELOPER_ID) {
            return interaction.reply({ 
                content: `${EMOJIS.ERRO || '❌'} **Acesso Negado.** Comando restrito ao desenvolvedor.`, 
                ephemeral: true 
            });
        }

        await interaction.deferReply(); 

        if (confirmacao !== 'LIMPAR TUDO') {
            return interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} Ação cancelada. Digite exatamente "LIMPAR TUDO".`
            });
        }

        try {
            // 2. Execução da Limpeza em Transação
            const clearDB = db.transaction(() => {
                // Apaga Reputação e Punições
                db.prepare('DELETE FROM reputation WHERE guild_id = ?').run(guild.id);
                db.prepare('DELETE FROM punishments WHERE guild_id = ?').run(guild.id);
                
                // OPCIONAL: Se quiser resetar as CONFIGURAÇÕES do bot também:
                // db.prepare('DELETE FROM settings WHERE guild_id = ?').run(guild.id);
            });
            
            clearDB();

            // Limpa o cache da RAM para este servidor (Garante que o bot leia o banco vazio)
            ConfigCache.deleteGuild(guild.id);

            // Otimiza o arquivo físico na VPS
            db.pragma('vacuum');

            // 3. Notificação de Log (Usando nosso sistema de cache)
            const logChanId = ConfigSystem.getSetting(guild.id, 'logs_channel');
            if (logChanId) {
                const logChannel = await guild.channels.fetch(logChanId).catch(() => null);
                if (logChannel) {
                    const alertEmbed = new EmbedBuilder()
                        .setTitle(`${EMOJIS.WARNING || '⚠️'} ALERTA CRÍTICO: BANCO DE DADOS LIMPO`)
                        .setDescription(`O desenvolvedor ${user} executou um reset global nos dados de reputação e punições.\n\n**O histórico foi apagado permanentemente.**`)
                        .setColor(0xFF3C72)
                        .setFooter(ConfigSystem.getFooter(guild.name))
                        .setTimestamp();
                    
                    await logChannel.send({ embeds: [alertEmbed] }).catch(() => null);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CLEAN || '🧹'} Database Resetada`)
                .setDescription(`### Operação Concluída com Sucesso\nTodos os dados de **reputação** e **punições** de **${guild.name}** foram removidos.\n\n*Nota: As configurações de cargos/canais foram mantidas (ou limpas no cache).*`)
                .setColor(0x00FF7F) // Verde para sucesso
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } catch (err) {
            ErrorLogger.log('Command_ResetDB_Fatal', err);
            return interaction.editReply({ content: `${EMOJIS.AVISO || '⚠️'} Erro crítico ao resetar o banco. Verifique o console.` });
        }
    }
};