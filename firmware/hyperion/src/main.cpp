/**
 * RP2040 firmware for Macroblock MBI5043 16-channel LED driver chain
 *
 * Pin Connections:
 *  - GPIO0 → SDI (Serial Data Input to first driver)
 *  - GPIO1 → DCLK (Data Clock)
 *  - GPIO2 → GCLK (Global Clock for PWM)
 *  - GPIO3 → LE (Latch Enable)
 *  - GPIO4 ← SDO (Serial Data Output from last driver)
 *
 * MBI5043 Protocol:
 *  - Shift 12-bit grayscale values for all 16 channels × 4 drivers
 *  - Data format: MSB first, last driver data sent first
 *  - After shifting all data, pulse LE to latch
 *  - Provide GCLK pulses for PWM generation
 */

#include <Arduino.h>

// --- Pin mapping per user specification ---
static constexpr uint8_t PIN_SDI  = 0;  // GPIO0 → SDI (Data to first driver)
static constexpr uint8_t PIN_DCLK = 1;  // GPIO1 → DCLK (Data Clock)
static constexpr uint8_t PIN_GCLK = 2;  // GPIO2 → GCLK (Global Clock)
static constexpr uint8_t PIN_LE   = 3;  // GPIO3 → LE (Latch Enable)
static constexpr uint8_t PIN_SDO  = 4;  // GPIO4 ← SDO (Data from last driver)

// --- Driver chain configuration ---
static constexpr uint8_t NUM_DRIVERS = 4;     // 4 MBI5043 drivers in chain
static constexpr uint8_t NUM_CHANNELS = 16;   // 16 outputs per driver (OUT0..OUT15)
static constexpr uint8_t GS_BITS = 16;        // 16-bit grayscale per channel
static constexpr uint16_t GS_MAX = 0xFFFF;    // Maximum value (65535)
static constexpr uint16_t GS_50_PERCENT = 0x8000; // 50% brightness (32768)
static constexpr uint16_t GCLK_PULSES_PER_FRAME = 65536; // One complete PWM cycle for 16-bit

// Shift one bit into the chain (data sampled on DCLK rising edge)
inline void shiftBit(bool bit) {
  digitalWrite(PIN_SDI, bit ? HIGH : LOW);
  delayMicroseconds(1);  // Setup time
  digitalWrite(PIN_DCLK, HIGH);
  delayMicroseconds(1);  // Hold time
  digitalWrite(PIN_DCLK, LOW);
  delayMicroseconds(1);
}

// Shift a multi-bit value MSB first
void shiftValue(uint16_t value, uint8_t bits) {
  for (int8_t i = bits - 1; i >= 0; i--) {
    shiftBit((value >> i) & 0x01);
  }
}

// Shift one bit into the chain (data sampled on DCLK rising edge)
inline void shiftBitGrey(bool bit) {
  digitalWrite(PIN_SDI, bit ? HIGH : LOW);
  delayMicroseconds(1);  // Setup time
  digitalWrite(PIN_GCLK, HIGH);
  delayMicroseconds(1);  // Hold time
  digitalWrite(PIN_GCLK, LOW);
  delayMicroseconds(1);
}

// Shift a multi-bit value MSB first
void shiftValueGrey(uint16_t value, uint8_t bits) {
  for (int8_t i = bits - 1; i >= 0; i--) {
    shiftBitGrey((value >> i) & 0x01);
  }
}

// Latch data from shift registers (1 CLK pulse with LE high)
void latchData() {
  // Latch data: LE high with 1 GCLK rising edge
  digitalWrite(PIN_DCLK, LOW);
  delayMicroseconds(2);
  
  // Raise LE
  digitalWrite(PIN_LE, HIGH);
  delayMicroseconds(2);
  
  // Generate 1 GCLK rising edge while LE is high to latch data
  digitalWrite(PIN_DCLK, HIGH);
  delayMicroseconds(2);
  digitalWrite(PIN_DCLK, LOW);
  delayMicroseconds(2);
  
  // Lower LE to complete latch
  digitalWrite(PIN_LE, LOW);
  delayMicroseconds(2);
}

// Send data to outputs (3 GCLK pulses with LE high)
void outputData() {
  // Output data: LE high with 3 GCLK pulses
  digitalWrite(PIN_DCLK, LOW);
  delayMicroseconds(2);
  
  // Raise LE
  digitalWrite(PIN_LE, HIGH);
  delayMicroseconds(2);
  
  // Generate 3 GCLK pulses while LE is high to send data to outputs
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_DCLK, HIGH);
    delayMicroseconds(2);
    digitalWrite(PIN_DCLK, LOW);
    delayMicroseconds(2);
  }
  
  // Lower LE to complete output
  digitalWrite(PIN_LE, LOW);
  delayMicroseconds(2);
}

