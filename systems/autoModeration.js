const cron = require('node-cron');
const db = require('../database/database');

module.exports = (client) => {
    // Executa todo dia às 03:00 da manhã
    cron.schedule('0 3 * * *', async () => {
        console.log("🛡️ [Automod] Verificação de Cargos de Fidelidade/Risco iniciada...");

        const now = Date.now();
        const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;
        const FIFTEEN_DAYS = 1000 * 60 * 60 * 24 * 15;

        // Buscamos apenas quem precisa de verificação de cargo (rep alta ou rep muito baixa)
        const users = db.prepare(`SELECT * FROM users WHERE reputation >= 90 OR reputation <= 50`).all();

        for (const userData of users) {
            try {
                // Tenta encontrar o membro no servidor principal (definido no .env ou settings)
                // Se o seu bot for para um servidor só, use o ID direto para poupar processamento
                const guild = client.guilds.cache.first(); // Pega o primeiro servidor que o bot está
                if (!guild) continue;

                const member = await guild.members.fetch(userData.user_id).catch(() => null);
                if (!member) continue;

                const lastPenalty = userData.last_penalty || 0;
                const timeWithoutPenalty = now - lastPenalty;
                const settings = getSettings(guild.id);

                /* -----------------------------------------------------------
                   1. CARGO: JOGADOR EXEMPLAR (30 DIAS LIMPO + REPUTAÇÃO ALTA)
                ----------------------------------------------------------- */
                if (settings.exemplar_role && timeWithoutPenalty >= THIRTY_DAYS && userData.reputation >= 95) {
                    if (!member.roles.cache.has(settings.exemplar_role)) {
                        await member.roles.add(settings.exemplar_role).catch(() => null);
                        console.log(`🏅 ${member.user.tag} recebeu cargo Exemplar.`);
                    }
                }

                /* -----------------------------------------------------------
                   2. CARGO: USUÁRIO PROBLEMÁTICO
                ----------------------------------------------------------- */
                const recentPenalties = db.prepare(`
                    SELECT COUNT(*) as total 
                    FROM punishments 
                    WHERE user_id = ? AND created_at > ?
                `).get(userData.user_id, now - FIFTEEN_DAYS);

                if (settings.problem_role) {
                    if (recentPenalties.total >= 5 || userData.reputation <= 30) {
                        if (!member.roles.cache.has(settings.problem_role)) {
                            await member.roles.add(settings.problem_role).catch(() => null);
                            
                            // Remove o exemplar se ele se tornar problemático
                            if (settings.exemplar_role && member.roles.cache.has(settings.exemplar_role)) {
                                await member.roles.remove(settings.exemplar_role).catch(() => null);
                            }
                            console.log(`⚠️ ${member.user.tag} marcado como Problemático.`);
                        }
                    } else if (userData.reputation > 50 && member.roles.cache.has(settings.problem_role)) {
                        // Remove o cargo se ele melhorou
                        await member.roles.remove(settings.problem_role).catch(() => null);
                        console.log(`✅ ${member.user.tag} não é mais Problemático.`);
                    }
                }

            } catch (err) {
                console.error(`Erro no automod: ${userData.user_id}`, err);
            }
        }
        console.log("✅ [Automod] Verificação de cargos concluída!");
    });
};

function getSettings(guildId) {
    const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
    const settings = {};
    rows.forEach(row => settings[row.key] = row.value);
    return settings;
}