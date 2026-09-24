/**
 * Forced interactive tutorial engine (GDD §4). Dims the screen, cuts a
 * spotlight around a target, shows an animated hand performing a gesture and
 * a caption, and blocks every pointer event that lands outside the target —
 * events inside the target are forwarded to whatever is underneath (a button
 * or the WebGL canvas), so gameplay itself completes the step via `until`.
 */

import { icon } from './icons';

export interface ScreenCircle {
  x: number;
  y: number;
  r: number;
}

export type TutorialGesture = 'tap' | 'drag' | 'swipe' | 'none';

export interface TutorialStep {
  /** Short instruction shown in the caption bubble. */
  caption: string;
  /** A DOM element to spotlight, or a function returning a screen-space circle, re-evaluated every frame (for targets on the rotating 3D globe). Returning null hides the spotlight ring but keeps input blocked outside the last known circle. */
  target: HTMLElement | (() => ScreenCircle | null);
  gesture: TutorialGesture;
  /** Resolves when the game has registered the required action; ends the step. */
  until: Promise<void>;
}

const FORWARD_PADDING = 6; // px of extra forgiveness around the computed circle

export class Tutorial {
  private readonly root: HTMLElement;
  private layer: HTMLElement | null = null;
  private maskHole!: SVGCircleElement;
  private ring!: SVGCircleElement;
  private ringEcho!: SVGCircleElement;
  private captionEl!: HTMLElement;
  private handEl!: HTMLElement;
  private blocker!: HTMLElement;
  private rafId = 0;
  private currentCircle: ScreenCircle | null = null;
  private forwarding = false;
  private onResize = () => this.layoutStatic();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /**
   * Force-ends whatever `run()` call is in progress right now: unmounts the
   * overlay immediately, regardless of which step's `until` is still
   * pending. Used by the integration layer when a real game outcome (e.g.
   * a win/lose reached through a tap forwarded mid-tutorial) makes the
   * tutorial moot. The in-flight `run()` promise itself is left pending
   * (its `until` may never resolve) — callers that call `stop()` must not
   * keep awaiting that `run()` call afterwards.
   */
  stop(): void {
    this.unmount();
  }

  /** Runs all steps in order; resolves once the last step's `until` resolves. */
  async run(steps: TutorialStep[]): Promise<void> {
    this.mount();
    try {
      for (const step of steps) {
        await this.runStep(step);
      }
    } finally {
      this.unmount();
    }
  }

  private mount(): void {
    const layer = document.createElement('div');
    layer.className = 'wb-tutorial-layer';
    layer.innerHTML = `
      <svg class="wb-tutorial-mask" aria-hidden="true">
        <defs>
          <mask id="wb-tut-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="#fff"></rect>
            <circle data-hole cx="-100" cy="-100" r="0" fill="#000"></circle>
          </mask>
        </defs>
        <rect data-dim x="0" y="0" width="100%" height="100%" class="wb-tutorial-dim" mask="url(#wb-tut-mask)"></rect>
        <circle data-ring-echo cx="-100" cy="-100" r="0" class="wb-tutorial-ring-echo"></circle>
        <circle data-ring cx="-100" cy="-100" r="0" class="wb-tutorial-ring"></circle>
      </svg>
      <div class="wb-tutorial-blocker" data-blocker></div>
      <div class="wb-tutorial-caption wb-glass" data-caption></div>
      <div class="wb-tutorial-hand" data-hand>${icon('hand')}</div>
    `;
    this.root.appendChild(layer);
    this.layer = layer;
    this.maskHole = layer.querySelector('[data-hole]') as unknown as SVGCircleElement;
    this.ring = layer.querySelector('[data-ring]') as unknown as SVGCircleElement;
    this.ringEcho = layer.querySelector('[data-ring-echo]') as unknown as SVGCircleElement;
    this.captionEl = layer.querySelector('[data-caption]') as HTMLElement;
    this.handEl = layer.querySelector('[data-hand]') as HTMLElement;
    this.blocker = layer.querySelector('[data-blocker]') as HTMLElement;

    this.blocker.addEventListener('pointerdown', this.handlePointerDown, true);
    this.blocker.addEventListener('pointermove', this.handlePointerMove, true);
    this.blocker.addEventListener('pointerup', this.handlePointerUp, true);
    this.blocker.addEventListener('click', this.handleClick, true);
    window.addEventListener('resize', this.onResize);
  }

  private unmount(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.layer?.remove();
    this.layer = null;
  }

  private layoutStatic(): void {
    // Mask/ring geometry is recomputed every frame in the rAF loop; nothing static to redo here.
  }

