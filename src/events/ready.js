const InteractionHandler = require('../systems/handlers');
const { ActivityType } = require('discord.js');

let handler = null;
let isReady = false;

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        // Evitar execução duplicada
        if (isReady) return;
        isReady = true;
        
        const startTime = Date.now();
        
        console.log('\n========================================');
        console.log(`✅ Bot iniciado como ${client.user.tag}`);
        console.log(`🆔 ID: ${client.user.id}`);
        console.log(`📡 Conectado em ${client.guilds.cache.size} servidores`);
        console.log(`👥 Total de usuários: ${client.users.cache.size}`);
        console.log(`💾 Memória: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log('========================================\n');
        
        // 1. Inicializar handler central (cache)
        try {
            if (!handler) {
                handler = new InteractionHandler(client);
            }
            console.log('📦 Handler central inicializado');
        } catch (error) {
            console.error('❌ Erro ao inicializar handler:', error);
        }
        
        // 2. Carregar todos os caches dos sistemas
        console.log('\n🔄 Carregando caches dos sistemas...');
        try {
            const cacheResults = await handler.loadAllCaches();
            
            for (const [system, status] of Object.entries(cacheResults)) {
                if (status) {
                    console.log(`   ✅ Cache de ${system} carregado com sucesso`);
                } else if (status === false) {
                    console.log(`   ⚠️ Cache de ${system} falhou ou está vazio`);
                }
            }
        } catch (error) {
            console.error('❌ Erro ao carregar caches:', error);
        }
        
        // 3. Iniciar dashboard web (se existir)
        try {
            const dashboard = require('../../dashboard');
            if (dashboard && typeof dashboard.start === 'function') {
                await dashboard.start();
                console.log('🌐 Dashboard web iniciado');
            } else if (dashboard && typeof dashboard === 'function') {
                await dashboard();
                console.log('🌐 Dashboard web iniciado');
            } else if (dashboard) {
                console.log('🌐 Dashboard web carregado');
            }
        } catch (error) {
            if (error.code === 'MODULE_NOT_FOUND') {
                console.log('ℹ️ Dashboard web não configurado');
            } else {
                console.error('⚠️ Erro ao iniciar dashboard:', error.message);
            }
        }
        
        // 4. Registrar comandos slash globalmente (se necessário)
        if (process.env.DEPLOY_COMMANDS === 'true') {
            try {
                const commands = [];
                client.commands.forEach(cmd => {
                    commands.push(cmd.data.toJSON());
                });
                
                await client.application.commands.set(commands);
                console.log(`📝 ${commands.length} comandos slash registrados globalmente`);
            } catch (error) {
                console.error('❌ Erro ao registrar comandos:', error);
            }
        }
        
        // 5. Configurar presença do bot
        const updatePresence = () => {
            const statuses = [
                { name: `${client.guilds.cache.size} servidores`, type: ActivityType.Watching },
                { name: `/${client.commands.first()?.data.name || 'help'}`, type: ActivityType.Listening },
                { name: `Staff Administration`, type: ActivityType.Playing }
            ];
            
            let index = 0;
            setInterval(() => {
                const status = statuses[index % statuses.length];
                client.user.setPresence({
                    activities: [status],
                    status: 'online'
                });
                index++;
            }, 60000);
        };
        
        updatePresence();
        console.log('🎮 Presença do bot configurada');
        
        // 6. Verificações de integridade
        console.log('\n🔍 Verificações de integridade:');
        
        const commandCount = client.commands.size;
        console.log(`   📋 ${commandCount} comandos carregados`);
        
        if (commandCount === 0) {
            console.warn('   ⚠️ Nenhum comando encontrado! Verifique o diretório de comandos.');
        }
        
        const eventCount = Object.keys(client._events || {}).length;
        console.log(`   🎧 ${eventCount} eventos registrados`);
        
        // Verificar conexão com banco de dados
        try {
            const db = require('better-sqlite3');
            const database = new db('./database.sqlite');
            const test = database.prepare('SELECT 1').get();
            if (test) {
                console.log('   🗄️ Banco de dados SQLite conectado');
            }
            database.close();
        } catch (error) {
            console.warn('   ⚠️ Banco de dados SQLite não disponível:', error.message);
        }
        
        // 7. Logs de inicialização completos
        const elapsedTime = Date.now() - startTime;
        console.log('\n========================================');
        console.log(`✨ Bot pronto em ${elapsedTime}ms`);
        console.log('========================================\n');
        
        // 8. Evento opcional
        client.emit('botReady', {
            uptime: client.uptime,
            guilds: client.guilds.cache.size,
            users: client.users.cache.size,
            commands: commandCount
        });
        
        // 10. Limpar cache de configuração
        try {
            const ConfigSystem = require('../systems/configSystem');
            if (ConfigSystem.clearAllCache) {
                ConfigSystem.clearAllCache();
                console.log('🗑️ Cache de configurações reiniciado');
            } else {
                console.log('ℹ️ Método clearAllCache não disponível');
            }
        } catch (err) {
            console.error('❌ Erro ao limpar cache:', err);
        }
    }
};