// src/systems/pot/rconCommandCatalog.js
/**
 * Catálogo declarativo dos comandos RCON de admin do Path of Titans expostos
 * como slash commands (`/ingame-*`, plano Caçador — ver premiumSystem.js
 * GUILD_LIMITS.genericRconEnabled). Baseado em
 * https://hosting.pathoftitans.wiki/guide/chat-commands.
 *
 * Cada categoria vira UM comando de topo (`/ingame-stats`, `/ingame-marks`
 * etc. — ver src/commands/ingame/*.js), e cada entrada deste catálogo vira UM
 * subcomando dentro dele. Em vez de ~55 handlers quase idênticos, um só
 * par de funções genéricas (buildSubcommandOption/executeRconSubcommand)
 * lê essa tabela de dados.
 *
 * kick/ban/unban/ServerMute/ServerUnmute NÃO entram aqui de propósito —
 * continuam exclusivos de /strike e /unstrike (ver punishmentSystem.js).
 *
 * IMPORTANTE: a sintaxe RCON abaixo NUNCA foi confirmada contra um servidor
 * real pra maioria destes comandos (mesma ressalva já existente pro RCON de
 * punição) — vem direto da documentação do site. O "<>"/"[]" do site é só
 * notação demonstrativa de onde entra o parâmetro, nunca faz parte do
 * comando de verdade enviado por RCON.
 */
const PlayerRegistry = require('./potPlayerRegistry');
const PoTConfigSystem = require('./potConfigSystem');
const PremiumSystem = require('../premium/premiumSystem');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

// Par de opções reaproveitado por toda entrada que mira um jogador
// (Username/AGID no site). Discord não tem "uma OU outra obrigatória"
// entre duas opções — as duas ficam opcionais na definição, e a
// obrigatoriedade de verdade (quando o comando exige um alvo) é checada em
// tempo de execução via `entry.requiresTarget`, mesmo padrão dual já usado
// em /historico (usuario OU alderon_id).
const TARGET_OPTIONS = [
    { name: 'usuario', type: 'user', required: false, description: 'Jogador com Discord vinculado (/registrar)' },
    { name: 'agid', type: 'string', required: false, description: 'Alderon ID ou nome do jogador, se ele não estiver vinculado' },
];

function resolveTarget(interaction) {
    const discordUser = interaction.options.getUser('usuario');
    const agid = interaction.options.getString('agid');
    if (discordUser) {
        const link = PlayerRegistry.getPlayerByDiscordId(discordUser.id);
        if (link?.alderon_id) return link.alderon_id;
    }
    return agid || null;
}

// ==================== CHANGE STATS ====================
const STATS_COMMANDS = [
    {
        name: 'heal',
        description: 'Cura você mesmo, ou o jogador informado.',
        options: [...TARGET_OPTIONS],
        buildCommand: (r) => r.target ? `heal ${r.target}` : 'heal',
    },
    {
        name: 'healall',
        description: 'Cura todos os jogadores.',
        supervisorOnly: true,
        options: [],
        buildCommand: () => 'healall',
    },
    {
        name: 'godmode',
        description: 'Ativa o modo deus pra você mesmo, ou pro jogador informado.',
        supervisorOnly: true,
        options: [...TARGET_OPTIONS],
        buildCommand: (r) => r.target ? `godmode ${r.target}` : 'godmode',
    },
    {
        name: 'setattr',
        description: 'Define um atributo do jogador informado.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'atributo', type: 'string', required: true, description: 'Nome do atributo' },
            { name: 'valor', type: 'string', required: true, description: 'Valor a definir' },
        ],
        buildCommand: (r) => `setattr ${r.target} ${r.atributo} ${r.valor}`,
    },
    {
        name: 'setattrall',
        description: 'Define um atributo pra todos os jogadores.',
        supervisorOnly: true,
        options: [
            { name: 'atributo', type: 'string', required: true, description: 'Nome do atributo' },
            { name: 'valor', type: 'string', required: true, description: 'Valor a definir' },
        ],
        buildCommand: (r) => `setattrall ${r.atributo} ${r.valor}`,
    },
    {
        name: 'getattr',
        description: 'Consulta o valor de um atributo do jogador informado.',
        supervisorOnly: true,
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'atributo', type: 'string', required: true, description: 'Nome do atributo' },
        ],
        buildCommand: (r) => `getattr ${r.target} ${r.atributo}`,
    },
    {
        name: 'getallattr',
        description: 'Consulta todos os atributos do jogador informado.',
        supervisorOnly: true,
        requiresTarget: true,
        options: [...TARGET_OPTIONS],
        buildCommand: (r) => `getallattr ${r.target}`,
    },
    {
        name: 'rewardgrowth',
        description: 'Recompensa o jogador informado com growth (crescimento).',
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'valor', type: 'number', required: true, description: 'Quantidade de growth' },
        ],
        buildCommand: (r) => `rewardgrowth ${r.target} ${r.valor}`,
    },
    {
        name: 'rewardwellrested',
        description: 'Recompensa o jogador informado com status de bem descansado.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'valor', type: 'number', required: true, description: 'Quantidade' },
        ],
        buildCommand: (r) => `rewardwellrested ${r.target} ${r.valor}`,
    },
    {
        name: 'clearcooldowns',
        description: 'Reseta todos os cooldowns de habilidade do servidor.',
        options: [],
        buildCommand: () => 'ClearCooldowns',
    },
];

