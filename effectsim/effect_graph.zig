// Effect Graph Simulator - Node-based visual effects system for Hyperion
// Modular replacement for test-server.js with chainable effects

const std = @import("std");
const print = std.debug.print;
const net = std.net;
const math = std.math;
const crypto = std.crypto;
const base64 = std.base64;

// CoreAudio (macOS) for microphone capture
const c = @cImport({
    @cInclude("AudioToolbox/AudioToolbox.h");
    @cInclude("CoreAudio/CoreAudioTypes.h");
});

// ----------------------------------------------------------------------------
// Microphone capture (ring buffer)
// ----------------------------------------------------------------------------
const MicState = struct {
    queue: c.AudioQueueRef = null,
    buffer: []f32,
    capacity: usize,
    write_idx: usize,
    read_idx: usize,
    available: usize,
    allocator: std.mem.Allocator,

    pub fn init(self: *MicState, allocator: std.mem.Allocator, sample_rate: f64, capacity_frames: usize) !void {
        self.allocator = allocator;
        self.buffer = try allocator.alloc(f32, capacity_frames);
        self.capacity = capacity_frames;
        self.write_idx = 0;
        self.read_idx = 0;
        self.available = 0;

        var asbd: c.AudioStreamBasicDescription = .{
            .mSampleRate = sample_rate,
            .mFormatID = c.kAudioFormatLinearPCM,
            .mFormatFlags = c.kAudioFormatFlagIsFloat | c.kAudioFormatFlagIsPacked,
            .mBytesPerPacket = 4,
            .mFramesPerPacket = 1,
            .mBytesPerFrame = 4,
            .mChannelsPerFrame = 1,
            .mBitsPerChannel = 32,
            .mReserved = 0,
        };

        const err = c.AudioQueueNewInput(&asbd, input_callback, @ptrCast(self), null, null, 0, &self.queue);
        if (err != 0) return error.MicInitFailed;

        const buffer_frames: usize = 2048;
        const buffer_bytes: c.UInt32 = @intCast(buffer_frames * @sizeOf(f32));
        var i: usize = 0;
        while (i < 3) : (i += 1) {
            var buf: c.AudioQueueBufferRef = null;
            if (c.AudioQueueAllocateBuffer(self.queue, buffer_bytes, &buf) != 0) return error.MicInitFailed;
            buf.*.mAudioDataByteSize = buffer_bytes;
            _ = c.AudioQueueEnqueueBuffer(self.queue, buf, 0, null);
        }

        if (c.AudioQueueStart(self.queue, null) != 0) return error.MicInitFailed;
    }

    pub fn deinit(self: *MicState) void {
        if (self.queue != null) {
            _ = c.AudioQueueStop(self.queue, 1);
            _ = c.AudioQueueDispose(self.queue, 1);
            self.queue = null;
        }
        if (self.buffer.len > 0) self.allocator.free(self.buffer);
    }

    fn pushSamples(self: *MicState, samples: []const f32) void {
        var i: usize = 0;
        while (i < samples.len) : (i += 1) {
            self.buffer[self.write_idx] = samples[i];
            self.write_idx = (self.write_idx + 1) % self.capacity;
            if (self.available < self.capacity) {
                self.available += 1;
            } else {
                self.read_idx = (self.read_idx + 1) % self.capacity;
            }
        }
    }

    pub fn popInto(self: *MicState, out: []f32) usize {
        var count: usize = 0;
        while (count < out.len and self.available > 0) : (count += 1) {
            out[count] = self.buffer[self.read_idx];
            self.read_idx = (self.read_idx + 1) % self.capacity;
            self.available -= 1;
        }
        return count;
    }
};

export fn input_callback(
    inUserData: ?*anyopaque,
    inAQ: c.AudioQueueRef,
    inBuffer: c.AudioQueueBufferRef,
    inStartTime: ?*const c.AudioTimeStamp,
    inNumberPacketDescriptions: c.UInt32,
    inPacketDescs: ?[*]const c.AudioStreamPacketDescription,
) void {
    // _ = inAQ; // used below
    _ = inStartTime;
    _ = inNumberPacketDescriptions;
    _ = inPacketDescs;

    if (inUserData) |ud| {
        var mic: *MicState = @ptrCast(@alignCast(ud));
        const byte_len: usize = @intCast(inBuffer.*.mAudioDataByteSize);
        const sample_count: usize = byte_len / @sizeOf(f32);
        if (sample_count > 0) {
            const u8p: [*]const u8 = @ptrCast(inBuffer.*.mAudioData);
            var decode_buf: [4096]f32 = undefined;
            var to_decode = sample_count;
            var off: usize = 0;
            while (to_decode > 0) {
                const chunk = @min(to_decode, decode_buf.len);
                var i: usize = 0;
                while (i < chunk) : (i += 1) {
                    const b = off + i;
                    const base = b * 4;
                    const bytes: [4]u8 = .{ u8p[base + 0], u8p[base + 1], u8p[base + 2], u8p[base + 3] };
                    decode_buf[i] = @bitCast(bytes);
                }
                mic.pushSamples(decode_buf[0..chunk]);
                off += chunk;
                to_decode -= chunk;
            }
        }
    }

    _ = c.AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, null);
}

