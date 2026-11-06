// Recording for the main page (?rec=1): exactly one time through the song, picture and sound.
//
// The picture is what the viewer sees, drawn every frame into a canvas of the screen's shape (in AR: the camera
// image and the 3D layer on top, cropped the same way the page crops them); the sound is the song itself, taken
// from the <audio> element through Web Audio (it keeps playing through the speakers as well). Recording starts the
// song from the beginning with looping off, and stops when it ends, so the video is exactly one loop of the show.
// MediaRecorder writes MP4 where the browser can (Safari, recent Chrome), else WebM.

// H.264 + AAC in MP4 first (plays everywhere, phones' galleries included), then WebM; a bare 'video/mp4' last, since
// browsers without H.264 put VP9 in it
const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a',
  'video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

// audio: the song's <audio> element, or null (no sound); length: the song's length in seconds (the fallback timer
// when there is no sound); onState({ recording, remaining, file }) reports progress and, at the end, the file.
export function createRecorder({ audio, length, onState }) {
  const supported = typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  const type = supported ? TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '' : '';
  const out = document.createElement('canvas'), g = out.getContext('2d');
  let ctx = null, dest = null, rec = null, chunks = [], t0 = 0, timer = 0, recording = false, useClock = false;

  // the song through Web Audio, once (an element can only be wired up once, and then only sounds through the graph)
  function wireAudio() {
    if (!audio || ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(audio);
    dest = ctx.createMediaStreamDestination();
    src.connect(ctx.destination); src.connect(dest);
  }

  function size() {   // the screen's shape, at up to 2 pixels per CSS pixel, the long side at most 1920, even sizes
    const dpr = Math.min(devicePixelRatio || 1, 2), w = innerWidth * dpr, h = innerHeight * dpr, k = Math.min(1, 1920 / Math.max(w, h));
    return [Math.round(w * k / 2) * 2, Math.round(h * k / 2) * 2];
  }

  async function start() {
    if (recording || !supported) return;
    // everything up to play() happens within the tap (iOS only lets sound start there)
    const withSound = !!(audio && !audio.error);
    wireAudio();
    if (ctx) ctx.resume();
    recording = true;
    if (withSound) {
      audio.loop = false;
      audio.currentTime = 0;
      audio.addEventListener('ended', finish, { once: true });
    }
    const playing = withSound ? audio.play() : null;
    [out.width, out.height] = size();
    g.fillStyle = '#000'; g.fillRect(0, 0, out.width, out.height);
    const stream = out.captureStream(30);
    if (dest && withSound) dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: 8e6, audioBitsPerSecond: 160e3 });
    chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const mime = (rec.mimeType || type || 'video/webm').split(';')[0];
      const blob = new Blob(chunks, { type: mime });
      const d = new Date(), p = n => String(n).padStart(2, '0');
      const name = `sakura-qr-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
        (mime === 'video/mp4' ? '.mp4' : '.webm');
      onState({ recording: false, remaining: 0, file: new File([blob], name, { type: mime }) });
    };
    rec.start(1000);
    t0 = performance.now();
    useClock = !withSound;
    // the song's end stops it; the clock too, a little later, in case the song stalls or can't play after all
    timer = setTimeout(finish, (length + (withSound ? 5 : 0)) * 1000);
    if (playing) await playing.catch(() => { useClock = true; clearTimeout(timer); timer = setTimeout(finish, length * 1000); });
    onState({ recording: true, remaining: length });
  }

  function finish() {
    if (!recording) return;
    recording = false;
    clearTimeout(timer);
    if (audio) {
      audio.removeEventListener('ended', finish);
      audio.loop = true;
      if (audio.paused) audio.play().catch(() => {});   // back to looping for the viewer
    }
    if (rec && rec.state !== 'inactive') rec.stop();
  }

  // each frame, right after the page has drawn: draw(g, w, h) paints the view into the recording
  function frame(draw) {
    if (!recording) return;
    draw(g, out.width, out.height);
    const played = useClock ? (performance.now() - t0) / 1000 : audio.currentTime;
    onState({ recording: true, remaining: Math.max(0, length - played) });
  }

  return { supported, type, start, stop: finish, frame, get recording() { return recording; } };
}
