/**
 * @typedef PeerConnection
 * @property { RTCPeerConnection } connection
 * @property { RTCDataChannel } channel
 * @property { MediaStream } stream
 * @property { StreamVolume } volume
 */
/** @type { Object<string, PeerConnection> } */
var peerConnections = { }

function createPeer(peerName, incoming) {
  const safeId = btoa(encodeURIComponent(peerName)).split('=', 2)[0]

  const peer = new RTCPeerConnection({
    iceServers: [{ 'urls': ['stun:stun.l.google.com:19302'] }],
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  })
  peer.onnegotiationneeded = true

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
    const videoEl = $('#video-' + safeId)[0]
    if (stream && videoEl.srcObject !== stream) {
      videoEl.srcObject = stream
    }

    if (!peerConnections[peerName].stream) {
      peerConnections[peerName].stream = stream
      peerConnections[peerName].volume = new StreamVolume(stream)
    }
  }

  app.peers.push({
    name: peerName,
    safeId: safeId,
    muted: false,
    hidden: false,
    speaking: false
  })
  
  return peer
}

/**
 * @param { RTCDataChannel } channel 
 */
function setUpChannel(channel, peerName) {
  channel.onopen = () => {
    channel.send(JSON.stringify({
      muted: app.muted
    }))
    channel.send(JSON.stringify({
      hidden: app.hidden
    }))
  }

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

/** @type { FirebaseSignaling } */
var signaling
/** @type { MediaStream } */
var videoStream

var app = new Vue({
  el: '#app',
  data: {
    roomId: decodeURIComponent(location.pathname.slice(1)) || '',
    userId: localStorage.getItem('user_id') || '',
    connecting: false,
    ready: false,
    peers: [],
    host: false,
    muted: false,
    hidden: false,
  },
  methods: {
    connect: async function () {
      this.connecting = true

      const userId = this.userId.trim()
      this.userId = userId
      localStorage.setItem('user_id', userId)

      const roomId = this.roomId.trim()
      this.roomId = roomId
      localStorage.setItem('room_id', roomId)

      try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      } catch {
        this.connecting = false
        return
      }
      
      signaling = new FirebaseSignaling(this.userId, this.roomId)

      signaling.onroomcreate = () => {
        if (confirm('The room "' + roomId + '" doesn\'t exist. Would you like to create it?')) {
          return true
        }
        this.disconnect()
        return false
      }

      signaling.onready = () => {
        this.ready = true
        this.roomId = 'room' //signaling.roomData.name
        this.$nextTick(() => { $('#output-video-preview')[0].srcObject = videoStream })

        history.replaceState(null, null, '/' + encodeURIComponent(this.roomId))
      }

      signaling.onpeerdisconnnect = peerName => {
        delete peerConnections[peerName]

        let peerIndex = -1
        this.peers.some((peer, index) => {
          if (peer.name === peerName) {
            peerIndex = index
            return true
          } 
        })
        if (peerIndex >= 0) this.peers.splice(peerIndex, 1)

        this.setVideoSources()
      }

      signaling.ondisconnect = () => {
        alert('You have been disconnected from the host.')
        this.disconnect()
      }

      signaling.buildpeer = createPeer

      signaling.onerror = error => {
        if (error === 'nametaken') {
          alert('The name "' + this.userId + '" has already been taken')
          this.disconnect()
        }
      }

      await signaling.start()
      this.host = signaling.owner

      this.connecting = false
    },
    randomRoomId: function() {
      this.roomId = randomString(2)
      history.replaceState(null, null, '/' + this.roomId)
    },
    setVideoSources: function() {
      this.peers.forEach(peer => {
        var peerConnection = peerConnections[peer.name]
        if (peerConnection.stream) $('#video-' + peer.safeId)[0].srcObject = peerConnection.stream
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
      this.ready = false
      this.connecting = false
      this.muted = false
      this.hidden = false
      this.host = false
      
      this.roomId = ''
      history.replaceState(null, null, '/')

      videoStream.getTracks().forEach(track => track.stop())
      videoStream = null

      this.peers.forEach(peer => {
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

setInterval(function() {
  let loudestIndex = -1
  let loudestVolume = -1
  app.peers.forEach((peer, index) => {
    app.peers[index].speaking = false
    if (peer.muted || !peerConnections[peer.name].volume) return
    const volume = peerConnections[peer.name].volume.getVolume()
    if (volume > loudestVolume) {
      loudestVolume = volume
      loudestIndex = index
    }
  })

  if (loudestIndex > -1) app.peers[loudestIndex].speaking = true
}, 100)