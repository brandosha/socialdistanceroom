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

      let message = this.message
      this.message = ''

      const commands = [
        {
          trigger: 'roll',
          action: function(options) {
            options = options.trim()
            let sides = 6
            let count = 1
          
            if (options.length > 0) {
              const toNum = parseInt(options)
              if (!isNaN(toNum) && toNum.toString() === options) {
                sides = toNum
              } else if (options.includes('d')) {
                const split = options.split('d')
                if (split.length !== 2) return message
                console.log(split)
                
                let dcount = 1
                if (split[0]) dcount = parseInt(split[0])
                const dsides = parseInt(split[1])
                if (isNaN(dcount) || isNaN(dsides)) return message
          
                count = dcount
                sides = dsides
              } else {
                return message
              }
            }
          
            const results = Array(count).fill(0).map(() => Math.ceil(Math.random() * sides))
            
            let total = ''
            if (count === 1) count = 'a '
            else total = ' for a total of ' + results.reduce((prev, curr) => prev + curr, 0)
          
            return 'Rolled ' + count + 'd' + sides + ' and got ' + results.join(', ') + total
          }
        }
      ]

      const command = commands.some(command => {
        const triggerLength = command.trigger.length + 1
        if (
          message.length >= triggerLength && 
          message.slice(0, triggerLength) === '/' + command.trigger
        ) {
          message = command.action(message.slice(triggerLength))
          return true
        }
      })

      const messageData = {
        from: app.userId,
        to: this.sendTo,
        text: message,
        command: command
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