// ==================== MARKS ====================
const MARKS_COMMANDS = [
    {
        name: 'setmarks',
        description: 'Define a quantidade de marcas suas, ou do jogador informado.',
        options: [...TARGET_OPTIONS,
            { name: 'numero', type: 'number', required: true, description: 'Quantidade de marcas' },
        ],
        buildCommand: (r) => r.target ? `setmarks ${r.target} ${r.numero}` : `setmarks ${r.numero}`,
    },
    {
        name: 'addmarks',
        description: 'Adiciona marcas ao jogador informado.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'numero', type: 'number', required: true, description: 'Quantidade a adicionar' },
        ],
        buildCommand: (r) => `addmarks ${r.target} ${r.numero}`,
    },
    {
        name: 'addmarksall',
        description: 'Adiciona marcas a todos os jogadores.',
        supervisorOnly: true,
        options: [
            { name: 'numero', type: 'number', required: true, description: 'Quantidade a adicionar' },
        ],
        buildCommand: (r) => `addmarksall ${r.numero}`,
    },
    {
        name: 'removemarks',
        description: 'Remove marcas do jogador informado.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'numero', type: 'number', required: true, description: 'Quantidade a remover' },
        ],
        buildCommand: (r) => `removemarks ${r.target} ${r.numero}`,
    },
];

// ==================== ADMIN ====================
const ADMIN_COMMANDS = [
    { name: 'save', description: 'Salva os dados do servidor.', options: [], buildCommand: () => 'save' },
    { name: 'load', description: 'Carrega os dados do servidor.', options: [], buildCommand: () => 'load' },
    {
        name: 'promote',
        description: 'Promove o jogador informado a um cargo de admin.',
        supervisorOnly: true,
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'cargo', type: 'string', required: true, description: 'Nome do cargo de admin (ver /ingame-list listroles)' },
        ],
        buildCommand: (r) => `promote ${r.target} ${r.cargo}`,
    },
    {
        name: 'demote',
        description: 'Remove o cargo de admin do jogador informado.',
        supervisorOnly: true,
        requiresTarget: true,
        options: [...TARGET_OPTIONS],
        buildCommand: (r) => `demote ${r.target}`,
    },
    { name: 'cancelrestart', description: 'Cancela um reinício agendado do servidor.', supervisorOnly: true, options: [], buildCommand: () => 'cancelrestart' },
    {
        name: 'restart',
        description: 'Agenda o reinício do servidor.',
        supervisorOnly: true,
        options: [
            { name: 'segundos', type: 'integer', required: true, description: 'Tempo até o reinício, em segundos' },
        ],
        buildCommand: (r) => `restart ${r.segundos}`,
    },
    { name: 'reloadrules', description: 'Recarrega as regras do servidor.', options: [], buildCommand: () => 'ReloadRules' },
    {
        name: 'whitelist',
        description: 'Adiciona o jogador informado à whitelist.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS],
        buildCommand: (r) => `Whitelist ${r.target}`,
    },
    {
        name: 'delwhitelist',
        description: 'Remove o jogador informado da whitelist.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS],
        buildCommand: (r) => `DelWhitelist ${r.target}`,
    },
    { name: 'reloadwhitelist', description: 'Recarrega a whitelist do servidor.', options: [], buildCommand: () => 'ReloadWhitelist' },
    { name: 'reloadmotd', description: 'Recarrega a mensagem do dia (MOTD).', options: [], buildCommand: () => 'ReloadMOTD' },
    {
        name: 'alloweditabilities',
        description: 'Permite que o jogador informado edite habilidades.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS],
        buildCommand: (r) => `alloweditabilities ${r.target}`,
    },
    { name: 'serverinfo', description: 'Mostra informações do servidor.', supervisorOnly: true, options: [], buildCommand: () => 'ServerInfo' },
];

