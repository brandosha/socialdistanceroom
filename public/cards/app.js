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
    message: '',
    pendingMessage: '',
    historyIndex: -1,
    players: players,
    sendTo: 'Everyone'
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
      const sendTo = this.sendTo === 'Everyone' ? 'everyone' : [this.sendTo, this.name]
      send = () => {
        wsSend('message', {
          type: 'message',
          text: this.message,
          to: this.sendTo
        }, sendTo)
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
                output: output.text,
                cards: output.cards,
                shows: output.shows,
                modifies: output.modifies
              }, true)
              hideModifiedCards()
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
        this.historyIndex = -1
      }
    },
    setGroup: function(group) {
      if (this.peersPlusGroups.includes(group)) this.sendTo = group
    },
    groupClass: function(group) {
      const validGroup = this.peersPlusGroups.includes(group)
      return {
        'font-weight-bold': true,
        'text-primary': validGroup,
        'cursor-pointer': validGroup
      }
    },
    manageGroups: function() {
      // TODO
    },
    navigateHistory: function(direction, event) {
      const cursorPos = event.target.selectionStart
      if (cursorPos !== event.target.selectionEnd) return
      if (direction === 1 && cursorPos !== 0) return
      if (direction === -1 && cursorPos !== this.message.length) return

      const index = this.historyIndex + direction
      if (index >= this.commandHistory.length) return
      if (index < 0) {
        this.message = this.pendingMessage
        this.historyIndex = -1
        return
      }
      
      if (this.historyIndex === -1) this.pendingMessage = this.message
      this.message = this.commandHistory[index]
      this.historyIndex = index
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
        this.name.includes(' ') ||
        this.name.includes('.') ||
        forbiddenNames.includes(this.name.trim().toLowerCase())
      )
    },
    commandHistory: function() {
      const commands = []
      this.messages.slice().reverse().slice(0, 10).forEach(message => {
        if (message.data.command !== undefined) commands.push(message.data.command)
      })
      return commands
    },
    messageIsCommand: function() {
      return this.message.trim()[0] === '.'
    },
    peersPlusGroups() {
      const players = this.players.slice()
      players.splice(players.indexOf(this.name), 1)
      return players.concat('Everyone')
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

function hideModifiedCards() {
  const newMessage = messages[messages.length - 1]
  const messageData = newMessage.data
  console.log(JSON.parse(JSON.stringify(newMessage)))

  if (messageData.modifies) {
    messageData.modifies.forEach(modified => {
      let wrongCardsIndex = messages.slice().reverse().slice(1).findIndex(message => {
        const shows = message.data.shows
        if (shows) return shows.owner === modified.owner && shows.name === modified.name
      })
      console.log(wrongCardsIndex)
      if (wrongCardsIndex !== -1) {
        wrongCardsIndex = messages.length - 2 - wrongCardsIndex
        console.log(wrongCardsIndex)
        console.log(messages[wrongCardsIndex])
        messages[wrongCardsIndex].data.hideCardIndices = true
      }
    })
  }
  
  if (messageData.cards) {
    messageData.cardsText = 'None'
    if (messageData.cards.length > 0) {
      messageData.cardsText = messageData.cards.map(data => {
        return { index: data.index, text: game.deck.cardToText(data.card) }
      })
    }
  }
}

function startGame(options, seed, from, command) {
  if (options.length > 1) throw new Error('Unexpected option "' + options[1] + '"')
  
  let preset = 'standard'
  if (options.length === 1) preset = options[0]

  if (!gamePresets.hasOwnProperty(preset)) throw new OptionParseError('No such preset "' + preset + '"')
  
  if (gamePresets[preset].verify) gamePresets[preset].verify()
  addMessage('action', {
    command,
    from,
    output: from + ' started ' + gamePresets[preset].name
  })

  game = new CardGame(preset, seed)
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

function wsSend(type, payload, to='everyone') {
  ws.send(JSON.stringify({
    type, payload, to
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

      if (game && !game.piles.hands.hasOwnProperty(data.peer.toLowerCase())) {
        game.piles.hands[data.peer.toLowerCase()] = new Pile('hand', data.peer.toLowerCase())
      }
    } else {
      players.splice(players.indexOf(data.peer), 1)
      addMessage('info', {
        name: data.peer,
        event: 'disconnected'
      })

      if (game && game.piles.hands.hasOwnProperty(data.peer.toLowerCase())) {
        delete game.piles.hands[data.peer.toLowerCase()]
      }
    }
  },
  message: {
    message: (message, from) => {
      if (from === app.name) from = 'You'
      addMessage('message', {
        from: from,
        text: message.text,
        to: message.to
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

function setUpWebSocket(room, name) {
  return new Promise((resolve, reject) => {
    const host = 'ws' + location.protocol.substr(4) + '//signaling.brandosha.repl.co/'
    const roomId = b64UrlEncode(location.hostname + '_' + room)
    const userId = b64UrlEncode(name)
    ws = new WebSocket(host + roomId + '/' + userId)

    ws.onclose = (event) => {
      ws = null
      game = null
      players.forEach(_ => messages.pop())
      messages.forEach(_ => messages.pop())
      
      app.connected = false
      app.message = ''
      app.sendTo = 'Everyone'

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