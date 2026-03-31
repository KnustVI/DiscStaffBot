const cron = require('node-cron');
const db = require('../database/index');
const { EmbedBuilder } = require('discord.js');

module.exports = (client) => {
    // Agendado para Meio-dia (Brasília)
    cron.schedule('0 12 * * *', async () => {
        console.log("🛡️ [AutoMod] Iniciando processamento de integridade diária...");
        
        const { emojis, config, logger } = client.systems;
        const EMOJIS = emojis || {};
        const stats = {};

        // --- 1. RECUPERAÇÃO DE REPUTAÇÃO (SQL PURO) ---
        // Aumenta 1 ponto de quem não teve punições nas últimas 24h
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
            if (logger) logger.log('AutoMod_Reputation_DB_Error', err);
        }

        // --- 2. GERENCIAMENTO DINÂMICO DE CARGOS ---
        try {
            // Buscamos apenas quem está nos extremos (Exemplares ou Problemáticos)
            const users = db.prepare(`SELECT * FROM reputation WHERE points >= 90 OR points <= 40`).all();

            for (const userData of users) {
                const { guild_id: gId, user_id: uId, points: rep } = userData;
                
                const guild = client.guilds.cache.get(gId);
                if (!guild) continue;

                if (!stats[gId]) stats[gId] = { added: 0, removed: 0, guildName: guild.name };

                try {
                    const member = await guild.members.fetch(uId).catch(() => null);
                    if (!member) continue;

                    // Definições de Configuração
                    const roleExId = config.getSetting(gId, 'role_exemplar');
                    const roleProbId = config.getSetting(gId, 'role_problematico');
                    const limitEx = parseInt(config.getSetting(gId, 'limit_exemplar')) || 95;
                    const limitProb = parseInt(config.getSetting(gId, 'limit_problematico')) || 30;

                    // A) Lógica de Cargo Exemplar (Recompensa)
                    if (roleExId) {
                        const hasEx = member.roles.cache.has(roleExId);
                        if (rep >= limitEx && !hasEx) {
                            await member.roles.add(roleExId).catch(() => null);
                            stats[gId].added++;
                            await member.send(`${EMOJIS.EXEMPLAR || '✨'} Parabéns! Sua conduta em **${guild.name}** é exemplar e você recebeu um cargo especial!`).catch(() => null);
                        } else if (rep < (limitEx - 5) && hasEx) {
                            // Margem de erro de 5 pontos para não ficar tirando/ponto o tempo todo
                            await member.roles.remove(roleExId).catch(() => null);
                            stats[gId].removed++;
                        }
                    }

                    // B) Lógica de Cargo Problemático (Aviso)
                    if (roleProbId) {
                        const hasProb = member.roles.cache.has(roleProbId);
                        if (rep <= limitProb && !hasProb) {
                            await member.roles.add(roleProbId).catch(() => null);
                            stats[gId].added++;
                            await member.send(`${EMOJIS.WARNING || '⚠️'} Sua reputação em **${guild.name}** atingiu um nível crítico. Melhore sua conduta para evitar sanções severas!`).catch(() => null);
                        } else if (rep > 50 && hasProb) {
                            await member.roles.remove(roleProbId).catch(() => null);
                            stats[gId].removed++;
                        }
                    }
                } catch (memberError) { continue; }
            }
        } catch (err) {
            if (logger) logger.log('AutoMod_MainLoop_Error', err);
        }

        // --- 3. RELATÓRIOS NOS CANAIS DE LOG ---
        for (const gId in stats) {
            try {
                const logChanId = config.getSetting(gId, 'logs_channel');
                const channel = logChanId ? await client.channels.fetch(logChanId).catch(() => null) : null;

                if (channel) {
                    const embed = new EmbedBuilder()
                        .setAuthor({ name: 'Sistema de Integridade', iconURL: client.user.displayAvatarURL() })
                        .setTitle(`${EMOJIS.CHECK || '✅'} Manutenção Diária Concluída`)
                        .setColor(0xDCA15E)
                        .setDescription(`O processamento automático de reputação e cargos foi finalizado com sucesso.`)
                        .addFields(
                            { name: '📈 Recuperação', value: `Usuários sem infrações recentes receberam **+1pt**.`, inline: false },
                            { name: '🎭 Alterações de Cargos', value: `\`${stats[gId].added}\` Atribuídos\n\`${stats[gId].removed}\` Removidos`, inline: true }
                        )
                        .setTimestamp();

                    await channel.send({ embeds: [embed] });
                }
                
                // Marca a última execução no banco para controle administrativo
                config.setSetting(gId, 'last_automod_run', Date.now().toString());

            } catch (e) { /* Silenciar erros de envio de log */ }
        }
    });
};