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

/**
 * " (NomeDoDino `IDDoDino`)" — identificação do DINOSSAURO em si (distinto
 * do jogador, que já é identificado por nameWithId). Pedido do dono: sempre
 * que characterName/characterId vierem no payload, mostrar como
 * identificação do dino. CONFIRMADO ao vivo (DEBUG_POT, Atlas Brasil) em
 * PlayerRespawn/PlayerLeave/PlayerQuestComplete/PlayerQuestFailed (campos
 * "CharacterName"/"CharacterID", sem prefixo) — CONFIRMADO AUSENTE em
 * PlayerDamagedPlayer. Retorna '' quando não há nada pra mostrar (nunca
 * quebra a mensagem).
 */
function dinoIdentitySuffix(characterName, characterId) {
    if (!characterName && !characterId) return '';
    const label = characterId ? `${characterName || 'Desconhecido'} \`${characterId}\`` : characterName;
    return ` (${label})`;
}

/**
 * "🦖 Espécie - NomeDoDino (ID)" — linha própria (não sufixo) combinando
 * emoji de dieta + espécie (DinosaurType) + nome do dino + ID, usada nos
 * logs de missão (segunda linha, pedido do dono). Omite as partes que não
 * vierem — nunca quebra a mensagem.
 */
function dinoTypeLine(dinosaurType, diet, characterName, characterId, guild) {
    const dietPrefix = dietEmoji(diet, guild);
    const species = dinosaurType || 'Desconhecido';
    const namePart = characterName ? ` - ${characterName}` : '';
    const idPart = characterId ? ` (${characterId})` : '';
    return `${dietPrefix ? `${dietPrefix} ` : ''}${species}${namePart}${idPart}`;
}

/**
 * " — Cargo: X" — cargo customizado do jogador dentro do PRÓPRIO jogo
 * (campo "Role", confirmado ao vivo em vários eventos: PlayerDamagedPlayer
 * como Source/TargetRole, AdminCommand/AdminSpectate como Role — ex:
 * "Nitro", "Balanceamento", "Diretor", "Estagiário"). Pedido do dono: todo
 * log de comando mostra o cargo do jogador. "None" (valor visto em jogadores
 * sem cargo nenhum) e vazio/ausente não mostram nada — não é informação
 * útil pra staff ver "Cargo: None" toda hora.
 */
function roleSuffix(role) {
    if (!role || role === 'None') return '';
    return ` — Cargo: ${role}`;
}

// Mesmas 3 chaves/labels de config-roles (STAFF_ROLE_KEYS em configSystem.js
// e guildMemberUpdate.js) — duplicado aqui de propósito pra manter
// webhookPayloads.js autocontido, mesmo padrão já usado no resto do arquivo.
const STAFF_ROLE_LABELS = { supervisor_role: 'Supervisor', staff_role: 'Moderador', event_role: 'Equipe de Eventos' };

/**
 * " | @menção (Discord: Cargo)" — identidade Discord de um jogador vinculado
 * a um AlderonId (mention direto, sem precisar de fetch de usuário — o
 * Discord resolve sozinho) + o cargo de staff dele NO DISCORD (Moderador/
 * Supervisor/Equipe de Eventos), quando o membro ainda estiver no servidor
 * e tiver um configurado. Pedido do dono: todo log de comando/RCON deve
 * trazer quem usou E o cargo, tanto em jogo (campo "Role" do próprio PoT,
 * já mostrado por roleSuffix acima) quanto no Discord. Sem vínculo, membro
 * fora do servidor, ou erro de fetch: cai no fallback silencioso de sempre
 * (string vazia, nunca quebra a mensagem).
 */
async function discordIdentitySuffix(guild, alderonId) {
    if (!guild || !alderonId) return '';
    let linked;
    try {
        linked = PlayerRegistry.getPlayerByAlderonId(alderonId);
    } catch (err) {
        return '';
    }
    if (!linked?.user_id) return '';

    const mention = `<@${linked.user_id}>`;
    try {
        const member = await guild.members.fetch(linked.user_id);
        const ConfigSystem = require('../../systems/core/configSystem');
        for (const key of ['supervisor_role', 'staff_role', 'event_role']) {
            if (ConfigSystem.memberHasConfiguredRole(guild.id, member, key)) {
                return ` | ${mention} (Discord: ${STAFF_ROLE_LABELS[key]})`;
            }
        }
    } catch (err) {
        // membro não está mais no servidor, ou fetch falhou — mostra só a menção
    }
    return ` | ${mention}`;
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
        // Identificação do DINO em si (CharacterName/CharacterID, confirmado
        // ao vivo só em PlayerLeave dentro deste grupo — Login/Logout não
        // têm esse campo, o jogador ainda não tinha um dino ativo).
        const dinoLine = dinoIdentitySuffix(d.CharacterName, d.CharacterID).trim();
        if (dinoLine) {
            builder.text(`${resolveEmoji(guild, 'DinoFootprint', '🦶')} **Dinossauro:** ${dinoLine.replace(/^\(|\)$/g, '')}`);
        }
    }

    builder.footer(guild?.name || d.ServerName || 'Servidor');

    const { components, flags } = builder.build();
    return { components: components.map(c => c.toJSON()), flags };
}

