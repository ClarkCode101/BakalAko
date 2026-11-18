// ===============================================================
//  Walk-through Metal Detector - Code v6.2 (4 coil)
//  v6.2: PANLABAN SA FALSE ALARM (beep kahit walang metal)
//  Hindi binago ang lakas ng pulse (NPULSE 3, pulse 5 us) at ang knob,
//  kaya pareho pa rin ang abot at sensitivity.
//
//  Mga bago sa v6.2:
//   1. Saktong 1 cycle ng kuryente (60 Hz) ang bawat sukat, kaya
//      nagkakansela ang ugong galing sa saksakan at mga wire sa pader
//   2. Walang interrupt habang nagpu-pulse, kaya pantay lahat ng pulse
//   3. Tinanggal ang smoothing na nagpapahaba ng spike: 2 magkasunod na
//      sukat ang kailangang lumampas, kaya hindi na nakakalusot ang spike
//   4. Kusang tumataas ang threshold ng coil kapag maingay ang paligid
//   5. Dapat pareho ang direksyon ng signal para maituring na metal
//   6. Hysteresis: hindi nagpapatay-sindi ang beep sa gilid ng threshold
//   7. Binabawas ang epekto ng sariling buzzer sa 5V
//   8. Dahan-dahang bumabalik ang baseline kahit naipit malapit sa threshold
//   9. May 3 segundo bago mag-calibrate para makalayo ka muna sa gate
//
//  Zone      Pulse   Sense   LED
//  L-UP      D10     A0      D13
//  R-UP      D9      A2      D8
//  L-LOW     D7      A3      D5
//  R-LOW     D6      A4      D4
//
//  Knob (sensitivity) : A1
//  Button (recalibrate): D2  (sa S at G ng D2, INPUT_PULLUP)
//  Buzzer             : D12
//
//  Serial Monitor: 115200 baud
// ===============================================================

const byte NZONE = 4;
const byte PULSE_PIN[NZONE] = {10, 9, 7, 6};
const byte SENSE_PIN[NZONE] = {A0, A2, A3, A4};
const byte LED_PIN[NZONE]   = {13, 8, 5, 4};
const char* const ZONE_NAME[NZONE] = {"L-UP", "R-UP", "L-LOW", "R-LOW"};

// true = gamitin ang zone, false = huwag pansinin (hal. wala pang coil na nakakabit)
// Kapag kumpleto na ang 4 na coil sa gate: {true, true, true, true}
const bool ZONE_ON[NZONE] = {false, false, true, true};

const byte KNOB_PIN   = A1;
const byte BUTTON_PIN = 2;
const byte BUZZER_PIN = 12;

// ---- Abot at sensitivity (pareho sa v6.1) ----
const byte NPULSE   = 3;   // dami ng pulse bawat sukat (mula sa tuning test)
const byte PULSE_US = 5;   // haba ng bawat pulse sa microseconds (mula sa tuning test)
const int  TH_MIN = 2;     // threshold kapag knob nasa pinaka-sensitive
const int  TH_MAX = 60;    // threshold kapag knob nasa pinaka-hindi sensitive

// ---- Tunog ----
const int  BEEP_SLOW_MS = 400; // pagitan ng beep kapag mahina ang signal (malayo ang metal)
const int  BEEP_FAST_MS = 50;  // pagitan ng beep kapag malakas ang signal (malapit ang metal)
const unsigned long AUTO_RECAL_MS = 5000; // kung METAL nang ganito katagal, ituring na bagong normal
const unsigned long CAL_WAIT_MS   = 3000; // oras para makalayo sa gate bago mag-calibrate

// ---- Panlaban sa ingay (ito ang puwedeng i-adjust) ----
const byte  CONFIRM       = 2;     // ilang sunod-sunod na lampas bago mag-beep (3 = mas tahimik)
const byte  RELEASE       = 2;     // ilang sunod-sunod na mababa bago tumigil ang beep
const float NOISE_MARGIN  = 5.0;   // threshold ng coil = hindi bababa sa ingay x ito
const float RELEASE_RATIO = 0.6;   // titigil ang beep kapag bumaba sa threshold x ito
const float TRACK_K       = 1.0 / 64;   // bilis ng pagsunod ng baseline sa init/drift
const float TRACK_K_SLOW  = 1.0 / 1024; // pagsunod kapag malapit na sa threshold
const float TRACK_ZONE    = 0.5;   // normal na pagsunod kapag |diff| < threshold x ito
const float NOISE_K       = 1.0 / 64;   // bilis ng pag-update ng sukat ng ingay

// ---- Timing ng sukat: 66 sample sa loob ng 1 cycle ng 60 Hz (16,665 us) ----
const byte NSAMPLE = 66;   // 64 ang matitira matapos alisin ang pinakamataas at pinakamababa
const int  STEP_US = 252;  // pagitan ng sample (252 at 253 na salitan = 252.5 us)

