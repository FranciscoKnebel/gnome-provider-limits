import GLib from "gi://GLib";

export class MockInputStream {
  constructor(data) {
    const encoded = new TextEncoder().encode(data);
    this._chunks = [];
    let offset = 0;
    while (offset < encoded.length) {
      const chunkSize = Math.min(256, encoded.length - offset);
      this._chunks.push(encoded.slice(offset, offset + chunkSize));
      offset += chunkSize;
    }
    if (this._chunks.length === 0) {
      this._chunks.push(new Uint8Array(0));
    }
    this._chunkIndex = 0;
  }

  async read_bytes_async(_count, _priority, _cancellable) {
    if (this._chunkIndex >= this._chunks.length) {
      return new GLib.Bytes(new Uint8Array(0));
    }
    const chunk = this._chunks[this._chunkIndex];
    this._chunkIndex++;
    return new GLib.Bytes(chunk);
  }

  async close_async(_priority, _cancellable) {
    // no-op
  }
}

export class MockOutputStream {
  constructor() {
    this.bytes = [];
  }

  async write_bytes_async(bytes, _priority, _cancellable) {
    const data = bytes instanceof Uint8Array ? bytes : bytes.toArray();
    this.bytes.push(data);
  }

  async close_async(_priority, _cancellable) {
    // no-op
  }
}

export class MockSubprocess {
  constructor(config) {
    this._config = config;
    this._forceExited = false;
    this._exitStatus = config.exitCode ?? 0;
  }

  get_stdin_pipe() {
    return new MockOutputStream();
  }

  get_stdout_pipe() {
    return new MockInputStream(this._config.stdout ?? "");
  }

  get_stderr_pipe() {
    return new MockInputStream(this._config.stderr ?? "");
  }

  get_exit_status() {
    return this._exitStatus;
  }

  force_exit() {
    this._forceExited = true;
  }

  async wait_check_async(_cancellable) {
    if (this._forceExited) {
      throw new Error("Forcibly exited");
    }
    if (this._config.delay) {
      await sleep(this._config.delay);
    }
    if (this._exitStatus !== 0) {
      throw new Error(`Exit status ${this._exitStatus}`);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });
}
