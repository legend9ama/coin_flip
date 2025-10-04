# coin_flip
#include <avr/io.h>
#include <avr/interrupt.h>

// Pin configuration
#define LASER_PIN PD6     // PD6 (Digital 6) - Laser output
#define SIGNAL_PIN PD2    // PD2 (Digital 2) - Digital signal input (INT0)

// FSK Frequencies (adjusted for 100Hz max sensitivity)
#define FSK_SPACE_FREQ 30    // Hz (bit 0)
#define FSK_MARK_FREQ 60     // Hz (bit 1) 
#define FSK_SYNC_FREQ 15     // Hz (synchronization)
#define BAUD_RATE 50         // bits per second

// FSK Protocol
#define SYNC_BYTE 0xAA
#define START_BYTE 0x7E
#define STOP_BYTE 0x7F

// Global variables
volatile uint32_t pulse_times[5] = {0};
volatile uint8_t pulse_index = 0;
volatile uint32_t current_time = 0; // 1 unit = 4.096ms
volatile uint8_t signal_detected = 0;
volatile uint8_t synchronized = 0;
volatile uint16_t measured_frequency = 0;

// FSK Reception variables
volatile uint8_t receiving_data = 0;
volatile uint8_t receiving_byte = 0;
volatile uint8_t bit_position = 0;
volatile uint8_t received_bytes[32];
volatile uint8_t rx_index = 0;
volatile uint32_t last_edge_time = 0;
volatile uint16_t recent_periods[4] = {0};
volatile uint8_t period_index = 0;

// FSK Transmission variables
volatile uint8_t transmission_active = 0;
volatile uint8_t transmit_buffer[32];
volatile uint8_t tx_index = 0;
volatile uint8_t tx_length = 0;
volatile uint8_t current_bit = 0;
volatile uint32_t bit_start_time = 0;
volatile uint8_t current_fsk_state = 0;

// Timer0 initialization for system time (Prescaler 1024)
void timer0_init(void) {
    TCCR0A = 0;
    TCCR0B = (1 << CS02) | (1 << CS00); // Prescaler 1024
    TIMSK0 = (1 << TOIE0);
}

// Timer1 initialization for low frequency FSK generation
void timer1_init(void) {
    // Fast PWM mode, TOP = ICR1
    TCCR1A = (1 << COM1A1) | (1 << WGM11);
    TCCR1B = (1 << WGM13) | (1 << WGM12) | (1 << CS12) | (1 << CS10); // Prescaler 1024
}

// External interrupt initialization
void ext_interrupt_init(void) {
    EICRA = (1 << ISC01); // Falling edge trigger
    EIMSK = (1 << INT0);
}

// GPIO initialization
void gpio_init(void) {
    DDRD |= (1 << LASER_PIN);
    DDRD &= ~(1 << SIGNAL_PIN);
    PORTD |= (1 << SIGNAL_PIN);
}

// Set FSK frequency for low frequency range (15-60Hz)
void set_fsk_frequency(uint8_t fsk_type) {
    uint16_t top_value;
    
    switch(fsk_type) {
        case 0: // Space frequency (30 Hz)
            top_value = (16000000UL / (1024 * FSK_SPACE_FREQ)) - 1;
            break;
        case 1: // Mark frequency (60 Hz)
            top_value = (16000000UL / (1024 * FSK_MARK_FREQ)) - 1;
            break;
        case 2: // Sync frequency (15 Hz)
            top_value = (16000000UL / (1024 * FSK_SYNC_FREQ)) - 1;
            break;
        default:
            return;
    }
    
    // Limit to maximum period for very low frequencies
    if (top_value > 65535) top_value = 65535;
    
    ICR1 = top_value;
    OCR1A = top_value / 2; // 50% duty cycle
    current_fsk_state = fsk_type;
}

// Set laser constant ON
void set_laser_constant(void) {
    TCCR1A &= ~(1 << COM1A1);
    PORTD |= (1 << LASER_PIN);
    synchronized = 0;
    current_fsk_state = 3; // Constant mode
}

