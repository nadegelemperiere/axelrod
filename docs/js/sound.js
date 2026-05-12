// Spaceship door whoosh, played on sidebar navigation.
// Drop the audio file at docs/sounds/door.mp3 (path is relative to the HTML page).

const SOUND_URL = "sounds/door.mp3";
const VOLUME = 0.6;

let audioEl = null;

function getAudio() {
  if (!audioEl) {
    audioEl = new Audio(SOUND_URL);
    audioEl.preload = "auto";
    audioEl.volume = VOLUME;
  }
  return audioEl;
}

export function playDoorOpen() {
  try {
    const a = getAudio();
    // Rewind so repeated clicks re-trigger from the start.
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* autoplay blocked or file missing — silent fail */ });
  } catch (e) {
    console.warn("playDoorOpen failed", e);
  }
}
