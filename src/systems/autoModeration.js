const cron = require('node-cron');
const db = require('../database/index');
const { EmbedBuilder } = require('discord.js');

module.exports = (client) => {
    // Agendado para Meio-dia (Brasília)
    cron.schedule('0 12 * * *', async () => {
        console.log("🛡️ [AutoMod] Iniciando processamento de integridade diária...");
        
        const EMOJIS = client.systems.emojis || {};
        const Config = client.systems.config;
        const Logger = client.systems.logger;
        const stats = {};

        // --- 1. RECUPERAÇÃO DE REPUTAÇÃO (Otimizado com Transação) ---
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
            
            console.log(`📈 [AutoMod] ${result.changes} usuários recuperaram pontos.`);
        } catch (err) {
            if (Logger) Logger.log('AutoMod_Reputation_DB', err);
        }

        // --- 2. LOOP DE MEMBROS (FILTRADO POR CARGO) ---
        try {
            // Buscamos apenas quem REALMENTE precisa de atualização de cargo
            const users = db.prepare(`SELECT * FROM reputation WHERE points >= 90 OR points <= 50`).all();

            for (const userData of users) {
                const { guild_id: gId, user_id: uId, points: rep } = userData;
                const guild = client.guilds.cache.get(gId);
                if (!guild) continue;

                if (!stats[gId]) stats[gId] = { added: 0, removed: 0, guildName: guild.name };

                try {
                    const member = await guild.members.fetch(uId).catch(() => null);
                    if (!member) continue;

                    // IMPORTANTE: Ajustei os nomes para bater com o seu /config-rep
                    const roleExId = Config.getSetting(gId, 'role_exemplar');
                    const roleProbId = Config.getSetting(gId, 'role_problematico');
                    
                    // Limites configuráveis ou padrões
                    const limitEx = parseInt(Config.getSetting(gId, 'limit_exemplar')) || 95;
                    const limitProb = parseInt(Config.getSetting(gId, 'limit_problematico')) || 30;

                    // Lógica Exemplar
                    if (roleExId) {
                        const hasEx = member.roles.cache.has(roleExId);
                        if (rep >= limitEx && !hasEx) {
                            await member.roles.add(roleExId).catch(() => null);
                            stats[gId].added++;
                            await member.send(`${EMOJIS.EXEMPLAR || '✨'} Parabéns! Sua conduta em **${guild.name}** é exemplar!`).catch(() => null);
                        } else if (rep < (limitEx - 5) && hasEx) {
                            await member.roles.remove(roleExId).catch(() => null);
                            stats[gId].removed++;
                        }
                    }

                    // Lógica Problemático
                    if (roleProbId) {
                        const hasProb = member.roles.cache.has(roleProbId);
                        if (rep <= limitProb && !hasProb) {
                            await member.roles.add(roleProbId).catch(() => null);
                            stats[gId].added++;
                            await member.send(`${EMOJIS.WARNING || '⚠️'} Sua reputação em **${guild.name}** caiu. Melhore sua conduta!`).catch(() => null);
                        } else if (rep > 50 && hasProb) {
                            await member.roles.remove(roleProbId).catch(() => null);
                            stats[gId].removed++;
                        }
                    }
                } catch (e) { continue; }
            }
        } catch (err) {
            if (Logger) Logger.log('AutoMod_MainLoop', err);
        }

        // --- 3. RELATÓRIOS E REGISTRO ---
        for (const gId in stats) {
            try {
                const logChanId = Config.getSetting(gId, 'logs_channel');
                const channel = logChanId ? await client.channels.fetch(logChanId).catch(() => null) : null;

                if (channel) {
                    const embed = new EmbedBuilder()
                        .setTitle(`${EMOJIS.CHECK || '✅'} Manutenção Diária`)
                        .setColor(0xDCA15E)
                        .setDescription(`Processamento de reputação concluído.`)
                        .addFields(
                            { name: `📈 Recuperação`, value: `Usuários ativos (24h limpos) receberam **+1pt**.`, inline: false },
                            { name: `🎭 Cargos`, value: `\`${stats[gId].added}\` Atribuídos | \`${stats[gId].removed}\` Removidos`, inline: true }
                        )
                        .setFooter(Config.getFooter(stats[gId].guildName));

                    await channel.send({ embeds: [embed] });
                }
                
                // Ponto 4: Registro da última execução
                Config.setSetting(gId, 'last_automod_run', Date.now().toString());

            } catch (e) { /* ignore */ }
        }
    });
};