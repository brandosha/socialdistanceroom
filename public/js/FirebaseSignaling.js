class FirebaseSignaling {
  /**
   * @param { string } name
   * @param { string } room
   */
  constructor(name, room) {
    this.room = room
    this.name = name

    this.roomId = sha1(room.toLowerCase())
    this.userId = btoa(encodeURIComponent(name))

    /** @typedef { 'nametaken' | 'notconnected' } ConnectionError */
    /** @type { (error: ConnectionError) => void } */
    this.onerror
    /** @type { () => void } */
    this.onready
    /**
     * @callback RoomCreateCallback
     * @returns { boolean } cancel
     */
    /** @type { RoomCreateCallback | boolean } */
    this.onroomcreate = false
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
    /** @type { () => void } */
    this.ondisconnect

    /** @type { Object<string, RTCPeerConnection> } */
    this.peers = { }
    
    /**
     * @typedef SignalingPeer
     * @property { RTCPeerConnection } connection
     * @property { RTCDataChannel } channel
     */
    /** @type { Object<string, SignalingPeer> } */
    this._peers = { }

    /** @type { boolean } */
    this.owner = false
  }

  async start() {
    /*this.roomDoc = firestore.collection('rooms').doc(this.roomId)
    const roomSnap = await this.roomDoc.get()
    if (roomSnap.exists) {
      const data = roomSnap.data()
      if (data.owner === this.name) {
        if (this.onerror) this.onerror('nametaken')
        return
      } else {
        this.roomData = data
        // await this.joinRoom() 
      }
    } else {
      if (!this.onroomcreate || !this.onroomcreate()) return
      this.owner = true
      // await this.createRoom()
    }*/

    const roomRef = this.roomRef = database.ref('rooms').child(this.roomId)
    const myPeerRef = this.myPeerRef = roomRef.child('peers').child(this.userId)
    const usersRef = this.usersRef = database.ref('users').child(this.roomId)
    const userRef = this.userRef = usersRef.child(this.userId)

    const roomSnap = await roomRef.once('value')
    if (!roomSnap.exists()) {
      if (!this.onroomcreate || !this.onroomcreate()) return
    }

    const userSnap = await myPeerRef.once('value')
    if (userSnap.exists()) {
      if (this.onerror) this.onerror('nametaken')
      return
    }

    await userRef.onDisconnect().remove()
    userRef.set({ active: true })

    await this.join()
    if (this.onready) this.onready()
  }

  async join() {
    const peersSnap = await this.roomRef.child('peers').once('value')
    if (peersSnap.exists()) {
      const peerIds = Object.keys(peersSnap.val())
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

  /**
   * @param { RTCPeerConnection } rtc 
   */
  async setUpPeerConnection(rtc) {
    rtc.onicegatheringstatechange = console.log
  }

  async makeSignalingConnection(peerId) {
    const peerName = decodeURIComponent(atob(peerId))

    const rtc = new RTCPeerConnection(FirebaseSignaling.iceConfig)
    const channel = rtc.createDataChannel('signaling')

    this._peers[peerName] = {
      connection: rtc,
      channel: channel
    }

    this.setUpPeerConnection(rtc)
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
        this.setUpPeerConnection(rtc)
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
      console.log(peerName + ' disconnected')

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
   * @param { RTCDataChannel } channel
   * @param { string } peerName
   */
  setUpSignalingChannel(channel, peerName) {
    channel.onmessage = async e => {
      let message = e.data
      try { message = JSON.parse(message) }
      catch { return console.error('Enable to parse message', message) }

      if (!message.data || !message.type) return
      console.log(peerName, message.type, message.data)
      
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

  async end() {
    this.userRef.off()
    this.roomRef.child('peers').off()
    this.myPeerRef.onDisconnect().cancel()

    this.userRef.remove()
    this.myPeerRef.remove()

    for (const peerName in this._peers) {
      console.log(peerName)
      this._peers[peerName].connection.close()
      if (this.peers[peerName]) this.peers[peerName].close()
    }

    this._peers = { }
    this.peers = { }
  }
}
FirebaseSignaling.iceConfig = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
}