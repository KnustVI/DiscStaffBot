// src/integrations/pathoftitans/webhookPayloads.js
/**
 * Construção das mensagens (containers/embeds/texto) que o gateway posta nos
 * webhooks do Discord para cada evento do Path of Titans.
 *
 * Fica separado de gatewayServer.js de propósito: é o único arquivo que
 * precisa ser editado para mudar como um evento aparece no Discord — o
 * gatewayServer.js só chama essas funções e envia o resultado.
 *
 * Todas as mensagens aqui saem por um webhook cru (fetch direto), não pelo
 * client autenticado do bot — por isso NUNCA usar EMOJIS.* (emoji de
 * aplicação) diretamente, ele não renderiza nesse caminho e aparece como
 * texto (":nome:"). Use resolveEmoji() abaixo: ele tenta o emoji customizado
 * DO PRÓPRIO SERVIDOR (renderiza em qualquer webhook, já que não é de
 * aplicação) e cai pro unicode genérico se o servidor não tiver um com esse
 * nome — mesmo padrão que a maioria dos containers do bot já usa.
 */
const { EmbedBuilder } = require('discord.js');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

/**
 * Prioridade: emoji de APLICAÇÃO do bot (EMOJIS.*) — só renderiza quando a
 * mensagem sai autenticada como o bot (gatewayServer._trySendViaBotChannel),
 * não via webhook cru — depois emoji do PRÓPRIO servidor (renderiza em
 * qualquer um dos dois caminhos), depois unicode genérico.
 */
function resolveEmoji(guild, key, fallback) {
    if (EMOJIS[key]) return EMOJIS[key];
    const found = guild?.emojis?.cache?.find(e => e.name?.toLowerCase() === key.toLowerCase());
    return found ? found.toString() : fallback;
}

// Os 10 tipos de dano documentados oficialmente pelo PoT (PlayerKilled/
// PlayerDamagedPlayer) — ver https://hosting.pathoftitans.wiki/guide/webhooks.
const DAMAGE_TYPE_LABELS = {
    DT_ATTACK: 'Ataque',
    DT_OXYGEN: 'Afogamento',
    DT_BLEED: 'Sangramento',
    DT_THIRST: 'Sede',
    DT_HUNGER: 'Fome',
    DT_BREAKLEGS: 'Fratura (queda)',
    DT_GENERIC: 'Genérico',
    DT_TRAMPLE: 'Pisoteio',
    DT_SPIKES: 'Espinhos',
    DT_ARMORPIERCING: 'Perfurante',
    // Visto ao vivo no Atlas Brasil, NÃO documentado nos 10 oficiais —
    // valores de dano altos (30-90+), consistente com investida/colisão
    // entre dinossauros.
    DT_IMPACT: 'Impacto',
};

function formatDamageType(type) {
    return DAMAGE_TYPE_LABELS[type] || type || 'Desconhecida';
}

/**
 * Emoji de dieta (carnívoro/herbívoro/onívoro) pra usar sempre que um log
 * mencionar a espécie de um dinossauro. Vem do campo "Diet" que o PRÓPRIO
 * PoT manda no payload (confirmado na doc oficial em PlayerRespawn/
 * PlayerLeave/eventos de quest/ninho) — de propósito NÃO é uma lista fixa
 * de espécie→dieta mantida à mão aqui: isso quebraria pra qualquer
 * dinossauro modado ou lançado depois desta revisão, e o próprio jogo já
 * manda essa informação certa. Diet ausente ou valor não reconhecido não
 * quebra a mensagem, só não mostra emoji nenhum.
 *
 * @param {string} diet - valor cru do campo Diet ("Carnivore"/"Herbivore"/"Omnivore")
 * @param {import('discord.js').Guild} guild
 * @returns {string} emoji (ou string vazia se Diet ausente/desconhecido)
 */
function dietEmoji(diet, guild) {
    const key = String(diet || '').trim();
    if (key === 'Carnivore') return resolveEmoji(guild, 'CarniSkull', '🍖');
    if (key === 'Herbivore') return resolveEmoji(guild, 'HerbSkull', '🌿');
    if (key === 'Omnivore') return resolveEmoji(guild, 'TapejaraSkull', '🍽️');
    return '';
}

