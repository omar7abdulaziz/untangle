'use strict';

/* ============================================================
   Untangle — tiny synthesized sound effects (Web Audio API only,
   no audio files, no libraries). Every entry point is guarded so
   a browser without Web Audio support just plays silently.
   ============================================================ */

const SoundManager = (function () {
  let ctx = null;
  let masterGain = null;
  let muted = typeof getMutedPref === 'function' ? getMutedPref() : false;

  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 1;
      masterGain.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  /** Browsers require a user gesture before audio can play; call once. */
  function unlock() {
    const c = ensureContext();
    if (c && c.state === 'suspended') {
      c.resume().catch(() => {});
    }
  }

  ['pointerdown', 'keydown'].forEach((evt) => {
    document.addEventListener(evt, unlock, { once: true, passive: true });
  });

  function tone(time, freq, duration, type, peakGain) {
    if (!ctx || muted) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(peakGain, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(time);
      osc.stop(time + duration + 0.03);
    } catch (e) {
      /* a single dropped sound effect is not worth surfacing */
    }
  }

  function playSlide() {
    const c = ensureContext();
    if (!c || muted) return;
    const now = c.currentTime;
    tone(now, 720, 0.09, 'sine', 0.15);
    tone(now + 0.035, 1020, 0.08, 'sine', 0.09);
  }

  function playBlocked() {
    const c = ensureContext();
    if (!c || muted) return;
    const now = c.currentTime;
    tone(now, 170, 0.15, 'triangle', 0.13);
  }

  function playWin() {
    const c = ensureContext();
    if (!c || muted) return;
    const now = c.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      tone(now + i * 0.11, freq, 0.24, 'sine', 0.13);
    });
  }

  function isMuted() {
    return muted;
  }

  function setMuted(next) {
    muted = next;
    if (masterGain) masterGain.gain.value = muted ? 0 : 1;
    if (typeof setMutedPref === 'function') setMutedPref(muted);
  }

  function toggleMuted() {
    setMuted(!muted);
    return muted;
  }

  return { playSlide, playBlocked, playWin, isMuted, toggleMuted, unlock };
})();
