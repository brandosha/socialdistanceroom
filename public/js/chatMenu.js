var messages = []
function scrollMessages() {
  const messages = $('#messages')
  const scrollPos = messages.outerHeight() + messages.scrollTop()
  const scrollHeight = messages.prop('scrollHeight')

  const atBottom = Math.round(scrollPos) === scrollHeight
  return function() {
    if (atBottom) {
      messages.animate({ scrollTop: scrollHeight }, 500)
    }
  }
}

Vue.component('chat-menu', {
  props: ['peers', 'myName'],
  data: function() {
    return {
      sendTo: 'Everyone',
      messages: messages,
      message: ''
    }
  },
  methods: {
    hide: function() {
      app.showChat = false
    },
    sendMessage: function() {
      if (!this.message || !this.canSendMessage) return

      const message = this.message
      this.message = ''

      const messageData = {
        from: app.userId,
        to: this.sendTo,
        text: message
      }
      
      if (messageData.to === 'Everyone') {
        for (const peerName in peerConnections) {
          const channel = peerConnections[peerName].channel
          channel.send(JSON.stringify(messageData))
        }
      } else {
        const channel = peerConnections[messageData.to].channel
        channel.send(JSON.stringify(messageData))
      }

      messageData.from = 'You'
      messages.push(messageData)

      const messagesEl = $('#messages')
      const scrollHeight = messagesEl.prop('scrollHeight')
      messagesEl.animate({ scrollTop: scrollHeight }, 500)
    }
  },
  computed: {
    peersPlusEveryone: function() {
      return this.peers.map(peer => peer.name).concat(['Everyone'])
    },
    canSendMessage: function() {
      return this.peers.length > 0
    }
  },
  watch: {
    peers: function() {
      if (this.peers.includes(this.sendTo)) return
      this.sendTo = 'Everyone'
    }
  }
})