// Carregar variáveis de ambiente do arquivo .env
require('dotenv').config();

const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Configuração do client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

client.commands = new Collection();

// ==================== CARREGAR COMANDOS ====================
const commandsPath = path.join(__dirname, 'src', 'commands');
console.log(`📂 Carregando comandos de: ${commandsPath}`);

if (fs.existsSync(commandsPath)) {
    const commandFolders = fs.readdirSync(commandsPath);
    let loadedCommands = 0;

    for (const folder of commandFolders) {
        // Comandos de developer (reset-db, reset-reports, premium-admin,
        // combat-config) NÃO entram no bot principal — vivem numa Application
        // separada, privada, carregada por src/systems/core/devBot.js. Isso é
        // o que garante que staff de servidor de cliente nunca VEJA esses
        // comandos na lista do Discord, não só recebam "acesso negado" depois
        // de clicar (ver conversa com o dono sobre separar visibilidade).
        if (folder === 'developer') continue;

        const folderPath = path.join(commandsPath, folder);
        if (!fs.statSync(folderPath).isDirectory()) continue;

        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
        
        for (const file of commandFiles) {
            try {
                const command = require(path.join(folderPath, file));
                if ('data' in command && 'execute' in command) {
                    command.category = folder;
                    client.commands.set(command.data.name, command);
                    loadedCommands++;
                }
            } catch (error) {
                console.error(`❌ Erro ao carregar comando ${folder}/${file}:`, error.message);
            }
        }
    }
    console.log(`📋 ${loadedCommands} comandos carregados`);
} else {
    console.error(`❌ Diretório de comandos não encontrado: ${commandsPath}`);
}

// ==================== CARREGAR EVENTOS ====================
const eventsPath = path.join(__dirname, 'src', 'events');
console.log(`📂 Carregando eventos de: ${eventsPath}`);

if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    let loadedEvents = 0;

    for (const file of eventFiles) {
        try {
            const event = require(path.join(eventsPath, file));
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
            loadedEvents++;
        } catch (error) {
            console.error(`❌ Erro ao carregar evento ${file}:`, error.message);
        }
    }
    console.log(`🎧 ${loadedEvents} eventos carregados`);
} else {
    console.error(`❌ Diretório de eventos não encontrado: ${eventsPath}`);
}

// ==================== TRATAMENTO DE ERROS GLOBAIS ====================
process.on('unhandledRejection', (error) => {
    console.error('❌ Promise rejeitada não tratada:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exceção não capturada:', error);
});

// ==================== DESLIGAMENTO GRACIOSO ====================
// Faltava completamente antes — sem handler nenhum de SIGTERM/SIGINT, todo
// restart do processo (deploy, `pm2 restart`, crash) matava o bot na hora,
// e o Gateway do PoT nunca tinha chance de despachar combates ainda
// acumulando (dentro da janela de inatividade antes do relatório fechar
// sozinho) — CONFIRMADO ser a causa real de "quase não chegam relatórios
// de combate" (ver gatewayServer.js.stop). Timeout de segurança abaixo do
// kill_timeout padrão do pm2 (1.6s) pra garantir que o processo sempre
// saia sozinho a tempo, em vez de levar um SIGKILL no meio do flush —
// se o dono quiser dar mais tempo pro flush completar (vários encontros
// pendentes de uma vez), vale aumentar o kill_timeout do pm2 pra esse app.
async function gracefulShutdown(signal) {
    console.log(`\n🛑 Recebido ${signal}, desligando graciosamente...`);
    try {
        const { getInstance } = require('./src/integrations/pathoftitans');
        const potIntegration = getInstance(); // sem client: só pega a instância já existente, não reinicializa
        if (potIntegration?.gateway) {
            await Promise.race([
                potIntegration.gateway.stop(),
                new Promise((resolve) => setTimeout(resolve, 1200)),
            ]);
        }
    } catch (error) {
        console.error('❌ Erro ao desligar o Gateway do PoT:', error.message);
    }
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ==================== LOGIN DO BOT ====================
// Pega o token do .env
const TOKEN = process.env.TOKEN;

if (!TOKEN) {
    console.error('❌ TOKEN não encontrado no arquivo .env!');
    console.error('   Verifique se o arquivo .env existe e contém: TOKEN=seu_token_aqui');
    process.exit(1);
}

console.log('🔑 Token encontrado, iniciando login...');

client.login(TOKEN).catch(error => {
    console.error('❌ Erro ao fazer login:', error);
    process.exit(1);
});

// ==================== PATH OF TITANS INTEGRATION ====================
// Inicialização silenciosa - não quebra o bot se falhar
try {
    const { getInstance } = require('./src/integrations/pathoftitans');
    const potIntegration = getInstance(client);
    
    // Tentar carregar configurações salvas para cada guild
    if (potIntegration) {
        console.log('🎮 [PoT] Sistema de integeração carregado (modo standby)');
        // As integrações serão ativadas quando configuradas via comando
    }
} catch (error) {
    // Falha silenciosa - o bot continua funcionando
    console.log('ℹ️ [PoT] Integração não disponível (servidor offline ou não configurado)');
}

module.exports = client;