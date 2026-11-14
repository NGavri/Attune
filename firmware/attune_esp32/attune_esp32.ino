// Attune firmware - ESP32-DevKitC ("ESP32 Dev Module")
// Pulse sensor on GPIO34, Grove GSR on GPIO35. Serial 115200.
// Sends:  D,<ms>,<pulse_raw>,<gsr_avg>   every 20 ms
//         B,<ms>,<ibi_ms>,<bpm>          on each heartbeat
//         S,<message>                    status

const int      PULSE_PIN     = 34;
const int      GSR_PIN       = 35;
const uint32_t SAMPLE_US     = 2000;   // read both sensors every 2 ms (500 Hz)
const uint32_t SEND_MS       = 20;     // send a D line every 20 ms (50 Hz)
const int      GSR_AVG_N     = 25;     // 25 x 2 ms = 50 ms = 3 cycles of 60 Hz hum
const float    THRESH_FRAC   = 0.6;    // beat threshold: 60% between trough and peak
const float    DECAY         = 0.001;  // how fast peak/trough adapt (per sample)
const uint32_t REFRACTORY_MS = 300;    // no two beats closer than 300 ms (max 200 bpm)
const uint32_t IBI_MIN       = 300;
const uint32_t IBI_MAX       = 1500;   // min 40 bpm
const int      FLAT_COUNTS   = 50;     // pulse swing below this = no finger
const uint32_t FLAT_MS       = 3000;

// GSR rolling average
int  gsrBuf[GSR_AVG_N];
long gsrSum = 0;
int  gsrIdx = 0, gsrCount = 0;

// Pulse beat detection
float    peak = 0, trough = 0;
bool     above = false, haveBeat = false, envInit = false;
uint32_t lastBeatMs = 0;
int      lastPulse = 0;

// Finger detection
uint32_t flatSinceMs = 0;
bool     flatReported = false;

// Timing
uint32_t lastSampleUs = 0, lastSendMs = 0;

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);              // values 0-4095
  delay(200);
  Serial.println("S,ready");
  lastSampleUs = micros();
  lastSendMs   = millis();
  flatSinceMs  = millis();
}

void loop() {
  uint32_t nowUs = micros();

  // ---------- 1. Sample both sensors every 2 ms ----------
  if (nowUs - lastSampleUs >= SAMPLE_US) {
    lastSampleUs += SAMPLE_US;
    if (nowUs - lastSampleUs > 10 * SAMPLE_US) lastSampleUs = nowUs;  // resync if we fell behind
    uint32_t nowMs = millis();

    int p = analogRead(PULSE_PIN);
    int g = analogRead(GSR_PIN);
    lastPulse = p;

    // GSR: rolling average over the last 25 samples (cancels mains hum)
    gsrSum -= gsrBuf[gsrIdx];
    gsrBuf[gsrIdx] = g;
    gsrSum += g;
    gsrIdx = (gsrIdx + 1) % GSR_AVG_N;
    if (gsrCount < GSR_AVG_N) gsrCount++;

    // Pulse: peak/trough envelope that jumps to new extremes and slowly relaxes
    if (!envInit) { peak = trough = p; envInit = true; }
    if (p > peak)   peak = p;   else peak   -= (peak - p) * DECAY;
    if (p < trough) trough = p; else trough += (p - trough) * DECAY;
    float range  = peak - trough;
    float thresh = trough + THRESH_FRAC * range;

    // No-finger check: signal too flat for 3 s
    if (range < FLAT_COUNTS) {
      if (!flatReported && nowMs - flatSinceMs >= FLAT_MS) {
        Serial.println("S,no_finger");
        flatReported = true;
        haveBeat = false;
      }
    } else {
      flatSinceMs = nowMs;
      if (flatReported) { Serial.println("S,finger_ok"); flatReported = false; }
    }

    // Beat = signal rising through the threshold (with hysteresis)
    if (!above && p > thresh && range >= FLAT_COUNTS) {
      above = true;
      if (nowMs - lastBeatMs >= REFRACTORY_MS) {
        if (haveBeat) {
          uint32_t ibi = nowMs - lastBeatMs;
          if (ibi >= IBI_MIN && ibi <= IBI_MAX) {
            int bpm = (int)(60000.0 / ibi + 0.5);
            Serial.printf("B,%lu,%lu,%d\n", (unsigned long)nowMs, (unsigned long)ibi, bpm);
          }
        }
        lastBeatMs = nowMs;
        haveBeat = true;
      }
    } else if (above && p < trough + 0.4 * range) {
      above = false;
    }
  }

  // ---------- 2. Send a D line every 20 ms ----------
  uint32_t nowMs = millis();
  if (nowMs - lastSendMs >= SEND_MS) {
    lastSendMs += SEND_MS;
    long gsrAvg = gsrCount ? gsrSum / gsrCount : 0;
    Serial.printf("D,%lu,%d,%ld\n", (unsigned long)nowMs, lastPulse, gsrAvg);
  }
}