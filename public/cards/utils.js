const forbiddenNames = ['me', 'you', 'everybody', 'all', 'from', 'to', 'onto', 'by']

Math.seededRandom = function(s) {
  var mask = 0xffffffff;
  var m_w  = (123456789 + s) & mask;
  var m_z  = (987654321 - s) & mask;

  return function() {
    m_z = (36969 * (m_z & 65535) + (m_z >>> 16)) & mask;
    m_w = (18000 * (m_w & 65535) + (m_w >>> 16)) & mask;

    var result = ((m_z << 16) + (m_w & 65535)) >>> 0;
    result /= 4294967296;
    return result;
  }
}
Array.range = function(lo, hi) {
  if (hi === undefined) {
    return new Array(lo + 1).fill().map((_,i) => i)
  } else {
    return new Array(hi - lo + 1).fill().map((_,i) => i + lo)
  }
}

function b64UrlEncode(name) {
  const uri = encodeURIComponent(name)
  return btoa(uri).split('+').join('-').split('/').join('_')
}

function capitalize(str) {
  return str[0].toUpperCase() + str.substr(1)
}
function formatName(name) {
  if (name.toLowerCase() === app.name.toLowerCase()) return 'You'
  const playerName = players.find(player => player.toLowerCase() === name.toLowerCase())
  if (playerName === undefined) return name
  else return playerName
}
function formatPile(pile, from) {
  if (pile.owner === 'shared') return 'the ' + pile.name + ' pile'
  else {
    const name = formatName(pile.owner)
    if (name === 'You') return 'your hand'
    else if (pile.owner === from) return 'their hand'
    else return name + '\'s hand'
  }
}
function formatPlayers(playerNames) {
  if (
    playerNames.length === players.length &&
    JSON.stringify(playerNames.sort()) === JSON.stringify(players.map(player => player.toLowerCase()).sort())
  ) return 'everyone'

  playerNames = playerNames.map(player => formatName(player))
  if (playerNames.length < 3) return playerNames.join(' and ')
  return playerNames.slice(0, playerNames.length - 1).join(', ') + ', and' + playerNames[playerNames.length - 1]
}