// ==================== MAP ====================
const MAP_COMMANDS = [
    {
        name: 'weather',
        description: 'Define o clima do servidor.',
        options: [{ name: 'tipo', type: 'string', required: true, description: 'Tipo de clima' }],
        buildCommand: (r) => `Weather ${r.tipo}`,
    },
    {
        name: 'timeofday',
        description: 'Define a hora do dia no servidor.',
        options: [{ name: 'hora', type: 'string', required: true, description: 'Horário' }],
        buildCommand: (r) => `TimeOfDay ${r.hora}`,
    },
    {
        name: 'waterquality',
        description: 'Ajusta a qualidade da água (0-100%).',
        options: [
            { name: 'tag', type: 'string', required: true, description: 'Tag da fonte de água' },
            { name: 'porcentagem', type: 'number', required: true, minValue: 0, maxValue: 100, description: 'Qualidade (0-100%)' },
        ],
        buildCommand: (r) => `WaterQuality ${r.tag} ${r.porcentagem}`,
    },
    {
        name: 'waystonecooldown',
        description: 'Ajusta o cooldown das waystones (0-100%).',
        options: [
            { name: 'tag', type: 'string', required: true, description: 'Tag da waystone' },
            { name: 'porcentagem', type: 'number', required: true, minValue: 0, maxValue: 100, description: 'Cooldown (0-100%)' },
        ],
        buildCommand: (r) => `WaystoneCooldown ${r.tag} ${r.porcentagem}`,
    },
    { name: 'clearcreatorobjects', description: 'Remove os objetos do modo criador.', options: [], buildCommand: () => 'ClearCreatorObjects' },
    {
        name: 'loadcreatormode',
        description: 'Carrega um save do modo criador.',
        options: [{ name: 'nome', type: 'string', required: true, description: 'Nome do save' }],
        buildCommand: (r) => `LoadCreatorMode ${r.nome}`,
    },
    {
        name: 'savecreatormode',
        description: 'Salva o progresso do modo criador.',
        options: [{ name: 'nome', type: 'string', required: true, description: 'Nome do save' }],
        buildCommand: (r) => `SaveCreatorMode ${r.nome}`,
    },
    { name: 'resetcreatormode', description: 'Reseta o modo criador.', options: [], buildCommand: () => 'ResetCreatorMode' },
    {
        name: 'removecreatormode',
        description: 'Apaga um save do modo criador.',
        options: [{ name: 'nome', type: 'string', required: true, description: 'Nome do save' }],
        buildCommand: (r) => `RemoveCreatorMode ${r.nome}`,
    },
    { name: 'replenishcreatormode', description: 'Restaura os recursos do modo criador.', options: [], buildCommand: () => 'ReplenishCreatorMode' },
];

// ==================== LIST ====================
// Categoria dedicada a comandos de consulta (list*) — junta o que antes
// estava espalhado entre Admin (listroles) e Map (listpoi/listquests/
// listcreatormode) com as novidades (listplayers/listwaters/listwaystones).
// `listplayers` é o único subcomando de todo o catálogo liberado pra
// QUALQUER membro do servidor, não só Staff (ver `publicAccess` em
// executeRconSubcommand) — por isso /ingame-list não usa ModerateMembers
// como permissão padrão do Discord (ver ingame-list.js), diferente dos
// outros 6 comandos de categoria.
const LIST_COMMANDS = [
    {
        name: 'listplayers',
        description: 'Lista os jogadores conectados no servidor, com o total online.',
        publicAccess: true,
        options: [],
        buildCommand: () => 'listplayers',
        // Melhor esforço: soma linhas/itens não-vazios da resposta crua do
        // RCON pra mostrar um total, já que o formato exato da resposta
        // nunca foi confirmado contra um servidor real (mesma ressalva do
        // topo do arquivo).
        formatExtra: (response) => {
            if (!response || response === 'OK') return null;
            const names = response.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
            if (!names.length) return null;
            return `${EMOJIS.users || '👥'} Total: **${names.length}** jogador(es) online.`;
        },
    },
    { name: 'listpoi', description: 'Lista os pontos de interesse (POIs) do mapa.', options: [], buildCommand: () => 'listpoi' },
    { name: 'listquests', description: 'Lista as missões disponíveis.', options: [], buildCommand: () => 'listquests' },
    { name: 'listroles', description: 'Lista os cargos de admin disponíveis.', options: [], buildCommand: () => 'listroles' },
    { name: 'listwaters', description: 'Lista as fontes de água do mapa.', options: [], buildCommand: () => 'listwaters' },
    { name: 'listwaystones', description: 'Lista as waystones do mapa.', options: [], buildCommand: () => 'listwaystones' },
    { name: 'listcreatormode', description: 'Lista os saves do modo criador.', options: [], buildCommand: () => 'ListCreatorMode' },
];

