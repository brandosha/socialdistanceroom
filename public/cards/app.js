var ws = null

var game = null
const players = []
const groups = []
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
    commandHistory: [],
    historyIndex: -1,
    players: players,
    groups: groups,
    groupsUpdated: {},
    newGroupName: '',
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
      let sendTo = []
      let groupIndex
      if (this.sendTo === 'Everyone') sendTo = 'everyone'
      else if (groups.some((group, i) => {
        if (group.name === this.sendTo) {
          groupIndex = i
          return true
        }
      })) {
        sendTo = groups[groupIndex].members.slice()
        if (!sendTo.includes(this.name)) sendTo.push(this.name)
      } else sendTo = [this.sendTo, this.name]

      send = () => {
        wsSend('message', {
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

          this.commandHistory.unshift(this.message)
          if (this.commandHistory.length > 20) this.commandHistory.pop()
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
    createGroup: function() {
      const name = this.newGroupName.trim()
      const safeId = b64UrlEncode(name).split('=')[0]
      const groupIndex = this.groups.length
      this.groupsUpdated[groupIndex] = true
      this.groups.push({
        name, safeId,
        owner: true,
        members: [],
        shared: false
      })
      this.newGroupName = ''

      this.$watch(() => this.groups[groupIndex], () => {
        this.groupsUpdated[groupIndex] = true
      }, { deep: true })

      this.$nextTick(() => {
        $('#' + safeId + '-member-select').selectpicker()
        $('#collapse-group-' + safeId).collapse('show')
      })
    },
    saveGroups: function() {
      this.groups.forEach((group, i) => {
        if (this.groupsUpdated[i] && group.owner === true) {
          wsSend('group', {
            group: {
              name: group.name,
              members: group.members,
              shared: group.shared
            }
          })

          this.groupsUpdated[i] = false
        }
      })
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
    messageIsCommand: function() {
      return this.message.trim()[0] === '.'
    },
    invalidGroupName: function() {
      const groupName = this.newGroupName.trim().toLowerCase()
      return (
        this.newGroupName.length < 1 ||
        groupName === this.name.toLowerCase() ||
        forbiddenNames.includes(groupName) ||
        groups.some(group => group.name.toLowerCase() === groupName) ||
        players.some(player => player.toLowerCase() === groupName)
      )
    },
    myGroups: function() {
      return this.groups.filter(group => {
        return (
          group.owner === true ||
          (
            group.shared &&
            group.members.includes(this.name)
          )
        )
      })
    },
    otherPlayers: function() {
      const players = this.players.slice()
      players.splice(players.indexOf(this.name), 1)
      return players
    },
    peersPlusGroups: function() {
      return this.myGroups.map(group => group.name).concat(this.otherPlayers).concat('Everyone')
    }
  },
  watch: {
    name: function() {
      localStorage.setItem('name', this.name)
    },
    players: function() {
      this.$nextTick(() => $('.selectpicker').selectpicker('refresh'))
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

  if (messageData.modifies) {
    messageData.modifies.forEach(modified => {
      messages.slice().reverse().slice(1).some((message, i) => {
        const shows = message.data.shows
        if (!shows) return
        if (
          shows.name === modified.name &&
          shows.owner === modified.owner
        ) {
          if (message.data.hideCardIndices) return true

          const wrongCardsIndex = messages.length - 2 - i
          messages[wrongCardsIndex].data.hideCardIndices = true
        }
      })
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

function deleteGroup(nameOrIndex) {
  let name
  if (typeof nameOrIndex === 'number') {
    const i = nameOrIndex
    name = groups[i].name
    
    groups.splice(i, 1)
  } else {
    name = nameOrIndex
    
    groups.some((group, i) => {
      if (group.name === name) {
        groups.splice(i, 1)
        return true
      }
    })
  }
  if (app.sendTo === name) app.sendTo = 'Everyone'
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
  payload.type = type
  ws.send(JSON.stringify({
    to, payload
  }))
}

const messageHandlers = {
  history: (message) => {
    const data = JSON.parse(message)

    if (messageHandlers.hasOwnProperty(data.type)) {
      if (data.type === 'message' && messageHandlers.message.hasOwnProperty(data.payload.type)) {
        messageHandlers.message[data.payload.type](data.payload, data.from, true)
      } else messageHandlers[data.type](data.payload, true)
    }
  },
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

      groups.forEach((group, i) => {
        if (group.owner === data.peer) deleteGroup(i)
      })

      if (game && game.piles.hands.hasOwnProperty(data.peer.toLowerCase())) {
        delete game.piles.hands[data.peer.toLowerCase()]
      }
    }
  },
  message: {
    message: (message, from, history) => {
      if (from === app.name && !history) from = 'You'
      addMessage('message', {
        from: from,
        text: message.text,
        to: message.to
      }, from === 'You')
    },
    action: (data, from, history) => {
      if (from === app.name && !history) return

      if (data.action === 'start') {
        startGame(data.options, data.seed, from)
      } else if (game) {
        const output = game.action(data.action, data.options, data.seed, from)
        if (!output.silent) {
          addMessage('action', {
            output: output.text,
            cards: output.cards,
            shows: output.shows,
            modifies: output.modifies
          })
          hideModifiedCards()
        }
      } else {
        console.error('Recieved unknown command', data)
      }
    },
    group: (data, from, history) => {
      if (from === app.name) return
      const newGroup = data.group
      newGroup.members.push(from)
      newGroup.safeId = b64UrlEncode(newGroup.name).split('=')[0]
      newGroup.owner = from

      const groupExists = groups.some(group => {
        if (group.name === newGroup.name) {
          group.members = newGroup.members
          group.shared = newGroup.shared
          group.safeId = newGroup.safeId
          return true
        }
      })
      if (!groupExists) groups.push(newGroup)

      app.$nextTick(() => {
        const selectEl = $('#' + newGroup.safeId + '-member-select')
        if (!groupExists) selectEl.selectpicker()
        selectEl.selectpicker('val', newGroup.members)
      })
    }
  }
}

function setUpWebSocket(room, name) {
  return new Promise((resolve, reject) => {
    const host = 'ws' + location.protocol.substr(4) + '//cardsv2.brandosha.repl.co/'
    const roomId = b64UrlEncode('CARDSv2_' + room)
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
        if (data.type === 'message') {
          if (messageHandlers.message.hasOwnProperty(data.payload.type)) messageHandlers.message[data.payload.type](data.payload, data.from)
        } else messageHandlers[data.type](data.payload)
      }
    }
  })
}