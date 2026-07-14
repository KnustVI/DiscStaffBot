// src/commands/ingame/ingame-buff.js
/**
 * Aplica um buff (preset de RCON `setattr` em lote, configurado em
 * /config buffs — ver buffSystem.js/buffPanelSystem.js) num jogador, plano
 * Caçador (mesma flag `genericRconEnabled` do resto do catálogo /ingame-*).
 *
 * Diferente dos outros /ingame-* (que passam pelo executor genérico de
 * rconCommandCatalog.js): aqui `aplicar` precisa de uma segunda interação
 * (escolher QUAL buff, via select — pode haver mais de um configurado), por
 * isso este arquivo também exporta `handleComponent`, registrado como seu
 * próprio sistema ("ingame-buff") em handlers.js — mesmo padrão já usado
 * pra registrar o comando /ajuda como handler de componente.
 *
 * Checagem de "jogador online agora" ANTES de aplicar (pedido do dono) —
 * feita DUAS vezes: ao escolher o alvo (não faz sentido nem mostrar a lista
 * de buffs pra alguém offline) e de novo ao confirmar o buff (pode ter
 * passado tempo entre as duas interações).
 */
const { SlashCommandBuilder, PermissionFlagsBits, StringSelectMenuBuilder } = require('discord.js');
const { resolveTarget, resolveTargetName } = require('../../systems/pot/rconCommandCatalog');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const ConfigSystem = require('../../systems/core/configSystem');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const BuffSystem = require('../../systems/pot/buffSystem');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const db = require('../../database/index');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

function _isEnabled(guildId) {
    return !!PremiumSystem.getGuildLimits(guildId).genericRconEnabled;
}

async function _ephemeralError(interaction, message) {
    return await interaction.followUp({ content: message, flags: 64 });
}

