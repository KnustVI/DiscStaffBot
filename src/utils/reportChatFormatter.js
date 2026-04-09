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
    // ==================== PAINEL PRINCIPAL ====================
    static createMainPanel(guildName) {
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# ${EMOJIS.chat || '🎫'} Bem vindo ao ReportChat\n\nAo clicar no botão "Abrir Report" abaixo, você iniciará um novo atendimento.\n\n## ${EMOJIS.Config || '📋'} Passo a passo:\n- Preencha as informações solicitadas (Seu nick/ID Alderon, Nick/ID Alderon do infrator, data/hora e regra quebrada).\n- Descreva o ocorrido de forma clara e objetiva.\n- Sempre que possível, anexe ou envie vídeos da situação – isso acelera muito a nossa análise.\n- Nosso staff irá avaliar e retornará em breve.\n\n## ${EMOJIS.shinystar || '⭐'} Regra de ouro:\nTenha respeito pelo staff e pelos outros jogadores. Seremos respeitosos com você também. Um ambiente tranquilo ajuda todo mundo.\n\n${EMOJIS.Check || '✅'} Agradecemos por ajudar a manter o ambiente de jogo agradável!`)
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

    // ==================== MODAL DE ABERTURA ====================
    static createOpenModal() {
        console.log('✅ Criando modal de abertura');
        const modal = new ModalBuilder()
            .setCustomId('reportchat:open:modal')
            .setTitle('Abrir ReportChat');

        const seuNick = new TextInputBuilder()
            .setCustomId('seu_nick')
            .setLabel('Seu nick/ID Alderon')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Ex: KnustVI');

        const alvoNick = new TextInputBuilder()
            .setCustomId('alvo_nick')
            .setLabel('Nick/ID Alderon do infrator')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Ex: LupusSaurus');

        const dataHora = new TextInputBuilder()
            .setCustomId('data_hora')
            .setLabel('Data e hora do ocorrido')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Ex: 09/04/2026 14:30');

        const regra = new TextInputBuilder()
            .setCustomId('regra')
            .setLabel('Regra quebrada')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Ex: Regra 5 - Flood');

        const descricao = new TextInputBuilder()
            .setCustomId('descricao')
            .setLabel('Descrição do ocorrido')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('Descreva detalhadamente o que aconteceu...');

        modal.addComponents(
            new ActionRowBuilder().addComponents(seuNick),
            new ActionRowBuilder().addComponents(alvoNick),
            new ActionRowBuilder().addComponents(dataHora),
            new ActionRowBuilder().addComponents(regra),
            new ActionRowBuilder().addComponents(descricao)
        );
        console.log('✅ Modal criado com sucesso');
        return modal;
    }

    // ==================== EMBED DO LOG (canal de logs) ====================
    static createLogEmbed(reportId, user, threadUrl, staffs = [], status = 'waiting', punishment = null, rating = null, ratingComment = null, guildName) {
        const statusMap = {
            waiting: `${EMOJIS.clock || '⏳'} Aguardando staff`,
            responded: `${EMOJIS.chat || '💬'} Respondido`,
            inactive: `${EMOJIS.Warning || '⚠️'} Inativo`,
            closed_no_reason: `${EMOJIS.lose || '🔒'} Fechado sem motivo`,
            closed_with_reason: `${EMOJIS.Check || '✅'} Fechado`
        };

        const statusText = statusMap[status] || status;
        const staffsText = staffs.length > 0 ? staffs.map(s => `<@${s}>`).join(', ') : 'Nenhum staff';
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# ${EMOJIS.chat || '🎫'} Report /${reportId}\n## <@${user.id}>\n- **Status:** ${statusText}\n- **Thread:** [Clique aqui](${threadUrl})\n- **Staffs:** ${staffsText}\n${punishment ? `- **Punição aplicada:** ${punishment}` : ''}\n${rating ? `- **Avaliação:** ${'⭐'.repeat(rating)} (${rating}/5)\n- **Comentário:** ${ratingComment || 'Nenhum'}` : ''}`)
            .setFooter(EmbedFormatter.getFooter(guildName))
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`reportchat:join:${reportId}`)
                .setLabel('Entrar no chat')
                .setStyle(ButtonStyle.Success)
                .setEmoji(EMOJIS.staff || '👋')
        );

        return { embeds: [embed], components: status === 'closed_no_reason' || status === 'closed_with_reason' ? [] : [row] };
    }

    // ==================== EMBED DA DM DO USUÁRIO ====================
    static createUserDmEmbed(reportId, user, guildName, threadUrl, staffs = [], status = 'waiting') {
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

        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# ${EMOJIS.chat || '🎫'} Report /${reportId}\n## ${guildName}\nEsse é o painel de informações do seu report, caso ocorra algum bug ou problema avise a equipe do servidor em questão.\n\n- **Status:** ${statusText}\n- **Thread:** [Clique aqui](${threadUrl})\n- **Staffs:** ${staffsText}`)
            .setFooter(EmbedFormatter.getFooter(guildName))
            .setTimestamp();

        let row;
        if (!isClosed) {
            row = new ActionRowBuilder().addComponents(
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
        } else {
            row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`reportchat:rate:${reportId}`)
                    .setLabel('Avaliar Atendimento')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(EMOJIS.star || '⭐')
            );
        }

        return { embeds: [embed], components: [row] };
    }

    // ==================== EMBED DA THREAD ====================
    static createThreadEmbed(reportId, user, guildName, staffRoleId, status = 'waiting', customText = '') {
        const statusMap = {
            waiting: `${EMOJIS.clock || '⏳'} Aguardando staff`,
            responded: `${EMOJIS.chat || '💬'} Respondido`,
            inactive: `${EMOJIS.Warning || '⚠️'} Inativo`
        };

        const statusText = statusMap[status] || status;
        const isClosed = status === 'closed_no_reason' || status === 'closed_with_reason';

        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# ${EMOJIS.chat || '🎫'} Report /${reportId} ${guildName}\n## Bem vindo ao ReportChat <@${user.id}>!\nLogo um staff deve te atender. Este é um chat privado com ${staffRoleId ? `<@&${staffRoleId}>` : 'a staff'} do servidor.\nCaso identifique algum bug avise a equipe do servidor.\n${customText}\n\n- **Status:** ${statusText}`)
            .setFooter(EmbedFormatter.getFooter(guildName))
            .setTimestamp();

        let row;
        if (!isClosed) {
            row = new ActionRowBuilder().addComponents(
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
        } else {
            row = new ActionRowBuilder().addComponents();
        }

        return { embeds: [embed], components: [row] };
    }

    // ==================== MODAIS ====================
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
            .setPlaceholder('Ex: Advertência, Ban, Strike');

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

module.exports = ReportChatFormatter;