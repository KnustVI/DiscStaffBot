// /home/ubuntu/DiscStaffBot/src/systems/core/configSystem.js
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const imageManager = require('../../utils/imageManager');
const ProfileImagePool = require('../pot/profileImagePool');
const {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags
} = require('discord.js');

const cache = new Map();

let EMOJIS = {};
try {
    const emojisFile = require('../../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

/**
 * Definição dos 3 grupos (abas) do painel /config roles — separados porque
 * um único painel com os 6 RoleSelectMenus (staff, strike, exemplar,
 * problematico, supervisor, event) ultrapassaria a quantidade segura de
 * ActionRows por mensagem. Cada aba tem no máximo 3 selects + 1 linha de
 * botões de navegação + o container = 5 componentes de topo, mesmo padrão
 * já usado em /config logs.
 */
const ROLE_TABS = {
    automod: {
        label: 'Cargos Automáticos',
        icon: 'trendingup',
        headerTitle: '# CARGOS AUTOMÁTICOS - REPUTAÇÃO',
        headerDesc: 'Estes cargos são atribuídos e removidos automaticamente pelo sistema de reputação — não é necessário atribuí-los manualmente. Detalhes de cada um abaixo.',
        // Só a parte que NÃO está em nenhuma descrição de campo: o corte por
        // plano. "Atribuído automaticamente" já está no headerDesc acima E
        // em cada campo, não repete aqui.
        headerNote: `**Sobre o plano:** o cargo de **Strike (Temporário)** funciona em qualquer plano. Já **Exemplar** e **Problemático** só passam a ser atribuídos de verdade a partir do **Caçador** — em Free e Rastreador dá pra configurar os cargos aqui, mas o Automod diário que os aplica só roda no Caçador (use \`/premium\` pra saber mais).`,
        fields: [
            {
                key: 'strike_role', icon: 'shieldalert', label: 'Strike (Temporário)',
                desc: 'Atribuído automaticamente enquanto uma punição temporária está ativa. Removido quando a punição expira ou é anulada.',
                customId: 'config-roles:strike',
            },
            {
                key: 'role_exemplar', icon: 'sparkles', label: 'Exemplar',
                desc: 'Atribuído automaticamente a membros com reputação acima do limite configurado em /config punishments. Indica bom comportamento.',
                customId: 'config-roles:exemplar',
            },
            {
                key: 'role_problematico', icon: 'trianglealert', label: 'Problemático',
                desc: 'Atribuído automaticamente a membros com reputação abaixo do limite configurado em /config punishments. Sinaliza comportamento problemático.',
                customId: 'config-roles:problematico',
            },
        ],
    },
    moderation: {
        label: 'Moderação',
        icon: 'shieldcheck',
        headerTitle: '# CARGOS DE MODERAÇÃO',
        headerDesc: 'Cargos que controlam quem pode usar os comandos de moderação e quem pode aprovar as punições mais severas. Detalhes de cada um abaixo.',
        // Só o que NÃO está em nenhuma descrição de campo: não precisa ser
        // um cargo "oficial", e o limite por campo varia com o plano.
        headerNote: 'Não precisam ser (nem representar) um cargo "oficial" do servidor — servem só para o bot saber quem tem permissão pra cada comando. O número de cargos permitido por campo varia com o plano (use `/premium` pra aumentar).',
        fields: [
            {
                key: 'staff_role', icon: 'shield', label: 'Moderador (obrigatório)',
                desc: 'Permite usar os comandos de moderação (/strike, /unstrike, /historico) e atender reports no ReportChat. Sem pelo menos um cargo configurado aqui, a staff não consegue usar o sistema. Também conta como staff para a checagem de horas em modo espectador (analytics, plano Caçador).',
                customId: 'config-roles:staff',
                roleLimitKey: 'moderador',
            },
            {
                key: 'supervisor_role', icon: 'shieldban', label: 'Supervisor',
                desc: 'Tem autoridade para aprovar ou aplicar diretamente punições severas (níveis de severidade Grave ou Severa, ou qualquer punição com duração maior que 72h/permanente). Quando um Staff comum aplica uma punição nessas condições, o pedido é enviado para este cargo aprovar no canal de log de punições antes de ser executado. Também conta como staff para horas em modo espectador (analytics, plano Caçador).',
                customId: 'config-roles:supervisor',
                roleLimitKey: 'supervisor',
            },
        ],
    },
    events: {
        label: 'Eventos',
        icon: 'partypopper',
        headerTitle: '# CARGOS DE EVENTOS',
        // Sem headerNote aqui de propósito: as 3 descrições de campo abaixo
        // já cobrem tudo (quem usa, quem é avisado, e o corte por plano do
        // canal de anúncios) — um texto genérico a mais só repetiria.
        headerDesc: 'Cargos usados pelo comando /evento: quem pode criar eventos, e quem é avisado quando um novo evento é publicado. Detalhes de cada um abaixo.',
        fields: [
            {
                key: 'event_role', icon: 'calendardays', label: 'Equipe de Eventos',
                desc: 'Permite usar o comando /evento para criar e publicar eventos da comunidade. Também conta como staff para horas em modo espectador (analytics, plano Caçador).',
                customId: 'config-roles:event',
                roleLimitKey: 'event',
            },
            {
                key: 'event_notify_role', icon: 'megaphone', label: 'Notificação de Eventos',
                desc: 'Marcado automaticamente na postagem do fórum sempre que um novo evento é publicado, para avisar quem tem interesse. Não precisa ter permissão nenhuma, é só um cargo de avisos — NÃO conta como staff (fica de fora do sistema de analytics/purge).',
                customId: 'config-roles:event-notify',
                roleLimitKey: 'eventNotify',
            },
            {
                key: 'event_announce_channel', icon: 'megaphone', label: 'Canal de Anúncios de Eventos',
                desc: 'Canal onde o bot anuncia automaticamente a criação, o início e o encerramento de cada evento, marcando o cargo de Notificação de Eventos acima. Os mesmos avisos também aparecem na postagem do evento. Exclusivo do plano Caçador.',
                customId: 'config-roles:event-announce-channel',
                type: 'channel',
                tierRequired: 'cacador',
            },
        ],
    },
};

// Chaves de cargo que contam como "staff" pra fins de analytics (horas de
// espectador, log de ganho/perda de cargo, purge de histórico ao ficar sem
// nenhum deles) — ver guildMemberUpdate.js e analyticsSystem.js.
// event_notify_role fica de fora de propósito: é só um cargo de avisos.
const STAFF_ROLE_KEYS = ['staff_role', 'supervisor_role', 'event_role'];

const ROLE_LABELS = Object.fromEntries(
    Object.values(ROLE_TABS).flatMap(tab => tab.fields.map(f => [f.key, f.label])),
);

/**
 * Definição dos 3 canais do painel /config logs — mesmo padrão de
 * ROLE_TABS.fields, um select embutido no container logo abaixo da
 * descrição/status de cada canal (ver refreshLogsPanel).
 */
const LOG_FIELDS = [
    {
        key: 'log_channel', icon: 'megaphone', label: 'Geral / AutoMod',
        desc: 'Recebe logs de alterações de configuração, atualizações de sistema, eventos diversos e o relatório diário de AutoModeração (recuperação de pontos, cargos atribuídos/removidos, ranking de staff).',
        customId: 'config-logs:geral',
    },
    {
        key: 'log_punishments', icon: 'gavel', label: 'Punições',
        desc: 'Recebe logs relacionados a strikes, unstrikes, ajustes de reputação e ações disciplinares.',
        customId: 'config-logs:punishments',
    },
    {
        key: 'log_reports', icon: 'ticket', label: 'ReportChat',
        desc: 'Recebe logs de reports feitos pelos usuários. É onde fica o painel de atendimento dos staffs.',
        customId: 'config-logs:reports',
    },
    {
        key: 'log_staff', icon: 'shield', label: 'Staff',
        desc: 'Recebe tudo relacionado à equipe: ganho/perda dos cargos de staff (Moderador/Supervisor/Equipe de Eventos), aviso quando um staff perde o histórico por ficar sem nenhum desses cargos, e a análise diária de staff (plano Caçador).',
        customId: 'config-logs:staff',
    },
];

/**
 * Pool de fotos genéricas (assets/images/FOTO PERFIL 01..12.webp) — usado
 * SÓ pelos banners de /config reportchat/strike/unstrike (ver
 * REPORT_CHAT_BANNER_OPTIONS/STRIKE_BANNER_OPTIONS/UNSTRIKE_BANNER_OPTIONS
 * abaixo), que continuam vindo de arquivo estático via imageManager. NÃO é
 * mais usado pelos pickers de /perfil-edit (avatar/plano de fundo) — essas
 * mesmas 12 fotos foram migradas pro pool DINÂMICO de plano de fundo
 * (profile_image_pool, tipo 'background' — ver migrate-fotos-plano-fundo.js
 * e getBackgroundOptions abaixo), a pedido do dono: elas passam a ser SÓ
 * plano de fundo, não aparecem mais como opção de avatar. As fotos padrão de
 * cada tier (foto_perfil_free/compy/raptor) ficam DE FORA dessa lista: são
 * os fallbacks fixos de quando ninguém escolheu nada (ver DEFAULT_CARD_
 * PHOTOS em playerRegistrationSystem.js), não faz sentido oferecê-las como
 * opção pra "trocar por" — dono pediu remoção por serem repetidas.
 */
const PLAYER_PHOTO_OPTIONS = [
    { value: 'foto_perfil_01', label: 'Planeta Âmbar' },
    { value: 'foto_perfil_02', label: 'Suchomimus' },
    { value: 'foto_perfil_03', label: 'Desert Hunt' },
    { value: 'foto_perfil_04', label: 'Rex Beach' },
    { value: 'foto_perfil_05', label: 'Green Trike' },
    { value: 'foto_perfil_06', label: 'Yuty Look' },
    { value: 'foto_perfil_07', label: 'Yuty Snow' },
    { value: 'foto_perfil_08', label: "Parassaur's Forest" },
    { value: 'foto_perfil_09', label: 'Desert Migration' },
    { value: 'foto_perfil_10', label: 'Family Hunt' },
    { value: 'foto_perfil_11', label: 'Forest Lurker' },
    { value: 'foto_perfil_12', label: 'Trike Family' },
];

/**
 * Opções de avatar/plano de fundo/emblema pro /perfil-edit — 100% vindas do
 * pool DINÂMICO (profile_image_pool, alimentado via /perfil-pool no bot
 * developer — ver profileImagePool.js), sem nenhum pool estático hardcoded
 * por trás. Cada entrada usa "pool:<id>" como value (distingue de uma chave
 * estática do imageManager, ainda usada em OUTROS pickers — ver
 * PLAYER_PHOTO_OPTIONS acima). Recalculado a cada chamada (nunca cacheado)
 * — o pool pode mudar a qualquer momento. Limitado a 25 (limite de opções
 * de um StringSelectMenu do Discord). Os 3 pools começam vazios até o dono
 * cadastrar imagens; avatar/emblema seguem vazios até então, plano de fundo
 * já vem seeded com as 12 fotos genéricas migradas (ver
 * migrate-fotos-plano-fundo.js).
 */
function _poolOptions(poolType) {
    return ProfileImagePool.listImages(poolType).map(row => ({
        value: ProfileImagePool.toPoolValue(row.id),
        label: row.label,
    })).slice(0, 25);
}
function getAvatarOptions() {
    return _poolOptions('avatar');
}
function getBackgroundOptions() {
    return _poolOptions('background');
}
function getBadgeOptions() {
    return _poolOptions('badge');
}

/**
 * Opções de banner pro painel de /config reportchat (Caçador) — a primeira
 * ("Padrão do bot") reseta pra imagem original; as demais são o pool de
 * fotos genéricas acima, reaproveitado aqui em vez de pedir upload próprio.
 */
const REPORT_CHAT_BANNER_OPTIONS = [
    { value: 'title_report_chat', label: 'Padrão do bot' },
    ...PLAYER_PHOTO_OPTIONS,
];

/**
 * Opções de banner de /strike e /unstrike (painel de aplicação/anulação de
 * punição) — /config personalizar, exclusivo Caçador. Mesmo pool de fotos
 * genéricas reaproveitado acima, cada lista só troca a opção "Padrão do bot"
 * pelo banner original de cada painel (ver punishmentSystem.js).
 */
const STRIKE_BANNER_OPTIONS = [
    { value: 'title_strike', label: 'Padrão do bot' },
    ...PLAYER_PHOTO_OPTIONS,
];
const UNSTRIKE_BANNER_OPTIONS = [
    { value: 'title_strike_removido', label: 'Padrão do bot' },
    ...PLAYER_PHOTO_OPTIONS,
];

const ConfigSystem = {
    STAFF_ROLE_KEYS,
    PLAYER_PHOTO_OPTIONS,

    getSetting(guildId, key) {
        try {
            const cacheKey = `${guildId}_${key}`;
            if (cache.has(cacheKey)) return cache.get(cacheKey);
            const row = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key);
            const val = row ? row.value : null;
            cache.set(cacheKey, val);
            return val;
        } catch (error) {
            console.error(`❌ Erro ao buscar configuração ${key}:`, error);
            return null;
        }
    },

    setSetting(guildId, key, value) {
        try {
            const finalValue = value?.toString() || null;
            db.prepare(`
                INSERT INTO settings (guild_id, key, value)
                VALUES (?, ?, ?)
                ON CONFLICT(guild_id, key)
                DO UPDATE SET value = excluded.value
            `).run(guildId, key, finalValue);
            cache.set(`${guildId}_${key}`, finalValue);
            return true;
        } catch (error) {
            console.error(`❌ Erro ao salvar configuração ${key}:`, error);
            return false;
        }
    },

    /**
     * Cargos de config-roles agora suportam múltiplos IDs por categoria
     * (moderação/eventos — ver ROLE_TABS). O valor é gravado na MESMA chave
     * de settings de sempre, só que como um array serializado em JSON, em
     * vez de um único ID cru — migração transparente: um valor antigo
     * (ID cru, não-JSON) é lido como array de 1 elemento, sem precisar de
     * script de migração nenhum.
     */
    getRoleIds(guildId, key) {
        const raw = this.getSetting(guildId, key);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch (err) {
            // Valor antigo era um ID de cargo cru (não-JSON) — cai no fallback abaixo.
        }
        return [raw];
    },

    setRoleIds(guildId, key, roleIds) {
        return this.setSetting(guildId, key, JSON.stringify(roleIds));
    },

    memberHasConfiguredRole(guildId, member, key) {
        const ids = this.getRoleIds(guildId, key);
        return ids.length > 0 && ids.some(id => member?.roles?.cache?.has(id));
    },

    mentionRoles(guildId, key) {
        const ids = this.getRoleIds(guildId, key);
        return ids.length > 0 ? ids.map(id => `<@&${id}>`).join(' ') : 'nenhum cargo configurado';
    },

    /**
     * True se o membro tem QUALQUER um dos 3 cargos que contam como staff
     * pra fins de analytics (Moderador/Supervisor/Equipe de Eventos — ver
     * STAFF_ROLE_KEYS). Usado pela checagem de horas de espectador e pelo
     * gatilho de purge em guildMemberUpdate.js.
     */
    memberHasAnyStaffRole(guildId, member) {
        return STAFF_ROLE_KEYS.some(key => this.memberHasConfiguredRole(guildId, member, key));
    },

    /**
     * Retorna o canal de log "Geral / AutoMod" unificado.
     *
     * ✅ UNIFICAÇÃO: Geral e AutoMod agora compartilham o mesmo canal,
     * configurado pela chave 'log_channel'. A chave antiga 'log_automod'
     * é mantida como FALLBACK LEGADO apenas: se um servidor antigo já
     * tinha um canal de AutoMod configurado separadamente e nunca
     * configurou 'log_channel', ainda usamos o valor antigo para não
     * quebrar quem já estava em produção. Novas configurações sempre
     * gravam em 'log_channel' (ver setLogChannel).
     *
     * @param {string} guildId
     * @returns {string|null}
     */
    getUnifiedGeneralLogChannel(guildId) {
        const current = this.getSetting(guildId, 'log_channel');
        if (current) return current;
        return this.getSetting(guildId, 'log_automod'); // fallback legado
    },

    /**
     * Envia um registro de "configuração alterada" para o canal de log
     * Geral (mesmo canal usado pelo relatório diário do AutoMod — ver
     * getUnifiedGeneralLogChannel). Usado por qualquer comando
     * administrativo que altere uma configuração do servidor.
     *
     * Falha silenciosamente se o canal não estiver configurado ou não
     * puder ser alcançado — mesmo padrão usado nos demais envios de log.
     *
     * @param {import('discord.js').Interaction} interaction
     * @param {string|string[]} lines - Linha(s) descrevendo a alteração
     */
    async logConfigChange(interaction, lines) {
        const entries = Array.isArray(lines) ? lines : [lines];
        if (entries.length === 0) return;

        try {
            const logChannelId = this.getUnifiedGeneralLogChannel(interaction.guildId);
            if (!logChannelId) return;

            const channel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
            if (!channel) return;

            // Cor/footer customizados (aba "Aparência Geral" de /config
            // personalizar) — este é o log "Geral", usado por praticamente
            // todo comando administrativo que altera uma configuração.
            const personalization = this.getPanelPersonalization(interaction.guildId);
            const builder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.DEFAULT });
            builder.title(`${EMOJIS.settings || '⚙️'} Configuração Alterada`);
            builder.text(`**Responsável:** ${interaction.user}`);
            builder.separator();
            builder.block(entries);
            if (personalization.footerText) builder.footerRaw(personalization.footerText);
            else builder.footer(interaction.guild.name);

            const { components, flags } = builder.build();
            await channel.send({ components, flags: [flags] });
        } catch (error) {
            console.error('❌ Erro ao enviar log de alteração de configuração:', error);
        }
    },

    getMany(guildId, keys = []) {
        const result = {};
        for (const key of keys) {
            result[key] = this.getSetting(guildId, key);
        }
        return result;
    },

    clearCache(guildId) {
        try {
            for (const key of cache.keys()) {
                if (key.startsWith(`${guildId}_`)) cache.delete(key);
            }
        } catch (error) {
            console.error(`❌ Erro ao limpar cache:`, error);
        }
    },

    async handleComponent(interaction, action, param) {
        try {
            const customId = interaction.customId;

            if (customId === 'perfil-edit:background') {
                await this.handlePlayerBackgroundSelect(interaction);
                return;
            }
            if (customId === 'perfil-edit:badge') {
                await this.handlePlayerBadgeSelect(interaction);
                return;
            }
            if (customId === 'perfil-edit:photo-info') {
                await this.handlePerfilEditInfoButton(interaction, 'photo');
                return;
            }
            if (customId === 'perfil-edit:background-info') {
                await this.handlePerfilEditInfoButton(interaction, 'background');
                return;
            }
            if (customId === 'perfil-edit:badge-info') {
                await this.handlePerfilEditInfoButton(interaction, 'badge');
                return;
            }
            if (customId === 'perfil-edit:hide-kda-toggle') {
                await this.handleHideKdaToggle(interaction);
                return;
            }
            if (customId === 'perfil-edit:background-remove') {
                await this.handleRemoveBackground(interaction);
                return;
            }
            if (customId === 'perfil-edit:photo') {
                await this.handlePlayerPhotoSelect(interaction);
                return;
            }
            if (customId.startsWith('config-punishments:limites')) {
                await this.handleLimitesModal(interaction);
                return;
            }
            if (customId.startsWith('config-punishments:recovery')) {
                await this.handleRecoveryModal(interaction);
                return;
            }
            if (customId.startsWith('config-punishments:level:toggle_approval:')) {
                const levelId = customId.split(':')[3];
                await this.handleToggleLevelApproval(interaction, levelId);
                return;
            }
            if (customId.startsWith('config-punishments:level:delete_confirm:')) {
                const levelId = customId.split(':')[3];
                await this.confirmDeleteLevel(interaction, levelId);
                return;
            }
            if (customId.startsWith('config-punishments:level:delete_cancel:')) {
                await this.cancelDeleteLevel(interaction);
                return;
            }
            if (customId.startsWith('config-punishments:level:delete:')) {
                const levelId = customId.split(':')[3];
                await this.handleDeleteLevelButton(interaction, levelId);
                return;
            }
            if (customId === 'config-punishments:reset') {
                await this.resetPoints(interaction);
                return;
            }
            if (customId.startsWith('config-punishments:tab:')) {
                const tab = customId.split(':')[2];
                await this.refreshPointsPanel(interaction, null, interaction.guild.name, tab);
                return;
            }
            if (customId === 'config-roles:staff') {
                await this.setRoles(interaction, 'staff_role');
                return;
            }
            if (customId === 'config-roles:strike') {
                await this.setRoles(interaction, 'strike_role');
                return;
            }
            if (customId === 'config-roles:exemplar') {
                await this.setRoles(interaction, 'role_exemplar');
                return;
            }
            if (customId === 'config-roles:problematico') {
                await this.setRoles(interaction, 'role_problematico');
                return;
            }
            if (customId === 'config-roles:supervisor') {
                await this.setRoles(interaction, 'supervisor_role');
                return;
            }
            if (customId === 'config-roles:event') {
                await this.setRoles(interaction, 'event_role');
                return;
            }
            if (customId === 'config-roles:event-notify') {
                await this.setRoles(interaction, 'event_notify_role');
                return;
            }
            if (customId === 'config-roles:event-announce-channel') {
                await this.setEventAnnounceChannel(interaction);
                return;
            }
            if (customId.startsWith('config-roles:tab:')) {
                const tab = customId.split(':')[2];
                await this.refreshRolesPanel(interaction, null, tab);
                return;
            }
            if (customId === 'config-logs:geral') {
                // ✅ UNIFICADO: este select agora cobre Geral + AutoMod.
                await this.setLogChannel(interaction, 'log_channel');
                return;
            }
            if (customId === 'config-logs:punishments') {
                await this.setLogChannel(interaction, 'log_punishments');
                return;
            }
            if (customId === 'config-logs:reports') {
                await this.setLogChannel(interaction, 'log_reports');
                return;
            }
            if (customId === 'config-logs:staff') {
                await this.setLogChannel(interaction, 'log_staff');
                return;
            }
            if (customId === 'config-logs:criar') {
                await this.confirmCreateLogChannels(interaction);
                return;
            }
            if (customId === 'config-logs:criar:confirm') {
                await this.createLogChannels(interaction);
                return;
            }
            if (customId === 'config-logs:criar:cancel') {
                await this.refreshLogsPanel(interaction, `${EMOJIS.circlealert || '❌'} Criação automática cancelada.`, interaction.guild.name);
                return;
            }
            if (customId === 'config-personalizar:strike-banner') {
                await this.handleStrikeBannerSelect(interaction);
                return;
            }
            if (customId === 'config-personalizar:unstrike-banner') {
                await this.handleUnstrikeBannerSelect(interaction);
                return;
            }
            if (customId === 'config-personalizar:reportchat-banner') {
                await this.handleReportChatBannerSelect(interaction);
                return;
            }
            if (customId === 'config-personalizar:reportchat-message:modal') {
                await this.handleReportChatMessageModal(interaction);
                return;
            }
            if (customId === 'config-personalizar:reportchat-welcome:modal') {
                await this.handleReportChatWelcomeModal(interaction);
                return;
            }
            if (customId === 'config-personalizar:reportchat-reset') {
                await this.resetReportChat(interaction);
                return;
            }
            if (customId === 'config-personalizar:aparencia-color:modal') {
                await this.handlePanelColorModal(interaction);
                return;
            }
            if (customId === 'config-personalizar:aparencia-footer:modal') {
                await this.handlePanelFooterModal(interaction);
                return;
            }
            if (customId === 'config-personalizar:aparencia-reset') {
                await this.resetPanelPersonalization(interaction);
                return;
            }
            if (customId.startsWith('config-personalizar:tab:')) {
                const tab = customId.split(':')[2];
                await this.refreshPersonalizarPanel(interaction, null, interaction.guild.name, tab);
                return;
            }

            await ResponseManager.error(interaction, `Ação não reconhecida: ${customId}`);
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await ResponseManager.error(interaction, 'Ocorreu um erro ao processar a configuração.');
        }
    },

    async handleModal(interaction, action) {
        try {
            if (interaction.customId === 'config-punishments:level:create:modal:submit') {
                await this.processCreateLevelModal(interaction);
                return;
            }
            if (interaction.customId.startsWith('config-punishments:level:edit:modal:submit:')) {
                const levelId = interaction.customId.split(':')[5];
                await this.processEditLevelModal(interaction, levelId);
                return;
            }
            if (interaction.customId === 'config-punishments:limites:modal:submit') {
                await this.processLimitesModal(interaction);
                return;
            }
            if (interaction.customId === 'config-punishments:recovery:modal:submit') {
                await this.processRecoveryModal(interaction);
                return;
            }
            if (interaction.customId === 'config-personalizar:reportchat-message:modal:submit') {
                await this.processReportChatMessageModal(interaction);
                return;
            }
            if (interaction.customId === 'config-personalizar:reportchat-welcome:modal:submit') {
                await this.processReportChatWelcomeModal(interaction);
                return;
            }
            if (interaction.customId === 'config-personalizar:aparencia-color:modal:submit') {
                await this.processPanelColorModal(interaction);
                return;
            }
            if (interaction.customId === 'config-personalizar:aparencia-footer:modal:submit') {
                await this.processPanelFooterModal(interaction);
                return;
            }
            if (interaction.customId === 'perfil-edit:title:modal:submit') {
                await this.processTitleModal(interaction);
                return;
            }
            await ResponseManager.error(interaction, 'Modal não reconhecido.');
        } catch (error) {
            console.error('❌ Erro no handleModal:', error);
            await ResponseManager.error(interaction, 'Ocorreu um erro ao processar o modal.');
        }
    },

    /**
     * Modal (5 campos) usado tanto pra criar quanto pra editar um nível de
     * punição customizado — a única diferença é o customId de submit (carrega
     * o ID do nível quando é edição) e os valores pré-preenchidos.
     */
    _buildLevelModal(customId, title, existing = null) {
        const rows = [
            new ActionRowBuilder().addComponents(new TextInputBuilder({
                customId: 'level_name', label: 'Nome', style: TextInputStyle.Short,
                required: true, value: existing?.name || '', placeholder: 'Ex: Spam no chat',
            })),
            new ActionRowBuilder().addComponents(new TextInputBuilder({
                customId: 'level_severity', label: 'Severidade (Leve/Moderada/Grave/Severa)', style: TextInputStyle.Short,
                required: true, value: existing?.severity || '', placeholder: 'Leve',
            })),
            new ActionRowBuilder().addComponents(new TextInputBuilder({
                customId: 'level_points', label: 'Pontos de reputação perdidos (0-100)', style: TextInputStyle.Short,
                required: true, value: existing ? String(existing.points) : '', placeholder: 'Ex: 10',
            })),
            new ActionRowBuilder().addComponents(new TextInputBuilder({
                customId: 'level_duration', label: 'Duração (Ex: 10m, 1h, 3d — vazio = perm.)', style: TextInputStyle.Short,
                required: false, value: existing?.duration_str || '', placeholder: 'Vazio = permanente',
            })),
            new ActionRowBuilder().addComponents(new TextInputBuilder({
                customId: 'level_action', label: 'Ação (SystemMessage/Kick/Ban/ServerMute)', style: TextInputStyle.Short,
                required: false, value: existing?.action || '', placeholder: 'Vazio = nenhuma',
            })),
        ];
        return new ModalBuilder({ customId, title, components: rows });
    },

    async handleCreateLevelModal(interaction) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }

        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.isGuildAtLeast(interaction.guildId, 'rastreador')) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(interaction.guildId));
        }

        const PunishmentLevels = require('../moderation/punishmentLevels');
        if (!PunishmentLevels.canCreateLevel(interaction.guildId)) {
            return await ResponseManager.error(interaction, `Limite de níveis do seu plano atingido (${PunishmentLevels.countLevels(interaction.guildId)}/${PunishmentLevels.getLevelLimit(interaction.guildId)}). Use /premium para ver planos com mais níveis.`);
        }

        const modal = this._buildLevelModal('config-punishments:level:create:modal:submit', 'Criar Nível de Punição');
        await interaction.showModal(modal);
    },

    async handleEditLevelModal(interaction, levelId) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }

        const PunishmentLevels = require('../moderation/punishmentLevels');
        const level = PunishmentLevels.getLevel(interaction.guildId, levelId);
        if (!level) {
            return await ResponseManager.error(interaction, 'Este nível não existe mais.');
        }

        const modal = this._buildLevelModal(`config-punishments:level:edit:modal:submit:${levelId}`, `Editar Nível: ${level.name}`, level);
        await interaction.showModal(modal);
    },

    async handleLimitesModal(interaction) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }

        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.getGuildLimits(interaction.guildId).automodEnabled) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(interaction.guildId));
        }

        const guildId = interaction.guildId;
        const exemplarLimit = parseInt(this.getSetting(guildId, 'limit_exemplar')) || 95;
        const problematicLimit = parseInt(this.getSetting(guildId, 'limit_problematico')) || 30;
        
        const rows = [
            new ActionRowBuilder().addComponents(new TextInputBuilder({ customId: 'exemplar_limit', label: 'Limite Exemplar (50-100)', style: TextInputStyle.Short, required: true, value: exemplarLimit.toString(), placeholder: 'Ex: 95' })),
            new ActionRowBuilder().addComponents(new TextInputBuilder({ customId: 'problematic_limit', label: 'Limite Problematico (0-50)', style: TextInputStyle.Short, required: true, value: problematicLimit.toString(), placeholder: 'Ex: 30' }))
        ];
        
        const modal = new ModalBuilder({ customId: 'config-punishments:limites:modal:submit', title: 'Configurar Limites', components: rows });
        await interaction.showModal(modal);
    },

    async handleRecoveryModal(interaction) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }

        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.getGuildLimits(interaction.guildId).automodEnabled) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(interaction.guildId));
        }

        const guildId = interaction.guildId;
        const recoveryAmount = parseInt(this.getSetting(guildId, 'rep_recovery_amount')) || 1;

        const row = new ActionRowBuilder().addComponents(
            new TextInputBuilder({
                customId: 'recovery_amount',
                label: 'Pontos recuperados por dia (0-100)',
                style: TextInputStyle.Short,
                required: true,
                value: recoveryAmount.toString(),
                placeholder: 'Ex: 1',
            })
        );

        const modal = new ModalBuilder({ customId: 'config-punishments:recovery:modal:submit', title: 'Recuperação Diária de Reputação', components: [row] });
        await interaction.showModal(modal);
    },

    async processRecoveryModal(interaction) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.getGuildLimits(interaction.guildId).automodEnabled) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(interaction.guildId));
        }

        const recoveryAmount = parseInt(interaction.fields.getTextInputValue('recovery_amount'));
        if (isNaN(recoveryAmount) || recoveryAmount < 0 || recoveryAmount > 100) {
            return await ResponseManager.error(interaction, 'A recuperação diária deve ser um número entre 0 e 100.');
        }

        const oldValue = this.getSetting(interaction.guildId, 'rep_recovery_amount');
        this.setSetting(interaction.guildId, 'rep_recovery_amount', recoveryAmount.toString());
        this.clearCache(interaction.guildId);

        const changeMessage = oldValue != recoveryAmount
            ? `${EMOJIS.circlecheck || '✅'} **Recuperação diária atualizada:** \`${oldValue || 1}\` → \`${recoveryAmount}\` ponto(s)/dia.`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (oldValue != recoveryAmount) await this.logConfigChange(interaction, [`${EMOJIS.trendingup || '📈'} Recuperação diária: \`${oldValue || 1}\` → \`${recoveryAmount}\` ponto(s)/dia`]);
        await this.refreshPointsPanel(interaction, changeMessage, interaction.guild.name, 'reputation');
    },

    _readLevelModalFields(interaction) {
        return {
            name: interaction.fields.getTextInputValue('level_name'),
            severity: interaction.fields.getTextInputValue('level_severity'),
            points: interaction.fields.getTextInputValue('level_points'),
            durationStr: interaction.fields.getTextInputValue('level_duration'),
            action: interaction.fields.getTextInputValue('level_action'),
        };
    },

    async processCreateLevelModal(interaction) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.isGuildAtLeast(interaction.guildId, 'rastreador')) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(interaction.guildId));
        }

        const PunishmentLevels = require('../moderation/punishmentLevels');
        if (!PunishmentLevels.canCreateLevel(interaction.guildId)) {
            return await ResponseManager.error(interaction, `Limite de níveis do seu plano atingido (${PunishmentLevels.countLevels(interaction.guildId)}/${PunishmentLevels.getLevelLimit(interaction.guildId)}).`);
        }

        const { valid, errors, data } = PunishmentLevels.validateLevelInput(this._readLevelModalFields(interaction));
        if (!valid) {
            return await ResponseManager.error(interaction, errors.join('\n'));
        }

        const level = PunishmentLevels.createLevel(interaction.guildId, data, interaction.user.id);
        await this.logConfigChange(interaction, [`${EMOJIS.gavel || '⚖️'} Nível de punição criado: **${level.name}** (${level.severity}, ${level.points} pts)`]);
        await this.refreshPointsPanel(interaction, `${EMOJIS.circlecheck || '✅'} Nível **${level.name}** criado!`, interaction.guild.name, 'levels');
    },

    async processEditLevelModal(interaction, levelId) {
        const PunishmentLevels = require('../moderation/punishmentLevels');
        const existing = PunishmentLevels.getLevel(interaction.guildId, levelId);
        if (!existing) {
            return await ResponseManager.error(interaction, 'Este nível não existe mais.');
        }

        const { valid, errors, data } = PunishmentLevels.validateLevelInput(this._readLevelModalFields(interaction));
        if (!valid) {
            return await ResponseManager.error(interaction, errors.join('\n'));
        }

        const level = PunishmentLevels.updateLevel(interaction.guildId, levelId, data, interaction.user.id);
        await this.logConfigChange(interaction, [`${EMOJIS.edit || '✏️'} Nível de punição editado: **${level.name}** (${level.severity}, ${level.points} pts)`]);
        await this.refreshPointsPanel(interaction, `${EMOJIS.circlecheck || '✅'} Nível **${level.name}** atualizado!`, interaction.guild.name, 'levels');
    },

    /**
     * Alterna requires_supervisor_approval de um nível — exclusivo Caçador
     * (ver premiumSystem.js, GUILD_LIMITS.customPunishmentApprovalEnabled).
     * Free/Rastreador continuam na regra automática fixa (ver
     * punishmentSystem.requiresSupervisorApproval).
     */
    async handleToggleLevelApproval(interaction, levelId) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.getGuildLimits(interaction.guildId).customPunishmentApprovalEnabled) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(interaction.guildId));
        }

        const PunishmentLevels = require('../moderation/punishmentLevels');
        const existing = PunishmentLevels.getLevel(interaction.guildId, levelId);
        if (!existing) {
            return await ResponseManager.error(interaction, 'Este nível não existe mais.');
        }

        const newValue = existing.requires_supervisor_approval ? 0 : 1;
        const level = PunishmentLevels.setSupervisorApproval(interaction.guildId, levelId, newValue);

        await this.logConfigChange(interaction, [
            `${EMOJIS.shieldalert || '🛡️'} Nível **${level.name}**: aprovação de Supervisor ${newValue ? 'ATIVADA' : 'DESATIVADA'}`,
        ]);
        await this.refreshPointsPanel(
            interaction,
            `${EMOJIS.circlecheck || '✅'} Aprovação de Supervisor ${newValue ? 'agora é exigida' : 'não é mais exigida'} pra **${level.name}**.`,
            interaction.guild.name,
            'levels',
        );
    },

    /**
     * Botão "Deletar Nível" — mostra um painel de confirmação antes de
     * apagar de verdade (mesmo padrão de confirmCreateLogChannels).
     * Deletar é seguro a qualquer momento: punições já aplicadas guardam
     * uma cópia congelada dos dados do nível (ver
     * PunishmentLevels.deleteLevel), não uma referência viva.
     */
    async handleDeleteLevelButton(interaction, levelId) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }

        const PunishmentLevels = require('../moderation/punishmentLevels');
        const level = PunishmentLevels.getLevel(interaction.guildId, levelId);
        if (!level) {
            return await ResponseManager.error(interaction, 'Este nível não existe mais.');
        }

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
        builder.section(
            [
                '# DELETAR NÍVEL DE PUNIÇÃO',
                `Tem certeza que deseja deletar o nível **${level.name}** (${level.severity}, -${level.points} pts)? Esta ação não pode ser desfeita.`,
            ].join('\n'),
            builder.assetThumbnail('icone_config_punishments') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
        );
        builder.separator();
        builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Punições já aplicadas com este nível **não são afetadas** — elas guardam uma cópia congelada do nome/severidade/pontos/ação no momento em que foram aplicadas.`);
        builder.footer(interaction.guild.name);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`config-punishments:level:delete_confirm:${levelId}`).setLabel('Confirmar Exclusão').setStyle(ButtonStyle.Danger).setEmoji(EMOJIS.circlecheck || '✅'),
            new ButtonBuilder().setCustomId(`config-punishments:level:delete_cancel:${levelId}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.circlealert || '❌'),
        );

        const { components, flags } = builder.build();
        const replyData = { components: [...components, row], flags: [flags] };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(replyData);
        } else {
            await interaction.update(replyData);
        }
    },

    async confirmDeleteLevel(interaction, levelId) {
        const PunishmentLevels = require('../moderation/punishmentLevels');
        const level = PunishmentLevels.deleteLevel(interaction.guildId, levelId);
        if (!level) {
            return await this.refreshPointsPanel(interaction, `${EMOJIS.messagesquare || 'ℹ️'} Este nível já não existe mais.`, interaction.guild.name, 'levels');
        }

        await this.logConfigChange(interaction, [`🗑️ Nível de punição deletado: **${level.name}** (${level.severity}, ${level.points} pts)`]);
        await this.refreshPointsPanel(interaction, `${EMOJIS.circlecheck || '✅'} Nível **${level.name}** deletado.`, interaction.guild.name, 'levels');
    },

    async cancelDeleteLevel(interaction) {
        await this.refreshPointsPanel(interaction, null, interaction.guild.name, 'levels');
    },

    async processLimitesModal(interaction) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.getGuildLimits(interaction.guildId).automodEnabled) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(interaction.guildId));
        }

        const exemplarLimit = parseInt(interaction.fields.getTextInputValue('exemplar_limit'));
        const problematicLimit = parseInt(interaction.fields.getTextInputValue('problematic_limit'));
        
        if (isNaN(exemplarLimit) || exemplarLimit < 50 || exemplarLimit > 100) {
            return await ResponseManager.error(interaction, 'Limite Exemplar deve ser entre 50 e 100.');
        }
        if (isNaN(problematicLimit) || problematicLimit < 0 || problematicLimit > 50) {
            return await ResponseManager.error(interaction, 'Limite Problemático deve ser entre 0 e 50.');
        }
        if (problematicLimit >= exemplarLimit) {
            return await ResponseManager.error(interaction, 'O limite Problemático deve ser menor que o limite Exemplar.');
        }
        
        const oldExemplar = this.getSetting(interaction.guildId, 'limit_exemplar');
        const oldProblematic = this.getSetting(interaction.guildId, 'limit_problematico');
        
        this.setSetting(interaction.guildId, 'limit_exemplar', exemplarLimit.toString());
        this.setSetting(interaction.guildId, 'limit_problematico', problematicLimit.toString());
        this.clearCache(interaction.guildId);
        
        const changes = [];
        if (oldExemplar != exemplarLimit) changes.push(`${EMOJIS.sparkles || '🎖️'} Exemplar: \`${oldExemplar || 95}\` → \`${exemplarLimit}\``);
        if (oldProblematic != problematicLimit) changes.push(`${EMOJIS.trianglealert || '⚠️'} Problemático: \`${oldProblematic || 30}\` → \`${problematicLimit}\``);
        
        const changeMessage = changes.length > 0
            ? `${EMOJIS.circlecheck || '✅'} **Limites atualizados!**\n${changes.join('\n')}`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (changes.length > 0) await this.logConfigChange(interaction, changes);
        await this.refreshPointsPanel(interaction, changeMessage, interaction.guild.name, 'reputation');
    },

    async resetPoints(interaction) {
        this.setSetting(interaction.guildId, 'limit_exemplar', '95');
        this.setSetting(interaction.guildId, 'limit_problematico', '30');
        this.setSetting(interaction.guildId, 'rep_recovery_amount', '1');
        this.clearCache(interaction.guildId);
        await this.logConfigChange(interaction, `${EMOJIS.refreshccw || '⚠️'} Limites de reputação e recuperação diária resetados para o padrão.`);
        await this.refreshPointsPanel(interaction, `${EMOJIS.circlecheck || '✅'} Todos os valores foram resetados para o padrão!`, interaction.guild.name, 'reputation');
    },

    // ==================== PAINÉIS ====================

    /**
     * Envia uma mensagem de sucesso/feedback como followUp EFÊMERO,
     * separada do painel principal.
     *
     * ✅ CORRIGE O BUG: interaction.update() não aceita `content` junto de
     * MessageFlags.IsComponentsV2 ("MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2").
     * Antes, os métodos refresh*Panel tentavam colocar `content: successMessage`
     * no MESMO payload do update()/editReply() que já usa Components V2 —
     * isso fazia a requisição inteira falhar com erro 400, e por isso o
     * painel "não atualizava" (na verdade a edição nunca era aplicada).
     *
     * Agora a mensagem de sucesso vai SEMPRE por aqui, separada, e o painel
     * principal nunca leva `content`.
     */
    async sendFeedback(interaction, message) {
        if (!message) return;
        try {
            await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('❌ Erro ao enviar feedback efêmero:', error);
        }
    },

    /**
     * /config punishments agora é dividido em 2 abas (pedido do dono):
     * "reputation" (limites de reputação + recuperação diária, cada uma com
     * seu próprio botão de editar dentro da própria seção) e "levels" (lista
     * de níveis de punição, mantida EXATAMENTE como já era antes da divisão
     * — Criar Nível, Editar por nível, Exigir/Dispensar Aprovação). Navegação
     * entre as duas fica numa linha de botões abaixo do painel, mesmo padrão
     * já usado em /config roles (ver ROLE_TABS/refreshRolesPanel). Botão
     * "Resetar Padrão" mantido como estava (mesmo label/estilo/comportamento),
     * só que agora dentro da aba de reputação — é o que ele de fato reseta
     * (limites + recuperação), não os níveis.
     */
    async refreshPointsPanel(interaction, successMessage, guildName, tab = 'levels') {
        const guildId = interaction.guildId;
        const PunishmentLevels = require('../moderation/punishmentLevels');

        const exemplarLimit    = parseInt(this.getSetting(guildId, 'limit_exemplar'))    || 95;
        const problematicLimit = parseInt(this.getSetting(guildId, 'limit_problematico')) || 30;
        const recoveryAmount   = parseInt(this.getSetting(guildId, 'rep_recovery_amount')) || 1;

        const PremiumSystem = require('../premium/premiumSystem');
        const guildLimits = PremiumSystem.getGuildLimits(guildId);
        const automodEnabled = guildLimits.automodEnabled;
        const reputationEnabled = guildLimits.reputationEnabled;
        const customApprovalEnabled = guildLimits.customPunishmentApprovalEnabled;

        const levels = PunishmentLevels.getLevels(guildId);
        const levelLimit = PunishmentLevels.getLevelLimit(guildId);
        const canCreate = levels.length < levelLimit;

        const activeTab = tab === 'reputation' ? 'reputation' : 'levels';

        const cb = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });

        if (activeTab === 'reputation') {
            cb
                .section(
                    [
                        '# MECÂNICAS DE REPUTAÇÃO',
                        'Limites que definem os cargos automáticos (Exemplar/Problemático) e a recuperação diária de pontos de reputação — usados pelo /strike e pelo Automod diário.',
                    ].join('\n'),
                    cb.assetThumbnail('icone_config_punishments') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
                )
                .separator();

            // Cargos automáticos (Exemplar/Problemático) e a EDIÇÃO da
            // recuperação diária são exclusivos do Caçador. A recuperação em si
            // (fixa, 1 ponto/dia) já roda a partir do Rastreador — ver
            // autoModeration.js → executeDailyMaintenance.
            if (automodEnabled) {
                cb
                    .title(`${EMOJIS.medal || '📊'} Limites de Reputação`, 2)
                    .block([
                        `${EMOJIS.sparkles || '🎖️'} **Exemplar:** Acima de \`${exemplarLimit}\` pontos`,
                        `${EMOJIS.trianglealert  || '⚠️'} **Problemático:** Abaixo de \`${problematicLimit}\` pontos`,
                    ])
                    .buttons(AdvancedContainerBuilder.secondaryButton('config-punishments:limites:modal', 'Editar Limites'))
                    .separator()
                    .title(`${EMOJIS.doublearrowup || '📈'} Recuperação Diária de Reputação`, 2)
                    .block([
                        `${EMOJIS.doublearrowup || '📈'} **Pontos por dia:** \`${recoveryAmount}\``,
                        `${EMOJIS.circlecheck || '✅'} Automod diário ativo (recurso do plano Caçador).`,
                    ])
                    .buttons(AdvancedContainerBuilder.secondaryButton('config-punishments:recovery:modal', 'Editar Recuperação Diária'))
                    .separator();
            } else if (reputationEnabled) {
                cb
                    .title(`${EMOJIS.doublearrowup || '📈'} Recuperação Diária de Reputação`, 2)
                    .block([
                        `${EMOJIS.doublearrowup || '📈'} **Pontos por dia:** \`1\` (fixo neste plano)`,
                        `${EMOJIS.circlealert || '❌'} Cargos automáticos (Exemplar/Problemático) e recuperação diária **configurável** são exclusivos do plano **Caçador**. Use \`/premium\` para ver o tier atual.`,
                    ])
                    .separator();
            } else {
                cb
                    .title(`${EMOJIS.medal || '📊'} Limites e Recuperação Diária`, 2)
                    .text(`${EMOJIS.circlealert || '❌'} Cargos automáticos (Exemplar/Problemático) e recuperação diária de reputação são exclusivos a partir do plano **Rastreador**. Use \`/premium\` para ver o tier atual.`)
                    .separator();
            }

            cb.buttons(AdvancedContainerBuilder.dangerButton('config-punishments:reset', 'Resetar Padrão'));
        } else {
            cb
                .section(
                    [
                        '# CONFIGURAÇÃO DE NÍVEIS DE PUNIÇÃO',
                        customApprovalEnabled
                            ? 'Crie níveis customizados pro /strike. Botão **Exigir/Dispensar Aprovação** define, nível a nível, quais exigem aprovação do Supervisor.'
                            : 'Crie níveis customizados pro /strike. Grave/Severa ou duração >72h/permanente exigem aprovação do Supervisor — configurável por nível a partir do **Caçador**.',
                        `**${EMOJIS.gavel || '⚖️'} Níveis usados:** \`${levels.length}/${levelLimit}\``,
                    ].join('\n'),
                    cb.assetThumbnail('icone_config_punishments') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
                )
                .separator();

            cb.title(`${EMOJIS.gavel || '⚖️'} Níveis de Punição`, 2);
            if (levels.length === 0) {
                cb.text(`${EMOJIS.messagesquare || 'ℹ️'} Nenhum nível criado ainda. Use o botão **Criar Nível** abaixo.`);
            } else {
                for (const level of levels) {
                    const icon = PunishmentLevels.SEVERITY_ICONS[level.severity] || '❓';
                    const durationLabel = level.duration_str ? level.duration_str : 'Permanente';
                    const actionLabel = level.action || 'Nenhuma';
                    const lines = [
                        `**${level.name}**`,
                        `${icon} ${level.severity} | ${EMOJIS.doublearrowdown || '📉'} -${level.points} pts | ${EMOJIS.clockalert || '⏳'} ${durationLabel} | ${EMOJIS.game || '🎮'} ${actionLabel}`,
                    ];
                    if (customApprovalEnabled) {
                        lines.push(
                            level.requires_supervisor_approval
                                ? `${EMOJIS.shieldcheck || '🛡️'} Exige aprovação de Supervisor`
                                : `${EMOJIS.shieldx || '🔓'} Não exige aprovação de Supervisor`
                        );
                    }
                    cb.section(
                        lines.join('\n'),
                        AdvancedContainerBuilder.secondaryButton(`config-punishments:level:edit:modal:${level.id}`, 'Editar'),
                    );
                    // Section só aceita 1 botão-acessório (já usado por
                    // "Editar" acima) — Aprovação e Deletar entram juntos
                    // numa linha de botões própria, logo abaixo da seção.
                    const levelButtons = [];
                    if (customApprovalEnabled) {
                        levelButtons.push(
                            level.requires_supervisor_approval
                                ? AdvancedContainerBuilder.dangerButton(`config-punishments:level:toggle_approval:${level.id}`, 'Dispensar Aprovação')
                                : AdvancedContainerBuilder.successButton(`config-punishments:level:toggle_approval:${level.id}`, 'Exigir Aprovação')
                        );
                    }
                    levelButtons.push(AdvancedContainerBuilder.dangerButton(`config-punishments:level:delete:${level.id}`, 'Deletar Nível'));
                    cb.buttons(...levelButtons);
                }
            }
        }

        cb.separator();
        cb.footer(guildName);
        const { components, flags, files } = cb.build();

        const bottomRows = [];

        // "Criar Nível" só faz sentido na aba de Níveis — mantido idêntico
        // ao que já era (mesmo label/estilo/emoji), só que agora exclusivo
        // dessa aba em vez de ficar junto com os botões de reputação.
        if (activeTab === 'levels') {
            const createButton = new ButtonBuilder()
                .setCustomId('config-punishments:level:create:modal')
                .setLabel(canCreate ? 'Criar Nível' : `Limite atingido (${levels.length}/${levelLimit})`)
                .setStyle(ButtonStyle.Success)
                .setEmoji(EMOJIS.add || '➕')
                .setDisabled(!canCreate);
            bottomRows.push(new ActionRowBuilder().addComponents(createButton));
        }

        bottomRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config-punishments:tab:reputation')
                .setLabel('Mecânicas de Reputação')
                .setEmoji(EMOJIS.doublearrowup || undefined)
                .setStyle(activeTab === 'reputation' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('config-punishments:tab:levels')
                .setLabel('Níveis')
                .setEmoji(EMOJIS.gavel || undefined)
                .setStyle(activeTab === 'levels' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ));

        // ✅ Painel SEMPRE limpo, sem `content` — mensagem de sucesso vai
        // separada via sendFeedback() (followUp efêmero).
        const replyData = { components: [...components, ...bottomRows], flags, files };

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(replyData);
        } else {
            await interaction.update(replyData);
        }

        await this.sendFeedback(interaction, successMessage);
    },

    /**
     * Descobre em qual aba do /config roles vive uma determinada chave de
     * cargo (usado para reabrir a mesma aba depois de salvar uma seleção).
     */
    _tabForRoleKey(roleKey) {
        for (const [tabKey, tab] of Object.entries(ROLE_TABS)) {
            if (tab.fields.some(f => f.key === roleKey)) return tabKey;
        }
        return 'moderation';
    },

    async refreshRolesPanel(interaction, successMessage, tab = 'moderation') {
        const guildId = interaction.guildId;
        const tabKey = ROLE_TABS[tab] ? tab : 'moderation';
        const tabData = ROLE_TABS[tabKey];
        const PremiumSystem = require('../premium/premiumSystem');

        const rolesBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        rolesBuilder.section(
            [tabData.headerTitle, tabData.headerDesc].join('\n'),
            rolesBuilder.assetThumbnail('icone_discord_roles') || AdvancedContainerBuilder.thumbnail(interaction.guild.iconURL({ size: 128 }))
        );
        // headerNote é opcional (ver ROLE_TABS) — só existe quando há algo
        // relevante que NÃO esteja em nenhuma descrição de campo abaixo
        // (ex: corte por plano). Eventos não tem um, de propósito.
        if (tabData.headerNote) {
            rolesBuilder.text(`${EMOJIS.messagesquare || 'ℹ️'} ${tabData.headerNote}`);
        }
        rolesBuilder.separator();

        for (const field of tabData.fields) {
            rolesBuilder.text(`**${EMOJIS[field.icon] || ''} ${field.label}** — ${field.desc}`);

            // Campo de CANAL (hoje só o Canal de Anúncios de Eventos) — tipo
            // diferente de acessório (ChannelSelectMenu, não RoleSelectMenu)
            // e pode ser restrito a um tier mínimo, o que os campos de cargo
            // nunca são (cargo sempre configurável em qualquer tier, mesmo
            // que só passe a ter efeito depois — ver aba "automod" acima).
            if (field.type === 'channel') {
                const currentChannelId = this.getSetting(guildId, field.key);
                const currentText = currentChannelId ? `<#${currentChannelId}>` : `${EMOJIS.circlealert || '❌'} Não definido`;
                rolesBuilder.text(`${EMOJIS.gauge || '📊'} **Atual:** ${currentText}`);

                const tierOk = !field.tierRequired || PremiumSystem.isGuildAtLeast(guildId, field.tierRequired);
                if (tierOk) {
                    const select = new ChannelSelectMenuBuilder()
                        .setCustomId(field.customId)
                        .setPlaceholder(`Selecionar canal: ${field.label}`)
                        .addChannelTypes(ChannelType.GuildText)
                        .setMinValues(0)
                        .setMaxValues(1);
                    if (currentChannelId) select.setDefaultChannels(currentChannelId);
                    rolesBuilder.selectMenu(select);
                } else {
                    rolesBuilder.text(`${EMOJIS.badge || '🏅'} Disponível a partir do plano **Caçador** — use \`/premium\` pra saber mais.`);
                }
                rolesBuilder.separator();
                continue;
            }

            const currentIds = this.getRoleIds(guildId, field.key);
            const limit = field.roleLimitKey ? PremiumSystem.getRoleLimit(guildId, field.roleLimitKey) : 1;
            const maxValues = Math.max(1, Math.min(limit, 25)); // 25 = teto do próprio RoleSelectMenu do Discord

            const currentText = currentIds.length > 0 ? this.mentionRoles(guildId, field.key) : `${EMOJIS.circlealert || '❌'} Não definido`;
            rolesBuilder.text(`${EMOJIS.gauge || '📊'} **Atual (${currentIds.length}/${limit === Infinity ? '∞' : limit}):** ${currentText}`);

            const select = new RoleSelectMenuBuilder()
                .setCustomId(field.customId)
                .setPlaceholder(`Selecionar cargo(s): ${field.label}`)
                .setMinValues(0)
                .setMaxValues(maxValues);
            if (currentIds.length > 0) {
                select.setDefaultRoles(currentIds.slice(0, maxValues));
            }
            rolesBuilder.selectMenu(select);
            rolesBuilder.separator();
        }

        rolesBuilder.footer(interaction.guild.name);
        const { components, flags, files } = rolesBuilder.build();

        const tabRow = new ActionRowBuilder().addComponents(
            Object.entries(ROLE_TABS).map(([key, data]) =>
                new ButtonBuilder()
                    .setCustomId(`config-roles:tab:${key}`)
                    .setLabel(data.label)
                    .setEmoji(EMOJIS[data.icon] || undefined)
                    .setStyle(key === tabKey ? ButtonStyle.Primary : ButtonStyle.Secondary)
            )
        );

        // ✅ Painel SEMPRE limpo, sem `content`. Os selects de cada cargo já
        // vêm embutidos no container (ver rolesBuilder.selectMenu() acima) —
        // só a navegação entre abas fica fora, por ser uma ação do painel
        // como um todo, não de um cargo específico.
        const replyData = { components: [...components, tabRow], flags, files };

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(replyData);
            } else {
                await interaction.update(replyData);
            }
            await this.sendFeedback(interaction, successMessage);
        } catch (error) {
            console.error('❌ Erro no refreshRolesPanel:', error);
        }
    },

    async setRoles(interaction, roleKey) {
        // interaction.values já vem limitado pelo maxValues do próprio
        // select (definido no painel a partir do limite do tier) — o slice
        // aqui é só uma defesa extra caso o tier tenha sido rebaixado entre
        // o painel ser montado e o usuário confirmar a seleção.
        const PremiumSystem = require('../premium/premiumSystem');
        const field = Object.values(ROLE_TABS).flatMap(t => t.fields).find(f => f.key === roleKey);
        const limit = field?.roleLimitKey ? PremiumSystem.getRoleLimit(interaction.guildId, field.roleLimitKey) : 1;

        const selectedIds = (interaction.values || []).slice(0, limit);

        const oldMentions = this.mentionRoles(interaction.guildId, roleKey);
        this.setRoleIds(interaction.guildId, roleKey, selectedIds);
        this.clearCache(interaction.guildId);

        const newMentions = selectedIds.length > 0
            ? selectedIds.map(id => `<@&${id}>`).join(' ')
            : '`nenhum cargo selecionado`';

        await this.logConfigChange(interaction, `${EMOJIS.shield || '🎭'} Cargo **${ROLE_LABELS[roleKey]}**: ${oldMentions} → ${newMentions}`);
        await this.refreshRolesPanel(
            interaction,
            `${EMOJIS.circlecheck || '✅'} **${ROLE_LABELS[roleKey]}** atualizado (${selectedIds.length}/${limit === Infinity ? '∞' : limit})`,
            this._tabForRoleKey(roleKey),
        );
    },

    /**
     * Canal de Anúncios de Eventos (ROLE_TABS.events, campo tipo 'channel',
     * exclusivo do plano Caçador — ver eventAnnounceSystem.js). Select de
     * canal aceita 0 valores (limpar a seleção), diferente de setLogChannel
     * (que exige pelo menos 1) — faz sentido poder DESLIGAR o anúncio sem
     * precisar escolher outro canal.
     */
    async setEventAnnounceChannel(interaction) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.isGuildAtLeast(interaction.guildId, 'cacador')) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(interaction.guildId));
        }

        const selectedChannelId = (interaction.values || [])[0] || null;
        const oldChannelId = this.getSetting(interaction.guildId, 'event_announce_channel');
        this.setSetting(interaction.guildId, 'event_announce_channel', selectedChannelId);
        this.clearCache(interaction.guildId);

        const oldMention = oldChannelId ? `<#${oldChannelId}>` : '`não definido`';
        const newMention = selectedChannelId ? `<#${selectedChannelId}>` : '`não definido`';
        await this.logConfigChange(interaction, `${EMOJIS.megaphone || '📣'} Canal de Anúncios de Eventos: ${oldMention} → ${newMention}`);
        await this.refreshRolesPanel(
            interaction,
            `${EMOJIS.circlecheck || '✅'} **Canal de Anúncios de Eventos** atualizado para ${newMention}`,
            'events',
        );
    },

    /**
     * Painel de canais de log.
     *
     * ✅ UNIFICADO: removida a linha/seleção de "AutoMod" — o relatório
     * diário do AutoMod agora é enviado no mesmo canal configurado como
     * "Geral" (chave 'log_channel'). Ver autoModeration.js → sendLogReports.
     */
    async refreshLogsPanel(interaction, successMessage, guildName) {
        const guildId = interaction.guildId;

        const currentValues = {
            log_channel: this.getUnifiedGeneralLogChannel(guildId),
            log_punishments: this.getSetting(guildId, 'log_punishments'),
            log_reports: this.getSetting(guildId, 'log_reports'),
            log_staff: this.getSetting(guildId, 'log_staff'),
        };

        const fmt = (channelId) => channelId
            ? `<#${channelId}>`
            : `${EMOJIS.circlealert || '❌'} Não definido`;

        const logsBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        logsBuilder.section(
            [
                '# CANAIS DE LOG',
                'Configure os canais que recebem os registros de atividade do servidor.',
            ].join('\n'),
            logsBuilder.assetThumbnail('icone_logs') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
        );
        logsBuilder.separator();

        for (const field of LOG_FIELDS) {
            logsBuilder.text(`**${EMOJIS[field.icon] || ''} ${field.label}** — ${field.desc}`);
            logsBuilder.text(`${EMOJIS.gauge || '📊'} **Atual:** ${fmt(currentValues[field.key])}`);
            logsBuilder.selectMenu(
                new ChannelSelectMenuBuilder().setCustomId(field.customId).setPlaceholder(`Selecionar canal: ${field.label}`).addChannelTypes(ChannelType.GuildText)
            );
            logsBuilder.separator();
        }

        logsBuilder.text(`${EMOJIS.messagesquare || 'ℹ️'} Prefere não escolher um por um? Use o botão abaixo pra criar os 4 automaticamente.`);
        logsBuilder.footer(guildName);
        const { components, flags, files } = logsBuilder.build();

        const buttonRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config-logs:criar').setLabel('Criar Canais Automaticamente').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.plus || '➕'));

        // ✅ Painel SEMPRE limpo, sem `content`. Os selects de cada canal já
        // vêm embutidos no container (ver logsBuilder.selectMenu() acima) —
        // só o botão de criação automática fica fora, por ser uma ação do
        // painel como um todo, não de um canal específico.
        const replyData = { components: [...components, buttonRow], flags, files };

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(replyData);
            } else {
                await interaction.update(replyData);
            }
            await this.sendFeedback(interaction, successMessage);
        } catch (error) {
            console.error('❌ Erro no refreshLogsPanel:', error);
        }
    },

    async setLogChannel(interaction, channelKey) {
        const selectedChannelId = interaction.values[0];
        if (!selectedChannelId) {
            return await ResponseManager.error(interaction, 'Nenhum canal selecionado.');
        }
        
        const channel = interaction.guild.channels.cache.get(selectedChannelId);
        if (!channel) {
            return await ResponseManager.error(interaction, 'Canal não encontrado.');
        }

        const oldChannelId = this.getSetting(interaction.guildId, channelKey);
        this.setSetting(interaction.guildId, channelKey, selectedChannelId);
        this.clearCache(interaction.guildId);

        const channelLabels = {
            log_channel:      `${EMOJIS.megaphone  || '📜'} Canal de logs gerais / automod`,
            log_punishments:  `${EMOJIS.gavel  || '⚖️'} Canal de logs de punições`,
            log_reports:      `${EMOJIS.ticket    || '🚩'} Canal de logs de reports`,
            log_staff:        `${EMOJIS.shield || '🛡️'} Canal de logs de staff`,
        };

        const oldChannelMention = oldChannelId ? `<#${oldChannelId}>` : '`não definido`';
        await this.logConfigChange(interaction, `${channelLabels[channelKey]}: ${oldChannelMention} → ${channel}`);
        await this.refreshLogsPanel(interaction, `${EMOJIS.circlecheck || '✅'} **${channelLabels[channelKey]}** alterado para ${channel}`, interaction.guild.name);
    },

    /**
     * Confirmação antes de criar os canais automaticamente — explica o que
     * o botão vai fazer, avisa sobre permissões de acesso (por padrão só o
     * bot enxerga os canais) e sobre a posição deles na lista de canais,
     * antes de criar algo de fato.
     */
    async confirmCreateLogChannels(interaction) {
        const guild = interaction.guild;

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.section(
            [
                '# CRIAR CANAIS DE LOG AUTOMATICAMENTE',
                'Isso vai criar uma categoria nova ("LOGS DO SISTEMA") com 4 canais de texto dentro — Geral/AutoMod, Punições, ReportChat e Staff — e já configurar os 4 automaticamente aqui no painel.',
            ].join('\n'),
            builder.assetThumbnail('icone_logs') || AdvancedContainerBuilder.thumbnail(guild.iconURL({ size: 128 }))
        );
        builder.separator();
        builder.text(
            `${EMOJIS.trianglealert || '⚠️'} **Atenção às permissões:** por padrão, esses canais ficam visíveis **só para o bot** — nem a staff consegue ver. ` +
            `Depois de criados, configure manualmente quem (cargo de Staff, Admin etc.) deve ter acesso a cada um.`
        );
        builder.text(
            `${EMOJIS.messagesquare || 'ℹ️'} A categoria e os canais sempre aparecem no **fim** da lista de canais do servidor, mas você pode renomear e reposicionar todos eles como preferir depois — isso não afeta o funcionamento do sistema.`
        );
        builder.footer(guild.name);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('config-logs:criar:confirm').setLabel('Confirmar e Criar').setStyle(ButtonStyle.Success).setEmoji(EMOJIS.circlecheck || '✅'),
            new ButtonBuilder().setCustomId('config-logs:criar:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji(EMOJIS.circlealert || '❌'),
        );

        const { components, flags } = builder.build();
        const replyData = { components: [...components, row], flags: [flags] };

        // Chamado a partir de um customId especial-casado em interactionCreate.js
        // (antes do deferUpdate() genérico) — a interação chega fresca aqui,
        // então usa update(), não editReply(). Mesmo padrão de refreshLogsPanel.
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(replyData);
        } else {
            await interaction.update(replyData);
        }
    },

    /**
     * Cria os canais de log automaticamente.
     *
     * ✅ UNIFICADO: não cria mais um canal separado "logs-automod".
     * O canal "logs-gerais" agora recebe tanto logs gerais quanto o
     * relatório diário do AutoMod.
     */
    async createLogChannels(interaction) {
        try {
            if (!interaction.isRepliable()) {
                console.error('❌ Interação não pode ser respondida');
                return;
            }
            
            const guild = interaction.guild;
            const { PermissionFlagsBits } = require('discord.js');
            
            if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                const msg = `${EMOJIS.circlealert || '❌'} Não tenho permissão para criar canais.`;
                if (interaction.deferred || interaction.replied) {
                    // A mensagem original (painel config-logs) é Components V2 —
                    // depois de deferUpdate(), `content` sozinho é rejeitado
                    // pelo Discord (erro 50035). Precisa ir como container.
                    const errBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR }).text(msg).footer(guild.name);
                    await interaction.editReply(errBuilder.build());
                } else {
                    await interaction.reply({ content: msg, flags: 64 });
                }
                return;
            }
            
            if (!interaction.deferred && !interaction.replied) {
                const loadingPayload = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT })
                    .text(`${EMOJIS.clock || '⏳'} Criando canais de log...`)
                    .footer(guild.name)
                    .build();

                await interaction.reply({ ...loadingPayload, flags: loadingPayload.flags | MessageFlags.Ephemeral });
            }
            
            const category = await guild.channels.create({
                name: '░░🪵 LOGS DO SISTEMA ░░░░░░░░',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
                ]
            });
            
            const geral       = await guild.channels.create({ name: '📜 logs-gerais',   type: ChannelType.GuildText, parent: category.id });
            const punishments = await guild.channels.create({ name: '⚖️ logs-punicoes', type: ChannelType.GuildText, parent: category.id });
            const reports     = await guild.channels.create({ name: '🚩 logs-reports',  type: ChannelType.GuildText, parent: category.id });
            const staff       = await guild.channels.create({ name: '🛡️ logs-staff',    type: ChannelType.GuildText, parent: category.id });

            this.setSetting(guild.id, 'log_channel',      geral.id);
            this.setSetting(guild.id, 'log_punishments',  punishments.id);
            this.setSetting(guild.id, 'log_reports',      reports.id);
            this.setSetting(guild.id, 'log_staff',        staff.id);
            this.clearCache(guild.id);

            await this.logConfigChange(interaction, [
                `${EMOJIS.megaphone || '📜'} Geral / AutoMod: → ${geral}`,
                `${EMOJIS.gavel || '⚖️'} Punições: → ${punishments}`,
                `${EMOJIS.ticket || '🎫'} Reports: → ${reports}`,
                `${EMOJIS.shield || '🛡️'} Staff: → ${staff}`,
            ]);

            const replyData = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS })
                .title(`${EMOJIS.circlecheck || '✅'} Canais de Log Criados`)
                .text('Os seguintes canais foram criados:')
                .separator()
                .block([
                    `${EMOJIS.megaphone  || '📜'} **Geral / AutoMod:** <#${geral.id}>`,
                    `${EMOJIS.gavel  || '⚖️'} **Punições:** <#${punishments.id}>`,
                    `${EMOJIS.ticket    || '🎫'} **Reports:** <#${reports.id}>`,
                    `${EMOJIS.shield    || '🛡️'} **Staff:** <#${staff.id}>`,
                ])
                .separator()
                .text(`${EMOJIS.trianglealert || '⚠️'} Lembre-se de configurar o acesso desses canais (cargo de Staff, Admin etc.) — por padrão só o bot consegue ver.`)
                .footer(guild.name)
                .build();
            
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(replyData);
            } else {
                await interaction.reply({ ...replyData, flags: 64 });
            }
            
        } catch (error) {
            console.error('❌ Erro ao criar canais:', error);
            const msg = `${EMOJIS.circlealert || '❌'} Erro ao criar canais: ${error.message}`;
            try {
                const errorPayload = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                    .text(msg)
                    .footer(interaction.guild?.name)
                    .build();

                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply(errorPayload);
                } else {
                    await interaction.reply({ ...errorPayload, flags: errorPayload.flags | MessageFlags.Ephemeral });
                }
            } catch (err) {
                console.error('❌ Erro ao responder:', err);
            }
        }
    },

    /**
     * @param {string} guildId
     * @param {'geral'|'punishments'|'automod'|'reports'} type
     * ✅ UNIFICADO: 'automod' agora resolve para o mesmo canal de 'geral'.
     */
    getLogChannel(guildId, type) {
        if (type === 'geral' || type === 'automod') {
            return this.getUnifiedGeneralLogChannel(guildId);
        }
        const channelMap = { punishments: 'log_punishments', reports: 'log_reports', staff: 'log_staff' };
        const key = channelMap[type];
        if (!key) return null;
        return this.getSetting(guildId, key) || null;
    },

    clearAllCache() {
        try {
            cache.clear();
            console.log('🗑️ Cache completo limpo');
        } catch (error) {
            console.error('❌ Erro ao limpar cache completo:', error);
        }
    },

    // ==================== PLAYER PREMIUM — FOTO DE PERFIL (COMPY) ====================
    // Compy escolhe entre as fotos do pool de avatar (getAvatarOptions —
    // 100% dinâmico, alimentado via /perfil-pool add avatar no bot
    // developer) via menu; Raptor continua com upload próprio (/perfil-edit,
    // banner_message_id). Ver playerRegistrationSystem.js.
    // _resolveCardPhotoBuffer pra onde essa escolha é lida na hora de montar
    // o card do /perfil.

    buildPlayerPhotoPickerPayload(currentKey) {
        const cb = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        cb.text([
            '# ESCOLHER FOTO DE PERFIL',
            'Escolha uma das fotos abaixo para usar de fundo no seu card (`/perfil`) — recurso do Player Premium Compy.',
        ].join('\n'));

        const options = getAvatarOptions();
        if (options.length === 0) {
            cb.text(`${EMOJIS.circlealert || '❌'} Ainda não há nenhuma foto de perfil cadastrada — volte mais tarde.`);
            cb.footer('Player Premium Compy');
            return cb;
        }

        const currentLabel = options.find(opt => opt.value === currentKey)?.label;
        cb.text(`${EMOJIS.gauge || '📊'} **Atual:** ${currentLabel || `${EMOJIS.circlealert || '❌'} Padrão do tier (nenhuma escolhida ainda)`}`);
        cb.footer('Player Premium Compy');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('perfil-edit:photo')
            .setPlaceholder('Escolha a foto...')
            .addOptions(options.map(opt => new StringSelectMenuOptionBuilder()
                .setLabel(opt.label)
                .setValue(opt.value)
                .setDefault(opt.value === currentKey)
            ));
        cb.selectMenu(selectMenu);
        return cb;
    },

    async handlePlayerPhotoSelect(interaction) {
        if (!interaction.isStringSelectMenu()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita pelo menu de seleção.');
        }

        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.isPlayerAtLeast(interaction.user.id, 'compy')) {
            return await ResponseManager.error(interaction, 'Escolher foto de perfil é um recurso do Player Premium Compy ou superior.');
        }

        const PlayerRegistry = require('../pot/potPlayerRegistry');
        const link = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        if (!link) {
            return await ResponseManager.error(interaction, 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.');
        }

        const chosenKey = interaction.values[0];
        const options = getAvatarOptions();
        const isValidOption = options.some(opt => opt.value === chosenKey);
        const isValidImage = isValidOption && (ProfileImagePool.isPoolValue(chosenKey) || imageManager.hasImage(chosenKey));
        if (!isValidImage) {
            return await ResponseManager.error(interaction, 'Imagem inválida.');
        }

        PlayerRegistry.setSelectedPhotoKey(interaction.user.id, chosenKey);
        const label = options.find(opt => opt.value === chosenKey)?.label || chosenKey;

        const payload = this.buildPlayerPhotoPickerPayload(chosenKey).build();
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.update(payload);
        }
        await this.sendFeedback(interaction, `${EMOJIS.circlecheck || '✅'} **Foto de perfil atualizada:** ${label}. Use \`/perfil\` para ver como ficou.`);
    },

    // ==================== PLAYER PREMIUM — PLANO DE FUNDO (COMPY) ====================
    // Mesmo padrão de FOTO DE PERFIL acima, só que pro banner que aparece
    // ATRÁS da mensagem inteira do /perfil (não o recorte de foto de dentro
    // do card) — Raptor continua com upload próprio (/perfil-edit,
    // background_message_id).

    buildPlayerBackgroundPickerPayload(currentKey) {
        const cb = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        cb.text([
            '# ESCOLHER PLANO DE FUNDO',
            'Escolha uma das imagens abaixo para usar de plano de fundo no seu `/perfil` — recurso do Player Premium Compy.',
        ].join('\n'));

        const options = getBackgroundOptions();
        if (options.length === 0) {
            cb.text(`${EMOJIS.circlealert || '❌'} Ainda não há nenhuma opção de plano de fundo cadastrada — volte mais tarde.`);
            cb.footer('Player Premium Compy');
            return cb;
        }

        const currentLabel = options.find(opt => opt.value === currentKey)?.label;
        cb.text(`${EMOJIS.gauge || '📊'} **Atual:** ${currentLabel || `${EMOJIS.circlealert || '❌'} Padrão do tier (nenhum escolhido ainda)`}`);
        cb.footer('Player Premium Compy');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('perfil-edit:background')
            .setPlaceholder('Escolha o plano de fundo...')
            .addOptions(options.map(opt => new StringSelectMenuOptionBuilder()
                .setLabel(opt.label)
                .setValue(opt.value)
                .setDefault(opt.value === currentKey)
            ));
        cb.selectMenu(selectMenu);
        return cb;
    },

    async handlePlayerBackgroundSelect(interaction) {
        if (!interaction.isStringSelectMenu()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita pelo menu de seleção.');
        }

        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.isPlayerAtLeast(interaction.user.id, 'compy')) {
            return await ResponseManager.error(interaction, 'Escolher plano de fundo é um recurso do Player Premium Compy ou superior.');
        }

        const PlayerRegistry = require('../pot/potPlayerRegistry');
        const link = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        if (!link) {
            return await ResponseManager.error(interaction, 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.');
        }

        const chosenKey = interaction.values[0];
        const options = getBackgroundOptions();
        const isValidOption = options.some(opt => opt.value === chosenKey);
        const isValidImage = isValidOption && (ProfileImagePool.isPoolValue(chosenKey) || imageManager.hasImage(chosenKey));
        if (!isValidImage) {
            return await ResponseManager.error(interaction, 'Imagem inválida.');
        }

        PlayerRegistry.setSelectedBackgroundKey(interaction.user.id, chosenKey);
        const label = options.find(opt => opt.value === chosenKey)?.label || chosenKey;

        const payload = this.buildPlayerBackgroundPickerPayload(chosenKey).build();
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.update(payload);
        }
        await this.sendFeedback(interaction, `${EMOJIS.circlecheck || '✅'} **Plano de fundo atualizado:** ${label}. Use \`/perfil\` para ver como ficou.`);
    },

    // ==================== EMBLEMA (QUALQUER TIER) ====================
    // Sempre "escolher de uma lista", nunca upload próprio — liberado em
    // QUALQUER tier (diferente de foto/fundo, exclusivos Compy+/Raptor).
    // Pool 100% dinâmico (getBadgeOptions — ver /perfil-pool add badge no
    // bot developer). Desenho do emblema escolhido em cima do card ainda
    // não implementado — esta tela já deixa a escolha/persistência
    // prontas, o desenho fica pra quando existirem assets reais cadastrados
    // pra testar a composição contra.

    buildPlayerBadgePickerPayload(currentKey) {
        const cb = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        cb.text([
            '# ESCOLHER EMBLEMA',
            'Escolha um emblema para exibir no seu card de `/perfil` — disponível em qualquer tier.',
        ].join('\n'));

        const options = getBadgeOptions();
        if (options.length === 0) {
            cb.text(`${EMOJIS.circlealert || '❌'} Ainda não há nenhum emblema cadastrado — volte mais tarde.`);
            cb.footer('Emblema disponível em qualquer tier');
            return cb;
        }

        const currentLabel = options.find(opt => opt.value === currentKey)?.label;
        cb.text(`${EMOJIS.gauge || '📊'} **Atual:** ${currentLabel || `${EMOJIS.circlealert || '❌'} Nenhum escolhido ainda`}`);
        cb.footer('Emblema disponível em qualquer tier');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('perfil-edit:badge')
            .setPlaceholder('Escolha o emblema...')
            .addOptions(options.map(opt => new StringSelectMenuOptionBuilder()
                .setLabel(opt.label)
                .setValue(opt.value)
                .setDefault(opt.value === currentKey)
            ));
        cb.selectMenu(selectMenu);
        return cb;
    },

    async handlePlayerBadgeSelect(interaction) {
        if (!interaction.isStringSelectMenu()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita pelo menu de seleção.');
        }

        // Sem checagem de tier de propósito — emblema é liberado em
        // QUALQUER tier (pedido do dono), diferente de foto/fundo/título.
        const PlayerRegistry = require('../pot/potPlayerRegistry');
        const link = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        if (!link) {
            return await ResponseManager.error(interaction, 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.');
        }

        const chosenKey = interaction.values[0];
        const options = getBadgeOptions();
        const isValidOption = options.some(opt => opt.value === chosenKey);
        if (!isValidOption) {
            return await ResponseManager.error(interaction, 'Emblema inválido.');
        }

        PlayerRegistry.setSelectedBadgeKey(interaction.user.id, chosenKey);
        const label = options.find(opt => opt.value === chosenKey)?.label || chosenKey;

        const payload = this.buildPlayerBadgePickerPayload(chosenKey).build();
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.update(payload);
        }
        await this.sendFeedback(interaction, `${EMOJIS.circlecheck || '✅'} **Emblema atualizado:** ${label}. Use \`/perfil\` para ver como ficou.`);
    },

    // ==================== PAINEL PRINCIPAL — /perfil-edit ====================
    // Tela de entrada do /perfil-edit quando chamado SEM nenhum anexo — lista
    // tudo que dá pra personalizar e o estado atual de cada um. Foto/Plano de
    // Fundo (Raptor) continuam exigindo rodar /perfil-edit de novo com o
    // anexo (Discord não permite pedir upload de arquivo a partir de um botão
    // ou modal, só da própria slash command) — os botões desses dois, nesse
    // caso, só explicam isso; Compy usa os botões pra abrir o picker de
    // verdade (select), que não depende de anexo.

    buildPerfilEditPanelPayload(playerTier, link) {
        const isCompyPlus = playerTier === 'compy' || playerTier === 'raptor';
        const isRaptor = playerTier === 'raptor';
        const cb = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        cb.text([
            '# PERSONALIZAR PERFIL',
            'Ajuste como seu `/perfil` aparece pros outros — cada botão abaixo cuida de uma parte.',
        ].join('\n'));
        cb.separator();

        // Emblema é liberado em QUALQUER tier (pedido do dono — diferente de
        // foto/fundo/título/esconder KDA, que continuam Compy+/Raptor).
        const badgeStatus = link?.selected_badge_key ? getBadgeOptions().find(o => o.value === link.selected_badge_key)?.label || link.selected_badge_key : 'Nenhum';
        const statusLines = [`**Emblema:** ${badgeStatus}`];

        if (isCompyPlus) {
            const photoStatus = isRaptor
                ? (link?.banner_message_id ? 'Upload próprio' : 'Padrão do tier (ou banner do Discord)')
                : (link?.selected_photo_key ? getAvatarOptions().find(o => o.value === link.selected_photo_key)?.label || link.selected_photo_key : 'Padrão do tier');
            const backgroundStatus = isRaptor
                ? (link?.background_message_id ? 'Upload próprio' : 'Nenhum (sem plano de fundo)')
                : (link?.selected_background_key ? getBackgroundOptions().find(o => o.value === link.selected_background_key)?.label || link.selected_background_key : 'Nenhum (sem plano de fundo)');
            const kdaStatus = link?.hide_kda ? `${EMOJIS.circlealert || '❌'} Escondido` : `${EMOJIS.circlecheck || '✅'} Visível`;
            statusLines.push(`**Foto de perfil:** ${photoStatus}`, `**Plano de fundo:** ${backgroundStatus}`, `**Kills/Deaths/K-D:** ${kdaStatus}`);
            if (isRaptor) statusLines.push(`**Título:** ${link?.profile_title || 'Padrão ("Em breve (missões)")'}`);
        } else {
            statusLines.push(`${EMOJIS.messagesquare || 'ℹ️'} Foto de perfil, plano de fundo e esconder KDA são recursos do Player Premium Compy ou superior.`);
        }
        cb.text(statusLines.join('\n'));

        const row1Buttons = [
            new ButtonBuilder().setCustomId('perfil-edit:badge-info').setLabel('Emblema').setStyle(ButtonStyle.Primary).setEmoji(EMOJIS.badge || '🏅'),
        ];
        if (isCompyPlus) {
            row1Buttons.push(
                new ButtonBuilder().setCustomId('perfil-edit:photo-info').setLabel('Foto de Perfil').setStyle(ButtonStyle.Primary).setEmoji(EMOJIS.imagem || '🖼️'),
                new ButtonBuilder().setCustomId('perfil-edit:background-info').setLabel('Plano de Fundo').setStyle(ButtonStyle.Primary).setEmoji(EMOJIS.gallery || '🏞️'),
            );
        }
        const rows = [new ActionRowBuilder().addComponents(row1Buttons)];

        if (isCompyPlus) {
            const row2Buttons = [
                new ButtonBuilder().setCustomId('perfil-edit:hide-kda-toggle').setLabel(link?.hide_kda ? 'Mostrar KDA' : 'Esconder KDA').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.gauge || '📊'),
            ];
            // Título é texto livre (sem versão "banco" pra Compy — não existe
            // banco de frases pré-prontas) — Raptor only, mesmo critério de
            // upload próprio de foto/fundo.
            if (isRaptor) {
                row2Buttons.unshift(new ButtonBuilder().setCustomId('perfil-edit:title:modal').setLabel('Título').setStyle(ButtonStyle.Primary).setEmoji(EMOJIS.edit || '✏️'));
            }
            // "Remover Plano de Fundo" — só aparece quando já tem um plano de
            // fundo configurado (Raptor: background_message_id; Compy:
            // selected_background_key). Pedido do dono: antes não existia
            // NENHUM jeito de verdade de limpar o plano de fundo — o texto de
            // dica pro Raptor dizia "vazio remove a atual", mas o Discord não
            // deixa "selecionar um anexo em branco" (o parâmetro só existe na
            // interação se um arquivo de verdade foi anexado), então esse
            // caminho no comando nunca era alcançado na prática.
            const hasBackground = isRaptor ? !!link?.background_message_id : !!link?.selected_background_key;
            if (hasBackground) {
                row2Buttons.push(new ButtonBuilder().setCustomId('perfil-edit:background-remove').setLabel('Remover Plano de Fundo').setStyle(ButtonStyle.Danger).setEmoji(EMOJIS.trash || '🗑️'));
            }
            rows.push(new ActionRowBuilder().addComponents(row2Buttons));
        }

        cb.footer(isCompyPlus ? 'Player Premium Compy/Raptor' : 'Emblema disponível em qualquer tier');
        const { components, flags, files } = cb.build();
        return { components: [...components, ...rows], flags, files };
    },

    async handlePerfilEditInfoButton(interaction, kind) {
        // Painel principal não muda (segue visível) — a resposta deste botão
        // é sempre uma mensagem NOVA (followUp), nunca um editReply que
        // substituiria o painel. Por isso interaction.followUp() direto em
        // vez de ResponseManager (que, numa interação já deferida via
        // deferUpdate(), editaria a mensagem original — errado aqui).

        // Badge é liberado em qualquer tier (sem checagem abaixo) — só
        // foto/fundo exigem Compy+ (o painel já esconde esses botões pro
        // Free, isso aqui é defesa extra contra customId manipulado à mão).
        if (kind !== 'badge') {
            const PremiumSystem = require('../premium/premiumSystem');
            const tier = PremiumSystem.getPlayerTier(interaction.user.id);
            if (tier === 'free') {
                return await interaction.followUp({
                    content: `${EMOJIS.circlealert || '❌'} ${kind === 'photo' ? 'Foto de perfil' : 'Plano de fundo'} é um recurso do Player Premium Compy ou superior.`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            if (tier === 'raptor') {
                const commandHint = kind === 'photo' ? '`/perfil-edit avatar:<sua imagem>`' : '`/perfil-edit plano_de_fundo:<sua imagem>`';
                // Tamanho só faz sentido citar pro plano de fundo (banner
                // atrás da mensagem inteira) — a foto de perfil é recortada
                // na moldura do card, não tem um "formato ideal" de banner.
                const sizeHint = kind === 'background' ? ' Tamanho ideal: **1300x300** (máximo aceito).' : '';
                return await interaction.followUp({
                    content: `${EMOJIS.messagesquare || 'ℹ️'} Você é Raptor — envie a imagem direto pelo comando: ${commandHint} (vazio remove a atual).${sizeHint}`,
                    flags: MessageFlags.Ephemeral,
                });
            }
        }

        const PlayerRegistry = require('../pot/potPlayerRegistry');
        const link = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        const builders = {
            photo: () => this.buildPlayerPhotoPickerPayload(link?.selected_photo_key),
            background: () => this.buildPlayerBackgroundPickerPayload(link?.selected_background_key),
            badge: () => this.buildPlayerBadgePickerPayload(link?.selected_badge_key),
        };
        const payload = builders[kind]().build();
        await interaction.followUp({ ...payload, flags: (payload.flags | MessageFlags.Ephemeral) });
    },

    async handleHideKdaToggle(interaction) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.isPlayerAtLeast(interaction.user.id, 'compy')) {
            return await ResponseManager.error(interaction, 'Personalizar o perfil é um recurso do Player Premium Compy ou superior.');
        }

        const PlayerRegistry = require('../pot/potPlayerRegistry');
        const link = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        if (!link) {
            return await ResponseManager.error(interaction, 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.');
        }

        const newValue = !link.hide_kda;
        PlayerRegistry.setHideKda(interaction.user.id, newValue);

        const updatedLink = { ...link, hide_kda: newValue ? 1 : 0 };
        const payload = this.buildPerfilEditPanelPayload(PremiumSystem.getPlayerTier(interaction.user.id), updatedLink);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.update(payload);
        }
        await this.sendFeedback(interaction, newValue
            ? `${EMOJIS.circlecheck || '✅'} Linha de Kills/Deaths/K-D escondida no seu \`/perfil\`.`
            : `${EMOJIS.circlecheck || '✅'} Linha de Kills/Deaths/K-D visível de novo no seu \`/perfil\`.`);
    },

    /**
     * perfil-edit:background-remove — botão "Remover Plano de Fundo" do
     * painel. Limpa os DOIS campos (background_message_id do Raptor e
     * selected_background_key do Compy) independente do tier atual do
     * jogador — evita deixar um campo velho "preso" se ele mudar de tier
     * depois. Único jeito de verdade de tirar o plano de fundo hoje: o
     * comando /perfil-edit não consegue (Discord não permite "selecionar
     * um anexo em branco" pra sinalizar remoção).
     */
    async handleRemoveBackground(interaction) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.isPlayerAtLeast(interaction.user.id, 'compy')) {
            return await ResponseManager.error(interaction, 'Personalizar o perfil é um recurso do Player Premium Compy ou superior.');
        }

        const PlayerRegistry = require('../pot/potPlayerRegistry');
        const link = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        if (!link) {
            return await ResponseManager.error(interaction, 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.');
        }

        PlayerRegistry.setBackgroundMessageId(interaction.user.id, null);
        PlayerRegistry.setSelectedBackgroundKey(interaction.user.id, null);

        const updatedLink = { ...link, background_message_id: null, selected_background_key: null };
        const payload = this.buildPerfilEditPanelPayload(PremiumSystem.getPlayerTier(interaction.user.id), updatedLink);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.update(payload);
        }
        await this.sendFeedback(interaction, `${EMOJIS.circlecheck || '✅'} Plano de fundo removido. Use \`/perfil\` para ver como ficou.`);
    },

    /**
     * perfil-edit:title:modal — botão "Título" do painel. Especial-caseado
     * em interactionCreate.js (ANTES do deferUpdate() genérico), mesmo
     * motivo de sempre: showModal() só funciona como PRIMEIRA resposta.
     */
    async handleOpenTitleModal(interaction) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.isPlayerAtLeast(interaction.user.id, 'raptor')) {
            return await interaction.reply({ content: 'Personalizar o título é um recurso exclusivo do Player Premium Raptor.', flags: MessageFlags.Ephemeral });
        }

        const PlayerRegistry = require('../pot/potPlayerRegistry');
        const link = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        if (!link) {
            return await interaction.reply({ content: 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.', flags: MessageFlags.Ephemeral });
        }

        const titleInput = new TextInputBuilder()
            .setCustomId('title')
            .setLabel('Título do seu card de perfil')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: Caçador Lendário')
            .setMaxLength(40)
            .setRequired(false);
        if (link.profile_title) titleInput.setValue(link.profile_title);

        const modal = new ModalBuilder()
            .setCustomId('perfil-edit:title:modal:submit')
            .setTitle('Título do Perfil')
            .addComponents(new ActionRowBuilder().addComponents(titleInput));
        await interaction.showModal(modal);
    },

    async processTitleModal(interaction) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.isPlayerAtLeast(interaction.user.id, 'raptor')) {
            return await ResponseManager.error(interaction, 'Personalizar o título é um recurso exclusivo do Player Premium Raptor.');
        }

        const PlayerRegistry = require('../pot/potPlayerRegistry');
        const link = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        if (!link) {
            return await ResponseManager.error(interaction, 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.');
        }

        const title = interaction.fields.getTextInputValue('title').trim();
        PlayerRegistry.setProfileTitle(interaction.user.id, title || null);

        await ResponseManager.success(interaction, title
            ? `Título do perfil atualizado para **"${title}"**. Use \`/perfil\` para ver como ficou.`
            : `Título do perfil removido — volta a mostrar o padrão. Use \`/perfil\` para ver como ficou.`);
    },

    // ==================== PERSONALIZAÇÃO (CAÇADOR) — /config personalizar ====================
    // Unifica toda customização visual exclusiva do Caçador que antes estava
    // espalhada: banner de /strike e /unstrike (pedido do dono) + banner/
    // mensagem do report-chat (antes era /config reportchat, removido — ver
    // PREMIUM.txt). Mesmo padrão de abas de refreshRolesPanel/ROLE_TABS.

    async _assertPersonalizarAllowed(interaction) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!PremiumSystem.isGuildAtLeast(interaction.guildId, 'cacador')) {
            await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(interaction.guildId));
            return false;
        }
        return true;
    },

    async handleStrikeBannerSelect(interaction) {
        if (!interaction.isStringSelectMenu()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita pelo menu de seleção.');
        }
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const chosenKey = interaction.values[0];
        const isValidOption = STRIKE_BANNER_OPTIONS.some(opt => opt.value === chosenKey);
        if (!isValidOption || !imageManager.hasImage(chosenKey)) {
            return await ResponseManager.error(interaction, 'Imagem inválida.');
        }

        const oldValue = this.getSetting(interaction.guildId, 'strike_banner_key') || 'title_strike';
        this.setSetting(interaction.guildId, 'strike_banner_key', chosenKey);
        this.clearCache(interaction.guildId);

        const label = STRIKE_BANNER_OPTIONS.find(opt => opt.value === chosenKey)?.label || chosenKey;
        const changeMessage = oldValue !== chosenKey
            ? `${EMOJIS.circlecheck || '✅'} **Banner do /strike atualizado:** ${label}.`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (oldValue !== chosenKey) await this.logConfigChange(interaction, `${EMOJIS.imagem || '🖼️'} Banner do /strike: \`${oldValue}\` → \`${chosenKey}\``);
        await this.refreshPersonalizarPanel(interaction, changeMessage, interaction.guild.name, 'strike');
    },

    async handleUnstrikeBannerSelect(interaction) {
        if (!interaction.isStringSelectMenu()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita pelo menu de seleção.');
        }
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const chosenKey = interaction.values[0];
        const isValidOption = UNSTRIKE_BANNER_OPTIONS.some(opt => opt.value === chosenKey);
        if (!isValidOption || !imageManager.hasImage(chosenKey)) {
            return await ResponseManager.error(interaction, 'Imagem inválida.');
        }

        const oldValue = this.getSetting(interaction.guildId, 'unstrike_banner_key') || 'title_strike_removido';
        this.setSetting(interaction.guildId, 'unstrike_banner_key', chosenKey);
        this.clearCache(interaction.guildId);

        const label = UNSTRIKE_BANNER_OPTIONS.find(opt => opt.value === chosenKey)?.label || chosenKey;
        const changeMessage = oldValue !== chosenKey
            ? `${EMOJIS.circlecheck || '✅'} **Banner do /unstrike atualizado:** ${label}.`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (oldValue !== chosenKey) await this.logConfigChange(interaction, `${EMOJIS.imagem || '🖼️'} Banner do /unstrike: \`${oldValue}\` → \`${chosenKey}\``);
        await this.refreshPersonalizarPanel(interaction, changeMessage, interaction.guild.name, 'strike');
    },

    async handleReportChatBannerSelect(interaction) {
        if (!interaction.isStringSelectMenu()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita pelo menu de seleção.');
        }
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const chosenKey = interaction.values[0];
        const isValidOption = REPORT_CHAT_BANNER_OPTIONS.some(opt => opt.value === chosenKey);
        if (!isValidOption || !imageManager.hasImage(chosenKey)) {
            return await ResponseManager.error(interaction, 'Imagem inválida.');
        }

        const oldValue = this.getSetting(interaction.guildId, 'report_chat_banner_key') || 'title_report_chat';
        this.setSetting(interaction.guildId, 'report_chat_banner_key', chosenKey);
        this.clearCache(interaction.guildId);

        const label = REPORT_CHAT_BANNER_OPTIONS.find(opt => opt.value === chosenKey)?.label || chosenKey;
        const changeMessage = oldValue !== chosenKey
            ? `${EMOJIS.circlecheck || '✅'} **Banner do report-chat atualizado:** ${label}.`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (oldValue !== chosenKey) await this.logConfigChange(interaction, `${EMOJIS.imagem || '🖼️'} Banner do report-chat: \`${oldValue}\` → \`${chosenKey}\``);
        await this.refreshPersonalizarPanel(interaction, changeMessage, interaction.guild.name, 'reportchat');
    },

    async handleReportChatMessageModal(interaction) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const currentMessage = this.getSetting(interaction.guildId, 'report_chat_message') || '';

        const row = new ActionRowBuilder().addComponents(
            new TextInputBuilder({
                customId: 'report_chat_message',
                label: 'Mensagem do painel (vazio = padrão do bot)',
                style: TextInputStyle.Paragraph,
                required: false,
                maxLength: 1000,
                value: currentMessage,
                placeholder: 'Explique como abrir um reporte ou revisar uma punição neste servidor...',
            })
        );

        const modal = new ModalBuilder({ customId: 'config-personalizar:reportchat-message:modal:submit', title: 'Mensagem do Report-Chat', components: [row] });
        await interaction.showModal(modal);
    },

    async processReportChatMessageModal(interaction) {
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const newMessage = interaction.fields.getTextInputValue('report_chat_message').trim();
        const oldMessage = this.getSetting(interaction.guildId, 'report_chat_message') || '';

        this.setSetting(interaction.guildId, 'report_chat_message', newMessage || null);
        this.clearCache(interaction.guildId);

        const changeMessage = newMessage !== oldMessage
            ? `${EMOJIS.circlecheck || '✅'} **Mensagem do report-chat atualizada.**`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (newMessage !== oldMessage) await this.logConfigChange(interaction, `${EMOJIS.edit || '✏️'} Mensagem do report-chat foi ${newMessage ? 'alterada' : 'resetada para o padrão'}.`);
        await this.refreshPersonalizarPanel(interaction, changeMessage, interaction.guild.name, 'reportchat');
    },

    async handleReportChatWelcomeModal(interaction) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const currentMessage = this.getSetting(interaction.guildId, 'report_chat_welcome_message') || '';

        const row = new ActionRowBuilder().addComponents(
            new TextInputBuilder({
                customId: 'report_chat_welcome_message',
                label: 'Boas-vindas na thread (vazio = padrão do bot)',
                style: TextInputStyle.Paragraph,
                required: false,
                maxLength: 1000,
                value: currentMessage,
                placeholder: 'Mensagem mostrada assim que a thread é aberta — vale pra reporte e pra revisão de punição...',
            })
        );

        const modal = new ModalBuilder({ customId: 'config-personalizar:reportchat-welcome:modal:submit', title: 'Boas-vindas do Report-Chat', components: [row] });
        await interaction.showModal(modal);
    },

    async processReportChatWelcomeModal(interaction) {
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const newMessage = interaction.fields.getTextInputValue('report_chat_welcome_message').trim();
        const oldMessage = this.getSetting(interaction.guildId, 'report_chat_welcome_message') || '';

        this.setSetting(interaction.guildId, 'report_chat_welcome_message', newMessage || null);
        this.clearCache(interaction.guildId);

        const changeMessage = newMessage !== oldMessage
            ? `${EMOJIS.circlecheck || '✅'} **Mensagem de boas-vindas do report-chat atualizada.**`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (newMessage !== oldMessage) await this.logConfigChange(interaction, `${EMOJIS.edit || '✏️'} Boas-vindas do report-chat foi ${newMessage ? 'alterada' : 'resetada para o padrão'}.`);
        await this.refreshPersonalizarPanel(interaction, changeMessage, interaction.guild.name, 'reportchat');
    },

    async resetReportChat(interaction) {
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        this.setSetting(interaction.guildId, 'report_chat_banner_key', null);
        this.setSetting(interaction.guildId, 'report_chat_message', null);
        this.setSetting(interaction.guildId, 'report_chat_welcome_message', null);
        this.clearCache(interaction.guildId);
        await this.logConfigChange(interaction, `${EMOJIS.refreshccw || '⚠️'} Banner e mensagens do report-chat resetados para o padrão.`);
        await this.refreshPersonalizarPanel(interaction, `${EMOJIS.circlecheck || '✅'} Banner e mensagens resetados para o padrão!`, interaction.guild.name, 'reportchat');
    },

    // ==================== APARÊNCIA GERAL (COR + FOOTER, CAÇADOR) ====================
    // Cor de destaque e footer aplicados em /strike, /unstrike, report-chat,
    // e nos logs de Punições/Reports/Geral (pedido do dono) — NÃO aplicado
    // aos ~90 outros paineis do bot (developer/system-log/erro e a maioria
    // dos comandos comuns) porque isso exigiria threadear guildId por ~110
    // pontos de construção de container diferentes, boa parte deles sem
    // relação nenhuma com um servidor de cliente (paineis internos do
    // dono do bot). Ver getPanelPersonalization() pra onde isso é lido.

    /**
     * Cor de destaque e footer customizados do servidor (aba "Aparência
     * Geral" de /config personalizar). Retorna `null` em qualquer campo
     * sem valor configurado (ou fora do Caçador) — quem chamar decide o
     * fallback (cor/footer padrão do bot). Checagem de tier NA LEITURA,
     * mesmo critério dos outros itens de /config personalizar — perder o
     * Caçador volta tudo pro padrão sozinho, sem precisar resetar nada.
     *
     * @param {string} guildId
     * @returns {{ accentColor: number|null, footerText: string|null }}
     */
    getPanelPersonalization(guildId) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (!guildId || !PremiumSystem.isGuildAtLeast(guildId, 'cacador')) {
            return { accentColor: null, footerText: null };
        }
        const colorHex = this.getSetting(guildId, 'panel_accent_color');
        const footerText = this.getSetting(guildId, 'panel_footer_text');
        return {
            accentColor: colorHex && /^[0-9A-Fa-f]{6}$/.test(colorHex) ? parseInt(colorHex, 16) : null,
            footerText: footerText || null,
        };
    },

    async handlePanelColorModal(interaction) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const currentHex = this.getSetting(interaction.guildId, 'panel_accent_color') || '';
        const row = new ActionRowBuilder().addComponents(
            new TextInputBuilder({
                customId: 'panel_accent_color',
                label: 'Cor em hexadecimal, sem # (ex: FF4E3B)',
                style: TextInputStyle.Short,
                required: false,
                maxLength: 6,
                value: currentHex,
                placeholder: 'Vazio = volta pra cor padrão de cada painel',
            })
        );
        const modal = new ModalBuilder({ customId: 'config-personalizar:aparencia-color:modal:submit', title: 'Cor de Destaque dos Painéis', components: [row] });
        await interaction.showModal(modal);
    },

    async processPanelColorModal(interaction) {
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const raw = interaction.fields.getTextInputValue('panel_accent_color').trim().replace(/^#/, '');
        if (raw && !/^[0-9A-Fa-f]{6}$/.test(raw)) {
            return await ResponseManager.error(interaction, 'Cor inválida — use 6 caracteres hexadecimais (ex: FF4E3B), ou deixe vazio pra voltar ao padrão.');
        }

        const oldValue = this.getSetting(interaction.guildId, 'panel_accent_color');
        this.setSetting(interaction.guildId, 'panel_accent_color', raw || null);
        this.clearCache(interaction.guildId);

        const changeMessage = (oldValue || '') !== raw
            ? `${EMOJIS.circlecheck || '✅'} **Cor dos painéis atualizada:** ${raw ? `#${raw.toUpperCase()}` : 'padrão do bot'}.`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if ((oldValue || '') !== raw) await this.logConfigChange(interaction, `${EMOJIS.palette || '🎨'} Cor dos painéis: \`${oldValue || 'padrão'}\` → \`${raw || 'padrão'}\``);
        await this.refreshPersonalizarPanel(interaction, changeMessage, interaction.guild.name, 'aparencia');
    },

    async handlePanelFooterModal(interaction) {
        if (!interaction.isButton()) {
            return await ResponseManager.error(interaction, 'Esta ação só pode ser feita clicando no botão.');
        }
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const currentFooter = this.getSetting(interaction.guildId, 'panel_footer_text') || '';
        const row = new ActionRowBuilder().addComponents(
            new TextInputBuilder({
                customId: 'panel_footer_text',
                label: 'Texto do footer (vazio = padrão do bot)',
                style: TextInputStyle.Short,
                required: false,
                maxLength: 100,
                value: currentFooter,
                placeholder: 'Substitui "Produzido por KnustVI e T.Mach | Server: X" por completo',
            })
        );
        const modal = new ModalBuilder({ customId: 'config-personalizar:aparencia-footer:modal:submit', title: 'Footer dos Painéis', components: [row] });
        await interaction.showModal(modal);
    },

    async processPanelFooterModal(interaction) {
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        const newFooter = interaction.fields.getTextInputValue('panel_footer_text').trim();
        const oldFooter = this.getSetting(interaction.guildId, 'panel_footer_text') || '';

        this.setSetting(interaction.guildId, 'panel_footer_text', newFooter || null);
        this.clearCache(interaction.guildId);

        const changeMessage = newFooter !== oldFooter
            ? `${EMOJIS.circlecheck || '✅'} **Footer dos painéis atualizado.**`
            : `${EMOJIS.messagesquare || 'ℹ️'} Nenhuma alteração foi detectada.`;
        if (newFooter !== oldFooter) await this.logConfigChange(interaction, `${EMOJIS.edit || '✏️'} Footer dos painéis foi ${newFooter ? 'alterado' : 'resetado para o padrão'}.`);
        await this.refreshPersonalizarPanel(interaction, changeMessage, interaction.guild.name, 'aparencia');
    },

    async resetPanelPersonalization(interaction) {
        if (!(await this._assertPersonalizarAllowed(interaction))) return;

        this.setSetting(interaction.guildId, 'panel_accent_color', null);
        this.setSetting(interaction.guildId, 'panel_footer_text', null);
        this.clearCache(interaction.guildId);
        await this.logConfigChange(interaction, `${EMOJIS.refreshccw || '⚠️'} Cor e footer dos painéis resetados para o padrão.`);
        await this.refreshPersonalizarPanel(interaction, `${EMOJIS.circlecheck || '✅'} Cor e footer resetados para o padrão!`, interaction.guild.name, 'aparencia');
    },

    /**
     * Painel de /config personalizar — 3 abas: "strike" (banner de /strike +
     * banner de /unstrike, cada um com seu próprio select), "reportchat"
     * (banner + mensagem do painel de report-chat, com botão de editar
     * mensagem e resetar padrão) e "aparencia" (cor de destaque + footer,
     * aplicados globalmente em /strike, /unstrike, report-chat e logs — ver
     * getPanelPersonalization()). Todo o conteúdo é exclusivo do plano
     * Caçador — a checagem de tier acontece aqui na LEITURA também (não só
     * na escrita dos handlers acima), então perder o Caçador volta pro
     * padrão sozinho em qualquer uma das personalizações (mesmo critério já
     * usado em reportChatSystem.js.getPanel).
     */
    async refreshPersonalizarPanel(interaction, successMessage, guildName, tab = 'strike') {
        const guildId = interaction.guildId;
        const PremiumSystem = require('../premium/premiumSystem');

        if (!PremiumSystem.isGuildAtLeast(guildId, 'cacador')) {
            const deniedBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(PremiumSystem.getGuildDenialMessage(guildId))
                .footer(guildName);
            const deniedPayload = deniedBuilder.build();
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(deniedPayload);
            } else {
                await interaction.update(deniedPayload);
            }
            return;
        }

        const activeTab = ['reportchat', 'aparencia'].includes(tab) ? tab : 'strike';
        const cb = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });

        if (activeTab === 'strike') {
            const strikeBannerKey = this.getSetting(guildId, 'strike_banner_key') || 'title_strike';
            const unstrikeBannerKey = this.getSetting(guildId, 'unstrike_banner_key') || 'title_strike_removido';
            const strikeLabel = STRIKE_BANNER_OPTIONS.find(opt => opt.value === strikeBannerKey)?.label || strikeBannerKey;
            const unstrikeLabel = UNSTRIKE_BANNER_OPTIONS.find(opt => opt.value === unstrikeBannerKey)?.label || unstrikeBannerKey;

            cb.section(
                [
                    '# PERSONALIZAÇÃO — STRIKE / UNSTRIKE',
                    'Troque o banner mostrado no painel de aplicação (`/strike`) e de anulação (`/unstrike`) de punição — recurso exclusivo do plano Caçador.',
                ].join('\n'),
                cb.assetThumbnail('icone_art') || AdvancedContainerBuilder.thumbnail(interaction.guild.iconURL({ size: 128 }))
            );
            cb.title(`${EMOJIS.imagem || '🖼️'} Banner do /strike`, 2);
            cb.block([`${EMOJIS.circlecheck || '✅'} ${strikeLabel}`]);
            // Select logo abaixo do bloco do PRÓPRIO banner (não no final do
            // painel) — pedido do dono, cada seleção fica junto da seção a
            // que pertence, em vez das duas juntas embaixo dos dois blocos.
            cb.selectMenu(new StringSelectMenuBuilder()
                .setCustomId('config-personalizar:strike-banner')
                .setPlaceholder('Escolha o banner do /strike...')
                .addOptions(STRIKE_BANNER_OPTIONS.map(opt => new StringSelectMenuOptionBuilder()
                    .setLabel(opt.label)
                    .setValue(opt.value)
                    .setDefault(opt.value === strikeBannerKey)
                )));
            cb.separator();
            cb.title(`${EMOJIS.imagem || '🖼️'} Banner do /unstrike`, 2);
            cb.block([`${EMOJIS.circlecheck || '✅'} ${unstrikeLabel}`]);
            cb.selectMenu(new StringSelectMenuBuilder()
                .setCustomId('config-personalizar:unstrike-banner')
                .setPlaceholder('Escolha o banner do /unstrike...')
                .addOptions(UNSTRIKE_BANNER_OPTIONS.map(opt => new StringSelectMenuOptionBuilder()
                    .setLabel(opt.label)
                    .setValue(opt.value)
                    .setDefault(opt.value === unstrikeBannerKey)
                )));
        } else if (activeTab === 'reportchat') {
            const bannerKey = this.getSetting(guildId, 'report_chat_banner_key') || 'title_report_chat';
            const customMessage = this.getSetting(guildId, 'report_chat_message');
            const welcomeMessage = this.getSetting(guildId, 'report_chat_welcome_message');
            const bannerLabel = REPORT_CHAT_BANNER_OPTIONS.find(opt => opt.value === bannerKey)?.label || bannerKey;

            cb.section(
                [
                    '# PERSONALIZAÇÃO DO REPORT-CHAT',
                    'Troque o banner, a mensagem de abertura do painel (o mesmo que `/reportchat` posta no canal) e a mensagem de boas-vindas da thread (a 1ª mensagem que a pessoa vê ao abrir um reporte ou revisão) — recurso exclusivo do plano Caçador. O banner escolhido abaixo também aparece na thread.',
                ].join('\n'),
                cb.assetThumbnail('icone_art') || AdvancedContainerBuilder.thumbnail(interaction.guild.iconURL({ size: 128 }))
            );
            cb.title(`${EMOJIS.imagem || '🖼️'} Banner atual`, 2);
            cb.block([`${EMOJIS.circlecheck || '✅'} ${bannerLabel}`]);
            cb.selectMenu(new StringSelectMenuBuilder()
                .setCustomId('config-personalizar:reportchat-banner')
                .setPlaceholder('Escolha o banner...')
                .addOptions(REPORT_CHAT_BANNER_OPTIONS.map(opt => new StringSelectMenuOptionBuilder()
                    .setLabel(opt.label)
                    .setValue(opt.value)
                    .setDefault(opt.value === bannerKey)
                )));
            cb.separator();
            cb.title(`${EMOJIS.messagesquare || '💬'} Mensagem do painel atual`, 2);
            cb.block([customMessage || `${EMOJIS.messagesquare || 'ℹ️'} Padrão do bot (nenhuma mensagem customizada ainda).`]);
            cb.separator();
            cb.title(`${EMOJIS.messagesquare || '💬'} Mensagem de boas-vindas atual (dentro da thread)`, 2);
            cb.block([welcomeMessage || `${EMOJIS.messagesquare || 'ℹ️'} Padrão do bot — muda conforme é reporte ou revisão de punição (nenhuma mensagem customizada ainda).`]);
            // Botões de edição ficam DENTRO do painel, logo após a descrição
            // que editam — mesmo critério já aplicado aos selects de banner
            // (pedido do dono). Só a navegação entre abas fica fora.
            cb.buttons(
                AdvancedContainerBuilder.secondaryButton('config-personalizar:reportchat-message:modal', 'Editar Mensagem do Painel').setEmoji(EMOJIS.edit || '✏️'),
                AdvancedContainerBuilder.secondaryButton('config-personalizar:reportchat-welcome:modal', 'Editar Boas-vindas').setEmoji(EMOJIS.edit || '✏️'),
                AdvancedContainerBuilder.dangerButton('config-personalizar:reportchat-reset', 'Resetar Padrão').setEmoji(EMOJIS.refreshccw || '⚠️'),
            );
        } else {
            const colorHex = this.getSetting(guildId, 'panel_accent_color');
            const footerText = this.getSetting(guildId, 'panel_footer_text');

            cb.section(
                [
                    '# APARÊNCIA GERAL',
                    'Cor de destaque e footer aplicados em `/strike`, `/unstrike`, report-chat, e nos logs de Punições/Reports/Geral — recurso exclusivo do plano Caçador.',
                ].join('\n'),
                cb.assetThumbnail('icone_art') || AdvancedContainerBuilder.thumbnail(interaction.guild.iconURL({ size: 128 }))
            );
            cb.title(`${EMOJIS.palette || '🎨'} Cor de destaque`, 2);
            cb.block([colorHex ? `${EMOJIS.circlecheck || '✅'} #${colorHex.toUpperCase()}` : `${EMOJIS.messagesquare || 'ℹ️'} Padrão do bot (cada painel usa sua própria cor).`]);
            cb.buttons(AdvancedContainerBuilder.secondaryButton('config-personalizar:aparencia-color:modal', 'Editar Cor').setEmoji(EMOJIS.palette || '🎨'));
            cb.separator();
            cb.title(`${EMOJIS.messagesquare || '💬'} Footer`, 2);
            cb.block([footerText || `${EMOJIS.messagesquare || 'ℹ️'} Padrão do bot ("Produzido por KnustVI e T.Mach | Server: ${guildName}").`]);
            cb.buttons(
                AdvancedContainerBuilder.secondaryButton('config-personalizar:aparencia-footer:modal', 'Editar Footer').setEmoji(EMOJIS.edit || '✏️'),
                AdvancedContainerBuilder.dangerButton('config-personalizar:aparencia-reset', 'Resetar Padrão').setEmoji(EMOJIS.refreshccw || '⚠️'),
            );
        }

        cb.footer(guildName);
        const { components, flags, files } = cb.build();

        // Fora do painel fica SÓ a navegação entre abas — os botões de
        // edição de cada aba já foram embutidos no container acima.
        const bottomRows = [];
        bottomRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config-personalizar:tab:strike')
                .setLabel('Strike / Unstrike')
                .setEmoji(EMOJIS.gavel || undefined)
                .setStyle(activeTab === 'strike' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('config-personalizar:tab:reportchat')
                .setLabel('Report-Chat')
                .setEmoji(EMOJIS.ticket || undefined)
                .setStyle(activeTab === 'reportchat' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('config-personalizar:tab:aparencia')
                .setLabel('Aparência Geral')
                .setEmoji(EMOJIS.palette || undefined)
                .setStyle(activeTab === 'aparencia' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ));

        const replyData = { components: [...components, ...bottomRows], flags, files };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(replyData);
        } else {
            await interaction.update(replyData);
        }
        await this.sendFeedback(interaction, successMessage);
    },
};

module.exports = ConfigSystem;