// ============================================================================
// WEBSOCKET UTILITIES
// ============================================================================

const WebSocketClient = struct {
    connection: net.Server.Connection,
    id: u32,
    connected: bool,

    pub fn init(connection: net.Server.Connection, id: u32) WebSocketClient {
        return WebSocketClient{
            .connection = connection,
            .id = id,
            .connected = true,
        };
    }

    pub fn sendBinary(self: *WebSocketClient, data: []const u8) !void {
        if (!self.connected) return;

        // WebSocket frame format for binary data
        // 0x82 = FIN bit + binary opcode
        var frame_header: [10]u8 = undefined;
        var header_len: usize = 2;

        frame_header[0] = 0x82; // FIN + binary opcode

        if (data.len < 126) {
            frame_header[1] = @intCast(data.len);
        } else if (data.len < 65536) {
            frame_header[1] = 126;
            std.mem.writeInt(u16, frame_header[2..4], @intCast(data.len), .big);
            header_len = 4;
        } else {
            frame_header[1] = 127;
            std.mem.writeInt(u64, frame_header[2..10], data.len, .big);
            header_len = 10;
        }

        // Send frame header + data
        _ = try self.connection.stream.write(frame_header[0..header_len]);
        _ = try self.connection.stream.write(data);
    }

    pub fn close(self: *WebSocketClient) void {
        if (self.connected) {
            self.connection.stream.close();
            self.connected = false;
        }
    }
};

const WebSocketServer = struct {
    server: net.Server,
    clients: [16]?WebSocketClient, // Fixed-size array for simplicity
    client_count: u32,
    next_client_id: u32,
    allocator: std.mem.Allocator,
    port: u16,

    pub fn init(allocator: std.mem.Allocator, port: u16) !WebSocketServer {
        const address = try net.Address.parseIp("127.0.0.1", port);
        const server = try address.listen(.{ .reuse_address = true });

        return WebSocketServer{
            .server = server,
            .clients = [_]?WebSocketClient{null} ** 16,
            .client_count = 0,
            .next_client_id = 1,
            .allocator = allocator,
            .port = port,
        };
    }

    pub fn deinit(self: *WebSocketServer) void {
        // Close all client connections
        for (&self.clients) |*maybe_client| {
            if (maybe_client.*) |*client| {
                client.close();
            }
        }
        self.server.deinit();
    }

    pub fn acceptConnection(self: *WebSocketServer) !void {
        // Set non-blocking mode to avoid hanging
        const connection = self.server.accept() catch |err| switch (err) {
            error.WouldBlock => return,
            else => return err,
        };

        // Perform WebSocket handshake
        self.performHandshake(connection) catch |err| {
            switch (err) {
                error.NoWebSocketKey, error.WouldBlock, error.MalformedKey => {
                    // Expected when non-WebSocket HTTP requests hit the port or non-blocking read
                },
                else => {
                    print("WebSocket handshake failed: {}\n", .{err});
                },
            }
            connection.stream.close();
            return;
        };

        // Check if we have space for more clients
        if (self.client_count >= self.clients.len) {
            print("Maximum clients ({}) reached, rejecting connection\n", .{self.clients.len});
            connection.stream.close();
            return;
        }

        // Find empty slot and add client
        for (&self.clients) |*maybe_client| {
            if (maybe_client.* == null) {
                const client = WebSocketClient.init(connection, self.next_client_id);
                maybe_client.* = client;
                self.client_count += 1;
                self.next_client_id += 1;

                print("WebSocket client {} connected (total: {})\n", .{ client.id, self.client_count });
                return;
            }
        }
    }

    pub fn broadcastBinary(self: *WebSocketServer, data: []const u8) void {
        // Send to all connected clients
        for (&self.clients) |*maybe_client| {
            if (maybe_client.*) |*client| {
                if (client.connected) {
                    client.sendBinary(data) catch |err| {
                        print("Failed to send to client {}: {}\n", .{ client.id, err });
                        client.close();
                        maybe_client.* = null;
                        self.client_count -= 1;
                        print("Removed disconnected client {} (total: {})\n", .{ client.id, self.client_count });
                    };
                } else {
                    // Client already disconnected, remove it
                    maybe_client.* = null;
                    self.client_count -= 1;
                }
            }
        }
    }

    pub fn getClientCount(self: *WebSocketServer) usize {
        return self.client_count;
    }

    fn performHandshake(self: *WebSocketServer, connection: net.Server.Connection) !void {
        _ = self; // unused
        // Read HTTP request
        var buffer: [4096]u8 = undefined;
        const bytes_read = try connection.stream.read(&buffer);
        const request = buffer[0..bytes_read];
        // Extract WebSocket key
        const key = try extractWebSocketKey(request);
        // Generate response key
        const response_key = try generateWebSocketResponseKey(key);
        defer std.heap.page_allocator.free(response_key);
        // Send WebSocket handshake response
        const response = try std.fmt.allocPrint(std.heap.page_allocator, "HTTP/1.1 101 Switching Protocols\r\n" ++
            "Upgrade: websocket\r\n" ++
            "Connection: Upgrade\r\n" ++
            "Sec-WebSocket-Accept: {s}\r\n" ++
            "\r\n", .{response_key});
        defer std.heap.page_allocator.free(response);
        _ = try connection.stream.write(response);
    }
};

