// src/systems/pot/gameShopSystem.js
/**
 * Loja de Jogo — reforma pedida pelo dono, 2026-08-12: "A loja em jogo deve
 * permitir ser configuravel growths, skipshed, quest de jogo, e os growths
 * podem configurados para ser limitados a certos dinossauros." Diferente da
 * Loja de Personalização (Caçadas, global, só o dono administra): esta usa
 * Ossos (Bones) e cada SERVIDOR configura seu próprio catálogo (preço,
 * liga/desliga, restrição de espécie por etapa de Growth) — ver
 * ConfigSystem.memberIsGuildAdmin/rota `/lojajogo/:guildId` no dashboard.
 *
 * Catálogo fixo (6 itens, sem CRUD de item novo — só preço/liga/restrição
 * são configuráveis): 4 etapas de Growth (cada uma com sua própria lista de
 * espécies permitidas, pedido explícito do dono — lista vazia = todas
 * liberadas), Skipshed e Missão (GiveQuest, precisa do nome exato da missão
 * configurada em jogo).
 *
 * Config por servidor vive na tabela `settings` já existente (mesmo padrão
 * de PoTConfigSystem.setServerConfig/getServerConfig), chave
 * 'pot_game_shop_config' — sem tabela nova, JSON pequeno por guild.
 *
 * COMPRA vs USO — reforma 2026-08-12 (pedido do dono: "A compra dos itens
 * deve ficar no inventario do jogador, itens usaveis em jogo devem ter
 * botão para usar no inventário deles pelo site"): comprar
 * (purchaseGameShopItem) só debita Ossos e grava uma linha em
 * game_shop_inventory — NENHUM RCON dispara na hora da compra (antes desta
 * reforma disparava direto, exigindo o jogador estar online E na espécie
 * certa NO MOMENTO DA COMPRA, o que era rígido demais). Usar
 * (useGameShopItem) é o momento em que online/espécie são checados de
 * verdade e o RCON é disparado — o jogador pode comprar a qualquer hora e
 * usar depois, quando estiver de fato no servidor. Sem RCON na compra,
 * também não existe mais "devolver Ossos se o RCON falhar" nesse momento —
 * a moeda já foi gasta de forma definitiva na compra (vira um item de
 * inventário, não uma promessa de aplicação imediata); uma falha de RCON
 * no USO simplesmente NÃO consome o item, que continua disponível pra
 * tentar de novo mais tarde.
 */
const db = require('../../database/index');
const PlayerRegistry = require('./potPlayerRegistry');
const PremiumSystem = require('../premium/premiumSystem');

const SETTINGS_KEY = 'pot_game_shop_config';

// growthValue é o valor cru passado pro RCON `rewardgrowth` (mesma escala
// 0-1 de pot_players.dinosaur_growth). speciesRestrictable só existe nos 4
// itens de Growth — Skipshed/Missão não fazem sentido restringir por
// espécie (não alteram o dinossauro em si).
const GAME_SHOP_ITEMS = {
    growth_juvenil: { label: 'Growth: Juvenil', growthValue: 0.25, speciesRestrictable: true },
    growth_adolescente: { label: 'Growth: Adolescente', growthValue: 0.5, speciesRestrictable: true },
    growth_subadulto: { label: 'Growth: Subadulto', growthValue: 0.75, speciesRestrictable: true },
    growth_adulto: { label: 'Growth: Adulto', growthValue: 1.0, speciesRestrictable: true },
    skipshed: { label: 'Skipshed', speciesRestrictable: false },
    quest: { label: 'Missão de Marks', speciesRestrictable: false, needsMission: true },
};

// enabled:false por padrão em TODO item — nada fica comprável até o admin
// do servidor (ou o dono) ligar e definir um preço de propósito, evitando
// abrir a loja sem querer com preço zero/indefinido.
function _defaultItemConfig(key) {
    const item = GAME_SHOP_ITEMS[key];
    const base = { enabled: false, price: 0 };
    if (item.speciesRestrictable) base.species = [];
    if (item.needsMission) base.missionName = '';
    return base;
}

