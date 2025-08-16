/**
 * RP2040 firmware for Macroblock MBI5043 16-channel LED driver chain
 *
 * Main application entry point
 */

#include "pico/stdlib.h"
#include <stdio.h>
#include "led_driver.h"
#include "animations.h"

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

  // Initialize LED driver
  printf("\nInitializing LED driver...\n");
  led_driver_init();

  // Main loop
  printf("Starting animation loop...\n");
  while (true)
  {
    pulsing(0.5); // Run pulsing animation
  }

  return 0;
}
