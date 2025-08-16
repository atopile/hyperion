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

    // Initialize all outputs LOW
    gpio_put(PIN_SDI, 0);
    gpio_put(PIN_DCLK, 0);
    // GCLK will be controlled by PWM
    gpio_put(PIN_LE, 0);

    // Setup PWM for the greyscale clock at 800kHz, 50% duty cycle
    setup_pwm(PIN_GCLK, 800000, 50);

    // Clear all registers
    clearRegisters();
}

// Shift one bit into the chain (data sampled on DCLK rising edge)
void shiftBit(bool bit)
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
            shiftValue(0, 16);
            sleep_us(10);
        }
        latchData();
        sleep_us(10);
    }
    sleep_us(10);
    outputData();
}

// Set all LEDs to a specific brightness
void allWhite(uint16_t brightness)
{
    for (int i = 0; i < 16; i++)
    {
        for (int j = 0; j < 4; j++)
        {
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
