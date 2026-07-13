// src/commands/ajuda/ajuda.js
const {
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
} = require('discord.js');
const db = require('../../database/index');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

// ---------------------------------------------------------------------------
// Fábrica de tópicos — /ajuda funciona como um guia do bot, navegado por um
// menu de seleção. Poucos tópicos, de propósito: cada um agrupa vários
// assuntos relacionados (ex: "Sistemas do Servidor" cobre ReportChat,
// AutoMod e Eventos juntos) em vez de uma página por comando.
// Administradores veem o guia completo; membros comuns veem uma versão
// enxuta focada no que eles podem usar.
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

// ==================== TÓPICOS — ADMIN/STAFF ====================

function buildPageWelcome(displayName, guildName, emojis, isAdmin) {
    const builder = newPage(emojis);
    pageHeader(
        builder,
        'ASSISTENTE TITAN',
        isAdmin
            ? `Olá **${displayName}**! Este é o guia do bot em **${guildName}** — use o menu abaixo pra escolher o tópico que você procura.`
            : `Olá **${displayName}**! Sou o sistema de gestão de **${guildName}** — use o menu abaixo pra escolher o tópico que você procura.`
    );
    builder.footer(guildName);
    return builder;
}

function buildPageSetupModeration(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'CONFIGURAÇÃO & MODERAÇÃO', 'Setup inicial (administradores) e o dia a dia de quem tem o cargo Staff:');

    builder.title(`${emojis.settings || '⚙️'} Setup inicial (nessa ordem)`, 2);
    builder.block([
        '• **/config roles** — cargos que controlam cada permissão do bot (Staff é obrigatório). Não precisam ser cargos "oficiais" do servidor — 100% customizável.',
        '• **/config logs** — canais de log: Geral/AutoMod, Punições, ReportChat e Staff (tem botão pra criar os 4 automaticamente).',
        '• **/config punishments** — pontos por nível de strike e limites de reputação (Exemplar/Problemático).',
        '• **/reportchat** — publica o painel de denúncias no canal atual.',
    ]);
    builder.separator();

    builder.title(`${emojis.trianglealert || '⚠️'} Comandos INGAME (Comandos que podem ser usados no Discord para aplicar no jogo via RCON)`, 2);
    builder.block([
        '• Os comandos ingame dão acesso direto ao console de admin do servidor PoT (podem reiniciar o servidor, banir, dar godmode etc.).',
        '• Além do bloqueio interno do bot, recomendamos restringir ainda mais pelo próprio Discord: **Configurações do Servidor → Integrações → [nome do bot] → permissões por comando**, escolhendo exatamente quem (cargo/canal) pode usar cada um.',
        '• O Discord permite negar um comando específico até pra quem tem permissão de Administrador.',
    ]);
    builder.separator();

    builder.title(`${emojis.gavel || '⚠️'} Comandos de Punição`, 2);
    builder.block([
        '• **/strike** — Aplica punição e reduz reputação',
        '• **/unstrike** — Anula punição e restaura pontos',
        '• **/historico** — Consulta ficha completa do usuário',
        '• **/repset** — Ajuste manual de reputação',
    ]);
    builder.separator();

    builder.title(`${emojis.shieldban || '🛡️'} Punições Severas Precisam de Aprovação`, 2);
    builder.text('• Severidade **Grave/Severa** ou duração **maior que 72h/permanente** exigem aprovação do Supervisor (cargo em /config roles) — quem já é Supervisor aplica direto. No plano **Caçador**, isso vira configurável nível a nível em /config punishments.');
    builder.separator();

    builder.title(`${emojis.star || '⭐'} Sistema de Reputação`, 2);
    builder.block([
        '• Máximo: **100 pontos** | Mínimo: **0 pontos**.',
        '• Perda por strike a partir do plano **Rastreador** (no Free, o strike fica registrado, mas não mexe em pontos).',
        '• Recuperação automática diária a partir do plano **Rastreador**: fixa em **1 ponto/dia**. No plano **Caçador**, essa quantidade é configurável em /config punishments (ver tópico Premium).',
    ]);

    builder.footer(guildName);
    return builder;
}

