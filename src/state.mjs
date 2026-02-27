import { mkdir, readFile, writeFile, rename, appendFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const DATA_DIR = join(ROOT_DIR, 'data');
const LOGS_DIR = join(ROOT_DIR, '.logs');
const LOG_FILE = join(LOGS_DIR, `ag-connect-${new Date().toISOString().split('T')[0]}.log`);
const STATE_FILE = join(DATA_DIR, 'state.json');

let state = {
  messages: [],
  agent: { state: 'idle', lastSeen: null, task: '', note: '' },
  tokens: [],
};

let tokens = new Set();

async function log(component, message, data = null) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${component}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`;
  console.log(line);
  try {
    await appendFile(LOG_FILE, line + '\n');
  } catch {}
}

let saveTimeout = null;

async function saveState() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      const data = {
        messages: state.messages,
        agent: state.agent,
        tokens: Array.from(tokens),
      };
      const tempFile = `${STATE_FILE}.tmp`;
      await writeFile(tempFile, JSON.stringify(data, null, 2));
      await rename(tempFile, STATE_FILE);
    } catch (err) {
      await log('PERSIST', 'Failed to save state', err.message);
    }
  }, 250);
}

async function loadState() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await mkdir(LOGS_DIR, { recursive: true });
    const raw = await readFile(STATE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.messages)) state.messages = data.messages;
    if (data.agent) state.agent = data.agent;
    if (Array.isArray(data.tokens)) {
      state.tokens = data.tokens;
      tokens = new Set(data.tokens);
    }
    await log('PERSIST', `State loaded. ${tokens.size} tokens.`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await log('PERSIST', 'No state file found. Starting fresh.');
      await saveState();
    } else {
      await log('PERSIST', 'Failed to load state', err.message);
    }
  }
}

function generatePairingCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function generateMessageId() {
  return 'msg_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

export {
  state,
  tokens,
  log,
  saveState,
  loadState,
  generatePairingCode,
  generateToken,
  generateMessageId,
  DATA_DIR,
  ROOT_DIR,
};
