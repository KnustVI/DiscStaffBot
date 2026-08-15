// src/commands/developer/transfer-user-data.js
/**
 * Transfere TODOS os dados de um jogador (identificado pelo Alderon ID,
 * que nunca muda) de uma conta ANTIGA do Discord pra uma conta NOVA —
 * pedido do dono, 2026-08-15: "um jogador trocou de conta do discord e
 * não nos preparamos para isso... preciso... um comando no bot DEV para
 * transferir as informações de uma conta do discord para a outra
 * mantendo o AGID cadastrado".
 *
 * Mesmo padrão de src/commands/developer/reset-user-data.js (molde
 * direto): 2 passos (prévia sem `confirmar`, execução com a frase
 * exata), `DEVELOPER_ID` hardcoded, tudo dentro de um `db.transaction()`
 * só, log de auditoria via `db.logActivity`.
 *
 * ESCOPO (confirmado com o dono): só migra colunas onde o Discord ID é
 * "dado do PRÓPRIO jogador" (perfil, moedas, reputação, punições que ele
 * RECEBEU, reports que ele ABRIU, premium, histórico de staff dele
 * mesmo). NÃO mexe em colunas onde o ID dele aparece como AUTOR de uma
 * ação sobre OUTRA pessoa (`punishments.moderator_id`/`revoked_by`/
 * `approved_by`, `reports.closed_by`/`last_reply_by`/`thread_deleted_by`,
 * `feedbacks.reviewed_by`, `player_premium.granted_by`,
 * `guild_premium.granted_by`, `punishment_levels.created_by`/
 * `updated_by`, `buffs.created_by`/`updated_by`,
 * `profile_image_pool.created_by`, `pot_chat_filters.created_by`,
 * `event_teleports.created_by`, `settings.updated_by`) — mesmo critério
 * que reset-user-data.js já usa: "isso pertence ao histórico de
 * auditoria de um terceiro, não é 'dado dele'". Nenhuma coluna
 * `alderon_id` é tocada em lugar nenhum — é a âncora que nunca muda, o
 * motivo deste comando existir. O prefixo sintético `agid:<AGID>` usado
 * em punições sem vínculo Discord (ver UNREGISTERED_TARGET_PREFIX em
 * punishmentSystem.js) também não é retroagido — mesmo critério que
 * /registrar já usa (nunca reescreve isso depois que alguém vincula).
 *
 * `reports.user_id` tem FOREIGN KEY de verdade pra `users(user_id)` (ver
 * schema.js/index.js, `PRAGMA foreign_keys = ON`) — por isso
 * `db.ensureUser(novaConta, ...)` roda ANTES de qualquer outra coisa
 * dentro da transação, senão o UPDATE de `reports` quebra com
 * SQLITE_CONSTRAINT_FOREIGNKEY se a conta nova nunca interagiu com o bot
 * ainda.
 *
 * Tabelas com chave composta envolvendo user_id (`reputation`,
 * `staff_presence_sessions`, `staff_analytics`, `event_teleport_uses`,
 * `image_inventory`) não podem levar um UPDATE em bloco — se a conta
 * nova JÁ tem uma linha com a mesma chave secundária (mesmo guild_id,
 * por exemplo), o UPDATE quebraria a constraint. Pra essas, cada linha é
 * migrada individualmente SE não colidir; se colidir, fica órfã na
 * conta antiga (nunca mais lida, inofensivo — nenhuma delas guarda
 * moeda de verdade). `pot_player_bones` (moeda de verdade, reforma
 * 2026-08-15) é a ÚNICA exceção: em vez de "pula e perde", SOMA o saldo
 * na conta nova e apaga a linha antiga.
 *
 * `player_links`/`player_premium` são singletons globais (uma linha só
 * por jogador) — se a conta NOVA já tiver uma linha própria em
 * QUALQUER uma das duas, o comando inteiro se RECUSA a rodar (nem
 * mostra prévia) em vez de tentar mesclar/sobrescrever às cegas.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';
const CONFIRM_PHRASE = 'TRANSFERIR CONTA';

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

// Tabelas "seguras" — coluna sem UNIQUE nenhum em cima dela, então um
// UPDATE em bloco nunca colide (mesmo padrão do deleteRows() de
// reset-user-data.js, só que UPDATE em vez de DELETE).
function updateRows(table, column, oldId, newId) {
    return db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(newId, oldId).changes;
}

function countMatch(table, column, id) {
    return db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${column} = ?`).get(id)?.c || 0;
}

// As 5 tabelas de chave composta — mesma forma pras 5: "existe uma linha
// com esta(s) coluna(s) secundária(s) pra conta nova?". Só LEITURA —
// reaproveitada tanto pela prévia quanto (de novo, fresca) na execução.
function partitionByConflict(table, idColumn, matchCols, oldId, newId) {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`).all(oldId);
    const whereMatch = matchCols.map((c) => `${c} = ?`).join(' AND ');
    const free = [];
    const conflict = [];
    for (const row of rows) {
        const exists = db.prepare(`SELECT 1 FROM ${table} WHERE ${whereMatch} AND ${idColumn} = ?`)
            .get(...matchCols.map((c) => row[c]), newId);
        (exists ? conflict : free).push(row);
    }
    return { free, conflict };
}

// Mutação correspondente — só as linhas SEM conflito (já filtradas por
// partitionByConflict). As em conflito ficam órfãs de propósito, sem
// ação nenhuma aqui.
function migrateFreeRows(table, idColumn, matchCols, free, newId) {
    if (!free.length) return 0;
    const whereMatch = matchCols.map((c) => `${c} = ?`).join(' AND ');
    const stmt = db.prepare(`UPDATE ${table} SET ${idColumn} = ? WHERE ${whereMatch} AND ${idColumn} = ?`);
    for (const row of free) stmt.run(newId, ...matchCols.map((c) => row[c]), row[idColumn]);
    return free.length;
}

const COMPOSITE_TABLES = [
    { table: 'reputation', matchCols: ['guild_id'], label: 'reputation' },
    { table: 'staff_presence_sessions', matchCols: ['guild_id'], label: 'staff_presence_sessions' },
    { table: 'staff_analytics', matchCols: ['guild_id', 'period', 'date'], label: 'staff_analytics' },
    { table: 'event_teleport_uses', matchCols: ['message_id'], label: 'event_teleport_uses' },
    { table: 'image_inventory', matchCols: ['pool_type', 'pool_id'], label: 'image_inventory' },
];

/**
 * pot_player_bones (moeda de verdade, ver docblock do arquivo) — única
 * tabela onde conflito vira MESCLAGEM (soma o saldo), não "pula e
 * perde". `dryRun:true` só calcula o que aconteceria, sem escrever nada
 * — reaproveitado pela prévia; a execução chama de novo com
 * `dryRun:false` (nunca reaproveita o resultado da prévia, dados podem
 * ter mudado entre uma interação e outra).
 */