// ==================== TEXTO/EMBED — DEMAIS GRUPOS (formato legado) ====================

async function formatMessage(potEvent, data, guild) {
    const d = data || {};
    const e = (key, fallback) => resolveEmoji(guild, key, fallback);

    // Login/Logout/Leave NÃO entram aqui — já são tratados via
    // buildLoginEventPayload (container V2, já mostra nome + Alderon ID) e
    // nunca chegam nesta função (ver CONTAINER_EVENTS em gatewayServer.js).
    const formatters = {
        // ── Combate ──
        // PlayerDamagedPlayer NÃO entra aqui de propósito — é interceptado
        // antes, em gatewayServer._routeToDiscord, e vira um Relatório de
        // Combate/Dano agrupado (ver buildDamageReportPayload abaixo) em vez de
        // uma mensagem por golpe (evita flood no canal de log). PlayerKilled
        // TAMBÉM não entra mais aqui — ganhou painel próprio em Components V2
        // (ver buildKillPanel abaixo, interceptado em gatewayServer._routeToDiscord
        // antes deste caminho de texto+embed).

        // ── Quest ──
        // Formato de 2 linhas: jogador + missão na primeira, espécie
        // (com emoji de dieta) + nome do dino + ID na segunda.
        PlayerQuestComplete: () => `${e('listchecks', '📜')} **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** completou a missão **${d.Quest}**\n${dinoTypeLine(d.DinosaurType, d.Diet, d.CharacterName, d.CharacterID, guild)}`,
        PlayerQuestFailed:   () => `${e('circlealert', '❌')} **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** falhou na missão **${d.Quest}**\n${dinoTypeLine(d.DinosaurType, d.Diet, d.CharacterName, d.CharacterID, guild)}`,

        // ── Respawn ──
        // Identificação do dino (nome+ID) em linha própria, não mais colada
        // no final da mesma linha — pedido do dono.
        PlayerRespawn:  () => {
            const diet = dietEmoji(d.Diet, guild);
            const mainLine = `${e('refreshccw', '🔄')} **${nameWithId(d.PlayerName, d.PlayerAlderonId)}** ressurgiu como ${diet ? `${diet} ` : ''}**${d.DinosaurType}**`;
            const identityLine = dinoIdentitySuffix(d.CharacterName, d.CharacterID).trim();
            return identityLine ? `${mainLine}\n${identityLine}` : mainLine;
        },
        PlayerWaystone: () => `${e('Waystone', '✨')} **${nameWithId(d.InviterName, d.InviterAlderonId)}** teletransportou **${nameWithId(d.TeleportedPlayerName, d.TeleportedPlayerAlderonId)}**`,

        // ── Chat ──
        // Formato de 2 linhas: canal (+ "Sussurro" quando for whisper, +
        // "| Cargo" quando o campo Role vier) na primeira, identificação +
        // mensagem na segunda. CONFIRMADO ao vivo que PlayerChat
        // NORMALMENTE não tem campo "Role" (payload real sempre 8 campos) —
        // mostrado só quando vier, nunca força nada. Emoji por canal:
        // "Group" usa messagesquare, "Global" usa globo, qualquer outro
        // canal cai no messagecircle genérico.
        PlayerChat: () => {
            const channelName = d.ChannelName || 'Chat';
            const chatEmoji = channelName === 'Group'
                ? e('messagesquare', '🗨️')
                : channelName === 'Global'
                    ? e('globo', '🌐')
                    : e('messagecircle', '💬');
            const rolePart = d.Role && d.Role !== 'None' ? ` | ${d.Role}` : '';
            const channelLine = d.FromWhisper
                ? `${chatEmoji} ${channelName} - Sussurro${whisperTargetSuffix(d)}${rolePart}`
                : `${chatEmoji} ${channelName}${rolePart}`;
            const idPart = d.AlderonId ? ` \`${d.AlderonId}\`` : '';
            return `${channelLine}\n**${d.PlayerName || 'Desconhecido'}**${idPart}: ${d.Message}`;
        },
        // PlayerProfanity DESATIVADO temporariamente (ver DISABLED_EVENTS em
        // gatewayServer.js) — filtro de profanidade do jogo com falsos
        // positivos demais. Formatter mantido pronto pra quando reativar.
        PlayerProfanity: () => `${e('shieldban', '🔞')} **${nameWithId(d.PlayerName, d.AlderonId)}** tentou enviar mensagem bloqueada`,

        // ── Comandos ──
        // Pedido do dono: todo log de comando traz quem usou + cargo em
        // jogo (roleSuffix, já existia) E cargo no Discord (novo, ver
        // discordIdentitySuffix) quando o AlderonId estiver vinculado.
        PlayerCommand: async () => {
            const discordPart = await discordIdentitySuffix(guild, d.AlderonId);
            return `${e('raio', '⚡')} **${nameWithId(d.PlayerName, d.AlderonId)}**${discordPart}: \`${d.Message}\`${roleSuffix(d.Role)}`;
        },

        // ── Grupo ──
        PlayerJoinedGroup: () => `${e('users', '👥')} **${nameWithId(d.Player, d.PlayerAlderonId)}** entrou no grupo de **${nameWithId(d.Leader, d.LeaderAlderonId)}**`,
        PlayerLeftGroup:   () => `${e('users', '👥')} **${nameWithId(d.Player, d.PlayerAlderonId)}** saiu do grupo`,

        // ── Servidor ──
        ServerStart:             () => `🟢 Servidor **iniciou** | Mapa: \`${d.Map || 'desconhecido'}\``,
        ServerRestart:           () => `${e('refreshccw', '🔄')} Servidor **reiniciando**...`,
        // Campo confirmado na doc oficial: RestartTimeRemaining (inteiro,
        // segundos) — "CountdownTime" usado antes aqui nunca existiu no
        // payload real, por isso a contagem sempre aparecia como "?s".
        // Mantido como fallback só por segurança, nunca visto na prática.
        ServerRestartCountdown:  () => `${e('clockalert', '⏳')} Servidor reinicia em **${d.RestartTimeRemaining ?? d.CountdownTime ?? '?'}s**`,
        // ServerModerate não traz PlayerName no payload oficial (só
        // AlderonId) — mostra o ID puro, é a única identificação disponível.
        ServerModerate:          () => `${e('shieldcheck', '🛡️')} Moderação automática: \`${d.AlderonId || 'Desconhecido'}\` — ${d.Type || d.Action || 'ação'} — ${d.AdminReason || d.UserReason || 'sem motivo'}`,
        ServerError:             () => `${e('filewarning', '⚠️')} **ERRO:** ${d.ErrorMessage || d.ErrorMesssage || 'desconhecido'}`,
        SecurityAlert:           () => `${e('siren', '🚨')} **ALERTA DE SEGURANÇA:** ${d.SecurityAlert || 'suspeita detectada'}`,
        BadAverageTick:          () => `${e('trendingdown', '📉')} **PERFORMANCE:** Tick médio baixo (${d.AverageTick || '?'})`,

        // ── Admin ──
        // Campo confirmado ao vivo pra "Enabled/Disabled Nametags":
        // PlayerName/PlayerAlderonId (não AdminName/AdminAlderonId como a
        // doc oficial diz — ver ADMIN_ACTION_LABELS acima). A doc também
        // documenta uma variante "Entered/Exited Spectator Mode" pro MESMO
        // evento — ATUALIZAÇÃO: essa variante JÁ FOI VISTA disparando ao
        // vivo em produção (log real do dono, Action="Entered Spectator
        // Mode"/"Exited Spectator Mode"), contradizendo o que se acreditava
        // antes ("nunca dispara"). Fallback pro par Admin* continua valendo
        // pro caso de vir com os nomes de campo da doc em vez do padrão
        // confirmado, mesmo padrão já usado em AdminCommand logo abaixo.
        // bSpectatorMode: CONFIRMADO NÃO CONFIÁVEL com payloads reais de
        // produção (pot_logs, ver seção 62 do PREMIUM.txt) — em TODOS os
        // registros capturados, mesmo com Action="Entered Spectator Mode",
        // esse campo veio `false`. Por isso o analytics de horas de
        // espectador (AnalyticsSystem.recordAdminSpectateEvent,
        // gatewayServer.js) passou a se basear no próprio `Action`
        // ("Entered/Exited Spectator Mode") como sinal principal — só usa
        // bSpectatorMode===true como fallback extra, não mais como sinal
        // primário. Esta linha do painel (abaixo) continua mostrando o
        // valor cru de bSpectatorMode mesmo assim, só pra exibição — não é
        // mais a fonte de verdade usada pelo analytics.
        // Pedido do dono: linha própria com emoji (shieldcheck = está em
        // modo espectador, shieldban = não está, "Não definido" quando o
        // campo nem vier no payload).
        // Mesmo layout de heading+bullet do AdminCommand logo abaixo (pedido
        // do dono: vale pra qualquer log de comando/ação de admin, não só
        // AdminCommand).
        AdminSpectate: async () => {
            const role = d.Role && d.Role !== 'None' ? d.Role : 'Staff';
            const action = ADMIN_ACTION_LABELS[d.Action] || d.Action || 'realizou uma ação administrativa';
            const spectatorLine = d.bSpectatorMode === true
                ? `Modo espectador: ${e('shieldcheck', '✅')}`
                : d.bSpectatorMode === false
                    ? `Modo espectador: ${e('shieldban', '🚫')}`
                    : 'Modo espectador: Não definido';
            // Pedido do dono: mesmo aviso do /historico staff (analyticsSystem.js
            // SPECTATOR_DISCLAIMER) — o modo espectador está com um problema
            // conhecido pra pegar informação real do jogo, então este log
            // sozinho não deve embasar julgamento de staff no momento.
            const disclaimer = `-# ${e('trianglealert', '⚠️')} Modo espectador está atualmente com problemas para adquirir informações reais do jogo e não deve ser considerado para julgamento de staffs no momento!`;
            const alderonId = d.PlayerAlderonId || d.AdminAlderonId;
            const discordPart = await discordIdentitySuffix(guild, alderonId);
            return `### ${e('shield', '🛡️')} ${role}\n- ${nameWithId(d.PlayerName || d.AdminName, alderonId)}${discordPart}: ${action}\n${spectatorLine}\n${disclaimer}`;
        },
        // Campo confirmado ao vivo: AdminCommand usa AdminName/
        // AdminAlderonId de verdade (ao contrário do AdminSpectate acima,
        // que apesar de estar no mesmo grupo "Admin" da doc usa PlayerName/
        // PlayerAlderonId) — o fallback pro par PlayerName/PlayerAlderonId
        // fica só por segurança, nunca visto na prática pra este evento.
        // Layout pedido pelo dono: heading com emoji + cargo, bullet com
        // identificação + comando.
        AdminCommand: async () => {
            const role = d.Role && d.Role !== 'None' ? d.Role : 'Staff';
            const alderonId = d.AdminAlderonId || d.PlayerAlderonId;
            const discordPart = await discordIdentitySuffix(guild, alderonId);
            return `### ${e('shield', '🛡️')} ${role}\n- ${nameWithId(d.AdminName || d.PlayerName, alderonId)}${discordPart}: \`${d.Command}\``;
        },

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
        // A maioria dos formatters é síncrona (só monta string); PlayerCommand/
        // AdminCommand/AdminSpectate são async (precisam resolver identidade
        // Discord via discordIdentitySuffix) — await só quando o retorno for
        // de fato uma Promise, pra não forçar `async` em ~25 formatters que
        // não precisam disso.
        const result = fn();
        return result instanceof Promise ? await result : result;
    } catch (err) {
        return `${e('wifi', '📡')} Evento: \`${potEvent}\` (dados incompletos)`;
    }
}

