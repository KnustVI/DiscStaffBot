// src/commands/developer/reset-user-data.js
/**
 * Apaga TODOS os dados pessoais guardados sobre um usuário específico,
 * identificado por ID do Discord ou por Alderon ID (AGID) — usado pra
 * cumprir o direito de exclusão de dados descrito nos Termos de Serviço
 * (TERMOS_DE_SERVICO.txt, Seção 8: "Solicitar exclusão dos dados").
 *
 * Diferente de reset-db/reset-reports (que limpam um SERVIDOR inteiro), este
 * comando é global e cruza TODOS os servidores onde o bot está, já que a
 * identidade de um jogador (Discord ID / Alderon ID) não é presa a uma
 * guild — por isso não recebe servidor_id, mesmo padrão de /perfil-pool.
 *
 * Escopo: remove linhas onde o usuário é o ALVO/AUTOR direto do registro
 * (punições recebidas, reports abertos por ele, reputação, atividade em
 * jogo, perfil, premium). NÃO apaga nem anonimiza referências dele como
 * MODERADOR/STAFF em ações sobre OUTRAS pessoas (ex: moderator_id de uma
 * punição que ele aplicou em alguém) — isso pertence ao histórico de
 * auditoria de um terceiro, não é "dado dele" pra fins de exclusão.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';
const CONFIRM_PHRASE = 'APAGAR DADOS';

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

function inClause(n) {
    return Array.from({ length: n }, () => '?').join(', ');
}

function countRows(table, column, ids) {
    if (!ids.length) return 0;
    return db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${column} IN (${inClause(ids.length)})`).get(...ids)?.c || 0;
}

function deleteRows(table, column, ids) {
    if (!ids.length) return 0;
    return db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${inClause(ids.length)})`).run(...ids).changes;
}

/** Resolve o par (discordIds[], alderonIds[]) a partir de um único identificador conhecido. */
function resolveIdentities(tipo, identificador) {
    const discordIds = new Set();
    const alderonIds = new Set();

    if (tipo === 'discord') {
        discordIds.add(identificador);
        const link = db.prepare(`SELECT alderon_id FROM player_links WHERE user_id = ?`).get(identificador);
        if (link) alderonIds.add(link.alderon_id);
        for (const row of db.prepare(`SELECT DISTINCT alderon_id FROM pot_players WHERE discord_id = ?`).all(identificador)) {
            alderonIds.add(row.alderon_id);
        }
    } else {
        alderonIds.add(identificador);
        const link = db.prepare(`SELECT user_id FROM player_links WHERE alderon_id = ?`).get(identificador);
        if (link) discordIds.add(link.user_id);
        for (const row of db.prepare(`SELECT DISTINCT discord_id FROM pot_players WHERE alderon_id = ? AND discord_id IS NOT NULL`).all(identificador)) {
            discordIds.add(row.discord_id);
        }
    }

    return { discordIds: [...discordIds], alderonIds: [...alderonIds] };
}