function _readRaw(guildId) {
    const result = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, SETTINGS_KEY);
    if (!result) return null;
    try { return JSON.parse(result.value); } catch { return null; }
}

/**
 * Config completa (todos os 6 itens, mesclada com o padrão) — chamadores
 * nunca precisam checar `undefined` por item novo adicionado depois que o
 * servidor já tinha uma config salva.
 * @param {string} guildId
 */
function getGuildShopConfig(guildId) {
    const stored = _readRaw(guildId) || {};
    const merged = {};
    for (const key of Object.keys(GAME_SHOP_ITEMS)) {
        merged[key] = { ..._defaultItemConfig(key), ...(stored[key] || {}) };
    }
    return merged;
}

/**
 * Grava a config inteira de uma vez (o painel de admin sempre reenvia o
 * formulário completo) — mesmo padrão upsert de PoTConfigSystem.setServerConfig.
 * @param {string} guildId
 * @param {object} config - shape de getGuildShopConfig()
 * @param {string} userId
 */
function setGuildShopConfig(guildId, config, userId) {
    db.prepare(`
        INSERT INTO settings (guild_id, key, value, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, key) DO UPDATE SET
            value = excluded.value,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
    `).run(guildId, SETTINGS_KEY, JSON.stringify(config), userId, Date.now());
}

function _buildRconCommand(itemKey, target, missionName) {
    const item = GAME_SHOP_ITEMS[itemKey];
    if (item.speciesRestrictable) return `rewardgrowth ${target} ${item.growthValue}`;
    if (itemKey === 'skipshed') return `SkipShed ${target}`;
    if (itemKey === 'quest') return `GiveQuest ${target} ${missionName}`;
    return null;
}

/**
 * Compra um item da Loja de Jogo — debita Ossos e grava no inventário
 * (game_shop_inventory). NÃO dispara RCON (ver useGameShopItem) — por
 * isso não exige o jogador online nem na espécie certa aqui, só que a
 * conta esteja vinculada (precisa do Alderon ID pra usar depois).
 * @param {string} guildId
 * @param {string} discordId
 * @param {string} itemKey - chave de GAME_SHOP_ITEMS
 * @returns {Promise<{ok: true, label: string, price: number} | {ok: false, error: string}>}
 */
