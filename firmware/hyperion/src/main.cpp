/**
 * RP2040 firmware for Macroblock MBI5043 16-channel LED driver chain
 *
 * Connections (from hyperion/elec/src/main.ato → DemoMatrix):
 *  - GPIO0 → SDI
 *  - GPIO1 ← SDO (unused in this firmware)
 *  - GPIO2 → DCLK
 *  - GPIO3 → GCLK
 *  - GPIO4 → LE (latch)
 *
 * Protocol (simplified):
 *  - Shift 12-bit grayscale values for all 16 channels of EVERY driver in the chain
 *    (send last device first), MSB-first per channel.
 *  - Pulse LE (high→low) to transfer shift register to output latches.
 *  - Provide 4096 GCLK pulses to run one PWM frame.
 *
 * This firmware cycles a uniform rainbow color across all pixels, using only the
 * RGB channels (white channel set to 0).
 */

#include <Arduino.h>

// --- Pin mapping (RP2040 Pico). If your board has DCLK/GCLK swapped, set SWAP_DCLK_GCLK to true.
static constexpr bool SWAP_DCLK_GCLK = true; // set to false if your wiring matches main.ato exactly
static constexpr uint8_t PIN_SDI  = 0;  // Serial Data In
static constexpr uint8_t PIN_SDO  = 1;  // Serial Data Out (input, not used)
static constexpr uint8_t PIN_DCLK = SWAP_DCLK_GCLK ? 3 : 2;  // Data Clock
static constexpr uint8_t PIN_GCLK = SWAP_DCLK_GCLK ? 2 : 3;  // Global Clock (PWM clock)
static constexpr uint8_t PIN_LE   = 4;  // Latch Enable

// --- Driver chain configuration ---
static constexpr uint8_t NUM_DRIVERS = 4;     // clusters[0..3]
static constexpr uint8_t NUM_CHANNELS = 16;   // OUT0..OUT15
static constexpr uint8_t GS_BITS = 12;        // 12-bit grayscale
static constexpr uint16_t GS_MAX = (1u << GS_BITS) - 1; // 4095

// MBI5043 requires 4096 GCLK pulses per grayscale frame
static constexpr uint16_t GCLK_PULSES_PER_FRAME = (1u << GS_BITS);

// Utility: fast digital write HIGH then LOW
inline void pulseHighLow(uint8_t pin) {
  digitalWrite(pin, HIGH);
  digitalWrite(pin, LOW);
}

// Shift one bit (MSB-first) into SDI with a DCLK pulse
inline void shiftBit(bool bit) {
  digitalWrite(PIN_SDI, bit ? HIGH : LOW);
  // Data is sampled on DCLK rising edge; use LOW→HIGH→LOW
  pulseHighLow(PIN_DCLK);
}

// Shift a value with a fixed bit width, MSB-first
inline void shiftBits(uint32_t value, uint8_t width) {
  for (int8_t i = width - 1; i >= 0; --i) {
    shiftBit((value >> i) & 0x1);
  }
}

// Latch sequence: LE high then low to transfer shift register into output latches
inline void latchOutputs() {
  // Some Macroblock parts latch on LE high->low, but require LE to be high
  // around a DCLK edge. Hold LE high briefly, pulse DCLK once, then low.
  digitalWrite(PIN_LE, HIGH);
  delayMicroseconds(1);
  pulseHighLow(PIN_DCLK);
  delayMicroseconds(1);
  digitalWrite(PIN_LE, LOW);
}

// Provide N global clock pulses to run the PWM engine
inline void gclkPulses(uint16_t count) {
  for (uint16_t i = 0; i < count; ++i) {
    pulseHighLow(PIN_GCLK);
  }
}

static void diagnosticPulse(uint8_t pin, uint8_t times, uint16_t high_ms, uint16_t low_ms) {
  pinMode(pin, OUTPUT);
  for (uint8_t i = 0; i < times; ++i) {
    digitalWrite(pin, HIGH);
    delay(high_ms);
    digitalWrite(pin, LOW);
    delay(low_ms);
  }
}

// Simple HSV→RGB conversion (0..360 hue, 0..1 sat/val) mapped to 0..GS_MAX
static void hsvToRgb(uint16_t hue_deg, float sat, float val,
                     uint16_t &r, uint16_t &g, uint16_t &b) {
  float h = fmodf(hue_deg, 360.0f) / 60.0f;
  int i = (int)floorf(h);
  float f = h - i;
  float p = val * (1.0f - sat);
  float q = val * (1.0f - sat * f);
  float t = val * (1.0f - sat * (1.0f - f));

  float rf, gf, bf;
  switch (i) {
    default:
    case 0: rf = val; gf = t;   bf = p;   break;
    case 1: rf = q;   gf = val; bf = p;   break;
    case 2: rf = p;   gf = val; bf = t;   break;
    case 3: rf = p;   gf = q;   bf = val; break;
    case 4: rf = t;   gf = p;   bf = val; break;
    case 5: rf = val; gf = p;   bf = q;   break;
  }
  r = (uint16_t)(rf * GS_MAX + 0.5f);
  g = (uint16_t)(gf * GS_MAX + 0.5f);
  b = (uint16_t)(bf * GS_MAX + 0.5f);
}

