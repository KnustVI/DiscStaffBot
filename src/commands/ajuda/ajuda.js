// /home/ubuntu/DiscStaffBot/src/commands/utility/ajuda.js
const { SlashCommandBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../../database/index');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { PaginationBuilder } = require('../../utils/paginationBuilder');

// ---------------------------------------------------------------------------
// Fábrica de páginas — /ajuda funciona como um tutorial completo do bot,
// terminando sempre com FAQ e o contato com o desenvolvedor (/reportarbug).
// Administradores veem o tutorial completo (setup + todos os sistemas);
// membros comuns veem uma versão enxuta focada no que eles podem usar.
// ---------------------------------------------------------------------------

const FALLBACK_ICON = 'https://cdn.discordapp.com/embed/avatars/0.png';

function newPage() {
    return new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
}

function pageHeader(builder, title, description) {
    builder.section(
        [`# ${title}`, description].join('\n'),
        builder.assetThumbnail('icone_help') || AdvancedContainerBuilder.thumbnail(FALLBACK_ICON)
    );
    builder.separator();
    return builder;
}

// ==================== PÁGINAS — ADMIN/STAFF ====================

function buildPageWelcome(displayName, guildName, emojis, isAdmin) {
    const builder = newPage(emojis);
    pageHeader(
        builder,
        'ASSISTENTE TITAN',
        `Olá **${displayName}**! Este é o guia completo do bot em **${guildName}** — use os botões abaixo para navegar pelas páginas.`
    );

    builder.title(`${emojis.clipboardlist || '📋'} Neste guia você encontra`, 2);
    builder.block(isAdmin ? [
        '• **Configuração inicial** — o que configurar e em que ordem',
        '• **Moderação e Reputação** — strike, unstrike, punições severas',
        '• **Sistema de Reports** — como o ReportChat funciona pro staff',
        '• **Auto Moderação** — o que roda sozinho todo dia',
        '• **Eventos** — como criar e divulgar eventos da comunidade',
        '• **Status e utilidades** — checar a saúde do bot',
        '• **Premium** — planos de jogador e de servidor',
        '• **Perguntas Frequentes**',
        '• **Fale com o desenvolvedor** — bugs e sugestões',
    ] : [
        '• **Como funciona o sistema de reputação**',
        '• **Como denunciar alguém ou contestar uma punição**',
        '• **Premium** — planos de jogador e de servidor',
        '• **Perguntas Frequentes**',
        '• **Fale com o desenvolvedor** — bugs e sugestões',
    ]);

    builder.footer(guildName);
    return builder;
}

function buildPageSetup(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'CONFIGURAÇÃO INICIAL', 'Apenas administradores podem usar estes comandos. Siga essa ordem na primeira configuração:');

    builder.title(`${emojis.shield || '🛡️'} 1. /config-roles`, 2);
    builder.block([
        '• Define quais cargos do servidor controlam cada permissão do bot.',
        '• **Staff é obrigatório** — sem ele, ninguém consegue moderar.',
        `• ${emojis.messagesquare || 'ℹ️'} **Importante:** esses cargos servem só para o bot saber quem pode usar cada comando. Eles não precisam ser (nem representar) um cargo "oficial" do servidor — você pode reaproveitar um cargo que já existe ou criar um novo só pra isso. É 100% customizável.`,
        '• Painel dividido em 3 abas: Reputação Automática, Moderação e Eventos.',
    ]);
    builder.separator();

    builder.title(`${emojis.filetext || '📝'} 2. /config-logs`, 2);
    builder.block([
        '• Define os canais que recebem logs: Geral/AutoMod, Punições e ReportChat.',
        '• Tem um botão para criar os 3 canais automaticamente, se preferir.',
    ]);
    builder.separator();

    builder.title(`${emojis.gavel || '⚖️'} 3. /config-punishments`, 2);
    builder.block([
        '• Ajusta os pontos perdidos por nível de strike (1 a 5).',
        '• Ajusta os limites de reputação para os cargos Exemplar e Problemático.',
    ]);
    builder.separator();

    builder.title(`${emojis.ticket || '🎫'} 4. /reportchat`, 2);
    builder.text('• Publica o painel de denúncias para os usuários no canal atual.');

    builder.footer(guildName);
    return builder;
}

