/**
 * @typedef PeerConnection
 * @property { RTCPeerConnection } connection
 * @property { RTCDataChannel } channel
 * @property { MediaStream } stream
 * @property { StreamVolume } volume
 */
/** @type { Object<string, PeerConnection> } */
var peerConnections = { }

/**
 * @typedef OutgoingTracks
 * @property { MediaStreamTrack } video 
 * @property { MediaStreamTrack } audio 
 */
/** @type { OutgoingTracks } */
var outgoingTracks = { }

function createPeer(peerName, incoming) {
  const safeId = encodeForId(peerName)

  const peer = new RTCPeerConnection({
    iceServers: [{ 'urls': ['stun:stun.l.google.com:19302'] }],
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  })
  peer.onnegotiationneeded = console.log

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

  let stream = new MediaStream()
  peer.addTrack(outgoingTracks.video, stream)
  peer.addTrack(outgoingTracks.audio, stream)

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
    muted: true,
    hidden: true,
    speaking: false,
    sharingScreen: false
  })
  
  return peer
}

/**
 * @param { RTCDataChannel } channel 
 */
function setUpChannel(channel, peerName) {
  channel.onopen = () => {
    channel.send(JSON.stringify({
      muted: app.muted,
      hidden: app.hidden,
      sharingScreen: app.sharingScreen
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
    }
    if (data.hasOwnProperty('hidden')) {
      app.updatePeer(peerName, 'hidden', data.hidden)
    }
    if (data.hasOwnProperty('sharingScreen')) {
      app.updatePeer(peerName, 'sharingScreen', data.sharingScreen)
    }
    
    if (data.hasOwnProperty('from') && data.hasOwnProperty('to') && data.hasOwnProperty('text')) {
      if (data.to === app.userId) data.to = 'You'
      messages.push({
        from: data.from,
        to: data.to,
        text: data.text
      })
    }
  }
}

/** @type { FirebaseSignaling } */
var signaling

var app = new Vue({
  el: '#app',
  data: {
    roomId: decodeURIComponent(location.pathname.slice(1)) || '',
    userId: localStorage.getItem('user_id') || '',
    connecting: false,
    ready: false,
    showChat: false,
    peers: [],

    muted: false,
    hidden: false,
    sharingScreen: false,
    canShareScreen: !!navigator.mediaDevices.getDisplayMedia
  },
  methods: {
    connect: async function () {
      this.connecting = true

      const userId = this.userId.trim()
      this.userId = userId
      localStorage.setItem('user_id', userId)

      const roomId = titleCase(this.roomId.trim())
      this.roomId = roomId
      localStorage.setItem('room_id', roomId)

      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        outgoingTracks.video = cameraStream.getVideoTracks()[0]
        outgoingTracks.audio = cameraStream.getAudioTracks()[0]
      } catch {
        this.connecting = false
        return
      }
      
      signaling = new FirebaseSignaling(this.userId, this.roomId.toLowerCase())

      signaling.onroomcreate = () => {
        if (confirm('The room "' + roomId + '" doesn\'t exist. Would you like to create it?')) {
          return true
        }
        this.disconnect()
        return false
      }

      signaling.onready = () => {
        this.ready = true
        this.$nextTick(() => {
          let stream = new MediaStream()
          stream.addTrack(outgoingTracks.video)
          $('#video-' + encodeForId(this.userId))[0].srcObject = stream
        })

        history.replaceState(null, null, '/' + encodeURIComponent(this.roomId))
        let roomName = this.roomId
        document.title = roomName + ' - Social Distance Room'
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
        }
      }

      await signaling.start()

      this.connecting = false
    },
    randomRoomId: function() {
      this.roomId = randomString(2)
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
    copyLink: function() {
      const copy = $('.copy')
      copy.val(location.host + location.pathname)
      copy.focus()
      copy.select()

      document.execCommand('copy')
    },
    refreshOutgoingVideo: function() {
      let stream = new MediaStream()
      stream.addTrack(outgoingTracks.video)
      $('#video-' + encodeForId(this.userId))[0].srcObject = stream

      for (const peerName in peerConnections) {
        const peer = peerConnections[peerName]
        peer.connection.getSenders().forEach(sender => {
          if (sender.track.kind === 'video') {
            sender.replaceTrack(outgoingTracks.video)
          }
        })
      }
    },
    toggleScreenShare: async function() {
      const sharingScreen = !this.sharingScreen

      if (sharingScreen) {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        const displayTrack = displayStream.getVideoTracks()[0]

        outgoingTracks.video.stop()
        outgoingTracks.video = displayTrack
        this.refreshOutgoingVideo()
      } else {
        const newCameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        const videoTrack = newCameraStream.getVideoTracks()[0]

        outgoingTracks.video.stop()
        outgoingTracks.video = videoTrack
        this.refreshOutgoingVideo()
      }

      this.sharingScreen = sharingScreen
      for (name in peerConnections) {
        peerConnections[name].channel.send(JSON.stringify({
          sharingScreen: sharingScreen
        }))
      }
    },
    toggleHide: function() {
      const hidden = !this.hidden
      outgoingTracks.video.enabled = !hidden
      this.hidden = hidden
      
      for (name in peerConnections) {
        peerConnections[name].channel.send(JSON.stringify({
          hidden: hidden
        }))
      }
    },
    toggleMute: function() {
      const muted = !this.muted
      outgoingTracks.audio.enabled = !muted
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
      this.sharingScreen = false
      
      this.roomId = ''
      history.replaceState(null, null, '/')
      document.title = 'Social Distance Room'
      
      outgoingTracks.video.stop()
      outgoingTracks.audio.stop()
      
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
        "col-12": true,
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