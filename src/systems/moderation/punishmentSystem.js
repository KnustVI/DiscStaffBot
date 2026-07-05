// /home/ubuntu/DiscStaffBot/src/systems/moderation/punishmentSystem.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index.js');
const { EMOJIS } = require('../../database/emojis.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { PaginationBuilder } = require('../../utils/paginationBuilder');
const SessionManager = require('../../utils/sessionManager');
const SequenceManager = require('../../database/sequences');
const { getPlayerByDiscordId } = require('../pot/potPlayerRegistry');
const imageManager = require('../../utils/imageManager');
const PremiumSystem = require('../premium/premiumSystem');
const { buildIdentityBlock } = require('../../utils/userIdentity');

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
            () => this.generateHistoryContainer(target, historyData, guildName, guildId),
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
     */
    generateHistoryContainer(target, history, guildName, guildId) {
        let accentColor = COLORS.DEFAULT;
        if (history.reputation > 70) accentColor = COLORS.SUCCESS;
        else if (history.reputation < 30) accentColor = COLORS.ERROR;

        const repEmoji = history.reputation >= 90 ? (EMOJIS.starfull || '🌟') :
                        history.reputation >= 70 ? (EMOJIS.star || '⭐') :
                        history.reputation >= 50 ? (EMOJIS.thumbsup || '👍') : (EMOJIS.trianglealert || '⚠️');

        const builder = new AdvancedContainerBuilder({ accentColor });

        // Ícone via imageManager.getUrl() direto (não builder.assetThumbnail()):
        // este container roda dentro do PaginationBuilder, que só reaproveita
        // o attachment registrado globalmente via pagination.setFiles() (ver
        // historico.js) — um attachment registrado aqui dentro por página se
        // perderia ao trocar de página.
        builder.section(
            [
                '# HISTÓRICO DO JOGADOR',
                'Reputação e punições registradas para este usuário.',
            ].join('\n'),
            AdvancedContainerBuilder.thumbnail(imageManager.getUrl('icone_history') || 'https://cdn.discordapp.com/embed/avatars/0.png')
        );
        builder.separator();

        const avatar = target.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            buildIdentityBlock(target),
            AdvancedContainerBuilder.thumbnail(avatar),
        );

        builder.separator();
        builder.text(`**Server:** ${guildName}`);
        if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
            builder.text(`${repEmoji} **Reputação Atual:** ${history.reputation}/100 pontos`);
        } else {
            builder.text(`${EMOJIS.messagesquare || 'ℹ️'} **Reputação:** disponível a partir do plano Rastreador`);
        }
        builder.text(`${EMOJIS.gavel || '⚠️'} **Total de Punições:** ${history.totalRecords}`);
        
        if (history.punishments.length > 0) {
            builder.separator();
            for (const p of history.punishments) {
                const date = `<t:${Math.floor(p.created_at / 1000)}:d>`;
                const severityIcon = [EMOJIS.thumbsup || '⚪', EMOJIS.severidadebaixa || '🟢', EMOJIS.severidademedia || '🟡', EMOJIS.severidadelaranja || '🟠', EMOJIS.severidadealta || '🔴', EMOJIS.Dead || '💀'][p.severity] || '❓';
                const strikeNum = p.strike_number || p.id;
                builder.text(`${severityIcon} Strike #${strikeNum} | ${date}`);
                builder.text(`┃ Moderador: <@${p.moderator_id}>`);
                if (p.report_id) builder.text(`┃ Report: \`${p.report_id}\``);
                if (p.status === 'revoked') builder.text(`┃ Status: ${EMOJIS.circlecheck || '✅'} Anulado`);
                builder.separator();
            }
        } else {
            builder.text(`\`\`\`\nNenhuma punição registrada.\n\`\`\``);
        }
        
        builder.footer(guildName);

        return builder;
    },

    generateStrikeUnifiedContainer(target, moderator, strikeNumber, severity, reason, reportId, pointsLost, newPoints, discordAct, discordActionResult, guildName, reportLink, guildId) {
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        const severityIcons = ['', EMOJIS.severidadebaixa || '🟢', EMOJIS.severidademedia || '🟡', EMOJIS.severidadelaranja || '🟠', EMOJIS.severidadealta || '🔴', EMOJIS.Dead || '💀'];

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
        builder.banner('title_strike');

        // ── Apresentação padrão: Moderador primeiro, logo após o banner ─────
        const moderatorAvatar = moderator.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## STAFF RESPONSAVEL\n${buildIdentityBlock(moderator)}`,
            AdvancedContainerBuilder.thumbnail(moderatorAvatar),
        );
        builder.separator();

        // ── Apresentação padrão: Usuário alvo da punição ─────────────────────
        const targetAvatar = target?.displayAvatarURL?.({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## JOGADOR\n${buildIdentityBlock(target)}`,
            AdvancedContainerBuilder.thumbnail(targetAvatar),
        );
        builder.separator();
        builder.text(`## ${EMOJIS.ban || '❌'} STRIKE | ***#${strikeNumber}***`, 1);
        builder.text(`${severityIcons[severity]} **Severidade:** ${severityNames[severity]}`);
        if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
            builder.text(`**${EMOJIS.doublearrowdown || '❌'} Pontos subtraídos:** -${pointsLost}`);
            builder.text(`**${EMOJIS.star || '⭐'} Reputação:** ${newPoints + pointsLost} → ${newPoints}`);
        }
        builder.separator();
        builder.text(`**${EMOJIS.messagesquare || '📝'} Motivo:**`);
        if (reportId) builder.text(`**Report:** ${reportLink ? `[${reportId}](${reportLink})` : reportId}`);
        builder.text(`\`\`\`text\n${reason}\n\`\`\``);
        
        const actions = this.getPunishmentActions(severity, discordAct, discordActionResult);
        if (actions && actions !== `- ${EMOJIS.messagesquare || '📝'} **Apenas Registro:** Nenhuma ação automática aplicada`) {
            builder.separator();
            builder.text(`**${EMOJIS.trianglealert || '⚠️'} Ações Aplicadas:**`);
            for (const action of actions.split('\n')) {
                if (action.trim()) builder.text(action);
            }
        }
        
        builder.footer(guildName);
        
        return builder;
    },
    
    generateUnstrikeUnifiedContainer(target, moderator, strikeNumber, reason, pointsRestored, newPoints, originalReason, guildName, guildId) {
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
        builder.banner('title_strike_removido');

        // ── Apresentação padrão: Moderador primeiro, logo após o banner ─────
        const moderatorAvatar = moderator.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## STAFF RESPONSAVEL\n${buildIdentityBlock(moderator)}`,
            AdvancedContainerBuilder.thumbnail(moderatorAvatar),
        );
        builder.separator();

        // ── Apresentação padrão: Usuário alvo da anulação ────────────────────
        const targetAvatar = target?.displayAvatarURL?.({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## JOGADOR\n${buildIdentityBlock(target)}`,
            AdvancedContainerBuilder.thumbnail(targetAvatar),
        );
        builder.separator();
        builder.text(`## ${EMOJIS.circlecheck || '✅'} STRIKE ANULADO | ***#${strikeNumber}***`, 1);
        if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
            builder.text(`**${EMOJIS.doublearrowup || '✅'} Pontos restaurados:** +${pointsRestored}`);
            builder.text(`**${EMOJIS.star || '⭐'} Reputação:** ${newPoints - pointsRestored} → ${newPoints}`);
        }
        builder.separator();
        builder.text(`**${EMOJIS.messagesquare || '📝'} Punição Original:**`);
        builder.text(`\`\`\`text\n${originalReason}\n\`\`\``);
        builder.separator();
        builder.text(`**${EMOJIS.messagesquare || '📝'} Motivo da Anulação:**`);
        builder.text(`\`\`\`text\n${reason}\n\`\`\``);
        builder.footer(guildName);
        
        return builder;
    },
    
    getPunishmentActions(severity, discordAct, discordActionResult) {
        const actions = [];
        
        if (severity >= 1 && severity <= 2) {
            actions.push(`- ${EMOJIS.messagesquare || '📝'} **Registro:** Infração registrada no sistema`);
        }
        if (severity >= 3) {
            actions.push(`- ${EMOJIS.trianglealert || '⚠️'} **Aviso Formal:** Comportamento inadequado registrado`);
        }
        if (severity >= 4) {
            actions.push(`- ${EMOJIS.micoff || '🔇'} **Mute Temporário:** Usuário silenciado por tempo determinado`);
        }
        if (severity >= 5) {
            actions.push(`- ${EMOJIS.ban || '🚫'} **Banimento Permanente:** Usuário removido permanentemente`);
        }

        if (discordAct && discordAct !== 'none') {
            const actIcons = { timeout: EMOJIS.micoff || '🔇', kick: EMOJIS.userx || '👢', ban: EMOJIS.ban || '🚫' };
            const actNames = { timeout: 'Timeout (Silenciamento)', kick: 'Expulsão do Servidor', ban: 'Banimento do Servidor' };
            const icon = actIcons[discordAct] || EMOJIS.raio || '⚡';
            const name = actNames[discordAct] || discordAct;

            if (discordActionResult && !discordActionResult.includes('Erro')) {
                actions.push(`- ${icon} **${name}:** ${discordActionResult}`);
            } else if (discordActionResult && discordActionResult.includes('Erro')) {
                actions.push(`- ${EMOJIS.circlealert || '❌'} **${name}:** ${discordActionResult}`);
            } else {
                actions.push(`- ${icon} **${name}:** Aplicado com sucesso`);
            }
        }

        if (actions.length === 0) {
            actions.push(`- ${EMOJIS.messagesquare || '📝'} **Apenas Registro:** Nenhuma ação automática aplicada`);
        }
        
        return actions.join('\n');
    },
    
    // ==================== MÉTODOS PARA HANDLER CENTRAL ====================

    /**
     * Monta um payload Components V2 de uma linha só. As mensagens de
     * confirmação de strike/unstrike são Components V2 (MessageFlags.
     * IsComponentsV2) — depois de um deferUpdate(), o Discord rejeita
     * `content` legado nelas (erro 50035 "MESSAGE_CANNOT_USE_LEGACY_
     * FIELDS_WITH_COMPONENTS_V2"). Por isso todo editReply de resultado/erro
     * aqui precisa passar por um container, não por `{ content }`.
     */
    _simpleReply(text, color = COLORS.ERROR, guildName = null) {
        return new AdvancedContainerBuilder({ accentColor: color }).text(text).footer(guildName).build();
    },

    async handleComponent(interaction, action, param) {
        try {
            const [subAction, targetId, page] = param ? param.split(':') : [];
            switch (action) {
                case 'confirm':
                    await this.handleStrikeConfirmation(interaction, subAction);
                    break;
                case 'unstrike_confirm':
                    await this.handleUnstrikeConfirmation(interaction, subAction);
                    break;
                case 'supervisor_approve':
                    await this.handleSupervisorApproval(interaction, param, true);
                    break;
                case 'supervisor_reject':
                    await this.handleSupervisorApproval(interaction, param, false);
                    break;
                default:
                    await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Ação "${action}" não reconhecida.`, COLORS.ERROR, interaction.guild?.name));
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Ocorreu um erro.`, COLORS.ERROR, interaction.guild?.name));
        }
    },

    async handleStrikeConfirmation(interaction, action) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
        if (!session) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Sessão expirada. Use /strike novamente.`, COLORS.ERROR, interaction.guild?.name));
        }

        if (action === 'cancel') {
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Punição cancelada.`, COLORS.ERROR, interaction.guild?.name));
        }
        
        if (action === 'confirm') {
            const guild = interaction.guild;
            const staff = interaction.user;
            const staffMember = interaction.member;

            // ── Punição severa (Nível 4/5) OU duração longa (>72h/permanente):
            // exige aprovação do cargo Supervisor, a menos que quem esteja
            // confirmando já SEJA o supervisor (fluxo normal nesse caso). Vale
            // pra qualquer tier — em servidores Free (sem níveis de severidade
            // relevantes) é a duração que decide sozinha. ────────────────────
            if (this.requiresSupervisorApproval(session) && !(await this.memberHasSupervisorRole(guild, staffMember))) {
                SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
                return await this.requestSupervisorApproval(interaction, session);
            }

            const result = await this._executeStrike(guild, staff, session);
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');

            if (!result.success) {
                return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} ${result.error}`, COLORS.ERROR, interaction.guild?.name));
            }

            await interaction.editReply(this._simpleReply(this._buildStrikeSummaryLines(result, guild.id).join('\n'), COLORS.SUCCESS, interaction.guild?.name));
        }
    },

    // ==================== APROVAÇÃO DE SUPERVISOR (PUNIÇÕES SEVERAS) ====================

    /**
     * Severidade 4 (Severa) e 5 (Permanente) cobrem bans muito longos ou
     * permanentes — exigem aprovação do cargo Supervisor (ver /config-roles,
     * aba Moderação) quando aplicadas por um Staff comum.
     */
    isSevereSeverity(severity) {
        return Number(severity) >= 4;
    },

    /**
     * Decide se uma punição precisa de aprovação de Supervisor — por
     * severidade (nível 4/5) OU por duração (>72h ou permanente),
     * independente do tier. Free não usa níveis de severidade de forma
     * relevante (sem reputação), então na prática só a duração importa lá.
     */
    requiresSupervisorApproval(session) {
        if (this.isSevereSeverity(session.severity)) return true;
        const durationStr = String(session.durationStr || '');
        const isPermanent = durationStr === '0' || durationStr.toLowerCase() === 'perm';
        if (isPermanent) return true;
        return this.parseDuration(durationStr) > 72 * 3600000;
    },

    async memberHasSupervisorRole(guild, member) {
        if (!member) return false;
        const ConfigSystem = require('../core/configSystem');
        const supervisorRoleId = ConfigSystem.getSetting(guild.id, 'supervisor_role');
        if (!supervisorRoleId) return false;
        return member.roles?.cache?.has(supervisorRoleId) || false;
    },

    /**
     * Envia o pedido de aprovação para o canal de log de punições, marcando
     * o cargo Supervisor, e avisa o staff que abriu o pedido. Os dados da
     * punição pendente ficam guardados no SessionManager sob uma chave
     * própria (não a do staff) — quem clicar Aprovar/Rejeitar é o
     * supervisor, um usuário diferente de quem pediu.
     */
    async requestSupervisorApproval(interaction, session) {
        const ConfigSystem = require('../core/configSystem');
        const guild = interaction.guild;
        const staff = interaction.user;

        let emojis = {};
        try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

        const supervisorRoleId = ConfigSystem.getSetting(guild.id, 'supervisor_role');
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_punishments');

        if (!supervisorRoleId || !logChannelId) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Esta punição é severa e precisa de aprovação de um Supervisor, mas o cargo Supervisor e/ou o canal de log de punições ainda não foram configurados (${EMOJIS.gavel || '⚖️'} veja /config-roles e /config-logs). Peça a um administrador para configurar antes de tentar novamente.`,
                COLORS.ERROR, guild.name,
            ));
        }

        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} O canal de log de punições configurado não foi encontrado. Peça a um administrador para reconfigurar em /config-logs.`,
                COLORS.ERROR, guild.name,
            ));
        }

        const approvalId = db.generateUUID();
        SessionManager.set('approval', guild.id, 'strike_approval', approvalId, {
            ...session,
            requestedBy: staff.id,
            requestedByTag: staff.tag,
        }, 15 * 60 * 1000);

        const targetUser = await interaction.client.users.fetch(session.targetId).catch(() => null);
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        const severityIcons = ['', EMOJIS.severidadebaixa || '🟢', EMOJIS.severidademedia || '🟡', EMOJIS.severidadelaranja || '🟠', EMOJIS.severidadealta || '🔴', EMOJIS.Dead || '💀'];

        const approvalBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        approvalBuilder.section(
            [
                '# APROVAÇÃO NECESSÁRIA: PUNIÇÃO SEVERA',
                `<@&${supervisorRoleId}> um Staff solicitou uma punição de nível **${severityNames[session.severity]}**, que precisa de aprovação antes de ser aplicada.`,
            ].join('\n'),
            targetUser ? AdvancedContainerBuilder.thumbnail(targetUser.displayAvatarURL({ size: 128 })) : null,
        );
        approvalBuilder.separator();
        approvalBuilder.text(`**${EMOJIS.user || '👤'} Solicitado por:** ${staff.toString()}`);
        approvalBuilder.text(`**${EMOJIS.user || '👤'} Alvo:** ${targetUser ? targetUser.toString() : `\`${session.targetId}\``}`);
        approvalBuilder.text(`${severityIcons[session.severity]} **Severidade:** ${severityNames[session.severity]}`);
        if (PremiumSystem.getGuildLimits(guild.id).reputationEnabled) {
            approvalBuilder.text(`**${EMOJIS.doublearrowdown || '📉'} Pontos a perder:** -${session.pointsLost}`);
        }
        approvalBuilder.text(`**${EMOJIS.raio || '⚡'} Ação no Discord:** ${session.discordAct === 'none' || !session.discordAct ? 'Nenhuma' : session.discordAct}`);
        approvalBuilder.text(`**${EMOJIS.clockalert || '⏳'} Duração:** ${session.durationStr === '0' || session.durationStr?.toLowerCase() === 'perm' ? 'Permanente' : session.durationStr}`);
        approvalBuilder.separator();
        approvalBuilder.text(`**${EMOJIS.messagesquare || '📝'} Motivo:**\n\`\`\`text\n${session.reason}\n\`\`\``);
        approvalBuilder.footer(guild.name, 'Apenas o cargo Supervisor pode aprovar ou rejeitar este pedido.');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`punishment:supervisor_approve:${approvalId}`).setLabel('Aprovar').setStyle(ButtonStyle.Success).setEmoji(emojis.circlecheck || '✅'),
            new ButtonBuilder().setCustomId(`punishment:supervisor_reject:${approvalId}`).setLabel('Rejeitar').setStyle(ButtonStyle.Danger).setEmoji(emojis.circlealert || '❌'),
        );

        const { components, flags } = approvalBuilder.build();
        await logChannel.send({ components: [...components, row], flags: [flags] });

        return await interaction.editReply(this._simpleReply(
            `${emojis.clockalert || '⏳'} Esta é uma punição **severa** (${severityNames[session.severity]}). Como você não possui o cargo Supervisor, o pedido foi enviado para aprovação no canal de log de punições, marcando o cargo Supervisor. A punição só será aplicada depois que um Supervisor aprovar.`,
            COLORS.DEFAULT, guild.name,
        ));
    },

    /**
     * Clique de Aprovar/Rejeitar no pedido enviado a logs-punições.
     * @param {boolean} approved
     */
    async handleSupervisorApproval(interaction, approvalId, approved) {
        const guild = interaction.guild;

        if (!(await this.memberHasSupervisorRole(guild, interaction.member))) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Apenas o cargo Supervisor pode aprovar ou rejeitar punições severas.`, COLORS.ERROR, guild?.name));
        }

        const session = SessionManager.get('approval', guild.id, 'strike_approval', approvalId);
        if (!session) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Este pedido de aprovação expirou ou já foi resolvido.`, COLORS.ERROR, guild?.name));
        }
        SessionManager.delete('approval', guild.id, 'strike_approval', approvalId);

        const requester = await interaction.client.users.fetch(session.requestedBy).catch(() => null);

        if (!approved) {
            await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Punição severa **rejeitada** por ${interaction.user}. O pedido de ${session.requestedByTag || session.requestedBy} não foi aplicado.`,
                COLORS.ERROR, guild.name,
            ));
            if (requester) {
                await requester.send(
                    `${EMOJIS.circlealert || '❌'} Seu pedido de punição severa contra \`${session.targetId}\` foi **rejeitado** por ${interaction.user.tag} em **${guild.name}**.`
                ).catch(() => {});
            }
            return;
        }

        // Aplica a punição com o staff original como responsável (moderator_id),
        // já que ele decidiu o caso — o supervisor só autorizou a execução.
        const originalStaff = requester || interaction.user;
        const result = await this._executeStrike(guild, originalStaff, session);

        if (!result.success) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} ${result.error}`, COLORS.ERROR, guild.name));
        }

        const summaryLines = this._buildStrikeSummaryLines(result, guild.id);
        summaryLines.unshift(`${EMOJIS.circlecheck || '✅'} **Aprovado por ${interaction.user.tag}**`);
        await interaction.editReply(this._simpleReply(summaryLines.join('\n'), COLORS.SUCCESS, guild.name));

        if (requester) {
            await requester.send(
                `${EMOJIS.circlecheck || '✅'} Seu pedido de punição severa contra ${result.targetUser?.tag || session.targetId} foi **aprovado** por ${interaction.user.tag} em **${guild.name}** e já foi aplicado (Strike #${result.strikeId}).`
            ).catch(() => {});
        }
    },

    /**
     * Núcleo compartilhado da aplicação de um strike: grava a punição,
     * vincula ao report (se houver), aplica ação no Discord, aplica cargo
     * temporário, registra atividade/analytics, envia DM ao alvo e log ao
     * canal configurado. Usado tanto pela confirmação direta (staff comum
     * em punição leve/moderada, ou Supervisor em qualquer nível) quanto pela
     * aprovação de punição severa (ver requestSupervisorApproval).
     *
     * @param {import('discord.js').Guild} guild
     * @param {import('discord.js').User} staff - Creditado como moderator_id
     * @param {object} session - { targetId, reason, severity, durationStr, reportId, discordAct, jogoAct, pointsLost }
     * @returns {Promise<object>} resultado com { success, error } ou os dados usados no resumo
     */
    async _executeStrike(guild, staff, session) {
        const ConfigSystem = require('../core/configSystem');
        const AnalyticsSystem = require('./analyticsSystem');

        let emojis = {};
        try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

        const { targetId, reason, severity, durationStr, reportId, discordAct, jogoAct, pointsLost } = session;

        const targetUser = await guild.client.users.fetch(targetId).catch(() => null);
        if (!targetUser) {
            return { success: false, error: 'Usuário não encontrado.' };
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
            return { success: false, error: 'Erro ao aplicar punição no banco de dados.' };
        }

        // ── Fecha o vínculo report ↔ punição: se o strike referenciou um
        // report (já validado em strike.js), grava a punição aplicada
        // de volta no próprio report para consulta futura. ──────────────
        if (reportId) {
            const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
            const linkedReportNumber = parseInt(String(reportId).replace(/^#?R/i, ''));
            if (!isNaN(linkedReportNumber)) {
                db.prepare(`UPDATE reports SET punishment = ? WHERE guild_id = ? AND report_number = ?`)
                    .run(`Strike #${strikeId} (${severityNames[severity] || severity})`, guild.id, linkedReportNumber);
            }
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
                discordActionResult = `${EMOJIS.circlealert || '❌'} Erro: ${err.message}`;
            }
        }

        const roleResult = await this.applyTemporaryRole(guild, targetMember, durationMs);

        // ── Ação in-game automática via RCON — só pra servidores Fossil.
        // PENDENTE: sintaxe exata dos comandos RCON do Path of Titans ainda
        // não foi verificada (ver plano de implementação) — os comandos
        // abaixo são um placeholder e precisam ser confirmados contra o
        // servidor real antes de depender deles em produção. ────────────────
        let ingameActionResult = null;
        if (jogoAct && jogoAct !== 'none') {
            if (!PremiumSystem.getGuildLimits(guild.id).autoRcon) {
                ingameActionResult = 'Ação in-game requer o plano Caçador.';
            } else {
                const link = getPlayerByDiscordId(targetId);
                if (!link) {
                    ingameActionResult = 'Jogador não vinculado ao Path of Titans (/registrar) — ação in-game não executada.';
                } else {
                    try {
                        const PoTConfigSystem = require('../pot/potConfigSystem');
                        const rconCommands = {
                            rcon_warn: `warn ${link.alderon_id} ${reason}`,
                            rcon_kick: `kick ${link.alderon_id}`,
                            rcon_slay: `slay ${link.alderon_id}`,
                            rcon_ban: `ban ${link.alderon_id} ${reason}`,
                        };
                        const rconResult = await PoTConfigSystem.executeRconCommand(guild.id, rconCommands[jogoAct]);
                        ingameActionResult = rconResult?.success
                            ? 'Ação in-game executada.'
                            : `Falha na ação in-game: ${rconResult?.error || 'erro desconhecido'}`;
                    } catch (err) {
                        ingameActionResult = `Falha na ação in-game: ${err.message}`;
                    }
                }
            }
        }

        db.logActivity(guild.id, staff.id, 'strike', targetId, {
            command: 'strike', punishmentId: strikeId, severity, pointsLost,
            oldPoints: currentRep, newPoints, reason, duration: durationStr, discordAct, jogoAct,
            temporaryRoleApplied: roleResult.applied, ingameActionResult
        });

        await AnalyticsSystem.updateStaffAnalytics(guild.id, staff.id);

        const containerBuilder = this.generateStrikeUnifiedContainer(
            targetUser, staff, strikeId, severity, reason, reportId || null,
            pointsLost, newPoints, discordAct, discordActionResult, guild.name, null, guild.id
        );
        const { components, flags, files: filesPayload } = containerBuilder.build();

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

        const roleStatusMsg = roleResult.applied
            ? `${emojis.gavel || '⚠️'} Cargo de Strike aplicado temporariamente.`
            : (roleResult.error ? `${emojis.messagesquare || 'ℹ️'} Cargo de Strike não aplicado: ${roleResult.error}` : null);

        return {
            success: true, strikeId, targetUser, pointsLost, newPoints,
            dmDelivered, logSent, roleStatusMsg, ingameActionResult,
        };
    },

    _buildStrikeSummaryLines(result, guildId) {
        let emojis = {};
        try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

        const dmStatusMsg = result.dmDelivered
            ? `${emojis.circlecheck || '✅'} O jogador foi notificado em sua DM.`
            : `${emojis.circlealert || '❌'} O jogador tem as DM bloqueadas e não recebeu a notificação do strike.`;

        const lines = [
            `${emojis.circlecheck || '✅'} **Strike #${result.strikeId} aplicado em ${result.targetUser.username}**`,
        ];
        if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
            lines.push(`${emojis.doublearrowdown || '📉'} ${result.pointsLost} pts perdidos`);
            lines.push(`${emojis.star || '⭐'} Reputação: ${result.newPoints}/100`);
        }
        lines.push(dmStatusMsg);
        if (result.roleStatusMsg) lines.push(result.roleStatusMsg);
        if (result.ingameActionResult) lines.push(`${emojis.game || '🎮'} ${result.ingameActionResult}`);
        if (!result.logSent) lines.push(`${emojis.trianglealert || '⚠️'} A mensagem de log não foi enviada ao canal (verifique a configuração em /config-logs).`);
        return lines;
    },

    async handleUnstrikeConfirmation(interaction, action) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'unstrike_pending', 'unstrike_pending');
        if (!session) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Sessão expirada. Use /unstrike novamente.`, COLORS.ERROR, interaction.guild?.name));
        }

        if (action === 'cancel') {
            SessionManager.delete(interaction.user.id, interaction.guildId, 'unstrike_pending', 'unstrike_pending');
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Anulação cancelada.`, COLORS.ERROR, interaction.guild?.name));
        }

        if (action === 'confirm') {
            const ConfigSystem = require('../core/configSystem');
            const AnalyticsSystem = require('./analyticsSystem');

            let emojis = {};
            try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

            const { punishmentId, reason } = session;
            const guild = interaction.guild;
            const guildId = interaction.guildId;
            const staff = interaction.user;

            // ── Busca por strike_number (o número mostrado como "Strike #N"),
            // não pela PK global `id` — ver mesmo comentário em unstrike.js. ────
            const punishment = db.prepare(`SELECT * FROM punishments WHERE strike_number = ? AND guild_id = ? AND status = 'active'`).get(punishmentId, guildId);
            if (!punishment) {
                SessionManager.delete(interaction.user.id, guildId, 'unstrike_pending', 'unstrike_pending');
                return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Punição não encontrada ou já anulada.`, COLORS.ERROR, interaction.guild?.name));
            }

            const targetMember = await guild.members.fetch(punishment.user_id).catch(() => null);

            // ── Usa o valor REAL gravado na punição (points_deducted), não um
            // mapa fixo — garante que a devolução bate com o que foi de fato
            // descontado, mesmo se os pontos de severidade tiverem sido
            // reconfigurados depois em /config-punishments. ────────────────────
            const pointsRestored = punishment.points_deducted || 0;
            const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, punishment.user_id)?.points || 100;
            const newPoints = Math.min(100, currentRep + pointsRestored);

            db.prepare(`UPDATE punishments SET status = 'revoked', revoked_by = ?, revoked_reason = ?, revoked_at = ?
                WHERE id = ? AND guild_id = ?`).run(staff.id, reason, Date.now(), punishment.id, guildId);
            // Free não deduziu pontos ao aplicar (ver applyPunishment), então
            // não há nada a restaurar aqui também.
            if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
                db.prepare(`UPDATE reputation SET points = MIN(100, points + ?) WHERE guild_id = ? AND user_id = ?`)
                    .run(pointsRestored, guildId, punishment.user_id);
            }

            const strikeRoleId = ConfigSystem.getSetting(guildId, 'strike_role');
            if (strikeRoleId && targetMember?.roles.cache.has(strikeRoleId)) {
                try {
                    await targetMember.roles.remove(strikeRoleId, `Punição #${punishmentId} anulada`);
                } catch (err) {}
            }
            if (targetMember?.communicationDisabledUntilTimestamp) {
                try {
                    await targetMember.timeout(null, `Punição #${punishmentId} anulada`);
                } catch (err) {}
            }

            db.logActivity(guildId, staff.id, 'unstrike', punishment.user_id, {
                command: 'unstrike', punishmentId, pointsRestored, oldPoints: currentRep, newPoints
            });

            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);

            const targetUser = await interaction.client.users.fetch(punishment.user_id).catch(() => null);
            const containerBuilder = this.generateUnstrikeUnifiedContainer(
                targetUser, staff, punishmentId, reason, pointsRestored, newPoints, punishment.reason, guild.name, guildId
            );
            const { components, flags, files: filesPayload } = containerBuilder.build();

            let dmDelivered = false;
            if (targetUser) {
                try {
                    await targetUser.send({ components, flags: [flags], files: filesPayload });
                    dmDelivered = true;
                } catch (err) {
                    dmDelivered = false;
                }
            }

            let logSent = false;
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_punishments');
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
                ? `${emojis.circlecheck || '✅'} O jogador foi notificado em sua DM.`
                : `${emojis.circlealert || '❌'} O jogador tem as DM bloqueadas e não recebeu a notificação da anulação.`;

            const summaryLines = [
                `${emojis.circlecheck || '✅'} **Strike #${punishmentId} anulado!**`,
            ];
            if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
                summaryLines.push(`${emojis.doublearrowup || '📈'} +${pointsRestored} pts | ${emojis.star || '⭐'} Reputação: ${newPoints}/100`);
            }
            summaryLines.push(dmStatusMsg);
            if (!logSent) summaryLines.push(`${emojis.trianglealert || '⚠️'} A mensagem de log não foi enviada ao canal (verifique a configuração em /config-logs).`);

            SessionManager.delete(interaction.user.id, interaction.guildId, 'unstrike_pending', 'unstrike_pending');
            await interaction.editReply(this._simpleReply(summaryLines.join('\n'), COLORS.SUCCESS, interaction.guild?.name));
        }
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
        const ConfigSystem = require('../core/configSystem');
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
    
    applyPunishment(guildId, targetId, moderatorId, reason, severity, reportId, points) {
        try {
            const trans = db.transaction(() => {
                const maxStrike = db.prepare(`
                    SELECT MAX(strike_number) as max FROM punishments WHERE guild_id = ?
                `).get(guildId);
                const strikeNumber = (maxStrike?.max || 0) + 1;
                
                const uuid = require('../../database/index').generateUUID();
                
                db.prepare(`
                    INSERT INTO punishments (uuid, guild_id, strike_number, user_id, moderator_id, reason, severity, points_deducted, report_id, created_at, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(uuid, guildId, strikeNumber, targetId, moderatorId, reason, severity, points, reportId, Date.now(), 'active');
                
                // Sistema de pontos de reputação é recurso Pegada+ — em
                // servidores Free a punição fica registrada, mas os pontos
                // não são calculados/salvos (decisão do dono).
                if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
                    db.prepare(`
                        INSERT INTO reputation (guild_id, user_id, points) VALUES (?, ?, 100)
                        ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
                    `).run(guildId, targetId, points);
                }

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