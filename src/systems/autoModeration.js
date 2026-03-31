const cron = require('node-cron');
const db = require('../../../database/database');
const { EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const ConfigSystem = require('./configSystem');
const ErrorLogger = require('./errorLogger');

module.exports = (client) => {
    // Agendado para Meio-dia (Brasília se o servidor estiver em UTC-3)
    cron.schedule('0 12 * * *', async () => {
        console.log("🛡️ [AutoMod] Iniciando processamento de integridade diária...");
        const stats = {};

        // --- 1. RECUPERAÇÃO DE REPUTAÇÃO (Trava de 24h pós-punição) ---
        let globalRecovered = 0;
        try {
            const result = db.prepare(`
                UPDATE reputation 
                SET points = MIN(100, points + 1)
                WHERE points < 100 
                AND NOT EXISTS (
                    SELECT 1 FROM punishments 
                    WHERE punishments.user_id = reputation.user_id 
                    AND punishments.guild_id = reputation.guild_id
                    AND (strftime('%s','now') * 1000 - punishments.created_at) < 86400000
                )
            `).run();
            globalRecovered = result.changes;
        } catch (err) {
            ErrorLogger.log('AutoMod_Reputation_DB', err);
        }

        // --- 2. LOOP DE MEMBROS (FILTRADO) ---
        try {
            // Buscamos apenas quem está nos limites de ganhar ou perder cargos
            const users = db.prepare(`SELECT * FROM reputation WHERE points >= 90 OR points <= 50`).all();

            for (const userData of users) {
                const { guild_id: gId, user_id: uId, points: rep } = userData;
                const guild = client.guilds.cache.get(gId);
                if (!guild) continue;

                if (!stats[gId]) {
                    stats[gId] = { added: 0, removed: 0, guildName: guild.name };
                }

                try {
                    const member = await guild.members.fetch(uId).catch(() => null);
                    if (!member) continue;

                    // Consulta via ConfigSystem (Usa o Cache automaticamente)
                    const exemplarRole = ConfigSystem.getSetting(gId, 'exemplar_role');
                    const problemRole = ConfigSystem.getSetting(gId, 'problem_role');

                    // Lógica de Cargo Exemplar
                    if (exemplarRole) {
                        const hasEx = member.roles.cache.has(exemplarRole);
                        if (rep >= 95 && !hasEx) {
                            await member.roles.add(exemplarRole).catch(() => null);
                            stats[gId].added++;
                            await member.send(`${EMOJIS.EXEMPLAR || '✨'} Parabéns! Sua conduta em **${guild.name}** é exemplar! Continue assim.`).catch(() => null);
                        } else if (rep < 90 && hasEx) {
                            await member.roles.remove(exemplarRole).catch(() => null);
                            stats[gId].removed++;
                        }
                    }

                    // Lógica de Cargo Problemático
                    if (problemRole) {
                        const hasProb = member.roles.cache.has(problemRole);
                        if (rep <= 30 && !hasProb) {
                            await member.roles.add(problemRole).catch(() => null);
                            stats[gId].added++;
                            await member.send(`${EMOJIS.WARNING || '⚠️'} Atenção: Sua reputação em **${guild.name}** caiu drasticamente. Melhore sua conduta para evitar punições severas.`).catch(() => null);
                        } else if (rep > 50 && hasProb) {
                            await member.roles.remove(problemRole).catch(() => null);
                            stats[gId].removed++;
                        }
                    }
                } catch (memberErr) {
                    continue; // Pula para o próximo se houver erro com este membro específico
                }
            }
        } catch (dbErr) {
            ErrorLogger.log('AutoMod_MainLoop', dbErr);
        }

        // --- 3. RELATÓRIOS POR SERVIDOR ---
        for (const gId in stats) {
            try {
                const logChanId = ConfigSystem.getSetting(gId, 'logs_channel');
                if (!logChanId) continue;

                const channel = await client.channels.fetch(logChanId).catch(() => null);
                if (!channel) continue;

                const embed = new EmbedBuilder()
                    .setTitle(`${EMOJIS.CHECK || '✅'} Manutenção de Integridade`)
                    .setColor(0xDCA15E)
                    .setThumbnail(client.user.displayAvatarURL())
                    .setDescription(`O processamento diário de reputação e cargos foi concluído.`)
                    .addFields(
                        { 
                            name: `${EMOJIS.UP || '📈'} Recuperação de Pontos`, 
                            value: `Usuários que não foram punidos nas últimas 24h receberam **+1** ponto.`, 
                            inline: false 
                        },
                        { 
                            name: `${EMOJIS.STATUS || '🎭'} Cargos Atualizados`, 
                            value: `\`${stats[gId].added}\` Atribuídos / \`${stats[gId].removed}\` Removidos`, 
                            inline: true 
                        }
                    )
                    .setFooter(ConfigSystem.getFooter(stats[gId].guildName))
                    .setTimestamp();

                await channel.send({ embeds: [embed] });

                // Registra a última execução
                ConfigSystem.updateSetting(gId, 'last_automod_run', new Date().toISOString());

            } catch (logErr) {
                ErrorLogger.log(`AutoMod_Report_${gId}`, logErr);
            }
        }
    });
};