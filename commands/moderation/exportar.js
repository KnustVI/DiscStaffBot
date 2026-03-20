const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('exportar')
        .setDescription('Gera um arquivo CSV com o histórico de punições de um usuário específico.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Restrito a Admins por segurança
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Selecione o usuário para exportar o histórico')
                .setRequired(true) // Torna a seleção do usuário OBRIGATÓRIA
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const targetUser = interaction.options.getUser('usuario');

        // Resposta efêmera para manter a privacidade dos dados
        await interaction.deferReply({ ephemeral: true });

        try {
            // 1. BUSCA AS PUNIÇÕES APENAS DO USUÁRIO SELECIONADO
            const rows = db.prepare(`
                SELECT id, moderator_id, reason, severity, ticket_id, created_at 
                FROM punishments 
                WHERE guild_id = ? AND user_id = ?
                ORDER BY created_at DESC
            `).all(guildId, targetUser.id);

            if (rows.length === 0) {
                return interaction.editReply(`${EMOJIS.AVISO} O usuário **${targetUser.tag}** não possui registros de punição.`);
            }

            // 2. CONSTRUÇÃO DO CONTEÚDO DO ARQUIVO CSV
            // \ufeff garante que o Excel abra com acentuação correta (UTF-8 com BOM)
            let csvContent = "\ufeffID;Data;ID Moderador;Gravidade;Ticket;Motivo\n";

            for (const row of rows) {
                const date = new Date(row.created_at).toLocaleString('pt-BR');
                
                // Limpeza básica para não quebrar as colunas do CSV
                const reasonClean = row.reason.replace(/(\r\n|\n|\r|;)/gm, " ");
                const severityText = row.severity === 0 ? "ANULADA" : `Nível ${row.severity}`;

                csvContent += `${row.id};${date};${row.moderator_id};${severityText};${row.ticket_id || 'N/A'};${reasonClean}\n`;
            }

            // 3. CRIAÇÃO E ENVIO DO ANEXO
            const buffer = Buffer.from(csvContent, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { 
                name: `historico_${targetUser.username}_${targetUser.id}.csv` 
            });

            await interaction.editReply({ 
                content: `${EMOJIS.CHECK} Relatório individual de **${targetUser.tag}** gerado com sucesso!`, 
                files: [attachment] 
            });

        } catch (error) {
            console.error("Erro ao exportar histórico individual:", error);
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO} Ocorreu um erro ao gerar o arquivo de exportação.` 
            });
        }
    }
};