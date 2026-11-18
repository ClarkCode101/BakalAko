import type { StatusLine } from './protocol';
import type { LinkState } from './transport';

// ok = may Web Bluetooth; ios = iPhone/iPad na walang Web Bluetooth (Safari); other = ibang browser
export type Support = 'ok' | 'ios' | 'other';

export type ZoneReading = { diff: number; zoneThreshold: number };

export type AppState = {
  support: Support;
  demo: boolean;
  link: LinkState;
  status: StatusLine | null;
  lastStatusAt: number;
  noResponse: boolean;
  zones: (ZoneReading | null)[];
};

export type Phase =
  | 'unsupported-ios'
  | 'unsupported'
  | 'idle'
  | 'connecting'
  | 'watching'
  | 'metal'
  | 'calibrating'
  | 'standby'
  | 'reconnecting'
  | 'failed'
  | 'no-response';

// Kapag walang S line nang ganito katagal, may problema ang wiring ng module
export const NO_RESPONSE_MS = 3000;
// Habang nagka-calibrate, nakaharang ang firmware nang ~7 s kaya walang S line
export const NO_RESPONSE_CALIBRATING_MS = 15000;

export function getPhase(s: AppState): Phase {
  if (!s.demo && s.support !== 'ok') return s.support === 'ios' ? 'unsupported-ios' : 'unsupported';
  switch (s.link) {
    case 'idle':
      return 'idle';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'failed':
      return 'failed';
  }
  if (s.noResponse) return 'no-response';
  if (!s.status) return 'connecting'; // connected na pero hinihintay pa ang unang S line
  if (s.status.calibrating) return 'calibrating';
  if (!s.status.enabled) return 'standby';
  if (s.status.detectedMask & s.status.zoneMask) return 'metal';
  return 'watching';
}

export type Controls = { power: boolean; restart: boolean; slider: boolean };

export function controlsFor(phase: Phase): Controls {
  if (phase === 'watching' || phase === 'metal') return { power: true, restart: true, slider: true };
  if (phase === 'standby') return { power: true, restart: false, slider: false };
  return { power: false, restart: false, slider: false };
}

export function initialState(support: Support, demo: boolean): AppState {
  return {
    support,
    demo,
    link: 'idle',
    status: null,
    lastStatusAt: 0,
    noResponse: false,
    zones: [null, null, null, null],
  };
}

// Simpleng store: get, set, at listener na tinatawag tuwing may pagbabago
export function createStore(initial: AppState) {
  let state = initial;
  const listeners: ((s: AppState) => void)[] = [];
  return {
    get: () => state,
    set(patch: Partial<AppState>) {
      state = { ...state, ...patch };
      for (const l of listeners) l(state);
    },
    subscribe(listener: (s: AppState) => void) {
      listeners.push(listener);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
