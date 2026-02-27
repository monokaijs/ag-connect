import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { User } from './models/user.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRET_PATH = join(__dirname, '..', 'data', 'jwt-secret');

function loadOrCreateSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    return readFileSync(SECRET_PATH, 'utf8').trim();
  } catch {
    const secret = 'ag-' + Array.from({ length: 48 }, () => Math.random().toString(36)[2]).join('');
    try {
      mkdirSync(dirname(SECRET_PATH), { recursive: true });
      writeFileSync(SECRET_PATH, secret, 'utf8');
    } catch { }
    return secret;
  }
}

const JWT_SECRET = loadOrCreateSecret();
const JWT_EXPIRES_IN = '30d';

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const decoded = verifyToken(header.slice(7));
  if (!decoded) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  req.userId = decoded.sub;
  next();
}

async function verifyWsToken(token) {
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded) return null;
  const user = await User.findById(decoded.sub).lean();
  return user || null;
}

function setupAuthRoutes(app) {
  app.get('/api/auth/status', async (req, res) => {
    const count = await User.countDocuments();
    if (count === 0) {
      return res.json({ initialized: false });
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.json({ initialized: true, authenticated: false });
    }

    const decoded = verifyToken(header.slice(7));
    if (!decoded) {
      return res.json({ initialized: true, authenticated: false });
    }

    const user = await User.findById(decoded.sub).lean();
    if (!user) {
      return res.json({ initialized: true, authenticated: false });
    }

    return res.json({
      initialized: true,
      authenticated: true,
      user: { id: user._id, username: user.username },
    });
  });

  app.post('/api/auth/setup', async (req, res) => {
    const count = await User.countDocuments();
    if (count > 0) {
      return res.status(400).json({ error: 'already_initialized' });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'password_too_short' });
    }

    const passwordHash = User.hashPassword(password);
    const user = new User({ username, passwordHash });
    await user.save();

    const token = signToken(user._id);
    res.json({
      ok: true,
      token,
      user: { id: user._id, username: user.username },
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    const user = await User.findOne({ username });
    if (!user || !user.verifyPassword(password)) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const token = signToken(user._id);
    res.json({
      ok: true,
      token,
      user: { id: user._id, username: user.username },
    });
  });
}

export { setupAuthRoutes, requireAuth, verifyWsToken, JWT_SECRET };
