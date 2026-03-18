const cron = require('node-cron');
const db = require('../database/database');

module.exports = (client) => {
    // Executa todo dia às 03:00 da manhã
    cron.schedule('0 3 * * *', async () => {
        console.log("🛡️ [Automod] Verificação de Cargos e Recuperação iniciada...");

        const now = Date.now();
        const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;
        const FIFTEEN_DAYS = 1000 * 60 * 60 * 24 * 15;
        const ONE_DAY = 1000 * 60 * 60 * 24; // 24 horas em milisegundos

        /* -----------------------------------------------------------
           3. RECUPERAÇÃO DIÁRIA (NOVO)
           Dá +1 de reputação para quem não teve punição nas últimas 24h
        ----------------------------------------------------------- */
        try {
            // Atualiza todos os usuários que têm menos de 100 de rep
            // e cuja última punição foi há mais de 24 horas (ou nunca tiveram)
            db.prepare(`
                UPDATE users 
                SET reputation = MIN(100, reputation + 1)
                WHERE reputation < 100 
                AND (last_penalty IS NULL OR ? - last_penalty >= ?)
            `).run(now, ONE_DAY);
            
            console.log("📈 [Automod] Reputação diária processada para usuários ativos.");
        } catch (err) {
            console.error("Erro ao processar recuperação diária:", err);
        }

        // 1. Buscamos usuários para verificação de cargos (Exemplar/Problemático)
        const users = db.prepare(`SELECT * FROM users WHERE reputation >= 90 OR reputation <= 50`).all();

        for (const userData of users) {
            try {
                const guild = client.guilds.cache.get(userData.guild_id);
                if (!guild) continue;

                const member = await guild.members.fetch(userData.user_id).catch(() => null);
                if (!member) continue;

                const lastPenalty = userData.last_penalty || 0;
                const timeWithoutPenalty = now - lastPenalty;
                const settings = getSettings(guild.id);

                /* 1. CARGO: JOGADOR EXEMPLAR */
                if (settings.exemplar_role && timeWithoutPenalty >= THIRTY_DAYS && userData.reputation >= 95) {
                    if (!member.roles.cache.has(settings.exemplar_role)) {
                        await member.roles.add(settings.exemplar_role).catch(() => null);
                        console.log(`🏅 [${guild.name}] ${member.user.tag} agora é Exemplar.`);
                    }
                }

                /* 2. CARGO: USUÁRIO PROBLEMÁTICO */
                const recentPenalties = db.prepare(`
                    SELECT COUNT(*) as total 
                    FROM punishments 
                    WHERE user_id = ? AND guild_id = ? AND created_at > ?
                `).get(userData.user_id, guild.id, now - FIFTEEN_DAYS);

                if (settings.problem_role) {
                    if (recentPenalties.total >= 5 || userData.reputation <= 30) {
                        if (!member.roles.cache.has(settings.problem_role)) {
                            await member.roles.add(settings.problem_role).catch(() => null);
                            if (settings.exemplar_role && member.roles.cache.has(settings.exemplar_role)) {
                                await member.roles.remove(settings.exemplar_role).catch(() => null);
                            }
                            console.log(`⚠️ [${guild.name}] ${member.user.tag} marcado como Problemático.`);
                        }
                    } else if (userData.reputation > 50 && member.roles.cache.has(settings.problem_role)) {
                        await member.roles.remove(settings.problem_role).catch(() => null);
                        console.log(`✅ [${guild.name}] ${member.user.tag} limpou o histórico.`);
                    }
                }

            } catch (err) {
                console.error(`Erro no automod:`, err);
            }
        }
        console.log("✅ [Automod] Verificação concluída!");
    });
};

function getSettings(guildId) {
    const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
    const settings = {};
    rows.forEach(row => settings[row.key] = row.value);
    return settings;
}