fn extractWebSocketKey(request: []const u8) ![]const u8 {
    const key_header = "Sec-WebSocket-Key: ";
    const start = std.mem.indexOf(u8, request, key_header) orelse return error.NoWebSocketKey;
    const key_start = start + key_header.len;
    const end = std.mem.indexOf(u8, request[key_start..], "\r\n") orelse return error.MalformedKey;
    return request[key_start .. key_start + end];
}

fn generateWebSocketResponseKey(client_key: []const u8) ![]u8 {
    const magic_string = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    // Concatenate client key with magic string
    const concatenated = try std.fmt.allocPrint(std.heap.page_allocator, "{s}{s}", .{ client_key, magic_string });
    defer std.heap.page_allocator.free(concatenated);

    // SHA1 hash
    var hash: [20]u8 = undefined;
    crypto.hash.Sha1.hash(concatenated, &hash, .{});

    // Base64 encode
    const result_size = base64.standard.Encoder.calcSize(hash.len);
    const result = try std.heap.page_allocator.alloc(u8, result_size);

    _ = base64.standard.Encoder.encode(result, &hash);

    return result;
}

// ============================================================================
// CORE DATA TYPES
// ============================================================================

// High-precision pixel for processing
const Pixel = struct {
    r: f32, // Red (0.0-1.0)
    g: f32, // Green (0.0-1.0)
    b: f32, // Blue (0.0-1.0)
    a: f32, // Alpha (0.0-1.0)

    pub fn init(r: f32, g: f32, b: f32, a: f32) Pixel {
        return Pixel{ .r = r, .g = g, .b = b, .a = a };
    }

    pub fn black() Pixel {
        return Pixel.init(0.0, 0.0, 0.0, 1.0);
    }

    pub fn fromHSV(h: f32, s: f32, v: f32) Pixel {
        const rgb = hsvToRgb(h, s, v);
        return Pixel.init(rgb[0], rgb[1], rgb[2], 1.0);
    }

    pub fn toRGB888(self: Pixel) [3]u8 {
        return [3]u8{
            @intFromFloat(@min(255.0, @max(0.0, self.r * 255.0))),
            @intFromFloat(@min(255.0, @max(0.0, self.g * 255.0))),
            @intFromFloat(@min(255.0, @max(0.0, self.b * 255.0))),
        };
    }
};

// 2D pixel grid matching LED matrix dimensions
const PixelGrid = struct {
    width: u32,
    height: u32,
    pixels: []Pixel,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, width: u32, height: u32) !PixelGrid {
        const pixels = try allocator.alloc(Pixel, width * height);
        var grid = PixelGrid{
            .width = width,
            .height = height,
            .pixels = pixels,
            .allocator = allocator,
        };
        grid.clear();
        return grid;
    }

    pub fn deinit(self: *PixelGrid) void {
        self.allocator.free(self.pixels);
    }

    pub fn clear(self: *PixelGrid) void {
        for (self.pixels) |*pixel| {
            pixel.* = Pixel.black();
        }
    }

    pub fn getPixel(self: *PixelGrid, x: u32, y: u32) *Pixel {
        if (x >= self.width or y >= self.height) {
            // Return reference to a static black pixel for bounds safety
            const static = struct {
                var black_pixel = Pixel.black();
            };
            return &static.black_pixel;
        }
        return &self.pixels[y * self.width + x];
    }

    pub fn setPixel(self: *PixelGrid, x: u32, y: u32, pixel: Pixel) void {
        if (x < self.width and y < self.height) {
            self.pixels[y * self.width + x] = pixel;
        }
    }

    pub fn copyFrom(self: *PixelGrid, other: *const PixelGrid) void {
        std.debug.assert(self.width == other.width and self.height == other.height);
        @memcpy(self.pixels, other.pixels);
    }
};