function processPotPlayerBones(oldId, newId, { dryRun = false } = {}) {
    const rows = db.prepare(`SELECT * FROM pot_player_bones WHERE user_id = ?`).all(oldId);
    let migrated = 0;
    let merged = 0;
    let mergedBalance = 0;
    for (const row of rows) {
        const existing = db.prepare(`SELECT balance FROM pot_player_bones WHERE user_id = ? AND guild_id = ?`).get(newId, row.guild_id);
        if (existing) {
            merged++;
            mergedBalance += row.balance;
            if (!dryRun) {
                db.prepare(`UPDATE pot_player_bones SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND guild_id = ?`)
                    .run(row.balance, Math.floor(Date.now() / 1000), newId, row.guild_id);
                db.prepare(`DELETE FROM pot_player_bones WHERE user_id = ? AND guild_id = ?`).run(oldId, row.guild_id);
            }
        } else {
            migrated++;
            if (!dryRun) {
                db.prepare(`UPDATE pot_player_bones SET user_id = ? WHERE user_id = ? AND guild_id = ?`).run(newId, oldId, row.guild_id);
            }
        }
    }
    return { migrated, merged, mergedBalance };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('transfer-user-data')
        .setDescription('🔒 Transfere os dados de um jogador (por AGID) pra uma conta nova do Discord')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((opt) => opt.setName('agid')
            .setDescription('O Alderon ID (AGID) do jogador que trocou de conta')
            .setRequired(true))
        .addStringOption((opt) => opt.setName('nova_conta')
            .setDescription('O ID do Discord da conta NOVA')
            .setRequired(true))
        .addStringOption((opt) => opt.setName('confirmar')
            .setDescription(`Digite "${CONFIRM_PHRASE}" para confirmar a transferência`)
            .setRequired(true)),

    // client aqui é sempre o bot PRINCIPAL — ver src/systems/core/devBot.js.
    async execute(interaction, client) {
        const startTime = Date.now();
        const { user, options } = interaction;
        const agid = options.getString('agid').trim();
        const novaConta = options.getString('nova_conta').trim();
        const confirmacao = options.getString('confirmar');

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(null, user.id, 'transfer_user_data_denied', null, { command: 'transfer-user-data' });
            const denied = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Este comando é restrito ao desenvolvedor do bot.`)
                .footer('Bot de Developer');
            const { components, flags } = denied.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        const errorReply = async (message) => {
            const errBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} ${message}`)
                .footer('Bot de Developer — nenhuma alteração foi feita');
            const { components, flags } = errBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
        };

        const link = db.prepare(`SELECT user_id, player_name FROM player_links WHERE alderon_id = ?`).get(agid);
        if (!link) {
            return errorReply(`Nenhum jogador registrado com o Alderon ID \`${agid}\`.`);
        }
        const oldId = link.user_id;

        if (!/^\d{17,20}$/.test(novaConta)) {
            return errorReply('O `nova_conta` informado não parece um ID de Discord válido (precisa ser só números).');
        }

        if (oldId === novaConta) {
            return errorReply('A conta nova informada já é a conta atual deste AGID — nada a transferir.');
        }

        // Singletons globais — nunca mescla/sobrescreve às cegas, recusa
        // o comando inteiro se a conta nova já tiver identidade própria.
        const newHasLink = db.prepare(`SELECT 1 FROM player_links WHERE user_id = ?`).get(novaConta);
        const newHasPremium = db.prepare(`SELECT 1 FROM player_premium WHERE user_id = ?`).get(novaConta);
        if (newHasLink || newHasPremium) {
            const reasons = [
                newHasLink ? '- já tem um vínculo próprio (`/registrar`) com outro Alderon ID' : null,
                newHasPremium ? '- já tem uma linha própria de Player Premium' : null,
            ].filter(Boolean).join('\n');
            return errorReply([
                `A conta nova (\`${novaConta}\`) não pode receber esta transferência porque:`,
                reasons,
                '',
                'Resolva manualmente antes (ex: `/reset-user-data` na conta nova, se for isso mesmo que você quer) e tente de novo.',
            ].join('\n'));
        }

        // Best-effort — nunca bloqueia (rate limit/API fora do ar não pode
        // travar uma transferência válida), só melhora a prévia/o cache
        // inicial de `users` pra conta nova.
        const fetchedUser = await client.users.fetch(novaConta).catch(() => null);

        // ===== Prévia (contagens/conflitos, só leitura) =====
        const simpleCounts = {
            punishments: countMatch('punishments', 'user_id', oldId),
            reports: countMatch('reports', 'user_id', oldId),
            report_messages: countMatch('report_messages', 'user_id', oldId),
            temporary_roles: countMatch('temporary_roles', 'user_id', oldId),
            feedbacks: countMatch('feedbacks', 'user_id', oldId),
            game_shop_inventory: countMatch('game_shop_inventory', 'user_id', oldId),
            'activity_logs (autor)': countMatch('activity_logs', 'user_id', oldId),
            'activity_logs (alvo)': countMatch('activity_logs', 'target_id', oldId),
            pot_players: countMatch('pot_players', 'discord_id', oldId),
            'profile_image_pool (enviado por)': countMatch('profile_image_pool', 'submitted_by', oldId),
            player_level_ups: countMatch('player_level_ups', 'user_id', oldId),
        };

        const compositePreview = COMPOSITE_TABLES.map(({ table, matchCols, label }) => {
            const { free, conflict } = partitionByConflict(table, 'user_id', matchCols, oldId, novaConta);
            return { label, willMigrate: free.length, willOrphan: conflict.length };
        });

        const bonesPreview = processPotPlayerBones(oldId, novaConta, { dryRun: true });

        const simpleLines = Object.entries(simpleCounts)
            .filter(([, c]) => c > 0)
            .map(([table, c]) => `- \`${table}\`: ${c}`)
            .join('\n') || '_Nenhum registro nas tabelas simples._';

        const compositeLines = compositePreview
            .filter((c) => c.willMigrate > 0 || c.willOrphan > 0)
            .map((c) => `- \`${c.label}\`: ${c.willMigrate} migrarão${c.willOrphan > 0 ? `, ${c.willOrphan} ficarão órfãs (conflito com a conta nova)` : ''}`)
            .join('\n') || '_Nenhum registro nas tabelas de conflito._';

        const bonesLine = (bonesPreview.migrated > 0 || bonesPreview.merged > 0)
            ? `- \`pot_player_bones\`: ${bonesPreview.migrated} servidor(es) migram direto${bonesPreview.merged > 0 ? `, ${bonesPreview.merged} servidor(es) terão saldo MESCLADO (+${bonesPreview.mergedBalance} Ossos somados na conta nova)` : ''}`
            : '_Sem saldo de Ossos em nenhum servidor._';

        const identityLines = [
            `**AGID:** \`${agid}\`${link.player_name ? ` (${link.player_name})` : ''}`,
            `**Conta antiga:** \`${oldId}\``,
            `**Conta nova:** \`${novaConta}\`${fetchedUser ? ` (${fetchedUser.tag || fetchedUser.username})` : ` — ${EMOJIS.messagesquarewarning || '⚠️'} não foi possível confirmar que este ID é uma conta real do Discord`}`,
        ].join('\n');

        if (confirmacao !== CONFIRM_PHRASE) {
            const previewBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            previewBuilder.text([
                `# ${EMOJIS.search || '🔎'} PRÉVIA — AÇÃO NÃO CONFIRMADA`,
                `Digite exatamente **"${CONFIRM_PHRASE}"** no campo \`confirmar\` para executar.`,
                '',
                identityLines,
                '',
                '**Migração simples:**',
                simpleLines,
                '',
                '**Migração com checagem de conflito:**',
                compositeLines,
                '',
                '**Ossos (por servidor):**',
                bonesLine,
                '',
                `${EMOJIS.messagesquarewarning || 'ℹ️'} \`player_links\` e \`player_premium\` também migram (identidade + assinatura, se houver) — já confirmado que a conta nova não tem nenhuma das duas ainda.`,
            ].filter((l) => l !== undefined).join('\n'));
            previewBuilder.footer('Bot de Developer — nenhuma alteração foi feita');
            const { components, flags } = previewBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        try {
            const result = db.transaction(() => {
                // Satisfaz a FK de reports.user_id -> users.user_id ANTES
                // de qualquer outra coisa (ver docblock do arquivo).
                db.ensureUser(novaConta, fetchedUser?.username || null, fetchedUser?.discriminator || null, fetchedUser?.avatar || null);

                const simple = {
                    punishments: updateRows('punishments', 'user_id', oldId, novaConta),
                    reports: updateRows('reports', 'user_id', oldId, novaConta),
                    report_messages: updateRows('report_messages', 'user_id', oldId, novaConta),
                    temporary_roles: updateRows('temporary_roles', 'user_id', oldId, novaConta),
                    feedbacks: updateRows('feedbacks', 'user_id', oldId, novaConta),
                    game_shop_inventory: updateRows('game_shop_inventory', 'user_id', oldId, novaConta),
                    activity_logs_autor: updateRows('activity_logs', 'user_id', oldId, novaConta),
                    activity_logs_alvo: updateRows('activity_logs', 'target_id', oldId, novaConta),
                    pot_players: updateRows('pot_players', 'discord_id', oldId, novaConta),
                    profile_image_pool_submitted: updateRows('profile_image_pool', 'submitted_by', oldId, novaConta),
                    player_level_ups: updateRows('player_level_ups', 'user_id', oldId, novaConta),
                };

                const composite = {};
                for (const { table, matchCols, label } of COMPOSITE_TABLES) {
                    const { free, conflict } = partitionByConflict(table, 'user_id', matchCols, oldId, novaConta);
                    composite[label] = { migrated: migrateFreeRows(table, 'user_id', matchCols, free, novaConta), orphaned: conflict.length };
                }

                const bones = processPotPlayerBones(oldId, novaConta, { dryRun: false });

                // Singletons globais, por último — já validados sem
                // conflito antes de chegar aqui.
                db.prepare(`UPDATE player_links SET user_id = ? WHERE user_id = ?`).run(novaConta, oldId);
                const premiumMigrated = db.prepare(`UPDATE player_premium SET user_id = ? WHERE user_id = ?`).run(novaConta, oldId).changes;

                return { simple, composite, bones, premiumMigrated };
            })();

            const transferUuid = db.generateUUID();
            db.logActivity(null, user.id, 'transfer_user_data', novaConta, {
                command: 'transfer-user-data',
                agid,
                oldId,
                novaConta,
                result,
                transferUuid,
                responseTime: Date.now() - startTime,
            });

            const resultSimpleLines = Object.entries(result.simple)
                .filter(([, c]) => c > 0)
                .map(([table, c]) => `- \`${table}\`: ${c}`)
                .join('\n') || '_Nenhum registro migrado nas tabelas simples._';

            const resultCompositeLines = Object.entries(result.composite)
                .filter(([, c]) => c.migrated > 0 || c.orphaned > 0)
                .map(([label, c]) => `- \`${label}\`: ${c.migrated} migrado(s)${c.orphaned > 0 ? `, ${c.orphaned} órfã(s) por conflito` : ''}`)
                .join('\n') || '_Nenhum registro nas tabelas de conflito._';

            const resultBonesLine = (result.bones.migrated > 0 || result.bones.merged > 0)
                ? `${result.bones.migrated} servidor(es) migrado(s) direto, ${result.bones.merged} mesclado(s) (+${result.bones.mergedBalance} Ossos somados)`
                : 'Sem saldo de Ossos em nenhum servidor.';

            const successBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
            successBuilder.text([
                `# ${EMOJIS.shieldcheck || '✅'} DADOS TRANSFERIDOS`,
                identityLines,
            ].join('\n'));
            successBuilder.separator();
            successBuilder.text(`**Migração simples:**\n${resultSimpleLines}`);
            successBuilder.separator();
            successBuilder.text(`**Migração com conflito:**\n${resultCompositeLines}`);
            successBuilder.separator();
            successBuilder.text(`**Ossos:** ${resultBonesLine}`);
            successBuilder.separator();
            successBuilder.text(`**Player Premium:** ${result.premiumMigrated > 0 ? 'migrado' : 'não tinha (Free)'}`);
            successBuilder.separator();
            successBuilder.text(`${EMOJIS.messagesquarewarning || 'ℹ️'} Referências deste jogador como MODERADOR/STAFF em ações sobre outras pessoas foram preservadas na conta antiga (histórico de auditoria de terceiros). Cargos/apelido do Discord na conta nova continuam responsabilidade de cada servidor.`);
            successBuilder.footer('Bot de Developer', `UUID: ${transferUuid.slice(0, 8)} — ${Date.now() - startTime}ms`);

            const { components, flags } = successBuilder.build();
            await interaction.editReply({ components, flags: [flags] });

            console.log(`📊 [TRANSFER-USER-DATA] ${user.tag} transferiu AGID ${agid} de ${oldId} para ${novaConta}`);
        } catch (error) {
            console.error('❌ Erro no transfer-user-data:', error);

            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');

            db.logActivity(null, user.id, 'error', null, { command: 'transfer-user-data', error: error.message });

            const errorBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`# ${EMOJIS.circlealert || '❌'} ERRO NA TRANSFERÊNCIA\n\`${error.message?.slice(0, 150) || 'Desconhecido'}\``)
                .footer('Bot de Developer', 'A transação inteira foi revertida (nada foi alterado) — verifique o erro e tente de novo.');
            const { components, flags } = errorBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
        }
    },
};
