class OptionParseError extends Error {
  constructor(message, validSyntax) {
    super(message)
    this.name = 'OptionParseError'
    this.validSyntax = validSyntax || false
  }
}

class CardGame {
  /**
   * @param {*} preset 
   * @param {*} seed 
   */
  constructor(preset='standard', seed=0) {
    this.setUpActions()
    const gamePreset = gamePresets[preset]

    this.deck = gamePreset.deck
    this.piles = {
      shared: {
        draw: new Pile('draw'),
        discard: new Pile('discard')
      },
      hands: { }
    }
    players.forEach(peerName => {
      this.piles.hands[peerName.toLowerCase()] = new Pile('hand', peerName.toLowerCase())
    })
    
    gamePreset.start(this, seed)
  }

  /**
   * @param { string[] } format 
   * @param { string[] } options 
   * @param { string } from 
   * @param { boolean } allowOtherHands 
   */
  parseOptions(format, options, from, allowOtherHands) {
    const types = {
      amount: {
        fixedSize: true,
        parse: options => {
          if (options[0] === 'all') return 'all'

          const int = parseInt(options[0])
          if (
            isNaN(int) ||
            int < 1 ||
            int != options[0]
          ) throw new Error('Expected an amount but got "' + options[0] + '"')
          return int
        }
      },
      cards: {
        fixedSize: false,
        /** @type { (options:string[]) => number[] | 'all' | { position: ('top' | 'bottom' | 'random'), amount: number } } */
        parse: options => {
          if (options.length === 1 && options[0] === 'all') return 'all'

          let allNumbers = true
          const indices = options.map(option => {
            try { return types.number.parse([option]) }
            catch { allNumbers = false }
          })
          if (allNumbers) return indices
          else if (options.length <= 2) {
            let position, amount
            
            try { position = types.position.parse([options[0]]) }
            catch { throw new OptionParseError('Expected a reference to cards, but got "' + options[0] + '"') }

            if (options.length === 2) {
              try { amount = types.amount.parse([options[1]]) }
              catch { throw new OptionParseError('Expected an amount of cards after "' + position + '" but got "' + options[1] + '"') }
            } else amount = 1
            
            
            return { position, amount }
          } else throw new OptionParseError('Expected cards but got "' + options.join(' ') + '"')
        }
      },
      number: {
        fixedSize: true,
        /** @type { (options:string[]) => number } */
        parse: options => {
          const int = parseInt(options[0])
          if (isNaN(int) || int != options[0]) throw new Error('Expected a number but got "' + options[0] + '"')
          return int
        }
      },
      pile: {
        fixedSize: true,
        /** @type { (options:string[]) => Pile } */
        parse: options => {
          const pile = options[0]
          if (pile === 'hand' || pile === from) return this.piles.hands[from]
          else {
            if (players.some(player => pile === player.toLowerCase())) {
              if (!allowOtherHands) throw new OptionParseError('You do not have permission to access "' + pile + '"', true)
              return this.piles.hands[pile]
            } else if (this.piles.shared.hasOwnProperty(pile)) return this.piles.shared[pile]
            else throw new OptionParseError('Unknown pile name "' + pile + '"', true)
          }
        }
      },
      player: {
        fixedSize: true,
        /** @type { (options:string[]) => string | string[] } */
        parse: options => {
          let name = options[0]
          if (name === 'me') return from
          else if (players.some(player => player.toLowerCase() === name)) return name
          else throw new OptionParseError('Unknown player name "' + name + '"')
        }
      },
      players: {
        fixedSize: false,
        /** @type { (options:string[]) => string | string[] } */
        parse: options => {
          if (options.length === 1) {
            if (options[0] === 'everyone') return players.map(player => player.toLowerCase())
            else if (options[0] === 'others') {
              const fromIndex = players.findIndex(player => player.toLowerCase() === from)
              if (fromIndex !== -1) {
                const others = players.slice()
                others.splice(fromIndex, 1)
                return others.map(player => player.toLowerCase())
              }
            }
          }
          
          return options.map(option => types.player.parse([option]))
        }
      },
      position: {
        fixedSize: true,
        /** @type { (options:string[]) => ('top' | 'bottom' | 'random') } */
        parse: (options) => {
          const position = options[0]
          if (!['top', 'bottom', 'random'].includes(position)) throw new OptionParseError('Expected a position ("top" "bottom" or "random") but got "' + position + '"')
          return position
        }
      },
      word: {
        fixedSize: true,
        parse: (options) => options[0]
      }
    }

    let notSeparatorCount = 0
    const optionTypes = format.map((typeStr, i) => {
      if (typeStr[0] === '"' && typeStr[typeStr.length - 1] === '"') {
        if (typeStr.includes(' ')) throw new SyntaxError('Separator cannot conatain spaces')
        return {
          separator: typeStr.substr(1, typeStr.length - 2)
        }
      }

      const typeData = {
        formatIndex: notSeparatorCount++
      }
      const split = typeStr.split('=')

      let key = split[0]
      if (key.endsWith('...')) {
        typeData.fixedSize = false
        key = key.substr(0, key.length - 3)
      }
      if (!types.hasOwnProperty(key)) throw new SyntaxError('No such type "' + key + '"')
      if (typeData.fixedSize === undefined) typeData.fixedSize = types[key].fixedSize
      typeData.key = key

      if (split.length === 2) typeData.default = split[1].split(' ')
      return typeData
    })
    
    const separators = []
    let groupTypes = []
    let remainingOptionTypes = optionTypes.slice()

    let separatorIndex
    while (separatorIndex !== -1) {
      separatorIndex = remainingOptionTypes.findIndex(type => type.hasOwnProperty('separator'))
      if (separatorIndex !== -1) {
        const separator = remainingOptionTypes[separatorIndex].separator
        separators.push(separator)
        groupTypes.push(remainingOptionTypes.slice(0, separatorIndex))
        remainingOptionTypes = remainingOptionTypes.slice(separatorIndex + 1)
      } else groupTypes.push(remainingOptionTypes)
    }

    groupTypes.forEach(group => {
      if (group.length < 2) return
      if (!group.slice(0, group.length - 2).every(type => type.fixedSize)) throw new SyntaxError('Only the last item in a group can have a varied size')
    })

    const result = new Array(notSeparatorCount).fill()
    const groups = []
    let remainingOptions = options.slice()
    
    separators.reverse().forEach((separator, i) => {
      const index = remainingOptions.indexOf(separator)
      if (index === -1) groups.unshift([])
      else {
        const firstGroup = remainingOptions.length === options.length
        const group = remainingOptions.splice(index + 1)
        if (firstGroup) groups.unshift(group)
        else groups.unshift(group.slice(0, group.length - 1))
      }
    })
    if (remainingOptions.length === options.length) groups.unshift(remainingOptions)
    else groups.unshift(remainingOptions.slice(0, remainingOptions.length - 1))

    groupTypes.forEach((optionTypes, i) => {
      const group = groups[i]

      if (groups.length === 0) {
        optionTypes.forEach(type => {
          if (!type.default) throw new OptionParseError('Missing required option of type "' + type.key + '"')
          result[type.formatIndex] = types[type.key].parse(type.default)
        })
      }

      let remainingOptions = group.slice()
      optionTypes.forEach(type => {
        let parsed
        if (remainingOptions.length === 0) {
          if (!type.default) throw new OptionParseError('Missing required option of type "' + type.key + '"')
          parsed = types[type.key].parse(type.default)
        } else {
          if (type.fixedSize) {
            try {
              const first = remainingOptions[0]
              parsed = types[type.key].parse([first])
              remainingOptions.shift()
            } catch (error) {
              if (!error instanceof OptionParseError) throw error
              if (error.validSyntax) throw error
  
              if (!type.default) throw new OptionParseError('Missing required option of type "' + type.key + '"')
              parsed = types[type.key].parse(type.default)
            }
          } else {
            if (types[type.key].fixedSize) parsed = remainingOptions.map(option => types[type.key].parse([option]))
            else parsed = types[type.key].parse(remainingOptions)

            remainingOptions = []
          }
        }

        result[type.formatIndex] = parsed
      })

      if (remainingOptions.length > 0) throw new OptionParseError('Unexpected option "' + remainingOptions[0] + '"')
    })
    
    return result
  }

