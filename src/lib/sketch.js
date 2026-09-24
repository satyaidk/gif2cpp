// Example player sketch and README that ship in the ZIP next to the headers.

/** rows: [{ sym, label, frameMs }] in ANIMS order */
export function playerSketch(rows) {
  const times = rows
    .map((r, i) => `  ${String(r.frameMs).padStart(4)}${i < rows.length - 1 ? ',' : ' '}   // ${r.label.trim()}`)
    .join('\n');
  return `// MochiPlayer.ino - plays every animation in animations.h on a 128x64 SSD1306.
//
// Boards: ESP32, ESP8266, RP2040 or anything else with enough flash.
//         (An Uno has 2 KB of RAM, and the display buffer alone takes 1 KB.)
// Libraries (Library Manager): "Adafruit SSD1306" and "Adafruit GFX Library".
// Wiring (I2C): VCC -> 3.3V, GND -> GND, SDA/SCL -> the board's I2C pins.

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "animations.h"

#define OLED_W     128
#define OLED_H     64
#define OLED_ADDR  0x3C   // some modules use 0x3D
#define LOOPS      3      // how many times each animation plays before the next

// Milliseconds per frame, one entry per animation (from the web preview).
const uint16_t FRAME_MS[] = {
${times}
};

Adafruit_SSD1306 display(OLED_W, OLED_H, &Wire, -1);
static uint8_t frameBuf[OLED_W * OLED_H / 8];   // 1024 bytes, 1 bit per pixel

// Applies frame idx of animation a to frameBuf.
// Each frame is stored as PackBits-compressed XOR against the previous frame,
// so decode frames in order and clear frameBuf before frame 0.
void decodeFrame(const Anim &a, uint16_t idx) {
  const uint8_t *p   = a.data + pgm_read_word(&a.offsets[idx]);
  const uint8_t *end = a.data + pgm_read_word(&a.offsets[idx + 1]);
  uint16_t o = 0;
  while (p < end && o < sizeof(frameBuf)) {
    int8_t t = (int8_t)pgm_read_byte(p++);
    if (t >= 0) {                        // literal: the next t+1 bytes
      uint16_t n = t + 1;
      while (n-- && o < sizeof(frameBuf)) frameBuf[o++] ^= pgm_read_byte(p++);
    } else {                             // repeat: next byte, 1-t times
      uint16_t n = 1 - t;
      uint8_t v = pgm_read_byte(p++);
      while (n-- && o < sizeof(frameBuf)) frameBuf[o++] ^= v;
    }
  }
}

void playAnim(uint8_t n) {
  const Anim &a = ANIMS[n];
  memset(frameBuf, 0, sizeof(frameBuf));
  for (uint16_t i = 0; i < a.frames; i++) {
    uint32_t start = millis();
    decodeFrame(a, i);
    display.clearDisplay();
    display.drawBitmap(0, 0, frameBuf, OLED_W, OLED_H, SSD1306_WHITE);
    display.display();
    uint32_t spent = millis() - start;
    if (spent < FRAME_MS[n]) delay(FRAME_MS[n] - spent);
  }
}

void setup() {
  Serial.begin(115200);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println(F("SSD1306 not found: check the wiring and OLED_ADDR"));
    while (true) delay(1000);
  }
  display.clearDisplay();
  display.display();
}

void loop() {
  for (uint8_t n = 0; n < ANIM_COUNT; n++) {
    Serial.print(F("Playing "));
    Serial.println(ANIMS[n].name);
    for (uint8_t k = 0; k < LOOPS; k++) playAnim(n);
  }
}
`;
}

/** entries: [{ sym, label, frames, bytes, cli }] */
export function readme(entries, folder, withSketch, b) {
  const list = entries
    .map((e) => `| \`anim_${e.sym}.h\` | ${e.label.trim()} | ${e.frames} | ${(e.bytes / 1024).toFixed(1)} KB |`)
    .join('\n');
  const cli = entries.filter((e) => e.cli).map((e) => `    ${e.cli}`).join('\n');
  return `# ${folder}

Made with gif2cpp web. Same format as tools/gif2cpp.py; clips framed with Show all are byte-for-byte identical to its output.

| File | Name | Frames | Stored |
| --- | --- | ---: | ---: |
${list}

Flash: frames take ${b.framesKB.toFixed(0)} KB. The sketch itself needs roughly ${b.sketchKB} KB, and the default
4MB ESP32 partition gives about ${b.partitionKB} KB for the whole program, which leaves about ${b.freeKB.toFixed(0)} KB free.${b.tight ? '\nThat is tight: choose Tools > Partition Scheme > Huge APP.' : ''}

## Using the files

${withSketch
    ? `Open \`${folder}.ino\` in the Arduino IDE. It plays every animation in turn on an SSD1306.
To use the animations in your own sketch, copy \`animations.h\` and the \`anim_*.h\` files into
your sketch folder and \`#include "animations.h"\`.`
    : `Copy \`animations.h\` and the \`anim_*.h\` files into your sketch folder and
\`#include "animations.h"\`.`}

## Format

Each frame is 128x64 at 1 bit per pixel: 1024 bytes, row-major, most significant bit first
(the layout Adafruit_GFX \`drawBitmap\` expects). Every frame is XORed against the previous
frame, then PackBits compressed:

- control byte 0..127: copy the next n+1 bytes
- control byte 129..255 (int8 -1..-127): repeat the next byte 1-n times

\`<sym>_offsets[i]\` is where frame i starts in \`<sym>_data\`; the last entry is the total size.
Decode frames in order, starting from an all-zero buffer.
${cli ? `
## Same result with the Python script

${cli}
` : ''}`;
}
