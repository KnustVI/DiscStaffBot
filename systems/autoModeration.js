const cron = require('node-cron')
const db = require('../database/database')

module.exports = (client) => {

cron.schedule('0 3 * * *', async () => {

console.log("🛡 Automod: verificação diária iniciada")

const now = Date.now()

const ONE_DAY = 1000 * 60 * 60 * 24
const THIRTY_DAYS = ONE_DAY * 30
const FIFTEEN_DAYS = ONE_DAY * 15

const users = db.prepare(`SELECT * FROM users`).all()

for (const user of users) {

const guild = client.guilds.cache.get(user.guild_id)
if (!guild) continue

const member = await guild.members.fetch(user.user_id).catch(() => null)
if (!member) continue

const lastPenalty = user.last_penalty || now
const timeWithoutPenalty = now - lastPenalty

/* ---------------------------
REPUTAÇÃO PASSIVA (RECUPERAÇÃO)
--------------------------- */

const days = Math.floor(timeWithoutPenalty / ONE_DAY)

if (days > 0) {

db.prepare(`
UPDATE users
SET reputation = MIN(reputation + ?, 100)
WHERE user_id = ?
`).run(days, user.user_id)

console.log(`⭐ ${member.user.tag} recuperou ${days} reputação`)

}

/* ---------------------------
JOGADOR EXEMPLAR
--------------------------- */

if (timeWithoutPenalty >= THIRTY_DAYS) {

const settings = db.prepare(`
SELECT key, value FROM settings
WHERE guild_id = ?
`).all(guild.id)

const config = Object.fromEntries(settings.map(s => [s.key, s.value]))

if (config.exemplar_role) {

if (!member.roles.cache.has(config.exemplar_role)) {

await member.roles.add(config.exemplar_role).catch(() => null)

console.log(`🏅 ${member.user.tag} recebeu cargo exemplar`)

}

}

}

/* ---------------------------
USUÁRIO PROBLEMÁTICO
--------------------------- */

const penalties = db.prepare(`
SELECT COUNT(*) as total
FROM penalties
WHERE user_id = ?
AND date > ?
`).get(user.user_id, now - FIFTEEN_DAYS)

if (penalties.total >= 5) {

const settings = db.prepare(`
SELECT key, value FROM settings
WHERE guild_id = ?
`).all(guild.id)

const config = Object.fromEntries(settings.map(s => [s.key, s.value]))

if (config.problem_role) {

if (!member.roles.cache.has(config.problem_role)) {

await member.roles.add(config.problem_role).catch(() => null)

console.log(`⚠ ${member.user.tag} recebeu cargo problemático`)

}

}

}

}

console.log("✅ Automod: verificação concluída")

})

}