// Audio analysis context for sound-reactive effects
const AudioContext = struct {
    bass: f32, // 0-60Hz intensity (0.0-1.0)
    mid: f32, // 60-2000Hz intensity (0.0-1.0)
    treble: f32, // 2000Hz+ intensity (0.0-1.0)
    volume: f32, // Overall RMS volume (0.0-1.0)
    beat: bool, // Beat detected this frame
    frame_time: f32, // Time since start (seconds)
    frame_count: u32, // Frame number

    pub fn init() AudioContext {
        return AudioContext{
            .bass = 0.0,
            .mid = 0.0,
            .treble = 0.0,
            .volume = 0.0,
            .beat = false,
            .frame_time = 0.0,
            .frame_count = 0,
        };
    }

    pub fn update(self: *AudioContext, frame: u32, fps: f32) void {
        self.frame_count = frame;
        self.frame_time = @as(f32, @floatFromInt(frame)) / fps;

        // Simulated audio for now - replace with real audio analysis
        self.bass = (@sin(self.frame_time * 2.0) + 1.0) / 2.0;
        self.mid = (@sin(self.frame_time * 4.0) + 1.0) / 2.0;
        self.treble = (@sin(self.frame_time * 8.0) + 1.0) / 2.0;
        self.volume = (self.bass + self.mid + self.treble) / 3.0;
        self.beat = @mod(@as(u32, @intFromFloat(self.frame_time * 2.0)), 2) == 0;
    }
};

// ============================================================================
// NODE SYSTEM ARCHITECTURE
// ============================================================================

const NodeType = enum {
    generator,
    point_filter,
    neighborhood_filter,
    output,
};

// ============================================================================
// INPUT NODES (Provide data to the graph)
// ============================================================================

const MicInputNode = struct {
    mic: *MicState,
    scratch: []f32,

    pub fn init(allocator: std.mem.Allocator, mic: *MicState, frame_size: usize) !MicInputNode {
        return .{ .mic = mic, .scratch = try allocator.alloc(f32, frame_size) };
    }

    pub fn deinit(self: *MicInputNode, allocator: std.mem.Allocator) void {
        if (self.scratch.len > 0) allocator.free(self.scratch);
    }

    pub fn update(self: *MicInputNode, audio_context: *AudioContext, sample_rate: f32) void {
        _ = sample_rate; // unused for now
        // Pull latest PCM
        const got = self.mic.popInto(self.scratch);
        if (got == 0) return;
        const buf = self.scratch[0..got];

        // Compute RMS
        var sum_sq: f64 = 0;
        for (buf) |v| sum_sq += @as(f64, v) * @as(f64, v);
        const rms = @sqrt(sum_sq / @as(f64, @floatFromInt(got)));
        audio_context.volume = @floatCast(rms);

        // Very rough 3-band split using simple Goertzel-like bins or downsample windows
        // Here: split the buffer into thirds of spectrum by simple IIRs approximations (cheap placeholder)
        var bass_acc: f64 = 0;
        var mid_acc: f64 = 0;
        var high_acc: f64 = 0;
        var i: usize = 0;
        while (i < buf.len) : (i += 1) {
            const x = @as(f64, buf[i]);
            // crude filters (placeholders):
            bass_acc += x * x * 1.0;
            if (i % 3 == 1) mid_acc += x * x * 1.0;
            if (i % 3 == 2) high_acc += x * x * 1.0;
        }
        const norm = @max(1.0, @as(f64, @floatFromInt(buf.len)));
        audio_context.bass = @floatCast(@sqrt(bass_acc / norm));
        audio_context.mid = @floatCast(@sqrt(mid_acc / norm));
        audio_context.treble = @floatCast(@sqrt(high_acc / norm));
        audio_context.beat = (audio_context.volume > 0.1);
    }
};

const AudioInputNode = struct {
    // Audio analysis state
    bass: f32,
    mid: f32,
    treble: f32,
    volume: f32,
    beat: bool,

    // Simulation parameters (replace with real audio analysis)
    bass_freq: f32,
    mid_freq: f32,
    treble_freq: f32,

    pub fn init() AudioInputNode {
        return AudioInputNode{
            .bass = 0.0,
            .mid = 0.0,
            .treble = 0.0,
            .volume = 0.0,
            .beat = false,
            .bass_freq = 2.0, // Hz for bass simulation
            .mid_freq = 4.0, // Hz for mid simulation
            .treble_freq = 8.0, // Hz for treble simulation
        };
    }

    pub fn update(self: *AudioInputNode, audio_context: *AudioContext) void {
        // Update audio analysis (simulated for now)
        // In real implementation, this would:
        // 1. Get microphone data via Web Audio API
        // 2. Perform FFT analysis
        // 3. Extract frequency bands
        // 4. Detect beats

        self.bass = (@sin(audio_context.frame_time * self.bass_freq) + 1.0) / 2.0;
        self.mid = (@sin(audio_context.frame_time * self.mid_freq) + 1.0) / 2.0;
        self.treble = (@sin(audio_context.frame_time * self.treble_freq) + 1.0) / 2.0;
        self.volume = (self.bass + self.mid + self.treble) / 3.0;
        self.beat = @mod(@as(u32, @intFromFloat(audio_context.frame_time * 2.0)), 2) == 0;

        // Update the global audio context
        audio_context.bass = self.bass;
        audio_context.mid = self.mid;
        audio_context.treble = self.treble;
        audio_context.volume = self.volume;
        audio_context.beat = self.beat;
    }
};

