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

    // Embed da DM do usuário
    static createUserDmEmbed(ticketId, user, staff = null, closed = false, motivo = null, punicao = null) {
        if (closed) {
            const embed = new EmbedBuilder()
                .setColor(0xF64B4E)
                .setDescription(`# 🔒 ReportChat Fechado\n**ID:** ${ticketId}\n**Criado por:** ${user.tag}\n**Fechado por:** ${staff ? staff.tag : 'Sistema'}\n**Motivo:** ${motivo || 'Não informado'}\n**Punição:** ${punicao || 'Nenhuma'}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
                .setFooter({ text: `${ticketId}` })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`reportchat:rate:${ticketId}`)
                    .setLabel('⭐ Avaliar Atendimento')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⭐')
            );
            return { embeds: [embed], components: [row] };
        }

        const embed = new EmbedBuilder()
            .setColor(0xBBF96A)
            .setDescription(`# 🎫 ReportChat ${ticketId}\n**Status:** Aberto\n**Criado por:** ${user.tag}\n**Staff:** ${staff ? staff.tag : 'Nenhum staff presente'}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
            .setFooter({ text: `${ticketId}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`reportchat:close:no-rate:${ticketId}`)
                .setLabel('🔒 Fechar sem Avaliação')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒'),
            new ButtonBuilder()
                .setCustomId(`reportchat:close:rate:${ticketId}`)
                .setLabel('⭐ Fechar com Avaliação')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('⭐')
        );

        return { embeds: [embed], components: [row] };
    }

    // Embed da Thread (para staff e usuário)
    static createThreadEmbed(ticketId, user, staff = null, closed = false, motivo = null, punicao = null) {
        if (closed) {
            const embed = new EmbedBuilder()
                .setColor(0xF64B4E)
                .setDescription(`# 🔒 ReportChat Fechado\n**ID:** ${ticketId}\n**Criado por:** ${user.tag}\n**Fechado por:** ${staff ? staff.tag : 'Sistema'}\n**Motivo:** ${motivo || 'Não informado'}\n**Punição:** ${punicao || 'Nenhuma'}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
                .setFooter({ text: `${ticketId}` })
                .setTimestamp();
            return { embeds: [embed], components: [] };
        }

        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# 🎫 ReportChat ${ticketId}\n**Status:** Aberto\n**Criado por:** ${user.tag}\n**Staff:** ${staff ? staff.tag : 'Nenhum staff presente'}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
            .setFooter({ text: `${ticketId}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`reportchat:close:no-reason:${ticketId}`)
                .setLabel('🔒 Fechar sem Motivo')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒'),
            new ButtonBuilder()
                .setCustomId(`reportchat:close:reason:${ticketId}`)
                .setLabel('📝 Fechar com Motivo')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📝')
        );

        return { embeds: [embed], components: [row] };
    }

    // Embed do Log (canal de logs)
    static createLogEmbed(ticketId, user, threadLink, staff = null, action = 'open', motivo = null, punicao = null) {
        const isOpen = action === 'open';
        const embed = new EmbedBuilder()
            .setColor(isOpen ? 0xBBF96A : 0xF64B4E)
            .setDescription(`# ${isOpen ? '📩 ReportChat Aberto' : '🔒 ReportChat Fechado'}\n**ID:** ${ticketId}\n**Usuário:** ${user.tag}\n**Staff:** ${staff ? staff.tag : 'Aguardando'}\n**Thread:** ${threadLink}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`)
            .setTimestamp();

        if (!isOpen && motivo) {
            embed.addFields(
                { name: 'Motivo do Fechamento', value: motivo, inline: false },
                { name: 'Punição Aplicada', value: punicao || 'Nenhuma', inline: false }
            );
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`reportchat:join:${ticketId}`)
                .setLabel('Entrar no ReportChat')
                .setStyle(ButtonStyle.Success)
                .setEmoji('👋')
        );

        return { embeds: [embed], components: [row] };
    }

    static createCloseReasonModal() {
        const modal = new ModalBuilder()
            .setCustomId('reportchat:close:reason:modal')
            .setTitle('Fechar ReportChat');

        const motivo = new TextInputBuilder()
            .setCustomId('motivo')
            .setLabel('Motivo do fechamento')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Ex: Problema resolvido');

        const punicao = new TextInputBuilder()
            .setCustomId('punicao')
            .setLabel('Punição aplicada (se houver)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('Ex: Advertência, Ban, etc');

        modal.addComponents(
            new ActionRowBuilder().addComponents(motivo),
            new ActionRowBuilder().addComponents(punicao)
        );

        return modal;
    }

    static createRatingModal() {
        const modal = new ModalBuilder()
            .setCustomId('reportchat:rating')
            .setTitle('Avaliar Atendimento');

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