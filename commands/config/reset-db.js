const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-db')
        .setDescription('LIMPEZA TOTAL: Apaga todos os dados de reputação e punições.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => 
            opt.setName('confirmar')
               .setDescription('Digite "LIMPAR TUDO" para confirmar a ação')
               .setRequired(true)),

    async execute(interaction) {
        const confirmacao = interaction.options.getString('confirmar');

        if (confirmacao !== 'LIMPAR TUDO') {
            return interaction.reply({ 
                content: '❌ Ação cancelada. Você precisa digitar exatamente "LIMPAR TUDO" para confirmar.', 
                ephemeral: true 
            });
        }

        try {
            // Executa a limpeza nas tabelas principais
            db.prepare('DELETE FROM users').run();
            db.prepare('DELETE FROM punishments').run();
            
            // Otimiza o arquivo do banco de dados
            db.pragma('vacuum');

            const embed = new EmbedBuilder()
                .setTitle('💣 Database Resetada')
                .setDescription('Todos os dados de **reputação** e **histórico de punições** foram apagados com sucesso.')
                .setColor(0xff2e6c)
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error(err);
            return interaction.reply({ content: '❌ Erro ao tentar resetar o banco de dados.', ephemeral: true });
        }
    }
};