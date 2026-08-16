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
 * MIGRAÇÃO DE VERDADE, NÃO CÓPIA (pedido do dono, 2026-08-15, revisão
 * depois da 1ª versão): como o AGID só pode estar vinculado a UMA conta
 * do Discord por vez (`player_links.alderon_id UNIQUE`), a conta nova
 * numa troca de conta real nunca teria dado próprio conflitando de
 * verdade — então em vez de tentar mesclar (Ossos) ou deixar órfão
 * (reputação/staff/etc.) qualquer linha que colida com algo que a conta
 * nova já tenha, TUDO da conta antiga que não puder migrar é
 * DESCARTADO, e a conta antiga é APAGADA POR COMPLETO no final (até a
 * linha de `users`) — nada fica salvo em banco sob o ID antigo, por
 * economia de espaço (mesmo espírito do "favor database space economy"
 * já seguido pro resto do projeto). O jogador é avisado por DM na conta
 * ANTIGA (melhor esforço — pode falhar se DM estiver fechada, não trava
 * a transferência) explicando que os dados foram migrados pra conta
 * nova; esse aviso na conversa do Discord É o registro do que aconteceu
 * com a conta antiga, não uma linha no banco.
 *
 * `reports.user_id` tem FOREIGN KEY de verdade pra `users(user_id)` (ver
 * schema.js/index.js, `PRAGMA foreign_keys = ON`) — por isso
 * `db.ensureUser(novaConta, ...)` roda ANTES de qualquer outra coisa
 * dentro da transação, senão o UPDATE de `reports` quebra com
 * SQLITE_CONSTRAINT_FOREIGNKEY se a conta nova nunca interagiu com o bot
 * ainda. A linha de `users` da conta ANTIGA só é apagada no final (nada
 * mais aponta pra ela a essa altura).
 *
 * Tabelas com chave composta envolvendo user_id (`reputation`,
 * `staff_presence_sessions`, `staff_analytics`, `event_teleport_uses`,
 * `image_inventory`, e `pot_player_bones`) não podem levar um UPDATE em
 * bloco — se a conta nova JÁ tem uma linha com a mesma chave secundária
 * (mesmo guild_id, por exemplo), o UPDATE quebraria a constraint. Pra
 * essas, cada linha é migrada individualmente SE não colidir; se
 * colidir, é DESCARTADA (não fica órfã, não mescla) — incluindo
 * `pot_player_bones` (Ossos): num conflito de verdade (raro — só
 * aconteceria se a conta NOVA já tivesse jogado antes com um AGID
 * diferente), o saldo antigo daquele servidor é descartado junto. A
 * prévia/resumo final sempre mostram quanto seria/foi descartado
 * (inclusive em Ossos, se houver) — nunca é silencioso, mesmo que a
 * ação em si não pergunte de novo.
 *
 * `player_links`/`player_premium` são singletons globais (uma linha só
 * por jogador) — se a conta NOVA já tiver uma linha própria em
 * QUALQUER uma das duas, o comando inteiro se RECUSA a rodar (nem
 * mostra prévia) em vez de tentar mesclar/sobrescrever às cegas.
 *
 * ORDEM DE ESCRITA SEGURA (pedido do dono, 2026-08-15, reforçando o que
 * já era verdade por causa da transação única): "só vamos apagar os
 * dados antigos quando tudo estiver registrado na conta nova". Como
 * TUDO roda dentro de um único `db.transaction()`, isso já era
 * garantido pela atomicidade (se qualquer passo falhar, a transação
 * inteira reverte, nada é apagado) — mas o apagamento final da conta
 * antiga (`DELETE FROM users`) só roda DEPOIS de uma verificação
 * explícita (não só implícita) de que `player_links` do AGID realmente
 * aponta pra conta nova. Se essa verificação falhar por qualquer
 * motivo, a função lança erro, a transação inteira reverte (nada foi
 * apagado) e o erro aparece tanto na resposta ao dono quanto no log
 * detalhado do canal.
 *
 * LOG DETALHADO (pedido do dono, 2026-08-15): além da resposta efêmera
 * pro dono e da DM pra conta antiga, todo resultado (sucesso OU erro) é
 * mandado também pro canal fixo de log de sistema (`sendSystemLog`, ver
 * systemLog.js — mesmo canal `1525104070321504428` no servidor
 * `430534418818400266` que o dono já usa pra acompanhar o bot) — um
 * registro permanente e auditável de toda transferência, com contagem
 * completa por tabela, o que foi descartado (se algo foi), e o UUID que
 * correlaciona com a linha de `activity_logs`.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { sendSystemLog } = require('../../systems/core/systemLog');

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

