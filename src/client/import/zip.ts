// A small zip reader for the importers (no dependency): reads the central directory, then inflates an entry only when
// it's asked for, with the browser's own DecompressionStream("deflate-raw"). Handles Zip64 (exports over 4 GB or with
// over 65,535 files) and zips inside zips (Notion's export is a zip of zips). Skips macOS's __MACOSX/ and ._ copies.

export type Entry = { path: string; size: number; read: () => Promise<Blob> };

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);
const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));
const view = async (b: Blob, start: number, end: number) => new DataView(await b.slice(start, end).arrayBuffer());

/** Whether a file starts like a zip ("PK\3\4", or an empty zip). */
export async function isZip(b: Blob) {
  if (b.size < 4) return false;
  const v = await view(b, 0, 4);
  return u32(v, 0) === 0x04034b50 || u32(v, 0) === 0x06054b50;
}

async function directory(b: Blob): Promise<{ count: number; offset: number; size: number }> {
  const tail = Math.min(b.size, 65_557);
  const v = await view(b, b.size - tail, b.size);
  let at = -1;
  for (let i = tail - 22; i >= 0; i--) if (u32(v, i) === 0x06054b50) { at = i; break; }
  if (at < 0) throw new Error("This isn't a zip file, or it's damaged.");
  let count = u16(v, at + 10), size = u32(v, at + 12), offset = u32(v, at + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const loc = at - 20;
    if (loc >= 0 && u32(v, loc) === 0x07064b50) {
      const recAt = u64(v, loc + 8);
      const r = await view(b, recAt, recAt + 56);
      if (u32(r, 0) === 0x06064b50) { count = u64(r, 32); size = u64(r, 40); offset = u64(r, 48); }
    }
  }
  return { count, offset, size };
}

const skip = (p: string) => p.endsWith("/") || /(^|\/)__MACOSX\//.test(p) || /(^|\/)\._/.test(p) || /(^|\/)\.DS_Store$/.test(p);

/** Every file in a zip (and in zips inside it, under the inner zip's name without ".zip"). */
export async function readZip(b: Blob, prefix = "", depth = 0): Promise<Entry[]> {
  const { count, offset, size } = await directory(b);
  const cd = await view(b, offset, offset + size);
  const out: Entry[] = [];
  const dec = new TextDecoder();
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const method = u16(cd, p + 10);
    let comp = u32(cd, p + 20), full = u32(cd, p + 24), local = u32(cd, p + 42);
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen)).replace(/\\/g, "/");
    // Zip64 sizes and offset live in extra field 0x0001, in this order, only for the ones set to 0xffffffff.
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = u16(cd, e), len = u16(cd, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (full === 0xffffffff) { full = u64(cd, q); q += 8; }
        if (comp === 0xffffffff) { comp = u64(cd, q); q += 8; }
        if (local === 0xffffffff) { local = u64(cd, q); }
      }
      e += 4 + len;
    }
    p = eEnd + commentLen;
    if (skip(name)) continue;
    const read = async () => {
      const h = await view(b, local, local + 30);
      const start = local + 30 + u16(h, 26) + u16(h, 28);
      const raw = b.slice(start, start + comp);
      if (method === 0) return raw;
      if (method !== 8) throw new Error(`${name} uses a compression this importer can't read.`);
      return new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    };
    if (/\.zip$/i.test(name) && depth < 3) {
      try { out.push(...(await readZip(await read(), prefix + name.replace(/\.zip$/i, "") + "/", depth + 1))); continue; } catch { /* not a zip after all: keep it as a file */ }
    }
    out.push({ path: prefix + name, size: full, read });
  }
  return out;
}
