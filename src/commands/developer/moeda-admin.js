// src/commands/developer/moeda-admin.js
/**
 * Ajuste manual de Ossos/Caçadas de um jogador — restrito ao
 * desenvolvedor do bot. Pedido do dono, 2026-08-19: "Crie comando de
 * acesso apena do DEV para adicioanr ou remover as moedas de um usúario,
 * se for osso pedir servidor, (assim removemos os osso daquele
 * servidor)". Suporte manual (corrigir um erro, compensar um bug,
 * reverter algo) — não passa por spendBones/spendHunt (que falham se o
 * saldo for insuficiente); usa adjustBones/adjustHunt
 * (potPlayerRegistry.js), que somam OU subtraem livremente e nunca
 * deixam o saldo negativo (clampado em 0).
 *
 * Ossos é moeda POR SERVIDOR (ver pot_player_bones/schema.js) — sempre
 * exige um servidor (servidor_id) pra saber ONDE ajustar. Caçadas é
 * GLOBAL (player_links.hunt_balance) — nunca pede servidor. A opção
 * `servidor_id` não pode ser condicionalmente obrigatória na API do
 * Discord (SlashCommandBuilder não suporta "obrigatório só quando outra
 * opção for X"), então fica opcional na definição e é validada em
 * runtime logo no início de execute().
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const PoTConfigSystem = require('../../systems/pot/potConfigSystem');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

function currencyOptions(sub) {
    return sub
        .addUserOption(opt => opt.setName('usuario').setDescription('Jogador').setRequired(true))
        .addStringOption(opt => opt.setName('moeda').setDescription('Qual moeda').setRequired(true)
            .addChoices({ name: 'Ossos', value: 'ossos' }, { name: 'Caçadas', value: 'cacadas' }))
        .addIntegerOption(opt => opt.setName('quantidade').setDescription('Quantidade (sempre positiva)').setRequired(true).setMinValue(1))
        .addStringOption(opt => opt.setName('servidor_id').setDescription('ID do servidor Discord — obrigatório só pra Ossos (moeda por servidor)').setRequired(false));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('moeda-admin')
        .setDescription('🔒 Ajusta Ossos/Caçadas de um jogador (restrito ao desenvolvedor do bot)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => currencyOptions(sub
            .setName('adicionar')
            .setDescription('Credita Ossos ou Caçadas a um jogador')))
        .addSubcommand(sub => currencyOptions(sub
            .setName('remover')
            .setDescription('Debita Ossos ou Caçadas de um jogador (nunca fica negativo)'))),

    // client aqui é sempre o bot PRINCIPAL (já em todo servidor de
    // cliente), não o bot developer que recebeu a interação — ver
    // src/systems/core/devBot.js. Usado só pra resolver o nome do
    // servidor no rodapé/validar que servidor_id é um servidor real.
    async execute(interaction, client) {
        const { user } = interaction;

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(null, user.id, 'moeda_admin_denied', null, { command: 'moeda-admin' });
            const denied = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Este comando é restrito ao desenvolvedor do bot.`)
                .footer('Bot de Developer');
            const { components, flags } = denied.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        const sub = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('usuario');
        const moeda = interaction.options.getString('moeda');
        const quantidade = interaction.options.getInteger('quantidade');
        const servidorId = interaction.options.getString('servidor_id');
        const sign = sub === 'remover' ? -1 : 1;

        const errorReply = async (text) => {
            const denied = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} ${text}`)
                .footer('Bot de Developer');
            const { components, flags } = denied.build();
            await interaction.editReply({ components, flags: [flags] });
        };

        // Precisa de vínculo (/registrar) antes de mexer em qualquer saldo
        // — sem player_links, adjustHunt não teria linha pra atualizar
        // (UPDATE puro, nunca cria) e Ossos também não faz sentido pra
        // quem nunca jogou/vinculou.
        const link = PlayerRegistry.getPlayerByDiscordId(targetUser.id);
        if (!link) {
            return errorReply(`${targetUser.tag} ainda não está vinculado com \`/registrar\` — não há saldo pra ajustar.`);
        }

        let guildName = null;
        if (moeda === 'ossos') {
            if (!servidorId) {
                return errorReply('Ossos é moeda **por servidor** — informe `servidor_id` (ID do servidor Discord onde ajustar).');
            }
            const targetGuild = client.guilds.cache.get(servidorId);
            const potConfig = PoTConfigSystem.getServerConfig(servidorId);
            if (!targetGuild || !potConfig) {
                return errorReply(`Servidor \`${servidorId}\` não encontrado ou sem Path of Titans configurado — Ossos só existe pra servidores com PoT configurado.`);
            }
            guildName = potConfig.server_name || targetGuild.name;
        }

        const before = moeda === 'ossos'
            ? PlayerRegistry.getBonesBalance(targetUser.id, servidorId)
            : PlayerRegistry.getHuntBalance(targetUser.id);

        const after = moeda === 'ossos'
            ? PlayerRegistry.adjustBones(targetUser.id, servidorId, quantidade * sign)
            : PlayerRegistry.adjustHunt(targetUser.id, quantidade * sign);

        db.logActivity(moeda === 'ossos' ? servidorId : null, user.id, 'moeda_admin_adjust', targetUser.id, {
            moeda, sub, quantidade, before, after, servidorId: moeda === 'ossos' ? servidorId : null,
        });

        const currencyLabel = moeda === 'ossos' ? 'Ossos' : 'Caçadas';
        const currencyEmoji = moeda === 'ossos' ? (EMOJIS.bone || '🦴') : (EMOJIS.coins || '🪙');
        const actionLabel = sub === 'remover' ? 'REMOVIDO' : 'ADICIONADO';

        const builder = new AdvancedContainerBuilder({ accentColor: sub === 'remover' ? COLORS.ERROR : COLORS.SUCCESS });
        builder.text(`# ${currencyEmoji} ${currencyLabel} — ${actionLabel}`);
        builder.separator();
        builder.text(`**Jogador:** <@${targetUser.id}> (\`${targetUser.tag}\`)`);
        if (guildName) builder.text(`**Servidor:** ${guildName} (\`${servidorId}\`)`);
        builder.text(`**${sub === 'remover' ? 'Removidos' : 'Adicionados'}:** ${quantidade} ${currencyLabel}`);
        builder.text(`**Saldo anterior:** ${before}`);
        builder.text(`**Saldo atual:** ${after}`);
        if (sub === 'remover' && before - quantidade < 0) {
            builder.text(`-# Removido mais do que o saldo tinha — zerado em vez de ficar negativo.`);
        }
        builder.footer(`Ajustado por ${user.tag}`);

        const { components, flags } = builder.build();
        await interaction.editReply({ components, flags: [flags] });
    },
};
