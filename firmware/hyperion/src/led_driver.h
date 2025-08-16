/**
 * MBI5043 LED Driver Interface
 *
 * Controls a chain of MBI5043 16-channel LED drivers
 */

#ifndef LED_DRIVER_H
#define LED_DRIVER_H

#include <stdint.h>

// Pin mapping
static constexpr uint8_t PIN_SDI = 0;  // GPIO0 → SDI (Data to first driver)
static constexpr uint8_t PIN_DCLK = 1; // GPIO1 → DCLK (Data Clock)
static constexpr uint8_t PIN_GCLK = 2; // GPIO2 → GCLK (Global Clock)
static constexpr uint8_t PIN_LE = 3;   // GPIO3 → LE (Latch Enable)
static constexpr uint8_t PIN_SDO = 4;  // GPIO4 ← SDO (Data from last driver)

// Driver chain configuration
static constexpr uint8_t NUM_DRIVERS = 4;                // 4 MBI5043 drivers in chain
static constexpr uint8_t NUM_CHANNELS = 16;              // 16 outputs per driver (OUT0..OUT15)
static constexpr uint8_t GS_BITS = 16;                   // 16-bit grayscale per channel
static constexpr uint16_t GS_MAX = 0xFFFF;               // Maximum value (65535)
static constexpr uint16_t GS_50_PERCENT = 0x8000;        // 50% brightness (32768)
static constexpr uint16_t GCLK_PULSES_PER_FRAME = 65536; // One complete PWM cycle for 16-bit

// Initialize the LED driver hardware
void led_driver_init();

// Low-level shift operations
void shiftBit(bool bit);
void shiftValue(uint16_t value, uint8_t bits);

// Control operations
void latchData();
void outputData();

// High-level operations
void clearRegisters();
void allWhite(uint16_t brightness);

// PWM control
void setup_pwm(uint gpio, uint32_t freq, uint8_t duty_percent);

#endif // LED_DRIVER_H
