const database = firebase.database()
const firestore = firebase.firestore()

/** @type { (text: string) => string } */
const sha1 = KJUR.crypto.Util.sha1
const stunServer = 'stun:stun.l.google.com:19302'

$(document).ready(() => {
  $('#loader').hide()
})

function randomString(size) {
  let str = ''
  for (let i=0; i<size; i++) {
    str += Math.floor(Math.random() * 0xFFFFFF).toString(35)
  }
  return str
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