/**
 * Lista completa dos comandos /ingame-* — gerada DIRETO do catálogo
 * (rconCommandCatalog.js), não duplicada à mão, pra nunca ficar
 * desatualizada quando um comando for adicionado/removido/renomeado lá.
 */
function buildPageIngame(guildName, emojis) {
    const RconCatalog = require('../../systems/pot/rconCommandCatalog');
    const builder = newPage(emojis);
    pageHeader(
        builder,
        'COMANDOS INGAME',
        `Catálogo completo dos comandos de admin do servidor PoT disponíveis via **/ingame-***, plano **Caçador**. ` +
        `Todo subcomando aceita **usuario** (Discord vinculado) OU **agid** (Alderon ID/nome, se não estiver vinculado) — nenhum dos dois informado usa você mesmo, quando fizer sentido. ` +
        `${emojis.lock || '🔒'} marca os subcomandos restritos ao cargo Supervisor (ver /config roles).`
    );

    const categories = [
        { command: '/ingame-stats', label: 'Change Stats', entries: RconCatalog.STATS_COMMANDS },
        { command: '/ingame-marks', label: 'Marks', entries: RconCatalog.MARKS_COMMANDS },
        { command: '/ingame-admin', label: 'Admin', entries: RconCatalog.ADMIN_COMMANDS },
        { command: '/ingame-map', label: 'Map', entries: RconCatalog.MAP_COMMANDS },
        { command: '/ingame-event', label: 'Event', entries: RconCatalog.EVENT_COMMANDS },
        { command: '/ingame-message', label: 'Message', entries: RconCatalog.MESSAGE_COMMANDS },
    ];

    for (const cat of categories) {
        builder.title(`${emojis.rcon || '🔗'} ${cat.command} — ${cat.label}`, 2);
        builder.block(cat.entries.map((entry) =>
            `• \`${entry.name}\`${entry.supervisorOnly ? ` ${emojis.lock || '🔒'}` : ''} — ${entry.description}`
        ));
        builder.separator();
    }

    builder.text(
        `${emojis.trianglealert || '⚠️'} **kick, ban, unban, ServerMute e ServerUnmute não estão aqui** — continuam exclusivos de **/strike** e **/unstrike**, ` +
        `que já aplicam a ação em jogo automaticamente (e recarregam bans/mutes) junto com a punição no Discord.`
    );

    builder.footer(guildName);
    return builder;
}

