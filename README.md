# Detector Remote (BakalAko)

PWA na nagsisilbing remote ng walk-through metal detector gamit ang selpon, sa pamamagitan ng
Bluetooth Low Energy (HM-10) at Web Bluetooth. Buong spec: [metalplan.md](metalplan.md).

## Patakbuhin

```bash
npm install
npm run dev       # local dev server
npm run build     # TypeScript check + production build sa dist/
npm run preview   # subukan ang production build (kasama ang service worker)
npm run icons     # gawin ulit ang PNG icons sa public/icons/
```

## Demo mode

Wala pang HM-10? Buksan ang app gamit ang `?demo=1` (hal. `http://localhost:5173/?demo=1`) o pindutin
ang **Subukan ang demo**. Pekeng detector ito na sumusunod sa parehong protocol ng firmware:

- Sumusunod sa Power (`#E`), sensitivity (`#T`), I-restart (`#R`) at status (`#S`)
- Mga 4 s ang calibration
- May pekeng metal na dumadaan bawat 6–10 s sa random na coil
- Hinahati nito ang output sa random na piraso (hanggang 20 bytes), gaya ng BLE, para masubukan ang line buffer

Sa **Subukan ang mga estado** na panel, puwedeng subukan ang:

| Button | Estado na lalabas |
|---|---|
| Putulin ang koneksyon | "Naputol ang koneksyon. Kumokonekta ulit…", tapos babalik |
| Pumalyang koneksyon | "Hindi makakonekta…" at **Kumonekta ulit** |
| Patahimikin ang detector | Pagkalipas ng 3 s: "Walang sagot ang detector…" |

Pang-test ng mga screen na walang Bluetooth (kahit sa desktop Chrome):

- `?nobt=ios` – gabay sa Bluefy (parang iPhone Safari)
- `?nobt=other` – "Buksan ito sa Chrome para makakonekta."

## Deploy sa Vercel

Static build lang ito, walang environment variables.

1. Sa Vercel, **Add New → Project** at i-import ang GitHub repo na ito.
2. Framework: **Vite**, build command: `npm run build`, output: `dist`.
3. Deploy. Tuwing may push sa `main`, kusang magde-deploy ulit.

O gamit ang CLI: `npx vercel` tapos `npx vercel --prod`.

## Paano gamitin sa selpon

- **Android:** buksan ang Vercel link sa Chrome. Puwedeng i-install (menu → *Install app* / *Add to Home screen*).
- **iPhone:** walang Web Bluetooth ang Safari. I-install ang [Bluefy](https://apps.apple.com/app/id1492822055) at doon buksan ang link.

## Mga file

| File | Gamit |
|---|---|
| `src/protocol.ts` | Parse ng `S`/`Z` lines, paggawa ng commands, line buffer |
| `src/transport.ts` | `Transport` interface (pareho para sa BLE at demo) |
| `src/ble.ts` | Totoong HM-10 connection, write queue, auto-reconnect (1 s, 2 s, 4 s) |
| `src/demo.ts` | Pekeng detector |
| `src/state.ts` | App state at kung aling estado/controls ang ipapakita |
| `src/ui.ts` | Pag-render ng gate, status, slider at buttons |
| `src/main.ts` | Pinagdudugtong ang lahat |
| `scripts/make-icons.mjs` | Gumagawa ng icons (walang dependency) |