/**
 * " (para Fulano)" quando o payload de um PlayerChat com FromWhisper=true
 * também disser pra quem foi o sussurro. PENDENTE: o campo oficial da doc
 * do PoT NÃO documenta um nome de destinatário pra PlayerChat — os
 * candidatos abaixo são um chute educado (nomes comuns em payloads
 * parecidos), ainda não confirmados ao vivo. Se nenhum bater, cai no
 * fallback (sem nome, só "Sussurro") — nunca quebra a mensagem. Testar com
 * DEBUG_POT=true numa mensagem sussurrada e ajustar aqui se o campo real
 * tiver outro nome.
 */
function whisperTargetSuffix(d) {
    const target = d.WhisperTarget || d.WhisperTargetName || d.ToPlayerName || d.RecipientName || d.TargetName || null;
    return target ? ` (para ${target})` : '';
}

// CONFIRMADO via DEBUG_POT contra o servidor real do Atlas Brasil: apesar
// da doc oficial do PoT dizer que AdminSpectate traz "AdminName"/
// "AdminAlderonId" e Action binário "Entered/Exited Spectator Mode", o
// payload real usa PlayerName/PlayerAlderonId (igual aos demais eventos
// de jogador) e Action com valores tipo "Enabled Nametags"/"Disabled
// Nametags" — não documentados. Mapeia os valores já vistos ao vivo;
// qualquer Action novo cai no fallback (mostra o texto cru, nunca quebra).
const ADMIN_ACTION_LABELS = {
    'Enabled Nametags': 'ativou os nametags',
    'Disabled Nametags': 'desativou os nametags',
    'Entered Spectator Mode': 'entrou no modo espectador',
    'Exited Spectator Mode': 'saiu do modo espectador',
};

/**
 * Nome do jogador + Alderon ID junto, formato padrão usado em TODO log de
 * webhook (não só quem está vinculado ao Discord) — sem o Alderon ID, o
 * nome de jogador sozinho não identifica ninguém de forma confiável
 * (mesmo nome pode ser reusado). Sem ID disponível no payload, mostra só
 * o nome (nunca quebra a mensagem por falta do campo).
 */
function nameWithId(name, alderonId) {
    const safeName = name || 'Desconhecido';
    return alderonId ? `${safeName} \`${alderonId}\`` : safeName;
}

// ==================== CONTAINER: LOGIN / LOGOUT / LEAVE ====================

/**
 * Monta o container (Components V2) do evento de login/logout/leave.
 * Se o AlderonId já estiver vinculado a um Discord (via /registrar ou
 * webhook de login com DiscordId), mostra o usuário do Discord — avatar
 * e username — junto das informações do jogo.
 */
