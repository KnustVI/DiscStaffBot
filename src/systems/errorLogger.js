const fs = require('fs').promises;
const path = require('path');

const ErrorLogger = {
    /**
     * Registra um erro de forma persistente e visível no console.
     * @param {string} context - Onde o erro ocorreu (ex: 'Command_Strike')
     * @param {Error|string|object} error - O erro em si
     * @param {object} metadata - Opcional: Dados extras (user, guild, etc)
     */
    async log(context, error, metadata = null) {
        const timestamp = new Date().toLocaleString('pt-BR');
        const logDir = path.join(__dirname, '../../logs');
        const logPath = path.join(logDir, 'system_errors.log');

        // 1. Normalização do Erro
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : 'Sem stack trace';
        const extra = metadata ? `\nMETADATA: ${JSON.stringify(metadata, null, 2)}` : '';

        const logEntry = [
            `╔═ [${timestamp}] ══════════════════════════════════════════════`,
            `║ CONTEXTO: ${context.toUpperCase()}`,
            `║ MENSAGEM: ${message}`,
            `║ STACK: ${stack}${extra}`,
            `╚═══════════════════════════════════════════════════════════════`,
            ''
        ].join('\n');

        try {
            // 2. Garante que a pasta de logs existe (Prevenção de erro I/O)
            await fs.mkdir(logDir, { recursive: true }).catch(() => null);

            // 3. Escrita Assíncrona (Append)
            await fs.appendFile(logPath, logEntry, 'utf8');
        } catch (err) {
            // Se falhar o disco, avisamos no console com destaque
            console.error('\x1b[41m\x1b[37m[CRITICAL]\x1b[0m Falha ao gravar log no disco:', err.message);
        }

        // 4. Output Visual no Terminal (Padrão Oracle Cloud / PM2)
        console.error(`\x1b[31m[SYSTEM ERROR]\x1b[0m Erro em \x1b[33m${context}\x1b[0m: ${message}`);
        if (metadata) console.dir(metadata, { depth: null, colors: true });
    }
};

module.exports = ErrorLogger;