/**
 * LED Animation Functions
 */

#ifndef ANIMATIONS_H
#define ANIMATIONS_H

#include <stdint.h>

// RGBW color structure
typedef struct {
    uint16_t r;
    uint16_t g;
    uint16_t b;
    uint16_t w;
} rgbw_color_t;

// Pulse LEDs with a breathing effect
void pulsing(float frequency);

// Checkerboard pattern that alternates between two colors
void checkerboard_flash(rgbw_color_t color1, rgbw_color_t color2, uint32_t interval_ms);

// Turn off all LEDs
void off();

#endif // ANIMATIONS_H