// ==================== EVENT ====================
const EVENT_COMMANDS = [
    {
        name: 'setwound',
        description: 'Aplica um ferimento ao jogador informado.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'categoria', type: 'string', required: false, description: 'Categoria do ferimento (obrigatório se for informar valor)' },
            { name: 'valor', type: 'string', required: false, description: 'Valor do ferimento' },
        ],
        buildCommand: (r) => ['SetWound', r.target, r.categoria, r.valor].filter(Boolean).join(' '),
    },
    {
        name: 'setpermawound',
        description: 'Aplica um ferimento permanente ao jogador informado.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'categoria', type: 'string', required: false, description: 'Categoria do ferimento (obrigatório se for informar valor)' },
            { name: 'valor', type: 'string', required: false, description: 'Valor do ferimento' },
        ],
        buildCommand: (r) => ['SetPermaWound', r.target, r.categoria, r.valor].filter(Boolean).join(' '),
    },
    {
        name: 'skipshed',
        description: 'Pula a muda (troca de pele) do jogador informado.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS],
        buildCommand: (r) => `SkipShed ${r.target}`,
    },
    {
        name: 'spawncritter',
        description: 'Spawna criaturas pequenas (critters).',
        options: [
            { name: 'nome', type: 'string', required: false, description: 'Nome da criatura (obrigatório se for informar quantidade)' },
            { name: 'quantidade', type: 'integer', required: false, description: 'Quantidade a spawnar' },
        ],
        buildCommand: (r) => ['SpawnCritter', r.nome, r.quantidade].filter(v => v !== null && v !== undefined && v !== '').join(' '),
    },
    { name: 'countcritters', description: 'Conta as criaturas ativas no servidor.', options: [], buildCommand: () => 'CountCritters' },
    {
        name: 'freezecritters',
        description: 'Congela ou descongela as criaturas do servidor.',
        options: [
            { name: 'congelar', type: 'integer', required: true, description: 'Congelar as criaturas?', choices: [{ name: 'Sim (1)', value: 1 }, { name: 'Não (0)', value: 0 }] },
        ],
        buildCommand: (r) => `freezecritters ${r.congelar}`,
    },
    { name: 'clearcritters', description: 'Remove todas as criaturas do servidor.', options: [], buildCommand: () => 'ClearCritters' },
];