function buildPageModeration(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'MODERAÇÃO E REPUTAÇÃO', 'Apenas usuários com o cargo **Staff** (configurado em /config-roles) podem usar:');

    builder.title(`${emojis.gavel || '⚠️'} Comandos de Punição`, 2);
    builder.block([
        '• **/strike** — Aplica punição e reduz reputação',
        '• **/unstrike** — Anula punição e restaura pontos',
        '• **/historico** — Consulta ficha completa do usuário',
        '• **/repset** — Ajuste manual de reputação',
    ]);
    builder.separator();

    builder.title(`${emojis.shieldban || '🛡️'} Punições Severas Precisam de Aprovação`, 2);
    builder.block([
        '• Strikes de **Nível 4 (Severa)** ou **5 (Permanente)**, OU qualquer duração **maior que 72h**, exigem aprovação do Supervisor — vale pra qualquer plano.',
        '• Quem não tem o cargo **Supervisor** (configurado em /config-roles) tem o pedido enviado para aprovação no canal de log de punições, marcando o Supervisor.',
        '• Quem já é Supervisor aplica direto, sem precisar de aprovação.',
    ]);
    builder.separator();

    builder.title(`${emojis.star || '⭐'} Sistema de Reputação`, 2);
    builder.block([
        '• Máximo: **100 pontos** | Mínimo: **0 pontos**',
        '• Recuperação automática: quantidade configurável/dia sem punições — só roda no plano **Caçador** (ver página de Premium).',
        '• Perda: conforme configuração de strikes — disponível a partir do plano **Rastreador**; no Free o strike fica registrado, mas não mexe em pontos.',
    ]);

    builder.footer(guildName);
    return builder;
}

function buildPageReports(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'SISTEMA DE REPORTS', 'Como o ReportChat funciona para o staff:');

    builder.title(`${emojis.ticket || '🎫'} Fluxo`, 2);
    builder.block([
        '• O usuário abre um report pelo painel publicado com /reportchat.',
        '• Uma thread privada é criada e um resumo aparece no canal de logs (config-logs).',
        '• Clique em **Entrar no Reporte** para atender — o cargo Staff é necessário.',
        '• Use **Fechar** (sem motivo) ou **Fechar com Motivo** para encerrar; o fechamento com motivo pergunta também sobre punição aplicada.',
        '• O usuário pode avaliar o atendimento depois de encerrado.',
    ]);
    builder.separator();

    builder.title(`${emojis.circlecheck || '✅'} Revisão de Punição`, 2);
    builder.text('• O botão "Revisar Punição" no painel abre o mesmo fluxo de thread, mas para contestar um strike específico — informando o número do strike.');

    builder.footer(guildName);
    return builder;
}

function buildPageAutomod(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'AUTO MODERAÇÃO', 'Sistema automático de gerenciamento de reputação:');

    builder.title(`${emojis.settings || '⚙️'} Comandos`, 2);
    builder.text('• **/automod test** — Verifica configurações e canal de log');
    builder.separator();

    builder.title(`${emojis.trendingup || '📈'} Funcionamento`, 2);
    builder.block([
        '• Executa diariamente às **12:00** (horário de Brasília).',
        '• Recupera pontos para quem não tem punições nas últimas 24h — quantidade configurável em /config-punishments (padrão: +1/dia).',
        '• Atribui/remove cargos **Exemplar** e **Problemático** automaticamente, conforme os limites de /config-punishments.',
        '• Envia relatório no canal de log configurado.',
        `• ${emojis.badge || '🏅'} **Recurso exclusivo do plano Caçador** — ver página de Premium.`,
    ]);

    builder.footer(guildName);
    return builder;
}

function buildPageEvents(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'EVENTOS', 'Criação e divulgação de eventos da comunidade:');

    builder.title(`${emojis.calendardays || '📅'} /evento`, 2);
    builder.block([
        '• Disponível em **todos os planos**, mas o nível do sistema muda por tier (ver página de Premium).',
        '• **Free** — só publica no fórum escolhido (título, descrição, imagem e data), sem evento agendado do Discord.',
        `• ${emojis.badge || '🏅'} **Rastreador/Caçador** — publica no fórum **e** cria um Evento agendado nativo do Discord (pede também o local: um **canal de voz/palco** ou um **texto livre**), marcando o cargo de Notificação de Eventos.`,
        '• Imagem: PNG/JPEG, até 1920x1279.',
    ]);
    builder.separator();

    builder.title(`${emojis.partypopper || '🎉'} Cargos (configurados em /config-roles, aba Eventos)`, 2);
    builder.block([
        '• **Equipe de Eventos** — quem pode usar o /evento (obrigatório em qualquer plano).',
        '• **Notificação de Eventos** — marcado automaticamente em cada postagem; só a partir do plano Rastreador (Free não marca ninguém).',
    ]);

    builder.footer(guildName);
    return builder;
}