// Measure input signal frequency (max 100Hz sensitivity)
uint16_t measure_input_frequency(void) {
    if (pulse_index < 2) return 0;
    
    uint32_t total_period = 0;
    uint8_t valid_measurements = 0;
    
    // Use only recent periods for calculation
    for (uint8_t i = 0; i < 4; i++) {
        if (recent_periods[i] > 0) {
            total_period += recent_periods[i];
            valid_measurements++;
        }
    }
    
    if (valid_measurements == 0) return 0;
    
    uint32_t avg_period = total_period / valid_measurements;
    
    // Convert period to frequency (current_time unit = 4.096ms)
    // Frequency = 1000 / (avg_period * 4.096) ≈ 244 / avg_period
    return 244 / avg_period;
}

// Detect FSK bit from measured frequency (15-60Hz range)
uint8_t detect_fsk_bit(uint16_t frequency) {
    if (frequency > FSK_MARK_FREQ - 10 && frequency < FSK_MARK_FREQ + 10) {
        return 1; // Mark (bit 1) - 60Hz
    } else if (frequency > FSK_SPACE_FREQ - 10 && frequency < FSK_SPACE_FREQ + 10) {
        return 0; // Space (bit 0) - 30Hz
    } else if (frequency > FSK_SYNC_FREQ - 5 && frequency < FSK_SYNC_FREQ + 5) {
        return 2; // Sync frequency
    }
    return 3; // Invalid
}

// Start FSK transmission with low frequencies
void start_fsk_transmission(uint8_t* data, uint8_t length) {
    if (transmission_active) return;
    
    for (uint8_t i = 0; i < length; i++) {
        transmit_buffer[i] = data[i];
    }
    tx_length = length;
    tx_index = 0;
    transmission_active = 1;
    current_bit = 0;
    
    // Start with sync frequency
    set_fsk_frequency(2); // 15Hz sync
    bit_start_time = current_time;
}

// Process FSK bit transmission for low baud rate
void process_fsk_transmission(void) {
    if (!transmission_active) return;
    
    uint32_t bit_duration = 1000 / BAUD_RATE / 4; // Convert to time units (20ms = 5 units)
    
    if (current_time - bit_start_time >= bit_duration) {
        bit_start_time = current_time;
        
        if (tx_index == 0 && current_bit == 0) {
            // Send sync byte at 15Hz
            set_fsk_frequency(2);
            current_bit++;
        } else if (tx_index == 0 && current_bit < 8) {
            // Continue sync byte
            current_bit++;
        } else if (tx_index == 0 && current_bit == 8) {
            // End of sync, start data transmission
            tx_index++;
            current_bit = 0;
            set_fsk_frequency(0); // Start bit (space)
        } else if (tx_index <= tx_length) {
            if (current_bit == 0) {
                // Start bit (always space - 30Hz)
                set_fsk_frequency(0);
                current_bit++;
            } else if (current_bit <= 8) {
                // Data bits (LSB first)
                uint8_t bit_value = (transmit_buffer[tx_index-1] >> (current_bit - 1)) & 1;
                set_fsk_frequency(bit_value); // 30Hz=0, 60Hz=1
                current_bit++;
            } else {
                // Stop bit (always mark - 60Hz)
                set_fsk_frequency(1);
                tx_index++;
                current_bit = 0;
            }
        } else {
            // Transmission complete
            transmission_active = 0;
            // Return to receiving mode with sync frequency
            if (synchronized) {
                set_fsk_frequency(2); // Back to 15Hz sync
            }
        }
    }
}

// Process received FSK data
void process_received_data(void) {
    if (rx_index >= 3) { // Minimum: START + data + STOP
        if (received_bytes[0] == START_BYTE && received_bytes[rx_index-1] == STOP_BYTE) {
            // Valid FSK frame received - process data
            
            // Prepare response
            uint8_t response[32];
            uint8_t resp_len = 0;
            response[resp_len++] = START_BYTE;
            response[resp_len++] = 'R';
            response[resp_len++] = 'X';
            response[resp_len++] = ':';
            
            // Echo received data (excluding START/STOP bytes)
            for (uint8_t i = 1; i < rx_index-1 && resp_len < 31; i++) {
                response[resp_len++] = received_bytes[i];
            }
            response[resp_len++] = STOP_BYTE;
            
            start_fsk_transmission(response, resp_len);
        }
    }
    rx_index = 0;
}

// Timer0 overflow - system time (1 overflow = 256 * 1024 / 16MHz = 16.384ms)
// We use 1/4 of this for better resolution: 4.096ms per time unit
ISR(TIMER0_OVF_vect) {
    static uint8_t time_counter = 0;
    time_counter++;
    if (time_counter >= 4) {
        current_time++;
        time_counter = 0;
    }
}

