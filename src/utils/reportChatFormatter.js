// src/utils/reportChatFormatter.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const EmbedFormatter = require('./embedFormatter');

class ReportChatFormatter {
    static createPanelEmbed(guildName) {
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# 🎫 ReportChat\nClique no botão abaixo para abrir um canal de atendimento.\n\n**Regras:**\n• Seja educado\n• Aguarde o atendimento\n• Não abra canais duplicados`)
            .setFooter(EmbedFormatter.getFooter(guildName))
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('reportchat:create')
                .setLabel('Abrir ReportChat')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎫')
        );

        return { embeds: [embed], components: [row] };
    }

    static createTicketEmbed(ticketId, user, staff = null) {
        const staffText = staff ? `<@${staff.id}>` : 'Nenhum staff presente';
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# 🎫 ReportChat ${ticketId}\n**Status:** Aberto\n**Criado por:** ${user.tag}\n**Staff:** ${staffText}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
            .setFooter({ text: `${ticketId}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`reportchat:close:rate:${ticketId}`)
                .setLabel('⭐ Avaliar e Fechar')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('⭐'),
            new ButtonBuilder()
                .setCustomId(`reportchat:close:no-rate:${ticketId}`)
                .setLabel('🔒 Fechar sem Avaliação')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒')
        );

        return { embeds: [embed], components: [row] };
    }

    static createLogEmbed(ticketId, user, threadLink, staff = null, action = 'open') {
        const isOpen = action === 'open';
        const embed = new EmbedBuilder()
            .setColor(isOpen ? 0xBBF96A : 0xF64B4E)
            .setDescription(`# ${isOpen ? '📩 ReportChat Aberto' : '🔒 ReportChat Fechado'}\n**ID:** ${ticketId}\n**Usuário:** ${user.tag}\n**Staff:** ${staff ? staff.tag : 'Aguardando'}\n**Thread:** ${threadLink}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`reportchat:join:${ticketId}`)
                .setLabel('Entrar no ReportChat')
                .setStyle(ButtonStyle.Success)
                .setEmoji('👋')
        );

        return { embeds: [embed], components: [row] };
    }

    static createRatingModal() {
        const modal = new ModalBuilder()
            .setCustomId('reportchat:rating')
            .setTitle('Avaliar Staff');

        const nota = new TextInputBuilder()
            .setCustomId('nota')
            .setLabel('Nota para o staff (1 a 5)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Ex: 5');

        const comentario = new TextInputBuilder()
            .setCustomId('comentario')
            .setLabel('Comentário (opcional)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('Deixe seu feedback sobre o atendimento...');

        modal.addComponents(
            new ActionRowBuilder().addComponents(nota),
            new ActionRowBuilder().addComponents(comentario)
        );

        return modal;
    }
}

module.exports = ReportChatFormatter;