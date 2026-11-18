// Pekeng detector para masubukan ang app kahit wala pang HM-10.
// Sumusunod sa parehong protocol ng firmware v6.3, kaya walang hiwalay na logic sa UI.
import { LineBuffer, NZONE, TH_MAX, TH_MIN } from './protocol';
import { Emitter, type LinkState, type Transport } from './transport';

const TICK_MS = 50;
const CALIBRATE_MS = 4000;
const CONFIRM = 2;
const RELEASE = 2;
const RELEASE_RATIO = 0.6;
const NOISE_MARGIN = 5;
const MAX_PACKET = 20; // gaya ng BLE: hanggang 20 bytes bawat notification

type FakeMetal = { zone: number; start: number; duration: number; amp: number };

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class DemoTransport implements Transport {
  private readonly lines = new Emitter<string>();
  private readonly states = new Emitter<LinkState>();
  // Dinadaan sa LineBuffer ang output, para pareho sa totoong BLE
  private readonly out = new LineBuffer((line) => this.lines.emit(line));

  private linked = false;
  private silent = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private linkTimer: ReturnType<typeof setTimeout> | null = null;

  // Estado ng pekeng detector (tuloy-tuloy kahit maputol ang link, gaya ng totoo)
  private enabled = true;
  private threshold = 12;
  private calibrating = false;
  private readonly zoneMask = 0b1111;
  private readonly noise = [1.1, 0.9, 1.3, 1.0];
  private readonly diff = new Array<number>(NZONE).fill(0);
  private readonly zoneTh = new Array<number>(NZONE).fill(12);
  private readonly detected = new Array<boolean>(NZONE).fill(false);
  private readonly hit = new Array<number>(NZONE).fill(0);
  private readonly low = new Array<number>(NZONE).fill(0);
  private metal: FakeMetal | null = null;
  private nextMetalAt = Date.now() + rand(3000, 5000);
  private lastMask = 0;
  private lastStatusMs = 0;
  private lastZoneMs = 0;
  private zoneCursor = 0;
  private pending: string[] = [];

  constructor() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  onLine(listener: (line: string) => void): void {
    this.lines.add(listener);
  }

  onLinkState(listener: (state: LinkState) => void): void {
    this.states.add(listener);
  }

  async connect(): Promise<void> {
    this.clearLinkTimer();
    this.states.emit('connecting');
    this.linkTimer = setTimeout(() => this.finishConnect(), 700);
  }

  async disconnect(): Promise<void> {
    this.clearLinkTimer();
    this.linked = false;
    this.states.emit('idle');
  }

  // Tuluyang patayin ang demo (paglabas sa demo mode)
  destroy(): void {
    this.clearLinkTimer();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.linked = false;
  }

  async send(command: string): Promise<void> {
    if (!this.linked) throw new Error('Hindi connected');
    if (this.silent) return; // sirang wiring: walang naririnig ang Arduino
    // Parang hardware Serial: hanapin ang "#...\n"
    for (const part of command.split('#').slice(1)) {
      const c = part.replace(/[\r\n]+$/, '');
      if (c.length === 0) continue;
      if (this.calibrating) this.pending.push(c);
      else setTimeout(() => this.handleCommand(c), 30);
    }
  }

  // ---- Mga pang-test na estado (para sa demo panel) ----

  // Kunwaring naputol ang Bluetooth. recover = makakonekta ulit pagkatapos.
  simulateDrop(recover: boolean): void {
    if (!this.linked) return;
    this.clearLinkTimer();
    this.linked = false;
    this.states.emit('reconnecting');
    // Gaya ng ble.ts: 1 s, 2 s, 4 s na pagitan
    this.linkTimer = recover
      ? setTimeout(() => this.finishConnect(), 3000)
      : setTimeout(() => this.states.emit('failed'), 7000);
  }

  // Kunwaring sira ang wiring ng module: connected pero walang S line
  setSilent(silent: boolean): void {
    this.silent = silent;
    if (!silent && this.linked) this.sendStatus();
  }

  isSilent(): boolean {
    return this.silent;
  }

  // ---- Loob ng pekeng detector ----

  private finishConnect(): void {
    this.linkTimer = null;
    this.linked = true;
    this.states.emit('connected');
    // Gaya ng ble.ts na nagpapadala ng "#S" pagkakonekta
    void this.send('#S\n');
  }

  private clearLinkTimer(): void {
    if (this.linkTimer) clearTimeout(this.linkTimer);
    this.linkTimer = null;
  }

  private handleCommand(c: string): void {
    switch (c[0]) {
      case 'E':
        if (c[1] === '0' && this.enabled) this.enterStandby();
        else if (c[1] === '1' && !this.enabled) {
          this.enabled = true;
          this.calibrate();
          return;
        }
        break;
      case 'T': {
        const v = Number.parseInt(c.slice(1), 10);
        if (v >= TH_MIN && v <= TH_MAX) this.threshold = v;
        break;
      }
      case 'R':
        this.calibrate();
        return;
    }
    this.sendStatus();
  }

  private enterStandby(): void {
    this.enabled = false;
    this.resetZones();
    this.metal = null;
  }

  private resetZones(): void {
    for (let z = 0; z < NZONE; z++) {
      this.detected[z] = false;
      this.hit[z] = 0;
      this.low[z] = 0;
      this.diff[z] = 0;
    }
  }

  // Habang nagka-calibrate, "nakaharang" ang firmware: walang S o Z na linya.
  private calibrate(): void {
    this.calibrating = true;
    this.resetZones();
    this.metal = null;
    this.sendStatus();
    setTimeout(() => {
      this.calibrating = false;
      this.nextMetalAt = Date.now() + rand(3000, 5000);
      this.sendStatus(); // dulo ng calibrate()
      this.sendStatus(); // sendStatus() pagkatapos ng command
      const queued = this.pending;
      this.pending = [];
      for (const c of queued) this.handleCommand(c);
    }, CALIBRATE_MS);
  }

  private tick(): void {
    if (this.calibrating) return;
    const now = Date.now();
    if (this.enabled) this.measure(now);
    this.report(now);
  }

  private measure(now: number): void {
    if (!this.metal && now >= this.nextMetalAt) {
      this.metal = {
        zone: Math.floor(Math.random() * NZONE),
        start: now,
        duration: rand(1200, 2000),
        amp: rand(14, 70),
      };
    }

    let signal = new Array<number>(NZONE).fill(0);
    if (this.metal) {
      const t = (now - this.metal.start) / this.metal.duration;
      if (t >= 1) {
        this.metal = null;
        this.nextMetalAt = now + rand(6000, 10000);
      } else {
        const strength = Math.sin(Math.PI * t) ** 2 * this.metal.amp;
        const z = this.metal.zone;
        const sameSide = z ^ 0b10; // taas <-> baba sa parehong gilid
        signal = signal.map((_, i) => (i === z ? strength : i === sameSide ? strength * 0.35 : 0));
      }
    }

    for (let z = 0; z < NZONE; z++) {
      const d = -signal[z] + rand(-1, 1) * this.noise[z] * 1.5;
      const absD = Math.abs(d);
      this.diff[z] = d;
      const th = Math.min(TH_MAX, Math.max(this.threshold, this.noise[z] * NOISE_MARGIN));
      this.zoneTh[z] = th;

      if (!this.detected[z]) {
        this.hit[z] = absD > th ? this.hit[z] + 1 : 0;
        this.detected[z] = this.hit[z] >= CONFIRM;
        this.low[z] = 0;
      } else if (absD < th * RELEASE_RATIO) {
        if (++this.low[z] >= RELEASE) {
          this.detected[z] = false;
          this.hit[z] = 0;
        }
      } else {
        this.low[z] = 0;
      }
    }
  }

  private detectedMask(): number {
    let mask = 0;
    for (let z = 0; z < NZONE; z++) if (this.detected[z]) mask |= 1 << z;
    return mask & this.zoneMask;
  }

  private report(now: number): void {
    const mask = this.detectedMask();
    if (mask !== this.lastMask || now - this.lastStatusMs >= 500) {
      this.lastMask = mask;
      this.sendStatus();
    }
    if (this.enabled && now - this.lastZoneMs >= 150) {
      this.lastZoneMs = now;
      this.sendNextZone();
    }
  }

  private sendStatus(): void {
    this.lastStatusMs = Date.now();
    this.emitLine(
      `S,${this.enabled ? 1 : 0},${this.threshold},${this.calibrating ? 1 : 0},${this.detectedMask()},${this.zoneMask}`,
    );
  }

  private sendNextZone(): void {
    for (let i = 0; i < NZONE; i++) {
      this.zoneCursor = (this.zoneCursor + 1) % NZONE;
      if (!(this.zoneMask & (1 << this.zoneCursor))) continue;
      const z = this.zoneCursor;
      this.emitLine(`Z,${z},${Math.trunc(this.diff[z])},${Math.trunc(this.zoneTh[z])}`);
      return;
    }
  }

  // Hinahati sa random na piraso (1–20 bytes) para masubukan ang line buffer
  private emitLine(line: string): void {
    if (!this.linked || this.silent) return;
    let text = `${line}\r\n`; // println ng Arduino = "\r\n"
    while (text.length > 0) {
      const size = Math.min(text.length, 1 + Math.floor(Math.random() * MAX_PACKET));
      this.out.push(text.slice(0, size));
      text = text.slice(size);
    }
  }
}
