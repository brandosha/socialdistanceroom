Vue.component('rtc-video', {
  props: ['peer'],
  computed: {
    id: function() { return encodeSafeId(this.peer.name) }
  },
  template: $('rtc-video-template').html()
})
$('rtc-video-template').remove()