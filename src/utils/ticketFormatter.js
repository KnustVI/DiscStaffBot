// src/utils/ticketFormatter.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const EmbedFormatter = require('./embedFormatter');

class TicketFormatter {
    static createPanelEmbed(guildName) {
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# 🎫 Suporte ao Cliente\nClique no botão abaixo para abrir um ticket de atendimento.\n\n**Regras:**\n• Seja educado\n• Aguarde o atendimento\n• Não abra tickets duplicados`)
            .setFooter(EmbedFormatter.getFooter(guildName))
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket:create')
                .setLabel('Abrir Ticket')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎫')
        );

        return { embeds: [embed], components: [row] };
    }

    static createTicketEmbed(ticketId, user, staff = null) {
        const staffText = staff ? `<@${staff.id}>` : 'Nenhum staff presente';
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# 🎫 Ticket ${ticketId}\n**Status:** Aberto\n**Criado por:** ${user.tag}\n**Staff:** ${staffText}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
            .setFooter({ text: `${ticketId}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket:close:${ticketId}`)
                .setLabel('Fechar Ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒')
        );

        return { embeds: [embed], components: [row] };
    }

    static createLogEmbed(ticketId, user, threadLink, staff = null, action = 'open') {
        const isOpen = action === 'open';
        const embed = new EmbedBuilder()
            .setColor(isOpen ? 0xBBF96A : 0xF64B4E)
            .setDescription(`# ${isOpen ? '📩 Ticket Aberto' : '🔒 Ticket Fechado'}\n**ID:** ${ticketId}\n**Usuário:** ${user.tag}\n**Staff:** ${staff ? staff.tag : 'Aguardando'}\n**Thread:** ${threadLink}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket:join:${ticketId}`)
                .setLabel('Entrar no Ticket')
                .setStyle(ButtonStyle.Success)
                .setEmoji('👋')
        );

        return { embeds: [embed], components: [row] };
    }

    static createRatingEmbed() {
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# ⭐ Avalie seu Atendimento\nClique no botão abaixo para avaliar o suporte recebido.`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket:rate')
                .setLabel('Avaliar Atendimento')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⭐')
        );

        return { embeds: [embed], components: [row] };
    }

    static createCloseModal() {
        const modal = new ModalBuilder()
            .setCustomId('ticket:close:modal')
            .setTitle('Fechar Ticket');

        const motivo = new TextInputBuilder()
            .setCustomId('motivo')
            .setLabel('Motivo do fechamento')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Ex: Problema resolvido');

        const resumo = new TextInputBuilder()
            .setCustomId('resumo')
            .setLabel('Resumo do atendimento')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('Descreva o que foi tratado...');

        const punicao = new TextInputBuilder()
            .setCustomId('punicao')
            .setLabel('Punição aplicada (se houver)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('Nenhuma');

        modal.addComponents(
            new ActionRowBuilder().addComponents(motivo),
            new ActionRowBuilder().addComponents(resumo),
            new ActionRowBuilder().addComponents(punicao)
        );

        return modal;
    }

    static createRatingModal() {
        const modal = new ModalBuilder()
            .setCustomId('ticket:rating')
            .setTitle('Avaliar Atendimento');

        const nota = new TextInputBuilder()
            .setCustomId('nota')
            .setLabel('Nota (1 a 5)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Ex: 5');

        const comentario = new TextInputBuilder()
            .setCustomId('comentario')
            .setLabel('Comentário')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('Deixe seu feedback...');

        modal.addComponents(
            new ActionRowBuilder().addComponents(nota),
            new ActionRowBuilder().addComponents(comentario)
        );

        return modal;
    }
}

module.exports = TicketFormatter;