// Map RGB values into the 16 output channels for one driver based on wiring in main.ato
// Outputs per Cluster2x2 driver:
//  - Pixel(0,0): R→3, G→2, B→1, W→0
//  - Pixel(0,1): R→7, G→6, B→5, W→4
//  - Pixel(1,0): R→15, G→14, B→13, W→12
//  - Pixel(1,1): R→8, G→9,  B→10, W→11
static void fillDriverChannels(uint16_t r, uint16_t g, uint16_t b,
                               uint16_t channels[NUM_CHANNELS]) {
  // Zero-initialize
  for (uint8_t i = 0; i < NUM_CHANNELS; ++i) channels[i] = 0;
  // Pixel 0,0
  channels[3]  = r; channels[2]  = g; channels[1]  = b; // 0=white
  // Pixel 0,1
  channels[7]  = r; channels[6]  = g; channels[5]  = b;
  // Pixel 1,0
  channels[15] = r; channels[14] = g; channels[13] = b;
  // Pixel 1,1
  channels[8]  = r; channels[9]  = g; channels[10] = b;
  // White channels (0,4,12,11) remain 0
}

// Send one complete grayscale frame for the entire driver chain
// Order: send the last device first so data propagates down the chain
static void sendGrayscaleFrame(uint16_t drivers[NUM_DRIVERS][NUM_CHANNELS]) {
  // Keep LE low during shifting
  digitalWrite(PIN_LE, LOW);

  for (int d = NUM_DRIVERS - 1; d >= 0; --d) {
    // Channel order: OUT15 → OUT0 (conventional). If reversed on hardware, it
    // still lights uniformly since we fill all pixels the same color.
    for (int ch = NUM_CHANNELS - 1; ch >= 0; --ch) {
      uint16_t gs = drivers[d][ch];
      shiftBits(gs, GS_BITS); // MSB-first
    }
  }

  // Latch into output registers
  latchOutputs();
}

void setup() {
  // Configure pins
  pinMode(PIN_SDI, OUTPUT);
  pinMode(PIN_DCLK, OUTPUT);
  pinMode(PIN_GCLK, OUTPUT);
  pinMode(PIN_LE, OUTPUT);
  pinMode(PIN_SDO, INPUT);

  // Initialize low
  digitalWrite(PIN_SDI, LOW);
  digitalWrite(PIN_DCLK, LOW);
  digitalWrite(PIN_GCLK, LOW);
  digitalWrite(PIN_LE, LOW);

  // Startup diagnostics: clearly toggle each control pin so you can probe them
  diagnosticPulse(PIN_SDI,  4, 100, 100); // SDI on GPIO0
  diagnosticPulse(PIN_DCLK, 4, 100, 100); // DCLK on GPIO2
  diagnosticPulse(PIN_GCLK, 4, 100, 100); // GCLK on GPIO3
  diagnosticPulse(PIN_LE,   8, 150, 150); // LE   on GPIO4

  // Unique identification pulses: 1..4 blips per pin (slow) to map testpoints
  diagnosticPulse(PIN_SDI,  1, 300, 300);
  diagnosticPulse(PIN_DCLK, 2, 300, 300);
  diagnosticPulse(PIN_GCLK, 3, 300, 300);
  diagnosticPulse(PIN_LE,   4, 300, 300);

  // Sustained square waves for scope capture
  // DCLK ~2 kHz for 1 second
  for (uint32_t i = 0; i < 2000; ++i) {
    digitalWrite(PIN_DCLK, HIGH);
    delayMicroseconds(250);
    digitalWrite(PIN_DCLK, LOW);
    delayMicroseconds(250);
  }
  // GCLK ~2 kHz for 1 second
  for (uint32_t i = 0; i < 2000; ++i) {
    digitalWrite(PIN_GCLK, HIGH);
    delayMicroseconds(250);
    digitalWrite(PIN_GCLK, LOW);
    delayMicroseconds(250);
  }

  // Emit a visible LE strobe with DCLK alignment
  latchOutputs();
}

void loop() {
  static uint16_t hue = 0; // 0..359

  // Compute RGB from HSV
  uint16_t r, g, b;
  hsvToRgb(hue, 1.0f, 0.2f, r, g, b); // modest brightness

  // Build per-driver channel arrays (uniform color across all drivers)
  uint16_t drivers[NUM_DRIVERS][NUM_CHANNELS];
  for (uint8_t d = 0; d < NUM_DRIVERS; ++d) {
    fillDriverChannels(r, g, b, drivers[d]);
  }

  // Send frame and run one PWM period
  sendGrayscaleFrame(drivers);
  gclkPulses(GCLK_PULSES_PER_FRAME);

  // Advance hue for rainbow
  hue = (hue + 2) % 360;
}