var groupModalDoneHandler
var usedGroupNames = []

Vue.component('groups-modal-body', {
  props: ['groups', 'peers'],
  data: function() {
    groupModalDoneHandler = this.done
    return {
      newGroupName: '',
      updatedGroups: []
    }
  },
  methods: {
    createGroup: function() {
      if (this.invalidGroupName) return

      const groupData = {
        name: this.newGroupName,
        safeId: encodeSafeId(this.newGroupName),
        members: this.peers.map((peer) => {
          return {
            name: peer.name,
            isMember: false,
            safeId: peer.safeId
          }
        }),
        shared: false,
        owner: true
      }
      const groupIndex = this.groups.length
      this.groups.push(groupData)
      this.$watch(() => this.groups[groupIndex], (newVal, oldVal) => {
        if (!this.updatedGroups.includes(groupIndex)) this.updatedGroups.push(groupIndex)
      }, { deep: true })
      this.newGroupName = ''

      this.$nextTick(() => $('#collapse-group-' + groupData.safeId).collapse('show'))
    },
    done: function() {
      this.updatedGroups.forEach(groupIndex => {
        const group = this.groups[groupIndex]
        if (group.shared) {
          let groupData = {
            name: group.name,
            members: { },
            owner: app.userId
          }
          group.members.forEach(peer => groupData.members[peer.name] = peer.isMember)
          group.members.forEach(peer => {
            const channel = peerConnections[peer.name].channel
            if (peer.isMember) channel.send(JSON.stringify({ group: groupData }))
            else channel.send(JSON.stringify({ group: { name: group.name, removed: true }}))
          })
        } else {
          group.members.forEach(peer => {
            const channel = peerConnections[peer.name].channel
            channel.send(JSON.stringify({ group: { name: group.name, removed: true }}))
          })
        }
      })
      this.updatedGroups = []
    }
  },
  computed: {
    invalidGroupName: function() {
      const name = this.newGroupName.toLowerCase()
      return (
        name.length < 3 ||
        forbiddenNames.includes(name) ||
        this.groups.some(group => group.name.toLowerCase() === name) ||
        usedGroupNames.some(groupName => groupName.toLowerCase() === name) ||
        this.peers.some(peer => peer.name.toLowerCase() === name)
      )
    }
  }
})