class FirestoreSignaling {
  /**
   * @param { string } name
   * @param { string } room
   */
  constructor(name, room) {
    this.room = room
    this.name = name

    this.roomId = sha1(room)
    this.userId = btoa(name)

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
    this.onpeercreate
    /** @type { () => void } */
    this.ondisconnect

    /** @type { Object<string, RTCPeerConnection> } */
    this.peers = { }

    /** @type { boolean } */
    this.owner = false
  }

  async start() {
    this.roomDoc = firestore.collection('rooms').doc(this.roomId)
    const roomSnap = await this.roomDoc.get()
    if (roomSnap.exists) {
      const data = roomSnap.data()
      if (data.owner === this.name) {
        if (this.onerror) this.onerror('nametaken')
        return
      } else {
        this.roomData = data
        await this.joinRoom() 
      }
    } else {
      if (!this.onroomcreate || !this.onroomcreate()) return
      await this.createRoom()
    }

    await this.watchPresence()
    if (this.onready) this.onready()
  }

  async createRoom() {
    this.owner = true
    this.roomData = { owner: this.name }
    await this.roomDoc.set(this.roomData)
    this.listenForNewPeers()
  }

  async listenForNewPeers() {
    if (!this.owner) return

    /** @type { Object<string, RTCPeerConnection> } */
    this.connections = { }
    
    /**
     * @typedef SignalingPeer
     * @property { RTCPeerConnection } connection
     * @property { RTCDataChannel } channel
     */
    /** @type { Object<string, SignalingPeer> } */
    this._peers = { }

    this._cancelPeerListener = this.roomDoc.collection('peers').onSnapshot(query => {
      query.forEach(async snap => {
        const data = snap.data()
        if (data.offer) {
          const peerName = atob(snap.id)
          if (this._peers[peerName]) {
            snap.ref.set({
              name_taken: true
            })
            return
          }
          const rtc = new RTCPeerConnection(FirestoreSignaling.iceConfig)
          
          rtc.ondatachannel = e => {
            e.channel.onopen = () => {
              Object.keys(this._peers).forEach(id => {
                this._peers[id].channel.send(JSON.stringify({
                  new_peer: peerName
                }))
              })
              this.setUpSignalingChannel(e.channel, peerName)
              e.channel.send(JSON.stringify({
                new_peer: this.name
              }))
  
              this._peers[peerName] = {
                connection: rtc,
                channel: e.channel
              }
            }
          }

          let prevConnectionState
          rtc.onconnectionstatechange = e => {
            const state = rtc.connectionState
            console.log('connection state', peerName, state, prevConnectionState)

            if (state === 'failed') {
              if (prevConnectionState === 'connecting') {
                delete this._peers[peerName]
                snap.ref.delete()
              } else if (prevConnectionState === 'disconnected') {
                this._peers[peerName].connection.close()
                delete this._peers[peerName]
              }
            }
            prevConnectionState = state
          }

          await rtc.setRemoteDescription({
            sdp: data.offer,
            type: 'offer'
          })
          const answer = await rtc.createAnswer()
          await rtc.setLocalDescription(answer)
          await getAllIceCandidates(rtc)
          snap.ref.set({ answer: rtc.localDescription.sdp })
        } else {
          snap.ref.delete()
        }
      })
    })
  }

  async watchPresence() {
    const roomRef = database.ref('rooms/' + this.roomId)
    this._presenceRoomRef = roomRef
    database.ref('.info/connected').once('value', snap => {
      if (snap.val() === false && this.onerror) {
        this.onerror('notconnected')
        return
      }

      if (this.owner) {
        roomRef.onDisconnect().remove().then(() => roomRef.set(true))
      } else {
        roomRef.on('value', snap => {
          if (snap.val() === null) {
            roomRef.off()
            if (this.ondisconnect) this.ondisconnect()
          }
        })
      }
    })
  }