async function purchaseGameShopItem(guildId, discordId, itemKey) {
    const item = GAME_SHOP_ITEMS[itemKey];
    if (!item) return { ok: false, error: 'Item inválido.' };

    if (!PremiumSystem.getGuildLimits(guildId).genericRconEnabled) {
        return { ok: false, error: 'Este servidor não está no plano Caçador — a Loja de Jogo depende do mesmo RCON liberado só nesse tier.' };
    }

    const config = getGuildShopConfig(guildId);
    const itemConfig = config[itemKey];
    if (!itemConfig.enabled) return { ok: false, error: 'Este item não está à venda neste servidor.' };
    if (!Number.isInteger(itemConfig.price) || itemConfig.price <= 0) return { ok: false, error: 'Este item ainda não tem um preço configurado.' };
    if (item.needsMission && !itemConfig.missionName) return { ok: false, error: 'Este item ainda não tem uma missão configurada — avise a equipe do servidor.' };

    const link = PlayerRegistry.getPlayerByDiscordId(discordId);
    if (!link) return { ok: false, error: 'Você precisa vincular sua conta com /registrar antes de comprar.' };

    if (!PlayerRegistry.spendBones(discordId, guildId, itemConfig.price)) {
        return { ok: false, error: 'Saldo de Ossos insuficiente.' };
    }

    try {
        db.prepare(`
            INSERT INTO game_shop_inventory (user_id, guild_id, item_key, mission_name, purchased_at, price_paid)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(discordId, guildId, itemKey, item.needsMission ? itemConfig.missionName : null, Date.now(), itemConfig.price);
    } catch (error) {
        // Revisão adversarial (2026-08-12) encontrou que o retorno de
        // addBones (nunca lança, só devolve boolean — ver
        // potPlayerRegistry.js) nunca era checado aqui: se o próprio
        // reembolso falhasse (mesma condição transitória que já derrubou
        // o INSERT acima), o jogador perdia Ossos de verdade enquanto a
        // mensagem ainda dizia "foram devolvidos". Log CRÍTICO agora
        // distingue os dois casos pra dar rastro de conciliação manual
        // (dono/DEVELOPER_ID) quando o reembolso automático também falha.
        const refunded = PlayerRegistry.addBones(discordId, guildId, itemConfig.price);
        if (!refunded) {
            console.error(`🚨 [GameShop] FALHA CRÍTICA: compra e reembolso falharam pra ${discordId} (guild ${guildId}, item ${itemKey}, ${itemConfig.price} Ossos) — requer conciliação manual.`, error);
            return { ok: false, error: 'Erro ao registrar a compra e ao devolver seus Ossos — avise a equipe, isso precisa de correção manual.' };
        }
        console.error('❌ [GameShop] Erro ao registrar compra (Ossos devolvidos):', error);
        return { ok: false, error: 'Erro ao registrar a compra — seus Ossos foram devolvidos.' };
    }

    db.logActivity(guildId, discordId, 'game_shop_purchase', null, {
        itemKey, price: itemConfig.price,
    });

    return { ok: true, label: item.label, price: itemConfig.price };
}

/**
 * Preço da taxa de transferência de um item pra OUTRO servidor (pedido do
 * dono, 2026-08-16, CORRIGINDO o design original desta mesma revisão: "se
 * não precisássemos manter o valor de 50%... eu cobraria 100% do preço
 * atual do item no servidor de destino... transferir custaria exatamente
 * o mesmo que comprar aquele item do zero lá" — fecha por completo a
 * brecha de comprar barato num servidor generoso e usar caro em outro,
 * já que não sobra NENHUM desconto por ter comprado em outro lugar).
 * Preço de referência é sempre o do catálogo de DESTINO (preço cheio, não
 * metade) — só cai pro price_paid original (preço de ORIGEM) se o
 * destino nunca configurou um preço pra esse item_key (sem outra
 * referência de valor disponível pra cobrar).
 * @param {string} itemKey
 * @param {number} pricePaid - preço original pago na compra (fallback)
 * @param {string} destGuildId
 * @returns {number}
 */
function _resolveTransferFee(itemKey, pricePaid, destGuildId) {
    const destConfig = getGuildShopConfig(destGuildId)[itemKey];
    const destPrice = Number.isInteger(destConfig?.price) && destConfig.price > 0 ? destConfig.price : null;
    return destPrice ?? pricePaid;
}

/**
 * Itens comprados e ainda NÃO usados — o "inventário" mostrado no site
 * (botão "Usar" por linha, ver useGameShopItem). Cada linha já vem com o
 * label/metadados do catálogo embutidos, pra quem renderiza não precisar
 * cruzar com GAME_SHOP_ITEMS na mão. `transferable` (2026-08-16) já vem
 * calculado aqui pro template decidir mostrar o botão ou não — ver
 * transferGameShopItem pra regra completa (por que Missão nunca
 * transfere e por que price_paid=0 bloqueia). A TAXA em si não entra
 * aqui: depende de QUAL servidor de destino for escolhido (cada um pode
 * ter um preço diferente pro mesmo item) — ver _resolveTransferFee,
 * calculado por destino em dashboard.js.
 * @param {string} userId
 * @param {string} [guildId] - opcional, filtra só um servidor
 * @returns {Array<{id: number, guildId: string, itemKey: string, label: string, missionName: string|null, speciesRestrictable: boolean, purchasedAt: number, pricePaid: number, transferable: boolean}>}
 */
function getInventory(userId, guildId) {
    if (!userId) return [];
    const rows = guildId
        ? db.prepare(`SELECT * FROM game_shop_inventory WHERE user_id = ? AND guild_id = ? AND used_at IS NULL ORDER BY purchased_at ASC`).all(userId, guildId)
        : db.prepare(`SELECT * FROM game_shop_inventory WHERE user_id = ? AND used_at IS NULL ORDER BY purchased_at ASC`).all(userId);

    return rows.map(row => {
        const item = GAME_SHOP_ITEMS[row.item_key];
        const pricePaid = Number.isInteger(row.price_paid) ? row.price_paid : 0;
        return {
            id: row.id,
            guildId: row.guild_id,
            itemKey: row.item_key,
            label: item ? item.label : row.item_key,
            missionName: row.mission_name,
            speciesRestrictable: !!item?.speciesRestrictable,
            purchasedAt: row.purchased_at,
            pricePaid,
            transferable: pricePaid > 0 && !item?.needsMission,
        };
    });
}

// Nunca é um Date.now() de verdade (sempre positivo, na casa dos
// trilhões) — usado como marcador temporário de "reivindicado, RCON em
// andamento" em used_at, ver useGameShopItem abaixo.
const CLAIM_SENTINEL = -1;

/**
 * Usa (consome) um item já comprado — checa online/espécie AGORA (a
 * checagem que antes rodava na compra), dispara o RCON de verdade, e só
 * marca como usado (used_at) se o RCON confirmar sucesso. Falha de RCON
 * NÃO consome o item — continua no inventário pra tentar de novo.
 *
 * REIVINDICAÇÃO ATÔMICA (corrige uma corrida real encontrada em revisão
 * adversarial, 2026-08-12): o RCON é uma chamada de rede de verdade
 * (potIntegration.executeCommand → socket RCON), então o `await` cede o
 * event loop por um tempo real — um duplo-clique em "Usar" (ou duas
 * abas) podia mandar duas requisições que liam `used_at IS NULL` ANTES
 * de qualquer uma escrever, as duas passavam por todas as checagens, as
 * duas disparavam o MESMO comando RCON (growth/skipshed/quest aplicado
 * 2x pra uma compra só), e só depois as duas marcavam o item como usado
 * (sem erro, UPDATE é idempotente — o bug ficava invisível no banco).
 * Fix: um UPDATE atômico com `WHERE used_at IS NULL` reivindica a linha
 * ANTES de qualquer checagem/RCON — só quem de fato mudou uma linha
 * (`changes > 0`) segue em frente; qualquer segunda tentativa concorrente
 * já encontra `used_at` preenchido (com o sentinel) e para na hora. Todo
 * caminho de saída sem sucesso (checagem falhou, RCON falhou, exceção)
 * PRECISA devolver `used_at` pra NULL — o `finally` faz isso sozinho,
 * baseado na flag `succeeded`, então nenhum branch de erro pode esquecer.
 * @param {number} inventoryId
 * @param {string} discordId - dono do item, sempre reconferido (nunca
 *   confia em quem monta a chamada)
 * @returns {Promise<{ok: true, label: string} | {ok: false, error: string}>}
 */
async function useGameShopItem(inventoryId, discordId) {
    const row = db.prepare(`SELECT * FROM game_shop_inventory WHERE id = ? AND user_id = ?`).get(inventoryId, discordId);
    if (!row) return { ok: false, error: 'Item não encontrado no seu inventário.' };
    if (row.used_at !== null) return { ok: false, error: 'Este item já foi usado.' };

    const item = GAME_SHOP_ITEMS[row.item_key];
    if (!item) return { ok: false, error: 'Item inválido.' };

    const claim = db.prepare(`UPDATE game_shop_inventory SET used_at = ? WHERE id = ? AND user_id = ? AND used_at IS NULL`)
        .run(CLAIM_SENTINEL, inventoryId, discordId);
    if (claim.changes === 0) {
        return { ok: false, error: 'Este item já foi usado (ou já está sendo usado agora em outra aba).' };
    }

    let succeeded = false;
    try {
        // Reconfere o tier AGORA, não só na compra — mesmo critério já
        // usado pro filtro de chat (settings salvas continuam, só param
        // de aplicar se o servidor perder o Caçador; ver PREMIUM.txt).
        // Sem isso, um item comprado enquanto o servidor era Caçador
        // continuaria disparando RCON depois de uma queda de tier. O
        // item NÃO é perdido — só fica parado no inventário (reivindicação
        // liberada pelo finally) até o servidor voltar a ter o plano.
        if (!PremiumSystem.getGuildLimits(row.guild_id).genericRconEnabled) {
            return { ok: false, error: 'Este servidor não está mais no plano Caçador — o item continua no seu inventário, mas só pode ser usado enquanto o servidor tiver o plano ativo.' };
        }

        const link = PlayerRegistry.getPlayerByDiscordId(discordId);
        if (!link) return { ok: false, error: 'Você precisa estar vinculado com /registrar pra usar este item.' };

        const onlinePlayer = PlayerRegistry.getOnlinePotPlayer(row.guild_id, link.alderon_id);
        if (!onlinePlayer) return { ok: false, error: 'Você precisa estar online no servidor de jogo pra usar este item.' };

        if (item.speciesRestrictable) {
            if (!onlinePlayer.dinosaur_active || !onlinePlayer.dinosaur_type) {
                return { ok: false, error: 'Você precisa estar dentro de um dinossauro (fora da tela de seleção de personagem) pra usar Growth.' };
            }
            // Restrição de espécie é conferida com a config ATUAL do
            // servidor (não a de quando comprou) — é uma regra de
            // balanceamento sobre qual dinossauro pode receber o bônus
            // agora, não uma promessa travada no momento da compra.
            const config = getGuildShopConfig(row.guild_id);
            const allowedSpecies = Array.isArray(config[row.item_key]?.species) ? config[row.item_key].species : [];
            if (allowedSpecies.length > 0) {
                const isAllowed = allowedSpecies.some(s => s.toLowerCase() === onlinePlayer.dinosaur_type.toLowerCase());
                if (!isAllowed) return { ok: false, error: `${item.label} não está liberado pra ${onlinePlayer.dinosaur_type} neste servidor.` };
            }
        }

        const command = _buildRconCommand(row.item_key, link.alderon_id, row.mission_name);
        const PoTConfigSystem = require('./potConfigSystem');
        const rconResult = await PoTConfigSystem.executeRconCommand(row.guild_id, command, { actor: `<@${discordId}>`, source: `Loja de Jogo (${item.label})` });

        if (!rconResult.success) {
            return { ok: false, error: `Não foi possível aplicar "${item.label}" no jogo (${rconResult.error || 'erro desconhecido'}). O item continua no seu inventário — tente de novo.` };
        }

        db.prepare(`UPDATE game_shop_inventory SET used_at = ? WHERE id = ?`).run(Date.now(), inventoryId);
        succeeded = true;
        db.logActivity(row.guild_id, discordId, 'game_shop_use', null, { itemKey: row.item_key, command });

        return { ok: true, label: item.label };
    } finally {
        if (!succeeded) {
            db.prepare(`UPDATE game_shop_inventory SET used_at = NULL WHERE id = ?`).run(inventoryId);
        }
    }
}

/**
 * Transfere um item já comprado pra OUTRO servidor, cobrando o preço
 * CHEIO do catálogo de destino em Ossos (pedido do dono, 2026-08-16 —
 * CORRIGE o design inicial desta mesma revisão, que cobrava só 50% do
 * preço de ORIGEM: isso permitia comprar barato num servidor generoso e
 * usar caro em outro pagando quase nada. Cobrar o preço cheio de DESTINO
 * fecha essa brecha por completo — transferir nunca sai mais barato que
 * comprar do zero lá, vira só uma ferramenta de conveniência/caso
 * especial, não um desconto). Ver _resolveTransferFee pra regra completa
 * (inclusive o fallback pro preço de origem quando o destino nunca
 * configurou preço pra esse item). A trava "só usa onde comprou" É o
 * próprio game_shop_inventory.guild_id — useGameShopItem sempre dispara
 * RCON contra row.guild_id, nunca outro — então transferir é simplesmente
 * TROCAR esse guild_id depois de cobrar a taxa; nenhuma checagem extra de
 * "servidor certo" é necessária em useGameShopItem por causa disso.
 *
 * Item de Missão (item_key='quest') NUNCA pode ser transferido: o
 * mission_name congelado na compra é uma string configurada NAQUELE
 * servidor especificamente (nome exato de uma missão do PoT local) —
 * não tem garantia de significar nada no servidor de destino.
 *
 * Reivindicação atômica sobre `used_at`, mesmo padrão/mesmo motivo de
 * useGameShopItem (ver comentário lá) — evita um "Usar" e um
 * "Transferir" concorrentes na mesma linha.
 * @param {number} inventoryId
 * @param {string} discordId - dono do item, sempre reconferido
 * @param {string} destGuildId - servidor de destino
 * @returns {Promise<{ok: true, label: string, fee: number} | {ok: false, error: string}>}
 */
async function transferGameShopItem(inventoryId, discordId, destGuildId) {
    const row = db.prepare(`SELECT * FROM game_shop_inventory WHERE id = ? AND user_id = ?`).get(inventoryId, discordId);
    if (!row) return { ok: false, error: 'Item não encontrado no seu inventário.' };
    if (row.used_at !== null) return { ok: false, error: 'Este item já foi usado.' };
    if (row.guild_id === destGuildId) return { ok: false, error: 'Este item já está neste servidor.' };

    const item = GAME_SHOP_ITEMS[row.item_key];
    if (!item) return { ok: false, error: 'Item inválido.' };
    if (item.needsMission) return { ok: false, error: 'Itens de Missão são específicos do servidor onde foram comprados e não podem ser transferidos.' };
    if (!Number.isInteger(row.price_paid) || row.price_paid <= 0) {
        return { ok: false, error: 'Este item foi comprado antes do sistema de transferência existir, então não há como calcular a taxa — fale com a equipe.' };
    }

    const fee = _resolveTransferFee(row.item_key, row.price_paid, destGuildId);

    const claim = db.prepare(`UPDATE game_shop_inventory SET used_at = ? WHERE id = ? AND user_id = ? AND used_at IS NULL`)
        .run(CLAIM_SENTINEL, inventoryId, discordId);
    if (claim.changes === 0) {
        return { ok: false, error: 'Este item já foi usado (ou já está em outra operação agora).' };
    }

    let succeeded = false;
    try {
        if (!PlayerRegistry.spendBones(discordId, destGuildId, fee)) {
            return { ok: false, error: `Saldo de Ossos insuficiente no servidor de destino — a transferência custa ${fee} Ossos lá.` };
        }

        db.prepare(`UPDATE game_shop_inventory SET guild_id = ?, used_at = NULL WHERE id = ?`).run(destGuildId, inventoryId);
        succeeded = true;

        db.logActivity(destGuildId, discordId, 'game_shop_transfer', null, {
            itemKey: row.item_key, fromGuildId: row.guild_id, toGuildId: destGuildId, fee,
        });

        return { ok: true, label: item.label, fee };
    } finally {
        if (!succeeded) {
            db.prepare(`UPDATE game_shop_inventory SET used_at = NULL WHERE id = ?`).run(inventoryId);
        }
    }
}

module.exports = {
    GAME_SHOP_ITEMS,
    getGuildShopConfig,
    setGuildShopConfig,
    purchaseGameShopItem,
    getInventory,
    useGameShopItem,
    transferGameShopItem,
    _resolveTransferFee,
};
