const cron = require('node-cron');
const db = require('../database/database');
const { EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../database/emojis'); // Adicionado para alinhar com seu sistema

module.exports = (client) => {
    // Executa todo dia às 03:00 da manhã
    cron.schedule('0 3 * * *', async () => {
        console.log("🛡️ [Automod] Verificação de Cargos e Recuperação iniciada...");

        const now = Date.now();
        const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;
        const FIFTEEN_DAYS = 1000 * 60 * 60 * 24 * 15;
        const ONE_DAY = 1000 * 60 * 60 * 24;

        const stats = {}; 

        const initStats = (id) => {
            if (!stats[id]) stats[id] = { repUp: 0, rolesAdded: 0, rolesRemoved: 0, errors: [] };
        };

        /* -----------------------------------------------------------
           1. RECUPERAÇÃO DIÁRIA DE REPUTAÇÃO
        ----------------------------------------------------------- */
        try {
            // Conta quantos serão afetados para o log
            const affected = db.prepare(`
                SELECT guild_id FROM users 
                WHERE reputation < 100 
                AND (last_penalty IS NULL OR ? - last_penalty >= ?)
            `).all(now, ONE_DAY);
            
            affected.forEach(u => {
                initStats(u.guild_id);
                stats[u.guild_id].repUp++;
            });

            // Aplica a recuperação (+1 ponto por dia sem punição)
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
        // Buscamos apenas quem está nos extremos para poupar processamento
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

                // --- CARGO: EXEMPLAR (95+ Rep e 30 dias limpo) ---
                if (settings.exemplar_role) {
                    const hasExemplar = member.roles.cache.has(settings.exemplar_role);
                    if (timeWithoutPenalty >= THIRTY_DAYS && userData.reputation >= 95) {
                        if (!hasExemplar) {
                            await member.roles.add(settings.exemplar_role).catch(() => null);
                            stats[guildId].rolesAdded++;
                        }
                    } else if (hasExemplar && userData.reputation < 90) {
                        // Remove se a reputação caiu demais
                        await member.roles.remove(settings.exemplar_role).catch(() => null);
                        stats[guildId].rolesRemoved++;
                    }
                }

                // --- CARGO: PROBLEMÁTICO (Rep <= 30 ou 5+ punições recentes) ---
                if (settings.problem_role) {
                    const recent = db.prepare(`
                        SELECT COUNT(*) as total FROM punishments 
                        WHERE user_id = ? AND guild_id = ? AND created_at > ? AND severity > 0
                    `).get(userData.user_id, guildId, now - FIFTEEN_DAYS);

                    const isProblematic = recent.total >= 5 || userData.reputation <= 30;
                    const hasProblemRole = member.roles.cache.has(settings.problem_role);

                    if (isProblematic && !hasProblemRole) {
                        await member.roles.add(settings.problem_role).catch(() => null);
                        stats[guildId].rolesAdded++;
                        
                        // Remove exemplar se ele tiver
                        if (settings.exemplar_role && member.roles.cache.has(settings.exemplar_role)) {
                            await member.roles.remove(settings.exemplar_role).catch(() => null);
                        }
                    } else if (!isProblematic && hasProblemRole && userData.reputation > 50) {
                        await member.roles.remove(settings.problem_role).catch(() => null);
                        stats[guildId].rolesRemoved++;
                    }
                }
            } catch (err) {
                stats[guildId].errors.push(err.message);
            }
        }

            /* -----------------------------------------------------------
            3. ENVIO DOS LOGS DE AUDITORIA (Via Alert Channel)
            ----------------------------------------------------------- */
            for (const guildId in stats) {
            const s = stats[guildId];
            const guild = client.guilds.cache.get(guildId);
            if (!guild) continue;

            const settings = getSettings(guildId);

            // Define o canal: Prioridade total para o alert_channel
            const targetChannelId = settings.alert_channel || settings.logs_channel;

            if (!targetChannelId) {
            console.log(`⚠️ [Automod] Canal de logs não configurado em: ${guild.name}`);
            continue;
            }

            const channel = await guild.channels.fetch(targetChannelId).catch(() => null);

            if (channel) {
            const hasErrors = s.errors.length > 0;
            const totalChanges = s.repUp + s.rolesAdded + s.rolesRemoved;

            const embed = new EmbedBuilder()
                .setTitle(hasErrors ? `⚠️ Relatório Automod (Com Avisos)` : `✅ Manutenção Diária Concluída`)
                .setColor(hasErrors ? 0xFFAA00 : 0x2ECC71)
                .setThumbnail(client.user.displayAvatarURL())
                .setTimestamp();

            // Se houve mudanças, detalha. Se não, avisa que foi apenas rotina.
            if (totalChanges > 0) {
                embed.setDescription(`Manutenção realizada com sucesso em **${guild.name}**.`)
                        .addFields(
                        { name: `${EMOJIS.REPUTATION} Reputação`, value: `\`+1 pt\` para **${s.repUp}** usuários.`, inline: true },
                        { name: `${EMOJIS.STATUS} Cargos`, value: `**${s.rolesAdded}** atribuídos\n**${s.rolesRemoved}** removidos.`, inline: true }
                        );
            } else {
                embed.setDescription(`**Rotina de Prevenção:** Nenhuma alteração de cargo ou reputação foi necessária hoje em **${guild.name}**.`);
            }

            if (hasErrors) {
                embed.addFields({ 
                    name: `❌ Erros Técnicos`, 
                    value: `\`\`\`${s.errors.slice(0, 3).join('\n')}\`\`\`` 
                });
            }

            embed.setFooter({ text: `✧ Sistema de Integridade Staff`, iconURL: guild.iconURL() });

            await channel.send({ embeds: [embed] }).catch(err => {
                console.error(`Erro ao enviar log para ${guild.name}:`, err);
            });
            }
        }

        console.log("✅ [Automod] Ciclo de manutenção finalizado.");
    });
};

function getSettings(guildId) {
    const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
}