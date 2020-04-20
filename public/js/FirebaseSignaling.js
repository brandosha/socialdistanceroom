class FirebaseSignaling {
  /**
   * @param { string } name
   * @param { string } room
   */
  constructor(name, room) {
    this.room = room
    this.name = name

    this.roomId = sha1(room)
    this.userId = btoa(encodeURIComponent(name))

    /** @typedef { 'nametaken' | 'notconnected' } ConnectionError */
    /** @type { (error: ConnectionError) => void } */
    this.onerror
    /** @type { () => void } */
    this.onready
    /**
     * @callback RoomCreateCallback
     * @returns { boolean | Promise<boolean> } cancel
     */
    /** @type { RoomCreateCallback | boolean } */
    this.onroomcreate = false
    /**
     * @callback RoomJoinCallback
     * @param { string[] } peers
     * @returns { boolean | Promise<boolean> } cancel
     */
    /** @type { RoomJoinCallback | boolean } */
    this.onroomjoin = true
    /**
     * @callback PeerCreateCallback
     * @param { string } peerName
     * @param { boolean } incoming
     * @returns { RTCPeerConnection }
     */
    /** @type { PeerCreateCallback } */
    this.buildpeer
    /** @type { (name: string) => void } */
    this.onpeerdisconnnect

    /** @type { Object<string, RTCPeerConnection> } */
    this.peers = { }
    
    /**
     * @typedef SignalingPeer
     * @property { RTCPeerConnection } connection
     * @property { RTCDataChannel } channel
     */
    /** @type { Object<string, SignalingPeer> } */
    this._peers = { }

    this._started = false
    this._joined = false
    this.watchPresence()
  }

  watchPresence() {
    let prevDisconnected = false
    database.ref('.info/connected').on('value', snap => {
      if (!this._started) return

      let connected = snap.val()
      if (connected) {
        if (prevDisconnected) this.start()
      } else {
        Object.keys(this.peers).forEach(name => this.onpeerdisconnnect(name))
        this.end(true)
        if (this.onerror) this.onerror('notconnected')
      }

      prevDisconnected = !connected
    })
  }

  async start() {
    this._started = true

    const roomRef = this.roomRef = database.ref('rooms').child(this.roomId)
    const myPeerRef = this.myPeerRef = roomRef.child('peers').child(this.userId)
    const usersRef = this.usersRef = database.ref('users').child(this.roomId)
    const userRef = this.userRef = usersRef.child(this.userId)

    const roomSnap = await roomRef.once('value')
    if (!roomSnap.exists()) {
      if (!this.onroomcreate || !(await this.onroomcreate())) return
      this._joined = true
    }

    const userSnap = await myPeerRef.once('value')
    if (userSnap.exists()) {
      if (this.onerror) this.onerror('nametaken')
      return
    }

    await userRef.onDisconnect().remove()
    userRef.set({ active: true })

    await this.join()
    if (this._joined && this.onready) this.onready()
  }

  async join() {
    const peersSnap = await this.roomRef.child('peers').once('value')
    if (peersSnap.exists()) {
      let peerIds = Object.keys(peersSnap.val())
      const peerNames = peerIds.map(id => decodeURIComponent(atob(id)))
      if (!this.onroomjoin || !(await this.onroomjoin(peerNames))) return
      this._joined = true

      const snapNow = await this.roomRef.child('peers').once('value')
      peerIds = Object.keys(snapNow.val())
      peerIds.forEach(this.makeSignalingConnection.bind(this))
    }

    await this.myPeerRef.onDisconnect().remove()
    await this.myPeerRef.set(true)

    this.watchIncomingConnections()
    this.watchRoomPeers()
  }

  sendData(peerId, data) {
    const userRef = this.usersRef.child(peerId)
    return userRef.child(this.userId).set(data)
  }

  async makeSignalingConnection(peerId) {
    const peerName = decodeURIComponent(atob(peerId))

    const rtc = new RTCPeerConnection(FirebaseSignaling.iceConfig)
    const channel = rtc.createDataChannel('signaling')

    this._peers[peerName] = {
      connection: rtc,
      channel: channel
    }

    this.setUpPeerSignalingConnection(rtc, peerName)
    this.setUpSignalingChannel(channel, peerName)
    channel.onopen = () => {
      this.connectWithPeer(peerName)
    }

    const offer = await rtc.createOffer()
    await rtc.setLocalDescription(offer)
    await getAllIceCandidates(rtc)

    this.sendData(peerId, {
      data: rtc.localDescription.sdp,
      type: 'offer'
    })
  }

  watchIncomingConnections() {
    this.userRef.on('child_added', async snap => {
      await this.userRef.child(snap.key).remove()
      if (snap.key === 'active') return

      const peerId = snap.key
      const message = snap.val()
      if (!message.type || !message.data) return

      const peerName = decodeURIComponent(atob(peerId))

      if (message.type === 'offer') {
        const rtc = new RTCPeerConnection(FirebaseSignaling.iceConfig)
        this.setUpPeerSignalingConnection(rtc, peerName)
        rtc.ondatachannel = e => {
          this.setUpSignalingChannel(e.channel, peerName)
          this._peers[peerName] = {
            connection: rtc,
            channel: e.channel
          }
        }

        await rtc.setRemoteDescription({
          sdp: message.data,
          type: 'offer'
        })
        const answer = await rtc.createAnswer()
        await rtc.setLocalDescription(answer)
        await getAllIceCandidates(rtc)

        this.sendData(peerId, {
          data: rtc.localDescription.sdp,
          type: 'answer'
        })
      } else if (message.type === 'answer') {
        const rtc = this._peers[peerName].connection
        rtc.setRemoteDescription({
          sdp: message.data,
          type: "answer"
        })
      }
    })
  }

  watchRoomPeers() {
    this.roomRef.child('peers').on('child_removed', snap => {
      const peerName = decodeURIComponent(atob(snap.key))
      if (this.onpeerdisconnnect) this.onpeerdisconnnect(peerName)

      this._peers[peerName].connection.close()
      delete this._peers[peerName]

      this.peers[peerName].close()
      delete this.peers[peerName]
    })
  }

  async connectWithPeer(peerName) {
    if (!this.buildpeer) return
    const rtc = this.buildpeer(peerName, false)
    this.peers[peerName] = rtc

    const offer = await rtc.createOffer()
    await rtc.setLocalDescription(offer)
    await getAllIceCandidates(rtc)

    const channel = this._peers[peerName].channel
    channel.send(JSON.stringify({
      data: rtc.localDescription.sdp,
      type: 'offer'
    }))
  }

  /**
   * @param { RTCPeerConnection } rtc
   */
  setUpPeerSignalingConnection(rtc, peerName) {
    let restartingIce = false
    rtc.onconnectionstatechange = async () => {
      if (rtc.connectionState === 'failed' && peerName > this.name) {
        restartingIce = true

        const offer = await rtc.createOffer({ iceRestart: true })
        await rtc.setLocalDescription(offer)
        await getAllIceCandidates(rtc)

        const peerId = btoa(encodeURIComponent(peerName))
        this.sendData(peerId, {
          data: rtc.localDescription.sdp,
          type: 'offer'
        })
      } else if (restartingIce && rtc.connectionState === 'connected') {
        const peer = this.peers[peerName]
        const offer = await peer.createOffer({ iceRestart: true })
        await peer.setLocalDescription(offer)
        await getAllIceCandidates(peer)

        const channel = this._peers[peerName].channel
        channel.send(JSON.stringify({
          data: peer.localDescription.sdp,
          type: 'offer'
        }))
      }
    }
  }

  /**
   * @param { RTCDataChannel } channel
   * @param { string } peerName
   */
  setUpSignalingChannel(channel, peerName) {
    channel.onmessage = async e => {
      let message = e.data
      try { message = JSON.parse(message) }
      catch { return console.error('Enable to parse message', message) }

      if (!message.data || !message.type) return
      
      if (message.type === 'offer') {
        const rtc = this.buildpeer(peerName, true)
        this.peers[peerName] = rtc

        await rtc.setRemoteDescription({
          sdp: message.data,
          type: 'offer'
        })
        const answer = await rtc.createAnswer()
        await rtc.setLocalDescription(answer)
        await getAllIceCandidates(rtc)

        channel.send(JSON.stringify({
          data: rtc.localDescription.sdp,
          type: 'answer'
        }))
      } else if (message.type === 'answer') {
        const rtc = this.peers[peerName]
        await rtc.setRemoteDescription({
          sdp: message.data,
          type: 'answer'
        })
      }
    }
  }

  async end(internal) {
    if (!this._joined) return

    this.userRef.off()
    this.roomRef.child('peers').off()
    
    this.myPeerRef.onDisconnect().cancel()
    this.userRef.onDisconnect().cancel()

    this.userRef.remove()
    this.myPeerRef.remove()

    for (const peerName in this._peers) {
      this._peers[peerName].connection.close()
      if (this.peers[peerName]) this.peers[peerName].close()
    }

    this._peers = { }
    this.peers = { }

    if (!internal) database.ref('.info/connected').off()
  }
}
FirebaseSignaling.iceConfig = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
}