// ==================== MESSAGE ====================
const MESSAGE_COMMANDS = [
    {
        name: 'systemmessage',
        description: 'Envia uma mensagem de sistema para o jogador informado.',
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'mensagem', type: 'string', required: true, description: 'Texto da mensagem' },
        ],
        // Minúsculo confirmado: o exemplo real da doc é
        // "/systemmessage mike Hello there" — testado em produção com
        // "SystemMessage" (PascalCase) e o comando "teve sucesso" (RCON não
        // deu erro) mas a mensagem nunca chegou no jogo, sinal de comando
        // não reconhecido silenciosamente. Todo o resto desta categoria
        // (whisper/announce) já era minúsculo e nunca foi reportado como
        // quebrado.
        //
        // MESMO com o nome minúsculo corrigido, ainda "sucesso" sem efeito
        // no jogo (testado de novo, depois de reiniciar o bot). Diferença
        // chave pro "announce" (que funciona): announce só tem 1 argumento
        // (a mensagem é literalmente tudo depois do nome do comando — sem
        // ambiguidade nenhuma pro parser). systemmessage tem um argumento
        // ANTES da mensagem (o alvo) — sem aspas, um parser de linha de
        // comando comum (tokeniza por espaço) não sabe onde o alvo termina
        // e a mensagem começa quando ela tem mais de uma palavra. Mensagem
        // agora entre aspas pra virar 1 token só, isolado do alvo.
        buildCommand: (r) => `systemmessage ${r.target} "${r.mensagem}"`,
    },
    {
        name: 'systemmessageall',
        description: 'Envia uma mensagem de sistema para todos os jogadores.',
        options: [{ name: 'mensagem', type: 'string', required: true, description: 'Texto da mensagem' }],
        buildCommand: (r) => `systemmessageall ${r.mensagem}`,
    },
    {
        name: 'announce',
        description: 'Transmite um anúncio para o servidor.',
        options: [{ name: 'mensagem', type: 'string', required: true, description: 'Texto do anúncio' }],
        buildCommand: (r) => `announce ${r.mensagem}`,
    },
    {
        name: 'whisper',
        description: 'Envia uma mensagem privada pro jogador informado (equivalente a /w no jogo).',
        requiresTarget: true,
        options: [...TARGET_OPTIONS,
            { name: 'mensagem', type: 'string', required: true, description: 'Texto da mensagem' },
        ],
        // "whisper" por extenso NÃO existe de verdade — testado em produção,
        // RCON retorna "Unknown command: /whisper". Só o atalho "w" é
        // reconhecido pelo servidor (confirmado pelo dono). Nome do
        // subcomando no Discord continua "whisper" (mais claro pra quem usa
        // o bot), só o comando RCON de fato enviado muda pra "w".
        //
        // MESMO com "w", ainda "sucesso" sem a mensagem chegar no jogo
        // (testado de novo, depois de reiniciar o bot) — mesmo sintoma e
        // mesma causa provável de systemmessage (ver comentário lá): "w"
        // tem um argumento (alvo) ANTES da mensagem, então uma mensagem de
        // várias palavras sem aspas fica ambígua pro parser. Mensagem
        // agora entre aspas.
        buildCommand: (r) => `w ${r.target} "${r.mensagem}"`,
    },
];
// "whisperall" REMOVIDO — testado em produção pelo dono, sem suporte via
// RCON (mesmo destino de "whisper" por extenso, ver comentário acima),
// mas sem nenhum atalho conhecido tipo "w" pra ele. Diferente de
// "whisper", que tem "w" como alternativa funcional, não há substituto
// confirmado — melhor não oferecer o subcomando do que oferecer um que
// não funciona.

// ==================== BUILDER GENÉRICO (Discord option ← catálogo) ====================

function buildSubcommandOption(sub, entry) {
    sub.setName(entry.name).setDescription(entry.description.slice(0, 100));
    for (const opt of entry.options) {
        if (opt.name === 'usuario' || opt.name === 'agid') continue; // adicionados à parte, sempre juntos
        switch (opt.type) {
            case 'string':
                sub.addStringOption(o => {
                    o.setName(opt.name).setDescription(opt.description.slice(0, 100)).setRequired(!!opt.required);
                    if (opt.choices) o.addChoices(...opt.choices);
                    return o;
                });
                break;
            case 'number':
                sub.addNumberOption(o => {
                    o.setName(opt.name).setDescription(opt.description.slice(0, 100)).setRequired(!!opt.required);
                    if (opt.minValue !== undefined) o.setMinValue(opt.minValue);
                    if (opt.maxValue !== undefined) o.setMaxValue(opt.maxValue);
                    return o;
                });
                break;
            case 'integer':
                sub.addIntegerOption(o => {
                    o.setName(opt.name).setDescription(opt.description.slice(0, 100)).setRequired(!!opt.required);
                    if (opt.choices) o.addChoices(...opt.choices);
                    if (opt.minValue !== undefined) o.setMinValue(opt.minValue);
                    if (opt.maxValue !== undefined) o.setMaxValue(opt.maxValue);
                    return o;
                });
                break;
        }
    }
    // Par usuario/agid sempre por último (mesma ordem visual em toda entrada que tem alvo).
    if (entry.options.some(o => o.name === 'usuario')) {
        sub.addUserOption(o => o.setName('usuario').setDescription(TARGET_OPTIONS[0].description).setRequired(false));
        sub.addStringOption(o => o.setName('agid').setDescription(TARGET_OPTIONS[1].description).setRequired(false));
    }
    return sub;
}

