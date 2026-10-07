import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

// Inspect the committed deployment artifact, without adding runtime ZIP dependencies.
function zipEntries(zip) {
  const eocd = zip.length - 22; assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  const count = zip.readUInt16LE(eocd + 10); let offset = zip.readUInt32LE(eocd + 16); const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const size = zip.readUInt32LE(offset + 20), local = zip.readUInt32LE(offset + 42); assert.equal(zip.readUInt32LE(local), 0x04034b50); assert.equal(zip.readUInt16LE(local + 8), 8);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entries.push({ name, platform: zip[offset + 5], mode: zip.readUInt32LE(offset + 38) >>> 16, bytes: inflateRawSync(zip.subarray(start, start + size)) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
test('published SCF ZIP contains exactly current sources at root, no credentials/dependencies and Linux bootstrap permissions', async () => {
  const entries = zipEntries(await readFile(new URL('../backend/tencent-scf.zip', import.meta.url)));
  assert.deepEqual(entries.map(e => e.name), ['server.mjs', 'pronunciation-worker.js', 'package.json', 'scf_bootstrap']);
  for (const entry of entries) {
    const source = await readFile(new URL('../backend/' + entry.name, import.meta.url), 'utf8');
    assert.deepEqual(entry.bytes, Buffer.from(source.replace(/\r\n/g, '\n')));
    assert.equal(entry.platform, 3); assert.equal(entry.mode, entry.name === 'scf_bootstrap' ? 0o100755 : 0o100644);
    assert.ok(!entry.bytes.includes(13), 'all runtime files use LF');
  }
  const boot = entries.find(e => e.name === 'scf_bootstrap').bytes.toString(); assert.match(boot, /^#!\/bin\/bash\n/); assert.match(boot, /exec \/var\/lang\/node20\/bin\/node \/var\/user\/server.mjs/); assert.ok(boot.endsWith('\n'));
  const pkg = JSON.parse(entries.find(e => e.name === 'package.json').bytes); assert.equal(pkg.dependencies, undefined); assert.equal(pkg.engines.node, '>=20');
});