function buildPagePremium(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'PREMIUM', 'O Titan\'s Pass tem dois planos pagos, independentes entre si:');

    builder.title(`${emojis.badge || '🏅'} Player Premium (por jogador, global)`, 2);
    builder.block([
        '• **Free** — perfil sincronizado com Discord. *(server badges, títulos e boost de farm: vindo em breve)*',
        '• **Compy (R$10/mês)** — tudo do Free + perfil personalizável pela loja, badge/títulos exclusivos e boost de farm por troféu. *(vindo em breve)*',
        '• **Raptor (R$25/mês)** — tudo do Compy + perfil 100% personalizado (banner próprio, já disponível via `/perfil-banner`), boost de farm por missão e sorteio semanal de skin do PoT. *(os dois últimos: vindo em breve)*',
        `• Esse vínculo é **global** — vale em qualquer servidor com o bot, uma assinatura só.`,
    ]);
    builder.separator();

    builder.title(`${emojis.shield || '🛡️'} Server Premium (por servidor)`, 2);
    builder.block([
        '• **Free** — logs de sistema; 1 chat de reporte + 1 revisão de punição abertos por vez, 1h de cooldown; sem reputação, sem ações automáticas de punição (Discord ou jogo); `/evento` só posta no fórum.',
        '• **Rastreador (R$25/mês)** — tudo do Free + logs de jogo, 3 chats + 3 revisões sem cooldown, reputação ativada, `/evento` cria também o evento agendado do Discord.',
        '• **Caçador (R$40/mês)** — tudo do Rastreador + chats/revisões ilimitados, `/historico` liberado, automod diário, análise de staff, ações automáticas de punição no Discord e no jogo (RCON). O dono do servidor ganha Player Premium **Raptor** de bônus (Rastreador dá **Compy**).',
    ]);
    builder.separator();

    builder.title(`${emojis.gauge || '📊'} Como conferir seu tier`, 2);
    builder.block([
        '• **/perfil** — mostra seu Player Premium, se houver.',
        '• **/premium** — mostra todos os planos, valores, como adquirir, e o Server/Player Premium atuais.',
    ]);
    builder.separator();
    builder.text(`${emojis.messagesquare || 'ℹ️'} A concessão hoje é manual — fale com o desenvolvedor do bot (**/reportarbug**, opção Sugestão) pra assinar.`);

    builder.footer(guildName);
    return builder;
}

function buildPageUtility(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'STATUS E UTILIDADES', 'Comandos para checar a saúde do bot:');

    builder.block([
        '• **/botstatus** — Verifica saúde do bot e sistemas: uptime, latência, memória, status do AutoMod e estatísticas.',
        '• **/ping** — Latência rápida do bot.',
    ]);

    builder.footer(guildName);
    return builder;
}

// ==================== PÁGINAS — MEMBROS COMUNS ====================

function buildPageUserSimple(displayName, guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(
        builder,
        'ASSISTENTE TITAN',
        `Olá **${displayName}**! Sou o sistema de gestão de **${guildName}**. Aqui vai um resumo rápido do que você pode fazer:`
    );

    builder.title(`${emojis.ticket || '🎫'} ReportChat`, 2);
    builder.block([
        '• Use o painel de reports para abrir uma denúncia.',
        '• A staff vai atender e analisar o caso numa thread privada.',
        '• Você pode avaliar o atendimento ao final.',
    ]);
    builder.separator();

    builder.title(`${emojis.star || '⭐'} Reputação`, 2);
    builder.block([
        '• Sua reputação começa em **100 pontos** (recurso a partir do plano Rastreador — ver página de Premium).',
        '• Infrações reduzem sua pontuação; bom comportamento (sem punições) recupera pontos automaticamente com o tempo (só no plano Caçador).',
        '• Reputação muito baixa ou muito alta pode te dar (ou tirar) cargos automáticos.',
    ]);
    builder.separator();

    builder.title(`${emojis.idcard || '🆔'} Registro (/registrar e /perfil)`, 2);
    builder.block([
        '• **/registrar** vincula seu Discord ao seu Alderon ID (Path of Titans).',
        '• **Esse vínculo é global** — faça uma vez só e ele vale em qualquer servidor que tiver o bot, não precisa repetir em cada comunidade.',
        '• **/perfil** mostra seu cartão de jogador (ou o de outra pessoa).',
    ]);

    builder.footer(guildName);
    return builder;
}

