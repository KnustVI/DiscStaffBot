// src/commands/events/evento.js
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    AttachmentBuilder,
    GuildScheduledEventEntityType,
    GuildScheduledEventPrivacyLevel,
} = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PremiumSystem = require('../../systems/premium/premiumSystem');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const VALID_IMAGE_TYPES = ['image/png', 'image/jpeg'];
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1279;
const DEFAULT_EXTERNAL_DURATION_MS = 4 * 60 * 60 * 1000; // 4h, usado só quando o local é descritivo

/**
 * Aceita "DD/MM/AAAA HH:MM" (horário do servidor do bot). Retorna null se o
 * formato ou os valores forem inválidos.
 */
function parseEventDate(raw) {
    const match = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const minute = parseInt(match[5], 10);

    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (isNaN(date.getTime()) || date.getDate() !== day || date.getMonth() !== month - 1) return null;

    return date;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('evento')
        .setDescription('📅 Cria e publica um evento da comunidade (fórum + evento agendado do Discord).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
        .addChannelOption(opt => opt.setName('forum')
            .setDescription('Canal de fórum onde a postagem do evento será criada')
            .addChannelTypes(ChannelType.GuildForum)
            .setRequired(true))
        .addStringOption(opt => opt.setName('titulo')
            .setDescription('Título do evento')
            .setMaxLength(100)
            .setRequired(true))
        .addStringOption(opt => opt.setName('descricao')
            .setDescription('Breve descrição do evento')
            .setMaxLength(1000)
            .setRequired(true))
        .addAttachmentOption(opt => opt.setName('imagem')
            .setDescription('Imagem de divulgação (PNG ou JPEG, máximo 1920x1279)')
            .setRequired(true))
        .addStringOption(opt => opt.setName('data')
            .setDescription('Data e hora do evento (formato DD/MM/AAAA HH:MM)')
            .setRequired(true))
        .addChannelOption(opt => opt.setName('local_canal')
            .setDescription('Local do evento: um canal de voz/palco (use OU este OU "local_descricao", não os dois)')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
            .setRequired(false))
        .addStringOption(opt => opt.setName('local_descricao')
            .setDescription('Local do evento: um texto livre, ex: "Servidor PoT - Ilha Central" (alternativa a local_canal)')
            .setMaxLength(100)
            .setRequired(false)),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        // ── Nível do sistema de eventos por tier (ver premiumPanel.js):
        // 'basic' (Free) = só posta no fórum, sem evento agendado do Discord
        // nem marcação de cargo; 'medium'/'full' (Rastreador/Caçador) = fórum
        // + evento agendado do Discord + marcação do cargo de notificação. ──
        const eventTier = PremiumSystem.getGuildLimits(guild.id).eventTier;

        const ConfigSystem = require('../../systems/core/configSystem');

        // ==================== PERMISSÃO: EQUIPE DE EVENTOS ====================
        const eventRoleId = ConfigSystem.getSetting(guild.id, 'event_role');
        if (!eventRoleId) {
            return await ResponseManager.error(
                interaction,
                'O cargo da Equipe de Eventos ainda não foi configurado. Peça a um administrador para configurar em /config roles (aba Eventos) antes de criar eventos.'
            );
        }
        if (!member.roles.cache.has(eventRoleId)) {
            return await ResponseManager.error(
                interaction,
                `Você precisa do cargo <@&${eventRoleId}> (Equipe de Eventos) para usar este comando.`
            );
        }

        const forumChannel = interaction.options.getChannel('forum');
        const titulo = interaction.options.getString('titulo');
        const descricao = interaction.options.getString('descricao');
        const imagem = interaction.options.getAttachment('imagem');
        const dataStr = interaction.options.getString('data');
        const localCanal = interaction.options.getChannel('local_canal');
        const localDescricao = interaction.options.getString('local_descricao');

        // ==================== VALIDAÇÕES (antes de criar qualquer coisa) ====================

        if (!VALID_IMAGE_TYPES.includes(imagem.contentType)) {
            return await ResponseManager.error(
                interaction,
                `A imagem precisa ser PNG ou JPEG. Você enviou: \`${imagem.contentType || 'formato desconhecido'}\`.`
            );
        }
        if (imagem.width > MAX_WIDTH || imagem.height > MAX_HEIGHT) {
            return await ResponseManager.error(
                interaction,
                `A imagem precisa ter no máximo ${MAX_WIDTH}x${MAX_HEIGHT} pixels. A sua tem ${imagem.width}x${imagem.height}.`
            );
        }

        if (eventTier !== 'basic' && !localCanal && !localDescricao) {
            return await ResponseManager.error(
                interaction,
                'Informe o local do evento: use a opção `local_canal` (um canal de voz/palco) OU `local_descricao` (um texto livre).'
            );
        }
        if (localCanal && localDescricao) {
            return await ResponseManager.error(
                interaction,
                'Use apenas UMA forma de local: `local_canal` OU `local_descricao`, não as duas ao mesmo tempo.'
            );
        }

        const startDate = parseEventDate(dataStr);
        if (!startDate) {
            return await ResponseManager.error(
                interaction,
                'Data inválida. Use o formato `DD/MM/AAAA HH:MM`, por exemplo: `25/12/2026 20:00`.'
            );
        }
        if (startDate.getTime() <= Date.now()) {
            return await ResponseManager.error(interaction, 'A data do evento precisa ser no futuro.');
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        // ==================== MONTAGEM: local/entidade do evento agendado ====================
        // Só relevante a partir do Rastreador — no Free (eventTier 'basic')
        // não existe evento agendado do Discord, só a postagem no fórum.
        let entityType;
        let eventChannelId = null;
        let entityMetadata;
        let scheduledEndTime;

        if (eventTier !== 'basic') {
            if (localCanal) {
                if (localCanal.type === ChannelType.GuildStageVoice) {
                    entityType = GuildScheduledEventEntityType.StageInstance;
                } else if (localCanal.type === ChannelType.GuildVoice) {
                    entityType = GuildScheduledEventEntityType.Voice;
                } else {
                    return await ResponseManager.error(interaction, 'O canal de local precisa ser um canal de voz ou de palco.');
                }
                eventChannelId = localCanal.id;
            } else {
                entityType = GuildScheduledEventEntityType.External;
                entityMetadata = { location: localDescricao };
                scheduledEndTime = new Date(startDate.getTime() + DEFAULT_EXTERNAL_DURATION_MS);
            }
        }

        await interaction.editReply(
            new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT })
                .text(`${EMOJIS.clockalert || '⏳'} Criando evento... isso envolve baixar a imagem${eventTier !== 'basic' ? ', criar o evento agendado do Discord' : ''} e publicar no fórum, pode levar alguns segundos.`)
                .footer(guild.name)
                .build()
        );

        // ==================== IMAGEM: baixa uma vez, reaproveita nos dois lugares ====================
        let imageBuffer;
        try {
            const res = await fetch(imagem.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            imageBuffer = Buffer.from(await res.arrayBuffer());
        } catch (err) {
            console.error('❌ [Evento] Erro ao baixar imagem:', err);
            return await interaction.editReply(this._errorPayload(guild.name, 'Não foi possível baixar a imagem enviada. Tente reenviar o comando com outra imagem.'));
        }
        const imageFileName = imagem.contentType === 'image/png' ? 'evento.png' : 'evento.jpg';

        // ==================== EVENTO AGENDADO DO DISCORD ====================
        // 'Sistema básico de eventos' (Free) não cria evento agendado — só a
        // postagem no fórum, com anexo de imagem.
        let scheduledEvent = null;
        if (eventTier !== 'basic') {
            try {
                scheduledEvent = await guild.scheduledEvents.create({
                    name: titulo,
                    scheduledStartTime: startDate,
                    ...(scheduledEndTime ? { scheduledEndTime } : {}),
                    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
                    entityType,
                    description: descricao,
                    ...(eventChannelId ? { channel: eventChannelId } : {}),
                    ...(entityMetadata ? { entityMetadata } : {}),
                    image: imageBuffer,
                });
            } catch (err) {
                console.error('❌ [Evento] Erro ao criar evento agendado:', err);
                return await interaction.editReply(this._errorPayload(guild.name, `Não foi possível criar o evento agendado no Discord: ${err.message}. Verifique se o bot tem a permissão "Gerenciar Eventos".`));
            }
        }

        // ==================== POSTAGEM NO FÓRUM ====================
        // Marcação do cargo de notificação também é 'Sistema médio/completo
        // de eventos' — não disponível no Free.
        const notifyRoleId = eventTier !== 'basic' ? ConfigSystem.getSetting(guild.id, 'event_notify_role') : null;

        const postBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        // ── Só a imagem enviada pelo autor aparece na postagem — sem avatar
        // do organizador nem qualquer outra imagem extra. Por isso título e
        // descrição vão como texto simples, não em section() (que exige um
        // acessório de imagem/botão). ─────────────────────────────────────
        postBuilder.gallery([`attachment://${imageFileName}`]);
        postBuilder.text(`# ${titulo}`);
        postBuilder.text(descricao);
        postBuilder.separator();
        const startTs = Math.floor(startDate.getTime() / 1000);
        postBuilder.text(`${EMOJIS.calendardays || '📅'} **Data:** <t:${startTs}:F> (<t:${startTs}:R>)`);
        postBuilder.text(`${EMOJIS.mappin || '📍'} **Local:** ${localCanal ? localCanal.toString() : (localDescricao || 'Não informado')}`);
        postBuilder.text(`${EMOJIS.user || '👤'} **Organizado por:** ${user.toString()}`);
        if (notifyRoleId) {
            postBuilder.separator();
            postBuilder.text(`${EMOJIS.megaphone || '📣'} <@&${notifyRoleId}>`);
        }
        postBuilder.footer(guild.name);

        const { components, flags } = postBuilder.build();
        const imageAttachment = new AttachmentBuilder(imageBuffer, { name: imageFileName });

        let thread;
        try {
            thread = await forumChannel.threads.create({
                name: titulo,
                message: { components, flags, files: [imageAttachment] },
            });
        } catch (err) {
            console.error('❌ [Evento] Erro ao publicar no fórum:', err);
            // ── Sem a postagem no fórum o evento fica "órfão" (agendado mas
            // sem divulgação) — melhor desfazer o evento agendado do que
            // deixar esse estado inconsistente para o staff resolver na mão. ──
            if (scheduledEvent) await scheduledEvent.delete().catch(() => {});
            return await interaction.editReply(this._errorPayload(
                guild.name,
                `Não foi possível publicar no fórum selecionado${scheduledEvent ? ' (o evento agendado foi desfeito)' : ''}: ${err.message}. Verifique se o canal aceita novas postagens (tags obrigatórias, permissões do bot) e tente novamente.`,
            ));
        }

        // ==================== LINK DO EVENTO NA THREAD ====================
        if (scheduledEvent) {
            await thread.send(
                `${EMOJIS.wifi || '🔗'} **Evento agendado:** ${scheduledEvent.url}\n` +
                `${EMOJIS.circlealert || '🔔'} Clique em **Me Interessa** no evento acima para o Discord te avisar automaticamente quando ele começar!`
            ).catch(() => {});
        }

        db.logActivity(guild.id, user.id, 'event_created', null, {
            command: 'evento', title: titulo, threadId: thread.id, scheduledEventId: scheduledEvent?.id || null,
            startDate: startDate.toISOString(),
        });

        const AnalyticsSystem = require('../../systems/moderation/analyticsSystem');
        AnalyticsSystem.recordEventCreated(guild.id, user.id);

        // ==================== RESUMO PARA O STAFF ====================
        const summaryBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
        summaryBuilder.text(`${EMOJIS.circlecheck || '✅'} **Evento "${titulo}" criado com sucesso!**`);
        summaryBuilder.text(`${EMOJIS.clipboardlist || '📋'} Postagem: ${thread.toString()}`);
        if (scheduledEvent) summaryBuilder.text(`${EMOJIS.wifi || '🔗'} Evento agendado: ${scheduledEvent.url}`);
        summaryBuilder.text(`${EMOJIS.calendardays || '📅'} Início: <t:${startTs}:F>`);
        summaryBuilder.separator();
        if (scheduledEvent) {
            summaryBuilder.text(
                `${EMOJIS.trianglealert || '⚠️'} **Lembrete:** quando a hora chegar, alguém do staff precisa **iniciar o evento manualmente** no Discord (clique no botão **Eventos** no canto superior esquerdo da barra de canais, abra o evento e clique em Iniciar). ` +
                `Só assim o Discord notifica automaticamente quem clicou em "Me Interessa".`
            );
            if (!notifyRoleId) {
                summaryBuilder.text(`${EMOJIS.trianglealert || '⚠️'} O cargo de Notificação de Eventos não está configurado (/config roles, aba Eventos) — ninguém foi marcado na postagem.`);
            }
        } else {
            summaryBuilder.text(`${EMOJIS.messagesquare || 'ℹ️'} Evento agendado do Discord e marcação de cargo exigem o plano Rastreador ou superior. Use \`/premium\` para saber mais.`);
        }
        summaryBuilder.footer(guild.name);

        await interaction.editReply(summaryBuilder.build());
    },

    _errorPayload(guildName, message) {
        return new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
            .text(`${EMOJIS.circlealert || '❌'} ${message}`)
            .footer(guildName)
            .build();
    },
};
