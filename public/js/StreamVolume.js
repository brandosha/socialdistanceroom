class StreamVolume {
  /**
   * @param { MediaStream } stream 
   */
  constructor(stream) {
    let audioContext = new AudioContext()
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.minDecibels = -90
    analyser.maxDecibels = -10
    analyser.smoothingTimeConstant = 0.3

    this.source = audioContext.createMediaStreamSource(stream)
    this.analyser = analyser
    this.source.connect(analyser)

    const bufferLength = analyser.frequencyBinCount
    this.dataArr = new Uint8Array(bufferLength)
  }

  getVolume() {
    this.analyser.getByteFrequencyData(this.dataArr)
    return this.dataArr.slice(10).reduce((prev, curr) => curr + prev, 0)
  }
}