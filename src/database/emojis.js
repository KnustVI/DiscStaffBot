/**
 * Arquivo de emojis personalizados do bot
 * Todos os emojis são do servidor de suporte
 */

// Função para formatar emoji com ID
const formatEmoji = (id, name) => {
    if (!id) return `:${name}:`;
    return `<:${name}:${id}>`;
};

// Objeto com todos os emojis
const EMOJIS = {
    Warning: formatEmoji('1488572178084659324', 'Warning'),
    user: formatEmoji('1488572168332640338', 'user'),
    Ticket: formatEmoji('1488572166608916575', 'Ticket'),
    thumbsUP: formatEmoji('1488572163916038295', 'thumbsUP'),
    thumbsDOWN: formatEmoji('1488572162825781479', 'thumbsDOWN'),
    strike: formatEmoji('1488572161256849489', 'strike'),
    Status: formatEmoji('1488572159814271067', 'Status'),
    star: formatEmoji('1488572158819958875', 'star'),
    star2: formatEmoji('1488572157448425694', 'star2'),
    staff: formatEmoji('1488572156114636970', 'staff'),
    stack: formatEmoji('1488572154424463361', 'stack'),
    shinystar: formatEmoji('1488572153577341089', 'shinystar'),
    serverguild: formatEmoji('1488572152289562775', 'serverguild'),
    Rigth: formatEmoji('1488572150859169882', 'Rigth'),
    Reset: formatEmoji('1488572149709934662', 'Reset'),
    Rank: formatEmoji('1488572146711265300', 'Rank'),
    plusone: formatEmoji('1488572145402646581', 'plusone'),
    play: formatEmoji('1488572144337027226', 'play'),
    Pause: formatEmoji('1488572143217279216', 'Pause'),
    panel: formatEmoji('1488572141640356061', 'panel'),
    notregistred: formatEmoji('1488572140218486825', 'notregistred'),
    Note: formatEmoji('1488572138871848960', 'Note'),
    mute: formatEmoji('1488572137785786519', 'mute'),
    loose: formatEmoji('1488572136472707203', 'loose'),
    Left: formatEmoji('1488572135361351760', 'Left'),
    Leadboard: formatEmoji('1488572134057054230', 'Leadboard'),
    Identification: formatEmoji('1488572132962341015', 'Identification'),
    How: formatEmoji('1488572131846656150', 'How'),
    History: formatEmoji('1488572130277720084', 'History'),
    heart: formatEmoji('1488572128109264998', 'heart'),
    global: formatEmoji('1488572126666428498', 'global'),
    gain: formatEmoji('1488572125643145256', 'gain'),
    fixed: formatEmoji('1488572124376338442', 'fixed'),
    Error: formatEmoji('1488572123306922144', 'Error'),
    eraser: formatEmoji('1488572121167958136', 'eraser'),
    edit: formatEmoji('1488572117334364170', 'edit'),
    DM: formatEmoji('1488572115895451840', 'DM'),
    diamond: formatEmoji('1488572114679365826', 'diamond'),
    Daysclean: formatEmoji('1488572113626337423', 'Daysclean'),
    Date: formatEmoji('1488572112464511016', 'Date'),
    dashboard: formatEmoji('1488572111437168670', 'dashboard'),
    crown: formatEmoji('1488572108534583406', 'crown'),
    Consult: formatEmoji('1488572107393863800', 'Consult'),
    Config: formatEmoji('1488572106261139616', 'Config'),
    Check: formatEmoji('1488572104826818812', 'Check'),
    Book: formatEmoji('1488572103279120454', 'Book'),
    ban: formatEmoji('1488572101496410243', 'ban')
};

// Exportar também a função utilitária
const getEmoji = (name) => {
    return EMOJIS[name] || `:${name}:`;
};

module.exports = {
    EMOJIS,
    getEmoji,
    formatEmoji
};