const InputNode = union(enum) {
    audio: AudioInputNode,
    mic: MicInputNode,

    pub fn update(self: *InputNode, audio_context: *AudioContext) void {
        switch (self.*) {
            .audio => |*audio| audio.update(audio_context),
            .mic => |*m| m.update(audio_context, 48000.0),
        }
    }
};

// ============================================================================
// GENERATOR NODES (Create pixels from scratch)
// ============================================================================

const SpiralGeneratorNode = struct {
    // Parameters matching your JavaScript implementation
    spiral_turns: f32,
    rotation_speed: f32, // Hz (0.1 like your JS)
    fade_distance: f32, // Edge fade factor

    pub fn init(spiral_turns: f32, rotation_speed: f32, fade_distance: f32) SpiralGeneratorNode {
        return SpiralGeneratorNode{
            .spiral_turns = spiral_turns,
            .rotation_speed = rotation_speed,
            .fade_distance = fade_distance,
        };
    }

    pub fn generate(self: *SpiralGeneratorNode, grid: *PixelGrid, audio: *AudioContext) void {
        const center_x = @as(f32, @floatFromInt(grid.width)) / 2.0;
        const center_y = @as(f32, @floatFromInt(grid.height)) / 2.0;
        const max_radius = @sqrt(center_x * center_x + center_y * center_y);
        const rotation_offset = audio.frame_time * self.rotation_speed * 2.0 * math.pi;
        for (0..grid.height) |y| {
            for (0..grid.width) |x| {
                const fx = @as(f32, @floatFromInt(x));
                const fy = @as(f32, @floatFromInt(y));
                const dx = fx - center_x;
                const dy = fy - center_y;
                const distance = @sqrt(dx * dx + dy * dy);
                const angle = math.atan2(dy, dx);
                const hue = @mod((angle + rotation_offset) / (2.0 * math.pi) +
                    (distance / max_radius) * self.spiral_turns, 1.0);
                // Force full brightness to validate full-color rendering
                const brightness: f32 = 1.0;
                const pixel = Pixel.fromHSV(hue, 1.0, brightness);
                grid.setPixel(@intCast(x), @intCast(y), pixel);
            }
        }
    }
};

const GeneratorNode = union(enum) {
    spiral: SpiralGeneratorNode,

    pub fn generate(self: *GeneratorNode, grid: *PixelGrid, audio: *AudioContext) void {
        switch (self.*) {
            .spiral => |*spiral| spiral.generate(grid, audio),
        }
    }
};

// ============================================================================
// POINT FILTER NODES (Per-pixel transformations)
// ============================================================================

const FrequencyBrightnessMapper = struct {
    // Frequency → color channel mapping
    red_response: f32, // How much bass affects red brightness
    green_response: f32, // How much mid affects green brightness
    blue_response: f32, // How much treble affects blue brightness
    intensity: f32, // Overall effect strength

    pub fn init(red_resp: f32, green_resp: f32, blue_resp: f32, intensity: f32) FrequencyBrightnessMapper {
        return FrequencyBrightnessMapper{
            .red_response = red_resp,
            .green_response = green_resp,
            .blue_response = blue_resp,
            .intensity = intensity,
        };
    }

    pub fn process(self: *FrequencyBrightnessMapper, input_grid: *PixelGrid, output_grid: *PixelGrid, audio: *AudioContext) void {
        for (0..input_grid.height) |y| {
            for (0..input_grid.width) |x| {
                const input_pixel = input_grid.getPixel(@intCast(x), @intCast(y));
                var output_pixel = input_pixel.*;

                // Apply frequency → brightness mapping
                output_pixel.r *= (1.0 + audio.bass * self.red_response * self.intensity);
                output_pixel.g *= (1.0 + audio.mid * self.green_response * self.intensity);
                output_pixel.b *= (1.0 + audio.treble * self.blue_response * self.intensity);

                // Clamp to valid range
                output_pixel.r = @min(1.0, output_pixel.r);
                output_pixel.g = @min(1.0, output_pixel.g);
                output_pixel.b = @min(1.0, output_pixel.b);

                output_grid.setPixel(@intCast(x), @intCast(y), output_pixel);
            }
        }
    }
};

