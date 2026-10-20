// AudioWorklet: batches mono input frames into fixed-size chunks.
// The AudioContext runs at 16 kHz, so Chromium resamples the device for us.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = (options && options.processorOptions && options.processorOptions.chunk) || 1600;
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const ch0 = input[0];
      const ch1 = input[1];
      for (let i = 0; i < ch0.length; i++) {
        this.buf[this.n++] = ch1 ? 0.5 * (ch0[i] + ch1[i]) : ch0[i];
        if (this.n === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