// External interrupt - signal detection for low frequencies
ISR(INT0_vect) {
    uint32_t now = current_time;
    
    // Store pulse time and calculate period
    if (pulse_index > 0) {
        uint32_t period = now - pulse_times[pulse_index - 1];
        
        // Valid period for 5-100Hz range (2-20 time units)
        if (period >= 2 && period <= 40) {
            recent_periods[period_index] = period;
            period_index = (period_index + 1) % 4;
            
            // Calculate frequency (244 / period)
            measured_frequency = 244 / period;
            
            // FSK decoding when synchronized
            if (synchronized && !transmission_active) {
                uint8_t detected_bit = detect_fsk_bit(measured_frequency);
                
                if (detected_bit < 2) { // Valid FSK bit (0 or 1)
                    static uint32_t last_bit_time = 0;
                    static uint8_t bit_count = 0;
                    
                    if (!receiving_data) {
                        // Look for start bit (space/0)
                        if (detected_bit == 0) {
                            receiving_data = 1;
                            receiving_byte = 0;
                            bit_position = 0;
                            last_bit_time = now;
                            bit_count = 1;
                        }
                    } else {
                        bit_count++;
                        uint32_t bit_time = now - last_bit_time;
                        
                        // Sample at middle of bit period
                        if (bit_count >= 2) { // Wait for stable reading
                            if (bit_position < 8) {
                                receiving_byte |= (detected_bit << bit_position);
                                bit_position++;
                            } else {
                                // Stop bit (mark/1)
                                if (detected_bit == 1 && rx_index < 32) {
                                    received_bytes[rx_index++] = receiving_byte;
                                }
                                receiving_data = 0;
                            }
                            last_bit_time = now;
                            bit_count = 0;
                        }
                    }
                }
                else if (detected_bit == 2) {
                    // Sync frequency detected
                    synchronized = 1;
                    if (!transmission_active) {
                        set_fsk_frequency(2); // Match sync frequency
                    }
                }
            }
        }
    }
    
    pulse_times[pulse_index] = now;
    pulse_index = (pulse_index + 1) % 5;
    signal_detected = 1;
    last_edge_time = now;
}

int main(void) {
    gpio_init();
    timer0_init();
    timer1_init();
    ext_interrupt_init();
    
    set_laser_constant(); // Start with constant laser
    sei();
    
    uint32_t last_mode_check = 0;
    uint32_t last_freq_update = 0;
    uint8_t current_mode = 0;
    uint32_t last_auto_tx = 0;
    
    while (1) {
        // Mode management every 1 second
        if (current_time - last_mode_check > 244) { // ~1 second
            uint16_t frequency = measure_input_frequency();
            
            if (frequency == 0) {
                // No signal - constant laser
                if (current_mode != 0) {
                    set_laser_constant();
                    current_mode = 0;
                    synchronized = 0;
                }
            } 
            else if (frequency > 80) {
                // High frequency (constant signal) - pulsed at 15Hz
                if (current_mode != 1) {
                    set_fsk_frequency(2); // 15Hz
                    current_mode = 1;
                    synchronized = 0;
                }
            }
            else if (detect_fsk_bit(frequency) == 2) {
                // Sync frequency detected - synchronize
                synchronized = 1;
                set_fsk_frequency(2);
                current_mode = 2;
            }
            
            last_mode_check = current_time;
        }
        
        // Process FSK transmission
        if (transmission_active) {
            process_fsk_transmission();
        }
        
        // Process received FSK data
        if (rx_index > 0) {
            process_received_data();
        }
        
        // Automatic transmission every 10 seconds when synchronized
        if (synchronized && !transmission_active && (current_time - last_auto_tx > 2440)) {
            uint8_t auto_data[] = {START_BYTE, 'A', 'T', 'M', 'E', 'G', 'A', '3', '2', '8', 'P', STOP_BYTE};
            start_fsk_transmission(auto_data, 12);
            last_auto_tx = current_time;
        }
        
        // Update frequency measurement for display
        if (current_time - last_freq_update > 61) { // ~250ms
            measured_frequency = measure_input_frequency();
            last_freq_update = current_time;
        }
    }
    
    return 0;
}