function buildPageUserFAQ(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'PERGUNTAS FREQUENTES', 'Dúvidas comuns sobre reports e reputação:');

    const faq = [
        ['Como eu denuncio outro jogador?', 'Procure o painel de reports fixado no servidor e clique em "Reportar Jogador". Preencha o formulário com regra quebrada, data, local e descrição.'],
        ['Recebi um strike que acho injusto, o que eu faço?', 'No mesmo painel de reports, use o botão "Revisar Punição" e informe o número do strike. A staff vai analisar numa thread privada com você.'],
        ['Minha reputação caiu, por quê?', 'Toda punição (strike) reduz reputação. Use "Revisar Punição" se achar que foi um engano.'],
        ['Como recupero minha reputação?', 'O sistema devolve +1 ponto por dia em que você não recebe nenhuma punição nova.'],
        ['Fechei o report sem querer, dá pra reabrir?', 'Não — abra um novo report pelo painel, explicando a situação.'],
    ];

    for (const [pergunta, resposta] of faq) {
        builder.text(`**${emojis.circlealert || '❓'} ${pergunta}**\n${resposta}`);
        builder.separator();
    }

    builder.footer(guildName);
    return builder;
}

// ==================== PÁGINA COMPARTILHADA — CONTATO ====================

function buildPageContact(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'FALE COM O DESENVOLVEDOR', 'Encontrou um bug ou tem uma sugestão? É rapidinho:');

    builder.section(
        [
            `## ${emojis.compass || '💡'} /reportarbug`,
            'Envia sua mensagem direto para o desenvolvedor, com o tipo (Bug ou Sugestão) e uma descrição.',
        ].join('\n'),
        AdvancedContainerBuilder.thumbnail(FALLBACK_ICON)
    );
    builder.separator();
    builder.block([
        '• Escolha **Reportar Bug/Erro** para algo que não está funcionando como deveria.',
        '• Escolha **Sugerir Melhoria** para ideias de novos recursos ou ajustes.',
        '• Descreva com o máximo de detalhes possível — isso ajuda (e muito) a resolver mais rápido.',
    ]);
    builder.separator();
    builder.text(`${emojis.circlecheck || '✅'} Toda sugestão e todo report são lidos — obrigado por ajudar a melhorar o bot!`);

    builder.footer(guildName);
    return builder;
}

// ---------------------------------------------------------------------------
// Comando
// ---------------------------------------------------------------------------

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('📖 Guia completo, FAQ e contato com o desenvolvedor do Assistente Titan.'),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        // Nota: handlers.js → handleCommand() já chama interaction.deferReply()
        // antes de invocar execute(), então a interação já está deferida aqui.

        // Carrega emojis customizados
        let emojis = {};
        try {
            emojis = require('../../database/emojis.js').EMOJIS ?? {};
        } catch { /* sem emojis */ }

        try {
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

            const isAdmin = member.permissions.has('Administrator');

            const pagination = new PaginationBuilder({
                accentColor: COLORS.DEFAULT,
                timeout: 180000,
            });

            if (isAdmin) {
                pagination.addPages(
                    () => buildPageWelcome(member.displayName, guild.name, emojis, true),
                    () => buildPageSetup(guild.name, emojis),
                    () => buildPageModeration(guild.name, emojis),
                    () => buildPageReports(guild.name, emojis),
                    () => buildPageAutomod(guild.name, emojis),
                    () => buildPageEvents(guild.name, emojis),
                    () => buildPageUtility(guild.name, emojis),
                    () => buildPagePremium(guild.name, emojis),
                    () => buildPageUserFAQ(guild.name, emojis),
                    () => buildPageContact(guild.name, emojis),
                );
            } else {
                pagination.addPages(
                    () => buildPageUserSimple(member.displayName, guild.name, emojis),
                    () => buildPagePremium(guild.name, emojis),
                    () => buildPageUserFAQ(guild.name, emojis),
                    () => buildPageContact(guild.name, emojis),
                );
            }

            pagination.setButtons({
                prev: { label: 'Anterior', style: ButtonStyle.Secondary },
                next: { label: 'Próxima', style: ButtonStyle.Primary },
            });

            await pagination.start(interaction);

            console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (${isAdmin ? 'admin' : 'usuário comum'})`);

        } catch (error) {
            // Profundidade total: console.error(msg, error) trunca objetos
            // aninhados (ex: error.rawError.errors), escondendo o motivo real
            // de um 50035 "Invalid Form Body" do Discord.
            console.error('❌ Erro no ajuda:', require('util').inspect(error, { depth: null }));

            try {
                const errorPayload = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                    .text(`${emojis.circlealert || '❌'} Erro ao gerar guia de ajuda. Tente novamente.`)
                    .footer(guild?.name)
                    .build();

                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply(errorPayload);
                } else {
                    await interaction.reply({ ...errorPayload, flags: errorPayload.flags | MessageFlags.Ephemeral });
                }
            } catch (err) {
                console.error('❌ Erro ao responder fallback de erro:', err);
            }
        }
    },
};
