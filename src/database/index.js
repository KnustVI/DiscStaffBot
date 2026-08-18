const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { SCHEMA, INDEXES } = require('./schema');

class DatabaseManager {
    constructor(options = {}) {
        this.options = {
            dbPath: options.dbPath || path.join(__dirname, '../../database.sqlite'),
            verbose: options.verbose || false,
            ...options
        };
        
        this.db = null;
        this.isConnected = false;
        
        this.init();
    }
    
    generateUUID() {
        return crypto.randomUUID();
    }
    
    init() {
        try {
            const dbDir = path.dirname(this.options.dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
            
            this.db = new Database(this.options.dbPath, {
                verbose: this.options.verbose ? console.log : null
            });
            
            // Configurações de performance
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('cache_size = 10000');
            this.db.pragma('foreign_keys = ON');
            
            this.isConnected = true;
            
            // Criar todas as tabelas
            this.createAllTables();
            
            console.log('✅ Banco de dados SQLite conectado com sucesso');
            
        } catch (error) {
            console.error('❌ Erro ao conectar ao banco de dados:', error);
            throw error;
        }
    }
    
    createAllTables() {
        try {
            // Criar tabelas em ordem
            const tables = [
                'users',
                'guilds',
                'settings',
                'reputation',
                'punishments',
                'reports',
                'report_messages',
                'staff_analytics',
                'activity_logs',
                'temporary_roles',
                'feedbacks',
                'sequences',
                'pot_servers',
                'pot_players',
                'pot_dinosaur_picks',
                'pot_species_kills',
                'pot_chat_filters',
                'pot_logs',
                'pot_tokens',
                'player_links',
                'pot_player_bones',
                'player_level_ups',
                'profile_image_pool',
                'image_inventory',
                'personalization_shop_config',
                'game_shop_inventory',
                'pot_game_shop_items',
                'player_premium',
                'guild_premium',
                'punishment_levels',
                'pot_spectator_sessions',
                'staff_presence_sessions',
                'event_teleports',
                'event_teleport_uses',
                'event_posts',
                'buffs',
                'buff_stats',
                'sessions'
            ];
            
            for (const table of tables) {
                if (SCHEMA[table]) {
                    try {
                        this.db.exec(SCHEMA[table]);
                        console.log(`   ✅ Tabela ${table} criada`);
                    } catch (err) {
                        console.error(`   ❌ Erro ao criar tabela ${table}:`, err.message);
                    }
                }
            }
            
            // Criar índices
            console.log('   📊 Criando índices...');
            for (const indexSql of INDEXES) {
                try {
                    this.db.exec(indexSql);
                } catch (err) {
                    // Ignorar erros de índices
                }
            }

            // Colunas adicionadas depois da criação inicial das tabelas.
            // CREATE TABLE IF NOT EXISTS não adiciona colunas em bancos já
            // existentes, então precisamos de ALTER TABLE aqui (idempotente:
            // se a coluna já existe, o erro é ignorado).
            this.ensureColumn('reports', 'type', "TEXT NOT NULL DEFAULT 'report'");
            this.ensureColumn('reports', 'punishment_id', 'INTEGER');
            // Quem apagou o tópico do report/revisão (Discord não manda o
            // executor no evento threadDelete — resolvido via audit log,
            // ver src/events/threadDelete.js). Fica separado de closed_by
            // (quem fechou o report DE VERDADE, pelo fluxo normal) — um
            // tópico pode ser apagado bem depois do report já ter sido
            // fechado normalmente, são duas informações independentes.
            this.ensureColumn('reports', 'thread_deleted_by', 'TEXT');
            // Verificação em jogo (RCON) do cadastro manual de jogador — colunas
            // já preparadas, mas o envio do código pelo chat do jogo ainda não
            // está ativado (ver potPlayerRegistry.js). Ver /registrar.
            this.ensureColumn('pot_players', 'verification_code', 'TEXT');
            this.ensureColumn('pot_players', 'verified_ingame', 'INTEGER DEFAULT 0');
            // Espécie/growth do dinossauro atual — foram adicionadas ao
            // CREATE TABLE de pot_players numa revisão anterior, mas SEM um
            // ensureColumn correspondente: CREATE TABLE IF NOT EXISTS não
            // adiciona coluna em tabela já existente, então bancos de
            // produção criados antes dessa revisão nunca ganharam essas 2
            // colunas de verdade (erro real visto em produção: "no such
            // column: dinosaur_type"). Preenchidas via PlayerRespawn — ver
            // potPlayerRegistry.js.
            this.ensureColumn('pot_players', 'dinosaur_type', 'TEXT');
            this.ensureColumn('pot_players', 'dinosaur_growth', 'REAL DEFAULT 0');
            // Kills/deaths por servidor, contabilizados a partir do evento de
            // webhook PlayerKilled (KillerAlderonId/VictimAlderonId) — ver
            // potPlayerRegistry.recordKillEvent. Usados no card do /perfil
            // (agregados globalmente entre servidores).
            this.ensureColumn('pot_players', 'kills', 'INTEGER DEFAULT 0');
            this.ensureColumn('pot_players', 'deaths', 'INTEGER DEFAULT 0');
            // Distingue "online jogando um dinossauro" de "online na tela de
            // seleção de dinossauro" — dinosaur_type/growth (acima) NUNCA são
            // limpos (sempre guardam o ÚLTIMO dino jogado, mesmo offline), então
            // sozinhos não dão pra saber se o jogador já deu respawn NESTA sessão.
            // Zerado no PlayerLogin e no PlayerKilled (como vítima — volta pra
            // seleção), setado em 1 no PlayerRespawn. Ver potPlayerRegistry.js.
            this.ensureColumn('pot_players', 'dinosaur_active', 'INTEGER DEFAULT 0');
            // Timestamp (ms) de quando a sessão ATUAL começou (setado no
            // PlayerLogin, limpo no PlayerLogout/PlayerLeave) — usado pra
            // calcular tempo de jogo AO VIVO enquanto o jogador está online
            // (total_playtime sozinho só é somado no logout, então ficava
            // "parado" no /perfil pra quem está jogando agora). Ver
            // upsertPlayerFromEvent/getGuildPlayerStats em potPlayerRegistry.js.
            this.ensureColumn('pot_players', 'session_started_at', 'INTEGER');
            // Grupo (matilha/pack) ATUAL do jogador em jogo — pedido do dono,
            // 2026-08-13: "sabemos quais grupos estão brigando" (relatório de
            // combate misturando engages sem relação nenhuma entre si).
            // Atualizado ao vivo via PlayerJoinedGroup/PlayerLeftGroup (ver
            // gatewayServer.js _routeToDiscord), NUNCA pelos eventos de
            // dano/morte em si (que confirmadamente não carregam esse campo,
            // ver extractDinoIdentity em gatewayServer.js). group_leader_name
            // guarda o nome de exibição do líder (não dá pra resolver o nome
            // por trás só do Alderon ID sem outra consulta, então salva os
            // dois juntos igual outros pares nome+ID deste arquivo). NULL =
            // sem grupo (solo) — estado inicial de todo jogador, e também o
            // que PlayerLeftGroup grava de volta.
            this.ensureColumn('pot_players', 'group_leader_alderon_id', 'TEXT');
            this.ensureColumn('pot_players', 'group_leader_name', 'TEXT');
            // Banner de perfil personalizado (Player Premium Raptor) — ver /perfil-edit.
            // Guarda o ID da mensagem (não a URL — URLs de anexo do Discord
            // expiram em ~24h, a mensagem em si não).
            this.ensureColumn('player_links', 'banner_message_id', 'TEXT');
            // Foto de perfil escolhida num menu pré-definido (Player Premium
            // Compy) — guarda a CHAVE do imageManager (ex: "foto_perfil_05"),
            // não um arquivo próprio. Raptor continua com upload/banner do
            // Discord (banner_message_id, acima); Compy só escolhe entre as
            // fotos genéricas já existentes em assets/images. Ver /perfil-edit.
            this.ensureColumn('player_links', 'selected_photo_key', 'TEXT');
            // Verificação em jogo (RCON) do vínculo Discord<->Alderon ID —
            // global (a identidade é global, mesmo que a confirmação em si
            // dependa do RCON de um servidor específico). 1 quando o vínculo
            // veio confirmado pela própria Alderon (webhook com DiscordId) ou
            // quando o jogador confirmou o código enviado in-game via
            // /registrar. Ver potPlayerRegistry.js.
            this.ensureColumn('player_links', 'verified_ingame', 'INTEGER DEFAULT 0');
            // Personalização de perfil expandida (Player Premium Compy/Raptor) —
            // ver /perfil-edit e playerRegistrationSystem.sendProfile.
            // profile_title: texto livre pra 1ª badge do card (Raptor only —
            // sem versão "banco de textos" pra Compy, não faz sentido pra texto
            // livre). selected_badge_key: emblema escolhido de uma lista fixa
            // pra fileira de ícones do card (Compy+ — é sempre "escolher de um
            // banco", nunca upload). background_message_id/
            // selected_background_key: mesmo par foto-upload/foto-de-banco já
            // usado em banner_message_id/selected_photo_key, mas pro banner que
            // aparece ATRÁS da mensagem inteira do /perfil (não o recorte de
            // foto de dentro do card). hide_kda: esconde a linha de Kills/
            // Deaths/K-D do /perfil (qualquer tier com acesso a /perfil-edit).
            this.ensureColumn('player_links', 'profile_title', 'TEXT');
            this.ensureColumn('player_links', 'selected_badge_key', 'TEXT');
            this.ensureColumn('player_links', 'background_message_id', 'TEXT');
            this.ensureColumn('player_links', 'selected_background_key', 'TEXT');
            this.ensureColumn('player_links', 'hide_kda', 'INTEGER DEFAULT 0');
            // Saldo de Ossos (Bones, moeda da Loja de Jogo — ver
            // PREMIUM.txt seção 122). Global por jogador, igual toda a
            // economia do bot (Player Premium).
            this.ensureColumn('player_links', 'bones_balance', 'INTEGER NOT NULL DEFAULT 0');
            // Limite diário do conversor Marks->Ossos (pedido do dono,
            // 2026-08-10: "possivel converter apenas 100000 marks por
            // dia") — soma quantos Marks o jogador já converteu HOJE
            // (marks_converted_date, formato YYYY-MM-DD) contra o teto de
            // CurrencySystem.DAILY_MARKS_TO_BONES_LIMIT; zera sozinho
            // quando a data guardada não é mais hoje (ver
            // potPlayerRegistry.js getMarksConvertedToday/
            // addMarksConvertedToday). Só essa direção — Ossos->Marks
            // continua sem limite (o bot controla o próprio saldo de
            // Ossos, ver docblock no topo de currencySystem.js).
            this.ensureColumn('player_links', 'marks_converted_today', 'INTEGER NOT NULL DEFAULT 0');
            this.ensureColumn('player_links', 'marks_converted_date', 'TEXT');
            // Saldo de Caçadas (Hunt, moeda da Loja de Personalização) e XP
            // (sistema de nível) — pedido do dono, 2026-08-07: "Libere o
            // farm dos itens por hora jogada agora". As duas são creditadas
            // junto com Ossos toda vez que uma sessão de jogo fecha (ver
            // potPlayerRegistry.js _creditPlaytimeCurrency, chamada de
            // upsertPlayerFromEvent) — 1h jogada = 1 Caçada + 5 Ossos + 1 XP,
            // taxa original do dono (ver PREMIUM.txt seção 117).
            this.ensureColumn('player_links', 'hunt_balance', 'INTEGER NOT NULL DEFAULT 0');
            this.ensureColumn('player_links', 'xp', 'INTEGER NOT NULL DEFAULT 0');
            // Sobra de segundos ainda não convertida numa hora cheia — ex:
            // 3 sessões de 20min cada precisam SOMAR até completarem 3600s
            // antes de render 1 hora de moeda; sem isso, sessões curtas
            // nunca creditariam nada. Puramente interno (nunca mostrado ao
            // jogador), reseta o resto (`% 3600`) toda vez que soma o
            // bastante pra fechar 1+ hora.
            this.ensureColumn('player_links', 'playtime_credit_seconds', 'INTEGER NOT NULL DEFAULT 0');
            // Snapshot do nível de punição customizado usado no momento do strike
            // (ver punishmentLevels.js) — congelado na hora de aplicar, pra editar
            // um nível depois não reescrever punições já aplicadas. A coluna
            // `severity` (INTEGER) antiga fica congelada nas linhas legadas;
            // linhas novas gravam 0 nela (sentinela) e usam level_severity (texto).
            this.ensureColumn('punishments', 'level_id', 'INTEGER');
            this.ensureColumn('punishments', 'level_name', 'TEXT');
            this.ensureColumn('punishments', 'level_severity', 'TEXT');
            this.ensureColumn('punishments', 'level_action', 'TEXT');
            this.ensureColumn('punishments', 'duration_str', 'TEXT');
            // Alderon ID de fato usado na ação em jogo (RCON) no momento do
            // strike (ver punishmentSystem._executeStrike) — pedido do dono,
            // 2026-08-11: "unstrike não está removendo ban ou mute em jogo".
            // Causa raiz: punishments nunca guardava o Alderon ID punido; o
            // /unstrike tinha que RE-DESCOBRIR esse valor via
            // getPlayerByDiscordId(punishment.user_id) na hora de desfazer —
            // que busca o vínculo GLOBAL ATUAL, não o AGID realmente banido.
            // Quando o staff informa `usuario` E `agid` explicitamente no
            // /strike (alvo sem /registrar, AGID passado à mão), esse
            // relookup não encontra vínculo nenhum e o unban/ServerUnmute
            // simplesmente não dispara — mesmo com a punição corretamente
            // marcada como anulada no banco. Null em punições aplicadas
            // antes desta coluna existir — handleUnstrikeConfirmation cai de
            // volta no relookup antigo nesse caso (melhor esforço, mesmo
            // comportamento de antes).
            this.ensureColumn('punishments', 'alderon_id', 'TEXT');
            // Quem aprovou (Supervisor), quando a punição exigiu aprovação —
            // pedido do dono, 2026-08-11: "Punições aprovadas por
            // supervisores devem indicar no registro quem aprovou". Antes só
            // aparecia na resposta efêmera de handleSupervisorApproval, nunca
            // gravado na punição em si. Null pra punições que não exigiram
            // aprovação nenhuma (a maioria).
            this.ensureColumn('punishments', 'approved_by', 'TEXT');
            // Exigência de aprovação de Supervisor configurável por nível
            // (plano Caçador) — ver punishmentLevels.js/premiumSystem.js
            // GUILD_LIMITS.customPunishmentApprovalEnabled.
            this.ensureColumn('punishment_levels', 'requires_supervisor_approval', 'INTEGER NOT NULL DEFAULT 0');

            // Novas métricas de staff analytics (moderação/eventos/modo
            // espectador) — ver analyticsSystem.js. CREATE TABLE IF NOT
            // EXISTS não adiciona coluna em bancos já existentes, daí o
            // ensureColumn de cada uma aqui.
            this.ensureColumn('staff_analytics', 'reports_joined', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'report_messages_count', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'report_response_seconds_sum', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'report_response_count', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'events_created', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'nametag_toggles_spectating', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'nametag_toggles_not_spectating', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'spectator_seconds', 'INTEGER DEFAULT 0');

            // Ativa/desativa uma imagem do pool sem removê-la de verdade
            // (pedido do dono: controle só dele, pelo dashboard, pra
            // esconder imagens do menu de escolha sem perder o cadastro) —
            // ver src/systems/pot/profileImagePool.js. Default 1: bancos já
            // existentes não perdem nenhuma imagem que já estava visível.
            this.ensureColumn('profile_image_pool', 'is_public', 'INTEGER NOT NULL DEFAULT 1');
            // Loja de Personalização (pedido do dono, 2026-08-07: "a loja
            // vai ser permitida a qualquer jogador, para comprar e
            // adicionar ao seu inventario imagens... quero que adicione
            // uma configuração para permitir que eu gerencie as imagens
            // como itens da loja, e quem pode usar ou só comprar") — por
            // item do pool: shop_price (Caçadas, NULL = item não está à
            // venda, continua só no menu grátis de sempre pro tier que já
            // tinha acesso) e shop_min_tier (tier mínimo pra USAR o item
            // depois de comprado — quem não atinge ainda fica só com ele
            // no inventário). Ver src/systems/pot/imageShopSystem.js.
            this.ensureColumn('profile_image_pool', 'shop_price', 'INTEGER');
            this.ensureColumn('profile_image_pool', 'shop_min_tier', 'TEXT');

            // Reforma das lojas (pedido do dono, 2026-08-12): marketplace de
            // imagens enviadas por jogador na Loja de Personalização —
            // submitted_by (Discord ID de quem enviou, NULL = curado pelo
            // dono), pending_review (aguardando aprovação, some do
            // catálogo até o dono aprovar/reprovar) e submission_fee
            // (Caçadas pagas no envio, guardado pra reembolso se reprovado).
            // requirement (JSON) é o requisito de resgate automático de
            // badge/titulo, que substitui a compra direta desses 2 tipos —
            // ver imageShopSystem.js/checkRequirementMet.
            this.ensureColumn('profile_image_pool', 'submitted_by', 'TEXT');
            this.ensureColumn('profile_image_pool', 'pending_review', 'INTEGER NOT NULL DEFAULT 0');
            this.ensureColumn('profile_image_pool', 'submission_fee', 'INTEGER');
            this.ensureColumn('profile_image_pool', 'requirement', 'TEXT');

            // Origem de cada item no inventário — 'purchase' (comprado com
            // Caçadas) ou 'redeemed' (badge/titulo resgatado por requisito
            // cumprido, sem custo). Só telemetria/auditoria por enquanto,
            // nada depende disso pra funcionar.
            this.ensureColumn('image_inventory', 'source', "TEXT NOT NULL DEFAULT 'purchase'");

            // Flag "Em breve" (pedido do dono, 2026-08-15) — INDEPENDENTE de
            // is_public: um item pode ficar público (visível na listagem da
            // Loja) e coming_soon ao mesmo tempo (compra/resgate bloqueados
            // até o dono desligar a flag). Ver profileImagePool.js#setComingSoon
            // e o bloqueio server-side em imageShopSystem.js.
            this.ensureColumn('profile_image_pool', 'coming_soon', 'INTEGER NOT NULL DEFAULT 0');

            // Conta quantas vezes o usuário já viu o avatar da sidebar do
            // dashboard web (pedido do dono, 2026-08-06: animação de
            // indicação no avatar só nos 3 primeiros acessos, mostrando que
            // dá pra clicar ali pra ir pro perfil) — ver
            // incrementDashboardAvatarHintViews abaixo e
            // web/views/partials/sidebar-v2.ejs.
            this.ensureColumn('users', 'dashboard_avatar_hint_views', 'INTEGER NOT NULL DEFAULT 0');

            // Colunas nunca lidas/escritas em lugar nenhum do código
            // (confirmado por auditoria) — schema.js já não as declara mais
            // pra bancos novos; isso aqui remove de bancos já existentes.
            // Idempotente (ver dropColumnIfExists): se a coluna já não
            // existir, ignora.
            this.dropColumnIfExists('users', 'is_bot');
            this.dropColumnIfExists('guilds', 'settings');
            this.dropColumnIfExists('activity_logs', 'ip_address');
            this.dropColumnIfExists('temporary_roles', 'punishment_guild_id');
            this.dropColumnIfExists('temporary_roles', 'punishment_number');
            // price_paid: adicionada e removida no mesmo dia (2026-08-16) —
            // era só pra sustentar a taxa de transferência de itens entre
            // servidores, que o dono decidiu remover (ver PREMIUM.txt
            // seção 205). Drop aqui limpa qualquer banco que já rodou a
            // migração de adição antes da remoção.
            this.dropColumnIfExists('game_shop_inventory', 'price_paid');

            // Itens customizados da Loja de Jogo (pedido do dono,
            // 2026-08-16: substitui o catálogo fixo GAME_SHOP_ITEMS por
            // criação livre de item por admin de servidor) — NULL nesta
            // coluna = linha antiga, ainda lida via item_key/
            // GAME_SHOP_ITEMS (catálogo fixo, mantido só pra resolver
            // inventário comprado antes da migração); preenchido = id em
            // pot_game_shop_items. Ver gameShopSystem.js.
            this.ensureColumn('game_shop_inventory', 'shop_item_id', 'INTEGER');

            // Mapa ATUAL do jogador em jogo (pedido do dono, 2026-08-18:
            // revisão de segurança do item de teleporte da Loja de Jogo —
            // as coordenadas de um item de teleporte só fazem sentido no
            // mapa configurado nele, e não havia NENHUMA verificação disso
            // na hora de usar). Preenchido oportunisticamente por
            // upsertPlayerFromEvent sempre que um payload de webhook trouxer
            // MapName/Map (mesmos campos já confirmados ao vivo em
            // extractLocationParts, webhookPayloads.js) — igual a
            // dinosaur_type/dinosaur_growth acima, eventos que não trazem o
            // campo NUNCA sobrescrevem com null, só mantém o último valor
            // conhecido. Ver potPlayerRegistry.js e
            // gameShopSystem.js#useGameShopItem.
            this.ensureColumn('pot_players', 'current_map', 'TEXT');

            // Renomeia os valores internos de tier de Server Premium já
            // gravados (pegada/fossil eram nomes de planejamento antigos —
            // ver PremiumSystem.GUILD_TIERS). Idempotente: depois da primeira
            // execução não sobra nenhuma linha 'pegada'/'fossil' pra migrar.
            this.migrateGuildPremiumTierNames();

            // Reforma das lojas (pedido do dono, 2026-08-12): unifica
            // avatar/background num tipo só (personalizacao) e tira preço
            // de badge/titulo (viram resgate por requisito, não compra
            // direta). Idempotente — ver comentário da função.
            this.migratePersonalizationShopUnification();

            // Renomeia o prefixo de identificação de reports (pedido do
            // dono, 2026-08-09: "Mudaremos o nome da identificação de
            // reportes... #r(numero) para #REP(NUMERO)") — reports.report_id
            // é coluna GERADA (ver schema.js), e SQLite não tem ALTER COLUMN
            // pra trocar a expressão de uma GENERATED existente: a única
            // forma é DROP + ADD de novo (mesmo padrão de ensureColumn/
            // dropColumnIfExists acima). VIRTUAL (não STORED): SQLite recusa
            // "ALTER TABLE ADD COLUMN" pra coluna GENERATED...STORED em
            // tabela já existente ("cannot add a STORED column") — erro
            // engolido silenciosamente pelo catch antigo de ensureColumn,
            // deixando reports.report_id ausente em produção pra sempre e
            // quebrando /moderacao, /reports e todo o report-chat (bug real,
            // 2026-08-09). VIRTUAL recalcula no SELECT em vez de gravar em
            // disco (sem diferença prática pra uma concatenação simples) e
            // pode sim ser adicionada via ALTER TABLE — schema.js usa o
            // mesmo VIRTUAL pra CREATE TABLE não divergir do ALTER aqui.
            this.dropColumnIfExists('reports', 'report_id');
            this.ensureColumn('reports', 'report_id', `TEXT GENERATED ALWAYS AS ('#REP' || report_number) VIRTUAL`);

            // As duas linhas acima rodam em TODO boot (idempotentes, mas não
            // um no-op puro: recriam a coluna sempre) — aceitável pro
            // tamanho de `reports` deste bot; ver comentário de
            // dropColumnIfExists/ensureColumn acima sobre o padrão geral.

            // Corrige o prefixo congelado nos 2 snapshots em TEXTO PLANO
            // (não gerados, então NÃO recalculados pelo passo acima) que
            // guardam o formato antigo desde antes desta troca —
            // punishments.report_id (gravado 1x em applyPunishment) e
            // reports.punishment (gravado 1x quando um strike é vinculado a
            // um report, ver punishmentSystem._executeStrike). Sem isso,
            // punições/reports antigos ficariam com o prefixo antigo pra
            // sempre, inconsistente com o resto do sistema. Guardas
            // "NOT LIKE" tornam idempotente (não reaplica em quem já foi migrado).
            this.migrateReportPunishmentIdPrefixes();

            // Ossos (Bones) virou saldo POR SERVIDOR (pedido do dono,
            // 2026-08-15) — migra o que sobrou de saldo GLOBAL antigo em
            // player_links.bones_balance pra pot_player_bones. Idempotente
            // (ver docblock do método): seguro rodar em todo boot.
            this.migrateBonesToPerGuild();

            console.log('📋 Schema do banco de dados criado');

        } catch (error) {
            console.error('❌ Erro ao criar tabelas:', error);
            throw error;
        }
    }

    // Migra os valores antigos de guild_premium.tier ('pegada'/'fossil') pros
    // nomes atuais ('rastreador'/'cacador') — ver PremiumSystem.GUILD_TIERS.
    // Idempotente: chamar em toda inicialização é seguro.
    migrateGuildPremiumTierNames() {
        try {
            this.db.prepare(`UPDATE guild_premium SET tier = 'rastreador' WHERE tier = 'pegada'`).run();
            this.db.prepare(`UPDATE guild_premium SET tier = 'cacador' WHERE tier = 'fossil'`).run();
        } catch (err) {
            // Tabela ainda não existe na primeiríssima execução — ignorar.
        }
    }

    // Reforma das lojas (pedido do dono, 2026-08-12: "Qualquer imagem da
    // loja, se adiquirido, agora pode ser usada como plano de fundo ou como
    // perfil, não vamos dividir o uso das mesmas" + "Emblemas e titulos não
    // vão ser itens compraveis"). Idempotente: depois da primeira execução
    // não sobra nenhuma linha 'avatar'/'background' nem shop_price em
    // badge/titulo pra migrar. Também garante a linha única (id=1) de
    // personalization_shop_config, pra getSubmissionFee/etc sempre
    // encontrarem uma config em vez de precisar de fallback espalhado pelo
    // código.
    migratePersonalizationShopUnification() {
        try {
            this.db.prepare(`UPDATE profile_image_pool SET type = 'personalizacao' WHERE type IN ('avatar', 'background')`).run();
            this.db.prepare(`UPDATE image_inventory SET pool_type = 'personalizacao' WHERE pool_type IN ('avatar', 'background')`).run();
            this.db.prepare(`UPDATE profile_image_pool SET shop_price = NULL, shop_min_tier = NULL WHERE type IN ('badge', 'titulo') AND shop_price IS NOT NULL`).run();
            this.db.prepare(`INSERT OR IGNORE INTO personalization_shop_config (id, submission_fee, accepting_submissions) VALUES (1, 500, 1)`).run();
        } catch (err) {
            // Tabela ainda não existe na primeiríssima execução — ignorar.
        }
    }

    // Corrige o prefixo antigo ('#R'/'Strike #') congelado nos snapshots em
    // texto plano de punishments.report_id e reports.punishment pro novo
    // ('#REP'/'Strike #ID' — pedido do dono, 2026-08-09). Guardas "NOT LIKE"
    // tornam idempotente: só afeta linhas ainda não migradas.
    migrateReportPunishmentIdPrefixes() {
        try {
            this.db.prepare(`
                UPDATE punishments SET report_id = '#REP' || substr(report_id, 3)
                WHERE report_id LIKE '#R%' AND report_id NOT LIKE '#REP%'
            `).run();
            this.db.prepare(`
                UPDATE reports SET punishment = 'Strike #ID' || substr(punishment, 9)
                WHERE punishment LIKE 'Strike #%' AND punishment NOT LIKE 'Strike #ID%'
            `).run();
        } catch (err) {
            // Tabela ainda não existe na primeiríssima execução — ignorar.
        }
    }

    // Migra Ossos (Bones) de GLOBAL (player_links.bones_balance) pra POR
    // SERVIDOR (pot_player_bones.balance) — reforma 2026-08-15, pedido do
    // dono: "vamos mudar os ossos, gostaria que ossos fossem um saldo por
    // servidor". Credita o saldo antigo no servidor onde o jogador tem o
    // MAIOR total_playtime em pot_players (melhor palpite disponível pra
    // associar um saldo GLOBAL antigo a UM servidor específico — decisão
    // confirmada com o dono) e zera bones_balance depois — é esse zerar
    // que torna o guard `bones_balance > 0` abaixo idempotente sozinho:
    // uma vez migrado, o jogador some do filtro e nunca é reprocessado.
    //
    // Jogador com bones_balance > 0 mas NENHUMA linha em pot_players pro
    // próprio alderon_id (nunca gerou evento de webhook em servidor
    // nenhum — ex: saldo concedido manualmente no passado) é PULADO, não
    // descartado: o saldo antigo fica intacto em player_links.bones_balance
    // até resolução manual, e continua reaparecendo neste mesmo guard em
    // todo boot subsequente até isso acontecer.
    //
    // Cada jogador migra na PRÓPRIA transação (credita + zera juntos, tudo
    // ou nada) — não uma transação só pro lote inteiro: uma falha
    // inesperada num jogador não deve impedir nem reverter o progresso já
    // feito nos outros, e o guard já torna seguro retomar de onde parou no
    // próximo boot de qualquer forma.
    migrateBonesToPerGuild() {
        if (!this.tableExists('player_links') || !this.tableExists('pot_player_bones') || !this.tableExists('pot_players')) return;
        try {
            const rows = this.db.prepare(`SELECT user_id, alderon_id, bones_balance FROM player_links WHERE bones_balance > 0`).all();
            if (rows.length === 0) return;

            const findBestGuild = this.db.prepare(`
                SELECT guild_id FROM pot_players WHERE alderon_id = ? ORDER BY total_playtime DESC LIMIT 1
            `);
            const creditGuild = this.db.prepare(`
                INSERT INTO pot_player_bones (user_id, guild_id, balance, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, guild_id) DO UPDATE SET
                    balance = balance + excluded.balance,
                    updated_at = excluded.updated_at
            `);
            const zeroOldBalance = this.db.prepare(`UPDATE player_links SET bones_balance = 0, updated_at = ? WHERE user_id = ?`);

            const migrateOne = this.db.transaction((row) => {
                const now = Math.floor(Date.now() / 1000);
                const best = findBestGuild.get(row.alderon_id);
                if (!best) {
                    console.warn(`⚠️ [Migração Ossos] ${row.user_id} (AGID ${row.alderon_id}) tem ${row.bones_balance} Ossos globais mas nenhuma atividade registrada em nenhum servidor (pot_players vazio) — saldo NÃO migrado, mantido intacto em player_links.bones_balance até resolução manual.`);
                    return;
                }
                creditGuild.run(row.user_id, best.guild_id, row.bones_balance, now);
                zeroOldBalance.run(now, row.user_id);
            });

            let migrated = 0;
            for (const row of rows) {
                migrateOne(row);
                migrated++;
            }
            console.log(`   📦 Migração Ossos: ${migrated} jogador(es) verificado(s) (saldo global -> por servidor)`);
        } catch (err) {
            console.error('❌ [Migração Ossos] Erro ao migrar saldos globais pra por servidor:', err.message);
        }
    }

    // Adiciona uma coluna a uma tabela existente se ela ainda não existir.
    // Idempotente: chamar em toda inicialização é seguro. Só engole os 2
    // erros ESPERADOS de "já não precisa fazer nada" (coluna duplicada,
    // tabela ainda não existe) — qualquer outro erro (ex: SQLite recusando
    // "cannot add a STORED column" pra uma GENERATED column, visto em
    // produção 2026-08-09, ver dropColumnIfExists('reports', 'report_id')
    // acima) agora aparece no log em vez de desaparecer silenciosamente
    // deixando a coluna ausente pra sempre sem nenhuma pista do motivo.
    ensureColumn(table, column, definition) {
        try {
            this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
            console.log(`   ✅ Coluna ${table}.${column} adicionada`);
        } catch (err) {
            const expected = /duplicate column name|no such table/i.test(err.message);
            if (!expected) {
                console.error(`   ❌ Falha ao adicionar coluna ${table}.${column}:`, err.message);
            }
        }
    }

    // Contrário de ensureColumn — remove uma coluna morta de uma tabela já
    // existente (schema.js sozinho só afeta bancos NOVOS, CREATE TABLE IF
    // NOT EXISTS não altera tabelas que já existem). Idempotente: se a
    // coluna já não existir (ou a tabela ainda não existir), ignora — mesmo
    // critério de erro esperado vs. inesperado do ensureColumn acima.
    // Requer SQLite ≥3.35 (ALTER TABLE ... DROP COLUMN) — a versão
    // empacotada com better-sqlite3 já é bem mais nova que isso.
    dropColumnIfExists(table, column) {
        try {
            this.db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
            console.log(`   🗑️ Coluna ${table}.${column} removida (não usada em nenhum lugar do código)`);
        } catch (err) {
            const expected = /no such column|no such table/i.test(err.message);
            if (!expected) {
                console.error(`   ❌ Falha ao remover coluna ${table}.${column}:`, err.message);
            }
        }
    }

    // Verificar se uma tabela existe
    tableExists(tableName) {
        const result = this.db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name = ?
        `).get(tableName);
        return !!result;
    }
    
    // Garantir que um usuário existe
    ensureUser(userId, username = null, discriminator = null, avatar = null) {
        // Verificar se a tabela existe
        if (!this.tableExists('users')) {
            console.warn('⚠️ Tabela users não existe, criando...');
            this.createAllTables();
        }
        
        const existing = this.prepare('SELECT user_id FROM users WHERE user_id = ?').get(userId);
        
        if (!existing) {
            this.prepare(`
                INSERT INTO users (user_id, username, discriminator, avatar, created_at, first_seen, last_seen)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId, 
                username || 'unknown', 
                discriminator || '0000', 
                avatar || null,
                Date.now(),
                Date.now(),
                Date.now()
            );
        } else if (username) {
            this.prepare(`
                UPDATE users SET 
                    username = COALESCE(?, username),
                    discriminator = COALESCE(?, discriminator),
                    avatar = COALESCE(?, avatar),
                    last_seen = ?
                WHERE user_id = ?
            `).run(username, discriminator, avatar, Date.now(), userId);
        } else {
            this.prepare(`UPDATE users SET last_seen = ? WHERE user_id = ?`).run(Date.now(), userId);
        }