  private async runStep(step: TutorialStep): Promise<void> {
    this.captionEl.textContent = step.caption;
    this.handEl.className = `wb-tutorial-hand wb-gesture-${step.gesture}`;
    this.handEl.style.display = step.gesture === 'none' ? 'none' : '';

    const loop = () => {
      const circle = typeof step.target === 'function' ? step.target() : this.rectToCircle(step.target.getBoundingClientRect());
      if (circle) {
        this.currentCircle = circle;
        this.applyCircle(circle, step.gesture);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    loop();

    try {
      await step.until;
    } finally {
      cancelAnimationFrame(this.rafId);
    }
  }

  private rectToCircle(rect: DOMRect): ScreenCircle {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      r: Math.max(rect.width, rect.height) / 2 + 6,
    };
  }

  private applyCircle(c: ScreenCircle, gesture: TutorialGesture): void {
    this.maskHole.setAttribute('cx', String(c.x));
    this.maskHole.setAttribute('cy', String(c.y));
    this.maskHole.setAttribute('r', String(c.r));
    this.ring.setAttribute('cx', String(c.x));
    this.ring.setAttribute('cy', String(c.y));
    this.ring.setAttribute('r', String(c.r));
    this.ringEcho.setAttribute('cx', String(c.x));
    this.ringEcho.setAttribute('cy', String(c.y));
    this.ringEcho.setAttribute('r', String(c.r));

    // For a tap, anchor the hand so only its fingertip grazes the target's
    // lower-right edge — the target itself must stay fully visible under the
    // spotlight. Drag/swipe cross the whole target area, so those keep the
    // hand centered on it (matching their sweeping keyframe animations).
    if (gesture === 'tap') {
      const k = Math.SQRT1_2; // cos/sin(45deg)
      this.handEl.style.left = `${c.x + c.r * k}px`;
      this.handEl.style.top = `${c.y + c.r * k}px`;
    } else {
      this.handEl.style.left = `${c.x}px`;
      this.handEl.style.top = `${c.y}px`;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const capH = this.captionEl.offsetHeight || 70;
    const margin = 12;
    const below = c.y + c.r + 18 + capH + margin < vh;
    let capY = below ? c.y + c.r + 18 : c.y - c.r - 18;
    if (below) {
      capY = Math.min(capY, vh - capH - margin);
    } else {
      capY = Math.max(capY, capH + margin);
    }
    this.captionEl.style.top = `${capY}px`;
    this.captionEl.style.left = `${Math.min(Math.max(c.x, 150), vw - 150)}px`;
    this.captionEl.style.transform = below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
  }

  private isInsideTarget(x: number, y: number): boolean {
    if (!this.currentCircle) return false;
    const dx = x - this.currentCircle.x;
    const dy = y - this.currentCircle.y;
    return Math.sqrt(dx * dx + dy * dy) <= this.currentCircle.r + FORWARD_PADDING;
  }

  /** Finds the real element under a point by briefly hiding the blocker, then forwards a cloned event to it. */
  private forward(ev: PointerEvent | MouseEvent, type: string): void {
    this.blocker.style.pointerEvents = 'none';
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    this.blocker.style.pointerEvents = '';
    if (!el) return;
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: ev.clientX,
      clientY: ev.clientY,
      pointerId: (ev as PointerEvent).pointerId ?? 1,
      pointerType: (ev as PointerEvent).pointerType ?? 'touch',
      isPrimary: true,
    };
    el.dispatchEvent(new PointerEvent(type, init));
    if (type === 'pointerdown') {
      // Buttons commonly listen for click rather than pointerdown.
      el.dispatchEvent(new MouseEvent('mousedown', init));
    }
    if (type === 'pointerup') {
      el.dispatchEvent(new MouseEvent('mouseup', init));
    }
  }

  private handlePointerDown = (ev: PointerEvent): void => {
    if (this.isInsideTarget(ev.clientX, ev.clientY)) {
      this.forwarding = true;
      this.forward(ev, 'pointerdown');
    } else {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  private handlePointerMove = (ev: PointerEvent): void => {
    if (this.forwarding) {
      this.forward(ev, 'pointermove');
    } else {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  private handlePointerUp = (ev: PointerEvent): void => {
    if (this.forwarding) {
      this.forward(ev, 'pointerup');
      this.forwarding = false;
    } else {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  private handleClick = (ev: MouseEvent): void => {
    if (this.isInsideTarget(ev.clientX, ev.clientY)) {
      this.blocker.style.pointerEvents = 'none';
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      this.blocker.style.pointerEvents = '';
      el?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: ev.clientX, clientY: ev.clientY }),
      );
    } else {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };
}
