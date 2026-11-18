// Simula ng app: pinagdudugtong ang transport (BLE o demo), state, at UI.
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import './style.css';

import { registerSW } from 'virtual:pwa-register';
import { BleTransport, hasWebBluetooth } from './ble';
import { DemoTransport } from './demo';
import { cmd, parseLine, sliderToThreshold } from './protocol';
import {
  NO_RESPONSE_CALIBRATING_MS,
  NO_RESPONSE_MS,
  createStore,
  initialState,
  type Support,
} from './state';
import type { LinkState, Transport } from './transport';
import { createUI } from './ui';

registerSW({ immediate: true });

const SLIDER_SEND_EVERY_MS = 150;
const SLIDER_HOLD_MS = 600;

const params = new URLSearchParams(location.search);

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // Ang iPad ay nagpapanggap na Mac, kaya i-check din ang touch
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function detectSupport(): Support {
  // Pang-test sa desktop: ?nobt=ios o ?nobt=other
  const override = params.get('nobt');
  if (override === 'ios' || override === 'other') return override;
  if (hasWebBluetooth()) return 'ok';
  return isIOS() ? 'ios' : 'other';
}

const store = createStore(initialState(detectSupport(), params.get('demo') === '1'));
const emptyZones = () => [null, null, null, null];

// ---- Transport ----
let transport: Transport | null = null;

function useTransport(t: Transport): void {
  transport = t;
  // Huwag pansinin ang events galing sa lumang transport
  t.onLine((line) => transport === t && handleLine(line));
  t.onLinkState((link) => transport === t && handleLink(link));
}

function handleLink(link: LinkState): void {
  if (link === 'connecting') {
    store.set({ link, status: null, noResponse: false, zones: emptyZones() });
  } else if (link === 'connected') {
    store.set({ link, lastStatusAt: Date.now(), noResponse: false });
  } else {
    store.set({ link, noResponse: false, zones: emptyZones() });
  }
}

function handleLine(line: string): void {
  const msg = parseLine(line);
  if (!msg) return; // hindi kilalang linya: huwag pansinin
  const s = store.get();
  if (msg.kind === 'S') {
    const quiet = !msg.enabled || msg.calibrating;
    store.set({
      status: msg,
      lastStatusAt: Date.now(),
      noResponse: false,
      zones: quiet ? emptyZones() : s.zones,
    });
  } else {
    const zones = s.zones.slice();
    zones[msg.zone] = { diff: msg.diff, zoneThreshold: msg.zoneThreshold };
    store.set({ zones });
  }
}

function send(command: string): void {
  transport?.send(command).catch(() => {
    /* naka-log na sa transport */
  });
}

function getTransport(): Transport {
  if (transport) return transport;
  const t = store.get().demo ? new DemoTransport() : new BleTransport();
  useTransport(t);
  return t;
}

function setDemoParam(on: boolean): void {
  const url = new URL(location.href);
  if (on) url.searchParams.set('demo', '1');
  else url.searchParams.delete('demo');
  history.replaceState(null, '', url);
}

// Kapag walang S line nang matagal: may problema sa wiring
setInterval(() => {
  const s = store.get();
  if (s.link !== 'connected' || s.noResponse) return;
  const limit = s.status?.calibrating ? NO_RESPONSE_CALIBRATING_MS : NO_RESPONSE_MS;
  if (Date.now() - s.lastStatusAt > limit) store.set({ noResponse: true });
}, 250);

// ---- Sensitivity slider ----
// Ipadala nang hindi hihigit sa isa bawat 150 ms habang ginagalaw,
// laging ipadala ang huling value pagbitaw, at huwag sundin ang device
// habang ginagalaw at 600 ms pagkatapos.
let dragging = false;
let holdUntil = 0;
let lastSentAt = 0;
let lastSentThreshold = -1;
let trailing: ReturnType<typeof setTimeout> | null = null;

function sendThreshold(slider: number, force = false): void {
  const th = sliderToThreshold(slider);
  lastSentAt = Date.now();
  if (th === lastSentThreshold && !force) return;
  lastSentThreshold = th;
  send(cmd.threshold(th));
}

function clearTrailing(): void {
  if (trailing) clearTimeout(trailing);
  trailing = null;
}

// ---- UI ----
const ui = createUI({
  connect() {
    void getTransport().connect();
  },
  retry() {
    const t = getTransport();
    void t.disconnect().finally(() => t.connect());
  },
  startDemo() {
    if (transport && !(transport instanceof DemoTransport)) void transport.disconnect();
    transport = null;
    store.set({ demo: true });
    setDemoParam(true);
    void getTransport().connect();
  },
  exitDemo() {
    if (transport instanceof DemoTransport) transport.destroy();
    transport = null;
    setDemoParam(false);
    store.set({ demo: false, link: 'idle', status: null, noResponse: false, zones: emptyZones() });
  },
  async copyLink() {
    const link = `${location.origin}/`;
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch {
      return false;
    }
  },
  power() {
    const st = store.get().status;
    if (st) send(cmd.enable(!st.enabled));
  },
  restart() {
    send(cmd.recalibrate());
  },
  disconnect() {
    void transport?.disconnect();
  },
  sliderStart() {
    dragging = true;
    lastSentThreshold = -1; // baka ginalaw ang pisikal na knob mula noong huli
  },
  sliderInput(slider) {
    dragging = true;
    const wait = SLIDER_SEND_EVERY_MS - (Date.now() - lastSentAt);
    clearTrailing();
    if (wait <= 0) sendThreshold(slider);
    else trailing = setTimeout(() => sendThreshold(slider), wait);
  },
  sliderCommit(slider) {
    clearTrailing();
    sendThreshold(slider, true);
    dragging = false;
    holdUntil = Date.now() + SLIDER_HOLD_MS;
  },
  isSliderLocked() {
    return dragging || Date.now() < holdUntil;
  },
  demoAction(action) {
    if (!(transport instanceof DemoTransport)) return;
    if (action === 'drop') transport.simulateDrop(true);
    else if (action === 'fail') transport.simulateDrop(false);
    else transport.setSilent(!transport.isSilent());
    render();
  },
  isDemoSilent() {
    return transport instanceof DemoTransport && transport.isSilent();
  },
}).render;

// I-render nang isang beses bawat frame lang
let frame = 0;
function render(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    ui(store.get());
  });
}
store.subscribe(render);
render();

// ?demo=1: kumonekta agad sa pekeng detector
if (store.get().demo) void getTransport().connect();
