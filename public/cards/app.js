var ws = null

var game = null
const players = []
const messages = []
const app = new Vue({
  el: '#app',
  data: {
    name: localStorage.getItem('name') || '',
    roomId: '',
    connected: false,
    messages,
    message: ''
  },
  methods: {
    joinRoom: function() {
      if (this.invalidJoinInfo || this.connected) return

      document.activeElement.blur()
      setUpWebSocket(this.roomId, this.name).then(() => {
        this.connected = true
        location.hash = 'room=' + this.roomId.trim().toLowerCase()
      }).catch(code => {
        if (code === 4401) alert('Name taken')
      })
    },
    randomRoomId: function() {
      this.roomId = Math.random().toString(35).substr(3)
    },
    sendMessage: function() {
      send = () => {
        wsSend('message', {
          type: 'message',
          text: this.message
        })
      }

      const trimmed = this.message.trim()
      if (trimmed.length > 0) {
        if (trimmed[0] === '.') {
          const command = trimmed.substr(1).toLowerCase()
          const split = command.split(' ').filter(option => option !== '')

          const action = split[0]
          const options = split.slice(1)
          const seed = Math.floor(Math.random() * 0xffffffff)

          const actionData = {
            type: 'action',
            action: action,
            options: options,
            seed: seed
          }

          if (action === 'start') {
            try {
              startGame(options, seed, 'You', this.message)
              wsSend('action', actionData)
            } catch (error) { handleError(this.message, action, error) }
          } else if (game) {
            try {
              const output = game.action(action, options, seed)
              addMessage('action', {
                command: this.message,
                from: 'You',
                output: output.text
              }, true)
              if (output.share) wsSend('action', actionData)
            } catch (error) {
              handleError(this.message, action, error)
            }
          } else {
            addMessage('error', {
              command: this.message,
              action: action,
              text: 'There is no game in progress, use ".start" to start a game'
            }, true)
          }
        } else send()

        this.message = ''
      }
    },
    messageInputEnter: function(event) {
      if (event.shiftKey) return

      event.preventDefault()
      this.sendMessage()
    }
  },
  computed: {
    invalidJoinInfo: function() {
      return (
        this.name.trim().length < 2 ||
        this.roomId.trim().length < 2 ||
        this.name.trim().toLowerCase() === 'me' ||
        this.name.trim().toLowerCase() === 'you' ||
        this.name.includes(' ') ||
        this.name.includes('.')
      )
    }
  },
  watch: {
    name: function() {
      localStorage.setItem('name', this.name)
    }
  }
})

if (location.hash.startsWith('#room=')) app.roomId = location.hash.substr(6)

function addMessage(type, data, scroll) {
  const messagesEl = $('#messages')
  const scrollPos = messagesEl.outerHeight() + messagesEl.scrollTop()
  const scrollHeight = messagesEl.prop('scrollHeight')

  const atBottom = Math.round(scrollPos) === scrollHeight
  app.$nextTick(() => { if (atBottom || scroll) messagesEl.animate({ scrollTop: messagesEl.prop('scrollHeight') }, 500) })

  messages.push({
    type: type,
    data: data
  })
}

function startGame(options, seed, from, command) {
  if (options.length > 1) throw new Error('Unexpected option "' + options[1] + '"')
  
  let preset = 'standard'
  if (options.length === 1) preset = options[0]

  if (!gamePresets.hasOwnProperty(preset)) throw new Error('No such preset "' + preset + '"')
  
  game = new CardGame(preset, seed)
  addMessage('action', {
    command,
    from,
    output: from + ' started ' + gamePresets[preset].name
  })
}

function handleError(command, action, error) {
  if (error instanceof OptionParseError) {
    addMessage('error', {
      command,
      action,
      text: error.message
    })
  } else {
    console.error(error)
    addMessage('error', {
      command,
      action,
      text: 'An internal error occured, check the console'
    })
  }
}

function wsSend(type, payload) {
  ws.send(JSON.stringify({
    type, payload,
    to: 'everyone'
  }))
}

const messageHandlers = {
  peer: (data) => {
    if (data.connected) {
      players.push(data.peer)
      addMessage('info', {
        name: data.peer,
        event: 'connected'
      })
    } else {
      players.splice(players.indexOf(data.peer), 1)
      addMessage('info', {
        name: data.peer,
        event: 'disconnected'
      })
    }
  },
  message: {
    message: (message, from) => {
      if (from === app.name) from = 'You'
      addMessage('message', {
        from: from,
        text: message.text
      }, from === 'You')
    },
    action: (data, from) => {
      if (from === app.name) return

      if (data.action === 'start') {
        startGame(data.options, data.seed, from)
      } else if (game) {
        const output = game.action(data.action, data.options, data.seed, from)
        if (!output.silent) {
          addMessage('action', {
            output: output.text
          })
        }
      } else {
        console.error('Recieved unknown command', data)
      }
    }
  }
}

function setUpWebSocket(roomId, name) {
  return new Promise((resolve, reject) => {
    const host = 'ws' + location.protocol.substr(4) + '//signaling.brandosha.repl.co/'
    const userId = encodeName(name)
    ws = new WebSocket(host + encodeURIComponent(roomId) + '/' + userId)

    ws.onclose = (event) => {
      ws = null
      game = null
      players.forEach(_ => messages.pop())
      messages.forEach(_ => messages.pop())
      
      app.connected = false

      reject(event.code)
    }
    
    ws.onmessage = message => {
      const data = JSON.parse(message.data)
      if (data === true) return resolve()

      // console.log(data)
      if (messageHandlers.hasOwnProperty(data.type)) {
        if (data.type === 'message' && messageHandlers.message.hasOwnProperty(data.payload.type)) {
          messageHandlers.message[data.payload.type](data.payload, data.from)
        } else messageHandlers[data.type](data.payload)
      }
    }
  })
}