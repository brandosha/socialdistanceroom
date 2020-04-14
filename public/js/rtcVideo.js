Vue.component('rtc-video', {
  props: ['peer'],
  data: function() {
    return {
      id: encodeForId(this.peer.name)
    }
  },
  template: $('rtc-video-template').html()
})
$('rtc-video-template').remove()