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

function resolveEmoji(guild, key, fallback) {
    const found = guild?.emojis?.cache?.find(e => e.name?.toLowerCase() === key.toLowerCase());
    return found ? found.toString() : fallback;
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
        const linked = PlayerRegistry.getPlayerByAlderonId(guildId, alderonId);
        if (linked?.discord_id) {
            discordUser = await client.users.fetch(linked.discord_id).catch(() => null);
        }
    } catch (err) {
        // sem vínculo encontrado — segue sem info de Discord
    }

    const avatarUrl = discordUser?.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';

    const playerName = d.PlayerName || 'Desconhecido';
    const suffix = titleSuffixes[potEvent] || potEvent;
    const nameLines = [`## ${playerName} ${suffix}`];
    if (discordUser) {
        nameLines.push(`${resolveEmoji(guild, 'circleuser', '👤')} ${discordUser.toString()} (\`${discordUser.tag}\`)`);
    }

    const builder = new AdvancedContainerBuilder({ accentColor: color });
    builder.section(nameLines.join('\n'), AdvancedContainerBuilder.thumbnail(avatarUrl));
    builder.separator();
    builder.text(`${resolveEmoji(guild, 'tv', '🖥️')} **Servidor:** ${d.ServerName || 'Desconhecido'}`);
    builder.text(`🆔 **Alderon ID:** \`${alderonId || 'N/A'}\``);
    builder.text(`${resolveEmoji(guild, 'crown', '👑')} **Admin:** ${d.bServerAdmin ? 'Sim' : 'Não'}`);

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

    const formatters = {
        // ── Login / Logout ──
        PlayerLogin:   () => `${e('DinoFootprint', '🎮')} **${d.PlayerName}** entrou no servidor${d.bServerAdmin ? ` ${e('crown', '👑')}` : ''}`,
        PlayerLogout:  () => `${e('logout', '👋')} **${d.PlayerName}** saiu do servidor`,
        PlayerLeave:   () => `${e('logout', '🚶')} **${d.PlayerName}** desconectou`,

        // ── Combate ──
        PlayerKilled:        () => `${e('Dead', '💀')} **${d.VictimName}** foi morto por **${d.KillerName}**\n${e('build', '🔧')} Causa: \`${d.DamageType}\``,
        PlayerDamagedPlayer: () => `${e('swords', '⚔️')} **${d.SourceName}** causou **${d.DamageAmount}** de dano em **${d.TargetName}**`,

        // ── Quest ──
        PlayerQuestComplete: () => `${e('listchecks', '📜')} **${d.PlayerName}** completou a missão **${d.Quest}**`,
        PlayerQuestFailed:   () => `${e('circlealert', '❌')} **${d.PlayerName}** falhou na missão **${d.Quest}**`,

        // ── Respawn ──
        PlayerRespawn:  () => `${e('refreshccw', '🔄')} **${d.PlayerName}** ressurgiu como **${d.DinosaurType}**`,
        PlayerWaystone: () => `${e('Waystone', '✨')} **${d.InviterName}** teletransportou **${d.TeleportedPlayerName}**`,

        // ── Chat ──
        PlayerChat:      () => `${e('messagecircle', '💬')} **${d.PlayerName}:** ${d.Message}`,
        PlayerProfanity: () => `${e('shieldban', '🔞')} **${d.PlayerName}** tentou enviar mensagem bloqueada`,

        // ── Comandos ──
        PlayerCommand: () => `${e('raio', '⚡')} **${d.PlayerName}:** \`${d.Message}\``,

        // ── Grupo ──
        PlayerJoinedGroup: () => `${e('users', '👥')} **${d.Player}** entrou no grupo de **${d.Leader}**`,
        PlayerLeftGroup:   () => `${e('users', '👥')} **${d.Player}** saiu do grupo`,

        // ── Servidor ──
        ServerStart:             () => `🟢 Servidor **iniciou** | Mapa: \`${d.Map || 'desconhecido'}\``,
        ServerRestart:           () => `${e('refreshccw', '🔄')} Servidor **reiniciando**...`,
        ServerRestartCountdown:  () => `${e('clockalert', '⏳')} Servidor reinicia em **${d.CountdownTime || '?'}s**`,
        ServerModerate:          () => `${e('shieldcheck', '🛡️')} Moderação automática: **${d.PlayerName}** — ${d.Reason || 'sem motivo'}`,
        ServerError:             () => `${e('filewarning', '⚠️')} **ERRO:** ${d.ErrorMessage || d.ErrorMesssage || 'desconhecido'}`,
        SecurityAlert:           () => `${e('siren', '🚨')} **ALERTA DE SEGURANÇA:** ${d.SecurityAlert || 'suspeita detectada'}`,
        BadAverageTick:          () => `${e('trendingdown', '📉')} **PERFORMANCE:** Tick médio baixo (${d.AverageTick || '?'})`,

        // ── Admin ──
        AdminSpectate: () => `${e('eye', '👁️')} **${d.AdminName}** ${d.Action === 'Entered Spectator Mode' ? 'entrou no modo espectador' : 'saiu do modo espectador'}`,
        AdminCommand:  () => `${e('crown', '👑')} **${d.AdminName}** executou: \`${d.Command}\``,

        // ── Nest ──
        CreateNest:    () => `${e('Nest', '🪺')} **${d.PlayerName}** criou um ninho`,
        DestroyNest:   () => `💥 Ninho de **${d.PlayerName}** foi destruído`,
        NestInvite:    () => `${e('mensagem', '📨')} **${d.PlayerName}** convidou **${d.InvitedPlayer}** para o ninho`,
        PlayerJoinNest: () => `${e('circlecheck', '✅')} **${d.PlayerName}** entrou em um ninho`,
        UpdateNest:    () => `${e('filetext', '📝')} Ninho de **${d.PlayerName}** foi atualizado`,
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
        return new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle(`${e('Dead', '💀')} Morte em Combate`)
            .addFields(
                { name: 'Vítima', value: d.VictimName, inline: true },
                { name: 'Assassino', value: d.KillerName, inline: true },
                { name: 'Causa', value: d.DamageType || 'Desconhecida', inline: true }
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

module.exports = { buildLoginEventPayload, formatMessage, formatEmbed };
