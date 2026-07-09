// AudioWorklet to capture raw PCM from microphone
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel = input[0];
      // Convert Float32 [-1.0, 1.0] to Int16
      const int16Buffer = new Int16Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        let s = Math.max(-1, Math.min(1, channel[i]));
        int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      // Send raw Int16 bytes back to main thread
      this.port.postMessage(int16Buffer.buffer, [int16Buffer.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
