const database = firebase.database()
const firestore = firebase.firestore()

/** @type { (text: string) => string } */
const sha1 = KJUR.crypto.Util.sha1
AudioContext = window.AudioContext || window.webkitAudioContext

function randomString(size) {
  let str = ''
  for (let i=0; i<size; i++) {
    str += Math.floor(Math.random() * 0xFFFFFF).toString(35)
  }
  return str
}

function titleCase(text) {
  const words = text.split(' ')
  const capitalized = words.map(word => {
    if (word.length === 0) return ''
    return word[0].toUpperCase() + word.slice(1)
  })
  return capitalized.join(' ')
}

function encodeForId(text) {
  return btoa(encodeURIComponent(text)).split('=', 2)[0]
}

/** @param { RTCPeerConnection } connection */
function getAllIceCandidates(connection) {
  return new Promise(resolve => {
    let candidates = []
    function callback(e) {
      if (e.candidate === null) {
        connection.removeEventListener('icecandidate', callback)
        resolve(candidates)
      } else { candidates.push(e.candidate) }
    }
    connection.addEventListener('icecandidate', callback)
  })
}