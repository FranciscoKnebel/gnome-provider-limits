import GLib from "gi://GLib";

export class MockSoupSession {
  constructor(responseMap) {
    this._responseMap = responseMap;
  }

  async send_and_read_async(message, _priority, _cancellable) {
    const uri = message.get_uri().to_string();
    for (const [pattern, resp] of this._responseMap) {
      if (uri.includes(pattern)) {
        message.status_code = resp.status;
        return new GLib.Bytes(new TextEncoder().encode(resp.body));
      }
    }
    message.status_code = 404;
    return new GLib.Bytes(new TextEncoder().encode("{}"));
  }
}
