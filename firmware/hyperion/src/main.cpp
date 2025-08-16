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

#include "pico/stdlib.h"
#include "hardware/gpio.h"
#include "hardware/pwm.h"
#include <stdio.h>

// --- Pin mapping per user specification ---
static constexpr uint8_t PIN_SDI = 0;  // GPIO0 → SDI (Data to first driver)
static constexpr uint8_t PIN_DCLK = 1; // GPIO1 → DCLK (Data Clock)
static constexpr uint8_t PIN_GCLK = 2; // GPIO2 → GCLK (Global Clock)
static constexpr uint8_t PIN_LE = 3;   // GPIO3 → LE (Latch Enable)
static constexpr uint8_t PIN_SDO = 4;  // GPIO4 ← SDO (Data from last driver)

// --- Driver chain configuration ---
static constexpr uint8_t NUM_DRIVERS = 4;                // 4 MBI5043 drivers in chain
static constexpr uint8_t NUM_CHANNELS = 16;              // 16 outputs per driver (OUT0..OUT15)
static constexpr uint8_t GS_BITS = 16;                   // 16-bit grayscale per channel
static constexpr uint16_t GS_MAX = 0xFFFF;               // Maximum value (65535)
static constexpr uint16_t GS_50_PERCENT = 0x8000;        // 50% brightness (32768)
static constexpr uint16_t GCLK_PULSES_PER_FRAME = 65536; // One complete PWM cycle for 16-bit

// Shift one bit into the chain (data sampled on DCLK rising edge)
inline void shiftBit(bool bit)
{
  gpio_put(PIN_SDI, bit);
  sleep_us(1); // Setup time
  gpio_put(PIN_DCLK, 1);
  sleep_us(1); // Hold time
  gpio_put(PIN_DCLK, 0);
  sleep_us(1);
}

// Shift a multi-bit value MSB first
void shiftValue(uint16_t value, uint8_t bits)
{
  for (int8_t i = bits - 1; i >= 0; i--)
  {
    shiftBit((value >> i) & 0x01);
  }
}

// Latch data from shift registers (1 CLK pulse with LE high)
void latchData()
{
  // Latch data: LE high with 1 GCLK rising edge
  gpio_put(PIN_DCLK, 0);
  sleep_us(2);

  // Raise LE
  gpio_put(PIN_LE, 1);
  sleep_us(2);

  // Generate 1 GCLK rising edge while LE is high to latch data
  gpio_put(PIN_DCLK, 1);
  sleep_us(2);
  gpio_put(PIN_DCLK, 0);
  sleep_us(2);

  // Lower LE to complete latch
  gpio_put(PIN_LE, 0);
  sleep_us(2);
}

// Send data to outputs (3 GCLK pulses with LE high)
void outputData()
{
  // Output data: LE high with 3 GCLK pulses
  gpio_put(PIN_DCLK, 0);
  sleep_us(2);

  // Raise LE
  gpio_put(PIN_LE, 1);
  sleep_us(2);

  // Generate 3 GCLK pulses while LE is high to send data to outputs
  for (int i = 0; i < 3; i++)
  {
    gpio_put(PIN_DCLK, 1);
    sleep_us(2);
    gpio_put(PIN_DCLK, 0);
    sleep_us(2);
  }

  // Lower LE to complete output
  gpio_put(PIN_LE, 0);
  sleep_us(2);
}

// Clear all shift registers
void clearRegisters()
{
  for (int i = 0; i < 16; i++)
  {
    for (int j = 0; j < 4; j++)
    {
      // shiftValue(brightness,16);
      // sleep_us(10);
      shiftValue(0, 16);
      sleep_us(10);
    }
    latchData();
    sleep_us(10);
  }
  sleep_us(10);
  outputData();
}

void allWhite(uint16_t brightness)
{
  for (int i = 0; i < 16; i++)
  {
    for (int j = 0; j < 4; j++)
    {
      // shiftValue(brightness,16);
      // sleep_us(10);
      if (i == 2)
      {
        shiftValue(brightness, 16);
        sleep_us(10);
      }
      else
      {
        shiftValue(0, 16);
        sleep_us(10);
      }
    }
    latchData();
    sleep_us(10);
  }

  sleep_ms(1);
  outputData();
}

// Setup PWM on a GPIO pin
void setup_pwm(uint gpio, uint32_t freq, uint8_t duty_percent)
{
  gpio_set_function(gpio, GPIO_FUNC_PWM);
  uint slice_num = pwm_gpio_to_slice_num(gpio);

  // Calculate divisor for desired frequency
  // PWM clock is 125MHz by default
  float clkdiv = 125000000.0f / (freq * 65536);
  pwm_set_clkdiv(slice_num, clkdiv);

  // Set period to maximum for best resolution
  pwm_set_wrap(slice_num, 65535);

  // Set duty cycle (0-65535)
  uint16_t level = (65535 * duty_percent) / 100;
  pwm_set_gpio_level(gpio, level);

  // Enable PWM
  pwm_set_enabled(slice_num, true);
}

void pulsing()
{
  for (int i = 0; i < 10000; i = i + 200)
  {
    allWhite(i);
    sleep_ms(1);
  }
  for (int i = 10000; i > 0; i = i - 200)
  {
    allWhite(i);
    sleep_ms(1);
  }
}

int main()
{
  stdio_init_all();
  sleep_ms(3000); // Wait for USB serial

  printf("\n=== MBI5043 LED Matrix Controller ===\n");
  printf("  GPIO0 → SDI (Data to LEDs)\n");
  printf("  GPIO1 → DCLK (Data Clock)\n");
  printf("  GPIO2 → GCLK (Global Clock)\n");
  printf("  GPIO3 → LE (Latch)\n");
  printf("  GPIO4 ← SDO (Data from LEDs)\n");

  // Configure all pins
  gpio_init(PIN_SDI);
  gpio_set_dir(PIN_SDI, GPIO_OUT);
  gpio_init(PIN_DCLK);
  gpio_set_dir(PIN_DCLK, GPIO_OUT);
  gpio_init(PIN_GCLK);
  gpio_set_dir(PIN_GCLK, GPIO_OUT);
  gpio_init(PIN_LE);
  gpio_set_dir(PIN_LE, GPIO_OUT);
  gpio_init(PIN_SDO);
  gpio_set_dir(PIN_SDO, GPIO_IN);

  // PWM for the greyscale clock
  setup_pwm(PIN_GCLK, 800000, 50); // 800kHz, 50% duty cycle

  // Initialize all outputs LOW
  gpio_put(PIN_SDI, 0);
  gpio_put(PIN_DCLK, 0);
  // GCLK is controlled by PWM now
  gpio_put(PIN_LE, 0);

  printf("\nInitializing...\n");
  sleep_ms(100);

  // Clear all registers first
  printf("Clearing shift registers...\n");
  clearRegisters();

  // Main loop - empty as pulsing() or other functions can be called here
  while (true)
  {
    // pulsing(); // Uncomment to enable pulsing
    sleep_ms(1000);
  }

  return 0;
}
