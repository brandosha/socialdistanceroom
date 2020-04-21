Vue.component('join-modal-body', {
  props: ['room', 'peers'],
  data: function() { console.log(this.room, this.peers) }
})