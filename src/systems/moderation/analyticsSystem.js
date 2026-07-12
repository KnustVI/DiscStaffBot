// /home/ubuntu/DiscStaffBot/src/systems/moderation/analyticsSystem.js
const db = require('../../database/index');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let EMOJIS = {};
try {
    const emojisFile = require('../../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

// Valores de `Action` do evento AdminSpectate — sinal confiável de entrada/
// saída de modo espectador (bSpectatorMode não é, ver recordAdminSpectateEvent).
const SPECTATOR_ENTER_ACTIONS = new Set(['Entered Spectator Mode']);
const SPECTATOR_EXIT_ACTIONS = new Set(['Exited Spectator Mode']);
const NAMETAG_TOGGLE_ACTIONS = new Set(['Enabled Nametags', 'Disabled Nametags']);

class AnalyticsSystem {

    static getLocalDate(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Qualquer PARTE do sistema de analytics de staff (gravação inclusa, não
    // só exibição) é Caçador-only — pedido do dono. Se o servidor perder o
    // Caçador depois, os dados JÁ GRAVADOS não são apagados (ver purge em
    // guildMemberUpdate.js, que é sobre perder CARGO, não sobre perder tier)
    // — eles só param de crescer até o servidor voltar a ser Caçador.
    static _isAnalyticsAllowed(guildId) {
        const PremiumSystem = require('../premium/premiumSystem');
        return PremiumSystem.getGuildLimits(guildId).analyticsEnabled;
    }

    // Garante que exista uma linha do dia pra esse staff antes de qualquer
    // UPDATE incremental abaixo — UPDATE sozinho não cria linha nova. Ponto
    // único de gate Caçador-only pra TODOS os record*/add* abaixo (todos
    // chamam _ensureRow primeiro) — sem gate aqui, nenhuma linha nova é
    // criada e o UPDATE seguinte de cada método vira um no-op inofensivo.
    static _ensureRow(guildId, userId, date) {
        if (!this._isAnalyticsAllowed(guildId)) return;
        db.prepare(`
            INSERT INTO staff_analytics (guild_id, user_id, period, date, updated_at)
            VALUES (?, ?, 'day', ?, ?)
            ON CONFLICT(guild_id, user_id, period, date) DO NOTHING
        `).run(guildId, userId, date, Date.now());
    }

    // ==================== NOVAS MÉTRICAS (incrementais, chamadas pelos hooks) ====================

    // Staff entrou (assumiu) num report — ver reportChatSystem.js joinReport().
    //
    // IMPORTANTE: o gate Caçador-only de _ensureRow só evita CRIAR uma linha
    // nova — se a linha já existir (criada num dia em que o servidor ERA
    // Caçador), o UPDATE abaixo rodaria incondicionalmente e continuaria
    // incrementando um servidor já rebaixado. Por isso todo record*/add*
    // também checa _isAnalyticsAllowed no próprio topo, não só via _ensureRow.
    static recordReportJoin(guildId, userId, date = null) {
        if (!this._isAnalyticsAllowed(guildId)) return;
        const targetDate = date || this.getLocalDate();
        this._ensureRow(guildId, userId, targetDate);
        db.prepare(`
            UPDATE staff_analytics SET reports_joined = reports_joined + 1, updated_at = ?
            WHERE guild_id = ? AND user_id = ? AND period = 'day' AND date = ?
        `).run(Date.now(), guildId, userId, targetDate);
    }

    // Mensagem de staff numa thread de report — ver events/messageCreat.js.
    // responseSeconds: tempo desde a mensagem anterior na thread (de
    // qualquer pessoa) até esta resposta; null quando não há uma anterior
    // pra comparar (não deveria acontecer, created_at sempre existe, mas
    // fica defensivo).
    static recordReportMessage(guildId, userId, responseSeconds = null, date = null) {
        if (!this._isAnalyticsAllowed(guildId)) return;
        const targetDate = date || this.getLocalDate();
        this._ensureRow(guildId, userId, targetDate);
        const hasResponse = Number.isFinite(responseSeconds) && responseSeconds >= 0;
        db.prepare(`
            UPDATE staff_analytics SET
                report_messages_count = report_messages_count + 1,
                report_response_seconds_sum = report_response_seconds_sum + ?,
                report_response_count = report_response_count + ?,
                updated_at = ?
            WHERE guild_id = ? AND user_id = ? AND period = 'day' AND date = ?
        `).run(hasResponse ? Math.round(responseSeconds) : 0, hasResponse ? 1 : 0, Date.now(), guildId, userId, targetDate);
    }

    // Staff criou um evento — ver commands/events/evento.js.
    static recordEventCreated(guildId, userId, date = null) {
        if (!this._isAnalyticsAllowed(guildId)) return;
        const targetDate = date || this.getLocalDate();
        this._ensureRow(guildId, userId, targetDate);
        db.prepare(`
            UPDATE staff_analytics SET events_created = events_created + 1, updated_at = ?
            WHERE guild_id = ? AND user_id = ? AND period = 'day' AND date = ?
        `).run(Date.now(), guildId, userId, targetDate);
    }

    static recordNametagToggle(guildId, userId, isSpectating, date = null) {
        if (!this._isAnalyticsAllowed(guildId)) return;
        const targetDate = date || this.getLocalDate();
        this._ensureRow(guildId, userId, targetDate);
        const column = isSpectating ? 'nametag_toggles_spectating' : 'nametag_toggles_not_spectating';
        db.prepare(`
            UPDATE staff_analytics SET ${column} = ${column} + 1, updated_at = ?
            WHERE guild_id = ? AND user_id = ? AND period = 'day' AND date = ?
        `).run(Date.now(), guildId, userId, targetDate);
    }

    static addSpectatorSeconds(guildId, userId, seconds, date = null) {
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        if (!this._isAnalyticsAllowed(guildId)) return;
        const targetDate = date || this.getLocalDate();
        this._ensureRow(guildId, userId, targetDate);
        db.prepare(`
            UPDATE staff_analytics SET spectator_seconds = spectator_seconds + ?, updated_at = ?
            WHERE guild_id = ? AND user_id = ? AND period = 'day' AND date = ?
        `).run(Math.round(seconds), Date.now(), guildId, userId, targetDate);
    }

    // Resolve o Discord vinculado a um AlderonId (player_links) e confirma
    // que ele REALMENTE tem, no Discord, um dos 3 cargos que contam como
    // staff (Moderador/Supervisor/Equipe de Eventos — ver
    // ConfigSystem.memberHasAnyStaffRole). Precisa do client pra buscar o
    // GuildMember (cache primeiro, fetch só se necessário). Retorna null se
    // não houver vínculo, membro não encontrado, ou cargo não bater.
    static async _resolveTrackedStaffMember(client, guildId, alderonId) {
        const PlayerRegistry = require('../pot/potPlayerRegistry');
        const linked = PlayerRegistry.getPlayerByAlderonId(alderonId);
        if (!linked?.user_id) return null;

        const guild = client?.guilds?.cache?.get(guildId);
        if (!guild) return null;

        const member = guild.members.cache.get(linked.user_id)
            || await guild.members.fetch(linked.user_id).catch(() => null);
        if (!member) return null;

        const ConfigSystem = require('../core/configSystem');
        if (!ConfigSystem.memberHasAnyStaffRole(guildId, member)) return null;

        return member;
    }

    // ── Nametag/modo espectador (evento AdminSpectate) ──────────────────────
    // CORRIGIDO com dados reais de produção (5 registros capturados via
    // pot_logs, todos com bSpectatorMode=false mesmo quando Action já dizia
    // "Entered Spectator Mode") — bSpectatorMode não é confiável pra saber
    // se o admin ACABOU de entrar/sair do modo espectador nesse evento. O
    // sinal de verdade é o próprio `Action`:
    //   'Entered Spectator Mode' → abre sessão
    //   'Exited Spectator Mode'  → fecha sessão (via closeSpectatorSession,
    //                              mesma função já usada pelo PlayerRespawn)
    //   'Enabled/Disabled Nametags' → conta o toggle, "com espectador" =
    //                              existe sessão aberta NESSE MOMENTO (não
    //                              mais bSpectatorMode)
    // bSpectatorMode=true mantido como fallback OR pra abrir sessão, caso
    // o campo algum dia venha true de verdade em outro cenário.
    // Só credita/abre sessão se (a) o servidor for tier Caçador e (b) o
    // AlderonId tiver, DE VERDADE, um dos cargos de staff no Discord —
    // pedido do dono, fecha a brecha de confiar só na permissão do jogo.
    static async recordAdminSpectateEvent(client, guildId, alderonId, action, bSpectatorModeRaw) {
        if (!guildId || !alderonId) return;
        try {
            if (SPECTATOR_EXIT_ACTIONS.has(action)) {
                await this.closeSpectatorSession(client, guildId, alderonId);
                return;
            }

            if (!this._isAnalyticsAllowed(guildId)) return;

            const member = await this._resolveTrackedStaffMember(client, guildId, alderonId);
            if (!member) return;

            if (SPECTATOR_ENTER_ACTIONS.has(action) || bSpectatorModeRaw === true) {
                // INSERT OR IGNORE — se já existir sessão aberta, um 2º
                // "Entered" seguido não reseta o horário de início.
                db.prepare(`
                    INSERT OR IGNORE INTO pot_spectator_sessions (guild_id, alderon_id, started_at)
                    VALUES (?, ?, ?)
                `).run(guildId, alderonId, Date.now());
                return;
            }

            if (NAMETAG_TOGGLE_ACTIONS.has(action)) {
                const isSpectating = !!db.prepare(`
                    SELECT 1 FROM pot_spectator_sessions WHERE guild_id = ? AND alderon_id = ?
                `).get(guildId, alderonId);
                this.recordNametagToggle(guildId, member.id, isSpectating);
            }
        } catch (err) {
            console.error('❌ [Analytics] Erro ao processar AdminSpectate:', err.message);
        }
    }

    // Fecha a sessão de espectador aberta desse Alderon ID (se houver) —
    // chamado no PlayerRespawn, que indica que o admin voltou a jogar um
    // dinossauro (saiu do modo espectador). A sessão é SEMPRE apagada (evita
    // registro órfão), mas os segundos só são somados em staff_analytics se
    // o tier/cargo ainda baterem NA HORA do fechamento (podem ter mudado
    // enquanto a sessão estava aberta).
    static async closeSpectatorSession(client, guildId, alderonId) {
        if (!guildId || !alderonId) return;
        try {
            const session = db.prepare(`
                SELECT started_at FROM pot_spectator_sessions WHERE guild_id = ? AND alderon_id = ?
            `).get(guildId, alderonId);
            if (!session) return;

            db.prepare(`DELETE FROM pot_spectator_sessions WHERE guild_id = ? AND alderon_id = ?`).run(guildId, alderonId);

            if (!this._isAnalyticsAllowed(guildId)) return;

            const member = await this._resolveTrackedStaffMember(client, guildId, alderonId);
            if (!member) return;

            const elapsedSeconds = (Date.now() - session.started_at) / 1000;
            this.addSpectatorSeconds(guildId, member.id, elapsedSeconds);
        } catch (err) {
            console.error('❌ [Analytics] Erro ao fechar sessão de espectador:', err.message);
        }
    }

    static async updateStaffAnalytics(guildId, userId, date = null) {
        if (!this._isAnalyticsAllowed(guildId)) return null;
        const targetDate = date || this.getLocalDate();

        const punishmentsApplied = db.prepare(`
            SELECT COUNT(*) as count FROM punishments 
            WHERE guild_id = ? AND moderator_id = ? 
            AND date(created_at/1000, 'unixepoch', 'localtime') = ?
        `).get(guildId, userId, targetDate).count;
        
        let reportsClaimed = 0;
        try {
            reportsClaimed = db.prepare(`
                SELECT COUNT(*) as count FROM reports 
                WHERE guild_id = ? AND claimed_by = ? 
                AND date(claimed_at/1000, 'unixepoch', 'localtime') = ?
            `).get(guildId, userId, targetDate).count;
        } catch (err) {
            reportsClaimed = 0;
        }
        
        let reportsClosed = 0;
        try {
            reportsClosed = db.prepare(`
                SELECT COUNT(*) as count FROM reports 
                WHERE guild_id = ? AND closed_by = ? 
                AND date(closed_at/1000, 'unixepoch', 'localtime') = ?
            `).get(guildId, userId, targetDate).count;
        } catch (err) {
            reportsClosed = 0;
        }
        
        let avgResponseTime = null;
        try {
            const responseTimes = db.prepare(`
                SELECT (claimed_at - created_at) as response_time 
                FROM reports 
                WHERE guild_id = ? AND claimed_by = ? AND claimed_at IS NOT NULL 
                AND date(created_at/1000, 'unixepoch', 'localtime') = ?
            `).all(guildId, userId, targetDate);
            
            avgResponseTime = responseTimes.length > 0 
                ? Math.round(responseTimes.reduce((a, b) => a + b.response_time, 0) / responseTimes.length / 1000)
                : null;
        } catch (err) {
            avgResponseTime = null;
        }
        
        db.prepare(`
            INSERT INTO staff_analytics (
                guild_id, user_id, period, date, 
                punishments_applied, reports_claimed, reports_closed, 
                avg_response_time, updated_at
            ) VALUES (?, ?, 'day', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, user_id, period, date) 
            DO UPDATE SET
                punishments_applied = excluded.punishments_applied,
                reports_claimed = excluded.reports_claimed,
                reports_closed = excluded.reports_closed,
                avg_response_time = excluded.avg_response_time,
                updated_at = excluded.updated_at
        `).run(
            guildId, userId, targetDate,
            punishmentsApplied, reportsClaimed, reportsClosed,
            avgResponseTime, Date.now()
        );
        
        return {
            date: targetDate,
            punishmentsApplied,
            reportsClaimed,
            reportsClosed,
            avgResponseTime
        };
    }
    
    static async getStaffReport(guildId, userId, period = 'week') {
        const periods = { day: 1, week: 7, month: 30 };
        const days = periods[period] || 7;
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = this.getLocalDate(startDate);
        
        const data = db.prepare(`
            SELECT * FROM staff_analytics 
            WHERE guild_id = ? AND user_id = ? AND date >= ?
            ORDER BY date DESC
        `).all(guildId, userId, startDateStr);
        
        const totals = {
            punishmentsApplied: 0,
            reportsClaimed: 0,
            reportsClosed: 0,
            avgResponseTime: 0,
            daysWithData: 0
        };
        
        for (const day of data) {
            totals.punishmentsApplied += day.punishments_applied;
            totals.reportsClaimed += day.reports_claimed;
            totals.reportsClosed += day.reports_closed;
            if (day.avg_response_time !== null) {
                totals.avgResponseTime += day.avg_response_time;
                totals.daysWithData++;
            }
        }
        
        totals.avgResponseTime = totals.daysWithData > 0 
            ? Math.round(totals.avgResponseTime / totals.daysWithData)
            : null;
        
        return {
            period,
            days: data.length,
            totals,
            daily: data
        };
    }
    
    static async getStaffRanking(guildId, metric = 'punishments_applied', period = 'week', limit = 10) {
        const validMetrics = [
            'punishments_applied', 'reports_claimed', 'reports_closed',
            'reports_joined', 'report_messages_count', 'events_created', 'spectator_seconds',
        ];
        if (!validMetrics.includes(metric)) {
            throw new Error(`Métrica inválida: ${metric}`);
        }
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (period === 'week' ? 7 : 30));
        const startDateStr = this.getLocalDate(startDate);
        
        const ranking = db.prepare(`
            SELECT 
                user_id,
                SUM(${metric}) as total
            FROM staff_analytics
            WHERE guild_id = ? AND date >= ?
            GROUP BY user_id
            ORDER BY total DESC
            LIMIT ?
        `).all(guildId, startDateStr, limit);
        
        return ranking;
    }
    
    static async generateStaffReportContainer(guildId, userId, guildName, period = 'week') {
        const report = await this.getStaffReport(guildId, userId, period);
        
        const avgResponseText = report.totals.avgResponseTime !== null 
            ? `${report.totals.avgResponseTime}s` 
            : 'Sem dados';
        
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.title(`${EMOJIS.medal || '📊'} Relatório de Staff`, 1);
        builder.separator();
        builder.text(`**Staff:** <@${userId}>`);
        builder.text(`**Período:** ${period === 'week' ? '7 dias' : '30 dias'}`);
        builder.separator();
        builder.text(`${EMOJIS.gavel || '⚠️'} **Punições:** ${report.totals.punishmentsApplied}`);
        builder.text(`${EMOJIS.ticket || '🎫'} **Reports Assumidos:** ${report.totals.reportsClaimed}`);
        builder.text(`${EMOJIS.circlecheck || '✅'} **Reports Fechados:** ${report.totals.reportsClosed}`);
        builder.text(`${EMOJIS.clock || '⏱️'} **Tempo Médio:** ${avgResponseText}`);
        builder.footer(guildName, `${report.days} dias analisados`);
        
        return builder;
    }
    
    static async generateRankingContainer(guildId, guildName, metric = 'punishments_applied', period = 'week', limit = 10) {
        const ranking = await this.getStaffRanking(guildId, metric, period, limit);
        
        const metricLabels = {
            punishments_applied: `${EMOJIS.gavel || '⚠️'} Punições`,
            reports_claimed: `${EMOJIS.ticket || '🎫'} Reports Assumidos`,
            reports_closed: `${EMOJIS.circlecheck || '✅'} Reports Fechados`
        };
        
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.title(`${EMOJIS.trophy || '🏆'} Ranking de Staff`, 1);
        builder.separator();
        builder.text(`**Período:** ${period === 'week' ? '7 dias' : '30 dias'}`);
        builder.text(`**Métrica:** ${metricLabels[metric] || metric}`);
        builder.separator();
        
        for (let index = 0; index < ranking.length; index++) {
            const item = ranking[index];
            const medal = index === 0 ? (EMOJIS.medalha1 || '🥇') : (index === 1 ? (EMOJIS.medalha2 || '🥈') : (index === 2 ? (EMOJIS.medalha3 || '🥉') : `${index + 1}º`));
            builder.text(`**${medal}** <@${item.user_id}>: \`${item.total}\``);
        }
        
        builder.footer(guildName, `Top ${limit} staff • ${new Date().toLocaleDateString('pt-BR')}`);

        return builder;
    }

    // ==================== ANÁLISE DIÁRIA + HISTÓRICO (novas métricas) ====================

    // Soma as métricas novas por staff — `date` filtra um único dia (análise
    // diária), `sinceDate` filtra a partir de uma data, e sem nenhum dos dois
    // soma TODO o histórico (usado pelo /historico staff).
    static _aggregateStaffTotals(guildId, { date = null, sinceDate = null } = {}) {
        let where = 'WHERE guild_id = ?';
        const params = [guildId];
        if (date) {
            where += ' AND date = ?';
            params.push(date);
        } else if (sinceDate) {
            where += ' AND date >= ?';
            params.push(sinceDate);
        }

        const rows = db.prepare(`
            SELECT
                user_id,
                SUM(punishments_applied) AS punishmentsApplied,
                SUM(reports_joined) AS reportsJoined,
                SUM(reports_closed) AS reportsClosed,
                SUM(report_messages_count) AS reportMessages,
                SUM(report_response_seconds_sum) AS responseSecondsSum,
                SUM(report_response_count) AS responseCount,
                SUM(events_created) AS eventsCreated,
                SUM(nametag_toggles_spectating) AS nametagSpectating,
                SUM(nametag_toggles_not_spectating) AS nametagNotSpectating,
                SUM(spectator_seconds) AS spectatorSeconds
            FROM staff_analytics
            ${where}
            GROUP BY user_id
        `).all(...params);

        return rows.map(row => ({
            ...row,
            avgResponseSeconds: row.responseCount > 0 ? Math.round(row.responseSecondsSum / row.responseCount) : null,
        }));
    }

    static getGuildDailySummary(guildId, date) {
        return this._aggregateStaffTotals(guildId, { date });
    }

    static getAllStaffHistoryTotals(guildId) {
        return this._aggregateStaffTotals(guildId, {});
    }

    static getStaffHistoryTotals(guildId, userId) {
        return this._aggregateStaffTotals(guildId, {}).find(row => row.user_id === userId) || null;
    }

    // "3h 24min" / "45min" / "0min" — usado no tempo médio de resposta e no
    // total em modo espectador.
    static formatDuration(totalSeconds) {
        if (!totalSeconds || totalSeconds <= 0) return '0min';
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
        return `${minutes}min`;
    }

    static _formatStaffBlock(row) {
        const avgResp = row.avgResponseSeconds !== null ? this.formatDuration(row.avgResponseSeconds) : 'Sem dados';
        return [
            `**<@${row.user_id}>**`,
            `${EMOJIS.gavel || '⚠️'} Punições aplicadas: \`${row.punishmentsApplied}\``,
            `${EMOJIS.ticket || '🎫'} Reports entrados: \`${row.reportsJoined}\` • Fechados: \`${row.reportsClosed}\``,
            `${EMOJIS.messagesquare || '💬'} Mensagens em reports: \`${row.reportMessages}\` • Tempo médio de resposta: \`${avgResp}\``,
            `${EMOJIS.calendardays || '📅'} Eventos criados: \`${row.eventsCreated}\``,
            `${EMOJIS.shield || '🛡️'} Nametags com espectador: \`${row.nametagSpectating}\` • sem espectador: \`${row.nametagNotSpectating}\``,
            `${EMOJIS.shieldcheck || '👁️'} Tempo em modo espectador: \`${this.formatDuration(row.spectatorSeconds)}\``,
        ].join('\n');
    }

    // Junta os blocos de cada staff em o mínimo de TextDisplays possível sem
    // estourar o limite seguro de caracteres por bloco (mesma técnica usada
    // no relatório de combate — ver webhookPayloads.js chunkIntoBlocks).
    static _chunkStaffBlocks(rows, maxChars = 3800) {
        const blocks = [];
        let current = '';
        for (const row of rows) {
            const chunk = this._formatStaffBlock(row);
            if (current && (current.length + chunk.length + 2) > maxChars) {
                blocks.push(current);
                current = chunk;
            } else {
                current = current ? `${current}\n\n${chunk}` : chunk;
            }
        }
        if (current) blocks.push(current);
        return blocks;
    }

    static _sortByActivity(rows) {
        return [...rows].sort((a, b) =>
            (b.punishmentsApplied + b.reportsJoined + b.reportMessages + b.eventsCreated) -
            (a.punishmentsApplied + a.reportsJoined + a.reportMessages + a.eventsCreated)
        );
    }

    // Painel enviado diariamente pro log_channel configurado (config-log) —
    // só guilds tier Caçador recebem, ver dailyAnalyticsJob.js.
    static generateDailySummaryContainer(guild, date) {
        const rows = this._sortByActivity(this.getGuildDailySummary(guild.id, date));

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.title(`${EMOJIS.medal || '📊'} Análise Diária de Staff`, 1);
        builder.text(`**Data:** ${date}`);
        builder.separator();

        if (rows.length === 0) {
            builder.text('Nenhuma atividade de staff registrada hoje.');
        } else {
            for (const block of this._chunkStaffBlocks(rows)) builder.text(block);
        }

        builder.footer(guild.name, 'Análise diária de staff');
        return builder;
    }

    // Card de UM staff com a soma de todo o histórico — usado por
    // /historico staff quando um usuário específico é informado.
    static generateStaffHistoryContainer(guild, userId) {
        const row = this.getStaffHistoryTotals(guild.id, userId);

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.title(`${EMOJIS.medal || '📊'} Histórico de Staff`, 1);
        builder.separator();

        if (!row) {
            builder.text(`Nenhum registro de atividade encontrado para <@${userId}>.`);
        } else {
            builder.text(this._formatStaffBlock(row));
        }

        builder.footer(guild.name, 'Soma de todo o histórico');
        return builder;
    }

    // Lista todos os staff com atividade registrada, soma de todo o
    // histórico — usado por /historico staff sem um usuário específico.
    static generateStaffHistoryRankingContainer(guild) {
        const rows = this._sortByActivity(this.getAllStaffHistoryTotals(guild.id));

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.title(`${EMOJIS.trophy || '🏆'} Histórico de Staff`, 1);
        builder.separator();

        if (rows.length === 0) {
            builder.text('Nenhum registro de atividade de staff encontrado.');
        } else {
            for (const block of this._chunkStaffBlocks(rows)) builder.text(block);
        }

        builder.footer(guild.name, 'Soma de todo o histórico');
        return builder;
    }

    // ==================== PURGE AO PERDER TODOS OS CARGOS DE STAFF ====================

    // Chamado por guildMemberUpdate.js quando um membro tinha pelo menos 1
    // dos 3 cargos de staff (Moderador/Supervisor/Equipe de Eventos) e ficou
    // sem NENHUM deles. Independente de tier — isso é limpeza de dado ligada
    // a PERDA DE CARGO (fato do Discord), não uma feature paga; "economia de
    // espaço" (ver CLAUDE.md) sempre se aplica aqui, mesmo que o servidor
    // tenha perdido o Caçador (nesse caso já não havia dado novo sendo
    // gravado mesmo, ver _isAnalyticsAllowed).
    static async purgeStaffOnRoleLoss(guild, user) {
        try {
            const PlayerRegistry = require('../pot/potPlayerRegistry');
            const linked = PlayerRegistry.getPlayerByDiscordId(user.id);
            if (linked?.alderon_id) {
                // Perdeu o cargo — não é mais staff, descarta qualquer sessão
                // de espectador aberta sem creditar o tempo.
                db.prepare(`DELETE FROM pot_spectator_sessions WHERE guild_id = ? AND alderon_id = ?`).run(guild.id, linked.alderon_id);
            }

            const totals = this.getStaffHistoryTotals(guild.id, user.id);
            if (!totals) return; // nunca teve nenhum dado registrado, nada a apagar/logar

            const ConfigSystem = require('../core/configSystem');
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_staff');
            if (logChannelId) {
                const channel = await guild.channels.fetch(logChannelId).catch(() => null);
                if (channel) {
                    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
                    builder.title(`${EMOJIS.shieldban || '🛡️'} Staff perdeu o cargo`, 1);
                    builder.text(`${user} perdeu todos os cargos de staff configurados (Moderador/Supervisor/Equipe de Eventos) — o histórico abaixo foi apagado e não aparece mais no \`/historico staff\`.`);
                    builder.separator();
                    builder.text(this._formatStaffBlock(totals));
                    builder.footer(guild.name, 'Registro final antes da exclusão dos dados');
                    await channel.send(builder.build()).catch(() => {});
                }
            }

            // Sempre apaga, independente do log ter sido enviado — economia
            // de espaço não pode depender de o canal estar configurado.
            db.prepare(`DELETE FROM staff_analytics WHERE guild_id = ? AND user_id = ?`).run(guild.id, user.id);
        } catch (err) {
            console.error('❌ [Analytics] Erro ao purgar staff que perdeu o cargo:', err.message);
        }
    }
}

module.exports = AnalyticsSystem;