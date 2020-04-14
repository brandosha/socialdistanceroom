Vue.component('rtc-video', {
  props: ['peer'],
  data: function() {
    return {
      id: encodeForId(this.peer.name)
    }
  },
  template: $('rtc-video-template').html(),
  created: function() {
    console.log(this.peer)
  },
})
$('rtc-video-template').remove()