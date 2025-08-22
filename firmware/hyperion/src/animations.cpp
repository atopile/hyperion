/**
 * LED Animation Implementations
 */

#include "animations.h"
#include "led_driver.h"
#include "pico/stdlib.h"

// Channel order is WBGR
static constexpr int WHITE_IDX = 3;
static constexpr int BLUE_IDX = 2;
static constexpr int GREEN_IDX = 1;
static constexpr int RED_IDX = 0;

static constexpr uint16_t MAX_BRIGHTNESS = GS_MAX; // Full brightness

static constexpr rgbw_color_t BLACK = {0, 0, 0, 0};
static constexpr rgbw_color_t WHITE = {MAX_BRIGHTNESS, 0, 0, 0};
static constexpr rgbw_color_t WHITE_WHITE = {MAX_BRIGHTNESS, MAX_BRIGHTNESS, MAX_BRIGHTNESS, MAX_BRIGHTNESS};

// Set a single pixel to a WBGR color
void set_pixel(led_image_t &image, int row, int col, rgbw_color_t color)
{
    image[row][col][WHITE_IDX] = color.w;
    image[row][col][BLUE_IDX] = color.b;
    image[row][col][GREEN_IDX] = color.g;
    image[row][col][RED_IDX] = color.r;
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

    // Number of steps for smooth animation
    const int STEPS = 1000;                                                 // More steps for smoother fade
    const uint32_t delay_ms = (uint32_t)(1000.0 / (frequency * STEPS * 2)); // *2 for up and down

    // Fade up from 0 to MAX (not including MAX to avoid duplicate at peak)
    for (int step = 0; step < STEPS; step++)
    {
        // Map step [0..STEPS-1] to brightness [0..almost-MAX]
        uint32_t brightness = ((uint32_t)MAX_BRIGHTNESS * step) / STEPS;
        set_all_pixels(image, {(uint16_t)brightness, 0, 0, 0});
        set_image(image);
        sleep_ms(delay_ms);
    }

    // Fade down from MAX back to 0 (including MAX at the peak)
    for (int step = STEPS; step >= 0; step--)
    {
        // Map step [STEPS..0] to brightness [MAX..0]
        uint32_t brightness = ((uint32_t)MAX_BRIGHTNESS * step) / STEPS;
        set_all_pixels(image, {(uint16_t)brightness, 0, 0, 0});
        set_image(image);
        sleep_ms(delay_ms);
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

// Strobe effect - flash on and off at specified BPM
void strobe(rgbw_color_t color, float bpm)
{
    led_image_t image;

    // Calculate the period in milliseconds for one beat
    // BPM = beats per minute, so period = 60000ms / BPM
    uint32_t period_ms = (uint32_t)(60000.0f / bpm);

    // Split the period into on and off time
    // Typical strobe has very short on time for sharp effect
    uint32_t on_time_ms = period_ms / 10;          // 10% on time for sharp strobe
    uint32_t off_time_ms = period_ms - on_time_ms; // 90% off time

    // Flash on
    set_all_pixels(image, color);
    set_image(image);
    sleep_ms(on_time_ms);

    // Flash off
    clear_image(image);
    set_image(image);
    sleep_ms(off_time_ms);
}

// Turn off all LEDs
void off()
{
    led_image_t image;
    clear_image(image);
    set_image(image);
    sleep_ms(100); // Small delay to prevent busy loop
}
