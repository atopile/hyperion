/**
 * LED Animation Functions
 */

#ifndef ANIMATIONS_H
#define ANIMATIONS_H

#include <stdint.h>

// WBGR color structure (matching hardware channel order)
typedef struct {
    uint16_t w;  // White - channel 0
    uint16_t b;  // Blue  - channel 1  
    uint16_t g;  // Green - channel 2
    uint16_t r;  // Red   - channel 3
} rgbw_color_t;

// Pulse LEDs with a breathing effect
void pulsing(float frequency);

// Checkerboard pattern that alternates between two colors
void checkerboard_flash(rgbw_color_t color1, rgbw_color_t color2, uint32_t interval_ms);

// Strobe effect - flash on and off at specified BPM
void strobe(rgbw_color_t color, float bpm);

// Turn off all LEDs
void off();

#endif // ANIMATIONS_H
