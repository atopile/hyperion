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
static constexpr uint8_t NUM_DRIVERS = 4;                 // 4 MBI5043 drivers in chain
static constexpr uint8_t NUM_CHANNELS = 16;               // 16 outputs per driver (OUT0..OUT15)
static constexpr uint8_t GS_BITS = 16;                    // 16-bit grayscale per channel
static constexpr uint16_t GS_MAX = 0xFFFF;                // Maximum value (65535)
static constexpr uint16_t GS_50_PERCENT = 0x8000;         // 50% brightness (32768)
static constexpr uint16_t GS_25_PERCENT = 0x4000;         // 25% brightness (16384)
static constexpr uint16_t GS_1_PERCENT = 0x0400;          // ~1.5% brightness (1024)
static constexpr uint16_t GCLK_PULSES_PER_FRAME = 0xFFFF; // One complete PWM cycle for 16-bit

// Matrix configuration
static constexpr uint8_t NUM_ROWS = 4;
static constexpr uint8_t NUM_COLS = 4;
static constexpr uint8_t NUM_COLORS = 4;
static constexpr uint8_t NUM_PIXELS = NUM_ROWS * NUM_COLS * NUM_COLORS;
static constexpr uint8_t ROWS_PER_DRIVER = 2; // Each driver handles 2x2 pixels
static constexpr uint8_t COLS_PER_DRIVER = 2;
static constexpr uint8_t DRIVERS_PER_ROW = NUM_COLS / COLS_PER_DRIVER; // 2 drivers per row

// Initialize the LED driver hardware
void led_driver_init();

// Low-level shift operations
void shiftBit(bool bit);
void shiftValue(uint16_t value, uint8_t bits);

// Control operations
void latchData();
void outputData();

// Image type definition: 4x4x4 array of 16-bit values
// Dimensions: [row][column][color] - 4 rows, 4 columns, 4 color channels (RGBW)
typedef uint16_t led_image_t[4][4][4];

// High-level operations
void clear_registers();

// Set the entire LED matrix from an image array
void set_image(const led_image_t &image);

// PWM control
void setup_pwm(int gpio, uint32_t freq, uint8_t duty_percent);

#endif // LED_DRIVER_H