        return true;
    }

    // Incrementa e devolve o novo total de vezes que o usuário viu o avatar
    // da sidebar do dashboard web — usado só pra decidir se ainda mostra a
    // animação de indicação (pedido do dono: só nos 3 primeiros acessos, ver
    // web/views/partials/sidebar-v2.ejs). ensureUser garante a linha antes
    // do UPDATE (usuário 100% web, que nunca rodou um comando no Discord,
    // pode chegar aqui sem ter passado por ensureUser antes).
    incrementDashboardAvatarHintViews(userId) {
        this.ensureUser(userId);
        this.prepare(`UPDATE users SET dashboard_avatar_hint_views = dashboard_avatar_hint_views + 1 WHERE user_id = ?`).run(userId);
        return this.prepare('SELECT dashboard_avatar_hint_views FROM users WHERE user_id = ?').get(userId)?.dashboard_avatar_hint_views || 0;
    }

    // Garantir que um servidor existe
    ensureGuild(guildId, name = null, icon = null, ownerId = null) {
        if (!this.tableExists('guilds')) {
            this.createAllTables();
        }
        
        const existing = this.prepare('SELECT guild_id FROM guilds WHERE guild_id = ?').get(guildId);
        
        if (!existing && name) {
            this.prepare(`
                INSERT INTO guilds (guild_id, name, icon, owner_id, joined_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(guildId, name, icon, ownerId, Date.now());
        } else if (name) {
            this.prepare(`
                UPDATE guilds SET 
                    name = COALESCE(?, name),
                    icon = COALESCE(?, icon),
                    owner_id = COALESCE(?, owner_id)
                WHERE guild_id = ?
            `).run(name, icon, ownerId, guildId);
        }
        
        return true;
    }
    
    // Registrar atividade
    logActivity(guildId, userId, action, targetId = null, details = null) {
        if (!this.tableExists('activity_logs')) {
            this.createAllTables();
        }

        const uuid = this.generateUUID();

        try {
            // guild_id é NOT NULL no schema, mas várias chamadas legítimas
            // não têm guild nenhuma (comandos de developer inerentemente
            // globais — /broadcast, /perfil-pool — passam null de
            // propósito, ver docblock deles). Sem esse fallback, TODA
            // dessas chamadas falhava em silêncio (catch abaixo engolia o
            // SqliteError de NOT NULL constraint) e nunca gravava nada —
            // bug real encontrado 2026-08-10 testando o /broadcast
            // reformulado. 'global' deixa essas linhas filtráveis/
            // reconhecíveis em vez de inventar um guild_id falso.
            this.prepare(`
                INSERT INTO activity_logs (uuid, guild_id, user_id, action, target_id, details, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(uuid, guildId || 'global', userId, action, targetId, details ? JSON.stringify(details) : null, Date.now());
        } catch (err) {
            console.error('❌ Erro ao registrar atividade:', err.message);
        }

        return uuid;
    }
    
    // Métodos principais
    prepare(sql) {
        if (!this.isConnected) {
            throw new Error('Banco de dados não está conectado');
        }
        return this.db.prepare(sql);
    }
    
    exec(sql) {
        if (!this.isConnected) {
            throw new Error('Banco de dados não está conectado');
        }
        return this.db.exec(sql);
    }
    
    transaction(fn) {
        if (!this.isConnected) {
            throw new Error('Banco de dados não está conectado');
        }
        return this.db.transaction(fn);
    }
    
    pragma(sql) {
        if (!this.isConnected) {
            throw new Error('Banco de dados não está conectado');
        }
        return this.db.pragma(sql);
    }
    
    close() {
        if (this.db) {
            this.db.close();
            this.isConnected = false;
        }
    }
    
    getStats() {
        if (!this.isConnected) return null;
        
        try {
            const tables = ['users', 'guilds', 'punishments', 'reports'];
            const stats = {};
            
            for (const table of tables) {
                if (this.tableExists(table)) {
                    const count = this.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
                    stats[table] = count.count;
                } else {
                    stats[table] = 0;
                }
            }
            
            const fileStats = fs.statSync(this.options.dbPath);
            
            return {
                tables: stats,
                fileSize: (fileStats.size / 1024 / 1024).toFixed(2) + ' MB',
                connected: this.isConnected
            };
        } catch (error) {
            return null;
        }
    }
}

// Singleton
let instance = null;

function getInstance(options = {}) {
    if (!instance) {
        instance = new DatabaseManager(options);
    }
    return instance;
}

const defaultInstance = getInstance();

// Exportar para compatibilidade
module.exports = defaultInstance.db;
module.exports.default = defaultInstance;
module.exports.DatabaseManager = DatabaseManager;
module.exports.getInstance = getInstance;
module.exports.generateUUID = () => defaultInstance.generateUUID();
module.exports.ensureUser = (userId, username, discriminator, avatar) =>
    defaultInstance.ensureUser(userId, username, discriminator, avatar);
module.exports.incrementDashboardAvatarHintViews = (userId) =>
    defaultInstance.incrementDashboardAvatarHintViews(userId);
module.exports.ensureGuild = (guildId, name, icon, ownerId) => 
    defaultInstance.ensureGuild(guildId, name, icon, ownerId);
module.exports.logActivity = (guildId, userId, action, targetId, details) =>
    defaultInstance.logActivity(guildId, userId, action, targetId, details);
module.exports.getStats = () => defaultInstance.getStats();