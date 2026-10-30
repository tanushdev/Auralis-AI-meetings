/**
 * PCM capture worklet: resamples the device stream to 16 kHz mono and posts
 * Int16 buffers of ~200 ms to the main thread.
 */
class PCM16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate;
    this.position = 0;
    this.chunkSamples = 3200;
    this.intBuffer = new Int16Array(this.chunkSamples);
    this.intIndex = 0;
    this.carry = 0;
  }

  pushSample(value) {
    const clamped = Math.max(-1, Math.min(1, value));
    this.intBuffer[this.intIndex] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    this.intIndex += 1;
    if (this.intIndex >= this.chunkSamples) {
      const copy = this.intBuffer.slice(0, this.intIndex);
      this.port.postMessage(copy.buffer, [copy.buffer]);
      this.intIndex = 0;
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;

    let position = this.carry;
    while (position < channel.length) {
      const index = Math.floor(position);
      const nextIndex = Math.min(index + 1, channel.length - 1);
      const fraction = position - index;
      const sample = channel[index] * (1 - fraction) + channel[nextIndex] * fraction;
      this.pushSample(sample);
      position += this.ratio;
    }
    this.carry = position - channel.length;
    return true;
  }
}

registerProcessor("pcm16-capture", PCM16Capture);
