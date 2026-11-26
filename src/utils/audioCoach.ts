class AudioCoach {
  private audioCtx: AudioContext | null = null;
  private lastSpokenAt = 0;
  private lastSpokenMessage = '';

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        this.audioCtx = new Ctx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  playRepChime() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc2.frequency.setValueAtTime(880.0, now + 0.08); // A5

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.14);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.28);
    } catch {
      // Audio playback blocked or unavailable
    }
  }

  speakCue(text: string, minCooldownMs = 4200) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const now = Date.now();
    if (now - this.lastSpokenAt < minCooldownMs) return;
    if (text === this.lastSpokenMessage && now - this.lastSpokenAt < 8000) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.06;
      utterance.pitch = 1.0;
      utterance.volume = 0.85;
      window.speechSynthesis.speak(utterance);
      this.lastSpokenAt = now;
      this.lastSpokenMessage = text;
    } catch {
      // Speech synthesis unavailable
    }
  }

  stopSpeech() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}

export const audioCoach = new AudioCoach();
