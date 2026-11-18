# Metal Plan: Phone Remote para sa Walk-through Metal Detector

Basahin ito nang buo bago mag-code. Kumpleto na ang mga desisyon dito, kaya sundin ang spec at itanong lang ang hindi talaga masasagot ng dokumentong ito.

**Deadline ng detector: Biyernes, Nov 20, 2026.** Dagdag na feature lang ang remote. Hindi ito dapat makasira sa gumaganang detector.

---

## 1. Layunin

Gumawa ng PWA na naka-deploy sa Vercel para maging remote ng detector ang selpon:

- I-on at i-standby ang detector
- I-adjust ang sensitivity
- I-restart (recalibrate) ang detector
- Makita kung connected at aling coil ang naka-detect ng metal

## 2. Mga desisyon

| Paksa | Desisyon |
|---|---|
| Koneksyon | Bluetooth Low Energy gamit ang **HM-10** at Web Bluetooth |
| Web stack | Vite, vanilla TypeScript, `vite-plugin-pwa` |
| Editor at commands | VS Code, `npm run dev`, `npm run build`, `npm run preview` |
| Hosting | Vercel (kailangan ang HTTPS ng Web Bluetooth) |
| Android | Chrome, puwedeng i-install bilang PWA |
| iPhone | **Bluefy** browser, doon bubuksan ang Vercel link |
| Firmware | v6.3, galing sa `walkthrough_v6_2.ino` |
| Hindi gagamitin | HC-05/HC-06 (Bluetooth Classic), WiFi module, SoftwareSerial |

### Limitasyon sa iPhone

