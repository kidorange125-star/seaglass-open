// Encryption at rest (src/worker/vault.ts). Run: node --experimental-strip-types tests/unit/vault.test.mts
import * as V from "../../src/worker/vault.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) pass++; else { fail++; console.log("FAIL", name, extra); } };
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch (e) { return e instanceof V.VaultError; } };

const K1 = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7 + 3)).toString("base64url");
const K2 = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 11 + 5)).toString("base64url");
const env = (o: Record<string, string> = {}) => ({ DATA_KEY: K1, ...o }) as never;

await V.configure(env());
const a = await V.seal("notes", "n1", "title", "My secret diary");
const b = await V.seal("notes", "n1", "title", "My secret diary");
ok("sealed text has the prefix and hides the plaintext", V.isSealedText(a) && !a!.includes("secret"), a ?? "");
ok("the same text seals differently each time (random nonce)", a !== b);
ok("round trip", (await V.open("notes", "n1", "title", a)) === "My secret diary");
ok("unicode and long text round trip", (await V.open("notes", "n1", "html", await V.seal("notes", "n1", "html", "héllo 🦆 ".repeat(5000)))) === "héllo 🦆 ".repeat(5000));
ok("empty string and null are left alone", (await V.seal("notes", "n1", "title", "")) === "" && (await V.seal("notes", "n1", "icon", null)) === null);
ok("a value moved to another row fails to open", await rejects(V.open("notes", "n2", "title", a)));
ok("a value moved to another column fails to open", await rejects(V.open("notes", "n1", "html", a)));
ok("a value moved to another table fails to open", await rejects(V.open("comments", "n1", "title", a)));
const flipped = a!.slice(0, -3) + (a!.endsWith("AAA") ? "BBB" : "AAA");
ok("a changed ciphertext is detected", await rejects(V.open("notes", "n1", "title", flipped)));
ok("a truncated ciphertext is rejected", await rejects(V.open("notes", "n1", "title", a!.slice(0, 20))));
ok("plaintext stored before encryption still opens (migration window)", (await V.open("notes", "n1", "title", "old plain")) === "old plain");
ok("needsSeal: plaintext yes, current-key ciphertext no", (await V.needsSeal("old plain")) && !(await V.needsSeal(a)) && !(await V.needsSeal("")) && !(await V.needsSeal(null)));

// bytes (files, vectors)
const data = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) % 256);
const sb = await V.sealBytes("files", "x/y.png", "body", data);
ok("sealed bytes are marked and larger by the header + tag", V.isSealedBytes(sb) && sb.length === data.length + 4 + 3 + 12 + 16);
ok("bytes round trip", Buffer.compare(Buffer.from(await V.openBytes("files", "x/y.png", "body", sb)), Buffer.from(data)) === 0);
ok("bytes moved to another file fail to open", await rejects(V.openBytes("files", "x/z.png", "body", sb)));
const sb2 = sb.slice(); sb2[sb2.length - 1] ^= 1;
ok("changed bytes are detected", await rejects(V.openBytes("files", "x/y.png", "body", sb2)));
ok("unsealed bytes pass through until strict", Buffer.compare(Buffer.from(await V.openBytes("files", "k", "body", data)), Buffer.from(data)) === 0);
ok("bytesNeedSeal", (await V.bytesNeedSeal(data)) && !(await V.bytesNeedSeal(sb)));

// each kind of data has its own key: the same bytes sealed as a different table won't open as another
const h = await V.seal("actions", "n1", "before_json", "{}x");
ok("history data opens as history", (await V.open("actions", "n1", "before_json", h)) === "{}x");

// rows
const row = await V.sealRow("notes", "n9", { id: "n9", title: "T", html: "<p>H</p>", revision: 3 }, ["title", "html", "missing"]);
ok("sealRow seals the listed string columns only", V.isSealedText(row.title) && V.isSealedText(row.html) && row.revision === 3 && row.id === "n9");
const back = await V.openRow("notes", row, ["title", "html"]);
ok("openRow gives the plaintext back", back.title === "T" && back.html === "<p>H</p>");

// key rotation
await V.configure(env({ DATA_KEY: K2, DATA_KEY_PREVIOUS: K1 }));
ok("after rotating, data sealed with the old key still opens", (await V.open("notes", "n1", "title", a)) === "My secret diary");
ok("...and is reported as needing a re-seal", await V.needsSeal(a));
const c = await V.seal("notes", "n1", "title", "My secret diary");
ok("new seals use the new key", c !== a && !(await V.needsSeal(c)) && (await V.open("notes", "n1", "title", c)) === "My secret diary");
await V.configure(env({ DATA_KEY: K2 }));
ok("without the old key, old data can't be opened (and says why)", await rejects(V.open("notes", "n1", "title", a)));
await V.configure(env({ DATA_KEY: K1 }));
ok("a different key can't open the data", await rejects(V.open("notes", "n1", "title", c)));

// strict mode
await V.configure(env({ VAULT_STRICT: "1" }));
ok("strict mode refuses plaintext", await rejects(V.open("notes", "n1", "title", "old plain")) && await rejects(V.openBytes("files", "k", "body", data)));
ok("strict mode still opens sealed data", (await V.open("notes", "n1", "title", a)) === "My secret diary");

// key handling
ok("a missing key is an error", await rejects(V.configure({} as never).then(() => V.seal("notes", "a", "b", "x"))));
ok("a short key is rejected", await rejects(V.configure({ DATA_KEY: "c2hvcnQ" } as never).then(() => V.seal("notes", "a", "b", "x"))));
ok("the key id changes with the key but never reveals it", await (async () => { await V.configure(env()); const x = await V.currentKeyId(); await V.configure(env({ DATA_KEY: K2 })); const y = await V.currentKeyId(); return x !== y && x.length === 6 && !K1.includes(x); })());

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