/**
 * Painel (Components V2) "cru" pra qualquer log de webhook que não seja
 * chat (PlayerChat/PlayerProfanity, que continuam texto puro) nem já tenha
 * container próprio (Login/Logout/Leave, relatório de combate/dano, painel
 * de morte). Pedido do dono: uniformizar a aparência de todo log simples
 * sem adicionar título nem footer — só a caixa em volta do texto que já
 * tínhamos (formatMessage), sem mudar o conteúdo.
 *
 * @param {string} message - texto já formatado por formatMessage()
 * @returns {{ components: object[], flags: number }}
 */
function buildSimpleLogPayload(message) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    builder.text(message);
    const { components, flags } = builder.build();
    return { components: components.map((c) => c.toJSON()), flags };
}

// "X=12345.670 Y=-890.120 Z=345.000" (Respawn/Leave/Quest) ou
// "(X=..,Y=..,Z=..)" (PlayerKilled) — mesmo regex de extractEventLocation
// em gatewayServer.js, duplicado aqui de propósito pra manter
// webhookPayloads.js autocontido (mesmo padrão de formatGrowthStage).
// Formato de SAÍDA mantido igual ao cru do jogo a pedido do dono.
const KILL_LOCATION_RE = /X=(-?[\d.]+)[,\s]+Y=(-?[\d.]+)[,\s]+Z=(-?[\d.]+)/;
function formatLocationString(raw) {
    const match = typeof raw === 'string' ? raw.match(KILL_LOCATION_RE) : null;
    if (!match) return null;
    return `(X=${Math.round(Number(match[1]))},Y=${Math.round(Number(match[2]))},Z=${Math.round(Number(match[3]))})`;
}