float baseline[NZONE];
float lastRaw[NZONE];
float diffNow[NZONE];
float prevDiff[NZONE];
float noiseLevel[NZONE];
float zoneTh[NZONE];
long  buzzShift[NZONE];
byte  hitCount[NZONE];
byte  lowCount[NZONE];
char  hitSign[NZONE];
bool  detected[NZONE];
unsigned long detectStart[NZONE];
int   threshold = 10;
int   lastKnob  = -100;

unsigned long lastPrint = 0;
unsigned long lastBeep  = 0;
bool buzzerOn = false;

// Sukatin ang isang coil sa loob ng saktong 1 cycle ng kuryente.
long measureZone(byte z) {
  const byte sp = SENSE_PIN[z];
  const byte pp = PULSE_PIN[z];

  analogRead(sp);  // dummy read: para hindi tumagas ang dating binasang pin (hal. knob)

  long sum = 0;
  int minv = 1023, maxv = 0;
  const unsigned long t0 = micros();
  unsigned long nextAt = 0;

  for (byte m = 0; m < NSAMPLE; m++) {
    while (micros() - t0 < nextAt) { }
    nextAt += STEP_US + (m & 1);

    // Bawal ang interrupt dito: hahaba ang pulse kapag sumingit ito
    noInterrupts();

    // I-discharge ang capacitor
    pinMode(sp, OUTPUT);
    digitalWrite(sp, LOW);
    delayMicroseconds(20);
    pinMode(sp, INPUT);

    // Mga pulse papunta sa coil
    for (byte p = 0; p < NPULSE; p++) {
      digitalWrite(pp, HIGH);
      delayMicroseconds(PULSE_US);
      digitalWrite(pp, LOW);
      delayMicroseconds(3);
    }

    int v = analogRead(sp);
    interrupts();

    if (v < minv) minv = v;
    if (v > maxv) maxv = v;
    sum += v;
  }

  // Tanggalin ang pinakamababa at pinakamataas (ingay)
  sum -= minv;
  sum -= maxv;
  return sum;
}

// Isang bagong reading, tanggal ang epekto ng buzzer.
// Ibinabalik ang layo mula sa normal na reading.
float readZone(byte z) {
  long raw = measureZone(z);
  if (buzzerOn) raw -= buzzShift[z];
  lastRaw[z] = raw;
  return (raw - baseline[z]) / 16.0;
}

void resetZone(byte z, float value) {
  baseline[z] = value;
  lastRaw[z] = value;
  hitCount[z] = 0;
  lowCount[z] = 0;
  hitSign[z] = 0;
  detected[z] = false;
  detectStart[z] = 0;
  diffNow[z] = 0;
  prevDiff[z] = 0;
}

void allOutputsOff() {
  for (byte z = 0; z < NZONE; z++) digitalWrite(LED_PIN[z], LOW);
  digitalWrite(BUZZER_PIN, LOW);
  buzzerOn = false;
}

void calibrate() {
  allOutputsOff();
  Serial.println(F("Calibrating sa 3 segundo... lumayo sa gate at alisin ang metal"));
  delay(CAL_WAIT_MS);

  // 1) Normal na reading ng bawat coil
  for (byte z = 0; z < NZONE; z++) {
    if (!ZONE_ON[z]) continue;
    long acc = 0;
    for (byte i = 0; i < 16; i++) acc += measureZone(z);
    resetZone(z, acc / 16.0);
    buzzShift[z] = 0;
  }

  // 2) Gaano nagbabago ang reading kapag tumutunog ang buzzer
  digitalWrite(BUZZER_PIN, HIGH);
  delay(30);
  for (byte z = 0; z < NZONE; z++) {
    if (!ZONE_ON[z]) continue;
    long acc = 0;
    for (byte i = 0; i < 8; i++) acc += measureZone(z);
    buzzShift[z] = (long)(acc / 8.0 - baseline[z]);
  }
  digitalWrite(BUZZER_PIN, LOW);
  delay(30);

  // 3) Sukatin ang ingay ng bawat coil habang walang metal
  for (byte z = 0; z < NZONE; z++) {
    if (!ZONE_ON[z]) continue;
    float acc = 0;
    float prev = readZone(z);
    for (byte i = 0; i < 24; i++) {
      float d = readZone(z);
      acc += fabs(d - prev);
      prev = d;
    }
    noiseLevel[z] = acc / 24.0;
    prevDiff[z] = prev;

    Serial.print(ZONE_NAME[z]);
    Serial.print(F(" ingay: "));
    Serial.print(noiseLevel[z], 2);
    Serial.print(F("  buzzer: "));
    Serial.print(buzzShift[z] / 16.0, 1);
    Serial.print(F("  -> pinakamababang ligtas na threshold: ~"));
    Serial.println((int)ceil(noiseLevel[z] * NOISE_MARGIN));
  }

  // Maikling beep: tapos na ang calibration
  digitalWrite(BUZZER_PIN, HIGH);
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.println(F("Ready!"));
}

void readKnob() {
  analogRead(KNOB_PIN);              // dummy read
  int k = analogRead(KNOB_PIN);
  // Huwag pansinin ang maliit na galaw para hindi gumagalaw-galaw ang threshold
  if (k > lastKnob + 6 || k < lastKnob - 6) {
    lastKnob = k;
    threshold = map(k, 0, 1023, TH_MIN, TH_MAX);
  }
}

