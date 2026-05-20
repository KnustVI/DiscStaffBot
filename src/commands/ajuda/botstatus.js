// src/commands/utility/botstatus.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ContainerFormatter = require('../../utils/ContainerFormatter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Verifica o estado de saúde do bot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const builder = ContainerFormatter.createBuilder(interaction.guild.name, 0x00AAFF);
        builder.addTitle('📊 Status do Sistema', 1);
        builder.addSeparator();
        builder.addText(`✅ Bot online`);
        builder.addText(`📡 Ping: ${client.ws.ping}ms`);
        builder.addText(`📚 Comandos: ${client.commands.size}`);
        builder.addText(`🌐 Servidores: ${client.guilds.cache.size}`);
        builder.addFooter();
        
        // Passa o builder diretamente para o ResponseManager
        await interaction.editReply({ flags: ['IsComponentsV2'], components: [builder.build()] });
    }
};