  setUpActions() {
    /**
     * @callback Action
     * @param { string[] } options
     * @param { string } from
     * @param { number } random
     * @returns { {
      *   text: string,
      *   share: boolean,
      *   silent: boolean
      * } }
      */
 
     /** @type { Object.<string, Action> } */
    const actions = { }

    actions.add = (options, from) => {
      const [pile] = this.parseOptions(['pile=draw'], options, from)
      pile.cards.unshift(...this.deck.fullSet)

      return {
        text: formatName(from) + ' added ' + this.deck.fullSet.length + ' cards to ' + formatPile(pile, from),
        modifies: [pile],
        share: true
      }
    }

    actions.choose = (options, from) => {
      const [cardsRef, pile] = this.parseOptions(['cards', '"from"', 'pile=draw'], options, from)
      if (pile.name === 'hand') throw new OptionParseError('You cannot choose cards from your own hand')

      const hand = this.piles.hands[from]
      const cards = pile.removeCards(cardsRef)
      hand.cards.unshift(...cards)

      const cardsFormat = cards.length === 1 ? 'card' : 'cards'
      return {
        text: formatName(from) + ' chose ' + cards.length + ' ' + cardsFormat + ' from ' + formatPile(pile),
        cards: cards.map((card, i) => { return { card, index: i + 1 } }),
        shows: hand,
        modifies: [pile, hand],
        share: true
      }
    }

    actions.count = (options, from) => {
      const [pile] = this.parseOptions(['pile=hand'], options, from, true)

      if (from === app.name.toLowerCase()) {
        const amountFormat = pile.cards.length === 1 ? 'is 1 card' : 'are ' + pile.cards.length + ' cards'
        return {
          text: 'There ' + amountFormat + ' in ' + formatPile(pile),
          share: pile.owner !== from
        }
      } else {
        return {
          text: formatName(from) + ' counted the cards in ' + formatPile(pile),
          silent: pile.owner !== 'shared' && pile.owner !== app.name.toLowerCase()
        }
      }
    }

    actions.deal = (options, from) => {
      const [amount, pile, dealTo] = this.parseOptions(['amount=all', '"from"' ,'pile=draw', '"to"', 'players=everyone'], options, from)

      let totalAmount
      if (amount === 'all') totalAmount = pile.cards.length
      else totalAmount = Math.min(amount * dealTo.length, pile.cards.length)

      Array.range(1, totalAmount).forEach(i => {
        const index = i - 1
        const card = pile.cards.shift()
        const player = dealTo[index % dealTo.length]
        this.piles.hands[player].cards.unshift(card)
      })

      const amountText = totalAmount === pile.cards.length ? 'all of the' : amount
      const cardsFormat = amount === 1 ? 'card' : 'cards'
      return {
        text: formatName(from) + ' dealt out ' + amountText + ' ' + cardsFormat + ' from ' + formatPile(pile) + ' to ' + formatPlayers(dealTo),
        modifies: [pile, this.piles.hands[from]],
        share: true,
        silent: dealTo.findIndex(player => player === app.name.toLowerCase()) === -1
      }
    }

    actions.look = (options, from, seed) => {
      const [cardsRef, pile] = this.parseOptions(['cards=all', '"in"', 'pile=hand'], options, from)
      
      const cards = pile.getCards(cardsRef, seed)
      if (from === app.name.toLowerCase()) {
        let cardsText
        if (cards.length == 0) cardsText = 'Empty'
        else cardsText = cards.map(cardData => cardData.index + ': ' + this.deck.cardToText(cardData.card)).join("\n")
        return {
          text: capitalize(formatPile(pile)) + ':',// + ":\n" + cardsText,
          cards: cards,
          shows: pile,
          share: pile.owner !== from
        }
      } else {
        let cardsFormat = cards.length === 1 ? 'card' : 'cards'
        let amountText
        if (cardsRef === 'all') amountText = ''
        else if (cardsRef.hasOwnProperty('position')) {
          if (cardsRef.position === 'random') amountText = cards.length + ' random cards from '
          else amountText = cards.length + ' ' + cardsFormat + ' from the ' + cardsRef.position + ' of '
        } else amountText = cards.length + ' ' + cardsFormat + ' from '
        return { text: formatName(from) + ' looked at '  + amountText + formatPile(pile) }
      }
    }

    actions.make = (options, from) => {
      const pileName = this.parseOptions(['word'], options, from)
      if (this.piles.shared.hasOwnProperty(pileName))
        throw new OptionParseError('"' + pileName + '" already exists')
      else if (forbiddenNames.includes(pileName))
        throw new OptionParseError('"' + pileName + '" is a reserved word')
      else if (players.map(player => player.toLowerCase()).includes(pileName))
        throw new OptionParseError('Piles cannot have the same name as a player')
      
      this.piles.shared[pileName] = new Pile(pileName, 'shared')

      return {
        text: formatName(from) + ' created a new pile "' + pileName + '"',
        share: true
      }
    }

    actions.move = (options, from, seed) => {
      const [cardsRef, fromPile, position, toPile] = this.parseOptions(['cards', '"from"', 'pile=draw', '"to"', 'position=top', 'pile=discard'], options, from)
      const cards = fromPile.removeCards(cardsRef)

      let oldPlacement = 'the ' + position + ' of'
      if (position === 'random') oldPlacement = ' random positions in'

      let newPlacement = 'onto the ' + position + ' of'
      if (position === 'top') {
        toPile.cards.unshift(...cards)
      } else if (position === 'bottom') {
        toPile.cards.push(...cards)
      } else {
        const rand = Math.seededRandom(seed)
        cards.forEach(card => {
          const index = Math.floor(rand() * (toPile.cards.length + 1))
          toPile.cards.splice(index, 0, card)
        })
        newPlacement = 'at random into'
      }

      let cardsFormat = cards.length === 1 ? 'card' : 'cards'
      return {
        text: formatName(from) + ' moved ' + cards.length + ' ' + cardsFormat + ' from ' + oldPlacement + ' ' + formatPile(fromPile) + ' ' + newPlacement + ' ' + formatPile(toPile),
        modifies: [fromPile, toPile],
        share: true
      }
    }

    actions.play = (options, from, seed) => {
      const [cardsRef, position, pile] = this.parseOptions(['cards', '"onto"', 'position=top', 'pile=discard'], options, from)
      const hand = this.piles.hands[from]

      if (pile.name === 'hand') throw new OptionParseError('Cannot play a card onto the top of your hand')

      const cards = hand.removeCards(cardsRef, seed)

      let placement = 'onto the ' + position + ' of'
      let indices = []
      if (position === 'top') {
        pile.cards.unshift(...cards)
        indices = Array.range(1, cards.length)
      } else if (position === 'bottom') {
        pile.cards.push(...cards)
        indices = Array.range(pile.cards.length - 1 - cards.length, pile.cards.length)
      } else {
        const rand = Math.seededRandom(seed)
        cards.forEach(card => {
          const index = Math.floor(rand() * (pile.cards.length + 1))
          indices.push(index)
          pile.cards.splice(index, 0, card)
        })
        placement = 'at random into'
      }

      const cardsFormat = cards.length === 1 ? 'card' : 'cards'
      const cardsText = cards.map((card, i) => indices[i] + ': ' + this.deck.cardToText(card)).join("\n")
      return {
        text: formatName(from) + ' played ' + cards.length + ' ' + cardsFormat + ' ' + placement + ' ' + formatPile(pile),// + ":\n" + cardsText,
        cards: cards.map((card, i) => { return { index: indices[i], card } }),
        pile: hand,
        modifies: [pile, hand],
        share: true
      }
    }

    actions.put = (options, from, seed) => {
      const [cardsRef, position, pile] = this.parseOptions(['cards', '"onto"', 'position=top', 'pile=discard'], options, from)
      const hand = this.piles.hands[from]

      if (pile.name === 'hand') throw new OptionParseError('Cannot play a card onto the top of your hand')

      const cards = hand.removeCards(cardsRef, seed)

      let placement = 'onto the ' + position + ' of'
      let indices = []
      if (position === 'top') {
        pile.cards.unshift(...cards)
        indices = Array.range(1, cards.length)
      } else if (position === 'bottom') {
        pile.cards.push(...cards)
        indices = Array.range(pile.cards.length - 1 - cards.length, pile.cards.length)
      } else {
        const rand = Math.seededRandom(seed)
        cards.forEach(card => {
          const index = Math.floor(rand() * (pile.cards.length + 1))
          indices.push(index)
          pile.cards.splice(index, 0, card)
        })
        placement = 'at random into'
      }

      const cardsFormat = cards.length === 1 ? 'card' : 'cards'
      return {
        text: formatName(from) + ' put ' + cards.length + ' ' + cardsFormat + ' ' + placement + ' ' + formatPile(pile),
        share: true
      }
    }

    actions.remove = (options, from, seed) => {
      const [cardsRef, pile] = this.parseOptions(['cards=all', '"from"', 'pile'], options, from)
      const cards = pile.removeCards(cardsRef)

      let cardsText = ''
      if (cards.length > 0) cardsText = ":\n" + cards.map(card => this.deck.cardToText(card)).join("\n")

      return {
        text: formatName(from) + ' removed ' + cards.length + ' cards from ' + formatPile(pile) + cardsText,
        modifies: [pile],
        share: true
      }
    }

    actions.roll = (options, from, seed) => {
      const [dice] = this.parseOptions(['word=d6'], options, from)

      let sides = 6
      let count = 1
      if (dice.length > 0) {
        const toNum = parseInt(dice)
        if (!isNaN(toNum) && toNum.toString() === dice) {
          sides = toNum
        } else if (dice.includes('d')) {
          const split = dice.split('d')
          if (split.length !== 2) return message
          
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
    
      const rand = Math.seededRandom(seed)
      const results = Array(count).fill(0).map(() => Math.ceil(rand() * sides))
      
      let total = ''
      if (count === 1) count = 'a '
      else total = ' for a total of ' + results.reduce((prev, curr) => prev + curr, 0)

      return {
        text: formatName(from) + ' rolled ' + count + 'd' + sides + ' and got ' + results.join(', ') + total,
        share: true
      }
    }

    actions.show = (options, from) => {
      const [cardsRef, players] = this.parseOptions(['cards', '"to"', 'players=everyone'], options, from)

      const cards = this.piles.hands[from].getCards(cardsRef)
      const cardsFormat = cards.length === 1 ? 'card' : 'cards'
      if (from === app.name.toLowerCase()) {
        return {
          text: 'You showed ' + formatPlayers(players) + ' ' + cards.length + ' ' + cardsFormat + " from your hand",//:\n" + cards.map(card => this.deck.cardToText(card.card)).join("\n"),
          cards: cards,
          shows: this.piles.hands[from],
          share: true
        }
      } else {
        return {
          text: formatName(from) + ' showed you ' + cards.length + ' ' + cardsFormat + " from their hand:\n" + cards.map(card => this.deck.cardToText(card.card)).join("\n"),
          silent: !players.includes(app.name.toLowerCase())
        }
      }
    }

    actions.shuffle = (options, from, seed) => {
      const [pile] = this.parseOptions(['pile=draw'], options, from)
      pile.shuffle(seed)

      return {
        text: formatName(from) + ' shuffled ' + formatPile(pile),
        modifies: [pile],
        share: true,
        silent: pile.owner !== 'shared' && pile.owner !== app.name.toLowerCase()
      }
    }

    actions.sort = (options, from) => {
      let defaultSortBy = this.deck.sortables.keys[0]
      if (Array.isArray(defaultSortBy)) defaultSortBy = defaultSortBy[0]

      const [pile, sortBy] = this.parseOptions(['pile=hand', '"by"', 'word=' + defaultSortBy], options, from)
      pile.sort(this.deck, sortBy)

      return {
        text: formatName(from) + ' sorted ' + formatPile(pile) + ' by ' + sortBy,
        modifies: [pile],
        share: true,
        silent: pile.owner !== 'shared' && pile.owner !== app.name.toLowerCase()
      }
    }

    actions.take = (options, from) => {
      const [amount, position, pile] = this.parseOptions(['amount=1', '"from"', 'position=top', 'pile=draw'], options, from)
      if (position === 'random') throw new OptionParseError('"random" is not a valid option for this action')
      if (pile.name === 'hand') throw new OptionParseError('You cannot take cards from your own hand')

      const cardsRef = amount === 'all' ? 'all' : { position, amount }
      const hand = this.piles.hands[from]
      const cards = pile.removeCards(cardsRef)
      hand.cards.unshift(...cards)

      const cardsFormat = amount === 1 ? 'card' : 'cards'
      let cardsText = ''
      if (from === app.name.toLowerCase())
        cardsText = ":\n" + cards.map((card, i) => (i + 1) + ': ' + this.deck.cardToText(card)).join("\n")
      return {
        text: formatName(from) + ' took ' + amount + ' ' + cardsFormat + ' from the ' + position + ' of the ' + formatPile(pile),// + cardsText,
        cards: cards.map((card, i) => { return { card, index: i + 1 } }),
        shows: hand,
        modifies: [pile, hand],
        share: true
      }
    }

    this.actions = actions
  }

  action(action, options, seed, from) {
    if (!this.actions.hasOwnProperty(action)) throw new OptionParseError('Unknown command "' + action + '"')
    if (from === undefined) from = app.name
    from = from.toLowerCase()

    return this.actions[action](options, from, seed)
  }
}

class Deck {
  /**
   * @callback CardText
   * @param { Object } cardData
   * @returns { string }
   */

  /**
   * @param { Object } sortables 
   * @param { string[] } sortables.keys
   * @param { Object.<string, any[]> } sortables.keyData
   * 
   * @param { CardText } cardText 
   * @param { number[][] } fullSet 
   */
  constructor(sortables, cardText, fullSet) {
    if (!'keys' in sortables) throw new TypeError('Sortables object must have `keys` property')
    if (!'keyData' in sortables) throw new TypeError('Sortables object must have `keyData` property')
    this.sortables = sortables

    if (typeof cardText !== 'function') throw new TypeError('Card text parameter must be a function')
    this.cardText = cardText

    if (!fullSet.every(card => this.validCard(card))) throw new Error ('Full set must contain all valid cards')
    this.fullSet = fullSet
  }

  validCard(card) {
    const keys = this.sortables.keys
    if (!Array.isArray(card)) return false
    if (card.length !== keys.length) return false

    return card.every((value, index) => {
      let keyName = keys[index]
      if (Array.isArray(keyName)) keyName = keyName[0]

      return value < this.sortables.keyData[keyName].length
    })
  }

  cardToText(card) {
    if (!this.validCard(card)) return 'invalid card'

    const cardObj = card.slice()
    card.forEach((val, i) => {
      const key = this.sortables.keys[i]
      if (Array.isArray(key)) {
        key.forEach(keyName => cardObj[keyName] = this.sortables.keyData[key[0]][val])
      } else {
        cardObj[key] = this.sortables.keyData[key][val]
      }
    })

    return this.cardText(cardObj)
  }
}

class Pile {
  /**
   * @param { string } name 
   * @param { string? } owner 
   */
  constructor(name, owner) {
    this.name = name
    this.owner = owner || 'shared'

    /** @type { number[][] } */
    this.cards = []
  }

  /**
   * @param {number} seed 
   */
  shuffle(seed) {
    if (seed === undefined) seed = Math.floor(Math.random() * 0xffffffff)
    const rand = Math.seededRandom(seed)

    const newCards = []
    const indices = Array.range(0, this.cards.length - 1)
    indices.slice().forEach(_ => {
      const randi = Math.floor(rand() * indices.length)
      const index = indices[randi]
      indices.splice(randi, 1)

      newCards.push(this.cards[index])
    })

    this.cards = newCards
  }

  sort(deck, sortBy) {
    const sortByIndex = deck.sortables.keys.findIndex((key, i) => {
      if (Array.isArray(key)) return key.includes(sortBy)
      else return key === sortBy
    })
    if (sortByIndex === -1) throw new Error('Unable to sort by "' + sortBy + '"')

    const sortIndicesOrder = [sortByIndex].concat(Array.range(0, deck.sortables.keys.length - 1))
    sortIndicesOrder.splice(sortByIndex + 1, 1)
    this.cards.sort((a, b) => {
      let aVal = 0
      let bVal = 0

      sortIndicesOrder.forEach((sortIndex, i) => {
        const valStep = sortIndicesOrder.slice(i + 1).reduce((prev, curr) => {
          let key = deck.sortables.keys[curr]
          if (Array.isArray(key)) key = key[0]

          return prev + deck.sortables.keyData[key].length
        }, 1)
        
        aVal += valStep * a[sortIndex]
        bVal += valStep * b[sortIndex]
      })

      return aVal - bVal
    })
  }

  /**
   * @param { number[] | 'all' | { position: ('top' | 'bottom' | 'random'), amount: number } } cardsRef 
   * @returns { { card: number[][], index: number }[] }
   */
  getCards(cardsRef, seed=1) {
    if (cardsRef === 'all') {
      return this.cards.map((card, i) => {
        return { card, index: i + 1 }
      })
    } else if (Array.isArray(cardsRef)) {
      cardsRef = Array.from( new Set(cardsRef) )
      return cardsRef.map(index => {
        if (index < 1) throw new OptionParseError(index + ' is not a valid card index')
        if (index > this.cards.length) throw new OptionParseError('There is no card at index ' + index)
        return { card: this.cards[index - 1], index }
      })
    } else {
      let indices
      cardsRef.amount = Math.min(cardsRef.amount, this.cards.length)
      if (cardsRef.position === 'top') indices = Array.range(1, cardsRef.amount)
      else if (cardsRef.position === 'bottom') {
        const startIndex = Math.max(this.cards.length - 1 - cardsRef.amount, 0)
        indices = Array.range(startIndex, this.cards.length)
      } else {
        const rand = Math.seededRandom(seed)
        const allIndices = Array.range(1, this.cards.length)
        indices = Array.range(1, cardsRef.amount).map(_ => {
          return allIndices.splice(Math.floor(rand() * allIndices.length), 1)
        })
      }
      return indices.map(index => {
        return { card: this.cards[index - 1], index }
      })
    }
  }

  removeCards(cardsRef, seed=2) {
    const cards = this.getCards(cardsRef, seed)
    const sorted = cards.slice().sort((a, b) => b.index - a.index)

    const removed = []
    sorted.forEach((card, i) => {
      this.cards.splice(card.index - 1, 1)
      removed.push(cards[i].card)
    })

    return removed
  }
}

/**
 * @callback VerifyConfig
 * @throws
 */
/**
 * @callback GameConfig
 * @param { CardGame } game
 * @param { number } seed
 */
/** @type { Object.<string, { name: string, deck: Deck, verify: VerifyConfig, start: GameConfig }> } */
var gamePresets = { }
gamePresets.standard = {
  name: 'a standard game',
  deck: new Deck({
    keys: [['value', 'rank', 'number'], 'suit'],
    keyData: {
      value: Array.range(2, 10).concat(['Jack', 'Queen', 'King', 'Ace', 'joke']),
      suit: ['Diamonds', 'Clubs', 'Hearts', 'Spades', 'joke']
    }
  }, card => {
    if (card.value === 'joke' || card.suit === 'joke') return 'Joker'
    return card.value + ' of ' + card.suit
  }, (() => {
    const cards = []
    Array.range(0, 12).forEach(i => {
      Array.range(0, 3).forEach((j) => {
        cards.push([i, j])
      })
    })
    cards.push([13, 4], [13, 4])
    return cards
  })()),
  start: (game, seed) => {
    game.piles.shared.draw.cards = gamePresets.standard.deck.fullSet
    game.actions.shuffle([], 'Preset', seed)
  }
}

gamePresets.uno = {
  name: 'an uno game',
  deck: new Deck({
    keys: ['color', 'number'],
    keyData: {
      color: ['Red', 'Yellow', 'Green', 'Blue', 'Wild'],
      number: Array.range(0,9).concat(['Skip', 'Reverse', '+2', 'Wild', '+4'])
    }
  }, card => {
    if (card.number === 'Wild') return 'Wild'
    return card.color + ' ' + card.number
  }, (() => {
    let cards = []

    Array.range(0, 3).forEach(i => {
      Array.range(0, 12).forEach(j => {
        cards.push([i, j])
      })
    })
    Array.range(0, 3).forEach(i => {
      Array.range(1, 12).forEach(j => {
        cards.push([i, j])
      })
    })
    cards = cards.concat(Array(4).fill().map(_ => [4, 13]))
    cards = cards.concat(Array(4).fill().map(_ => [4, 14]))

    return cards
  })()),
  verify: () => {
    if (players.length < 2) throw new OptionParseError('Can\'t play Uno with only 1 player')
  },
  start: (game, seed) => {
    Array.range(1, Math.ceil(players.length / 10)).forEach(_ => {
      game.piles.shared.draw.cards.push(...gamePresets.uno.deck.fullSet)
    })

    game.actions.shuffle([], 'Preset', seed)
    game.actions.deal(['7'], 'Preset')
    game.actions.move(['top'], 'Preset')

    const rand = Math.seededRandom(seed)
    while (game.piles.shared.discard.cards[0][1] > 9) {
      game.actions.move('top from discard to random draw'.split(' '), 'Preset', Math.floor(rand() * 0xffffffff))
      game.actions.move(['top'], 'Preset')
    }

    addMessage('action', {
      output: "Starting card:\n" + gamePresets.uno.deck.cardToText(game.piles.shared.discard.cards[0])
    })
  }
}

gamePresets.scum = {
  name: 'a game of scum',
  deck: new Deck({
    keys: [['value', 'rank', 'number'], 'suit'],
    keyData: {
      value: Array.range(3, 10).concat(['Jack', 'Queen', 'King', 'Ace', 2]),
      suit: ['Diamonds', 'Clubs', 'Hearts', 'Spades']
    }
  }, card => {
    return card.value + ' of ' + card.suit
  }, (() => {
    const cards = []
    Array.range(0, 12).forEach(i => {
      Array.range(0, 3).forEach((j) => {
        cards.push([i, j])
      })
    })
    return cards
  })()),
  verify: () => {
    if (players.length < 3) {
      const playerCount = players.length === 1 ? '1 player' : players.length + ' players'
      throw new OptionParseError('Can\'t play scum with only ' + playerCount)
    }
  },
  start: (game, seed) => {
    Array.range(1, Math.ceil(players.length / 5)).forEach(_ => {
      game.piles.shared.draw.cards.push(...gamePresets.scum.deck.fullSet)
    })
    
    game.actions.shuffle([], 'Preset', seed)
    game.actions.deal([], 'Preset')
  }
}
gamePresets.president = gamePresets.scum

gamePresets.mafia = {
  name: 'a game of mafia',
  deck: new Deck({
    keys: ['name'],
    keyData: {
      name: ['Villager', 'Doctor', 'Detective', 'Mafia']
    }
  }, card => card.name, Array.range(0, 3).map(a => [a])),
  verify: () => {
    if (players.length < 7) {
      const playerCount = players.length === 1 ? '1 player' : players.length + ' players'
      throw new OptionParseError('Can\'t play mafia with only ' + playerCount)
    }
  },
  start: (game, seed) => {
    const mafiaCount = Math.floor(players.length / 2)
    const mafiaCards = Array(mafiaCount).fill().map(_ => [3])
    const specialCards = [[1], [2]]
    const villagerCount = players.length - mafiaCount - 3 // no card for moderator
    const villagerCards = Array(villagerCount).fill().map(_ => [0])

    game.piles.shared.draw.cards = villagerCards.concat(specialCards).concat(mafiaCards)
    game.actions.shuffle([], 'Preset', seed)
  }
}