// /home/ubuntu/DiscStaffBot/src/commands/moderation/historico.js
const { SlashCommandBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const PunishmentSystem = require('../../systems/punishmentSystem');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const { PaginationBuilder } = require('../../utils/paginationBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Consulta a reputação e punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a consultar').setRequired(true)),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, options } = interaction;
        const guildId = guild.id;
        const target = options.getUser('usuario');

        try {
            if (!target) {
                return await ResponseManager.error(interaction, 'Usuário não encontrado.');
            }

            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            db.ensureUser(target.id, target.username, target.discriminator, target.avatar);

            const ConfigSystem = require('../../systems/configSystem');
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

            // ── Sem registros: envia só a página única, sem botões de navegação ──
            if (totalPages <= 1) {
                const payload = pages[0]().build();
                await interaction.editReply(payload);
                console.log(`📊 [HISTORICO] ${user.tag} consultou ${target.tag} | ${Date.now() - startTime}ms`);
                return;
            }

            // ── Paginação via PaginationBuilder, mesmo padrão do /ajuda ──────────
            const pagination = new PaginationBuilder({
                accentColor: 0xDCA15E,
                timeout: 120000,
                footerText: `${guild.name} • Total: ${totalRecords} registros • Página {page}`,
            });

            pagination
                .addPages(...pages)
                .setButtons({
                    prev: { label: '◀ Anterior', style: ButtonStyle.Secondary },
                    next: { label: 'Próxima ▶', style: ButtonStyle.Primary },
                });

            await pagination.start(interaction);

            console.log(`📊 [HISTORICO] ${user.tag} consultou ${target.tag} | ${Date.now() - startTime}ms`);

        } catch (error) {
            console.error('❌ Erro no historico:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao carregar histórico.');
        }
    }
};