Walang Web Bluetooth ang Safari, kaya walang Bluetooth ang app kapag binuksan sa Safari o in-add sa Home Screen mula sa Safari. Sa iPhone, i-install ang [Bluefy](https://apps.apple.com/app/id1492822055) at doon buksan ang Vercel link. Dapat ipakita ng app ang gabay na ito kapag walang `navigator.bluetooth`.

### Limitasyon ng ON/OFF

Standby lang ang OFF sa selpon: titigil ang pulses, detection at buzzer, pero gising ang Arduino at HM-10. Kapag pinatay ang switch ng battery shield, patay rin ang Bluetooth at hindi ito mabubuhay mula sa selpon.

## 3. Hardware

**Status: hindi pa nabibili ang HM-10.** Puwedeng gawin ang buong app gamit ang demo mode habang wala pa ito.

### Wiring

| HM-10 | Arduino Uno |
|---|---|
| VCC | 5V |
| GND | GND |
| TXD | D0 (RX) |
| RXD | D1 (TX), **dadaan sa voltage divider** |

```text
Arduino D1 ──[ 470Ω ]──┬── HM-10 RXD      (mga 3.4V)
                       │
                     [ 1kΩ ]
                       │
                      GND
```

### Mga patakaran

- **Tanggalin ang wire sa D0 tuwing mag-a-upload ng code**, kasi ginagamit din ito ng USB upload.
- Hardware `Serial` lang ang gamitin. Pinapatay ng detector ang interrupts habang nagpu-pulse, kaya mawawalan ng data ang SoftwareSerial.
- Ilayo ang HM-10 sa mga wire ng coil, at i-test ulit ang false alarm pagkakabit.
- Metal ang selpon, kaya huwag itong hawakan malapit sa coil habang ginagamit.

## 4. Bluetooth protocol

- HM-10 service: `0xFFE0`
- Characteristic: `0xFFE1` (write at notify)
- Serial baud: **9600**
- ASCII text, bawat mensahe ay nagtatapos sa `\n`
- Puwedeng maputol ang isang linya sa iba't ibang notification (20 bytes bawat packet), kaya dapat may line buffer ang app

### Selpon papunta sa Arduino

Nagsisimula sa `#` ang bawat command, para hindi masira ng ibang text na galing sa module.

| Command | Ibig sabihin |
|---|---|
| `#S\n` | Hingin ang kasalukuyang status |
| `#E1\n` | I-on ang detector (magka-calibrate muna kung galing sa standby) |
| `#E0\n` | Standby |
| `#T<n>\n` | Itakda ang threshold, `n` ay 2 hanggang 60 (mas mababa = mas sensitive) |
| `#R\n` | Recalibrate |

### Arduino papunta sa selpon

**Status** (bawat 500 ms, agad kapag nagbago ang detected coils, at pagkatapos ng bawat command):

```text
S,<enabled>,<threshold>,<calibrating>,<detectedMask>,<zoneMask>
S,1,12,0,4,15
```

**Coil reading** (isang coil bawat 150 ms, salitan sa mga naka-on na coil, habang naka-on ang detector):

```text
Z,<zone>,<diff>,<zoneThreshold>
Z,2,-14,12
```

Bit ng mask at index ng zone: `0 = L-UP`, `1 = R-UP`, `2 = L-LOW`, `3 = R-LOW`. Huwag pansinin ng app ang linyang hindi kilala.

## 5. Firmware v6.3

Kopyahin ang `walkthrough_v6_2.ino` papunta sa `arduino/walkthrough_v6_3/walkthrough_v6_3.ino`, at gawin **lang** ang mga pagbabagong ito.

### Bawal baguhin

`NPULSE`, `PULSE_US`, `NSAMPLE`, `STEP_US`, `measureZone()`, `CONFIRM`, `RELEASE`, `NOISE_MARGIN`, ang detection logic sa loob ng zone loop, at ang pin assignments.

### Mga pagbabago

1. Palitan ang version comment at gawing `Serial.begin(9600);`.
2. Alisin ang lahat ng lumang `Serial.print` at `Serial.println`, kasama ang `printStatus()`. Ang `S` at `Z` na linya lang ang ipapadala.
3. Palakihin ang deadband ng knob mula 6 papuntang **12** sa `readKnob()`. Ang huling gumalaw ang masusunod: selpon o pisikal na knob.
4. Idagdag ang code sa ibaba.
5. Sa `calibrate()`, gawing `calibrating = true; sendStatus();` ang simula at `calibrating = false; sendStatus();` ang dulo.
6. Sa `setup()`, tawagin pa rin ang `readKnob()` bago ang `calibrate()`. Naka-on ang detector tuwing bubuksan.

```cpp
bool enabled = true;
bool calibrating = false;
char cmdBuf[8];
byte cmdLen = 0;
bool inCmd = false;
byte lastMask = 0;
byte zoneCursor = 0;
unsigned long lastStatusMs = 0;
unsigned long lastZoneMs = 0;

byte detectedMask() {
  byte mask = 0;
  for (byte z = 0; z < NZONE; z++) if (ZONE_ON[z] && detected[z]) mask |= (1 << z);
  return mask;
}

byte activeMask() {
  byte mask = 0;
  for (byte z = 0; z < NZONE; z++) if (ZONE_ON[z]) mask |= (1 << z);
  return mask;
}

void sendStatus() {
  Serial.print(F("S,"));
  Serial.print(enabled ? 1 : 0);
  Serial.print(',');
  Serial.print(threshold);
  Serial.print(',');
  Serial.print(calibrating ? 1 : 0);
  Serial.print(',');
  Serial.print(detectedMask());
  Serial.print(',');
  Serial.println(activeMask());
  lastStatusMs = millis();
}

void sendNextZone() {
  for (byte i = 0; i < NZONE; i++) {
    zoneCursor = (zoneCursor + 1) % NZONE;
    if (!ZONE_ON[zoneCursor]) continue;
    Serial.print(F("Z,"));
    Serial.print(zoneCursor);
    Serial.print(',');
    Serial.print((int)diffNow[zoneCursor]);
    Serial.print(',');
    Serial.println((int)zoneTh[zoneCursor]);
    return;
  }
}

void report() {
  byte mask = detectedMask();
  if (mask != lastMask || millis() - lastStatusMs >= 500) {
    lastMask = mask;
    sendStatus();
  }
  if (enabled && millis() - lastZoneMs >= 150) {
    lastZoneMs = millis();
    sendNextZone();
  }
}

void enterStandby() {
  enabled = false;
  for (byte z = 0; z < NZONE; z++) {
    detected[z] = false;
    hitCount[z] = 0;
    lowCount[z] = 0;
    detectStart[z] = 0;
    diffNow[z] = 0;
  }
  allOutputsOff();
}

void handleCommand(const char* c) {
  switch (c[0]) {
    case 'E':
      if (c[1] == '0' && enabled) enterStandby();
      else if (c[1] == '1' && !enabled) { enabled = true; calibrate(); }
      break;
    case 'T': {
      int v = atoi(c + 1);
      if (v >= TH_MIN && v <= TH_MAX) threshold = v;
      break;
    }
    case 'R':
      calibrate();
      break;
  }
  sendStatus();
}

void readCommands() {
  while (Serial.available() > 0) {
    char ch = Serial.read();
    if (ch == '#') {
      inCmd = true;
      cmdLen = 0;
    } else if (!inCmd) {
      continue;
    } else if (ch == '\n' || ch == '\r') {
      cmdBuf[cmdLen] = '\0';
      inCmd = false;
      if (cmdLen > 0) handleCommand(cmdBuf);
    } else if (cmdLen < sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = ch;
    } else {
      inCmd = false;
    }
  }
}
```

Simula ng `loop()`:

```cpp
void loop() {
  readCommands();
  readKnob();
  checkButton();

  if (!enabled) {
    allOutputsOff();
    report();
    return;
  }

  // ... tuloy ang dating zone loop, walang babaguhin ...

  updateAlarm(anyDetected, maxExcess);
  report();
}
```

Kapag kumpleto na ang 4 na coil, gawing `{true, true, true, true}` ang `ZONE_ON`.

## 6. PWA project

### Setup

```bash
npm create vite@latest detector-remote -- --template vanilla-ts
cd detector-remote
npm install
npm install -D vite-plugin-pwa
npm install @fontsource/barlow @fontsource/barlow-condensed
```

### Structure

```text
detector-remote/
├─ arduino/walkthrough_v6_3/walkthrough_v6_3.ino
├─ public/icons/            icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png
├─ src/
│  ├─ main.ts               simula ng app, pinagdudugtong ang lahat
│  ├─ protocol.ts           parse ng S/Z lines, paggawa ng commands, line buffer
│  ├─ transport.ts          Transport interface
│  ├─ ble.ts                totoong HM-10 connection
│  ├─ demo.ts               pekeng detector
│  ├─ state.ts              app state
│  ├─ ui.ts                 pag-render at mga control
│  └─ style.css
├─ index.html
├─ vite.config.ts
└─ README.md
```

### Transport

```ts
export type LinkState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(command: string): Promise<void>;
  onLine(listener: (line: string) => void): void;
  onLinkState(listener: (state: LinkState) => void): void;
}
```

### Mga detalye ng `ble.ts`

- Tawagin ang `requestDevice` mula lang sa pag-tap ng user.
- Maraming HM-10 clone ang hindi nag-a-advertise ng service, kaya gamitin ang mga filter na ito:

```ts
await navigator.bluetooth.requestDevice({
  filters: [
    { services: [0xffe0] },
    { namePrefix: 'HM' },
    { namePrefix: 'BT05' },
    { namePrefix: 'MLT' },
    { namePrefix: 'JDY' },
    { namePrefix: 'AT-09' },
    { namePrefix: 'CC41' },
  ],
  optionalServices: [0xffe0],
});
```

- Isa-isang ipadala ang writes sa pamamagitan ng promise queue, para walang sabay na GATT operation.
- Gamitin ang `writeValueWithoutResponse` kung meron, at `writeValue` kung wala.
- Pagkakonekta, i-start ang notifications at ipadala agad ang `#S\n`.
- Sa `gattserverdisconnected`, sumubok kumonekta ulit nang 3 beses (pagitan: 1 s, 2 s, 4 s), tapos gawing `failed`.

### Sensitivity slider

- Range ng slider: `0` hanggang `58`
- `threshold = 60 - slider`
- Ipakita: `Math.round(slider / 58 * 100)` na porsyento
- Ipadala habang ginagalaw nang hindi hihigit sa isa bawat 150 ms, at laging ipadala ang huling value pagbitaw
- Huwag sundin ang threshold galing sa device habang dina-drag at sa loob ng 600 ms pagkatapos

### Mga estado ng app

| Kalagayan | Ipapakita | Controls |
|---|---|---|
| Walang Web Bluetooth sa iPhone | Gabay sa Bluefy, button na **Kopyahin ang link**, **Subukan ang demo** | Naka-disable |
| Walang Web Bluetooth sa ibang device | "Buksan ito sa Chrome para makakonekta.", **Subukan ang demo** | Naka-disable |
| Hindi connected | **Kumonekta sa detector** | Naka-disable |
| Kumokonekta | "Kumokonekta sa detector…" | Naka-disable |
| Naka-on | "Nagbabantay" | Lahat gumagana |
| May metal | "May metal sa <coil>" | Lahat gumagana |
| Calibrating | "Lumayo sa gate at alisin ang metal" | Naka-disable |
| Standby | "Naka-standby" | Power lang ang gumagana |
| Naputol | "Naputol ang koneksyon. Kumokonekta ulit…" | Naka-disable |
| Bigong kumonekta | "Hindi makakonekta. I-check kung naka-on ang detector at malapit ka rito." at **Kumonekta ulit** | Naka-disable |
| Walang `S` line sa loob ng 3 s | "Walang sagot ang detector. I-check ang wiring ng Bluetooth module." | Naka-disable |

Tandaan: patuloy na gumagana ang detector kahit maputol ang Bluetooth, kaya sabihin ito sa mensahe kapag naputol.

### Disenyo

Parang control panel sa gilid ng gate, malinaw basahin sa maliwanag na lugar, at kayang gamitin ng isang kamay.

**Ang pinaka-tampok:** isang malaking drawing ng mismong gate sa itaas ng screen. Nasa totoong puwesto ang 4 na coil panel (kaliwa/kanan, taas/baba). Umiilaw ang panel kapag may metal, at may maliit na level bar ang bawat coil.

| Token | Hex | Gamit |
|---|---|---|
| Switchgear | `#C9D3CC` | Background |
| Panel | `#E8EDE9` | Mga surface |
| Pine | `#17352F` | Text at frame ng gate |
| Pipe | `#7E9189` | Naka-off na coil, pangalawang text |
| Guard | `#1F7A55` | Naka-on, connected |
| Alarm | `#D6301C` | May metal |

- **Typeface:** Barlow Condensed para sa status at malalaking value, Barlow para sa iba. Naka-install sa project para gumana offline.
- **Layout:** isang column. Gate sa taas, status sa ilalim nito, sensitivity sa gitna, at nasa abot ng hinlalaki sa baba ang **Power** at **I-restart**.
- **Text:** sentence case, walang all-caps na labels, Taglish na simple.
- **Motion:** kurap ng coil kapag may metal lang. Sa `prefers-reduced-motion`, solid na kulay na walang kurap.
- **Accessibility:** hindi lang kulay ang palatandaan (may salitang "Metal" sa coil), minimum 48 px ang tap targets, may visible focus, may `aria-live` ang status, at may label ang slider.
- Gumagana sa 320 px na lapad at sa safe areas ng iPhone.

### Demo mode

- Buksan gamit ang button o `?demo=1`.
- `DemoTransport` na sumusunod sa parehong protocol, para walang hiwalay na logic sa UI.
- Sumusunod sa `#E`, `#T`, `#R`, at `#S`. Tumatagal nang mga 4 s ang calibration.
- May pekeng metal na dumadaan bawat 6 hanggang 10 s sa random na coil.
- Laging may nakikitang "Demo mode" para hindi mapagkamalang totoong koneksyon.

### PWA config

```ts
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Detector Remote',
        short_name: 'Detector',
        description: 'Remote para sa walk-through metal detector',
        theme_color: '#17352F',
        background_color: '#C9D3CC',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'] },
    }),
  ],
});
```

Icon: simpleng gate arch na Pine sa Switchgear na background.

## 7. Deploy sa Vercel

```bash
npm run build
npx vercel
npx vercel --prod
```

O i-push sa GitHub at i-import sa Vercel. Framework: **Vite**, build command: `npm run build`, output: `dist`.

## 8. Pagkakasunod-sunod ng trabaho

1. **Unahin ang detector:** subukan ang `walkthrough_v6_2.ino` sa 4 na coil. Kapag hindi pa ito stable, huwag munang ikabit ang HM-10.
2. Gawin ang PWA at demo mode, tapos i-deploy sa Vercel.
3. Gawin ang firmware v6.3 at i-test sa Serial Monitor (9600 baud, Newline) gamit ang mga command sa section 4.
4. Bumili at ikabit ang HM-10.
5. I-test sa Android Chrome, tapos sa iPhone gamit ang Bluefy.
6. I-test ulit ang false alarm at abot ng detector nang nakakabit ang HM-10.

**Fallback:** kapag hindi umabot o pumalya ang Bluetooth bago mag-Biyernes, tanggalin ang HM-10. Gumagana pa rin ang detector gamit ang pisikal na switch, knob at button.

## 9. Acceptance checklist

### Firmware

- [ ] Nagko-compile para sa Arduino Uno nang walang error
- [ ] `#E0` humihinto ang pulses at buzzer
- [ ] `#E1` nagka-calibrate at bumabalik sa pagbabantay
- [ ] `#T20` nagiging 20 ang threshold; hindi tinatanggap ang `#T99`
- [ ] `#R` nagka-calibrate
- [ ] Gumagana pa rin ang pisikal na knob at button
- [ ] Tuloy ang detector kapag naputol ang Bluetooth
- [ ] Walang dagdag na false alarm kumpara sa v6.2

### App

- [ ] Pumapasa ang `npm run build` nang walang TypeScript error
- [ ] Gumagana ang lahat ng estado sa demo mode
- [ ] Tama ang pagbasa kahit maputol ang linya sa dalawang notification
- [ ] Kumokonekta ulit nang kusa pagkatapos maputol
- [ ] Nai-install sa Android at bumubukas offline
- [ ] Lumalabas ang gabay sa Bluefy kapag binuksan sa iPhone Safari
- [ ] Nakakonekta at nakokontrol ang detector mula sa Android Chrome
- [ ] Nakakonekta at nakokontrol ang detector mula sa Bluefy sa iPhone
- [ ] Maayos ang layout sa 320 px at 430 px na lapad

## 10. Mga bukas na bagay

- Kung may stock ang Elexhub ng HM-10 o compatible na BLE module. Kung iba ang dumating, i-check ang service at characteristic gamit ang nRF Connect app.
- Hindi pa nasusubukan ang v6.2 sa mismong gate, at simulation lang ang pinagbatayan ng resulta nito.