function buildSummary(discordIds, alderonIds) {
    const counts = {
        users: countRows('users', 'user_id', discordIds),
        reputation: countRows('reputation', 'user_id', discordIds),
        punishments: countRows('punishments', 'user_id', discordIds),
        reports: countRows('reports', 'user_id', discordIds),
        report_messages: countRows('report_messages', 'user_id', discordIds),
        staff_analytics: countRows('staff_analytics', 'user_id', discordIds),
        temporary_roles: countRows('temporary_roles', 'user_id', discordIds),
        feedbacks: countRows('feedbacks', 'user_id', discordIds),
        event_teleport_uses: countRows('event_teleport_uses', 'user_id', discordIds),
        player_premium: countRows('player_premium', 'user_id', discordIds),
        pot_players: db.prepare(`SELECT COUNT(*) as c FROM pot_players WHERE discord_id IN (${inClause(discordIds.length || 1)}) OR alderon_id IN (${inClause(alderonIds.length || 1)})`)
            .get(...(discordIds.length ? discordIds : ['']), ...(alderonIds.length ? alderonIds : [''])).c || 0,
        pot_dinosaur_picks: countRows('pot_dinosaur_picks', 'alderon_id', alderonIds),
        pot_logs: countRows('pot_logs', 'alderon_id', alderonIds),
        pot_spectator_sessions: countRows('pot_spectator_sessions', 'alderon_id', alderonIds),
        activity_logs: discordIds.length
            ? db.prepare(`SELECT COUNT(*) as c FROM activity_logs WHERE user_id IN (${inClause(discordIds.length)}) OR target_id IN (${inClause(discordIds.length)})`).get(...discordIds, ...discordIds)?.c || 0
            : 0,
        player_links: (discordIds.length || alderonIds.length)
            ? db.prepare(`SELECT COUNT(*) as c FROM player_links WHERE user_id IN (${inClause(discordIds.length || 1)}) OR alderon_id IN (${inClause(alderonIds.length || 1)})`)
                .get(...(discordIds.length ? discordIds : ['']), ...(alderonIds.length ? alderonIds : [''])).c || 0
            : 0,
    };
    return counts;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-user-data')
        .setDescription('🔒 LGPD/privacidade: apaga TODOS os dados guardados de um usuário (Discord ID ou AGID)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('tipo')
            .setDescription('Tipo do identificador informado')
            .setRequired(true)
            .addChoices(
                { name: 'ID do Discord', value: 'discord' },
                { name: 'Alderon ID (AGID)', value: 'alderon' },
            ))
        .addStringOption(opt => opt.setName('identificador')
            .setDescription('O ID do Discord ou o Alderon ID (AGID) do usuário')
            .setRequired(true))
        .addStringOption(opt => opt.setName('confirmar')
            .setDescription(`Digite "${CONFIRM_PHRASE}" para confirmar a exclusão`)
            .setRequired(true)),

    // client aqui é sempre o bot PRINCIPAL — ver src/systems/core/devBot.js.
    async execute(interaction, client) {
        const startTime = Date.now();
        const { user, options } = interaction;
        const tipo = options.getString('tipo');
        const identificador = options.getString('identificador').trim();
        const confirmacao = options.getString('confirmar');

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(null, user.id, 'reset_user_data_denied', null, { command: 'reset-user-data' });
            const denied = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Este comando é restrito ao desenvolvedor do bot.`)
                .footer('Bot de Developer');
            const { components, flags } = denied.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        const { discordIds, alderonIds } = resolveIdentities(tipo, identificador);

        if (!discordIds.length && !alderonIds.length) {
            const errBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Identificador inválido.`)
                .footer('Bot de Developer');
            const { components, flags } = errBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        const counts = buildSummary(discordIds, alderonIds);
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const summaryLines = Object.entries(counts)
            .filter(([, c]) => c > 0)
            .map(([table, c]) => `- \`${table}\`: ${c}`)
            .join('\n') || '_Nenhum registro encontrado nas tabelas monitoradas._';

        const idLines = [
            discordIds.length ? `**ID(s) Discord:** ${discordIds.map(d => `\`${d}\``).join(', ')}` : null,
            alderonIds.length ? `**Alderon ID(s):** ${alderonIds.map(a => `\`${a}\``).join(', ')}` : null,
        ].filter(Boolean).join('\n');

        if (confirmacao !== CONFIRM_PHRASE) {
            const cancelBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            cancelBuilder.text([
                `# ${EMOJIS.search || '🔎'} PRÉVIA — AÇÃO NÃO CONFIRMADA`,
                `Digite exatamente **"${CONFIRM_PHRASE}"** no campo \`confirmar\` para executar.`,
                '',
                idLines,
                '',
                `**Seria removido (${total} registro(s) no total):**`,
                summaryLines,
            ].filter(l => l !== undefined).join('\n'));
            cancelBuilder.footer('Bot de Developer — nenhuma alteração foi feita');
            const { components, flags } = cancelBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        try {
            // Guarda os IDs de mensagem das imagens de perfil ANTES de apagar a
            // linha de player_links, pra poder deletar os anexos no canal de
            // armazenamento depois (senão a imagem em si fica órfã lá).
            const linkRows = (discordIds.length || alderonIds.length)
                ? db.prepare(`SELECT banner_message_id, background_message_id FROM player_links WHERE user_id IN (${inClause(discordIds.length || 1)}) OR alderon_id IN (${inClause(alderonIds.length || 1)})`)
                    .all(...(discordIds.length ? discordIds : ['']), ...(alderonIds.length ? alderonIds : ['']))
                : [];

            const wipe = db.transaction(() => {
                deleteRows('users', 'user_id', discordIds);
                deleteRows('reputation', 'user_id', discordIds);
                deleteRows('punishments', 'user_id', discordIds);
                deleteRows('reports', 'user_id', discordIds);
                deleteRows('report_messages', 'user_id', discordIds);
                deleteRows('staff_analytics', 'user_id', discordIds);
                deleteRows('temporary_roles', 'user_id', discordIds);
                deleteRows('feedbacks', 'user_id', discordIds);
                deleteRows('event_teleport_uses', 'user_id', discordIds);
                deleteRows('player_premium', 'user_id', discordIds);
                deleteRows('pot_players', 'discord_id', discordIds);
                deleteRows('pot_players', 'alderon_id', alderonIds);
                deleteRows('pot_dinosaur_picks', 'alderon_id', alderonIds);
                deleteRows('pot_logs', 'alderon_id', alderonIds);
                deleteRows('pot_spectator_sessions', 'alderon_id', alderonIds);

                if (discordIds.length) {
                    db.prepare(`DELETE FROM activity_logs WHERE user_id IN (${inClause(discordIds.length)}) OR target_id IN (${inClause(discordIds.length)})`)
                        .run(...discordIds, ...discordIds);
                }

                db.prepare(`DELETE FROM player_links WHERE user_id IN (${inClause(discordIds.length || 1)}) OR alderon_id IN (${inClause(alderonIds.length || 1)})`)
                    .run(...(discordIds.length ? discordIds : ['']), ...(alderonIds.length ? alderonIds : ['']));
            });

            wipe();

            // Best-effort: apaga as imagens (avatar/plano de fundo) que o
            // próprio jogador enviou pro canal de armazenamento. Erros aqui
            // não revertem a exclusão dos dados no banco (já concluída acima).
            const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
            if (storageChannelId) {
                const storageChannel = await client.channels.fetch(storageChannelId).catch(() => null);
                if (storageChannel) {
                    const messageIds = new Set();
                    for (const row of linkRows) {
                        if (row.banner_message_id) messageIds.add(row.banner_message_id);
                        if (row.background_message_id) messageIds.add(row.background_message_id);
                    }
                    for (const messageId of messageIds) {
                        try {
                            const msg = await storageChannel.messages.fetch(messageId).catch(() => null);
                            if (msg) await msg.delete().catch(() => {});
                        } catch (err) {}
                    }
                }
            }

            const wipeUuid = db.generateUUID();
            db.logActivity(null, user.id, 'reset_user_data', null, {
                command: 'reset-user-data',
                tipo,
                identificador,
                discordIds,
                alderonIds,
                counts,
                total,
                wipeUuid,
                responseTime: Date.now() - startTime,
            });

            const successBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
            successBuilder.text([
                `# ${EMOJIS.shieldcheck || '✅'} DADOS DO USUÁRIO APAGADOS`,
                idLines,
            ].filter(Boolean).join('\n'));
            successBuilder.separator();
            successBuilder.text(`**Registros removidos (${total} no total):**\n${summaryLines}`);
            successBuilder.separator();
            successBuilder.text(`${EMOJIS.messagesquarewarning || 'ℹ️'} Referências deste usuário como MODERADOR/STAFF em ações sobre outras pessoas foram preservadas (histórico de auditoria de terceiros).`);
            successBuilder.footer('Bot de Developer', `UUID: ${wipeUuid.slice(0, 8)} — ${Date.now() - startTime}ms`);

            const { components, flags } = successBuilder.build();
            await interaction.editReply({ components, flags: [flags] });

            console.log(`📊 [RESET-USER-DATA] ${user.tag} apagou dados de ${idLines.replace(/\n/g, ' | ')} | ${total} registros`);
        } catch (error) {
            console.error('❌ Erro no reset-user-data:', error);

            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');

            db.logActivity(null, user.id, 'error', null, { command: 'reset-user-data', error: error.message });

            const errorBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`# ${EMOJIS.circlealert || '❌'} ERRO AO APAGAR DADOS\n\`${error.message?.slice(0, 150) || 'Desconhecido'}\``)
                .footer('Bot de Developer', 'O banco de dados pode estar parcialmente alterado — verifique manualmente.');
            const { components, flags } = errorBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
        }
    },
};
