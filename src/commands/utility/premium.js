// src/commands/utility/premium.js
/**
 * Vitrine pública do Premium — painel com 3 containers navegáveis por botão
 * (visão geral, Server Premium, Player Premium). Construção real fica em
 * src/systems/premium/premiumPanel.js (reaproveitado pelos botões de
 * navegação, roteados via InteractionHandler — prefixo `premium:`).
 */
const { SlashCommandBuilder } = require('discord.js');
const PremiumPanel = require('../../systems/premium/premiumPanel');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('🏅 Conheça os planos Premium (jogador e servidor) e veja seu status atual.'),

    async execute(interaction, client) {
        await PremiumPanel.sendPanel(interaction, 'main');
    },
};