function buildPageSystems(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'SISTEMAS DO SERVIDOR', 'ReportChat, Auto Moderação, Eventos e utilidades do bot:');

    builder.title(`${emojis.ticket || '🎫'} ReportChat`, 2);
    builder.block([
        '• O usuário abre pelo painel publicado com /reportchat; a staff atende clicando em **Entrar no Reporte**.',
        '• **Fechar** (sem motivo) ou **Fechar com Motivo** encerram — o segundo também pergunta sobre a punição aplicada.',
        '• Botão **Revisar Punição** abre o mesmo fluxo, mas pra contestar um strike específico.',
    ]);
    builder.separator();

    builder.title(`${emojis.trendingup || '📈'} Auto Moderação`, 2);
    builder.block([
        '• Roda sozinha, diariamente às **12:00** (horário de Brasília).',
        '• Recupera pontos de reputação a partir do plano **Rastreador** (fixo, 1 ponto/dia).',
        `• ${emojis.badge || '🏅'} No plano **Caçador**, a quantidade recuperada é configurável, e o bot também atribui/remove os cargos Exemplar/Problemático automaticamente, conforme /config punishments.`,
    ]);
    builder.separator();

    builder.title(`${emojis.calendardays || '📅'} Eventos (/evento)`, 2);
    builder.block([
        '• **Free** — só publica no fórum escolhido (título, descrição, imagem e data).',
        `• ${emojis.badge || '🏅'} **Rastreador/Caçador** — cria também um Evento agendado nativo do Discord e marca automaticamente o cargo de Notificação de Eventos (cargos configurados em /config roles).`,
    ]);
    builder.separator();

    builder.title(`${emojis.gauge || '📊'} Status e Utilidades`, 2);
    builder.text('• **/botstatus** — saúde do bot: uptime, latência, memória e status do AutoMod. **/ping** — latência rápida.');

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
        '• **Raptor (R$25/mês)** — tudo do Compy + perfil 100% personalizado (banner próprio, já disponível via `/perfil-edit`), boost de farm por missão e sorteio semanal de skin do PoT. *(os dois últimos: vindo em breve)*',
        `• Esse vínculo é **global** — vale em qualquer servidor com o bot, uma assinatura só.`,
    ]);
    builder.separator();

    builder.title(`${emojis.shield || '🛡️'} Server Premium (por servidor)`, 2);
    builder.block([
        '• **Free** — logs de sistema (inclui logs de jogo); 1 chat de reporte + 1 revisão de punição abertos por vez, 6h de cooldown; sem reputação, sem ações automáticas de punição (Discord ou jogo); `/evento` só posta no fórum.',
        '• **Rastreador (R$25/mês)** — tudo do Free + 3 chats + 3 revisões sem cooldown, reputação ativada, `/historico` liberado, `/evento` cria também o evento agendado do Discord, ações automáticas de punição no Discord e no jogo (RCON) já liberadas pelo `/strike`.',
        '• **Caçador (R$40/mês)** — tudo do Rastreador + chats/revisões ilimitados, automod diário, análise de staff. O dono do servidor ganha Player Premium **Raptor** de bônus (Rastreador dá **Compy**).',
        `• ${emojis.trianglealert || '⚠️'} É preciso ser um Host de Path of Titans pra adquirir qualquer tier pago do Server Premium.`,
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

// ==================== TÓPICO — MEMBROS COMUNS ====================

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
        '• Sua reputação começa em **100 pontos** (recurso a partir do plano Rastreador — ver tópico Premium).',
        '• Infrações reduzem sua pontuação; bom comportamento (sem punições) recupera pontos automaticamente com o tempo.',
        '• Reputação muito baixa ou muito alta pode te dar (ou tirar) cargos automáticos (só no plano Caçador).',
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

// ==================== TÓPICO COMPARTILHADO — AJUDA & SUPORTE ====================

function buildPageHelp(guildName, emojis) {
    const builder = newPage(emojis);
    pageHeader(builder, 'AJUDA & SUPORTE', 'Dúvidas comuns e como falar com o desenvolvedor:');

    const faq = [
        ['Como eu denuncio outro jogador?', 'Procure o painel de reports fixado no servidor e clique em "Reportar Jogador". Preencha o formulário com regra quebrada, data, local e descrição.'],
        ['Recebi um strike que acho injusto, o que eu faço?', 'No mesmo painel de reports, use o botão "Revisar Punição" e informe o número do strike. A staff vai analisar numa thread privada com você.'],
        ['Minha reputação caiu, por quê?', 'Toda punição (strike) reduz reputação. Use "Revisar Punição" se achar que foi um engano.'],
        ['Como recupero minha reputação?', 'O sistema devolve pontos automaticamente com o tempo, sem receber nenhuma punição nova (a partir do plano Rastreador).'],
        ['Fechei o report sem querer, dá pra reabrir?', 'Não — abra um novo report pelo painel, explicando a situação.'],
    ];

    for (const [pergunta, resposta] of faq) {
        builder.text(`**${emojis.circlealert || '❓'} ${pergunta}**\n${resposta}`);
    }
    builder.separator();

    builder.section(
        [
            `## ${emojis.compass || '💡'} /reportarbug`,
            'Encontrou um bug ou tem uma sugestão? Envia direto pro desenvolvedor — escolha **Reportar Bug/Erro** ou **Sugerir Melhoria** e descreva com o máximo de detalhes possível.',
        ].join('\n'),
        AdvancedContainerBuilder.thumbnail(FALLBACK_ICON)
    );
    builder.text(`${emojis.circlecheck || '✅'} Toda sugestão e todo report são lidos — obrigado por ajudar a melhorar o bot!`);

    builder.footer(guildName);
    return builder;
}

// ---------------------------------------------------------------------------
// Menu de tópicos — define, por perfil (admin/membro), a lista de tópicos
// disponíveis, na ordem em que aparecem no menu de seleção.
// ---------------------------------------------------------------------------

function getTopics(isAdmin, ctx) {
    const { displayName, guildName, emojis } = ctx;

    if (isAdmin) {
        return [
            { key: 'welcome', label: 'Início', emoji: emojis.clipboardlist || '📋', build: () => buildPageWelcome(displayName, guildName, emojis, true) },
            { key: 'setup', label: 'Configuração & Moderação', emoji: emojis.gavel || '⚖️', build: () => buildPageSetupModeration(guildName, emojis) },
            { key: 'ingame', label: 'Comandos INGAME', emoji: emojis.rcon || '🔗', build: () => buildPageIngame(guildName, emojis) },
            { key: 'systems', label: 'Sistemas do Servidor', emoji: emojis.trendingup || '📈', build: () => buildPageSystems(guildName, emojis) },
            { key: 'premium', label: 'Premium', emoji: emojis.badge || '🏅', build: () => buildPagePremium(guildName, emojis) },
            { key: 'help', label: 'Ajuda & Suporte', emoji: emojis.compass || '💡', build: () => buildPageHelp(guildName, emojis) },
        ];
    }

    return [
        { key: 'welcome', label: 'Início', emoji: emojis.clipboardlist || '📋', build: () => buildPageUserSimple(displayName, guildName, emojis) },
        { key: 'premium', label: 'Premium', emoji: emojis.badge || '🏅', build: () => buildPagePremium(guildName, emojis) },
        { key: 'help', label: 'Ajuda & Suporte', emoji: emojis.compass || '💡', build: () => buildPageHelp(guildName, emojis) },
    ];
}

function buildTopicSelectMenu(topics, selectedKey, invokerId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`ajuda:topic:${invokerId}`)
        .setPlaceholder('Escolha um tópico...')
        .addOptions(topics.map(t => new StringSelectMenuOptionBuilder()
            .setLabel(t.label)
            .setValue(t.key)
            .setEmoji(t.emoji)
            .setDefault(t.key === selectedKey)
        ));
}

/**
 * Monta o payload completo (container do tópico + menu de seleção) pronto
 * pra enviar/editar. `topics` já vem filtrado por perfil (admin/membro).
 */
function renderTopicPayload(topics, topicKey, invokerId) {
    const topic = topics.find(t => t.key === topicKey) || topics[0];
    const builder = topic.build();
    builder.selectMenu(buildTopicSelectMenu(topics, topic.key, invokerId));
    return builder.build();
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
            const topics = getTopics(isAdmin, { displayName: member.displayName, guildName: guild.name, emojis });

            const payload = renderTopicPayload(topics, 'welcome', user.id);
            await interaction.editReply(payload);

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

    /**
     * Roteado pelo InteractionHandler (customId `ajuda:topic:<invokerId>`) —
     * troca o tópico exibido na mesma mensagem quando alguém usa o menu de
     * seleção. `interactionCreate.js` já chama deferUpdate() antes disso.
     */
    async handleComponent(interaction, action, invokerId) {
        if (action !== 'topic') {
            return await interaction.followUp({ content: 'Ação desconhecida.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        // Só quem rodou /ajuda pode trocar o tópico dessa mensagem — mesma
        // regra de "dono da interação" usada em outros painéis com id
        // embutido no customId (ex: pot_reset_*).
        if (interaction.user.id !== invokerId) {
            return await interaction.followUp({
                content: 'Apenas quem executou /ajuda pode usar este menu — rode o comando você mesmo.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

        let emojis = {};
        try {
            emojis = require('../../database/emojis.js').EMOJIS ?? {};
        } catch { /* sem emojis */ }

        const { guild, member } = interaction;
        const isAdmin = member.permissions.has('Administrator');
        const topics = getTopics(isAdmin, { displayName: member.displayName, guildName: guild.name, emojis });

        const topicKey = interaction.values?.[0] || 'welcome';
        const payload = renderTopicPayload(topics, topicKey, invokerId);
        await interaction.editReply(payload);
    },
};
