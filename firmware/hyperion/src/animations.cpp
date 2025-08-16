/**
 * LED Animation Implementations
 */

#include "animations.h"
#include "led_driver.h"
#include "pico/stdlib.h"

// Pulse LEDs with a breathing effect
void pulsing()
{
    // Fade up
    for (int i = 0; i < 10000; i = i + 200)
    {
        allWhite(i);
        sleep_ms(1);
    }
    // Fade down
    for (int i = 10000; i > 0; i = i - 200)
    {
        allWhite(i);
        sleep_ms(1);
    }
}
