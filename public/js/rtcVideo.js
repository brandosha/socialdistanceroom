Vue.component('rtc-video', {
  props: ['peer'],
  computed: {
    id: function() { return encodeForId(this.peer.name) }
  },
  template: $('rtc-video-template').html()
})
$('rtc-video-template').remove()