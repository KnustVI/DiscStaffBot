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
            INSERT INTO game_shop_inventory (user_id, guild_id, item_key, mission_name, purchased_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(discordId, guildId, itemKey, item.needsMission ? itemConfig.missionName : null, Date.now());
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
 * Itens comprados e ainda NÃO usados — o "inventário" mostrado no site
 * (botão "Usar" por linha, ver useGameShopItem). Cada linha já vem com o
 * label/metadados do catálogo embutidos, pra quem renderiza não precisar
 * cruzar com GAME_SHOP_ITEMS na mão.
 * @param {string} userId
 * @param {string} [guildId] - opcional, filtra só um servidor
 * @returns {Array<{id: number, guildId: string, itemKey: string, label: string, missionName: string|null, speciesRestrictable: boolean, purchasedAt: number}>}
 */
function getInventory(userId, guildId) {
    if (!userId) return [];
    const rows = guildId
        ? db.prepare(`SELECT * FROM game_shop_inventory WHERE user_id = ? AND guild_id = ? AND used_at IS NULL ORDER BY purchased_at ASC`).all(userId, guildId)
        : db.prepare(`SELECT * FROM game_shop_inventory WHERE user_id = ? AND used_at IS NULL ORDER BY purchased_at ASC`).all(userId);

    return rows.map(row => {
        // shop_item_id preenchido = compra do sistema novo (item
        // customizado) — resolve via getShopItemById, que NUNCA filtra
        // deleted_at, então um item já excluído da loja continua
        // aparecendo aqui normalmente pra quem comprou (pedido do dono).
        if (row.shop_item_id) {
            const item = getShopItemById(row.shop_item_id);
            return {
                id: row.id,
                guildId: row.guild_id,
                isCustom: true,
                itemId: row.shop_item_id,
                label: item ? item.name : 'Item removido',
                description: item ? item.description : null,
                imageMessageId: item ? item.image_message_id : null,
                actionType: item ? item.action_type : null,
                speciesRestrictable: !!(item && item.species && item.species.length > 0),
                purchasedAt: row.purchased_at,
            };
        }
        const item = GAME_SHOP_ITEMS[row.item_key];
        return {
            id: row.id,
            guildId: row.guild_id,
            isCustom: false,
            itemKey: row.item_key,
            label: item ? item.label : row.item_key,
            missionName: row.mission_name,
            speciesRestrictable: !!item?.speciesRestrictable,
            purchasedAt: row.purchased_at,
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

    // shop_item_id preenchido = item do sistema novo (customizado);
    // ausente = catálogo legado (GAME_SHOP_ITEMS) — ver docblock da
    // seção "ITENS CUSTOMIZADOS" abaixo. getShopItemById NUNCA filtra
    // deleted_at: um item já excluído da loja continua usável aqui.
    const isCustom = !!row.shop_item_id;
    const item = isCustom ? getShopItemById(row.shop_item_id) : GAME_SHOP_ITEMS[row.item_key];
    if (!item) return { ok: false, error: 'Item inválido.' };
    const itemLabel = isCustom ? item.name : item.label;

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

        let command;
        if (isCustom) {
            // Restrição de espécie vale pros 3 tipos de ação agora (não só
            // growth, diferente do catálogo legado abaixo) — só exige
            // "dentro de um dinossauro" quando dá pra checar espécie (item
            // restrito, precisa saber a espécie atual) ou quando a própria
            // ação exige (growth sempre precisa, cresce o dinossauro atual).
            const needsDinosaur = item.action_type === 'growth' || (item.species && item.species.length > 0);
            if (needsDinosaur && (!onlinePlayer.dinosaur_active || !onlinePlayer.dinosaur_type)) {
                return { ok: false, error: 'Você precisa estar dentro de um dinossauro (fora da tela de seleção de personagem) pra usar este item.' };
            }
            if (item.species && item.species.length > 0) {
                const isAllowed = item.species.some(s => s.toLowerCase() === onlinePlayer.dinosaur_type.toLowerCase());
                if (!isAllowed) return { ok: false, error: `${item.name} não está liberado pra ${onlinePlayer.dinosaur_type} neste servidor.` };
            }

            // Verificação de mapa pro item de teleporte (pedido do dono,
            // 2026-08-18: "na configuração do item de teleporte nós pedimos
            // mapa pois as coordenadas mudam de acordo com o mapa, então
            // preciso que revise se existe a verificação do jogador estar no
            // mapa certo pra usar o tp"). ANTES desta revisão, `map` nunca
            // era lido aqui — ficava guardado só como anotação, o admin
            // configurava mas nada impedia usar num mapa errado e desperdiçar
            // o item numa coordenada sem sentido. onlinePlayer.current_map
            // vem de pot_players (preenchido oportunisticamente por
            // upsertPlayerFromEvent sempre que um webhook trouxer MapName/Map
            // — ver potPlayerRegistry.js), então pode ainda ser null se
            // nenhum evento com esse campo chegou nesta sessão. Bloqueia só
            // quando o mapa É CONHECIDO e diverge — deixa passar quando é
            // desconhecido, pra não travar o item inteiro por uma lacuna de
            // dado em vez de aplicar no mapa errado por engano (mesma
            // postura de "confia no jogo pra validar de verdade" já usada
            // pro saldo de Marks, ver currencySystem.js).
            if (item.action_type === 'teleport' && item.actionConfig?.map && onlinePlayer.current_map
                && onlinePlayer.current_map.toLowerCase() !== item.actionConfig.map.toLowerCase()) {
                return { ok: false, error: `Este item só funciona no mapa ${item.actionConfig.map} — você está em ${onlinePlayer.current_map} agora. O item continua no seu inventário, tente de novo quando estiver no mapa certo.` };
            }

            // Alvo pelo NOME em jogo pro teleporte (não Alderon ID) — ver
            // _buildRconCommandForCustomItem.
            const targetName = onlinePlayer.player_name || link.player_name;
            command = _buildRconCommandForCustomItem(item, link.alderon_id, targetName);
        } else {
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
            command = _buildRconCommand(row.item_key, link.alderon_id, row.mission_name);
        }

        const PoTConfigSystem = require('./potConfigSystem');
        const rconResult = await PoTConfigSystem.executeRconCommand(row.guild_id, command, { actor: `<@${discordId}>`, source: `Loja de Jogo (${itemLabel})` });

        if (!rconResult.success) {
            return { ok: false, error: `Não foi possível aplicar "${itemLabel}" no jogo (${rconResult.error || 'erro desconhecido'}). O item continua no seu inventário — tente de novo.` };
        }

        db.prepare(`UPDATE game_shop_inventory SET used_at = ? WHERE id = ?`).run(Date.now(), inventoryId);
        succeeded = true;
        db.logActivity(row.guild_id, discordId, 'game_shop_use', null, { itemKey: row.item_key, shopItemId: row.shop_item_id, command });

        return { ok: true, label: itemLabel };
    } finally {
        if (!succeeded) {
            db.prepare(`UPDATE game_shop_inventory SET used_at = NULL WHERE id = ?`).run(inventoryId);
        }
    }
}

// ==================== ITENS CUSTOMIZADOS (pedido do dono, 2026-08-16) ====================
// Substitui o catálogo fixo acima por criação livre de item, por admin de
// SERVIDOR (não só o dono do bot) — "mesma ideia da criação de emblemas e
// títulos que eu, desenvolvedor, tenho" (ver /dev/Loja,
// src/systems/pot/profileImagePool.js). GAME_SHOP_ITEMS/getGuildShopConfig/
// purchaseGameShopItem (acima) ficam intocados — viram catálogo LEGADO,
// necessário só pra resolver game_shop_inventory.shop_item_id IS NULL
// (comprado antes da migração automática, ainda não usado). GiveQuest/
// 'quest' NUNCA tem equivalente aqui (pedido explícito do dono: "remova da
// lista o givequest não vamos adicionar como item") — só sobrevive no
// catálogo legado, pra inventário antigo continuar funcionando.

const CUSTOM_ACTION_TYPES = ['growth', 'skipshed', 'teleport'];
const MIGRATED_MARKER_KEY = 'pot_game_shop_migrated';
// Só estas 5 chaves do catálogo antigo têm equivalente no sistema novo —
// 'quest' fica de fora de propósito (ver docblock acima).
const MIGRATABLE_KEYS = ['growth_juvenil', 'growth_adolescente', 'growth_subadulto', 'growth_adulto', 'skipshed'];

// Etapas de growth do item customizado (pedido do dono, 2026-08-17: "o
// growth eta com porcentagem mas coloque categorias de juvenil até adulto
// como tinhamos antes") — volta a ser uma escolha fixa entre as 4 etapas
// nomeadas do catálogo antigo, em vez de uma porcentagem livre 1-100.
// Reaproveita os MESMOS valores de GAME_SHOP_ITEMS (fonte única) em vez de
// duplicar os números 0.25/0.5/0.75/1.0 aqui.
const GROWTH_STAGE_VALUES = {
    juvenil: GAME_SHOP_ITEMS.growth_juvenil.growthValue,
    adolescente: GAME_SHOP_ITEMS.growth_adolescente.growthValue,
    subadulto: GAME_SHOP_ITEMS.growth_subadulto.growthValue,
    adulto: GAME_SHOP_ITEMS.growth_adulto.growthValue,
};

function _parseItemRow(row) {
    if (!row) return null;
    return {
        ...row,
        actionConfig: row.action_config ? JSON.parse(row.action_config) : null,
        species: row.species ? JSON.parse(row.species) : [],
        remainingStock: row.stock_limit === null ? null : Math.max(0, row.stock_limit - row.stock_sold),
    };
}

/**
 * Um item pelo id — NUNCA filtra deleted_at, de propósito: é o que deixa
 * um item excluído continuar resolvível pra quem já comprou e não usou
 * (pedido explícito do dono: "o item permanece no inventário dos
 * jogadores até ser usado").
 * @param {number} itemId
 */
function getShopItemById(itemId) {
    const row = db.prepare(`SELECT * FROM pot_game_shop_items WHERE id = ?`).get(itemId);
    return _parseItemRow(row);
}

/**
 * Lista de itens de um servidor — sempre exclui excluídos (deleted_at).
 * publicOnly:true (catálogo de compra, ver GET /loja) também exige
 * is_public=1 e coming_soon=0; false (default, visão de admin em
 * /lojajogo/:guildID) mostra tudo que não foi excluído, privado/em breve
 * incluídos.
 * @param {string} guildId
 * @param {{publicOnly?: boolean}} [opts]
 */
function listShopItems(guildId, { publicOnly = false } = {}) {
    const sql = publicOnly
        ? `SELECT * FROM pot_game_shop_items WHERE guild_id = ? AND deleted_at IS NULL AND is_public = 1 AND coming_soon = 0 ORDER BY created_at DESC`
        : `SELECT * FROM pot_game_shop_items WHERE guild_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`;
    return db.prepare(sql).all(guildId).map(_parseItemRow);
}

/**
 * Marcador de migração já rodada pra este servidor (settings, nunca
 * contagem de itens — ver migrateLegacyItemsForGuild).
 * @param {string} guildId
 */
function isGuildMigrated(guildId) {
    return !!db.prepare(`SELECT 1 FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, MIGRATED_MARKER_KEY);
}

/**
 * Cria um item customizado — valida tudo que o form de criação promete
 * (ver web/views/lojajogo.ejs): nome/descrição obrigatórios, action_type
 * um dos 3 suportados com a sub-config certa (growth precisa de
 * growthStage, uma das 4 etapas nomeadas do catálogo antigo — ver
 * GROWTH_STAGE_VALUES; teleport precisa de map+coords), preço inteiro
 * positivo, estoque opcional (ausente/vazio = ilimitado), espécies
 * opcionais (vazio = qualquer uma).
 * @param {string} guildId
 * @param {object} data - {name, description, imageMessageId, actionType, growthStage, map, coords, price, stockLimit, species}
 * @param {string} createdBy
 * @returns {{ok:true,id:number}|{ok:false,error:string}}
 */
function createShopItem(guildId, data, createdBy) {
    const name = (data.name || '').trim().slice(0, 100);
    const description = (data.description || '').trim().slice(0, 500);
    if (!name) return { ok: false, error: 'Nome é obrigatório.' };
    if (!description) return { ok: false, error: 'Descrição é obrigatória.' };
    if (!CUSTOM_ACTION_TYPES.includes(data.actionType)) return { ok: false, error: 'Tipo de ação inválido.' };

    const price = parseInt(data.price, 10);
    if (!Number.isInteger(price) || price <= 0) return { ok: false, error: 'Preço em Ossos precisa ser um número positivo.' };

    let stockLimit = null;
    if (data.stockLimit !== undefined && data.stockLimit !== null && String(data.stockLimit).trim() !== '') {
        stockLimit = parseInt(data.stockLimit, 10);
        if (!Number.isInteger(stockLimit) || stockLimit <= 0) return { ok: false, error: 'Quantidade disponível precisa ser um número positivo (ou em branco pra ilimitado).' };
    }

    let actionConfig = null;
    if (data.actionType === 'growth') {
        const growthValue = GROWTH_STAGE_VALUES[data.growthStage];
        if (!growthValue) return { ok: false, error: 'Escolha uma etapa de crescimento válida (Juvenil/Adolescente/Subadulto/Adulto).' };
        actionConfig = { growthValue };
    } else if (data.actionType === 'teleport') {
        const map = (data.map || '').trim().slice(0, 100);
        const coords = (data.coords || '').trim().slice(0, 200);
        if (!map || !coords) return { ok: false, error: 'Mapa e coordenadas são obrigatórios pra um item de teleporte.' };
        actionConfig = { map, coords };
    }

    const species = Array.isArray(data.species) ? data.species.filter(Boolean) : (data.species ? [data.species] : []);

    const result = db.prepare(`
        INSERT INTO pot_game_shop_items
            (guild_id, name, description, image_message_id, action_type, action_config, price, stock_limit, species, is_public, coming_soon, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `).run(
        guildId, name, description, data.imageMessageId || null, data.actionType,
        actionConfig ? JSON.stringify(actionConfig) : null, price, stockLimit,
        species.length > 0 ? JSON.stringify(species) : null, createdBy, Date.now()
    );

    return { ok: true, id: result.lastInsertRowid };
}

/**
 * Edita um item já criado (pedido do dono, 2026-08-18: "adicione o botão
 * editar item também para os itens criados"). Mesma validação de
 * createShopItem acima — mas action_type NUNCA muda depois de criado
 * (evita reconfigurar um item de teleporte pra virar growth por engano;
 * quem quiser um tipo diferente cria um item novo). Itens já comprados e
 * não usados resolvem o item por id em tempo real (getShopItemById nunca
 * tira snapshot), então uma edição aqui também vale pra quem já comprou e
 * ainda não usou — mesmo espírito de softDeleteShopItem (corrigir uma
 * coordenada errada, por exemplo, deve valer pra quem ainda não usou, não
 * só pra compras futuras).
 * @param {string} guildId
 * @param {number} itemId
 * @param {object} data - mesmo shape de createShopItem, exceto actionType
 *   (ignorado — o tipo existente em `existing.action_type` é quem manda).
 *   imageMessageId ausente/undefined mantém a imagem atual.
 * @returns {{ok:true}|{ok:false,error:string}}
 */
function updateShopItem(guildId, itemId, data) {
    const existing = db.prepare(`SELECT * FROM pot_game_shop_items WHERE id = ? AND guild_id = ? AND deleted_at IS NULL`).get(itemId, guildId);
    if (!existing) return { ok: false, error: 'Item não encontrado.' };

    const name = (data.name || '').trim().slice(0, 100);
    const description = (data.description || '').trim().slice(0, 500);
    if (!name) return { ok: false, error: 'Nome é obrigatório.' };
    if (!description) return { ok: false, error: 'Descrição é obrigatória.' };

    const price = parseInt(data.price, 10);
    if (!Number.isInteger(price) || price <= 0) return { ok: false, error: 'Preço em Ossos precisa ser um número positivo.' };

    let stockLimit = null;
    if (data.stockLimit !== undefined && data.stockLimit !== null && String(data.stockLimit).trim() !== '') {
        stockLimit = parseInt(data.stockLimit, 10);
        if (!Number.isInteger(stockLimit) || stockLimit <= 0) return { ok: false, error: 'Quantidade disponível precisa ser um número positivo (ou em branco pra ilimitado).' };
    }

    let actionConfig = null;
    if (existing.action_type === 'growth') {
        const growthValue = GROWTH_STAGE_VALUES[data.growthStage];
        if (!growthValue) return { ok: false, error: 'Escolha uma etapa de crescimento válida (Juvenil/Adolescente/Subadulto/Adulto).' };
        actionConfig = { growthValue };
    } else if (existing.action_type === 'teleport') {
        const map = (data.map || '').trim().slice(0, 100);
        const coords = (data.coords || '').trim().slice(0, 200);
        if (!map || !coords) return { ok: false, error: 'Mapa e coordenadas são obrigatórios pra um item de teleporte.' };
        actionConfig = { map, coords };
    }

    const species = Array.isArray(data.species) ? data.species.filter(Boolean) : (data.species ? [data.species] : []);
    const imageMessageId = data.imageMessageId !== undefined ? data.imageMessageId : existing.image_message_id;

    db.prepare(`
        UPDATE pot_game_shop_items
        SET name = ?, description = ?, image_message_id = ?, action_config = ?, price = ?, stock_limit = ?, species = ?
        WHERE id = ? AND guild_id = ? AND deleted_at IS NULL
    `).run(
        name, description, imageMessageId,
        actionConfig ? JSON.stringify(actionConfig) : null, price, stockLimit,
        species.length > 0 ? JSON.stringify(species) : null,
        itemId, guildId
    );

    return { ok: true };
}

// As 3 ações do card de item (toggle público, toggle "em breve", excluir)
// — sempre com guild_id no WHERE: diferente de /dev/Loja (só o dono,
// rotas globais), estas são alcançáveis por QUALQUER admin de QUALQUER
// servidor — um id de item de OUTRO servidor precisa falhar em silêncio
// (0 linhas afetadas) em vez de mexer em dado alheio.
function setItemPublic(guildId, itemId, isPublic) {
    return db.prepare(`UPDATE pot_game_shop_items SET is_public = ? WHERE id = ? AND guild_id = ? AND deleted_at IS NULL`)
        .run(isPublic ? 1 : 0, itemId, guildId).changes > 0;
}

function setItemComingSoon(guildId, itemId, comingSoon) {
    return db.prepare(`UPDATE pot_game_shop_items SET coming_soon = ? WHERE id = ? AND guild_id = ? AND deleted_at IS NULL`)
        .run(comingSoon ? 1 : 0, itemId, guildId).changes > 0;
}

/**
 * Exclusão LÓGICA — nunca DELETE de verdade (pedido do dono: item
 * excluído continua funcionando pra quem já comprou e não usou). A linha
 * some das listagens (listShopItems sempre filtra deleted_at IS NULL) mas
 * continua resolvível via getShopItemById (que nunca filtra) — é isso que
 * mantém o item usável no inventário de quem já comprou.
 */
function softDeleteShopItem(guildId, itemId) {
    return db.prepare(`UPDATE pot_game_shop_items SET deleted_at = ? WHERE id = ? AND guild_id = ? AND deleted_at IS NULL`)
        .run(Date.now(), itemId, guildId).changes > 0;
}

/**
 * URL fresca da imagem do item (null se não tiver — a UI cai pro ícone
 * padrão por action_type nesse caso, ver lojaJogoIcons em loja.ejs).
 * Mesmo padrão de profileImagePool.resolveImageUrl.
 */
async function resolveItemImageUrl(client, item) {
    if (!item || !item.image_message_id) return null;
    return require('../../utils/imageStorage').resolveStoredImageUrl(client, item.image_message_id);
}

function _buildRconCommandForCustomItem(item, alderonId, playerName) {
    const cfg = item.actionConfig || {};
    if (item.action_type === 'growth') return `rewardgrowth ${alderonId} ${cfg.growthValue}`;
    if (item.action_type === 'skipshed') return `SkipShed ${alderonId}`;
    // Alvo pelo NOME em jogo, não Alderon ID — mesmo padrão confirmado em
    // eventTeleportSystem.js pro comando `teleport` (nunca testado contra
    // um servidor real, mesma ressalva de lá).
    if (item.action_type === 'teleport') return `teleport ${playerName} ${cfg.coords}`;
    return null;
}

/**
 * Compra um item customizado — mesmo princípio do catálogo legado (só
 * debita Ossos e grava inventário, sem RCON aqui, ver useGameShopItem),
 * mas envolto num db.transaction() de verdade: código novo, sem a amarra
 * assíncrona que forçou o reembolso manual do catálogo legado acima —
 * estoque, débito de Ossos e inserção do inventário ficam atômicos.
 * @param {string} guildId
 * @param {string} discordId
 * @param {number} itemId
 * @returns {{ok:true,label:string,price:number}|{ok:false,error:string}}
 */
function purchaseCustomShopItem(guildId, discordId, itemId) {
    const item = getShopItemById(itemId);
    if (!item || item.guild_id !== guildId || item.deleted_at) return { ok: false, error: 'Item não encontrado.' };
    if (!item.is_public) return { ok: false, error: 'Item não encontrado.' };
    if (item.coming_soon) return { ok: false, error: 'Este item ainda não está disponível — em breve.' };

    if (!PremiumSystem.getGuildLimits(guildId).genericRconEnabled) {
        return { ok: false, error: 'Este servidor não está no plano Caçador — a Loja de Jogo depende do mesmo RCON liberado só nesse tier.' };
    }

    const link = PlayerRegistry.getPlayerByDiscordId(discordId);
    if (!link) return { ok: false, error: 'Você precisa vincular sua conta com /registrar antes de comprar.' };

    try {
        const trans = db.transaction(() => {
            if (item.stock_limit !== null) {
                const claim = db.prepare(`UPDATE pot_game_shop_items SET stock_sold = stock_sold + 1 WHERE id = ? AND stock_sold < stock_limit`).run(itemId);
                if (claim.changes === 0) throw new Error('OUT_OF_STOCK');
            }
            if (!PlayerRegistry.spendBones(discordId, guildId, item.price)) throw new Error('INSUFFICIENT_BONES');
            db.prepare(`INSERT INTO game_shop_inventory (user_id, guild_id, item_key, shop_item_id, purchased_at) VALUES (?, ?, 'custom', ?, ?)`)
                .run(discordId, guildId, itemId, Date.now());
        });
        trans();
    } catch (err) {
        if (err.message === 'OUT_OF_STOCK') return { ok: false, error: 'Este item está esgotado.' };
        if (err.message === 'INSUFFICIENT_BONES') return { ok: false, error: 'Saldo de Ossos insuficiente.' };
        console.error('❌ [GameShop] Erro ao comprar item customizado:', err);
        return { ok: false, error: 'Erro ao registrar a compra.' };
    }

    db.logActivity(guildId, discordId, 'game_shop_purchase', null, { itemId, itemName: item.name, price: item.price, custom: true });
    return { ok: true, label: item.name, price: item.price };
}

/**
 * Migração automática, idempotente (pedido do dono, confirmado
 * explicitamente nesta sessão): a 1ª vez que um servidor abre a Loja de
 * Jogo nova (ver GET /lojajogo/:guildID), qualquer item do catálogo fixo
 * antigo que já estava ligado com preço configurado vira um item novo
 * equivalente, preservando preço/espécie. Marcador em `settings` (nunca
 * contagem de itens) garante que rodar de novo depois do admin ter
 * apagado tudo NÃO ressuscita nada. Envolta em db.transaction() pra 2
 * abas carregando a página ao mesmo tempo não duplicarem a migração.
 * @param {string} guildId
 */
function migrateLegacyItemsForGuild(guildId) {
    if (isGuildMigrated(guildId)) return;

    const trans = db.transaction(() => {
        const configRow = db.prepare(`SELECT value, updated_by FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, SETTINGS_KEY);
        if (configRow) {
            let config = {};
            try { config = JSON.parse(configRow.value) || {}; } catch { config = {}; }

            const insert = db.prepare(`
                INSERT INTO pot_game_shop_items
                    (guild_id, name, description, action_type, action_config, price, species, is_public, coming_soon, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
            `);

            for (const key of MIGRATABLE_KEYS) {
                const cfg = config[key];
                const item = GAME_SHOP_ITEMS[key];
                if (!cfg || !cfg.enabled || !Number.isInteger(cfg.price) || cfg.price <= 0) continue;

                const actionType = item.speciesRestrictable ? 'growth' : 'skipshed';
                const actionConfig = item.speciesRestrictable ? JSON.stringify({ growthValue: item.growthValue }) : null;
                const species = Array.isArray(cfg.species) && cfg.species.length > 0 ? JSON.stringify(cfg.species) : null;

                insert.run(
                    guildId, item.label, 'Migrado automaticamente do catálogo antigo da Loja de Jogo.',
                    actionType, actionConfig, cfg.price, species,
                    configRow.updated_by || 'system', Date.now()
                );
            }
        }

        db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_at)
            VALUES (?, ?, '1', ?)
            ON CONFLICT(guild_id, key) DO NOTHING
        `).run(guildId, MIGRATED_MARKER_KEY, Date.now());
    });
    trans();
}

module.exports = {
    GAME_SHOP_ITEMS,
    CUSTOM_ACTION_TYPES,
    GROWTH_STAGE_VALUES,
    getGuildShopConfig,
    setGuildShopConfig,
    purchaseGameShopItem,
    getInventory,
    useGameShopItem,
    listShopItems,
    getShopItemById,
    isGuildMigrated,
    createShopItem,
    updateShopItem,
    setItemPublic,
    setItemComingSoon,
    softDeleteShopItem,
    resolveItemImageUrl,
    purchaseCustomShopItem,
    migrateLegacyItemsForGuild,
};
