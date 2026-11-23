import { toggleMute, unlockAudio } from './audio';

/** Shows the `#start` overlay until the player taps PLAY or presses a key, then calls `onStart` once. */
export function waitForStart(onStart: () => void): void {
  const overlay = document.getElementById('start');
  if (!overlay) {
    onStart();
    return;
  }
  if (new URLSearchParams(location.search).has('autostart')) {
    overlay.hidden = true;
    onStart();
    return;
  }
  let started = false;
  const go = (event?: Event) => {
    if (started) return;
    if (event instanceof KeyboardEvent && (event.key === 'Tab' || event.altKey || event.ctrlKey || event.metaKey)) return;
    started = true;
    unlockAudio();
    overlay.classList.add('hide');
    setTimeout(() => (overlay.hidden = true), 500);
    window.removeEventListener('keydown', go);
    onStart();
  };
  overlay.querySelector('#play')?.addEventListener('click', go, { once: true });
  window.addEventListener('keydown', go);
}

/** Wires the `#mute` HUD button. */
export function bindMute(): void {
  const button = document.getElementById('mute');
  if (!button) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    button.textContent = toggleMute() ? '🔇' : '🔊';
  });
}

/** Keyboard + on-screen button state tracker shared by every game. */
export function createInput<K extends string>(ids: readonly K[], keymap: Record<string, K>): Record<K, boolean> {
  const held = Object.fromEntries(ids.map((id) => [id, false])) as Record<K, boolean>;
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const set = (value: boolean) => (event: Event) => {
      event.preventDefault();
      held[id] = value;
      el.classList.toggle('active', value);
    };
    el.addEventListener('pointerdown', set(true));
    for (const name of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(name, set(false));
  }
  window.addEventListener('keydown', (event) => {
    const key = keymap[event.key];
    if (key) {
      event.preventDefault();
      held[key] = true;
    }
  });
  window.addEventListener('keyup', (event) => {
    const key = keymap[event.key];
    if (key) {
      event.preventDefault();
      held[key] = false;
    }
  });
  window.addEventListener('blur', () => {
    for (const id of ids) held[id] = false;
  });
  return held;
}

export function hearts(count: number, max: number): string {
  return '❤️'.repeat(Math.max(0, count)) + '🖤'.repeat(Math.max(0, max - count));
}

export function setBar(id: string, fraction: number): void {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
}

export function pulse(el: HTMLElement): void {
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}