  async joinRoom() {
    const rtc = new RTCPeerConnection(FirestoreSignaling.iceConfig)
    const channel = rtc.createDataChannel('signaling')
    this.setUpSignalingChannel(channel)

    this._peer = {
      connection: rtc,
      channel: channel
    }

    let prevConnectionState
    rtc.onconnectionstatechange = async e => {
      const state = rtc.connectionState
      console.log('connection state', state, prevConnectionState)
      if (state === 'failed' && prevConnectionState === 'disconnected') {
        this._peer.connection.close
        this._peer = null
      }
      prevConnectionState = state
    } 

    const offer = await rtc.createOffer()
    await rtc.setLocalDescription(offer)
    await getAllIceCandidates(rtc)

    const offerDoc = this.roomDoc.collection('peers').doc(this.userId)
    const snap = await offerDoc.get()
    if (snap.exists) {
      this._peer = null
      if (this.onerror) this.onerror('nametaken')
    } else {
      await offerDoc.set({ offer: rtc.localDescription.sdp })
      const cancelListener = offerDoc.onSnapshot(snap => {
        const data = snap.data()
        if (data.answer) {
          rtc.setRemoteDescription({
            sdp: data.answer,
            type: 'answer'
          })

          cancelListener()
          snap.ref.delete()
        } else if (data.name_taken) {
          this._peer = null
          if (this.onerror) this.onerror('nametaken')
        }
      })
    }
  }

  /**
   * @param { RTCDataChannel } channel
   * @param { string } id
   */
  setUpSignalingChannel(channel, id) {
    channel.onmessage = async e => {
      let data = e.data
      try { data = JSON.parse(e.data) }
      catch {
        console.error('Unable to parse signaling message', data)
        return
      }

      if (!this.onpeercreate) return

      if (this.owner) {
        if (data.payload && data.peer_id) {
          if (data.peer_id === this.name) {
            this.handleSignal(data.payload, id, response => {
              this._peers[id].channel.send(JSON.stringify({
                payload: response,
                peer_id: this.name
              }))
            })
          } else if (this._peers[data.peer_id]) {
            this._peers[data.peer_id].channel.send(JSON.stringify({
              payload: data.payload,
              peer_id: id
            }))
          }
        }
      } else {
        if (data.new_peer) {
          const peerId = data.new_peer
          const rtc = this.onpeercreate(peerId, false)
          this.peers[peerId] = rtc
  
          const offer = await rtc.createOffer()
          await rtc.setLocalDescription(offer)
          await getAllIceCandidates(rtc)
          channel.send(JSON.stringify({
            payload: {
              offer: rtc.localDescription.sdp
            },
            peer_id: peerId
          }))
        } else if (data.payload && data.peer_id) {
          this.handleSignal(data.payload, data.peer_id, response => {
            this._peer.channel.send(JSON.stringify({
              payload: response,
              peer_id: data.peer_id
            }))
          })
        }
      }
    }
  }

  /**
   * @param { string } peerId 
   * @param { (response: any) => void } respond
   */
  async handleSignal(payload, peerId, respond) {
    if (!this.onpeercreate) return

    if (payload.offer) {
      const rtc = this.onpeercreate(peerId, true)
      this.peers[peerId] = rtc

      rtc.setRemoteDescription({
        sdp: payload.offer,
        type: 'offer'
      })
      const answer = await rtc.createAnswer()
      await rtc.setLocalDescription(answer)
      await getAllIceCandidates(rtc)

      respond({ answer: rtc.localDescription.sdp })
    } else if (payload.answer) {
      this.peers[peerId].setRemoteDescription({
        sdp: payload.answer,
        type: 'answer'
      })
    }
  }

  async end() {
    if (this.owner) {
      this._cancelPeerListener()
      await this._presenceRoomRef.onDisconnect().cancel()
      await this._presenceRoomRef.remove()
      Object.keys(this._peers).forEach(id => {
        this._peers[id].connection.close()
        delete this._peers[id]
      })
    } else {
      this._presenceRoomRef.off()
      this._peer.connection.close()
    }
  }
}
FirestoreSignaling.iceConfig = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
}