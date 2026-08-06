// src/commands/events/divulgar.js
/**
 * Publica/atualiza a divulgação do servidor mostrada no feed global
 * "Novidades dos Servidores Parceiros" da home do site (ver hero.ejs e
 * dashboard.js getPartnerNews) — pedido do dono: um comando de verdade
 * pra publicar (antes só dava pra editar título/texto pelo dashboard web,
 * sem imagem, sem limite de frequência, ver PREMIUM.txt seção 113).
 *
 * Cada publicação SUBSTITUI a anterior por completo (título, texto,
 * imagem e evento vinculado) — não existe histórico, só a divulgação
 * ATUAL de cada servidor, mesmo modelo de sempre (settings key/value por
 * guild, ver ConfigSystem). moderacao.ejs "DIVULGAÇÃO DO SERVIDOR" virou
 * um card SÓ DE LEITURA (prévia + próxima data disponível) — publicar/
 * trocar passou a ser exclusivo daqui, único jeito de garantir que toda
 * divulgação nova sempre tem imagem e respeita o limite semanal (o
 * dashboard web não reimplementa nenhuma dessas duas regras, evitando um
 * atalho que ignorasse as duas).
 */
const { SlashCommandBuilder, PermissionFlagsBits, GuildScheduledEventStatus } = require('discord.js');
const ConfigSystem = require('../../systems/core/configSystem');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { uploadAndStoreImage } = require('../../utils/imageStorage');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

// Um post por semana (pedido do dono) — controlado pela MESMA
// partner_news_updated_at que o dashboard web já mantinha só pra ordenar
// o feed (ver getPartnerNews). Reaproveitar esse campo em vez de criar um
// separado tem um efeito colateral desejado: como moderacao.ejs agora só
// mostra a divulgação (não edita mais), não existe outro caminho que
// resete esse timestamp escondido — o limite não tem como ser burlado.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('divulgar')
        .setDescription('📣 Publica a divulgação do seu servidor na home do site (1x por semana, imagem obrigatória).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('titulo')
            .setDescription('Título da divulgação')
            .setMaxLength(80)
            .setRequired(true))
        .addStringOption(opt => opt.setName('texto')
            .setDescription('Texto da divulgação')
            .setMaxLength(280)
            .setRequired(true))
        .addAttachmentOption(opt => opt.setName('imagem')
            .setDescription('Imagem de ilustração da divulgação (PNG, JPEG ou WEBP) — sempre obrigatória')
            .setRequired(true))
        .addStringOption(opt => opt.setName('evento')
            .setDescription('Evento agendado do servidor pra destacar junto da divulgação (opcional)')
            .setRequired(false)
            .setAutocomplete(true)),

    async autocomplete(interaction) {
        const guild = interaction.guild;
        if (!guild) return interaction.respond([]).catch(() => {});

        const query = String(interaction.options.getFocused() || '').toLowerCase();

        let eventList;
        try {
            eventList = await guild.scheduledEvents.fetch();
        } catch (err) {
            return interaction.respond([]).catch(() => {});
        }

        const now = Date.now();
        const choices = [...eventList.values()]
            // Só eventos FUTUROS e ainda agendados (Active/Completed/
            // Canceled não fazem sentido "destacar" numa divulgação nova).
            .filter(ev => ev.status === GuildScheduledEventStatus.Scheduled && ev.scheduledStartTimestamp > now)
            .filter(ev => ev.name.toLowerCase().includes(query))
            .sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp)
            .slice(0, 25)
            .map(ev => ({
                name: `${ev.name} — ${new Date(ev.scheduledStartTimestamp).toLocaleString('pt-BR')}`.slice(0, 100),
                value: ev.id,
            }));

        await interaction.respond(choices).catch(() => {});
    },

    async execute(interaction, client) {
        const { guild } = interaction;

        if (!PremiumSystem.isGuildAtLeast(guild.id, 'rastreador')) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
        }

        const lastPostedRaw = ConfigSystem.getSetting(guild.id, 'partner_news_updated_at');
        const lastPostedAt = lastPostedRaw ? parseInt(lastPostedRaw, 10) : null;
        if (lastPostedAt && Date.now() - lastPostedAt < WEEK_MS) {
            const nextEligibleTs = Math.floor((lastPostedAt + WEEK_MS) / 1000);
            return await ResponseManager.error(
                interaction,
                `Só é possível publicar uma divulgação por semana. Você poderá publicar de novo <t:${nextEligibleTs}:R> (<t:${nextEligibleTs}:F>).`
            );
        }

        const titulo = interaction.options.getString('titulo').trim();
        const texto = interaction.options.getString('texto').trim();
        const imagem = interaction.options.getAttachment('imagem');
        const eventoId = interaction.options.getString('evento');

        // Evento é opcional, mas se foi informado precisa continuar existindo
        // e agendado NO MOMENTO da publicação — evita guardar um ID morto que
        // o feed teria que descobrir sozinho depois (ver getPartnerNews).
        let scheduledEvent = null;
        if (eventoId) {
            try {
                scheduledEvent = await guild.scheduledEvents.fetch(eventoId);
            } catch (err) {
                scheduledEvent = null;
            }
            if (!scheduledEvent || scheduledEvent.status !== GuildScheduledEventStatus.Scheduled) {
                return await ResponseManager.error(
                    interaction,
                    'O evento selecionado não existe mais ou já não está mais agendado (foi excluído, começou ou terminou). Rode /divulgar de novo e escolha um evento válido na lista de autocomplete.'
                );
            }
        }

        const uploadResult = await uploadAndStoreImage(
            client,
            imagem,
            `Divulgação de \`${guild.name}\` (\`${guild.id}\`)`
        );
        if (!uploadResult.ok) {
            return await ResponseManager.error(interaction, uploadResult.error);
        }

        const now = Date.now();
        ConfigSystem.setSetting(guild.id, 'partner_news_title', titulo);
        ConfigSystem.setSetting(guild.id, 'partner_news_text', texto);
        ConfigSystem.setSetting(guild.id, 'partner_news_image_message_id', uploadResult.messageId);
        ConfigSystem.setSetting(guild.id, 'partner_news_event_id', scheduledEvent ? scheduledEvent.id : null);
        ConfigSystem.setSetting(guild.id, 'partner_news_updated_at', String(now));

        const nextEligibleTs = Math.floor((now + WEEK_MS) / 1000);
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
        builder.text(`${EMOJIS.circlecheck || '✅'} **Divulgação publicada!** Seu servidor já aparece no feed "Novidades dos Servidores Parceiros" da home do site.`);
        builder.separator();
        // Prévia com a URL original do attachment (ainda válida por ~24h) —
        // evita rebuscar a mensagem que acabou de ser criada no canal de
        // armazenamento só pra mostrar a mesma imagem de volta.
        builder.gallery([imagem.url]);
        builder.text(`${EMOJIS.megaphone || '📣'} **${titulo}**\n${texto}`);
        if (scheduledEvent) {
            const startTs = Math.floor(scheduledEvent.scheduledStartTimestamp / 1000);
            builder.text(`${EMOJIS.calendardays || '📅'} **Evento em destaque:** ${scheduledEvent.name} — <t:${startTs}:F>`);
        }
        builder.separator();
        builder.text(`${EMOJIS.trianglealert || '⚠️'} Só é possível publicar uma nova divulgação por semana — a próxima janela abre <t:${nextEligibleTs}:R>.`);
        builder.footer(guild.name);

        await interaction.editReply(builder.build());
    },
};
