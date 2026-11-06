// Records the 3D view straight from the canvas into one WebM video. While recording, every two
// seconds of video are sent to the local server (serve.py appends them to ai-fly/recordings/), so
// nothing has to be stitched together afterwards and a crash still leaves a usable file. Without the
// local server, the video is offered as a download when the recording stops.
export class Recorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.rec = null;
    this.chunks = [];
    this.upload = Promise.resolve(true);
  }

  get active() { return !!this.rec; }

  start(name = `cubicles-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`) {
    if (this.rec) return;
    const type = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    this.name = name;
    this.part = 0;
    this.serverOk = true;
    this.chunks = [];
    this.startedAt = performance.now();
    // 24 frames per second and a bitrate that depends on the picture size keep the encoder from
    // falling behind (a backlog of raw frames can run a browser out of memory)
    const stream = this.canvas.captureStream(24);
    const bits = Math.round(Math.min(12e6, (this.canvas.width * this.canvas.height * 24) / 5));
    this.rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bits });
    // each piece is kept only until the server has it (if the server fails, everything from then on
    // is kept for a download at the end)
    this.rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      this.chunks.push(e.data);
      const part = this.part++;
      this.upload = this.upload.then(async (ok) => {
        if (!ok) return false;
        try {
          const r = await fetch(`/recording/${this.name}?part=${part}`, { method: 'POST', body: e.data });
          if (r.ok) this.chunks.shift();
          return r.ok;
        } catch { return false; }
      });
    };
    this.rec.start(2000);
    fetch(`/ping?recording=${name}`).catch(() => {});
  }

  // stops, waits for the last piece, and says where the video went
  async stop() {
    if (!this.rec) return null;
    const rec = this.rec;
    this.rec = null;
    await new Promise((resolve) => { rec.onstop = resolve; rec.stop(); });
    rec.stream.getTracks().forEach((t) => t.stop());
    const ok = await this.upload;
    const seconds = (performance.now() - this.startedAt) / 1000;
    if (ok) {
      await fetch(`/recording/${this.name}?done=1`, { method: 'POST', body: '' }).catch(() => {});
      return { where: `ai-fly/recordings/${this.name}.webm`, seconds };
    }
    // no local server: hand the file to the browser instead
    const blob = new Blob(this.chunks, { type: 'video/webm' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${this.name}.webm` });
    document.body.appendChild(a); a.click(); a.remove();
    return { where: `your downloads (${this.name}.webm)`, seconds };
  }
}

// Frame-by-frame recording for unattended videos: every drawn frame becomes exactly one video frame,
// 1/30 s apart, however long it took to draw (the office clock moves on by the same 1/30 s). The
// browser's own video encoder (WebCodecs) compresses the frames and webm-muxer (MIT licence) packs
// them into a WebM file, which goes to the local server piece by piece like the recorder above.
// If the encoder falls behind, the page waits for it instead of piling frames up in memory.
export class FrameRecorder {
  static get supported() { return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'; }

  constructor(canvas, fps = 30) {
    this.canvas = canvas;
    this.fps = fps;
    this.encoder = null;
    this.upload = Promise.resolve(true);
  }

  get active() { return !!this.encoder; }
  get busy() { return !!this.encoder && this.encoder.encodeQueueSize > 2; }

  async start(name = `cubicles-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`) {
    if (this.encoder) return;
    const { Muxer, StreamTarget } = await import('webm-muxer');
    const width = this.canvas.width & ~1, height = this.canvas.height & ~1;
    const bitrate = Math.round(Math.min(16e6, (width * height * this.fps) / 4));
    let config = null;
    for (const codec of ['vp8', 'vp09.00.10.08']) {
      const c = { codec, width, height, bitrate, framerate: this.fps };
      if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; }
    }
    if (!config) throw new Error('this browser cannot encode video frames');
    this.name = name;
    this.part = 0;
    this.frame = 0;
    this.muxer = new Muxer({
      target: new StreamTarget({ onData: (data, position) => this.send(data.slice(), position), chunked: true, chunkSize: 2 ** 20 }),
      video: { codec: config.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width, height, frameRate: this.fps },
      type: 'webm', streaming: true, firstTimestampBehavior: 'offset',
    });
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error('video encoder:', e),
    });
    this.encoder.configure(config);
    fetch(`/ping?recording=${name}&codec=${config.codec}&size=${width}x${height}`).catch(() => {});
  }

  // call right after drawing a frame
  capture() {
    if (!this.encoder) return;
    const us = 1e6 / this.fps;
    const frame = new VideoFrame(this.canvas, { timestamp: Math.round(this.frame * us), duration: Math.round(us) });
    this.encoder.encode(frame, { keyFrame: this.frame % (this.fps * 2) === 0 });
    frame.close();
    this.frame++;
  }

  // each piece says where in the file it belongs (in streaming mode that is always the end)
  send(data, position) {
    const part = this.part++;
    this.upload = this.upload.then(async (ok) => {
      if (!ok) return false;
      try { return (await fetch(`/recording/${this.name}?part=${part}&at=${position}`, { method: 'POST', body: data })).ok; } catch { return false; }
    });
  }

  async stop() {
    if (!this.encoder) return null;
    const enc = this.encoder;
    this.encoder = null;
    await enc.flush();
    enc.close();
    this.muxer.finalize();
    const ok = await this.upload;
    if (ok) await fetch(`/recording/${this.name}?done=1`, { method: 'POST', body: '' }).catch(() => {});
    return { where: ok ? `ai-fly/recordings/${this.name}.webm` : 'nowhere (the local server did not answer)', seconds: this.frame / this.fps };
  }
}
