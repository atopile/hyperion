/**
 * LED Animation Implementations
 */

#include "animations.h"
#include "led_driver.h"
#include "pico/stdlib.h"

static constexpr int NUM_ROWS = 4;
static constexpr int NUM_COLS = 4;
static constexpr int NUM_COLORS = 4;
static constexpr int NUM_PIXELS = NUM_ROWS * NUM_COLS * NUM_COLORS;
static constexpr int MAX_BRIGHTNESS = 0xFFFF;

// Pulse LEDs with a breathing effect
void pulsing(float frequency)
{
    led_image_t image;

    // Fade up
    for (int brightness = 0; brightness < MAX_BRIGHTNESS; brightness += MAX_BRIGHTNESS / frequency)
    {
        // Set all pixels to the same brightness (white - all colors equal)
        for (int row = 0; row < NUM_ROWS; row++)
        {
            for (int col = 0; col < NUM_COLS; col++)
            {
                for (int color = 0; color < NUM_COLORS; color++)
                {
                    image[row][col][color] = brightness;
                }
            }
        }
        set_image(image);
        sleep_ms(1000 / frequency);
    }

    // Fade down
    for (int brightness = MAX_BRIGHTNESS; brightness > 0; brightness -= MAX_BRIGHTNESS / frequency)
    {
        // Set all pixels to the same brightness (white - all colors equal)
        for (int row = 0; row < NUM_ROWS; row++)
        {
            for (int col = 0; col < NUM_COLS; col++)
            {
                for (int color = 0; color < NUM_COLORS; color++)
                {
                    image[row][col][color] = brightness;
                }
            }
        }
        set_image(image);
        sleep_ms(1000 / frequency);
    }
}
