import { h, icon } from './dom';
import { hideTooltip, showTooltip } from './tooltip';

export interface PlayerOptions {
  count: number;
  dwell: (index: number) => number;
  onStep: (index: number, previous: number) => void;
  tick?: (index: number) => string | undefined;
  label?: (index: number) => string;
  speeds?: number[];
}

export class Player {
  readonly el: HTMLElement;
  index = 0;
  playing = false;
  private timer = 0;
  private speed = 1;
  private readonly playBtn: HTMLButtonElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly fill: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly counter: HTMLElement;

  constructor(private readonly opts: PlayerOptions) {
    const button = (cls: string, label: string, name: Parameters<typeof icon>[0], onclick: () => void) =>
      h('button', { class: `t-btn ${cls}`, type: 'button', 'aria-label': label, title: label, onclick }, icon(name));

    this.playBtn = button('play', '再生', 'play', () => this.toggle());
    this.prevBtn = button('', '前へ', 'prev', () => this.step(-1));
    this.nextBtn = button('', '次へ', 'next', () => this.step(1));
    const restart = button('', '最初から', 'restart', () => {
      this.pause();
      this.seek(0);
    });

    this.fill = h('div', { class: 't-fill' });
    this.knob = h('div', { class: 't-knob' });
    const rail = h('div', { class: 't-rail' }, this.fill);
    const track = h(
      'div',
      {
        class: 't-track',
        role: 'slider',
        tabindex: 0,
        'aria-label': 'ステップ',
        'aria-valuemin': 1,
        'aria-valuemax': opts.count,
      },
      rail,
    );

    if (opts.tick) {
      for (let i = 0; i < opts.count; i++) {
        const cls = opts.tick(i);
        if (!cls) continue;
        track.append(h('span', { class: `t-tick ${cls}`, style: `left:${this.ratio(i) * 100}%` }));
      }
    }
    track.append(this.knob);

    if (opts.label) {
      const label = opts.label;
      track.addEventListener('pointermove', (event) => {
        const rect = track.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const i = Math.round(ratio * (opts.count - 1));
        showTooltip(rect.left + this.ratio(i) * rect.width, rect.top, h('div', {}, label(i)), h('div', { class: 'tt-dim' }, `${i + 1} / ${opts.count}`));
      });
      track.addEventListener('pointerleave', hideTooltip);
    }

    const seekFromPointer = (event: PointerEvent) => {
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      this.seek(Math.round(ratio * (opts.count - 1)));
    };
    track.addEventListener('pointerdown', (event) => {
      track.setPointerCapture(event.pointerId);
      this.pause();
      seekFromPointer(event);
      const move = (e: PointerEvent) => seekFromPointer(e);
      const up = () => {
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
    });

    this.counter = h('div', { class: 't-count' });

    const children: Node[] = [
      h('div', { class: 't-buttons' }, restart, this.prevBtn, this.playBtn, this.nextBtn),
      track,
      this.counter,
    ];

    if (opts.speeds && opts.speeds.length > 1) {
      const speeds = opts.speeds;
      const speedBtn = h('button', { class: 't-speed', type: 'button', title: '速度' }, '1×');
      speedBtn.addEventListener('click', () => {
        const next = speeds[(speeds.indexOf(this.speed) + 1) % speeds.length];
        this.speed = next;
        speedBtn.textContent = `${next}×`;
        if (this.playing) this.schedule();
      });
      children.push(speedBtn);
    }

    this.el = h('div', { class: 'transport' }, children);
    this.render();
  }

  bindKeys(target: HTMLElement): void {
    target.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.step(-1);
      } else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        this.toggle();
      }
    });
  }

  private ratio(i: number): number {
    return this.opts.count <= 1 ? 1 : i / (this.opts.count - 1);
  }

  seek(index: number): void {
    const next = Math.max(0, Math.min(this.opts.count - 1, index));
    const previous = this.index;
    this.index = next;
    this.render();
    this.opts.onStep(next, previous);
    if (this.playing) this.schedule();
  }

  step(delta: number): void {
    this.pause();
    this.seek(this.index + delta);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (this.index >= this.opts.count - 1) this.seek(0);
    this.playing = true;
    this.render();
    this.schedule();
  }

  pause(): void {
    this.playing = false;
    window.clearTimeout(this.timer);
    this.render();
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.playing) return;
      if (this.index >= this.opts.count - 1) {
        this.pause();
        return;
      }
      this.seek(this.index + 1);
      if (this.index >= this.opts.count - 1) this.pause();
    }, this.opts.dwell(this.index) / this.speed);
  }

  private render(): void {
    const pct = `${this.ratio(this.index) * 100}%`;
    this.fill.style.width = pct;
    this.knob.style.left = pct;
    this.counter.textContent = `${this.index + 1} / ${this.opts.count}`;
    this.prevBtn.disabled = this.index === 0;
    this.nextBtn.disabled = this.index >= this.opts.count - 1;
    this.playBtn.replaceChildren(icon(this.playing ? 'pause' : 'play'));
    this.playBtn.setAttribute('aria-label', this.playing ? '一時停止' : '再生');
    this.playBtn.title = this.playing ? '一時停止' : '再生';
    this.el?.querySelector('.t-track')?.setAttribute('aria-valuenow', String(this.index + 1));
  }
}
