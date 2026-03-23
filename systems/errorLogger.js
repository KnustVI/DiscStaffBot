const fs = require('fs');
const path = require('path');

const ErrorLogger = {
    /**
     * Registra um erro em um arquivo local e no console
     * @param {string} context - Onde o erro ocorreu (ex: 'PunishSystem', 'ConfigHandler')
     * @param {Error} error - O objeto de erro capturado
     */
    log(context, error) {
        const timestamp = new Date().toLocaleString('pt-BR');
        const logMessage = `[${timestamp}] [CONTEXT: ${context}] [ERROR: ${error.message}]\nSTACK: ${error.stack}\n${'-'.repeat(50)}\n`;

        // Caminho do arquivo de log (na raiz do projeto)
        const logPath = path.join(__dirname, '../logs_erro_system.log');

        // Escreve no arquivo (acrescenta ao final)
        fs.appendFile(logPath, logMessage, (err) => {
            if (err) console.error('❌ Falha crítica ao salvar arquivo de log:', err);
        });

        // Exibe no console da Oracle Cloud com destaque
        console.error(`\x1b[31m[SYSTEM ERROR]\x1b[0m Ocorreu um erro em ${context}. Verifique o arquivo de logs.`);
    }
};

module.exports = ErrorLogger;