async function buildLoginEventPayload(client, guildId, potEvent, data) {
    const d = data || {};
    const guild = client.guilds.cache.get(guildId);

    const titleSuffixes = {
        PlayerLogin:  'ENTROU',
        PlayerLogout: 'SAIU',
        PlayerLeave:  'DESCONECTOU',
    };
    const color = potEvent === 'PlayerLogin' ? COLORS.SUCCESS : COLORS.DEFAULT;

    // PlayerLeave manda a chave como PlayerAlderonId, não AlderonId como
    // os demais eventos deste grupo — ver doc oficial de webhooks do PoT.
    const alderonId = d.AlderonId || d.PlayerAlderonId || null;

    let discordUser = null;
    try {
        const linked = PlayerRegistry.getPlayerByAlderonId(alderonId);
        if (linked?.user_id) {
            discordUser = await client.users.fetch(linked.user_id).catch(() => null);
        }
    } catch (err) {
        // sem vínculo encontrado — segue sem info de Discord
    }

    // Sem vínculo, não há avatar de Discord pra mostrar — usa o ícone do
    // próprio servidor (Discord genérico só como último fallback, se o
    // servidor também não tiver ícone configurado).
    const avatarUrl = discordUser
        ? discordUser.displayAvatarURL({ size: 128 })
        : (guild?.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png');

    const playerName = d.PlayerName || 'Desconhecido';
    const suffix = titleSuffixes[potEvent] || potEvent;

    // Quando linkado, o padrão de identidade abaixo já mostra o nome do
    // jogador (linha do :game:) e o Alderon ID (linha do :PotLogo:) — o
    // título fica só com o evento, sem repetir o nome, e a linha solta de
    // "Alderon ID" mais abaixo é omitida. Sem vínculo, o mesmo vale: a linha
    // de identificação (nome do jogo + Alderon ID) já cobre essa informação,
    // então a linha solta de "Alderon ID" mais abaixo também é omitida.
    const nameLines = discordUser ? [`## ${suffix}`] : [`## ${playerName} ${suffix}`];
    if (discordUser) {
        // Padrão de identificação do bot (mesmo formato usado em strike,
        // unstrike, repset, histórico, perfil...). NOTA: usa @menção, o que
        // notifica o jogador a cada login/logout/saída deste servidor.
        nameLines.push(`## ${discordUser.toString()} | ${resolveEmoji(guild, 'PotLogo', '🦖')} \`${alderonId || 'N/A'}\``);
        nameLines.push(`${resolveEmoji(guild, 'DiscLogo', '💬')} ${discordUser.username} | ${resolveEmoji(guild, 'game', '🎮')} ${playerName}`);
    } else {
        nameLines.push(`${resolveEmoji(guild, 'game', '🎮')} ${playerName} | ${resolveEmoji(guild, 'PotLogo', '🦖')} \`${alderonId || 'N/A'}\``);
    }

    const builder = new AdvancedContainerBuilder({ accentColor: color });
    builder.section(nameLines.join('\n'), AdvancedContainerBuilder.thumbnail(avatarUrl));
    builder.separator();
    builder.text(`${resolveEmoji(guild, 'tv', '🖥️')} **Servidor:** ${d.ServerName || 'Desconhecido'}`);
    builder.text(`${resolveEmoji(guild, 'shield', '🛡️')} **Admin:** ${d.bServerAdmin ? 'Sim' : 'Não'}`);

    // Só o PlayerLeave traz esses dois campos (documentados oficialmente):
    // SafeLog (desconexão graciosa, pelo menu, vs. queda abrupta/crash) e
    // FromDeath (se saiu logo após morrer — relevante pra moderação).
    if (potEvent === 'PlayerLeave') {
        if (typeof d.SafeLog === 'boolean') {
            const icon = d.SafeLog
                ? resolveEmoji(guild, 'circlecheck', '🟢')
                : resolveEmoji(guild, 'circlealert', '🔴');
            builder.text(`${icon} **Desconexão segura:** ${d.SafeLog ? 'Sim' : 'Não'}`);
        }
        if (typeof d.FromDeath === 'boolean' && d.FromDeath) {
            builder.text(`${resolveEmoji(guild, 'Dead', '💀')} **Saiu logo após morrer**`);
        }
    }

    builder.footer(guild?.name || d.ServerName || 'Servidor');

    const { components, flags } = builder.build();
    return { components: components.map(c => c.toJSON()), flags };
}

// ==================== TEXTO/EMBED — DEMAIS GRUPOS (formato legado) ====================

function formatMessage(potEvent, data, guild) {
    const d = data || {};
    const e = (key, fallback) => resolveEmoji(guild, key, fallback);

    // Login/Logout/Leave NÃO entram aqui — já são tratados via
    // buildLoginEventPayload (container V2, já mostra nome + Alderon ID) e
    // nunca chegam nesta função (ver CONTAINER_EVENTS em gatewayServer.js).
    const formatters = {
        // ── Combate ──
        // PlayerDamagedPlayer NÃO entra aqui de propósito — é interceptado
        // antes, em gatewayServer._routeToDiscord, e vira um Relatório de
        // Combate/Dano agrupado (ver buildDamageReportEmbed abaixo) em vez de
        // uma mensagem por golpe (evita flood no canal de log).
        PlayerKilled: () => `${e('Dead', '💀')} **${nameWithId(d.VictimName, d.VictimAlderonId)}** foi morto por **${nameWithId(d.KillerName, d.KillerAlderonId)}**\n${e('build', '🔧')} Causa: \`${formatDamageType(d.DamageType)}\``,

        // ── Quest ──
        PlayerQuestComplete: () => `${e('listchecks', '📜')} **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** completou a missão **${d.Quest}**`,
        PlayerQuestFailed:   () => `${e('circlealert', '❌')} **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** falhou na missão **${d.Quest}**`,

        // ── Respawn ──
        PlayerRespawn:  () => {
            const diet = dietEmoji(d.Diet, guild);
            return `${e('refreshccw', '🔄')} **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** ressurgiu como ${diet ? `${diet} ` : ''}**${d.DinosaurType}**`;
        },
        PlayerWaystone: () => `${e('Waystone', '✨')} **${nameWithId(d.InviterName, d.InviterAlderonId)}** teletransportou **${nameWithId(d.TeleportedPlayerName, d.TeleportedPlayerAlderonId)}**`,

        // ── Chat ──
        // Formato de 2 linhas: canal (+ "Sussurro" quando for whisper) na
        // primeira, identificação + mensagem na segunda.
        PlayerChat: () => {
            const channelName = d.ChannelName || 'Chat';
            const channelLine = d.FromWhisper
                ? `${e('messagecircle', '💬')} ${channelName} - Sussurro${whisperTargetSuffix(d)}`
                : `${e('messagecircle', '💬')} ${channelName}`;
            const idPart = d.AlderonId ? ` \`${d.AlderonId}\`` : '';
            return `${channelLine}\n**${d.PlayerName || 'Desconhecido'}**${idPart}: ${d.Message}`;
        },
        // PlayerProfanity DESATIVADO temporariamente (ver DISABLED_EVENTS em
        // gatewayServer.js) — filtro de profanidade do jogo com falsos
        // positivos demais. Formatter mantido pronto pra quando reativar.
        PlayerProfanity: () => `${e('shieldban', '🔞')} **${nameWithId(d.PlayerName, d.AlderonId)}** tentou enviar mensagem bloqueada`,

        // ── Comandos ──
        PlayerCommand: () => `${e('raio', '⚡')} **${nameWithId(d.PlayerName, d.AlderonId)}:** \`${d.Message}\``,

        // ── Grupo ──
        PlayerJoinedGroup: () => `${e('users', '👥')} **${nameWithId(d.Player, d.PlayerAlderonId)}** entrou no grupo de **${nameWithId(d.Leader, d.LeaderAlderonId)}**`,
        PlayerLeftGroup:   () => `${e('users', '👥')} **${nameWithId(d.Player, d.PlayerAlderonId)}** saiu do grupo`,

        // ── Servidor ──
        ServerStart:             () => `🟢 Servidor **iniciou** | Mapa: \`${d.Map || 'desconhecido'}\``,
        ServerRestart:           () => `${e('refreshccw', '🔄')} Servidor **reiniciando**...`,
        ServerRestartCountdown:  () => `${e('clockalert', '⏳')} Servidor reinicia em **${d.CountdownTime || '?'}s**`,
        // ServerModerate não traz PlayerName no payload oficial (só
        // AlderonId) — mostra o ID puro, é a única identificação disponível.
        ServerModerate:          () => `${e('shieldcheck', '🛡️')} Moderação automática: \`${d.AlderonId || 'Desconhecido'}\` — ${d.Type || d.Action || 'ação'} — ${d.AdminReason || d.UserReason || 'sem motivo'}`,
        ServerError:             () => `${e('filewarning', '⚠️')} **ERRO:** ${d.ErrorMessage || d.ErrorMesssage || 'desconhecido'}`,
        SecurityAlert:           () => `${e('siren', '🚨')} **ALERTA DE SEGURANÇA:** ${d.SecurityAlert || 'suspeita detectada'}`,
        BadAverageTick:          () => `${e('trendingdown', '📉')} **PERFORMANCE:** Tick médio baixo (${d.AverageTick || '?'})`,

        // ── Admin ──
        // Campo confirmado ao vivo: PlayerName/PlayerAlderonId (não
        // AdminName/AdminAlderonId como a doc oficial diz — ver
        // ADMIN_ACTION_LABELS acima).
        AdminSpectate: () => `${e('shield', '🛡️')} **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** ${ADMIN_ACTION_LABELS[d.Action] || d.Action || 'realizou uma ação administrativa'}`,
        // Campo confirmado ao vivo: AdminCommand usa AdminName/
        // AdminAlderonId de verdade (ao contrário do AdminSpectate acima,
        // que apesar de estar no mesmo grupo "Admin" da doc usa PlayerName/
        // PlayerAlderonId) — o fallback pro par PlayerName/PlayerAlderonId
        // fica só por segurança, nunca visto na prática pra este evento.
        AdminCommand:  () => `${e('shield', '🛡️')} **${nameWithId(d.AdminName || d.PlayerName, d.AdminAlderonId || d.PlayerAlderonId)}** executou: \`${d.Command}\``,

        // ── Nest ──
        CreateNest:    () => `${e('Nest', '🪺')} **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** criou um ninho`,
        DestroyNest:   () => `💥 Ninho de **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** foi destruído`,
        // Doc oficial: quem recebe o convite vem em PlayerName/PlayerAlderonId,
        // quem convidou vem em InviterPlayerName/InviterPlayerAlderonId (não
        // existe campo "InvitedPlayer" — a versão anterior lia um campo que o
        // payload real nunca manda).
        NestInvite:    () => `${e('mensagem', '📨')} **${nameWithId(d.InviterPlayerName, d.InviterPlayerAlderonId)}** convidou **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** para o ninho`,
        PlayerJoinNest: () => `${e('circlecheck', '✅')} **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** entrou em um ninho`,
        UpdateNest:    () => `${e('filetext', '📝')} Ninho de **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** foi atualizado`,
    };

    const fn = formatters[potEvent];
    if (!fn) return `${e('wifi', '📡')} Evento: \`${potEvent}\``;

    try {
        return fn();
    } catch (err) {
        return `${e('wifi', '📡')} Evento: \`${potEvent}\` (dados incompletos)`;
    }
}

function formatEmbed(potEvent, data, guild) {
    const d = data || {};
    const e = (key, fallback) => resolveEmoji(guild, key, fallback);

    // Embed extra apenas para eventos que ganham com contexto visual
    if (potEvent === 'PlayerKilled' && d.VictimName && d.KillerName) {
        // Espécie + growth de cada lado — campos confirmados na doc oficial
        // (VictimDinosaurType/VictimGrowth, KillerDinosaurType/KillerGrowth).
        const victimSpecies = `${d.VictimDinosaurType || 'Desconhecido'} (Growth: ${formatGrowthPercent(d.VictimGrowth)})`;
        const killerSpecies = `${d.KillerDinosaurType || 'Desconhecido'} (Growth: ${formatGrowthPercent(d.KillerGrowth)})`;

        return new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle(`${e('Dead', '💀')} Morte em Combate`)
            .addFields(
                { name: 'Vítima', value: `${nameWithId(d.VictimName, d.VictimAlderonId)}\n${victimSpecies}`, inline: true },
                { name: 'Assassino', value: `${nameWithId(d.KillerName, d.KillerAlderonId)}\n${killerSpecies}`, inline: true },
                { name: 'Causa', value: formatDamageType(d.DamageType), inline: true }
            )
            .setTimestamp();
    }

    if (potEvent === 'ServerError' || potEvent === 'SecurityAlert') {
        return new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle(`${e('siren', '🚨')} ${potEvent === 'SecurityAlert' ? 'Alerta de Segurança' : 'Erro do Servidor'}`)
            .setDescription(d.ErrorMessage || d.SecurityAlert || 'Sem detalhes')
            .setTimestamp();
    }

    return null;
}

// ==================== RELATÓRIO DE COMBATE/DANO (encontro) ====================

// Mesmos limiares usados no card de /perfil (playerRegistrationSystem.js) —
// duplicado aqui de propósito pra manter webhookPayloads.js autocontido
// (não depende de outro sistema só por causa de uma função de 3 linhas).
// 1.0 = Full Adult, 0.5 = Half grown/Sub-Adult, 0.1 = Hatchling/Baby.
function formatGrowthPercent(growth) {
    if (growth === null || growth === undefined) return '—';
    return `${Math.round(growth * 100)}%`;
}

function formatDuration(ms) {
    const safeMs = Math.max(0, ms);
    return safeMs < 60000 ? `${Math.round(safeMs / 1000)}s` : `${Math.round(safeMs / 60000)}min`;
}

/**
 * Monta o embed de um ENCONTRO acumulado (ver gatewayServer._bufferDamageEvent/
 * _recordKillIntoEncounter) — todo dano/morte entre jogadores conectados
 * (A bate em B, B bate em C → A/B/C entram no MESMO encontro) dentro da
 * janela de agrupamento vira UM relatório só, em vez de uma mensagem por
 * golpe ou um relatório por par (evita flood E fragmentação em combates
 * de 3+ jogadores).
 *
 * @param {object} encounter - { participants: Map<key, {name, alderonId,
 *   dinosaurType, dinosaurGrowth}>, events: [...], firstAt }
 * @param {import('discord.js').Guild} guild
 * @returns {import('discord.js').EmbedBuilder}
 */
function buildDamageReportEmbed(encounter, guild) {
    const e = (key, fallback) => resolveEmoji(guild, key, fallback);
    const participant = (key) => encounter.participants.get(key) || { name: 'Desconhecido', alderonId: null };
    const participantLabel = (key) => nameWithId(participant(key).name, participant(key).alderonId);

    // ── Cabeçalho: identificação + espécie + growth de cada jogador
    // envolvido no encontro, na ordem em que entraram nele. ────────────────
    // Sem emoji de dieta aqui de propósito — eventos de combate (Damaged/
    // Killed) não trazem o campo "Diet" no payload oficial (ver seção 20 do
    // PREMIUM.txt), então não tem como mostrar sem adivinhar por espécie.
    const participantLines = [...encounter.participants.values()].map((p) =>
        `${nameWithId(p.name, p.alderonId)} — ${p.dinosaurType || 'Desconhecido'} (Growth: ${formatGrowthPercent(p.dinosaurGrowth)})`
    );

    // ── Eventos agrupados em segmentos, na ordem de PRIMEIRA aparição —
    // cada morte é seu próprio segmento (evento único); cada par atacante/
    // alvo de dano vira um segmento só, mesmo com múltiplos golpes. ────────
    const segments = new Map();
    let killCounter = 0;
    let totalDamage = 0;
    let totalHits = 0;
    // Se NENHUM evento envolver dois jogadores diferentes (nem morte, nem
    // dano de um em outro) o encontro inteiro é só dano próprio/ambiente
    // (queda, sangramento, fome...) — nesse caso o título vira "Relatório
    // de Dano" em vez de "Relatório de Combate", já que não houve combate
    // de verdade entre jogadores.
    let hasOtherPlayerInvolved = false;

    for (const ev of encounter.events) {
        if (ev.type === 'kill') {
            hasOtherPlayerInvolved = true;
            killCounter += 1;
            segments.set(`kill:${killCounter}`, {
                kind: 'kill',
                name: `${e('Dead', '💀')} Morte`,
                value: `**${participantLabel(ev.victimKey)}** foi morto por **${participantLabel(ev.killerKey)}**\nCausa: ${formatDamageType(ev.damageType)}`,
            });
            continue;
        }

        totalDamage += ev.damageAmount;
        totalHits += 1;

        const isSelf = ev.sourceKey === ev.targetKey;
        if (!isSelf) hasOtherPlayerInvolved = true;

        const segKey = `dmg:${ev.sourceKey}->${ev.targetKey}`;
        let seg = segments.get(segKey);
        if (!seg) {
            seg = {
                kind: 'damage',
                name: isSelf
                    ? `${participantLabel(ev.targetKey)} — dano próprio/ambiente`
                    : `${participantLabel(ev.sourceKey)} → ${participantLabel(ev.targetKey)}`,
                byType: new Map(),
            };
            segments.set(segKey, seg);
        }
        const typeEntry = seg.byType.get(ev.damageType) || { count: 0, sum: 0 };
        typeEntry.count += 1;
        typeEntry.sum += ev.damageAmount;
        seg.byType.set(ev.damageType, typeEntry);
    }

    const fields = [
        { name: 'Jogadores envolvidos', value: participantLines.join('\n') || 'Desconhecido', inline: false },
    ];
    for (const seg of segments.values()) {
        if (seg.kind === 'kill') {
            fields.push({ name: seg.name, value: seg.value, inline: false });
            continue;
        }
        const typeLines = [...seg.byType.entries()]
            .map(([type, { count, sum }]) => `${formatDamageType(type)}: ${count}x (total **${sum}**)`)
            .join('\n');
        fields.push({ name: seg.name, value: typeLines || 'Desconhecido', inline: false });
    }
    fields.push(
        { name: 'Dano total', value: `${totalDamage}`, inline: true },
        { name: 'Golpes', value: `${totalHits}`, inline: true },
        { name: 'Duração', value: formatDuration(Date.now() - encounter.firstAt), inline: true },
    );

    const title = hasOtherPlayerInvolved
        ? `${e('swords', '⚔️')} Relatório de Combate`
        : `${e('swords', '⚔️')} Relatório de Dano`;

    return new EmbedBuilder()
        .setColor(0xFF8800)
        .setTitle(title)
        .addFields(fields)
        .setTimestamp();
}

module.exports = { buildLoginEventPayload, formatMessage, formatEmbed, buildDamageReportEmbed, formatDamageType, dietEmoji };
