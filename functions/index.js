const functions = require('firebase-functions');
const admin = require('firebase-admin')
admin.initializeApp()

const firestore = admin.firestore()

exports.watchPresence = functions.database.ref('rooms/{roomId}').onDelete(async (snapshot, context) => {
  const roomId = snapshot.key
  
  const roomDoc = firestore.collection('rooms').doc(roomId)
  const peerCollection = roomDoc.collection('peers')
  const peerIds = await peerCollection.listDocuments()
  peerIds.forEach(id => {
    peerCollection.doc(id).delete()
  })
  roomDoc.delete()
})