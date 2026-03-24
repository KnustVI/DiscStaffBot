const cron = require('node-cron');
const db = require('../database/database');
const { EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../database/emojis');
const ConfigSystem = require('./configSystem');
const ErrorLogger = require('./errorLogger');

module.exports = (client) => {
    // Roda todos os dias às 12:00 (meio-dia de Brasília se a VPS estiver certa)
    cron.schedule('0 12 * * *', async () => {
        console.log("🛡️ [Automod] Manutenção de Meio-dia iniciada...");
        const stats = {};

        // --- 1. RECUPERAÇÃO DE REPUTAÇÃO ---
        let usersRecovered = 0;
        try {
            const result = db.prepare(`
                UPDATE reputation 
                SET points = MIN(100, points + 1)
                WHERE points < 100
            `).run();
            usersRecovered = result.changes;
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

                if (!stats[gId]) stats[gId] = { added: 0, removed: 0, guildName: guild.name, recoveredCount: usersRecovered };

                try {
                    const member = await guild.members.fetch(uId).catch(() => null);
                    if (!member) continue;

                    const exemplarRole = ConfigSystem.getSetting(gId, 'exemplar_role');
                    const problemRole = ConfigSystem.getSetting(gId, 'problem_role');

                    if (exemplarRole) {
                        const hasEx = member.roles.cache.has(exemplarRole);
                        if (rep >= 95 && !hasEx) {
                            await member.roles.add(exemplarRole).catch(() => null);
                            stats[gId].added++;
                            await member.send(`${EMOJIS.EXEMPLAR || '✨'} Parabéns! Sua conduta em **${guild.name}** é exemplar!`).catch(() => null);
                        } else if (rep < 90 && hasEx) {
                            await member.roles.remove(exemplarRole).catch(() => null);
                            stats[gId].removed++;
                        }
                    }
                    
                    if (problemRole) {
                        const hasProb = member.roles.cache.has(problemRole);
                        if (rep <= 30 && !hasProb) {
                            await member.roles.add(problemRole).catch(() => null);
                            stats[gId].added++;
                            await member.send(`${EMOJIS.WARNING || '⚠️'} Sua reputação em **${guild.name}** caiu. Melhore sua conduta!`).catch(() => null);
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

        // --- 3. ENVIO DO RELATÓRIO E SALVAMENTO DE STATUS ---
        for (const gId in stats) {
            try {
                const logChanId = ConfigSystem.getSetting(gId, 'logs_channel');
                if (!logChanId) continue;

                // SALVA O STATUS: Aqui gId e logChanId estão definidos e seguros!
                const now = new Date();
                ConfigSystem.setSetting(gId, 'last_automod_run', now.toISOString());
                ConfigSystem.setSetting(gId, 'last_automod_run_channel', logChanId); 

                const channel = await client.channels.fetch(logChanId).catch(() => null);
                
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setTitle(`${EMOJIS.CHECK || '✅'} Manutenção Concluída`)
                        .setColor(0xc1ff72)
                        .setThumbnail(client.user.displayAvatarURL())
                        .setDescription(`Relatório diário de integridade do servidor.`)
                        .addFields(
                            { name: `${EMOJIS.UP || '📈'} Recuperação de Pontos`, value: `\`${stats[gId].recoveredCount}\` usuários ganharam \`+1\` ponto.`, inline: false },
                            { name: `${EMOJIS.STATUS || '🎭'} Atualização de Cargos`, value: `\`${stats[gId].added}\` Atribuídos / \`${stats[gId].removed}\` Removidos`, inline: true }
                        )
                        .setFooter({ text: `Sistema de Integridade • ${stats[gId].guildName}` })
                        .setTimestamp();

                    await channel.send({ embeds: [embed] });
                }
            } catch (logErr) {
                ErrorLogger.log(`AutoMod_Discord_Report_${gId}`, logErr);
            }
        }
    });
};