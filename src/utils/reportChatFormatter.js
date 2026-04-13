// src/utils/reportChatFormatter.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const EmbedFormatter = require('./embedFormatter');

let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

class ReportChatFormatter {
    static createMainPanel(guildName) {
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# ${EMOJIS.chat || '🎫'} Bem vindo ao ReportChat\n\nAo clicar no botão "Abrir Report" abaixo, você iniciará um novo atendimento.\n\n## ${EMOJIS.Config || '📋'} Passo a passo:\n- Preencha as informações solicitadas\n- Descreva o ocorrido de forma clara e objetiva\n- Nosso staff irá avaliar e retornará em breve\n\n${EMOJIS.Check || '✅'} Agradecemos por ajudar a manter o ambiente de jogo agradável!`)
            .setFooter(EmbedFormatter.getFooter(guildName))
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('reportchat:create')
                .setLabel('Abrir Report')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(EMOJIS.chat || '🎫')
        );

        return { embeds: [embed], components: [row] };
    }

    static createOpenModal() {
    const modal = new ModalBuilder()
        .setCustomId('reportchat:open:modal')
        .setTitle('Abrir Report');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('seu_nick')
                .setLabel('Seu nick/ID Alderon')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('Ex: KnustVI')
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('alvo_nick')
                .setLabel('Nick/ID do infrator')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('Ex: LupusSaurus')
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('data_hora')
                .setLabel('Data e hora')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('Ex: 09/04/2026 14:30')
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('regra')
                .setLabel('Regra quebrada')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('Ex: Regra 5 - Flood')
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('descricao')
                .setLabel('Descrição')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setPlaceholder('Descreva o ocorrido...')
        )
    );
    return modal;
}

    static createLogEmbed(reportId, user, threadUrl, staffs = [], status = 'waiting', punishment = null, rating = null, ratingComment = null, guildName, closedBy = null, closedReason = null) {
        const statusMap = {
            waiting: `${EMOJIS.clock || '⏳'} Aguardando staff`,
            responded: `${EMOJIS.chat || '💬'} Respondido`,
            inactive: `${EMOJIS.Warning || '⚠️'} Inativo`,
            closed_no_reason: `${EMOJIS.lose || '🔒'} Fechado sem motivo${closedBy ? ` por ${closedBy}` : ''}`,
            closed_with_reason: `${EMOJIS.Check || '✅'} Fechado!${closedReason ? ` "${closedReason}"` : ''}${closedBy ? ` por ${closedBy}` : ''}`
        };

        const statusText = statusMap[status] || status;
        const staffsText = staffs.length > 0 ? staffs.map(s => `<@${s}>`).join(', ') : 'Nenhum staff';
        const isClosed = status === 'closed_no_reason' || status === 'closed_with_reason';
        
        let description = `# ${EMOJIS.chat || '🎫'} Report /${reportId}\n## ${EmbedFormatter.formatUser(user)}\n- **Status:** ${statusText}\n- **Staffs:** ${staffsText}`;
        
        if (punishment) description += `\n- **Punição aplicada:** ${punishment}`;
        if (rating) description += `\n- **Avaliação:** ${'⭐'.repeat(rating)} (${rating}/5)\n- **Comentário:** ${ratingComment || 'Nenhum'}`;
        
        const embed = new EmbedBuilder()
            .setColor(isClosed ? 0xF64B4E : 0xDCA15E)
            .setDescription(description)
            .setFooter(EmbedFormatter.getFooter(guildName || ''))
            .setTimestamp();

        if (!isClosed) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`reportchat:join:${reportId}`)
                    .setLabel('Entrar no chat')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(EMOJIS.staff || '👋'),
                new ButtonBuilder()
                    .setCustomId(`reportchat:close:no-reason:${reportId}`)
                    .setLabel('Fechar')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji(EMOJIS.lose || '🔒'),
                new ButtonBuilder()
                    .setCustomId(`reportchat:close:reason:${reportId}`)
                    .setLabel('Fechar com Motivo')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(EMOJIS.Note || '📝')
            );
            return { embeds: [embed], components: [row] };
        }
        
        return { embeds: [embed], components: [] };
    }

    static createUserDmEmbed(reportId, user, guildName, threadUrl, staffs = [], status = 'waiting', closedBy = null, closedReason = null) {
        const statusMap = {
            waiting: `${EMOJIS.clock || '⏳'} Aguardando staff`,
            responded: `${EMOJIS.chat || '💬'} Respondido`,
            inactive: `${EMOJIS.Warning || '⚠️'} Inativo`,
            closed_no_reason: `${EMOJIS.lose || '🔒'} Fechado sem motivo`,
            closed_with_reason: `${EMOJIS.Check || '✅'} Fechado`
        };

        const statusText = statusMap[status] || status;
        const staffsText = staffs.length > 0 ? staffs.map(s => `<@${s}>`).join(', ') : 'Nenhum staff';
        const isClosed = status === 'closed_no_reason' || status === 'closed_with_reason';
        
        let description = `# ${EMOJIS.chat || '🎫'} Report /${reportId}\n## ${guildName}\nPainel de informações do seu report.\n\n- **Status:** ${statusText}\n- **Staffs:** ${staffsText}`;
        
        if (closedBy) description += `\n- **Fechado por:** ${closedBy}`;
        if (closedReason) description += `\n- **Motivo:** ${closedReason}`;
        
        const embed = new EmbedBuilder()
            .setColor(isClosed ? 0xF64B4E : 0xDCA15E)
            .setDescription(description)
            .setFooter(EmbedFormatter.getFooter(guildName))
            .setTimestamp();

        if (!isClosed) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`reportchat:user:close:no-reason:${reportId}`)
                    .setLabel('Fechar')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji(EMOJIS.lose || '🔒'),
                new ButtonBuilder()
                    .setCustomId(`reportchat:user:close:reason:${reportId}`)
                    .setLabel('Fechar com Motivo')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(EMOJIS.Note || '📝')
            );
            return { embeds: [embed], components: [row] };
        }
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`reportchat:rate:${reportId}`)
                .setLabel('Avaliar Atendimento')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(EMOJIS.star || '⭐')
        );
        
        return { embeds: [embed], components: [row] };
    }

    static createThreadEmbed(reportId, user, guildName, staffRoleId, status = 'waiting', customText = '') {
        const statusMap = {
            waiting: `${EMOJIS.clock || '⏳'} Aguardando staff`,
            responded: `${EMOJIS.chat || '💬'} Respondido`,
            inactive: `${EMOJIS.Warning || '⚠️'} Inativo`,
            closed_no_reason: `${EMOJIS.lose || '🔒'} Fechado sem motivo`,
            closed_with_reason: `${EMOJIS.Check || '✅'} Fechado`
        };

        const statusText = statusMap[status] || status;
        const isClosed = status === 'closed_no_reason' || status === 'closed_with_reason';

        const embed = new EmbedBuilder()
            .setColor(isClosed ? 0xF64B4E : 0xDCA15E)
            .setDescription(`# ${EMOJIS.chat || '🎫'} Report /${reportId} ${guildName}\n## Bem vindo ao ReportChat ${EmbedFormatter.formatUser(user)}!\nLogo um staff deve te atender. Este é um chat privado com ${staffRoleId ? `<@&${staffRoleId}>` : 'a staff'} do servidor.\n${customText}\n\n- **Status:** ${statusText}`)
            .setFooter(EmbedFormatter.getFooter(guildName))
            .setTimestamp();

        return { embeds: [embed], components: [] };
    }

    static createCloseReasonModal() {
    const modal = new ModalBuilder()
        .setCustomId('reportchat:close:reason:modal')
        .setTitle('Fechar Report');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('motivo')
                .setLabel('Motivo')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('Ex: Resolvido')
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('punicao')
                .setLabel('Punição (opcional)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder('Ex: Advertência')
        )
    );
    return modal;
}

    static createUserCloseReasonModal() {
        const modal = new ModalBuilder()
            .setCustomId('reportchat:user:close:reason:modal')
            .setTitle('Fechar ReportChat');

        const motivo = new TextInputBuilder()
            .setCustomId('motivo')
            .setLabel('Motivo do fechamento')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Ex: Problema resolvido');

        modal.addComponents(new ActionRowBuilder().addComponents(motivo));

        return modal;
    }

    static createRatingModal() {
        const modal = new ModalBuilder()
            .setCustomId('reportchat:rating')
            .setTitle('Avaliar');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('nota')
                    .setLabel('Nota (1-5)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('5')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('comentario')
                    .setLabel('Comentário')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setPlaceholder('Seu feedback...')
            )
        );
        return modal;
    }
}

module.exports = ReportChatFormatter;