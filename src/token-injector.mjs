import { execInContainer } from './docker-manager.mjs';

function encodeVarint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function encodeLenDelimField(fieldNum, data) {
  const tag = encodeVarint((fieldNum << 3) | 2);
  const len = encodeVarint(data.length);
  return Buffer.concat([tag, len, data]);
}

function encodeStringField(fieldNum, value) {
  return encodeLenDelimField(fieldNum, Buffer.from(value, 'utf8'));
}

function createOAuthInfo(accessToken, refreshToken, expiry) {
  const field1 = encodeStringField(1, accessToken);
  const field2 = encodeStringField(2, 'Bearer');
  const field3 = encodeStringField(3, refreshToken);
  const timestampTag = encodeVarint((1 << 3) | 0);
  const timestampVal = encodeVarint(expiry);
  const timestampMsg = Buffer.concat([timestampTag, timestampVal]);
  const field4 = encodeLenDelimField(4, timestampMsg);
  return Buffer.concat([field1, field2, field3, field4]);
}

function buildTokenPayload(accessToken, refreshToken, expiryTimestamp) {
  const oauthInfo = createOAuthInfo(accessToken, refreshToken, expiryTimestamp);
  const oauthInfoB64 = oauthInfo.toString('base64');
  const inner2 = encodeStringField(1, oauthInfoB64);
  const inner1 = encodeStringField(1, 'oauthTokenInfoSentinelKey');
  const inner = Buffer.concat([inner1, encodeLenDelimField(2, inner2)]);
  const outer = encodeLenDelimField(1, inner);
  return outer.toString('base64');
}

async function injectTokensIntoContainer(containerId, accessToken, refreshToken, expiryTimestamp) {
  const tokenPayload = buildTokenPayload(accessToken, refreshToken, expiryTimestamp);

  const dbPath = '/home/aguser/.config/Antigravity/User/globalStorage/state.vscdb';
  const pyScript = `
import sqlite3, sys
db = sqlite3.connect('${dbPath}')
db.execute('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)')
db.execute('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', ('antigravityUnifiedStateSync.oauthToken', sys.argv[1]))
db.execute('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', ('antigravityOnboarding', 'true'))
db.commit()
db.close()
print('Tokens injected')
`.trim();

  await execInContainer(containerId, `python3 -c "${pyScript.replace(/"/g, '\\"')}" "${tokenPayload}"`);
}

export { injectTokensIntoContainer, buildTokenPayload };