const PointFilterNode = union(enum) {
    freq_brightness: FrequencyBrightnessMapper,

    pub fn process(self: *PointFilterNode, input_grid: *PixelGrid, output_grid: *PixelGrid, audio: *AudioContext) void {
        switch (self.*) {
            .freq_brightness => |*fb| fb.process(input_grid, output_grid, audio),
        }
    }
};

// ============================================================================
// OUTPUT NODES (Send data to devices/displays)
// ============================================================================

const HyperionLEDOutput = struct {
    panels_x: u32,
    panels_y: u32,
    panel_size: u32,
    port: u16,
    allocator: std.mem.Allocator,
    frame_count: u32,

    pub fn init(allocator: std.mem.Allocator, panels_x: u32, panels_y: u32, panel_size: u32, port: u16) HyperionLEDOutput {
        return HyperionLEDOutput{
            .panels_x = panels_x,
            .panels_y = panels_y,
            .panel_size = panel_size,
            .port = port,
            .allocator = allocator,
            .frame_count = 0,
        };
    }

    pub fn send(self: *HyperionLEDOutput, grid: *PixelGrid, audio: *AudioContext) void {
        _ = audio;
        const frame_data = self.createHyperionFrame(grid) catch {
            print("Failed to create LED frame\n", .{});
            return;
        };
        defer self.allocator.free(frame_data);
        self.frame_count += 1;
        if (self.frame_count % 60 == 0) {
            print("Generated frame {}: {}x{} panels, {} bytes\n", .{ self.frame_count, self.panels_x, self.panels_y, frame_data.len });
        }
        self.validateFrame(frame_data);
    }

    fn createHyperionFrame(self: *HyperionLEDOutput, grid: *PixelGrid) ![]u8 {
        _ = grid;
        const total_pixels = self.panels_x * self.panels_y * self.panel_size * self.panel_size;
        const frame_size = 8 + (total_pixels * 3);
        var frame = try self.allocator.alloc(u8, frame_size);
        const magic: u32 = 0x4D44454C; // "LEDM" little-endian
        std.mem.writeInt(u32, frame[0..4], magic, .little);
        std.mem.writeInt(u16, frame[4..6], @intCast(self.panels_x), .little);
        std.mem.writeInt(u16, frame[6..8], @intCast(self.panels_y), .little);
        var data_offset: usize = 8;
        var p: usize = 0;
        while (p < total_pixels) : (p += 1) {
            frame[data_offset] = 0;
            frame[data_offset + 1] = 255;
            frame[data_offset + 2] = 0;
            data_offset += 3;
        }
        return frame;
    }

    fn validateFrame(self: *HyperionLEDOutput, frame: []u8) void {
        if (frame.len < 8) {
            print("❌ Invalid frame: too small\n", .{});
            return;
        }

        const magic = std.mem.readInt(u32, frame[0..4], .little);
        const panels_x = std.mem.readInt(u16, frame[4..6], .little);
        const panels_y = std.mem.readInt(u16, frame[6..8], .little);

        if (magic == 0x4D44454C and panels_x == self.panels_x and panels_y == self.panels_y) {
            print("✅ Valid Hyperion LED frame generated\n", .{});
        } else {
            print("❌ Frame validation failed: magic={X}, panels={}x{}\n", .{ magic, panels_x, panels_y });
        }
    }
};

