var messages = []
Vue.component('chat-menu', {
  props: ['peers', 'myName'],
  data: function() {
    return {
      selectedPeer: 'Everyone',
      messages: messages,
      message: ''
    }
  },
  methods: {
    hide: function() {
      app.showChat = false
    },
    sendMessage: function() {
      const message = this.message
      this.message = ''

      console.log(this.selectedPeer, message)

      const messageData = {
        from: app.userId,
        to: this.selectedPeer,
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
    }
  },
  computed: {
    peersPlusEveryone: function() {
      return this.peers.map(peer => peer.name).concat(['Everyone'])
    }
  },
  watch: {
    peers: function() {
      if (this.selectedPeer === null && this.peers.length > 0) this.selectedPeer = this.peers[0].name
    }
  },
  template: $('chat-menu-template').html()
})
$('chat-menu-template').remove()