/**
 * Painel (Components V2) de um PlayerKilled — substitui a antiga mensagem
 * de texto + embed. CONFIRMADO ao vivo (DEBUG_POT, Atlas Brasil): morte por
 * ambiente (queda/fome/afogamento) manda KillerName/KillerAlderonId como ""
 * e KillerGrowth como -1 — nesse caso omite o bloco "Matador" inteiro (não
 * existe assassino nenhum) e o título vira "MORTE POR AMBIENTE". Nome do
 * dino da vítima vem em "DinosaurVictimName" (não "VictimCharacterName" —
 * nomenclatura inconsistente do próprio jogo), do matador em
 * "KillerCharacterName" — nenhum ID de dino existe em PlayerKilled pra
 * nenhum dos dois lados.
 *
 * Layout pedido pelo dono é EMPILHADO (Vítima acima, Matador abaixo) — o
 * Components V2 não tem um jeito nativo de colocar dois blocos de texto
 * lado a lado (Section só permite 1 texto + 1 acessório de imagem/botão à
 * direita, não texto+texto); lado a lado de verdade só com embed clássico
 * (inline fields), que não pode se misturar com Components V2 na mesma
 * mensagem — decisão confirmada com o dono.
 *
 * @param {object} data
 * @param {import('discord.js').Guild} guild
 * @param {number} [receivedAt] - Date.now() de quando o gateway recebeu o
 *   evento (ver gatewayServer.js) — usado como "horário da morte". A doc
 *   oficial do PlayerKilled NÃO traz nenhum timestamp real, só um campo
 *   "TimeOfDay" (hora DENTRO do jogo, ex: 1300 = 13:00 em jogo, sem relação
 *   com o horário real) — mesmo critério já usado pros horários de golpe
 *   no relatório de combate (ver comentário "horário REAL" mais abaixo
 *   neste arquivo). Sem valor informado, cai em Date.now() na hora
 *   (praticamente o mesmo instante, só sem o valor exato de quando o
 *   webhook chegou).
 * @returns {{ components: object[], flags: number }}
 */