const WebSocketSimulatorOutput = struct {
    panels_x: u32,
    panels_y: u32,
    panel_size: u32,
    allocator: std.mem.Allocator,
    frame_count: u32,
    ws_server: WebSocketServer,
    start_time: i64,

    pub fn init(allocator: std.mem.Allocator, panels_x: u32, panels_y: u32, panel_size: u32, port: u16) !WebSocketSimulatorOutput {
        const ws_server = try WebSocketServer.init(allocator, port);
        const flags = std.posix.fcntl(ws_server.server.stream.handle, std.posix.F.GETFL, 0) catch 0;
        _ = std.posix.fcntl(ws_server.server.stream.handle, std.posix.F.SETFL, flags | 0x0004) catch {}; // O_NONBLOCK = 0x0004
        print("🌐 LED Matrix WebSocket Server running on ws://localhost:{}\n", .{port});
        print("📐 Matrix: {}×{} panels of {}×{} = {}×{} pixels\n", .{ panels_x, panels_y, panel_size, panel_size, panels_x * panel_size, panels_y * panel_size });
        return WebSocketSimulatorOutput{
            .panels_x = panels_x,
            .panels_y = panels_y,
            .panel_size = panel_size,
            .allocator = allocator,
            .frame_count = 0,
            .ws_server = ws_server,
            .start_time = std.time.milliTimestamp(),
        };
    }

    pub fn deinit(self: *WebSocketSimulatorOutput) void {
        self.ws_server.deinit();
    }

    pub fn send(self: *WebSocketSimulatorOutput, grid: *PixelGrid, audio: *AudioContext) void {
        self.ws_server.acceptConnection() catch {};
        if (self.ws_server.getClientCount() == 0) {
            if (self.frame_count == 0) {
                print("💡 Waiting for WebSocket clients to connect...\n", .{});
            }
            self.frame_count += 1;
            return;
        }
        const frame_data = self.createLEDMatrixFrame(grid) catch {
            print("Failed to create LED matrix frame\n", .{});
            return;
        };
        defer self.allocator.free(frame_data);
        self.ws_server.broadcastBinary(frame_data);
        self.frame_count += 1;
        if (self.frame_count % 300 == 0) {
            const elapsed_ms = std.time.milliTimestamp() - self.start_time;
            const elapsed_s = @as(f32, @floatFromInt(elapsed_ms)) / 1000.0;
            const fps = @as(f32, @floatFromInt(self.frame_count)) / elapsed_s;
            print("Sent {} frames ({d:.1} FPS avg) to {} client(s) | Bass={d:.2}\n", .{ self.frame_count, fps, self.ws_server.getClientCount(), audio.bass });
        }
    }

    fn createLEDMatrixFrame(self: *WebSocketSimulatorOutput, grid: *PixelGrid) ![]u8 {
        _ = grid;
        const total_pixels = self.panels_x * self.panels_y * self.panel_size * self.panel_size;
        const frame_size = 8 + (total_pixels * 3);
        var frame = try self.allocator.alloc(u8, frame_size);
        // Header
        const magic: u32 = 0x4D44454C; // LEDM
        std.mem.writeInt(u32, frame[0..4], magic, .little);
        std.mem.writeInt(u16, frame[4..6], @intCast(self.panels_x), .little);
        std.mem.writeInt(u16, frame[6..8], @intCast(self.panels_y), .little);

        return frame;
    }
};

const OutputNode = union(enum) {
    hyperion_led: HyperionLEDOutput,
    websocket_simulator: WebSocketSimulatorOutput,

    pub fn send(self: *OutputNode, grid: *PixelGrid, audio: *AudioContext) void {
        switch (self.*) {
            .hyperion_led => |*led| led.send(grid, audio),
            .websocket_simulator => |*sim| sim.send(grid, audio),
        }
    }
};

// ============================================================================
// EFFECT GRAPH EXECUTION ENGINE
// ============================================================================

