const cron = require('node-cron');
const db = require('../../database/database');
const { EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const ConfigSystem = require('../configSystem');

module.exports = (client) => {
    cron.schedule('0 3 * * *', async () => {
        console.log("🛡️ [Automod] Manutenção iniciada...");
        const now = Date.now();
        const THIRTY_DAYS = 2592000000; 
        const FIFTEEN_DAYS = 1296000000;
        const stats = {};

        // 1. RECUPERAÇÃO DE REPUTAÇÃO (SQL puro é mais rápido aqui)
        db.prepare(`
            UPDATE users SET reputation = MIN(100, reputation + 1)
            WHERE reputation < 100 AND (last_penalty IS NULL OR ? - last_penalty >= 86400000)
        `).run(now);

        // 2. VERIFICAÇÃO DE CARGOS
        const users = db.prepare(`SELECT * FROM users WHERE reputation >= 90 OR reputation <= 50`).all();

        for (const userData of users) {
            const { guild_id: gId, user_id: uId, reputation: rep, last_penalty: lp } = userData;
            if (!stats[gId]) stats[gId] = { added: 0, removed: 0, errors: [] };

            const guild = client.guilds.cache.get(gId);
            if (!guild) continue;

            const member = await guild.members.fetch(uId).catch(() => null);
            if (!member) continue;

            // BUSCA NO CACHE (ConfigSystem)
            const exemplarRole = ConfigSystem.getSetting(gId, 'exemplar_role');
            const problemRole = ConfigSystem.getSetting(gId, 'problem_role');

            // Lógica Exemplar
            if (exemplarRole) {
                const hasEx = member.roles.cache.has(exemplarRole);
                if (rep >= 95 && (now - (lp || 0)) >= THIRTY_DAYS) {
                    if (!hasEx) { await member.roles.add(exemplarRole).catch(() => null); stats[gId].added++; }
                } else if (hasEx && rep < 90) {
                    await member.roles.remove(exemplarRole).catch(() => null); stats[gId].removed++;
                }
            }
            
            // Lógica Problemático (simplificada para performance)
            if (problemRole) {
                const isProb = rep <= 30;
                const hasProb = member.roles.cache.has(problemRole);
                if (isProb && !hasProb) {
                    await member.roles.add(problemRole).catch(() => null); stats[gId].added++;
                } else if (!isProb && hasProb && rep > 50) {
                    await member.roles.remove(problemRole).catch(() => null); stats[gId].removed++;
                }
            }
        }

        // 3. ENVIO DOS LOGS
        for (const gId in stats) {
            const logChan = ConfigSystem.getSetting(gId, 'alert_channel') || ConfigSystem.getSetting(gId, 'logs_channel');
            if (!logChan) continue;

            const channel = client.channels.cache.get(logChan);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle(`✅ Manutenção Diária`)
                    .setColor(0x2ECC71)
                    .setDescription(`Cargos ajustados: **${stats[gId].added}** add / **${stats[gId].removed}** rem.`)
                    .setTimestamp();
                await channel.send({ embeds: [embed] }).catch(() => null);
            }
        }
    });
};