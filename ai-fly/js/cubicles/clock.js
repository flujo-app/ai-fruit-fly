// One clock for everything that moves in the office (camera, confetti, typing, messages, waits).
// Normally it is the real time. While an autopilot video is recorded frame by frame, it moves on by
// exactly one video frame per drawn frame instead, so the video is smooth no matter how long each
// frame took to draw. (Only the flies' training keeps running in real time.)
export const clock = {
  fixed: 0,   // > 0: milliseconds per drawn frame; 0: real time
  t: 0,
  now() { return this.fixed ? this.t : performance.now(); },
  tick() { if (this.fixed) this.t += this.fixed; },
  useFrames(fps) { this.t = performance.now(); this.fixed = 1000 / fps; },
};

// wait for this much clock time
export function wait(ms) {
  const end = clock.now() + ms;
  return new Promise((resolve) => {
    const check = () => (clock.now() >= end ? resolve() : setTimeout(check, 8));
    check();
  });
}