const EffectGraph = struct {
    // Processing pipeline
    inputs: []InputNode,
    generator: ?GeneratorNode,
    point_filters: []PointFilterNode,
    output: ?OutputNode,

    // Processing buffers
    buffer_a: PixelGrid,
    buffer_b: PixelGrid,

    // Context
    audio: AudioContext,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, width: u32, height: u32) !EffectGraph {
        return EffectGraph{
            .inputs = try allocator.alloc(InputNode, 0),
            .generator = null,
            .point_filters = try allocator.alloc(PointFilterNode, 0),
            .output = null,
            .buffer_a = try PixelGrid.init(allocator, width, height),
            .buffer_b = try PixelGrid.init(allocator, width, height),
            .audio = AudioContext.init(),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *EffectGraph) void {
        self.buffer_a.deinit();
        self.buffer_b.deinit();
        self.allocator.free(self.inputs);
        self.allocator.free(self.point_filters);
    }

    pub fn addInput(self: *EffectGraph, input: InputNode) !void {
        const new_inputs = try self.allocator.realloc(self.inputs, self.inputs.len + 1);
        new_inputs[new_inputs.len - 1] = input;
        self.inputs = new_inputs;
    }

    pub fn setGenerator(self: *EffectGraph, generator: GeneratorNode) void {
        self.generator = generator;
    }

    pub fn addPointFilter(self: *EffectGraph, filter: PointFilterNode) !void {
        const new_filters = try self.allocator.realloc(self.point_filters, self.point_filters.len + 1);
        new_filters[new_filters.len - 1] = filter;
        self.point_filters = new_filters;
    }

    pub fn setOutput(self: *EffectGraph, output: OutputNode) void {
        self.output = output;
    }

    pub fn executeFrame(self: *EffectGraph, frame: u32) void {
        // Step 0: Update timing context
        self.audio.update(frame, 60.0); // 60 FPS

        // Step 1: Update input nodes (audio analysis, user controls, etc.)
        for (self.inputs) |*input| {
            input.update(&self.audio);
        }

        var current_buffer = &self.buffer_a;
        var next_buffer = &self.buffer_b;

        // Step 2: Generate initial pixels
        if (self.generator) |*gen| {
            current_buffer.clear();
            gen.generate(current_buffer, &self.audio);
        }

        // Step 3: Apply point filters in sequence
        for (self.point_filters) |*filter| {
            next_buffer.clear();
            filter.process(current_buffer, next_buffer, &self.audio);

            // Swap buffers
            const temp = current_buffer;
            current_buffer = next_buffer;
            next_buffer = temp;
        }

        // Step 4: Send to output
        if (self.output) |*out| {
            out.send(current_buffer, &self.audio);
        }
    }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// HSV to RGB conversion (ported from your JavaScript)
fn hsvToRgb(h: f32, s: f32, v: f32) [3]f32 {
    const chroma = v * s;
    const x = chroma * (1.0 - @abs(@mod(h * 6.0, 2.0) - 1.0));
    const m = v - chroma;
    var r: f32 = 0;
    var g: f32 = 0;
    var b: f32 = 0;
    if (h < 1.0 / 6.0) {
        r = chroma;
        g = x;
        b = 0;
    } else if (h < 2.0 / 6.0) {
        r = x;
        g = chroma;
        b = 0;
    } else if (h < 3.0 / 6.0) {
        r = 0;
        g = chroma;
        b = x;
    } else if (h < 4.0 / 6.0) {
        r = 0;
        g = x;
        b = chroma;
    } else if (h < 5.0 / 6.0) {
        r = x;
        g = 0;
        b = chroma;
    } else {
        r = chroma;
        g = 0;
        b = x;
    }
    return [3]f32{ r + m, g + m, b + m };
}

// ============================================================================
// MAIN DEMO
// ============================================================================

pub fn main() !void {
    print("🚀🔗 HYPERION EFFECT GRAPH SIMULATOR 🔗🚀\n", .{});
    print("Modular node-based replacement for test-server.js\n\n", .{});

    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Create effect graph with same dimensions as your JavaScript server
    const panels_x = 3;
    const panels_y = 4;
    const panel_size = 28;
    const width = panels_x * panel_size; // 84 pixels
    const height = panels_y * panel_size; // 112 pixels

    var graph = try EffectGraph.init(allocator, width, height);
    defer graph.deinit();

    print("📐 Matrix: {}x{} panels of {}x{} = {}x{} pixels\n", .{ panels_x, panels_y, panel_size, panel_size, width, height });

    // Build the effect chain:
    // AudioInput → SpiralGenerator → FrequencyBrightnessMapper → WebSocketOutput

    print("\n🔗 Building effect chain:\n", .{});
    print("  1. AudioInputNode (provides bass/mid/treble data)\n", .{});
    print("  2. SpiralGenerator (rainbow spiral)\n", .{});
    print("  3. FrequencyBrightnessMapper (bass→red, mid→green, treble→blue)\n", .{});
    print("  4. WebSocketSimulatorOutput (streams to led-matrix.ts)\n\n", .{});

    // Initialize microphone (removed for now)
    // var mic = MicState{ .buffer = &[_]f32{}, .capacity = 0, .write_idx = 0, .read_idx = 0, .available = 0, .allocator = allocator };
    // try mic.init(allocator, 48000.0, 48000 * 2);
    // defer mic.deinit();

    // Configure nodes
    // const mic_input = InputNode{ .mic = try MicInputNode.init(allocator, &mic, 2048) };
    // try graph.addInput(mic_input);

    const spiral_gen = GeneratorNode{ .spiral = SpiralGeneratorNode.init(3.0, 0.1, 0.3) };
    graph.setGenerator(spiral_gen);

    // Remove point filters for now (direct generator output)
    // const freq_mapper = PointFilterNode{ .freq_brightness = FrequencyBrightnessMapper.init(1.0, 0.5, 2.0, 0.0) };
    // try graph.addPointFilter(freq_mapper);

    const simulator_output = OutputNode{ .websocket_simulator = try WebSocketSimulatorOutput.init(allocator, panels_x, panels_y, panel_size, 9002) };
    graph.setOutput(simulator_output);

    // Run continuous effect graph server
    print("🎬 Starting continuous effect graph server...\n", .{});
    print("🌐 Connect your browser to the WebSocket server at ws://127.0.0.1:9002\n", .{});
    print("💡 Open your LED matrix visualizer and point it to ws://localhost:9002\n\n", .{});

    const target_fps = 60;
    const frame_time_ns = std.time.ns_per_s / target_fps;

    var frame: u32 = 0;
    while (true) { // Run continuously
        const start_time = std.time.nanoTimestamp();

        // Execute the complete effect chain
        graph.executeFrame(@intCast(frame));

        const end_time = std.time.nanoTimestamp();
        const processing_time = end_time - start_time;

        // Minimal performance logging
        if (frame % 300 == 0) { // Every 5 seconds
            const processing_ms = @as(f32, @floatFromInt(processing_time)) / 1_000_000.0;
            print("Performance: {d:.2}ms/frame\n", .{processing_ms});
        }

        // Sleep to maintain target FPS
        if (processing_time < frame_time_ns) {
            std.Thread.sleep(@intCast(frame_time_ns - processing_time));
        }

        frame += 1;
    }
}
