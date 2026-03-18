const cron = require('node-cron');
const db = require('../database/database');

module.exports = (client) => {
    // Executa todo dia às 03:00 da manhã
    cron.schedule('0 3 * * *', async () => {
        console.log("🛡️ [Automod] Verificação de Cargos por Guilda iniciada...");

        const now = Date.now();
        const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;
        const FIFTEEN_DAYS = 1000 * 60 * 60 * 24 * 15;

        // 1. Buscamos usuários que atingiram os limites de reputação em suas respectivas guildas
        const users = db.prepare(`SELECT * FROM users WHERE reputation >= 90 OR reputation <= 50`).all();

        for (const userData of users) {
            try {
                // 2. Localiza a guilda específica onde esse registro de reputação pertence
                const guild = client.guilds.cache.get(userData.guild_id);
                if (!guild) continue; // Bot saiu do servidor ou ID inválido

                // 3. Busca o membro dentro dessa guilda específica
                const member = await guild.members.fetch(userData.user_id).catch(() => null);
                if (!member) continue; // Membro saiu do servidor

                const lastPenalty = userData.last_penalty || 0;
                const timeWithoutPenalty = now - lastPenalty;
                
                // Pega as configurações desta guilda
                const settings = getSettings(guild.id);

                /* -----------------------------------------------------------
                   1. CARGO: JOGADOR EXEMPLAR (Baseado na rep desta guilda)
                ----------------------------------------------------------- */
                if (settings.exemplar_role && timeWithoutPenalty >= THIRTY_DAYS && userData.reputation >= 95) {
                    if (!member.roles.cache.has(settings.exemplar_role)) {
                        await member.roles.add(settings.exemplar_role).catch(() => null);
                        console.log(`🏅 [${guild.name}] ${member.user.tag} agora é Exemplar.`);
                    }
                }

                /* -----------------------------------------------------------
                   2. CARGO: USUÁRIO PROBLEMÁTICO (Baseado na rep desta guilda)
                ----------------------------------------------------------- */
                // Conta punições recentes NESTA guilda
                const recentPenalties = db.prepare(`
                    SELECT COUNT(*) as total 
                    FROM punishments 
                    WHERE user_id = ? AND guild_id = ? AND created_at > ?
                `).get(userData.user_id, guild.id, now - FIFTEEN_DAYS);

                if (settings.problem_role) {
                    if (recentPenalties.total >= 5 || userData.reputation <= 30) {
                        if (!member.roles.cache.has(settings.problem_role)) {
                            await member.roles.add(settings.problem_role).catch(() => null);
                            
                            // Remove o exemplar se ele se tornar problemático
                            if (settings.exemplar_role && member.roles.cache.has(settings.exemplar_role)) {
                                await member.roles.remove(settings.exemplar_role).catch(() => null);
                            }
                            console.log(`⚠️ [${guild.name}] ${member.user.tag} marcado como Problemático.`);
                        }
                    } else if (userData.reputation > 50 && member.roles.cache.has(settings.problem_role)) {
                        // Remove o cargo se ele melhorou a reputação nesta guilda
                        await member.roles.remove(settings.problem_role).catch(() => null);
                        console.log(`✅ [${guild.name}] ${member.user.tag} limpou o histórico.`);
                    }
                }

            } catch (err) {
                console.error(`Erro no automod para o usuário ${userData.user_id} na guilda ${userData.guild_id}:`, err);
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