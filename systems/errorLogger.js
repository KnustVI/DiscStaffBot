const fs = require('fs').promises; // Usando a versão de promessas para não travar o bot
const path = require('path');

const ErrorLogger = {
    /**
     * Registra um erro em um arquivo local e no console
     * @param {string} context - Onde o erro ocorreu
     * @param {Error|string|any} error - O objeto de erro ou mensagem
     */
    async log(context, error) {
        const timestamp = new Date().toLocaleString('pt-BR');
        
        // Garante que temos uma mensagem e um stack, mesmo que o erro seja apenas uma string
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : 'Sem stack trace disponível';

        const logEntry = [
            `[${timestamp}]`,
            `[CONTEXTO: ${context.toUpperCase()}]`,
            `[MENSAGEM: ${errorMessage}]`,
            `STACK: ${errorStack}`,
            '-'.repeat(60),
            ''
        ].join('\n');

        // Caminho do arquivo (Garante que a pasta logs existe se você preferir, 
        // mas aqui mantive na raiz como o seu original)
        const logPath = path.join(__dirname, '../../logs_erro_system.log');

        try {
            // appendFile assíncrono evita "gargalos" no processamento do bot
            await fs.appendFile(logPath, logEntry, 'utf8');
        } catch (err) {
            console.error('\x1b[41m\x1b[37m[CRITICAL]\x1b[0m Falha ao gravar no arquivo de log:', err.message);
        }

        // Destaque visual no console da Oracle Cloud
        console.error(`\x1b[31m[SYSTEM ERROR]\x1b[0m Erro em \x1b[33m${context}\x1b[0m: ${errorMessage}`);
    }
};

module.exports = ErrorLogger;