/**
 * As 6 tabelas de chave composta (as 5 "normais" + pot_player_bones,
 * tratada à parte por causa da coluna extra `balance`) — mesma forma:
 * pra cada linha da conta antiga, existe uma linha da conta nova com a
 * mesma chave secundária (guild_id / período+data / message_id /
 * pool_type+pool_id)? Se não: migra (UPDATE). Se sim: DESCARTA (DELETE)
 * — nunca deixa órfã, nunca mescla (só `pot_player_bones` soma o
 * `balance` descartado no resumo, pra nunca ser silencioso sobre Ossos
 * perdidos). `dryRun:true` só calcula, sem escrever — reaproveitado
 * pela prévia; a execução chama de novo com `dryRun:false` (nunca
 * reaproveita o resultado da prévia, dados podem ter mudado entre uma
 * interação e outra).
 */
function processCompositeTable(table, matchCols, oldId, newId, { dryRun = false, balanceCol = null } = {}) {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(oldId);
    const whereMatch = matchCols.map((c) => `${c} = ?`).join(' AND ');
    let migrated = 0;
    let discarded = 0;
    let discardedBalance = 0;
    for (const row of rows) {
        const exists = db.prepare(`SELECT 1 FROM ${table} WHERE ${whereMatch} AND user_id = ?`)
            .get(...matchCols.map((c) => row[c]), newId);
        if (exists) {
            discarded++;
            if (balanceCol) discardedBalance += row[balanceCol] || 0;
            if (!dryRun) {
                db.prepare(`DELETE FROM ${table} WHERE ${whereMatch} AND user_id = ?`)
                    .run(...matchCols.map((c) => row[c]), oldId);
            }
        } else {
            migrated++;
            if (!dryRun) {
                db.prepare(`UPDATE ${table} SET user_id = ? WHERE ${whereMatch} AND user_id = ?`)
                    .run(newId, ...matchCols.map((c) => row[c]), oldId);
            }
        }
    }
    return { migrated, discarded, discardedBalance };
}

