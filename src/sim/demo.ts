// Demos of the original (DEMO0.BIN ... DEMO9.BIN): byte 0 = level number, then one byte per
// input run — low nibble = input (Input.*), high nibble = repeat count - 1 — ending with 0xFF.

export interface Demo {
  level: number; // 1-based
  data: Uint8Array; // input bytes after the level number, including the final 0xFF
}

export function parseDemo(file: Uint8Array): Demo {
  return { level: file[0]!, data: file.subarray(1) };
}

/** Feeds demo input the way the original does (simulateDemoInput). */
export class DemoPlayer {
  private index = 0;
  private repeat = 1;
  input = 0;
  ended = false;

  constructor(private readonly demo: Demo) {
    this.step(); // the original reads the first input right after the level starts
  }

  /** Call once per game iteration, before updating the game. */
  step(): number {
    if (this.repeat > 1) {
      this.repeat--;
      return this.input;
    }
    const b = this.demo.data[this.index] ?? 0xff;
    if (b === 0xff) this.ended = true;
    else this.index++;
    this.input = b & 0xf;
    this.repeat = (b >> 4) + 1;
    return this.input;
  }
}
