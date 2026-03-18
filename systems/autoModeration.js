const cron = require('node-cron');
const db = require('../database/database');
const { EmbedBuilder } = require('discord.js');

module.exports = (client) => {
    // Executa todo dia às 03:00 da manhã
    cron.schedule('0 3 * * *', async () => {
        console.log("🛡️ [Automod] Verificação de Cargos e Recuperação iniciada...");

        const now = Date.now();
        const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;
        const FIFTEEN_DAYS = 1000 * 60 * 60 * 24 * 15;
        const ONE_DAY = 1000 * 60 * 60 * 24;

        // Agrupamos os resultados por servidor para enviar um log único por guilda
        const stats = {}; 

        const initStats = (id) => {
            if (!stats[id]) stats[id] = { repUp: 0, rolesAdded: 0, rolesRemoved: 0, errors: [] };
        };

        /* -----------------------------------------------------------
           1. RECUPERAÇÃO DIÁRIA DE REPUTAÇÃO
        ----------------------------------------------------------- */
        try {
            // Buscamos quem será afetado antes para fins de log
            const affected = db.prepare(`SELECT guild_id FROM users WHERE reputation < 100 AND (last_penalty IS NULL OR ? - last_penalty >= ?)`).all(now, ONE_DAY);
            
            affected.forEach(u => {
                initStats(u.guild_id);
                stats[u.guild_id].repUp++;
            });

            db.prepare(`
                UPDATE users 
                SET reputation = MIN(100, reputation + 1)
                WHERE reputation < 100 
                AND (last_penalty IS NULL OR ? - last_penalty >= ?)
            `).run(now, ONE_DAY);
            
        } catch (err) {
            console.error("Erro na recuperação diária:", err);
        }

        /* -----------------------------------------------------------
           2. VERIFICAÇÃO DE CARGOS (EXEMPLAR / PROBLEMÁTICO)
        ----------------------------------------------------------- */
        const users = db.prepare(`SELECT * FROM users WHERE reputation >= 90 OR reputation <= 50`).all();

        for (const userData of users) {
            const guildId = userData.guild_id;
            initStats(guildId);

            try {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;

                const member = await guild.members.fetch(userData.user_id).catch(() => null);
                if (!member) continue;

                const settings = getSettings(guildId);
                const lastPenalty = userData.last_penalty || 0;
                const timeWithoutPenalty = now - lastPenalty;

                // --- CARGO: EXEMPLAR ---
                if (settings.exemplar_role && timeWithoutPenalty >= THIRTY_DAYS && userData.reputation >= 95) {
                    if (!member.roles.cache.has(settings.exemplar_role)) {
                        await member.roles.add(settings.exemplar_role);
                        stats[guildId].rolesAdded++;
                    }
                }

                // --- CARGO: PROBLEMÁTICO ---
                const recent = db.prepare(`SELECT COUNT(*) as total FROM punishments WHERE user_id = ? AND guild_id = ? AND created_at > ?`)
                                  .get(userData.user_id, guildId, now - FIFTEEN_DAYS);

                if (settings.problem_role) {
                    if (recent.total >= 5 || userData.reputation <= 30) {
                        if (!member.roles.cache.has(settings.problem_role)) {
                            await member.roles.add(settings.problem_role);
                            stats[guildId].rolesAdded++;
                            if (settings.exemplar_role && member.roles.cache.has(settings.exemplar_role)) {
                                await member.roles.remove(settings.exemplar_role);
                            }
                        }
                    } else if (userData.reputation > 50 && member.roles.cache.has(settings.problem_role)) {
                        await member.roles.remove(settings.problem_role);
                        stats[guildId].rolesRemoved++;
                    }
                }
            } catch (err) {
                stats[guildId].errors.push(err.message);
            }
        }

        /* -----------------------------------------------------------
           3. ENVIO DOS LOGS DE AUDITORIA
        ----------------------------------------------------------- */
        for (const guildId in stats) {
            const s = stats[guildId];
            const guild = client.guilds.cache.get(guildId);
            if (!guild) continue;

            const settings = getSettings(guildId);
            const alertChannelId = settings.alert_channel || settings.logs_channel;
            const channel = guild.channels.cache.get(alertChannelId);

            if (channel) {
                const hasErrors = s.errors.length > 0;
                const embed = new EmbedBuilder()
                    .setTitle(hasErrors ? "⚠️ Relatório Automod (Com Avisos)" : "✅ Relatório Automod Concluído")
                    .setColor(hasErrors ? 0xFFAA00 : 0x2ECC71)
                    .addFields(
                        { name: "📈 Reputação", value: `\`+1 pt\` para **${s.repUp}** usuários.`, inline: true },
                        { name: "🎭 Cargos", value: `**${s.rolesAdded}** atribuídos\n**${s.rolesRemoved}** removidos.`, inline: true }
                    )
                    .setTimestamp();

                if (hasErrors) {
                    embed.addFields({ name: "❌ Erros Detectados", value: `\`\`\`${s.errors.slice(0, 3).join('\n')}\`\`\`` });
                }

                await channel.send({ embeds: [embed] }).catch(() => null);
            }
        }

        console.log("✅ [Automod] Ciclo de manutenção finalizado.");
    });
};

function getSettings(guildId) {
    const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
    const settings = {};
    rows.forEach(row => settings[row.key] = row.value);
    return settings;
}