/**
 * RP2040 firmware for Macroblock MBI5043 16-channel LED driver chain
 *
 * Main application entry point
 */

#include "pico/stdlib.h"
#include "hardware/gpio.h"
#include "hardware/sync.h"
#include "hardware/structs/ioqspi.h"
#include "hardware/structs/sio.h"
#include <stdio.h>
#include "led_driver.h"
#include "animations.h"

// Boot button - connected to BOOTSEL via QSPI_SS
// Note: On most RP2040 boards, the BOOTSEL button pulls QSPI_SS low when pressed
#define BOOTSEL_BUTTON 1 // Use the SDK's BOOTSEL detection

// Animation modes
enum AnimationMode
{
  MODE_PULSING = 0,
  MODE_CHECKERBOARD,
  MODE_STROBE,
  MODE_ALTERNATING_STROBE,
  MODE_OFF,
  NUM_MODES
};

// Global state
volatile AnimationMode current_mode = MODE_ALTERNATING_STROBE;
volatile uint32_t last_button_time = 0;
const uint32_t DEBOUNCE_MS = 200; // Debounce time in milliseconds

// Check if BOOTSEL button is pressed
// This uses the recommended Pico SDK method
bool __no_inline_not_in_flash_func(is_bootsel_pressed)()
{
  const uint CS_PIN_INDEX = 1; // QSPI_SS

  // Must disable interrupts while reading button
  uint32_t flags = save_and_disable_interrupts();

  // Set chip select high to access the button
  hw_write_masked(&ioqspi_hw->io[CS_PIN_INDEX].ctrl,
                  GPIO_OVERRIDE_LOW << IO_QSPI_GPIO_QSPI_SS_CTRL_OUTOVER_LSB,
                  IO_QSPI_GPIO_QSPI_SS_CTRL_OUTOVER_BITS);

  // Read the button state (the button pulls the pin low when pressed)
  bool button_state = !(sio_hw->gpio_hi_in & (1u << CS_PIN_INDEX));

  // Restore chip select to normal SPI mode
  hw_write_masked(&ioqspi_hw->io[CS_PIN_INDEX].ctrl,
                  GPIO_OVERRIDE_NORMAL << IO_QSPI_GPIO_QSPI_SS_CTRL_OUTOVER_LSB,
                  IO_QSPI_GPIO_QSPI_SS_CTRL_OUTOVER_BITS);

  restore_interrupts(flags);

  return button_state;
}

// Check button and handle mode switching
void check_button()
{
  uint32_t now = to_ms_since_boot(get_absolute_time());

  // Check if enough time has passed for debouncing
  if (now - last_button_time < DEBOUNCE_MS)
  {
    return;
  }

  if (is_bootsel_pressed())
  {
    // Button is pressed, switch to next mode
    current_mode = (AnimationMode)((current_mode + 1) % NUM_MODES);
    last_button_time = now;

    // Print mode change
    switch (current_mode)
    {
    case MODE_PULSING:
      printf("Switched to: PULSING mode\n");
      break;
    case MODE_CHECKERBOARD:
      printf("Switched to: CHECKERBOARD mode\n");
      break;
    case MODE_STROBE:
      printf("Switched to: STROBE mode (174 BPM)\n");
      break;
    case MODE_OFF:
      printf("Switched to: OFF mode\n");
      break;
    }
  }
}

int main()
{
  // Arduino framework handles stdio initialization automatically
  sleep_ms(3000); // Wait for USB serial to connect

  printf("\n=== MBI5043 LED Matrix Controller ===\n");
  printf("  GPIO0 → SDI (Data to LEDs)\n");
  printf("  GPIO1 → DCLK (Data Clock)\n");
  printf("  GPIO2 → GCLK (Global Clock)\n");
  printf("  GPIO3 → LE (Latch)\n");
  printf("  GPIO4 ← SDO (Data from LEDs)\n");

  // Initialize LED driver
  printf("\nInitializing LED driver...\n");
  led_driver_init();

  // Main loop
  printf("Starting animation loop...\n");
  printf("Press BOOTSEL button to change animation mode\n");

  // Animation colors for checkerboard
  rgbw_color_t atopile_orange = {0x0, 0x15 / 4, 0x50 / 4, 0xF9 / 4};
  rgbw_color_t white = {0xFFFF / 4, 0, 0, 0};
  rgbw_color_t white_white = {0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF}; // Full brightness WHITE_WHITE
  rgbw_color_t warm_white = {0xFFFF, 0, 0, 0};
  rgbw_color_t rgb_white = {0, 0xFFFF, 0xFFFF, 0xFFFF};
  rgbw_color_t blue = {0, 0xFFFF, 0, 0};
  rgbw_color_t green = {0, 0, 0xFFFF, 0};
  rgbw_color_t red = {0, 0, 0, 0xFFFF};

  while (true)
  {
    // Check button for mode change
    // check_button();

    // Run animation based on current mode
    switch (current_mode)
    {
    case MODE_PULSING:
      pulsing(0.2); // 0.2 Hz = 5 second cycle
      break;

    case MODE_CHECKERBOARD:
      checkerboard_flash(atopile_orange, white, 500);
      break;

    case MODE_STROBE:
      strobe(warm_white, 174.0f); // 174 BPM strobe
      break;

    case MODE_ALTERNATING_STROBE:
      strobe(warm_white, 174.0f / 2);
      strobe(white_white, 174.0f / 2);
      strobe(rgb_white, 174.0f / 2);
      strobe(red, 174.0f / 2);
      strobe(green, 174.0f / 2);
      strobe(blue, 174.0f / 2);
      break;

    case MODE_OFF:
      off();
      break;
    }
  }

  return 0;
}