function resolveOptionValues(interaction, entry) {
    const resolved = {};
    let hasTargetOption = false;
    for (const opt of entry.options) {
        if (opt.name === 'usuario' || opt.name === 'agid') { hasTargetOption = true; continue; }
        if (opt.type === 'string') resolved[opt.name] = interaction.options.getString(opt.name);
        else if (opt.type === 'number') resolved[opt.name] = interaction.options.getNumber(opt.name);
        else if (opt.type === 'integer') resolved[opt.name] = interaction.options.getInteger(opt.name);
    }
    if (hasTargetOption) resolved.target = resolveTarget(interaction);
    return resolved;
}

// Extrai {id, token} de uma URL de webhook do Discord — mesma lógica de
// gatewayServer.js._parseWebhookUrl, duplicada aqui de propósito pra manter
// este módulo autocontido (mesmo padrão já usado em webhookPayloads.js).
function _parseWebhookUrl(webhookUrl) {
    try {
        const url = new URL(webhookUrl);
        const parts = url.pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('webhooks');
        if (idx === -1 || !parts[idx + 1] || !parts[idx + 2]) return {};
        return { id: parts[idx + 1], token: parts[idx + 2] };
    } catch {
        return {};
    }
}

// Mesmas 3 chaves/labels de config-roles usadas em webhookPayloads.js
// (discordIdentitySuffix) — duplicado aqui de propósito pra manter este
// catálogo autocontido, mesmo padrão já usado no resto do arquivo.
const STAFF_ROLE_LABELS = { supervisor_role: 'Supervisor', staff_role: 'Moderador', event_role: 'Equipe de Eventos' };

/**
 * "@menção (Discord: Cargo) | 🎮 Nome `AGID`" — identidade de quem executou
 * o comando: menção Discord direta (sempre disponível, é o próprio autor da
 * interação) + cargo de staff configurado (Moderador/Supervisor/Equipe de
 * Eventos) + identidade em jogo, se o Discord dele estiver vinculado a um
 * AlderonId (/registrar). Pedido do dono: todo log de comando/RCON deve
 * trazer quem usou E o cargo, tanto em jogo quanto no Discord.
 */
async function _describeCommandUser(interaction) {
    let roleLabel = null;
    const ConfigSystem = require('../core/configSystem');
    for (const key of ['supervisor_role', 'staff_role', 'event_role']) {
        if (ConfigSystem.memberHasConfiguredRole(interaction.guildId, interaction.member, key)) {
            roleLabel = STAFF_ROLE_LABELS[key];
            break;
        }
    }

    let ingamePart = '';
    try {
        const link = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        if (link?.alderon_id) {
            ingamePart = ` | ${EMOJIS.game || '🎮'} ${link.player_name || 'Sem nome'} \`${link.alderon_id}\``;
        }
    } catch (err) {
        // sem vínculo — segue sem identidade em jogo
    }

    return `${interaction.user.toString()}${roleLabel ? ` (Discord: ${roleLabel})` : ''}${ingamePart}`;
}

/**
 * Log de auditoria de um comando /ingame-* — pedido do dono: concentrar no
 * MESMO canal que já recebe os webhooks do grupo Admin do PoT (AdminSpectate/
 * AdminCommand), em vez de espalhar entre esse canal e o de logs Geral/
 * AutoMod. Resolve o canal a partir da própria URL de webhook configurada
 * pra esse grupo (/potserver logs) — sem precisar de uma config nova.
 * Sem webhook do grupo Admin configurado, cai no comportamento antigo
 * (ConfigSystem.logConfigChange, canal de log Geral) pra não perder o
 * registro. Sempre best-effort — nunca bloqueia a resposta ao staff.
 */