async function _executeAplicar(interaction) {
    const { guild, member } = interaction;

    if (!_isEnabled(guild.id)) {
        return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
    }
    if (!ConfigSystem.memberHasAnyStaffRole(guild.id, member)) {
        return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Este comando é restrito à equipe do servidor (cargo Staff, ver /config roles).`);
    }

    const target = resolveTarget(interaction);
    if (!target) {
        return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Informe \`usuario\` ou \`agid\` pra usar este comando.`);
    }

    // Checagem pedida pelo dono: sem isso, o RCON "funciona" mas não tem
    // efeito nenhum num jogador offline — mesma lição já aprendida com
    // whisper/systemmessage (ver PREMIUM.txt seção 83).
    const onlinePlayer = PlayerRegistry.getOnlinePotPlayer(guild.id, target);
    if (!onlinePlayer) {
        return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Esse jogador não está online no servidor de jogo agora — não é possível aplicar um buff.`);
    }

    const buffs = BuffSystem.getBuffs(guild.id);
    if (buffs.length === 0) {
        return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Nenhum buff configurado neste servidor ainda. Use \`/config buffs\` pra criar um.`);
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId(`ingame-buff:apply-select:${target}`)
        .setPlaceholder('Selecionar buff')
        .addOptions(buffs.slice(0, 25).map((b) => ({ label: b.name, value: String(b.id) })));

    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Escolha o buff pra aplicar em **${onlinePlayer.player_name || target}**:`);
    if (buffs.length > 25) {
        builder.text(`${EMOJIS.trianglealert || '⚠️'} Mostrando só os 25 primeiros buffs (limite do select do Discord).`);
    }
    builder.selectMenu(select);
    builder.footer(guild.name);
    await ResponseManager.send(interaction, builder);
}

async function _executeListar(interaction) {
    const { guild, member } = interaction;

    if (!_isEnabled(guild.id)) {
        return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
    }
    if (!ConfigSystem.memberHasAnyStaffRole(guild.id, member)) {
        return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Este comando é restrito à equipe do servidor (cargo Staff, ver /config roles).`);
    }

    const buffs = BuffSystem.getBuffs(guild.id);
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    builder.title(`${EMOJIS.gauge || '📊'} Buffs Configurados`, 1);
    builder.separator();

    if (buffs.length === 0) {
        builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Nenhum buff configurado ainda. Use \`/config buffs\` pra criar um.`);
    } else {
        for (const buff of buffs) {
            const stats = BuffSystem.getBuffStats(buff.id);
            const statsText = stats.length > 0
                ? stats.map((s) => `\`${s.attribute}: ${s.value}\``).join(', ')
                : 'Nenhum atributo configurado';
            builder.text(`**${buff.name}**\n${statsText}`);
        }
    }

    builder.footer(guild.name);
    await ResponseManager.send(interaction, builder);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ingame-buff')
        .setDescription('🔒 Aplica um buff (preset de setattr) num jogador (plano Caçador).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand((sub) => sub
            .setName('aplicar')
            .setDescription('Aplica um buff configurado num jogador.')
            .addUserOption((o) => o.setName('usuario').setDescription('Jogador com Discord vinculado (/registrar)').setRequired(false))
            .addStringOption((o) => o.setName('agid').setDescription('Alderon ID ou nome do jogador, se ele não estiver vinculado').setRequired(false)))
        .addSubcommand((sub) => sub
            .setName('listar')
            .setDescription('Lista os buffs configurados neste servidor.')),

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'listar') return await _executeListar(interaction);
        return await _executeAplicar(interaction);
    },

    /**
     * ingame-buff:apply-select:<targetAlderonId> — select mostrado por
     * /ingame-buff aplicar. Registrado como sistema próprio ("ingame-buff")
     * em handlers.js, mesmo padrão já usado pra /ajuda.
     */
    async handleComponent(interaction, action, param) {
        if (action !== 'apply-select') {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Ação desconhecida.`);
        }

        const target = param;
        const buffId = interaction.values?.[0];
        const guildId = interaction.guildId;

        if (!_isEnabled(guildId)) {
            return await _ephemeralError(interaction, PremiumSystem.getGuildDenialMessage(guildId));
        }
        if (!ConfigSystem.memberHasAnyStaffRole(guildId, interaction.member)) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Este comando é restrito à equipe do servidor (cargo Staff, ver /config roles).`);
        }

        // Re-checagem: pode ter passado tempo entre escolher o alvo (comando)
        // e escolher o buff (este select) — o jogador pode ter saído nesse meio-tempo.
        const onlinePlayer = PlayerRegistry.getOnlinePotPlayer(guildId, target);
        if (!onlinePlayer) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Esse jogador não está online no servidor de jogo agora — buff não aplicado.`);
        }

        const buff = BuffSystem.getBuff(guildId, buffId);
        if (!buff) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Esse buff não existe mais.`);
        }

        const stats = BuffSystem.getBuffStats(buffId);
        if (stats.length === 0) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Esse buff não tem nenhum atributo configurado ainda.`);
        }

        const results = await BuffSystem.applyBuffToPlayer(guildId, buffId, target);
        const allSucceeded = results.every((r) => r.success);
        const anySucceeded = results.some((r) => r.success);

        db.logActivity(guildId, interaction.user.id, 'buff_applied', target, {
            buffId, buffName: buff.name, results,
        });

        const builder = new AdvancedContainerBuilder({
            accentColor: allSucceeded ? COLORS.SUCCESS : (anySucceeded ? COLORS.DEFAULT : COLORS.ERROR),
        });
        builder.text(`${allSucceeded ? (EMOJIS.circlecheck || '✅') : (EMOJIS.trianglealert || '⚠️')} Buff **${buff.name}** aplicado em **${onlinePlayer.player_name || target}**:`);
        for (const r of results) {
            builder.text(`${r.success ? (EMOJIS.circlecheck || '✅') : (EMOJIS.circlealert || '❌')} ${r.attribute}: \`${r.value}\`${r.success ? '' : ` — ${r.error}`}`);
        }
        builder.footer(interaction.guild.name);

        const payload = builder.build();
        await interaction.followUp({ ...payload, flags: payload.flags | 64 });
    },
};
