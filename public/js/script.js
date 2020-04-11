/**
 * @typedef PeerConnection
 * @property { RTCPeerConnection } connection
 * @property { RTCDataChannel } channel
 * @property { MediaStream } stream
 */
/** @type { Object<string, PeerConnection> } */
var peerConnections = { }

function createPeer(peerName, incoming) {
  const peer = new RTCPeerConnection({
    iceServers: [{ 'urls': ['stun:stun.l.google.com:19302'] }],
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  })

  let channel = null
  if (incoming) {
    peer.ondatachannel = e => {
      peerConnections[peerName].channel = e.channel
      setUpChannel(e.channel, peerName)
    }
  } else {
    channel = peer.createDataChannel('messages')
    setUpChannel(channel, peerName)
  }

  peerConnections[peerName] = {
    connection: peer,
    channel: channel,
    stream: null
  }

  peer.onconnectionstatechange = e => {
    console.log(peerName, peer.connectionState)
    if (peer.connectionState === 'failed') {
      delete peerConnections[peerName]
      app.peers.some((peer, index) => {
        if (peer.name === peerName) {
          app.peers.splice(index, 1)
          return true
        }
      })
      app.setVideoSources()
    }
  }

  const stream = videoStream //videoStream.clone()
  stream.getAudioTracks().forEach(track => {
    peer.addTrack(track, stream)
  })
  stream.getVideoTracks().forEach(track => {
    peer.addTrack(track, stream)
  })

  peer.ontrack = e => {
    const stream = e.streams[0]
    const videoEl = $('#video-' + peerName)[0]
    console.log(videoEl, peerName)
    if (stream && videoEl.srcObject !== stream) {
      peerConnections[peerName].stream = stream
      videoEl.srcObject = stream
    }
  }

  app.peers.push({
    name: peerName,
    muted: false,
    hidden: false
  })
  
  return peer
}

/**
 * @param { RTCDataChannel } channel 
 */
function setUpChannel(channel, peerName) {
  channel.onmessage = e => {
    let data = e.data
    try { data = JSON.parse(data) }
    catch {
      console.error('unable to parse incoming message', peerName, channel)
      return
    }

    if (data.hasOwnProperty('muted')) {
      app.updatePeer(peerName, 'muted', data.muted)
    } else if (data.hasOwnProperty('hidden')) {
      app.updatePeer(peerName, 'hidden', data.hidden)
    }
  }
}

/** @type { FirestoreSignaling } */
var signaling
/** @type { MediaStream } */
var videoStream

var app = new Vue({
  el: '#app',
  data: {
    roomId: localStorage.getItem('room_id') || '',
    userId: localStorage.getItem('user_id') || '',
    connecting: false,
    ready: false,
    peers: [],
    host: false,
    muted: false,
    hidden: false,

    connections: [],
    documentId: null,
    connectTo: '',
    state: 0,
    states: {
      waiting: 0,
      checkingId: 1,
      checkingPeer: 2,
      ready: 3
    }
  },
  methods: {
    connect: async function () {
      this.connecting = true

      const userId = this.userId.trim()//.toLowerCase()
      this.userId = userId
      localStorage.setItem('user_id', userId)

      const roomId = this.roomId.trim()//.toLowerCase()
      this.roomId = roomId
      localStorage.setItem('room_id', roomId)
      
      signaling = new FirestoreSignaling(this.userId, this.roomId)

      signaling.onroomcreate = () => {
        if (confirm('The room "' + roomId + '" doesn\'t exist. Would you like to create it?')) {
          return true
        }
        this.ready = false
        return false
      }

      videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      signaling.onready = () => {
        this.ready = true
        this.$nextTick(() => { $('#output-video-preview')[0].srcObject = videoStream })
      }

      signaling.ondisconnect = () => {
        alert('You have been disconnected from the host.')
        this.leave()
      }

      signaling.onpeercreate = createPeer

      signaling.onerror = error => {
        if (error === 'nametaken') {
          alert('The name "' + this.userId + '" has already been taken')
          this.ready = false
        }
      }

      await signaling.start()
      this.host = signaling.owner

      this.connecting = false
    },
    setVideoSources() {
      this.peers.forEach(peer => {
        var peerConnection = peerConnections[peer.name]
        if (peerConnection.stream) $('#video-' + peer.name)[0].srcObject = peerConnection.stream
      })
    },
    updatePeer(name, key, value) {
      this.peers.some((peer, index) => {
        if (peer.name === name) {
          this.peers[index][key] = value
          return true
        }
      })
    },
    toggleHide: function() {
      const hidden = !this.hidden
      videoStream.getVideoTracks().forEach(track => {
        track.enabled = !hidden
      })
      this.hidden = hidden
      
      for (name in peerConnections) {
        peerConnections[name].channel.send(JSON.stringify({
          hidden: hidden
        }))
      }
    },
    toggleMute: function() {
      const muted = !this.muted
      videoStream.getAudioTracks().forEach(track => {
        track.enabled = !muted
      })
      this.muted = muted

      for (name in peerConnections) {
        peerConnections[name].channel.send(JSON.stringify({
          muted: muted
        }))
      }
    },
    disconnect: function() {
      this.muted = false
      this.hidden = false
      this.host = false
      this.ready = false

      videoStream.getTracks().forEach(track => track.stop())
      videoStream = null

      this.peers.forEach(peer => {
        peerConnections[peer.name].connection.close()
        delete peerConnections[peer.name]

        this.peers.shift()
      })
      signaling.end()
    }
  },
  computed: {
    validUserId: function () {
      const userId = this.userId.trim().toLowerCase()
      return userId.length > 0 && userId.length < 20
    },
    widthClasses: function() {
      const connected = this.peers.length
      return {
        "col-md-6": connected > 0,
        "col-lg-4": connected > 1,
        "col-xl-3": connected > 2
      }
    }
  }
})
