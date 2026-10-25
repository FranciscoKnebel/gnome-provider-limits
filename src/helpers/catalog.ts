export function parseCatalog(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  const little = magic === 0x950412de;
  if (!little && magic !== 0xde120495) throw new Error("Invalid MO magic");
  const word = (offset: number) => view.getUint32(offset, little);
  if (word(4) !== 0) throw new Error("Unsupported MO revision");
  const count = word(8);
  const original = word(12);
  const translated = word(16);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const read = (table: number, index: number) => {
    const length = word(table + index * 8);
    const offset = word(table + index * 8 + 4);
    if (offset + length >= bytes.length || bytes[offset + length] !== 0)
      throw new Error("Invalid MO string bounds");
    return decoder.decode(bytes.subarray(offset, offset + length));
  };
  const catalog = new Map<string, string>();
  for (let i = 0; i < count; i++) catalog.set(read(original, i), read(translated, i));
  return catalog;
}
