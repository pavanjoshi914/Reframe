// MediaRecorder-emitted WebM files don't have a finalized Duration in the EBML
// header. As a result HTMLVideoElement.duration is `Infinity`, and seeking past
// the implicit end (or playing past it) breaks. The classic workaround:
// seek to an absurd timestamp once. The decoder scans the whole file, learns the
// true duration, then we jump back to 0. After that, .duration is finite and
// seeking/playback are reliable.
export function primeVideo(v: HTMLVideoElement, expectedDurationMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (isFinite(v.duration) && v.duration > 0.1) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('durationchange', onDurChange);
      v.removeEventListener('error', onErr);
      try { v.currentTime = 0; } catch { /* ignore */ }
      resolve();
    };
    const onSeeked = () => {
      if (isFinite(v.duration) && v.duration > 0.1) finish();
    };
    const onDurChange = () => {
      if (isFinite(v.duration) && v.duration > 0.1) finish();
    };
    const onErr = () => finish();
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('durationchange', onDurChange);
    v.addEventListener('error', onErr);
    try {
      // Either form works; the addition is to be safe if the file genuinely is huge.
      v.currentTime = Math.max(1e6, expectedDurationMs / 1000 + 1e6);
    } catch { /* ignore */ }
    // Hard timeout — never block forever.
    setTimeout(finish, 1500);
  });
}
