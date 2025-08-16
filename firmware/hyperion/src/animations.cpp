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

static constexpr int RED = 0;
static constexpr int GREEN = 1;
static constexpr int BLUE = 2;
static constexpr int WHITE = 3;

static constexpr rgbw_color_t BLACK = {0, 0, 0, 0};
static constexpr rgbw_color_t WHITE = {0, 0, 0, MAX_BRIGHTNESS};
static constexpr rgbw_color_t WHITE_WHITE = {MAX_BRIGHTNESS, MAX_BRIGHTNESS, MAX_BRIGHTNESS, MAX_BRIGHTNESS};

// Set a single pixel to an RGBW color
void set_pixel(led_image_t &image, int row, int col, rgbw_color_t color)
{
    image[row][col][RED] = color.r;
    image[row][col][GREEN] = color.g;
    image[row][col][BLUE] = color.b;
    image[row][col][WHITE] = color.w;
}

// Set all pixels to the same color
void set_all_pixels(led_image_t &image, rgbw_color_t color)
{
    for (int row = 0; row < NUM_ROWS; row++)
    {
        for (int col = 0; col < NUM_COLS; col++)
        {
            set_pixel(image, row, col, color);
        }
    }
}

// Clear the entire image (set all channels to 0)
void clear_image(led_image_t &image)
{
    set_all_pixels(image, BLACK);
}

// Pulse LEDs with a breathing effect
void pulsing(float frequency)
{
    led_image_t image;

    // Fade up
    for (uint16_t brightness = 0; brightness < MAX_BRIGHTNESS; brightness += MAX_BRIGHTNESS / frequency)
    {
        set_all_pixels(image, WHITE_WHITE);
        set_image(image);
        sleep_ms(1000 / frequency);
    }

    // Fade down
    for (uint16_t brightness = MAX_BRIGHTNESS; brightness > 0; brightness -= MAX_BRIGHTNESS / frequency)
    {
        set_all_pixels(image, WHITE_WHITE);
        set_image(image);
        sleep_ms(1000 / frequency);
    }
}

// Checkerboard pattern that alternates between two colors
void checkerboard_flash(rgbw_color_t color1, rgbw_color_t color2, uint32_t interval_ms)
{
    led_image_t image;

    // Pattern 1: Start with color1 on even squares, color2 on odd squares
    clear_image(image);
    for (int row = 0; row < NUM_ROWS; row++)
    {
        for (int col = 0; col < NUM_COLS; col++)
        {
            // Checkerboard logic: (row + col) % 2 determines the pattern
            if ((row + col) % 2 == 0)
            {
                set_pixel(image, row, col, color1);
            }
            else
            {
                set_pixel(image, row, col, color2);
            }
        }
    }
    set_image(image);
    sleep_ms(interval_ms);

    // Pattern 2: Swap colors - color2 on even squares, color1 on odd squares
    clear_image(image);
    for (int row = 0; row < NUM_ROWS; row++)
    {
        for (int col = 0; col < NUM_COLS; col++)
        {
            // Inverted checkerboard
            if ((row + col) % 2 == 0)
            {
                set_pixel(image, row, col, color2);
            }
            else
            {
                set_pixel(image, row, col, color1);
            }
        }
    }
    set_image(image);
    sleep_ms(interval_ms);
}

// Turn off all LEDs
void off()
{
    led_image_t image;
    clear_image(image);
    set_image(image);
    sleep_ms(100);  // Small delay to prevent busy loop
}
