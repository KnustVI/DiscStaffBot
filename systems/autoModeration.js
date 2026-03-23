const cron = require('node-cron');
const db = require('../database/database');
const { EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../database/emojis');
const ConfigSystem = require('./configSystem');
const ErrorLogger = require('./errorLogger');

module.exports = (client) => {
    // Roda todos os dias às 03:00 da manhã
    cron.schedule('0 3 * * *', async () => {
        console.log("🛡️ [Automod] Manutenção iniciada...");
        
        const stats = {};

        // --- 1. RECUPERAÇÃO DE REPUTAÇÃO ---
        try {
            db.prepare(`
                UPDATE reputation 
                SET points = MIN(100, points + 1)
                WHERE points < 100
            `).run();
        } catch (err) {
            ErrorLogger.log('AutoMod_DB_Update', err);
        }

        // --- 2. VERIFICAÇÃO DE CARGOS ---
        try {
            const users = db.prepare(`SELECT * FROM reputation WHERE points >= 90 OR points <= 50`).all();

            for (const userData of users) {
                const { guild_id: gId, user_id: uId, points: rep } = userData;
                
                const guild = client.guilds.cache.get(gId);
                if (!guild) continue;

                if (!stats[gId]) stats[gId] = { added: 0, removed: 0, guildName: guild.name };

                try {
                    const member = await guild.members.fetch(uId).catch(() => null);
                    if (!member) continue;

                    const exemplarRole = ConfigSystem.getSetting(gId, 'exemplar_role');
                    const problemRole = ConfigSystem.getSetting(gId, 'problem_role');

                    // Lógica Exemplar
                    if (exemplarRole) {
                        const hasEx = member.roles.cache.has(exemplarRole);
                        if (rep >= 95 && !hasEx) {
                            await member.roles.add(exemplarRole).catch(() => null);
                            stats[gId].added++;
                        } else if (rep < 90 && hasEx) {
                            await member.roles.remove(exemplarRole).catch(() => null);
                            stats[gId].removed++;
                        }
                    }
                    
                    // Lógica Problemático
                    if (problemRole) {
                        const hasProb = member.roles.cache.has(problemRole);
                        if (rep <= 30 && !hasProb) {
                            await member.roles.add(problemRole).catch(() => null);
                            stats[gId].added++;
                        } else if (rep > 50 && hasProb) {
                            await member.roles.remove(problemRole).catch(() => null);
                            stats[gId].removed++;
                        }
                    }
                } catch (memberErr) {
                    ErrorLogger.log(`AutoMod_Member_${uId}`, memberErr);
                }
            }
        } catch (dbErr) {
            ErrorLogger.log('AutoMod_MainLoop', dbErr);
        }

        // --- 3. ENVIO DO RELATÓRIO ---
        for (const gId in stats) {
            try {
                const logChanId = ConfigSystem.getSetting(gId, 'alert_channel') || ConfigSystem.getSetting(gId, 'logs_channel');
                if (!logChanId) continue;

                const channel = await client.channels.fetch(logChanId).catch(() => null);
                
                if (channel && (stats[gId].added > 0 || stats[gId].removed > 0)) {
                    const embed = new EmbedBuilder()
                        .setTitle(`${EMOJIS.PAINEL || '✅'} Relatório de Manutenção Diária`)
                        .setColor(0xba0054)
                        .setThumbnail(client.user.displayAvatarURL())
                        .addFields(
                            { name: `${EMOJIS.UP || '📈'} Recuperação`, value: 'Todos os usuários ativos receberam `+1` ponto.', inline: false },
                            { name: `${EMOJIS.STATUS || '🎭'} Cargos Atualizados`, value: `\`${stats[gId].added}\` Adicionados\n\`${stats[gId].removed}\` Removidos`, inline: true }
                        )
                        .setFooter(ConfigSystem.getFooter(stats[gId].guildName))
                        .setTimestamp();

                    await channel.send({ embeds: [embed] });
                }
            } catch (logErr) {
                ErrorLogger.log(`AutoMod_Discord_Report_${gId}`, logErr);
            }
        }
    });
};