// Generate GCLK pulses for PWM operation
void generateGCLK(uint16_t pulses) {
  for (uint16_t i = 0; i < pulses; i++) {
    digitalWrite(PIN_GCLK, HIGH);
    delayMicroseconds(1);
    digitalWrite(PIN_GCLK, LOW);
    delayMicroseconds(1);
  }
}

// Clear all shift registers
void clearRegisters() {
  // Shift zeros through all registers
  for (uint16_t i = 0; i < NUM_DRIVERS * NUM_CHANNELS * GS_BITS; i++) {
    shiftBit(false);
  }
  latchData();
  outputData();
}

// Set all LEDs to a specific brightness
void setLEDBrightness(uint16_t brightness) {
  // Shift data for all 4 drivers (last driver first)
  // Each driver: 16 channels × 16 bits = 256 bits
  // for (int channel = NUM_CHANNELS - 1; channel >= 0; channel--) {
  //   for (int driver = NUM_DRIVERS - 1; driver >= 0; driver--) {
  //   // Send 16-bit brightness value for each of 16 channels, MSB first
  //     shiftValueGrey(brightness, 16);
  //     delayMicroseconds(10);
  //   }
  //   latchGrey();
  //   delayMicroseconds(10);
  // }
  
  // Step 1: Latch the data (1 GCLK pulse with LE high)
  
  // Step 2: Send data to outputs (3 GCLK pulses with LE high);
  digitalWrite(PIN_GCLK, HIGH);
  digitalWrite(PIN_GCLK, LOW);
}

// Toggle LEDs on and off
void toggleLeds() {
  bool ledState = false;
  
  Serial.println("Starting LED toggle pattern...");
  Serial.println("LEDs will turn on (50%) and off every second");
  
  while (true) {
    if (ledState) {
      Serial.println("LEDs ON at 50% brightness");
      setLEDBrightness(GS_50_PERCENT);  // Turn on at 50%
    } else {
      Serial.println("LEDs OFF");
      setLEDBrightness(0x0000);  // Turn off
    }
    
    // Generate GCLK pulses for PWM for this state
    for (int i = 0; i < 100; i++) {  // Run for ~1 second
      generateGCLK(GCLK_PULSES_PER_FRAME);
      delayMicroseconds(100);
    }
    
    // Toggle state
    ledState = !ledState;
  }
}

void allBlack() {
  for (int i = 0; i < 16; i++){
    for (int i = 0; i < 4; i++) {
      shiftValue(0,16);
      delayMicroseconds(10);
    }
    latchData();
  }
  
  delayMicroseconds(10);
  outputData();
}

void allWhite() {
  for (int i = 0; i < 16; i++) {
    for (int i = 0; i < 4; i++) {
      shiftValue(200,16);
      delayMicroseconds(10);
      latchData();
    }
    // shiftValue(65535,16);
    // delayMicroseconds(10);
    // shiftValue(65535,16);
    // delayMicroseconds(10);
    // delayMicroseconds(10);
    delayMicroseconds(10);
  }
  
  delay(1);
  outputData();
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000); // Wait for serial
  delay(100);
  
  Serial.println("\n=== MBI5043 LED Matrix Controller ===");
  Serial.println("4 drivers × 16 channels each");
  Serial.println("Pin mapping:");
  Serial.println("  GPIO0 → SDI (Data to LEDs)");
  Serial.println("  GPIO1 → DCLK (Data Clock)");
  Serial.println("  GPIO2 → GCLK (Global Clock)");
  Serial.println("  GPIO3 → LE (Latch)");
  Serial.println("  GPIO4 ← SDO (Data from LEDs)");
  
  // Configure all pins
  pinMode(PIN_SDI, OUTPUT);
  pinMode(PIN_DCLK, OUTPUT);
  pinMode(PIN_GCLK, OUTPUT);
  pinMode(PIN_LE, OUTPUT);
  pinMode(PIN_SDO, INPUT);
  
  // Initialize all outputs LOW
  digitalWrite(PIN_SDI, LOW);
  digitalWrite(PIN_DCLK, LOW);
  digitalWrite(PIN_GCLK, LOW);
  digitalWrite(PIN_LE, LOW);
  
  Serial.println("\nInitializing...");
  delay(100);
  
  // Clear all registers first
  // Serial.println("Clearing shift registers...");
  // clearRegisters();
  allBlack();
  delay(1000);
  allWhite();
  delay(1000);
  // setLEDBrightness(10);


  
  // Start toggling LEDs on and off
  // toggleLeds();
}

void loop() {
  // Everything is handled in allLedsOn() which runs continuously
  // This should never be reached
  setLEDBrightness(10);
}