function buildKillPanel(data, guild, receivedAt) {
    const d = data || {};
    const e = (key, fallback) => resolveEmoji(guild, key, fallback);
    const hasKiller = Boolean(d.KillerName || d.KillerAlderonId);

    const builder = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });

    builder.title(`${e('Dead', '💀')} ${hasKiller ? 'MORTE EM COMBATE' : 'MORTE POR AMBIENTE'}`, 1);
    builder.text(`${e('clock', '🕐')} Horário da morte: <t:${Math.floor((receivedAt || Date.now()) / 1000)}:f>`);
    builder.text(`Dano: ${formatDamageType(d.DamageType)}`);

    const localParts = [d.VictimPOI, formatLocationString(d.VictimLocation)].filter(Boolean);
    if (localParts.length > 0) {
        builder.text(`Local: ${localParts.join(' - ')}`);
    }
    builder.separator();

    // Diet NÃO confirmado em PlayerKilled (nem VictimDiet nem KillerDiet
    // existem no payload real, ver seção 28/29) — chamado mesmo assim por
    // consistência/pedido do dono ("sempre" que DinosaurType aparecer):
    // dietEmoji() só não mostra nada enquanto o campo não vier, nunca quebra.
    const victimDiet = dietEmoji(d.VictimDiet, guild);
    const killerDiet = dietEmoji(d.KillerDiet, guild);

    builder.title('Vítima', 3);
    builder.text(
        `- ${d.VictimName || 'Desconhecido'} | ${d.VictimAlderonId || '—'} | ${d.VictimRole || '—'}\n` +
        `${victimDiet ? `${victimDiet} ` : ''}${d.VictimDinosaurType || 'Desconhecido'} - ${d.DinosaurVictimName || 'Desconhecido'} (${formatGrowthStage(d.VictimGrowth) || '—'})`
    );
    builder.separator();

    if (hasKiller) {
        builder.title('Matador', 3);
        builder.text(
            `- ${d.KillerName || 'Desconhecido'} | ${d.KillerAlderonId || '—'} | ${d.KillerRole || '—'}\n` +
            `${killerDiet ? `${killerDiet} ` : ''}${d.KillerDinosaurType || 'Desconhecido'} - ${d.KillerCharacterName || 'Desconhecido'} (${formatGrowthStage(d.KillerGrowth) || '—'})`
        );
        builder.separator();
    }

    builder.footer(guild?.name || d.ServerName || 'Servidor');

    const { components, flags } = builder.build();
    return { components: components.map((c) => c.toJSON()), flags };
}

// ==================== RELATÓRIO DE COMBATE/DANO (encontro) ====================

// Referência oficial confirmada pelo dono (vale pra TODOS os comandos/logs
// do bot, ver também formatGrowth em playerRegistrationSystem.js — duplicado
// aqui de propósito pra manter webhookPayloads.js autocontido, mesmo padrão
// já usado nesse arquivo): 0 = Filhote, 0.25 = Juvenil, 0.50 = Adolescente,
// 0.80 = Sub-Adulto, 1 = Adulto. Growth NUNCA aparece em porcentagem em
// nenhum log do bot — sempre o nome do estágio (pedido explícito do dono).
function formatGrowthStage(growth) {
    if (growth === null || growth === undefined) return null;
    if (growth >= 1) return 'Adulto';
    if (growth >= 0.80) return 'Sub-Adulto';
    if (growth >= 0.50) return 'Adolescente';
    if (growth >= 0.25) return 'Juvenil';
    return 'Filhote';
}

function formatDuration(ms) {
    const safeMs = Math.max(0, ms);
    return safeMs < 60000 ? `${Math.round(safeMs / 1000)}s` : `${Math.round(safeMs / 60000)}min`;
}

/**
 * Linha "🍖 Espécie — Growth: Sub-Adulto" de um participante — usada em
 * qualquer lugar do relatório que mencione a espécie de um dinossauro (a
 * pedido do dono: "sempre traga o emoji carni e herbi antes"). Growth
 * SEMPRE em nome de estágio, nunca porcentagem (pedido explícito do dono,
 * ver formatGrowthStage). diet vem de extractDinoIdentity() em
 * gatewayServer.js — PENDENTE/não confirmado pra eventos de combate (ver
 * comentário lá), então o emoji só aparece quando esse campo existir de
 * verdade no payload; sem ele, cai no mesmo fallback silencioso de sempre
 * (sem emoji, resto da linha normal).
 */
