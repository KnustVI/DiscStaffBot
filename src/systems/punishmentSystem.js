// /home/ubuntu/DiscStaffBot/src/systems/punishmentSystem.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/index.js');
const { EMOJIS } = require('../database/emojis.js');
const { AdvancedContainerBuilder } = require('../utils/containerBuilder');
const { PaginationBuilder } = require('../utils/paginationBuilder');
const SessionManager = require('../utils/sessionManager');
const SequenceManager = require('../database/sequences');
const imageManager = require('../utils/imageManager');

const COLORS = {
    DEFAULT: 0xDCA15E,
    SUCCESS: 0xBBF96A,
    DANGER: 0xF64B4E,
    WARNING: 0xFFBD59
};

const PunishmentSystem = {
    
    // ==================== FUNÇÕES DE BUSCA E BANCO ====================
    
    async getUserHistory(guildId, userId, page = 1) {
        try {
            const limit = 5;
            const offset = (page - 1) * limit;

            let rep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const points = rep ? rep.points : 100;

            const total = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const totalRecords = total.count;
            const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

            const punishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE guild_id = ? AND user_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(guildId, userId, limit, offset);

            return { reputation: points, punishments, totalRecords, totalPages };
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            return { reputation: 100, punishments: [], totalRecords: 0, totalPages: 1 };
        }
    },
    
    async getUserData(guildId, userId) {
        try {
            const rep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const points = rep ? rep.points : 100;
            
            const lastPunishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE guild_id = ? AND user_id = ? 
                ORDER BY created_at DESC LIMIT 3
            `).all(guildId, userId);
            
            const totalStrikes = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            
            return { reputation: points, lastPunishments, totalStrikes: totalStrikes?.count || 0 };
        } catch (error) {
            console.error('❌ Erro ao buscar dados:', error);
            return { reputation: 100, lastPunishments: [], totalStrikes: 0 };
        }
    },

    getNextStrikeNumber(guildId) {
        const nextValue = SequenceManager.getNextValue(guildId, 'punishments');
        return nextValue;
    },
    
    // ==================== GERADORES DE UI (CONTAINER) ====================

    /**
     * Busca todos os dados necessários e monta TODAS as páginas do histórico
     * de uma vez (necessário porque PaginationBuilder.addPage recebe uma
     * função síncrona que retorna um AdvancedContainerBuilder já pronto).
     *
     * @param {object} target   - User do discord.js
     * @param {string} guildId
     * @param {string} guildName
     * @returns {Promise<{ pages: Function[], totalPages: number, totalRecords: number, reputation: number }>}
     */
    async buildHistoryPages(target, guildId, guildName) {
        // Primeiro busca a página 1 só para saber o totalPages/reputation/totalRecords
        const first = await this.getUserHistory(guildId, target.id, 1);
        const totalPages = first.totalPages;

        // Busca os dados de todas as páginas de uma vez (poucas páginas, é OK)
        const allPagesData = [first];
        for (let p = 2; p <= totalPages; p++) {
            allPagesData.push(await this.getUserHistory(guildId, target.id, p));
        }

        const pageFactories = allPagesData.map((historyData) =>
            () => this.generateHistoryContainer(target, historyData, guildName),
        );

        return {
            pages: pageFactories,
            totalPages,
            totalRecords: first.totalRecords,
            reputation: first.reputation,
        };
    },

    /**
     * Monta o container de uma única página do histórico.
     * Não inclui mais footer com paginação manual — isso agora é
     * responsabilidade do PaginationBuilder (footerText com {page}).
     */
    generateHistoryContainer(target, history, guildName) {
        let accentColor = COLORS.DEFAULT;
        if (history.reputation > 70) accentColor = COLORS.SUCCESS;
        else if (history.reputation < 30) accentColor = COLORS.DANGER;
        else if (history.reputation < 50) accentColor = COLORS.WARNING;
        
        const repEmoji = history.reputation >= 90 ? '🌟' : 
                        history.reputation >= 70 ? '⭐' : 
                        history.reputation >= 50 ? '👍' : '⚠️';

        const builder = new AdvancedContainerBuilder({ accentColor });

        // ── Banner (gallery) — só adiciona se a imagem existir de fato ──────
        const bannerUrl = imageManager.getUrl('title_historico_de_jogador');
        if (bannerUrl) {
            builder.gallery([bannerUrl]);
            builder.separator();
        }
        const avatar = target.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `# ${target.toString()}|ID ALDERON:123-456-789\n${target.username}\n(\`${target.id}\`)`,
            AdvancedContainerBuilder.thumbnail(avatar),
        );

        builder.separator();
        builder.text(`**Server:** ${guildName}`);
        builder.text(`${repEmoji} **Reputação Atual:** ${history.reputation}/100 pontos`);
        builder.text(`${EMOJIS.strike || '⚠️'} **Total de Punições:** ${history.totalRecords}`);
        
        if (history.punishments.length > 0) {
            builder.separator();
            for (const p of history.punishments) {
                const date = `<t:${Math.floor(p.created_at / 1000)}:d>`;
                const severityIcon = ['⚪', '🟢', '🟡', '🟠', '🔴', '💀'][p.severity] || '❓';
                const strikeNum = p.strike_number || p.id;
                builder.text(`${severityIcon} Strike #${strikeNum} | ${date}`);
                builder.text(`┃ Moderador: <@${p.moderator_id}>`);
                if (p.report_id) builder.text(`┃ Report: \`${p.report_id}\``);
                if (p.status === 'revoked') builder.text(`┃ Status: ✅ Anulado`);
                builder.separator();
            }
        } else {
            builder.text(`\`\`\`\nNenhuma punição registrada.\n\`\`\``);
        }
        
        // Nota: o footer com "Página X/Y" é adicionado automaticamente pelo
        // PaginationBuilder via footerText (substitui {page}). Não chamamos
        // builder.footer() aqui para não duplicar.
        
        return builder;
    },

    // ⚠️ MANTIDO por compatibilidade com qualquer chamada externa antiga.
    // Não é mais usado pelo fluxo principal de /historico (ver buildHistoryPages).
    generateHistoryButtons(targetId, currentPage, totalPages) {
        if (totalPages <= 1) return null;
        
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`punishment:history:prev:${targetId}:${currentPage - 1}`)
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`punishment:history:next:${targetId}:${currentPage + 1}`)
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === totalPages)
        );
    },
    
    generateStrikeUnifiedContainer(target, moderator, strikeNumber, severity, reason, reportId, pointsLost, newPoints, discordAct, discordActionResult, guildName, reportLink) {
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
        
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DANGER });

        // ── Banner de título — só adiciona se a imagem existir de fato ──────
        const bannerUrl = imageManager.getUrl('title_strike');
        if (bannerUrl) {
            builder.gallery([bannerUrl]);
            builder.separator();
        }

        // ── Apresentação padrão: Moderador primeiro, logo após o banner ─────
        const moderatorAvatar = moderator.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## ${moderator.toString()}\n${moderator.username}\n(\`${moderator.id}\`)`,
            AdvancedContainerBuilder.thumbnail(moderatorAvatar),
        );
        builder.separator();

        // ── Apresentação padrão: Usuário alvo da punição ─────────────────────
        const targetAvatar = target?.displayAvatarURL?.({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## ${target?.toString() || 'Desconhecido'}|ID ALDERON:123-456-789\n${target?.username || '?'}\n(\`${target?.id || '?'}\`)`,
            AdvancedContainerBuilder.thumbnail(targetAvatar),
        );
        builder.separator();
        builder.text(`## ${EMOJIS.ban || '❌'} STRIKE | ***#${strikeNumber}***`, 1);
        builder.text(`${severityIcons[severity]} **Severidade:** ${severityNames[severity]}`);
        builder.text(`**${EMOJIS.lose || '❌'} Pontos subtraídos:** -${pointsLost}`);
        builder.text(`**${EMOJIS.star || '⭐'} Reputação:** ${newPoints + pointsLost} → ${newPoints}`);
        builder.separator();
        builder.text(`**📝 Motivo:**`);
        if (reportId) builder.text(`**Report:** ${reportLink ? `[${reportId}](${reportLink})` : reportId}`);
        builder.text(`\`\`\`text\n${reason}\n\`\`\``);
        
        const actions = this.getPunishmentActions(severity, discordAct, discordActionResult);
        if (actions && actions !== '- 📝 **Apenas Registro:** Nenhuma ação automática aplicada') {
            builder.separator();
            builder.text(`**⚠️ Ações Aplicadas:**`);
            for (const action of actions.split('\n')) {
                if (action.trim()) builder.text(action);
            }
        }
        
        builder.footer(`${guildName || ''}`.trim());
        
        return builder;
    },
    
    generateUnstrikeUnifiedContainer(target, moderator, strikeNumber, reason, pointsRestored, newPoints, originalReason, guildName) {
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });

        // ── Banner de título — só adiciona se a imagem existir de fato ──────
        const bannerUrl = imageManager.getUrl('title_strike_removido');
        if (bannerUrl) {
            builder.gallery([bannerUrl]);
            builder.separator();
        }

        // ── Apresentação padrão: Moderador primeiro, logo após o banner ─────
        const moderatorAvatar = moderator.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## STAFF RESPONSAVEL\n${moderator.toString()}\n${moderator.username}\n(\`${moderator.id}\`)`,
            AdvancedContainerBuilder.thumbnail(moderatorAvatar),
        );
        builder.separator();

        // ── Apresentação padrão: Usuário alvo da anulação ────────────────────
        const targetAvatar = target?.displayAvatarURL?.({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## JOGADOR\n${target?.toString() || 'Desconhecido'}|ID ALDERON:123-456-789\n${target?.username || '?'}\n(\`${target?.id || '?'}\`)`,
            AdvancedContainerBuilder.thumbnail(targetAvatar),
        );
        builder.separator();
        builder.text(`## ${EMOJIS.check || '✅'} STRIKE ANULADO | ***#${strikeNumber}***`, 1);
        builder.text(`**${EMOJIS.gain || '✅'} Pontos restaurados:** +${pointsRestored}`);
        builder.text(`**${EMOJIS.star || '⭐'} Reputação:** ${newPoints - pointsRestored} → ${newPoints}`);
        builder.separator();
        builder.text(`**📝 Punição Original:**`);
        builder.text(`\`\`\`text\n${originalReason}\n\`\`\``);
        builder.separator();
        builder.text(`**📝 Motivo da Anulação:**`);
        builder.text(`\`\`\`text\n${reason}\n\`\`\``);
        builder.footer(`${guildName || ''}`.trim());
        
        return builder;
    },
    
    getPunishmentActions(severity, discordAct, discordActionResult) {
        const actions = [];
        
        if (severity >= 1 && severity <= 2) {
            actions.push(`- 📝 **Registro:** Infração registrada no sistema`);
        }
        if (severity >= 3) {
            actions.push(`- ⚠️ **Aviso Formal:** Comportamento inadequado registrado`);
        }
        if (severity >= 4) {
            actions.push(`- 🔇 **Mute Temporário:** Usuário silenciado por tempo determinado`);
        }
        if (severity >= 5) {
            actions.push(`- 🚫 **Banimento Permanente:** Usuário removido permanentemente`);
        }
        
        if (discordAct && discordAct !== 'none') {
            const actIcons = { timeout: '🔇', kick: '👢', ban: '🚫' };
            const actNames = { timeout: 'Timeout (Silenciamento)', kick: 'Expulsão do Servidor', ban: 'Banimento do Servidor' };
            const icon = actIcons[discordAct] || '⚡';
            const name = actNames[discordAct] || discordAct;
            
            if (discordActionResult && !discordActionResult.includes('Erro')) {
                actions.push(`- ${icon} **${name}:** ${discordActionResult}`);
            } else if (discordActionResult && discordActionResult.includes('Erro')) {
                actions.push(`- ❌ **${name}:** ${discordActionResult}`);
            } else {
                actions.push(`- ${icon} **${name}:** Aplicado com sucesso`);
            }
        }
        
        if (actions.length === 0) {
            actions.push(`- 📝 **Apenas Registro:** Nenhuma ação automática aplicada`);
        }
        
        return actions.join('\n');
    },
    
    // ==================== MÉTODOS PARA HANDLER CENTRAL ====================
    
    async handleComponent(interaction, action, param) {
        try {
            const [subAction, targetId, page] = param ? param.split(':') : [];
            switch (action) {
                case 'confirm':
                    await this.handleStrikeConfirmation(interaction, subAction);
                    break;
                default:
                    await interaction.editReply({ content: `❌ Ação "${action}" não reconhecida.`, components: [] });
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await interaction.editReply({ content: '❌ Ocorreu um erro.', components: [] });
        }
    },
    
    async handleModal(interaction, action) {
        try {
            switch (action) {
                case 'strike':
                    await this.processStrikeModal(interaction);
                    break;
                case 'unstrike':
                    await this.processUnstrikeModal(interaction);
                    break;
                default:
                    await interaction.editReply({ content: `❌ Modal "${action}" não reconhecido.`, flags: 64 });
            }
        } catch (error) {
            console.error('❌ Erro no handleModal:', error);
            await interaction.editReply({ content: '❌ Ocorreu um erro.', flags: 64 });
        }
    },
    
    async handleStrikeConfirmation(interaction, action) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
        if (!session) {
            return await interaction.editReply({ content: '❌ Sessão expirada. Use /strike novamente.', components: [] });
        }
        
        if (action === 'cancel') {
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
            return await interaction.editReply({ content: '❌ Punição cancelada.', components: [] });
        }
        
        if (action === 'confirm') {
            const ConfigSystem = require('./configSystem');
            const AnalyticsSystem = require('./analyticsSystem');
            const imageManager = require('../utils/imageManager');

            let emojis = {};
            try { emojis = require('../database/emojis.js').EMOJIS || {}; } catch (err) {}

            const { targetId, reason, severity, durationStr, reportId, discordAct, jogoAct, pointsLost } = session;
            const guild = interaction.guild;
            const staff = interaction.user;

            const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
            if (!targetUser) {
                SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
                return await interaction.editReply({ content: '❌ Usuário não encontrado.', components: [] });
            }

            const targetMember = await guild.members.fetch(targetId).catch(() => null);

            const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guild.id, targetId)?.points || 100;
            const newPoints = Math.max(0, currentRep - pointsLost);

            let durationMs = 0;
            if (durationStr !== '0' && durationStr.toLowerCase() !== 'perm') {
                durationMs = this.parseDuration(durationStr);
            }

            const strikeId = this.applyPunishment(guild.id, targetId, staff.id, reason, severity, reportId || null, pointsLost);
            if (!strikeId) {
                SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
                return await interaction.editReply({ content: '❌ Erro ao aplicar punição no banco de dados.', components: [] });
            }

            let discordActionResult = null;
            if (discordAct && discordAct !== 'none' && targetMember) {
                try {
                    switch (discordAct) {
                        case 'timeout':
                            await targetMember.timeout(durationMs > 0 ? durationMs : 60000, reason);
                            discordActionResult = `Timeout de ${durationStr || '1 minuto'} aplicado`;
                            break;
                        case 'kick':
                            await targetMember.kick(reason);
                            discordActionResult = 'Expulsão aplicada';
                            break;
                        case 'ban':
                            await targetMember.ban({ reason });
                            discordActionResult = 'Banimento aplicado';
                            break;
                    }
                } catch (err) {
                    discordActionResult = `❌ Erro: ${err.message}`;
                }
            }

            const roleResult = await this.applyTemporaryRole(guild, targetMember, durationMs);

            require('../database/index').logActivity(guild.id, staff.id, 'strike', targetId, {
                command: 'strike', punishmentId: strikeId, severity, pointsLost,
                oldPoints: currentRep, newPoints, reason, duration: durationStr, discordAct, jogoAct,
                temporaryRoleApplied: roleResult.applied
            });

            await AnalyticsSystem.updateStaffAnalytics(guild.id, staff.id);

            const containerBuilder = this.generateStrikeUnifiedContainer(
                targetUser, staff, strikeId, severity, reason, reportId || null,
                pointsLost, newPoints, discordAct, discordActionResult, guild.name, null
            );
            const { components, flags } = containerBuilder.build();

            const bannerAttachment = imageManager.getAttachment('title_strike');
            const filesPayload = bannerAttachment ? [bannerAttachment] : [];

            let dmDelivered = false;
            if (targetMember) {
                try {
                    await targetMember.send({ components, flags: [flags], files: filesPayload });
                    dmDelivered = true;
                } catch (err) {
                    dmDelivered = false;
                }
            }

            let logSent = false;
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_punishments');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        await logChannel.send({ components, flags: [flags], files: filesPayload });
                        logSent = true;
                    }
                } catch (err) {}
            }

            const dmStatusMsg = dmDelivered
                ? `${emojis.Check || '✅'} O jogador foi notificado em sua DM.`
                : `${emojis.Error || '❌'} O jogador tem as DM bloqueadas e não recebeu a notificação do strike.`;

            const roleStatusMsg = roleResult.applied
                ? `${emojis.strike || '⚠️'} Cargo de Strike aplicado temporariamente.`
                : (roleResult.error ? `${emojis.Note || 'ℹ️'} Cargo de Strike não aplicado: ${roleResult.error}` : null);

            const summaryLines = [
                `✅ **Strike #${strikeId} aplicado em ${targetUser.username}**`,
                `📉 ${pointsLost} pts perdidos`,
                `⭐ Reputação: ${newPoints}/100`,
                dmStatusMsg,
            ];
            if (roleStatusMsg) summaryLines.push(roleStatusMsg);
            if (!logSent) summaryLines.push(`${emojis.Warning || '⚠️'} A mensagem de log não foi enviada ao canal (verifique a configuração em /config-logs).`);

            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
            await interaction.editReply({ content: summaryLines.join('\n'), components: [] });
        }
    },
    
    async processStrikeModal(interaction) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'strike_modal', 'strike_modal');
        if (!session) {
            return await interaction.editReply({ content: '❌ Sessão expirada.', flags: 64 });
        }
        
        const reason = interaction.fields.getTextInputValue('reason');
        const severity = parseInt(session.severity);
        const pointsLost = this.getPointsBySeverity(severity);
        
            SessionManager.set(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending', {
        targetId: session.targetId,
        reason,
        severity,
        reportId: session.reportId,
        pointsLost,
        discordAct: session.discordAct,
        discordActionResult: session.discordActionResult
    }, 120000);
        
        const target = await interaction.client.users.fetch(session.targetId).catch(() => null);
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.WARNING });
        builder.title(`${EMOJIS.Warning || '⚠️'} Confirmar Aplicação de Strike`, 1);
        builder.separator();
        builder.text(`**👤 Usuário:** ${target?.tag || session.targetId}`);
        builder.text(`**⚠️ Severidade:** ${severityNames[severity]}`);
        builder.text(`**📝 Motivo:** ${reason}`);
        builder.text(`**📉 Pontos a perder:** -${pointsLost}`);
        builder.footer('Confirme ou cancele abaixo');
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`punishment:confirm:confirm`).setLabel('✅ Confirmar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`punishment:confirm:cancel`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger)
        );
        
        const { components, flags } = builder.build();
        const replyData = { components, flags: [flags] };
        replyData.components.push(row);
        await interaction.editReply(replyData);
        SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_modal', 'strike_modal');
    },
    
    async processUnstrikeModal(interaction) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'unstrike_modal', 'unstrike_modal');
        if (!session) {
            return await interaction.editReply({ content: '❌ Sessão expirada.', flags: 64 });
        }
        
        const reason = interaction.fields.getTextInputValue('reason');
        const strikeNumber = session.strikeId;
        
        const strike = db.prepare(`SELECT * FROM punishments WHERE guild_id = ? AND strike_number = ?`).get(interaction.guildId, strikeNumber);
        
        if (!strike) {
            return await interaction.editReply({ content: '❌ Strike não encontrado.', flags: 64 });
        }
        
        const pointsRestored = this.getPointsBySeverity(strike.severity);
        const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(interaction.guildId, strike.user_id)?.points || 100;
        const newPoints = Math.min(100, currentRep + pointsRestored);
        
        db.prepare(`DELETE FROM punishments WHERE guild_id = ? AND strike_number = ?`).run(interaction.guildId, strikeNumber);
        db.prepare(`UPDATE reputation SET points = ? WHERE guild_id = ? AND user_id = ?`).run(newPoints, interaction.guildId, strike.user_id);
        
        const target = await interaction.client.users.fetch(strike.user_id).catch(() => null);
        const container = this.generateUnstrikeUnifiedContainer(target, interaction.user, strikeNumber, reason, pointsRestored, newPoints, strike.reason, interaction.guild.name);
        
        const { components, flags } = container.build();
        const bannerAttachment = imageManager.getAttachment('title_strike_removido');
        const replyData = { components, flags: [flags] };
        if (bannerAttachment) replyData.files = [bannerAttachment];
        await interaction.editReply(replyData);
        SessionManager.delete(interaction.user.id, interaction.guildId, 'unstrike_modal', 'unstrike_modal');
    },
    
    // ==================== MÉTODOS DE NEGÓCIO ====================

    /**
     * Atribui o cargo temporário de Strike (configurado via /config-roles,
     * chave 'strike_role') ao membro punido, e registra a expiração na
     * tabela temporary_roles para remoção automática pelo worker (initWorker).
     *
     * Se durationMs <= 0 (punição permanente / "0" / "perm"), o cargo NÃO é
     * aplicado como temporário — a tabela temporary_roles existe apenas para
     * controlar remoções automáticas, então punição permanente não deveria
     * inserir um registro que nunca expira por design.
     *
     * @param {object} guild        - Guild do discord.js
     * @param {object} targetMember - GuildMember do discord.js (já buscado)
     * @param {number} durationMs   - Duração da punição em ms (0 = permanente)
     * @returns {Promise<{ applied: boolean, roleId: string|null, expiresAt: number|null, error: string|null }>}
     */
    async applyTemporaryRole(guild, targetMember, durationMs) {
        const ConfigSystem = require('./configSystem');
        const strikeRoleId = ConfigSystem.getSetting(guild.id, 'strike_role');

        if (!strikeRoleId) {
            return { applied: false, roleId: null, expiresAt: null, error: 'Cargo de Strike não configurado (config-roles).' };
        }

        if (!targetMember) {
            return { applied: false, roleId: strikeRoleId, expiresAt: null, error: 'Membro não está no servidor.' };
        }

        if (!durationMs || durationMs <= 0) {
            // Punição permanente: não aplica cargo temporário (sem expiração definida).
            return { applied: false, roleId: strikeRoleId, expiresAt: null, error: null };
        }

        try {
            const role = await guild.roles.fetch(strikeRoleId).catch(() => null);
            if (!role) {
                return { applied: false, roleId: strikeRoleId, expiresAt: null, error: 'Cargo configurado não existe mais no servidor.' };
            }

            await targetMember.roles.add(strikeRoleId, 'Cargo temporário de Strike aplicado');

            const expiresAt = Date.now() + durationMs;
            db.prepare(`
                INSERT INTO temporary_roles (guild_id, user_id, role_id, expires_at)
                VALUES (?, ?, ?, ?)
            `).run(guild.id, targetMember.id, strikeRoleId, expiresAt);

            return { applied: true, roleId: strikeRoleId, expiresAt, error: null };
        } catch (error) {
            console.error('❌ Erro ao aplicar cargo temporário de Strike:', error);
            return { applied: false, roleId: strikeRoleId, expiresAt: null, error: error.message };
        }
    },

    parseDuration(durationStr) {
        if (!durationStr || ['0', 'perm'].includes(durationStr.toLowerCase())) return 0;
        const timeValue = parseInt(durationStr);
        const type = durationStr.slice(-1).toLowerCase();
        const multipliers = { 'm': 60000, 'h': 3600000, 'd': 86400000 };
        return (multipliers[type] || 3600000) * timeValue;
    },
    
    getPointsBySeverity(severity) {
        const pointsMap = { 0: 0, 1: 5, 2: 15, 3: 30, 4: 50, 5: 100 };
        return pointsMap[severity] || 10;
    },
    
    applyPunishment(guildId, targetId, moderatorId, reason, severity, reportId, points) {
        try {
            const trans = db.transaction(() => {
                const maxStrike = db.prepare(`
                    SELECT MAX(strike_number) as max FROM punishments WHERE guild_id = ?
                `).get(guildId);
                const strikeNumber = (maxStrike?.max || 0) + 1;
                
                const uuid = require('../database/index').generateUUID();
                
                db.prepare(`
                    INSERT INTO punishments (uuid, guild_id, strike_number, user_id, moderator_id, reason, severity, points_deducted, report_id, created_at, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(uuid, guildId, strikeNumber, targetId, moderatorId, reason, severity, points, reportId, Date.now(), 'active');
                
                db.prepare(`
                    INSERT INTO reputation (guild_id, user_id, points) VALUES (?, ?, 100)
                    ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
                `).run(guildId, targetId, points);
                
                return strikeNumber;
            });
            return trans();
        } catch (error) {
            console.error('❌ Erro ao aplicar punição:', error);
            return null;
        }
    },
    
    initWorker(client) {
        console.log('⚖️ [Worker] Sistema de Punições Ativo');
        global.client = client;
        
        setInterval(async () => {
            try {
                const now = Date.now();
                const expiredRoles = db.prepare(`SELECT * FROM temporary_roles WHERE expires_at <= ?`).all(now);
                for (const entry of expiredRoles) {
                    const guild = client.guilds.cache.get(entry.guild_id);
                    if (guild) {
                        try {
                            const member = await guild.members.fetch(entry.user_id);
                            await member.roles.remove(entry.role_id, "Strike Expirado");
                        } catch (err) {}
                    }
                    db.prepare(`DELETE FROM temporary_roles WHERE id = ?`).run(entry.id);
                }
            } catch (error) {
                console.error('❌ Erro no worker:', error);
            }
        }, 30000);
    }
};

module.exports = PunishmentSystem;