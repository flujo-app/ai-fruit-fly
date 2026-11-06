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
