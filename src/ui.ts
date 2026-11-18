// Pag-render ng screen at pagkabit ng mga control.
// Walang alam ang file na ito sa Bluetooth o demo: state lang ang binabasa nito.
import { NZONE, sliderPercent, sliderToThreshold, thresholdToSlider } from './protocol';
import { controlsFor, getPhase, type AppState, type Phase } from './state';

export type UIHandlers = {
  connect(): void;
  retry(): void;
  startDemo(): void;
  exitDemo(): void;
  copyLink(): Promise<boolean>;
  power(): void;
  restart(): void;
  disconnect(): void;
  sliderStart(): void;
  sliderInput(slider: number): void;
  sliderCommit(slider: number): void;
  isSliderLocked(): boolean;
  demoAction(action: 'drop' | 'fail' | 'silent'): void;
  isDemoSilent(): boolean;
};

// Pangalan ng coil, ayon sa index ng zone (0 = L-UP, 1 = R-UP, 2 = L-LOW, 3 = R-LOW)
const ZONE_PHRASE = ['kaliwang taas', 'kanang taas', 'kaliwang baba', 'kanang baba'];
const ZONE_SHORT = ['Taas', 'Taas', 'Baba', 'Baba'];

const BLUEFY_URL = 'https://apps.apple.com/app/id1492822055';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function joinTagalog(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} at ${items[items.length - 1]}`;
}

function metalZones(s: AppState): string[] {
  const st = s.status;
  if (!st) return [];
  const out: string[] = [];
  for (let z = 0; z < NZONE; z++) if (st.detectedMask & st.zoneMask & (1 << z)) out.push(ZONE_PHRASE[z]);
  return out;
}

type Tone = 'guard' | 'alarm' | 'off' | 'warn';

function statusText(phase: Phase, s: AppState): { main: string; sub: string; tone: Tone } {
  switch (phase) {
    case 'unsupported-ios':
      return {
        main: 'Buksan ito sa Bluefy',
        sub: `<p>Walang Bluetooth ang Safari, kaya hindi ito makakakonekta rito, kahit i-add sa Home Screen.</p>
          <ol class="steps">
            <li>I-install ang <a href="${BLUEFY_URL}" target="_blank" rel="noopener">Bluefy</a> mula sa App Store.</li>
            <li>Pindutin ang <strong>Kopyahin ang link</strong> sa ibaba.</li>
            <li>Buksan ang Bluefy, i-paste ang link, at doon kumonekta.</li>
          </ol>`,
        tone: 'warn',
      };
    case 'unsupported':
      return {
        main: 'Buksan ito sa Chrome para makakonekta.',
        sub: '<p>Walang Web Bluetooth ang browser na ito. Puwede mo munang subukan ang demo.</p>',
        tone: 'warn',
      };
    case 'idle':
      return {
        main: 'Hindi connected',
        sub: s.demo
          ? '<p>Pindutin ang button para kumonekta sa pekeng detector.</p>'
          : '<p>I-on ang detector, lumapit dito, at pindutin ang <strong>Kumonekta sa detector</strong>.</p>',
        tone: 'off',
      };
    case 'connecting':
      return { main: 'Kumokonekta sa detector…', sub: '', tone: 'off' };
    case 'watching':
      return { main: 'Nagbabantay', sub: '<p>Walang metal na nakikita.</p>', tone: 'guard' };
    case 'metal':
      return { main: `May metal sa ${joinTagalog(metalZones(s))}`, sub: '', tone: 'alarm' };
    case 'calibrating':
      return {
        main: 'Lumayo sa gate at alisin ang metal',
        sub: '<p>Nagka-calibrate ang detector. Ilang segundo lang ito.</p>',
        tone: 'warn',
      };
    case 'standby':
      return {
        main: 'Naka-standby',
        sub: '<p>Walang pulse at walang tunog. Pindutin ang <strong>Power</strong> para i-on.</p>',
        tone: 'off',
      };
    case 'reconnecting':
      return {
        main: 'Naputol ang koneksyon. Kumokonekta ulit…',
        sub: '<p>Tuloy pa rin ang pagbabantay ng detector kahit walang Bluetooth.</p>',
        tone: 'warn',
      };
    case 'failed':
      return {
        main: 'Hindi makakonekta. I-check kung naka-on ang detector at malapit ka rito.',
        sub: '<p>Tuloy pa rin ang pagbabantay ng detector kahit walang Bluetooth.</p>',
        tone: 'warn',
      };
    case 'no-response':
      return {
        main: 'Walang sagot ang detector. I-check ang wiring ng Bluetooth module.',
        sub: '<p>Nakakonekta ang Bluetooth, pero walang dumarating na status galing sa Arduino.</p>',
        tone: 'warn',
      };
  }
}

function pillText(phase: Phase): { text: string; tone: Tone } {
  switch (phase) {
    case 'watching':
    case 'metal':
    case 'calibrating':
    case 'standby':
      return { text: 'Connected', tone: 'guard' };
    case 'connecting':
      return { text: 'Kumokonekta', tone: 'off' };
    case 'reconnecting':
      return { text: 'Naputol', tone: 'warn' };
    case 'no-response':
      return { text: 'Walang sagot', tone: 'warn' };
    case 'unsupported':
    case 'unsupported-ios':
      return { text: 'Walang Bluetooth', tone: 'off' };
    default:
      return { text: 'Hindi connected', tone: 'off' };
  }
}

function coilMarkup(z: number): string {
  return `<div class="coil" id="coil-${z}" data-state="unknown">
      <span class="sr-only">Coil sa ${ZONE_PHRASE[z]}:</span>
      <span class="coil-name" aria-hidden="true">${ZONE_SHORT[z]}</span>
      <span class="coil-state" id="coil-state-${z}">–</span>
      <span class="coil-meter" aria-hidden="true">
        <span class="coil-fill" id="coil-fill-${z}"></span>
        <span class="coil-tick"></span>
      </span>
    </div>`;
}

function buildGate(el: HTMLElement): void {
  el.innerHTML = `
    <div class="gate-beam"></div>
    <div class="gate-body">
      <div class="post">
        <span class="post-label">Kaliwa</span>
        ${coilMarkup(0)}
        ${coilMarkup(2)}
      </div>
      <div class="passage" aria-hidden="true"><span>Daanan</span></div>
      <div class="post">
        <span class="post-label">Kanan</span>
        ${coilMarkup(1)}
        ${coilMarkup(3)}
      </div>
    </div>
    <div class="gate-floor"></div>`;
}

type CoilState = 'unknown' | 'absent' | 'calib' | 'off' | 'clear' | 'metal';

const COIL_TEXT: Record<CoilState, string> = {
  unknown: '–',
  absent: 'Walang coil',
  calib: 'Calibrating',
  off: 'Naka-off',
  clear: 'Malinis',
  metal: 'Metal',
};

function coilState(phase: Phase, s: AppState, z: number): CoilState {
  const st = s.status;
  const live = phase === 'watching' || phase === 'metal' || phase === 'calibrating' || phase === 'standby';
  if (!live || !st) return 'unknown';
  if (!(st.zoneMask & (1 << z))) return 'absent';
  if (phase === 'calibrating') return 'calib';
  if (phase === 'standby') return 'off';
  return st.detectedMask & (1 << z) ? 'metal' : 'clear';
}

export function createUI(h: UIHandlers) {
  buildGate($('gate'));

  const banner = $('demo-banner');
  const pill = $('link-pill');
  const statusBox = $('status');
  const statusMain = $('status-main');
  const statusSub = $('status-sub');
  const actions = $('status-actions');
  const slider = $<HTMLInputElement>('sens');
  const sensValue = $<HTMLOutputElement>('sens-value');
  const sensTh = $('sens-th');
  const demoTools = $('demo-tools');
  const silentBtn = demoTools.querySelector<HTMLButtonElement>('[data-demo="silent"]')!;
  const btnPower = $<HTMLButtonElement>('btn-power');
  const powerSub = $('power-sub');
  const btnRestart = $<HTMLButtonElement>('btn-restart');
  const btnDisconnect = $<HTMLButtonElement>('btn-disconnect');

  let lastPhase: Phase | null = null;
  let lastDemo: boolean | null = null;
  let lastStatusMain = '';
  let lastStatusSub = '';

  // ---- Slider ----
  function showSlider(value: number): void {
    const pct = sliderPercent(value);
    const th = sliderToThreshold(value);
    sensValue.textContent = `${pct}%`;
    sensTh.textContent = String(th);
    slider.setAttribute('aria-valuetext', `${pct} porsyento, threshold ${th}`);
    slider.style.setProperty('--fill', `${(value / Number(slider.max)) * 100}%`);
  }

  slider.addEventListener('pointerdown', () => h.sliderStart());
  slider.addEventListener('keydown', () => h.sliderStart());
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    showSlider(v);
    h.sliderInput(v);
  });
  slider.addEventListener('change', () => h.sliderCommit(Number(slider.value)));
  showSlider(Number(slider.value));

  // ---- Buttons ----
  btnPower.addEventListener('click', () => h.power());
  btnRestart.addEventListener('click', () => h.restart());
  btnDisconnect.addEventListener('click', () => h.disconnect());

  demoTools.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-demo]');
    if (!btn) return;
    const action = btn.dataset.demo;
    if (action === 'exit') h.exitDemo();
    else if (action === 'drop' || action === 'fail' || action === 'silent') h.demoAction(action);
  });

  function button(label: string, primary: boolean, onClick: (btn: HTMLButtonElement) => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'btn btn-primary' : 'btn btn-secondary';
    b.textContent = label;
    b.addEventListener('click', () => onClick(b));
    return b;
  }

  function renderActions(phase: Phase, demo: boolean): void {
    actions.replaceChildren();
    const add = (b: HTMLButtonElement) => actions.append(b);
    if (phase === 'unsupported-ios') {
      add(
        button('Kopyahin ang link', true, async (b) => {
          const ok = await h.copyLink();
          b.textContent = ok ? 'Nakopya na ang link' : 'Hindi nakopya. Kopyahin mula sa address bar.';
          setTimeout(() => (b.textContent = 'Kopyahin ang link'), 2500);
        }),
      );
      add(button('Subukan ang demo', false, () => h.startDemo()));
    } else if (phase === 'unsupported') {
      add(button('Subukan ang demo', true, () => h.startDemo()));
    } else if (phase === 'idle') {
      add(button(demo ? 'Kumonekta sa demo detector' : 'Kumonekta sa detector', true, () => h.connect()));
      if (!demo) add(button('Subukan ang demo', false, () => h.startDemo()));
    } else if (phase === 'failed' || phase === 'no-response') {
      add(button('Kumonekta ulit', true, () => h.retry()));
    }
    actions.hidden = actions.childElementCount === 0;
  }

  function render(s: AppState): void {
    const phase = getPhase(s);
    const controls = controlsFor(phase);

    // Demo mode: laging nakikita
    banner.hidden = !s.demo;
    demoTools.hidden = !s.demo;
    document.body.classList.toggle('is-demo', s.demo);
    silentBtn.textContent = h.isDemoSilent() ? 'Ibalik ang sagot ng detector' : 'Patahimikin ang detector';

    // Status
    const t = statusText(phase, s);
    if (t.main !== lastStatusMain) statusMain.textContent = lastStatusMain = t.main;
    if (t.sub !== lastStatusSub) statusSub.innerHTML = lastStatusSub = t.sub;
    statusSub.hidden = t.sub === '';
    statusBox.dataset.tone = t.tone;

    const p = pillText(phase);
    pill.textContent = p.text;
    pill.dataset.tone = p.tone;

    if (phase !== lastPhase || s.demo !== lastDemo) {
      renderActions(phase, s.demo);
      lastPhase = phase;
      lastDemo = s.demo;
    }

    // Gate
    for (let z = 0; z < NZONE; z++) {
      const cs = coilState(phase, s, z);
      const el = document.getElementById(`coil-${z}`)!;
      el.dataset.state = cs;
      const txt = COIL_TEXT[cs];
      const stateEl = document.getElementById(`coil-state-${z}`)!;
      if (stateEl.textContent !== txt) stateEl.textContent = txt;

      const reading = s.zones[z];
      let level = 0;
      if ((cs === 'clear' || cs === 'metal') && reading && reading.zoneThreshold > 0) {
        // Kalahati ng bar = threshold ng coil
        level = Math.min(1, Math.abs(reading.diff) / (reading.zoneThreshold * 2));
      }
      document.getElementById(`coil-fill-${z}`)!.style.width = `${Math.round(level * 100)}%`;
    }

    // Sensitivity: sundin ang device kapag hindi ginagalaw ng user
    if (s.status && !h.isSliderLocked()) {
      const v = thresholdToSlider(s.status.threshold);
      if (Number(slider.value) !== v) slider.value = String(v);
      showSlider(v);
    } else if (!s.status) {
      sensValue.textContent = '–';
      sensTh.textContent = '–';
    }

    // Controls
    slider.disabled = !controls.slider;
    btnPower.disabled = !controls.power;
    btnRestart.disabled = !controls.restart;
    const on = !!s.status?.enabled && phase !== 'standby';
    const known = phase === 'watching' || phase === 'metal' || phase === 'standby' || phase === 'calibrating';
    btnPower.setAttribute('aria-pressed', String(known && on));
    btnPower.dataset.on = String(known && on);
    powerSub.textContent = !known ? '–' : on ? 'Naka-on · i-standby' : 'Naka-standby · i-on';

    btnDisconnect.hidden = s.demo || s.link === 'idle' || s.link === 'failed';
  }

  return { render };
}