const COMPOSITE_TABLES = [
    { table: 'reputation', matchCols: ['guild_id'], label: 'reputation' },
    { table: 'staff_presence_sessions', matchCols: ['guild_id'], label: 'staff_presence_sessions' },
    { table: 'staff_analytics', matchCols: ['guild_id', 'period', 'date'], label: 'staff_analytics' },
    { table: 'event_teleport_uses', matchCols: ['message_id'], label: 'event_teleport_uses' },
    { table: 'image_inventory', matchCols: ['pool_type', 'pool_id'], label: 'image_inventory' },
];

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
        // inicial de `users` pra conta nova e permite mandar a DM de aviso
        // depois.
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
            const r = processCompositeTable(table, matchCols, oldId, novaConta, { dryRun: true });
            return { label, ...r };
        });
        const bonesPreview = processCompositeTable('pot_player_bones', ['guild_id'], oldId, novaConta, { dryRun: true, balanceCol: 'balance' });

        const simpleLines = Object.entries(simpleCounts)
            .filter(([, c]) => c > 0)
            .map(([table, c]) => `- \`${table}\`: ${c}`)
            .join('\n') || '_Nenhum registro nas tabelas simples._';

        const compositeLines = compositePreview
            .filter((c) => c.migrated > 0 || c.discarded > 0)
            .map((c) => `- \`${c.label}\`: ${c.migrated} migrarão${c.discarded > 0 ? `, ${c.discarded} serão DESCARTADAS (conflito com a conta nova)` : ''}`)
            .join('\n') || '_Nenhum registro nas tabelas de conflito._';

        const bonesLine = (bonesPreview.migrated > 0 || bonesPreview.discarded > 0)
            ? `- \`pot_player_bones\`: ${bonesPreview.migrated} servidor(es) migram${bonesPreview.discarded > 0 ? `, ${bonesPreview.discarded} servidor(es) serão DESCARTADOS (**${bonesPreview.discardedBalance} Ossos perdidos** — conflito com a conta nova)` : ''}`
            : '_Sem saldo de Ossos em nenhum servidor._';

        const identityLines = [
            `**AGID:** \`${agid}\`${link.player_name ? ` (${link.player_name})` : ''}`,
            `**Conta antiga:** \`${oldId}\` — será APAGADA por completo no final`,
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
                `${EMOJIS.messagesquarewarning || 'ℹ️'} \`player_links\` e \`player_premium\` também migram (identidade + assinatura, se houver). Depois de migrar tudo, a conta ANTIGA é apagada por completo do banco (nada fica salvo sob esse ID) e recebe uma DM avisando que os dados foram movidos pra conta nova.`,
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
                    composite[label] = processCompositeTable(table, matchCols, oldId, novaConta, { dryRun: false });
                }

                const bones = processCompositeTable('pot_player_bones', ['guild_id'], oldId, novaConta, { dryRun: false, balanceCol: 'balance' });

                // Singletons globais — já validados sem conflito antes de
                // chegar aqui.
                db.prepare(`UPDATE player_links SET user_id = ? WHERE user_id = ?`).run(novaConta, oldId);
                const premiumMigrated = db.prepare(`UPDATE player_premium SET user_id = ? WHERE user_id = ?`).run(novaConta, oldId).changes;

                // Verificação EXPLÍCITA (pedido do dono, 2026-08-15: "só
                // vamos apagar os dados antgos quando tudo estiver
                // registrado na conta nova") — a transação já garante isso
                // pela atomicidade (se algo falhar, tudo reverte, nada é
                // apagado), mas essa checagem torna a garantia explícita no
                // código em vez de só implícita: confirma de verdade que
                // player_links do AGID aponta pra conta nova ANTES de
                // apagar qualquer coisa da conta antiga. Se isso falhar por
                // qualquer motivo, lança erro — a transação inteira reverte
                // (nada é apagado, incluindo a conta antiga) e o erro
                // aparece na resposta e no log detalhado do canal.
                const verifyRow = db.prepare(`SELECT user_id FROM player_links WHERE alderon_id = ?`).get(agid);
                if (!verifyRow || verifyRow.user_id !== novaConta) {
                    throw new Error(`Verificação falhou: player_links do AGID ${agid} não confirma a conta nova depois da migração (esperado ${novaConta}, encontrado ${verifyRow?.user_id || 'nenhum'}) — nada foi apagado.`);
                }

                // SÓ AGORA, com a verificação acima confirmando que tudo
                // está registrado na conta nova, a conta antiga é apagada
                // por completo — nada mais aponta pra ela a essa altura
                // (tudo que era dela já migrou ou foi descartado acima).
                // Economiza espaço em banco em vez de deixar um cache morto
                // de username/avatar pra sempre (pedido do dono: "não deve
                // manter nada salvo em banco... apagar tudo sobre a conta
                // antiga, até o registro").
                const oldUserDeleted = db.prepare(`DELETE FROM users WHERE user_id = ?`).run(oldId).changes;

                return { simple, composite, bones, premiumMigrated, oldUserDeleted };
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

            // Aviso por DM na conta ANTIGA (pedido do dono: "o usuário
            // deve ser informado na conta antiga... o que aconteceu na
            // conta antiga fica apenas como registro nos discord") —
            // melhor esforço, nunca falha a transferência (já concluída
            // no banco) se a DM não puder ser enviada.
            let dmSent = false;
            try {
                const oldUser = await client.users.fetch(oldId).catch(() => null);
                if (oldUser) {
                    await oldUser.send([
                        `${EMOJIS.messagesquarewarning || 'ℹ️'} **Seu registro no Titan's Pass foi transferido**`,
                        `Seu Alderon ID \`${agid}\`${link.player_name ? ` (${link.player_name})` : ''} e todos os seus dados (perfil, moedas, reputação, histórico, Player Premium) foram migrados pra outra conta do Discord (\`${novaConta}\`).`,
                        'Esta conta não tem mais nenhum dado salvo sobre esse registro. Se você não pediu essa transferência, entre em contato com a equipe do servidor.',
                    ].join('\n'));
                    dmSent = true;
                }
            } catch (dmError) {
                console.warn('⚠️ [TRANSFER-USER-DATA] Não foi possível enviar DM de aviso pra conta antiga:', dmError.message);
            }

            const resultSimpleLines = Object.entries(result.simple)
                .filter(([, c]) => c > 0)
                .map(([table, c]) => `- \`${table}\`: ${c}`)
                .join('\n') || '_Nenhum registro migrado nas tabelas simples._';

            const resultCompositeLines = Object.entries(result.composite)
                .filter(([, c]) => c.migrated > 0 || c.discarded > 0)
                .map(([label, c]) => `- \`${label}\`: ${c.migrated} migrado(s)${c.discarded > 0 ? `, ${c.discarded} descartado(s) por conflito` : ''}`)
                .join('\n') || '_Nenhum registro nas tabelas de conflito._';

            const resultBonesLine = (result.bones.migrated > 0 || result.bones.discarded > 0)
                ? `${result.bones.migrated} servidor(es) migrado(s)${result.bones.discarded > 0 ? `, ${result.bones.discarded} servidor(es) descartado(s) (**${result.bones.discardedBalance} Ossos perdidos** por conflito)` : ''}`
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
            successBuilder.text(`**Conta antiga:** apagada por completo do banco. **DM de aviso:** ${dmSent ? 'enviada' : 'não foi possível enviar (DM fechada ou conta inacessível)'}.`);
            successBuilder.separator();
            successBuilder.text(`${EMOJIS.messagesquarewarning || 'ℹ️'} Referências deste jogador como MODERADOR/STAFF em ações sobre outras pessoas foram preservadas (histórico de auditoria de terceiros, continua com o ID antigo — não afeta nada, essas colunas não têm FK). Cargos/apelido do Discord na conta nova continuam responsabilidade de cada servidor.`);
            successBuilder.footer('Bot de Developer', `UUID: ${transferUuid.slice(0, 8)} — ${Date.now() - startTime}ms`);

            const { components, flags } = successBuilder.build();
            await interaction.editReply({ components, flags: [flags] });

            console.log(`📊 [TRANSFER-USER-DATA] ${user.tag} transferiu AGID ${agid} de ${oldId} para ${novaConta}`);

            // Log detalhado no canal fixo de sistema (pedido do dono,
            // 2026-08-15: "só que ele envie uma log detalhada do processo
            // no meu canal") — registro permanente e auditável, com o
            // mesmo detalhamento da resposta ao dono + a confirmação
            // explícita da verificação que rodou antes do apagamento.
            await sendSystemLog(client, (builder) => {
                builder.title('🔄 Transferência de conta — jogador', 2);
                builder.text([
                    `**Executado por:** <@${user.id}> (\`${user.tag}\`)`,
                    `**AGID:** \`${agid}\`${link.player_name ? ` (${link.player_name})` : ''}`,
                    `**Conta antiga:** \`${oldId}\` → **Conta nova:** \`${novaConta}\`${fetchedUser ? ` (${fetchedUser.tag || fetchedUser.username})` : ''}`,
                ].join('\n'));
                builder.separator();
                builder.text(`**Migração simples:**\n${resultSimpleLines}`);
                builder.separator();
                builder.text(`**Migração com conflito:**\n${resultCompositeLines}`);
                builder.separator();
                builder.text(`**Ossos:** ${resultBonesLine}`);
                builder.separator();
                builder.text(`**Player Premium:** ${result.premiumMigrated > 0 ? 'migrado' : 'não tinha (Free)'}`);
                builder.separator();
                builder.text([
                    `${EMOJIS.shieldcheck || '✅'} Verificação: \`player_links\` confirmado na conta nova ANTES do apagamento da conta antiga.`,
                    `**Conta antiga:** apagada por completo do banco (linha de \`users\` incluída).`,
                    `**DM de aviso pra conta antiga:** ${dmSent ? 'enviada' : 'não foi possível enviar'}.`,
                ].join('\n'));
                builder.footer('Bot de Developer', `UUID: ${transferUuid} — ${Date.now() - startTime}ms`);
            });
        } catch (error) {
            console.error('❌ Erro no transfer-user-data:', error);

            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');

            // Log detalhado do ERRO também vai pro canal de sistema — a
            // transação inteira reverteu (ver docblock), então nada foi
            // alterado, mas o dono precisa saber que a tentativa aconteceu
            // e falhou.
            await sendSystemLog(client, (builder) => {
                builder.title('❌ Transferência de conta — FALHOU', 2);
                builder.text([
                    `**Executado por:** <@${user.id}> (\`${user.tag}\`)`,
                    `**AGID:** \`${agid}\``,
                    `**Conta antiga:** \`${oldId}\` → **Conta nova (pretendida):** \`${novaConta}\``,
                    `**Erro:** \`${error.message?.slice(0, 300) || 'Desconhecido'}\``,
                    `${EMOJIS.messagesquarewarning || 'ℹ️'} A transação inteira reverteu — nenhum dado foi alterado, a conta antiga NÃO foi apagada.`,
                ].join('\n'));
                builder.footer('Bot de Developer', `${Date.now() - startTime}ms`);
            });

            db.logActivity(null, user.id, 'error', null, { command: 'transfer-user-data', error: error.message });

            const errorBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`# ${EMOJIS.circlealert || '❌'} ERRO NA TRANSFERÊNCIA\n\`${error.message?.slice(0, 150) || 'Desconhecido'}\``)
                .footer('Bot de Developer', 'A transação inteira foi revertida (nada foi alterado) — verifique o erro e tente de novo.');
            const { components, flags } = errorBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
        }
    },
};
