// Protocol ng detector (tingnan ang metalplan.md section 4).
// ASCII text, bawat linya nagtatapos sa "\n".

export const TH_MIN = 2;
export const TH_MAX = 60;
export const NZONE = 4;

// Index ng zone = bit ng mask
export const ZONE_NAMES = ['L-UP', 'R-UP', 'L-LOW', 'R-LOW'] as const;
export const ZONE_LABELS = ['Kaliwa, taas', 'Kanan, taas', 'Kaliwa, baba', 'Kanan, baba'] as const;

export type StatusLine = {
  kind: 'S';
  enabled: boolean;
  threshold: number;
  calibrating: boolean;
  detectedMask: number;
  zoneMask: number;
};

export type ZoneLine = {
  kind: 'Z';
  zone: number;
  diff: number;
  zoneThreshold: number;
};

export type Message = StatusLine | ZoneLine;

function toInts(parts: string[]): number[] | null {
  const nums = parts.map((p) => Number(p.trim()));
  return nums.every((n) => Number.isInteger(n)) ? nums : null;
}

// Ibinabalik ang null kapag hindi kilala o sira ang linya (huwag pansinin).
export function parseLine(raw: string): Message | null {
  const line = raw.trim();
  const parts = line.split(',');

  if (parts[0] === 'S' && parts.length === 6) {
    const n = toInts(parts.slice(1));
    if (!n) return null;
    const [enabled, threshold, calibrating, detectedMask, zoneMask] = n;
    if (enabled > 1 || calibrating > 1 || enabled < 0 || calibrating < 0) return null;
    if (detectedMask < 0 || detectedMask > 15 || zoneMask < 0 || zoneMask > 15) return null;
    return {
      kind: 'S',
      enabled: enabled === 1,
      threshold,
      calibrating: calibrating === 1,
      detectedMask,
      zoneMask,
    };
  }

  if (parts[0] === 'Z' && parts.length === 4) {
    const n = toInts(parts.slice(1));
    if (!n) return null;
    const [zone, diff, zoneThreshold] = n;
    if (zone < 0 || zone >= NZONE) return null;
    return { kind: 'Z', zone, diff, zoneThreshold };
  }

  return null;
}

// Mga command papunta sa Arduino
export const cmd = {
  status: () => '#S\n',
  enable: (on: boolean) => (on ? '#E1\n' : '#E0\n'),
  threshold: (n: number) => `#T${clampThreshold(n)}\n`,
  recalibrate: () => '#R\n',
};

export function clampThreshold(n: number): number {
  return Math.min(TH_MAX, Math.max(TH_MIN, Math.round(n)));
}

// Slider: 0..58, threshold = 60 - slider
export const SLIDER_MAX = TH_MAX - TH_MIN;
export const sliderToThreshold = (s: number) => clampThreshold(TH_MAX - s);
export const thresholdToSlider = (t: number) => TH_MAX - clampThreshold(t);
export const sliderPercent = (s: number) => Math.round((s / SLIDER_MAX) * 100);

// Pinagdudugtong ang mga piraso ng text (hal. 20 bytes bawat BLE notification)
// at naglalabas ng buong linya kapag may "\n".
export class LineBuffer {
  private buf = '';
  private readonly onLine: (line: string) => void;
  private readonly maxLength: number;

  constructor(onLine: (line: string) => void, maxLength = 256) {
    this.onLine = onLine;
    this.maxLength = maxLength;
  }

  push(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      if (line.length > 0) this.onLine(line);
    }
    // Proteksyon: kung walang "\n" nang matagal (ingay), itapon na
    if (this.buf.length > this.maxLength) this.buf = '';
  }

  reset(): void {
    this.buf = '';
  }
}
