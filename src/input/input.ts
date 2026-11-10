/** Pointer-locked mouse aim + keyboard. Produces one InputFrame per fixed sim step. */
import { config } from '../core/config';
import { emptyInput, type InputFrame } from '../sim/types';

export class Input {
  private readonly keys = new Set<string>();
  private dx = 0;
  private dy = 0;
  mouseDown = false;
  private wheel = 0;
  /** Tests/smoke can drive the game by overriding fields here (merged over live input). */
  external: Partial<InputFrame> | null = null;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('click', () => {
      if (document.pointerLockElement !== el) void el.requestPointerLock?.();
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== el) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    window.addEventListener('mousedown', (e) => e.button === 0 && (this.mouseDown = true));
    window.addEventListener('mouseup', (e) => e.button === 0 && (this.mouseDown = false));
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      },
      { passive: false },
    );
  }

  get locked(): boolean {
    return document.pointerLockElement === this.el;
  }

  /** Accumulated wheel deltaY since the last call (pixels; + = away from the user). */
  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Build the input for a sim step. Mouse delta goes entirely to the first step of a frame. */
  sample(firstStepOfFrame: boolean): InputFrame {
    const f = emptyInput();
    if (firstStepOfFrame) {
      const s = config.flight.mouseSens;
      f.aimDYaw = -this.dx * s;
      f.aimDPitch = -this.dy * s;
      this.dx = 0;
      this.dy = 0;
    }
    f.throttle = this.keys.has('KeyW');
    f.brake = this.keys.has('KeyS');
    f.left = this.keys.has('KeyA');
    f.right = this.keys.has('KeyD');
    f.boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    f.missile = this.keys.has('KeyE');
    f.fire = this.mouseDown;
    if (this.external) Object.assign(f, this.external);
    return f;
  }
}
