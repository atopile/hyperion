/**
 * MBI5043 LED Driver Implementation
 */

#include "led_driver.h"
#include "pico/stdlib.h"
#include "hardware/gpio.h"
#include "hardware/pwm.h"

// Initialize the LED driver hardware
void led_driver_init()
{
    // Configure all pins first
    gpio_init(PIN_SDI);
    gpio_set_dir(PIN_SDI, GPIO_OUT);
    gpio_init(PIN_DCLK);
    gpio_set_dir(PIN_DCLK, GPIO_OUT);
    gpio_init(PIN_LE);
    gpio_set_dir(PIN_LE, GPIO_OUT);

    // Note: PIN_GCLK will be configured by setup_pwm

    // Initialize control outputs LOW
    gpio_put(PIN_SDI, 0);
    gpio_put(PIN_DCLK, 0);
    gpio_put(PIN_LE, 0);

    // Setup PWM for the greyscale clock at 8MHz, 50% duty cycle
    // This configures PIN_GCLK as PWM output
    setup_pwm(PIN_GCLK, 8 * 1000 * 1000, 50);

    // Clear all registers
    clear_registers();
}

// Shift one bit into the chain (data sampled on DCLK rising edge)
void shift_bit(bool bit)
{
    gpio_put(PIN_SDI, bit);
    sleep_us(1); // Setup time
    gpio_put(PIN_DCLK, 1);
    sleep_us(1); // Hold time
    gpio_put(PIN_DCLK, 0);
    sleep_us(1);
}

// Shift a multi-bit value MSB first
void shift_value(uint16_t value, uint8_t bits)
{
    for (int8_t i = bits - 1; i >= 0; i--)
    {
        shift_bit((value >> i) & 0x01);
    }
}

// Latch data from shift registers (1 CLK pulse with LE high)
void send_data_latch()
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
void send_global_latch()
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
void clear_registers()
{
    // Match the pattern used in set_image:
    // Send all drivers for each channel, then latch
    for (int channel = NUM_CHANNELS - 1; channel >= 0; channel--)
    {
        // Send zeros for this channel to all drivers
        for (int driver = NUM_DRIVERS - 1; driver >= 0; driver--)
        {
            shift_value(0, GS_BITS);
        }
        // Latch after all drivers have received this channel
        send_data_latch();
    }
    send_global_latch();
}

// Setup PWM on a GPIO pin
void setup_pwm(int gpio, uint32_t freq, uint8_t duty_percent)
{
    gpio_set_function(gpio, GPIO_FUNC_PWM);
    uint slice_num = pwm_gpio_to_slice_num(gpio);

    // For high frequencies like 8MHz, we need a small wrap value
    // PWM frequency = 125MHz / (clkdiv * (wrap + 1))
    // For 8MHz: 125MHz / 8MHz = 15.625
    // Using wrap=15 and clkdiv=1.0 gives 125MHz/16 = 7.8125MHz (close enough)

    uint16_t wrap = 15; // For ~8MHz operation
    float clkdiv = 1.0f;

    pwm_set_clkdiv(slice_num, clkdiv);
    pwm_set_wrap(slice_num, wrap);

    // Set duty cycle based on wrap value
    uint16_t level = (wrap * duty_percent) / 100;
    pwm_set_gpio_level(gpio, level);

    // Enable PWM
    pwm_set_enabled(slice_num, true);
}

// Drivers are in the center of a 4-pixel cluster, arranged
// in a 2x2 grid and snaking from left to right, top to bottom.
int get_driver_idx(int row, int col)
{
    int driver_row = row / ROWS_PER_DRIVER;
    int driver_col = col / COLS_PER_DRIVER;

    if (driver_row % 2 == 0)
    {
        // Even rows: left to right
        return driver_row * DRIVERS_PER_ROW + driver_col;
    }
    else
    {
        // Odd rows: right to left
        return driver_row * DRIVERS_PER_ROW + (DRIVERS_PER_ROW - 1 - driver_col);
    }
}

// Snaking from left to right, top to bottom within the 4x4 grid
// handled by a single driver
int get_pixel_idx(int row, int col)
{
    int pixel_x = row % ROWS_PER_DRIVER;
    int pixel_y = col % COLS_PER_DRIVER;

    if (pixel_x % 2 == 0)
    {
        return pixel_x * COLS_PER_DRIVER + pixel_y;
    }
    else
    {
        return pixel_x * COLS_PER_DRIVER + (COLS_PER_DRIVER - 1 - pixel_y);
    }
}

// Construct and load the image into the driver chain
void set_image(const led_image_t &image)
{
    uint16_t data_to_shift[NUM_DRIVERS][NUM_CHANNELS];

    for (int row = 0; row < NUM_ROWS; row++)
    {
        for (int col = 0; col < NUM_COLS; col++)
        {
            int driver_idx = get_driver_idx(row, col);
            int pixel_idx = get_pixel_idx(row, col);

            // The 3rd pixel (index 2) of each driver has reversed color order (RBGW instead of WBGR)
            if (pixel_idx == 2)
            {
                // For pixel 2: map WBGR input to RBGW hardware
                // Input: [0]=W, [1]=B, [2]=G, [3]=R
                // Output: [0]=R, [1]=B, [2]=G, [3]=W
                data_to_shift[driver_idx][pixel_idx * NUM_COLORS + 0] = image[row][col][3]; // R from input R
                data_to_shift[driver_idx][pixel_idx * NUM_COLORS + 1] = image[row][col][2]; // B from input B
                data_to_shift[driver_idx][pixel_idx * NUM_COLORS + 2] = image[row][col][1]; // G from input G
                data_to_shift[driver_idx][pixel_idx * NUM_COLORS + 3] = image[row][col][0]; // W from input W
            }
            else
            {
                // For pixels 0, 1, 3: normal WBGR order
                for (int color = 0; color < NUM_COLORS; color++)
                {
                    data_to_shift[driver_idx][pixel_idx * NUM_COLORS + color] = image[row][col][color];
                }
            }
        }
    }

    // Shift the data to the drivers
    // For daisy chain: all drivers receive the same channel position together
    // Channel 15 first (working backwards)
    for (int channel = NUM_CHANNELS - 1; channel >= 0; channel--)
    {
        // Send this channel for all drivers (last driver first in daisy chain)
        for (int driver = NUM_DRIVERS - 1; driver >= 0; driver--)
        {
            shift_value(data_to_shift[driver][channel], GS_BITS);
        }
        // After all drivers have this channel in their shift registers, latch it
        send_data_latch();
    }

    send_global_latch();
}