function participantSpeciesLine(p, guild) {
    const dietPrefix = dietEmoji(p.diet, guild);
    const stage = formatGrowthStage(p.dinosaurGrowth) || '—';
    return `${dietPrefix ? dietPrefix + ' ' : ''}${p.dinosaurType || 'Desconhecido'} — Growth: ${stage}`;
}

/**
 * Linha "NomeDoDino `IDDoDino`" de um participante — só existe se o
 * payload realmente trouxe essas informações (ver extractDinoIdentity em
 * gatewayServer.js, também PENDENTE/não confirmado). Retorna null quando
 * não há nada pra mostrar, pra quem chamar decidir se omite a linha.
 */
function participantDinoIdentityLine(p) {
    if (!p.characterName && !p.dinosaurId) return null;
    return `${p.characterName || 'Desconhecido'}${p.dinosaurId ? ` \`${p.dinosaurId}\`` : ''}`;
}

/**
 * Local (mapa/POI/coordenadas) do encontro — usa o último evento da
 * timeline que tiver QUALQUER campo de local reconhecido (mais perto de
 * onde o combate terminou). PENDENTE/não confirmado (ver extractEventLocation
 * em gatewayServer.js) — sem nenhum campo reconhecido em nenhum evento,
 * retorna null e a seção "Local" inteira some do relatório.
 */
function findEncounterLocation(encounter) {
    for (let i = encounter.events.length - 1; i >= 0; i -= 1) {
        const loc = encounter.events[i].location;
        if (loc && (loc.mapName || loc.poiName || loc.coords)) return loc;
    }
    return null;
}

/**
 * Junta strings (uma por "item" — um participante, um segmento de dano...)
 * em blocos de texto o MAIOR possível sem passar de maxChars, separando
 * itens dentro do mesmo bloco por uma linha em branco (pra manter a
 * separação visual que cada item tinha quando era seu próprio componente).
 * Cada bloco devolvido vira UM componente TextDisplay só — é isso que evita
 * "1 componente por item" (a raiz do bug de combates grandes estourarem o
 * limite de 40 componentes de um Container, ver buildDamageReportPayload).
 */
function chunkIntoBlocks(items, maxChars) {
    const SEP = '\n\n';
    const blocks = [];
    let current = [];
    let currentLen = 0;
    for (const item of items) {
        const addedLen = item.length + (current.length > 0 ? SEP.length : 0);
        if (current.length > 0 && currentLen + addedLen > maxChars) {
            blocks.push(current.join(SEP));
            current = [];
            currentLen = 0;
        }
        current.push(item);
        currentLen += item.length + (current.length > 1 ? SEP.length : 0);
    }
    if (current.length > 0) blocks.push(current.join(SEP));
    return blocks;
}

/**
 * Monta o painel (Components V2, via AdvancedContainerBuilder) de um
 * ENCONTRO acumulado (ver gatewayServer._bufferDamageEvent/
 * _recordKillIntoEncounter) — todo dano/morte entre jogadores conectados
 * (A bate em B, B bate em C → A/B/C entram no MESMO encontro) dentro da
 * janela de agrupamento vira UM relatório só, em vez de uma mensagem por
 * golpe ou um relatório por par (evita flood E fragmentação em combates
 * de 3+ jogadores). Se nenhum outro jogador esteve envolvido (só dano
 * próprio/ambiente), vira um "Relatório de Dano Isolado" mais enxuto, sem
 * seção de participantes múltiplos nem de local.
 *
 * CONFIRMADO ao vivo (produção, combate grande com muitos participantes/
 * segmentos): o Discord rejeita a mensagem inteira com HTTP 400
 * "BASE_TYPE_BAD_LENGTH" quando um Container tem mais de 40 componentes
 * filhos (title/text/separator contam cada um como 1) — o relatório
 * inteiro simplesmente não chegava, sem nenhum aviso visível pro staff
 * (só um warning no console). Por isso esta função agora PAGINA: em vez
 * de um container gigante, devolve VÁRIAS mensagens (uma por "parte")
 * quando o conteúdo não cabe num só, cada uma dentro do limite — nunca
 * perde participante/segmento nenhum.
 *
 * @param {object} encounter - { participants: Map<key, {name, alderonId,
 *   dinosaurType, dinosaurGrowth, diet, characterName, dinosaurId}>,
 *   events: [...], firstAt }
 * @param {import('discord.js').Guild} guild
 * @returns {{ components: object[], flags: number }[]} um payload por parte (normalmente só 1)
 */
function buildDamageReportPayload(encounter, guild) {
    const e = (key, fallback) => resolveEmoji(guild, key, fallback);
    const participant = (key) => encounter.participants.get(key) || { name: 'Desconhecido', alderonId: null };
    const participantLabel = (key) => nameWithId(participant(key).name, participant(key).alderonId);
    // Mesmo nome+ID acima, mas com o emoji de dieta na frente — pedido do
    // dono: todo log de dano/morte também mostra o emoji do dino, não só o
    // cabeçalho de "Jogadores Envolvidos" (que já tinha desde a seção 26).
    const participantLabelWithDiet = (key) => {
        const p = participant(key);
        const diet = dietEmoji(p.diet, guild);
        return `${diet ? `${diet} ` : ''}${nameWithId(p.name, p.alderonId)}`;
    };

    // ── Eventos agrupados em segmentos, na ordem de PRIMEIRA aparição —
    // cada morte é seu próprio segmento (evento único); cada par atacante/
    // alvo de dano vira um segmento só, mesmo com múltiplos golpes. Cada
    // golpe guarda o horário REAL (relógio do servidor, não tempo de jogo)
    // em que chegou, pra listar depois. ─────────────────────────────────────
    const segments = new Map();
    let killCounter = 0;
    // Se NENHUM evento envolver dois jogadores diferentes (nem morte, nem
    // dano de um em outro) o encontro inteiro é só dano próprio/ambiente
    // (queda, sangramento, fome...) — vira "Relatório de Dano Isolado" em
    // vez de "Relatório de Combate", já que não houve combate de verdade.
    let hasOtherPlayerInvolved = false;

    for (const ev of encounter.events) {
        if (ev.type === 'kill') {
            killCounter += 1;
            // killerKey null = morte por ambiente (queda/fome/afogamento,
            // confirmado ao vivo pelo KillerName/KillerAlderonId virem "" —
            // ver _recordKillIntoEncounter) — não conta como "outro jogador
            // envolvido" (fica Dano Isolado se não houver mais nada no
            // encontro) e não tenta mostrar um "assassino" que não existe.
            const text = ev.killerKey
                ? `${e('Dead', '💀')} Morte\n**${participantLabelWithDiet(ev.victimKey)}** foi morto por **${participantLabelWithDiet(ev.killerKey)}**\nCausa: ${formatDamageType(ev.damageType)}`
                : `${e('Dead', '💀')} Morte\n**${participantLabelWithDiet(ev.victimKey)}** morreu (sem assassino)\nCausa: ${formatDamageType(ev.damageType)}`;
            if (ev.killerKey) hasOtherPlayerInvolved = true;
            segments.set(`kill:${killCounter}`, { kind: 'kill', text });
            continue;
        }

        const isSelf = ev.sourceKey === ev.targetKey;
        if (!isSelf) hasOtherPlayerInvolved = true;

        const segKey = `dmg:${ev.sourceKey}->${ev.targetKey}`;
        let seg = segments.get(segKey);
        if (!seg) {
            seg = {
                kind: 'damage',
                header: isSelf
                    ? `- ${participantLabelWithDiet(ev.targetKey)} — dano próprio/ambiente`
                    : `- ${participantLabelWithDiet(ev.sourceKey)} ${e('DoubleArrowRigth', '»')} ${participantLabelWithDiet(ev.targetKey)}`,
                byType: new Map(),
            };
            segments.set(segKey, seg);
        }
        const typeEntry = seg.byType.get(ev.damageType) || { count: 0, sum: 0, hitTimes: [] };
        typeEntry.count += 1;
        typeEntry.sum += ev.damageAmount;
        typeEntry.hitTimes.push(ev.at);
        seg.byType.set(ev.damageType, typeEntry);
    }

    // Cada linha de tipo de dano vira "Tipo | Nx | Y | horários" — <t:...:T>
    // deixa o Discord mostrar o horário já convertido pro fuso de quem está
    // lendo, sem o bot precisar adivinhar fuso horário nenhum. Com 3 golpes
    // ou menos, lista os horários individuais; com mais que isso (dano
    // contínuo tipo fome/afogamento pode ter dezenas de ticks — ver
    // screenshot que motivou essa mudança, uma lista de +10 horários ficava
    // enorme e pouco útil), mostra só o intervalo entre o primeiro e o
    // último golpe daquele tipo.
    const MAX_TIMES_LISTED = 3;
    const typeLines = (byType) => [...byType.entries()].map(([type, { count, sum, hitTimes }]) => {
        const fmt = (t) => `<t:${Math.floor(t / 1000)}:T>`;
        const timesText = hitTimes.length > MAX_TIMES_LISTED
            ? `Dano feito entre ${fmt(hitTimes[0])} e ${fmt(hitTimes[hitTimes.length - 1])}`
            : hitTimes.map(fmt).join(', ');
        return `${formatDamageType(type)} | ${count}x | ${sum} | ${timesText}`;
    });

    // ── Duas redes de segurança independentes, pra nunca estourar nenhum
    // limite do Discord:
    // 1) Cada TextDisplay tem limite de ~4000 caracteres de conteúdo —
    //    MAX_CHARS_PER_BLOCK junta o MÁXIMO de itens (participantes,
    //    segmentos de dano) num componente só antes de abrir outro, em vez
    //    de 1 componente por item (era isso que estourava o limite de
    //    componentes do Container antes — ver 2).
    // 2) Um Container só aceita até 40 componentes filhos no total —
    //    MAX_PER_PART divide em várias MENSAGENS quando mesmo assim não
    //    coube (praticamente nunca deve acontecer agora que cada seção
    //    vira 1-2 componentes em vez de 1 por item, mas fica como último
    //    recurso pra combates realmente gigantescos). ─────────────────────
    const MAX_CHARS_PER_BLOCK = 3800;
    const MAX_PER_PART = 39;
    const payloads = [];
    let builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    let count = 0;
    let part = 1;

    const finalizePart = (isLast) => {
        if (isLast) {
            ensureRoom(1);
            builder.footer(guild?.name || 'Servidor');
        }
        const { components, flags } = builder.build();
        payloads.push({ components: components.map((c) => c.toJSON()), flags });
    };
    const startNewPart = () => {
        part += 1;
        builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.text(`*(continuação ${part})*`);
        count = 1;
    };
    function ensureRoom(needed = 1) {
        if (count + needed > MAX_PER_PART) {
            finalizePart(false);
            startNewPart();
        }
    }
    const addTitle = (text, level) => { ensureRoom(); builder.title(text, level); count += 1; };
    const addText = (text) => { ensureRoom(); builder.text(text); count += 1; };
    const addSeparator = () => { ensureRoom(); builder.separator(); count += 1; };
    // Adiciona uma LISTA de itens (um por participante, um por segmento de
    // dano...) juntando o máximo possível em cada bloco de texto — vira 1
    // componente só pro grupo inteiro na imensa maioria dos casos, em vez
    // de 1 componente por item (raiz do bug de combates grandes nunca
    // chegarem, ver docblock). Só quebra em mais de um bloco se o texto
    // combinado passar do limite de caracteres de um TextDisplay.
    const addItemList = (items) => {
        for (const block of chunkIntoBlocks(items, MAX_CHARS_PER_BLOCK)) {
            addText(block);
        }
    };

    if (hasOtherPlayerInvolved) {
        addTitle(`${e('Atack', '⚔️')} RELATÓRIO DE COMBATE`, 1);
        addText(
            'O relatório de combate é feito com atraso e não reflete 100% do que ocorreu em um combate e pode cometer erros — em caso de quebra de regra, avalie sempre um vídeo e outros fatos e logs.\n' +
            'Valores de dano aplicados são aproximados e não refletem o dano 100% correto em jogo.'
        );
        addSeparator();

        addTitle('JOGADORES ENVOLVIDOS', 2);
        const participantItems = [...encounter.participants.keys()].map((key) => {
            const p = participant(key);
            const lines = [`### ${nameWithId(p.name, p.alderonId)}`, participantSpeciesLine(p, guild)];
            const identityLine = participantDinoIdentityLine(p);
            if (identityLine) lines.push(identityLine);
            return lines.join('\n');
        });
        addItemList(participantItems);
        addSeparator();

        const location = findEncounterLocation(encounter);
        if (location) {
            addTitle('LOCAL', 2);
            const mapPoi = [location.mapName, location.poiName].filter(Boolean).join(' - ');
            const localLines = [];
            if (mapPoi) localLines.push(`- ${e('map', '🗺️')} ${mapPoi}`);
            if (location.coords) localLines.push(`- ${e('mappin', '📍')} ${location.coords}`);
            if (localLines.length > 0) addText(localLines.join('\n'));
            addSeparator();
        }

        addTitle('RELATÓRIO DE DANO', 2);
        const segmentItems = [...segments.values()].map((seg) =>
            seg.kind === 'kill' ? seg.text : [seg.header, ...typeLines(seg.byType)].join('\n')
        );
        addItemList(segmentItems);
    } else {
        // Encontro isolado: só existe UM participante possível (dano
        // próprio nunca envolve outro jogador), então não há seção de
        // "jogadores envolvidos" nem de "local" — vai direto pro cabeçalho
        // do jogador e a lista de dano.
        addTitle(`${e('olho', '👁️')} RELATÓRIO DE DANO ISOLADO`, 1);
        addText('Valores de dano aplicados são aproximados e não refletem o dano 100% correto em jogo.');

        const [onlyKey] = encounter.participants.keys();
        const p = participant(onlyKey);
        const lines = [`### ${nameWithId(p.name, p.alderonId)}`, participantSpeciesLine(p, guild)];
        const identityLine = participantDinoIdentityLine(p);
        if (identityLine) lines.push(identityLine);
        addText(lines.join('\n'));
        addSeparator();

        // Morte por ambiente sem nenhum dano registrado antes dela (ex:
        // fome/sede matando direto) também pode cair aqui — mesmo segmento
        // "kill" usado no relatório de combate, só que sem "outro jogador
        // envolvido" (ver hasOtherPlayerInvolved acima).
        const segmentItems = [...segments.values()].map((seg) =>
            seg.kind === 'kill' ? seg.text : typeLines(seg.byType).join('\n')
        );
        addItemList(segmentItems);
    }

    addSeparator();
    finalizePart(true);

    return payloads;
}

module.exports = { buildLoginEventPayload, formatMessage, buildSimpleLogPayload, buildDamageReportPayload, buildKillPanel, formatDamageType, dietEmoji };
