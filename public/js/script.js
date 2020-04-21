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
    safeId: safeId,
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

  let displayMessageTimeout
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
      const commit = scrollMessages()

      const messageData = {
        from: data.from,
        to: data.to,
        text: data.text
      }

      messages.push(messageData)
      commit()

      if (!app.showChat) {
        app.newMessage = messageData
        $('.notification-container').fadeIn()
        if (displayMessageTimeout) clearTimeout(displayMessageTimeout)
        
        displayMessageTimeout = setTimeout(() => {
          $('.notification-container').fadeOut()
        }, 5000)
      }
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

    modal: {
      title: '',
      body: '',
      buttons: [],

      join: false,
      peers: []
    },

    newMessage: {
      from: '',
      to: '',
      text: ''
    },

    speakerFullScreen: false,
    fullScreenPeerIndex: 0,

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
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: true, 
          audio: { echoCancellation: true }
        })
        outgoingTracks.video = cameraStream.getVideoTracks()[0]
        outgoingTracks.audio = cameraStream.getAudioTracks()[0]
      } catch (error) {
        console.error(error)
        this.connecting = false
        return
      }
      
      signaling = new FirebaseSignaling(this.userId, this.roomId.toLowerCase())

      signaling.onroomcreate = () => {
        return new Promise(resolve => {
          const modalEl = $('#modal')

          this.modal.title = 'Create Room'
          this.modal.body = 'The room "' + roomId + '" doesn\'t exist. Would you like to create it?'
          this.modal.buttons = [
            {
              text: 'Cancel',
              type: 'danger',
              onclick: function() {
                app.disconnect()

                modalEl.modal('hide')
                resolve(false)
              }
            },
            {
              text: 'Create',
              type: 'primary',
              onclick: function() {
                modalEl.modal('hide')
                resolve(true)
              }
            }
          ]
          this.modal.join = false

          modalEl.modal('show')
        })
      }

      signaling.onroomjoin = (peers) => {
        return new Promise(resolve => {
          const modalEl = $('#modal')

          this.modal.title = 'Join Room'

          this.modal.body = ''
          this.modal.buttons = [
            {
              text: 'Cancel',
              type: 'danger',
              onclick: function() {
                app.disconnect()

                modalEl.modal('hide')
                resolve(false)
              }
            },
            {
              text: 'Continue',
              type: 'primary',
              onclick: function() {
                const audioCheck = $('#join-with-audio')[0]
                const videoCheck = $('#join-with-video')[0]
                
                if (!audioCheck.checked) {
                  app.muted = true
                  outgoingTracks.audio.enabled = false
                }
                if (!videoCheck.checked) {
                  app.hidden = true
                  outgoingTracks.video.enabled = false
                }

                modalEl.one('hidden.bs.modal', () => {
                  audioCheck.checked = true
                  videoCheck.checked = true
                })

                modalEl.modal('hide')
                resolve(true)
              }
            }
          ]
          this.modal.join = true
          this.modal.peers = peers

          modalEl.modal('show')
        })
      }

      signaling.onready = () => {
        this.ready = true
        this.$nextTick(this.setVideoSources)

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

      signaling.buildpeer = createPeer

      signaling.onerror = error => {
        if (error === 'nametaken') {
          const modalEl = $('#modal')

          this.modal.title = 'Name Taken'
          this.modal.body = 'The name "' + userId + '" has already been taken'
          this.modal.buttons = [
            {
              text: 'Okay',
              type: 'primary',
              onclick: function() { modalEl.modal('hide') }
            }
          ]
          this.modal.join = false

          modalEl.modal('show')
        }
        this.disconnect()
        this.roomId = roomId
      }

      await signaling.start()

      this.connecting = false
    },
    randomRoomId: function() {
      this.roomId = randomString(2)
    },
    setVideoSources: function() {
      const videoEl = $('#video-' + encodeForId(this.userId))[0]
      if (videoEl) {
        let stream = new MediaStream()
        stream.addTrack(outgoingTracks.video)
        videoEl.srcObject = stream
      }

      this.peers.forEach(peer => {
        var peerConnection = peerConnections[peer.name]
        if (peerConnection.stream) {
          const videoEl = $('#video-' + peer.safeId)[0]
          if (videoEl) videoEl.srcObject = peerConnection.stream
        }
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
      copy.blur()
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
        displayTrack.onended = () => {
          if (this.sharingScreen) this.toggleScreenShare()
        }

        outgoingTracks.video.stop()
        outgoingTracks.video = displayTrack
        this.refreshOutgoingVideo()
      } else {
        const newCameraStream = await navigator.mediaDevices.getUserMedia({ video: true })
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
    toggleFullScreen: function() {
      this.speakerFullScreen = !this.speakerFullScreen
      this.$nextTick(this.setVideoSources)
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
    notificationClicked: function() {
      this.showChat = true
      $('.notification-container').fadeOut()
      this.$nextTick(() => {
        const messages = $('#messages')
        const scrollHeight = messages.prop('scrollHeight')
        messages.scrollTop(scrollHeight)
      })
    },
    hideNotification: function() {
      $('.notification-container').fadeOut()
    },
    disconnect: function() {
      this.ready = false
      this.connecting = false
      this.muted = false
      this.hidden = false
      this.sharingScreen = false
      this.speakerFullScreen = false
      
      this.roomId = ''
      history.replaceState(null, null, '/')
      document.title = 'Social Distance Room'

      while (messages.length > 0) messages.pop()
      
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
    },
    me: function() {
      return {
        name: this.userId,
        muted: this.muted,
        hidden: this.hidden,
        sharingScreen: this.sharingScreen
      }
    }
  }
})

setInterval(function() {
  let lastIndex = -1

  let loudestIndex = -1
  let loudestVolume = 300
  app.peers.forEach((peer, index) => {
    if (app.peers[index].speaking) lastIndex = index
    app.peers[index].speaking = false
    if (peer.muted || !peerConnections[peer.name].volume) return
    const volume = peerConnections[peer.name].volume.getVolume()
    if (volume > loudestVolume) {
      loudestIndex = index
      loudestVolume = volume
    }
  })

  if (loudestIndex > -1) {
    app.peers[loudestIndex].speaking = true
    if (app.speakerFullScreen && app.fullScreenPeerIndex !== loudestIndex) {
      app.fullScreenPeerIndex = loudestIndex
      app.$nextTick(app.setVideoSources)
    }
  } else if (lastIndex > -1) {
    app.peers[lastIndex].speaking = true
  }
}, 100)

$('#loader').hide()