void checkButton() {
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(40);                       // debounce
    if (digitalRead(BUTTON_PIN) == LOW) {
      allOutputsOff();
      while (digitalRead(BUTTON_PIN) == LOW) { }  // hintaying bitawan
      calibrate();
    }
  }
}

// Beep at kurap ng LED na sabay. Mas malakas ang signal = mas mabilis.
void updateAlarm(bool anyDetected, long excess) {
  if (!anyDetected) {
    allOutputsOff();
    return;
  }
  // excess = gaano kalayo lumampas sa threshold. Hanggang 3x ng threshold = pinakamabilis.
  long full = (long)threshold * 3;
  if (excess > full) excess = full;
  if (excess < 0) excess = 0;
  int period = map(excess, 0, full, BEEP_SLOW_MS, BEEP_FAST_MS);

  if (millis() - lastBeep >= (unsigned long)period) {
    lastBeep = millis();
    buzzerOn = !buzzerOn;
  }
  digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);
  for (byte z = 0; z < NZONE; z++) {
    digitalWrite(LED_PIN[z], (detected[z] && buzzerOn) ? HIGH : LOW);
  }
}

void printStatus() {
  if (millis() - lastPrint < 200) return;
  lastPrint = millis();
  for (byte z = 0; z < NZONE; z++) {
    if (!ZONE_ON[z]) continue;
    Serial.print(ZONE_NAME[z]);
    Serial.print(F(": "));
    Serial.print(diffNow[z], 1);
    Serial.print(F(" /th "));
    Serial.print(zoneTh[z], 0);
    Serial.print(detected[z] ? F(" *METAL*  ") : F("  "));
    Serial.print(F("\t"));
  }
  Serial.print(F("knob: "));
  Serial.println(threshold);
}

void setup() {
  Serial.begin(115200);

  for (byte z = 0; z < NZONE; z++) {
    pinMode(PULSE_PIN[z], OUTPUT);
    digitalWrite(PULSE_PIN[z], LOW);
    pinMode(LED_PIN[z], OUTPUT);
    detected[z] = false;
    hitCount[z] = 0;
    diffNow[z] = 0;
  }
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Serial.println(F("Walk-through Metal Detector v6.2 (4 coil)"));
  readKnob();
  calibrate();
}

void loop() {
  readKnob();
  checkButton();

  bool anyDetected = false;
  long maxExcess = 0;

  for (byte z = 0; z < NZONE; z++) {
    if (!ZONE_ON[z]) { detected[z] = false; diffNow[z] = 0; continue; }

    float d = readZone(z);
    float absD = fabs(d);
    diffNow[z] = d;

    // Threshold ng coil na ito: knob, o mas mataas kung maingay ang paligid
    float th = noiseLevel[z] * NOISE_MARGIN;
    if (th > TH_MAX) th = TH_MAX;
    if (th < threshold) th = threshold;
    zoneTh[z] = th;

    if (!detected[z]) {
      // Kumpirmasyon: sunod-sunod na lampas at PAREHONG direksyon
      char sign = (d > 0) ? 1 : -1;
      if (absD > th) {
        if (hitCount[z] > 0 && sign != hitSign[z]) hitCount[z] = 0;
        hitSign[z] = sign;
        if (hitCount[z] < 255) hitCount[z]++;
      } else {
        hitCount[z] = 0;
      }
      detected[z] = (hitCount[z] >= CONFIRM);
      lowCount[z] = 0;
    } else if (absD < th * RELEASE_RATIO) {
      // Hysteresis: dito lang titigil ang beep
      if (++lowCount[z] >= RELEASE) {
        detected[z] = false;
        hitCount[z] = 0;
      }
    } else {
      lowCount[z] = 0;
    }

    // Auto-recalibrate: walang taong tumatayo sa gate nang 5 segundo,
    // kaya kung tuloy-tuloy ang METAL, malamang nagbago lang ang kondisyon.
    if (detected[z]) {
      if (detectStart[z] == 0) detectStart[z] = millis();
      else if (millis() - detectStart[z] > AUTO_RECAL_MS) {
        resetZone(z, lastRaw[z]);
        Serial.print(F(">> Auto-recalibrate: "));
        Serial.println(ZONE_NAME[z]);
      }
    } else {
      detectStart[z] = 0;
    }

    // Baseline at sukat ng ingay: ina-update lang kapag walang signal
    if (!detected[z] && hitCount[z] == 0) {
      if (absD < th * TRACK_ZONE) {
        baseline[z] += (lastRaw[z] - baseline[z]) * TRACK_K;
        noiseLevel[z] += (fabs(d - prevDiff[z]) - noiseLevel[z]) * NOISE_K;
      } else {
        baseline[z] += (lastRaw[z] - baseline[z]) * TRACK_K_SLOW;
      }
    }
    prevDiff[z] = d;

    if (detected[z]) {
      anyDetected = true;
      long ex = (long)(absD - th);
      if (ex > maxExcess) maxExcess = ex;
    }
  }

  updateAlarm(anyDetected, maxExcess);
  printStatus();
}
