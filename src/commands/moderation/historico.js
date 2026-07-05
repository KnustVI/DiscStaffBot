// /home/ubuntu/DiscStaffBot/src/commands/moderation/historico.js
const { SlashCommandBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const PunishmentSystem = require('../../systems/moderation/punishmentSystem');
const AnalyticsSystem = require('../../systems/moderation/analyticsSystem');
const { PaginationBuilder } = require('../../utils/paginationBuilder');
const imageManager = require('../../utils/imageManager');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const PremiumSystem = require('../../systems/premium/premiumSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Consulta a reputação e punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a consultar').setRequired(false))
        .addStringOption(opt => opt.setName('alderon_id')
            .setDescription('Buscar pelo Alderon ID em vez do usuário do Discord')
            .setRequired(false)),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, options } = interaction;
        const guildId = guild.id;
        const usuarioOpt = options.getUser('usuario');
        const alderonIdOpt = options.getString('alderon_id');

        try {
            if (!PremiumSystem.getGuildLimits(guildId).historyEnabled) {
                return await ResponseManager.error(interaction, 'O histórico de jogador é um recurso do plano Pegada ou superior. Use `/premium-status` para ver o tier atual deste servidor.');
            }

            if (!usuarioOpt && !alderonIdOpt) {
                return await ResponseManager.error(interaction, 'Informe `usuario` ou `alderon_id`.');
            }
            if (usuarioOpt && alderonIdOpt) {
                return await ResponseManager.error(interaction, 'Use apenas uma opção por vez: `usuario` OU `alderon_id`.');
            }

            let target = usuarioOpt;
            if (alderonIdOpt) {
                const linked = PlayerRegistry.getPlayerByAlderonId(alderonIdOpt.trim());
                if (!linked) {
                    return await ResponseManager.error(interaction, `Nenhum jogador registrado com o Alderon ID \`${alderonIdOpt}\`.`);
                }
                target = await client.users.fetch(linked.user_id).catch(() => null);
                if (!target) {
                    return await ResponseManager.error(interaction, 'Esse Alderon ID está vinculado a uma conta do Discord que não foi encontrada.');
                }
            }

            if (!target) {
                return await ResponseManager.error(interaction, 'Usuário não encontrado.');
            }

            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            db.ensureUser(target.id, target.username, target.discriminator, target.avatar);

            const ConfigSystem = require('../../systems/core/configSystem');
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');

            // ── Monta TODAS as páginas de uma vez (igual ao /ajuda) ─────────────
            const { pages, totalPages, totalRecords, reputation } =
                await PunishmentSystem.buildHistoryPages(target, guildId, guild.name);

            db.logActivity(guildId, user.id, 'history_view', target.id, {
                totalRecords,
                reputation,
                hasRecords: totalRecords > 0,
            });

            if (staffRoleId && interaction.member.roles.cache.has(staffRoleId)) {
                await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            }

            // Ícone do cabeçalho (fixo, ver punishmentSystem.js generateHistoryContainer)
            // — precisa ir junto no attachment em qualquer um dos dois caminhos abaixo.
            const historyIcon = imageManager.getAttachment('icone_history');

            // ── Sem registros: envia só a página única, sem botões de navegação ──
            if (totalPages <= 1) {
                const payload = pages[0]().build();
                if (historyIcon) payload.files = [...(payload.files || []), historyIcon];
                await interaction.editReply(payload);
                console.log(`📊 [HISTORICO] ${user.tag} consultou ${target.tag} | ${Date.now() - startTime}ms`);
                return;
            }

            // ── Paginação via PaginationBuilder, mesmo padrão do /ajuda ──────────
            const pagination = new PaginationBuilder({
                accentColor: 0xDCA15E,
                timeout: 120000,
            });

            pagination
                .addPages(...pages)
                .setButtons({
                    prev: { label: 'Anterior', style: ButtonStyle.Secondary },
                    next: { label: 'Próxima', style: ButtonStyle.Primary },
                });

            if (historyIcon) pagination.setFiles([historyIcon]);

            await pagination.start(interaction);

            console.log(`📊 [HISTORICO] ${user.tag} consultou ${target.tag} | ${Date.now() - startTime}ms`);

        } catch (error) {
            console.error('❌ Erro no historico:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao carregar histórico.');
        }
    }
};