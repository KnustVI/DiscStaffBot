// src/systems/moderation/staffPresenceSystem.js
/**
 * Rastreia há quanto tempo cada staff (cargo Moderador ou Supervisor,
 * ver ConfigSystem.memberHasModOrSupervisorRole) está online no Discord
 * — pedido do dono, 2026-08-07: "visualizar os staffs onlines pelo
 * discord, e a quanto tempo eles estão online" (comando /staffonline).
 *
 * A API do Discord não guarda "desde quando" um usuário está online —
 * só manda EVENTOS de transição (presenceUpdate). Por isso este sistema
 * guarda, por conta própria, o timestamp de início de cada sessão online
 * em staff_presence_sessions (uma linha = um staff online AGORA; a linha
 * é apagada assim que ele fica offline — sem histórico linha-a-linha,
 * mesmo espírito de pot_spectator_sessions). O status pode mudar de
 * sabor (online/idle/dnd) sem resetar started_at — só fica offline de
 * verdade encerra a sessão.
 *
 * Depende da intent privilegiada GuildPresences (ver index.js) + do
 * evento src/events/presenceUpdate.js, que chama handlePresenceUpdate
 * pra cada transição de um membro com cargo de staff. Também depende de
 * syncGuildPresence (chamada uma vez no boot, ver events/ready.js) pra
 * semear quem JÁ estava online antes do bot subir — sem isso, ninguém
 * apareceria como online até a PRÓXIMA mudança de status de cada um
 * (poderia levar horas/dias). Limitação aceita: pra quem já estava
 * online antes do boot, started_at vira o momento do boot (o bot não
 * tem como saber a que horas a pessoa ficou online de verdade antes
 * disso) — a duração mostrada reseta a cada restart do bot pra esses
 * casos específicos.
 */
const db = require('../../database/index');
const ConfigSystem = require('../core/configSystem');

function _upsertOnline(guildId, userId, status) {
    db.prepare(`
        INSERT INTO staff_presence_sessions (guild_id, user_id, status, started_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET status = excluded.status
    `).run(guildId, userId, status, Date.now());
}

function clearOnline(guildId, userId) {
    db.prepare(`DELETE FROM staff_presence_sessions WHERE guild_id = ? AND user_id = ?`).run(guildId, userId);
}

/**
 * Chamada pelo evento presenceUpdate pra CADA presença que muda em
 * qualquer guild compartilhada — filtra pra só processar membros com
 * cargo de staff configurado (evita gravar no banco a cada troca de
 * status/jogo/Spotify de todo mundo no servidor, que dispara constante).
 */
function handlePresenceUpdate(oldPresence, newPresence) {
    try {
        const guild = newPresence?.guild;
        if (!guild || !newPresence.userId) return;

        const newStatus = newPresence.status || 'offline';
        if (oldPresence?.status === newStatus) return; // nada mudou de verdade (ex: só trocou de jogo)

        const member = newPresence.member || guild.members.cache.get(newPresence.userId);
        if (!member || member.user?.bot) return;
        if (!ConfigSystem.memberHasModOrSupervisorRole(guild.id, member)) return;

        if (newStatus === 'offline') {
            clearOnline(guild.id, member.id);
        } else {
            _upsertOnline(guild.id, member.id, newStatus);
        }
    } catch (error) {
        console.error('❌ [StaffPresence] Erro ao processar presenceUpdate:', error.message);
    }
}

/**
 * Sincronização inicial (uma vez por guild, no boot — ver ready.js):
 * semeia a tabela com quem já está online/idle/dnd AGORA, já que o bot
 * só aprende de transições dali em diante. `withPresences: true` é
 * necessário pro fetch trazer presence junto (não vem por padrão mesmo
 * com a intent habilitada).
 */
async function syncGuildPresence(guild) {
    try {
        const staffRoleCount = ConfigSystem.getRoleIds(guild.id, 'staff_role').length +
            ConfigSystem.getRoleIds(guild.id, 'supervisor_role').length;
        if (staffRoleCount === 0) return; // servidor ainda não configurou cargo nenhum — nada a sincronizar

        const members = await guild.members.fetch({ withPresences: true }).catch(() => null);
        if (!members) return;

        for (const member of members.values()) {
            if (member.user?.bot) continue;
            if (!ConfigSystem.memberHasModOrSupervisorRole(guild.id, member)) continue;
            const status = member.presence?.status;
            if (status && status !== 'offline') {
                _upsertOnline(guild.id, member.id, status);
            }
        }
    } catch (error) {
        console.error(`❌ [StaffPresence] Erro ao sincronizar presença inicial da guild ${guild.id}:`, error.message);
    }
}

/**
 * Staff atualmente online dentre os IDs informados, mais antigo primeiro
 * (quem está online há mais tempo aparece no topo). Usado por
 * /staffonline.
 * @returns {{userId: string, status: string, startedAt: number}[]}
 */
function getOnlineStaff(guildId, userIds) {
    if (!userIds || userIds.length === 0) return [];
    const placeholders = userIds.map(() => '?').join(',');
    const rows = db.prepare(`
        SELECT user_id, status, started_at FROM staff_presence_sessions
        WHERE guild_id = ? AND user_id IN (${placeholders})
        ORDER BY started_at ASC
    `).all(guildId, ...userIds);
    return rows.map(r => ({ userId: r.user_id, status: r.status, startedAt: r.started_at }));
}

/**
 * "2h 15m" / "3d 4h" / "5m" / "<1m" — sem exportar como utilitário
 * genérico de propósito (é bem específico pro caso "há quanto tempo
 * online", em minutos/horas/dias; não precisa de segundos).
 */
function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.floor(ms / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return '<1m';
}

module.exports = {
    handlePresenceUpdate,
    syncGuildPresence,
    getOnlineStaff,
    formatDuration,
    clearOnline,
};