async function _logRconCommand(interaction, categoryLabel, entry, command, rconResult) {
    const staffLabel = await _describeCommandUser(interaction);
    const line = `${EMOJIS.rcon || '🔗'} RCON \`[${categoryLabel}]\` **/${entry.name}** por ${staffLabel}: \`${command}\` — ${rconResult?.success ? 'sucesso' : `falhou (${rconResult?.error || 'erro desconhecido'})`}`;

    try {
        const adminWebhookUrl = PoTConfigSystem.getWebhookForGroup(interaction.guildId, 'admin');
        const { id, token } = _parseWebhookUrl(adminWebhookUrl || '');
        if (id && token) {
            const webhook = await interaction.client.fetchWebhook(id, token).catch(() => null);
            const channel = webhook?.channelId ? await interaction.client.channels.fetch(webhook.channelId).catch(() => null) : null;
            if (channel?.isTextBased?.()) {
                const builder = new AdvancedContainerBuilder({ accentColor: rconResult?.success ? COLORS.SUCCESS : COLORS.ERROR });
                builder.text(line);
                builder.footer(interaction.guild.name);
                const { components, flags } = builder.build();
                await channel.send({ components, flags: [flags] });
                return;
            }
        }
    } catch (err) {
        // cai no fallback abaixo
    }

    try {
        const ConfigSystem = require('../core/configSystem');
        await ConfigSystem.logConfigChange(interaction, line);
    } catch (err) {
        // log é best-effort, nunca bloqueia a resposta ao staff
    }
}

// ==================== EXECUTOR GENÉRICO ====================

async function executeRconSubcommand(interaction, entry, categoryLabel) {
    const guildId = interaction.guildId;
    const guild = interaction.guild;

    if (!PremiumSystem.getGuildLimits(guildId).genericRconEnabled) {
        return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guildId));
    }

    // Checagem própria do cargo Staff — os comandos /ingame-* usam
    // ModerateMembers como permissão padrão do Discord (não mais
    // Administrator, ver ingame-*.js), então sem isso qualquer um com essa
    // permissão comum passaria direto. Continua sendo possível restringir
    // ainda mais por comando/canal pelo próprio Discord (Integrações),
    // como já avisado em /ajuda. `publicAccess` pula essa checagem de
    // propósito (hoje só /ingame-list listplayers) — qualquer membro do
    // servidor pode usar, não só Staff.
    if (!entry.publicAccess) {
        const ConfigSystem = require('../core/configSystem');
        if (!ConfigSystem.memberHasAnyStaffRole(guildId, interaction.member)) {
            return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Este comando é restrito à equipe do servidor (cargo Staff, ver /config roles).`);
        }
    }

    if (entry.supervisorOnly) {
        const PunishmentSystem = require('../moderation/punishmentSystem');
        if (!(await PunishmentSystem.memberHasSupervisorRole(guild, interaction.member))) {
            return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Este comando é restrito ao cargo Supervisor (ver /config roles).`);
        }
    }

    const resolved = resolveOptionValues(interaction, entry);
    if (entry.requiresTarget && !resolved.target) {
        return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Informe \`usuario\` ou \`agid\` pra usar este comando.`);
    }

    const command = entry.buildCommand(resolved);
    const rconResult = await PoTConfigSystem.executeRconCommand(guildId, command);

    db.logActivity(guildId, interaction.user.id, 'rcon_command', null, {
        categoria: categoryLabel, subcomando: entry.name, comando: command, sucesso: !!rconResult?.success,
    });

    await _logRconCommand(interaction, categoryLabel, entry, command, rconResult);

    const builder = new AdvancedContainerBuilder({ accentColor: rconResult?.success ? COLORS.SUCCESS : COLORS.ERROR });
    builder.text(`${rconResult?.success ? (EMOJIS.circlecheck || '✅') : (EMOJIS.circlealert || '❌')} **/${entry.name}**`);
    builder.text(`\`${command}\``);
    if (rconResult?.success) {
        if (rconResult.response && rconResult.response !== 'OK') {
            builder.text(`${EMOJIS.messagesquare || '💬'} Resposta: \`\`\`${rconResult.response}\`\`\``);
        }
        if (typeof entry.formatExtra === 'function') {
            const extra = entry.formatExtra(rconResult.response);
            if (extra) builder.text(extra);
        }
    } else {
        builder.text(`${EMOJIS.trianglealert || '⚠️'} ${rconResult?.error || 'Erro desconhecido ao executar o comando.'}`);
    }
    builder.footer(guild.name);
    await ResponseManager.send(interaction, builder);
}

module.exports = {
    STATS_COMMANDS,
    MARKS_COMMANDS,
    ADMIN_COMMANDS,
    MAP_COMMANDS,
    LIST_COMMANDS,
    EVENT_COMMANDS,
    MESSAGE_COMMANDS,
    buildSubcommandOption,
    executeRconSubcommand,
};
