require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const crypto   = require('crypto');
const path     = require('path');
const { User, Analysis, Share } = require('./models');
const { rulesEngine, claudeEngine, hashText, ENGINE_VERSION } = require('./engine');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT || '15', 10);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function genRecoveryKey(){
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const block = () => Array.from(crypto.randomBytes(4)).map(b => chars[b % chars.length]).join('');
  return `PSY-${block()}-${block()}-${block()}`;
}
const normKey = k => String(k || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expired — sign in again' }); }
}

// ── Auth ────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name || !password || password.length < 6)
      return res.status(400).json({ error: 'Email, name and a 6+ char password required' });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ error: 'Email already registered' });
    const recoveryKey = genRecoveryKey();
    const user = await User.create({ email, name, passHash: await bcrypt.hash(password, 10), recoveryHash: await bcrypt.hash(normKey(recoveryKey), 10) });
    const token = jwt.sign({ id: user._id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, name: user.name, recoveryKey });
  } catch { res.status(500).json({ error: 'Registration failed' }); }
});

// Change password (logged in, requires current password)
app.post('/api/auth/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password needs 6+ chars' });
    const user = await User.findById(req.user.id);
    if (!user || !(await bcrypt.compare(currentPassword || '', user.passHash)))
      return res.status(401).json({ error: 'Current password is wrong' });
    user.passHash = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Could not change password' }); }
});

// Forgot password: email + recovery key -> set new password, rotate key
app.post('/api/auth/forgot', async (req, res) => {
  try {
    const { email, recoveryKey, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password needs 6+ chars' });
    const user = await User.findOne({ email: (email || '').toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Email or recovery key is wrong' });
    if (!user.recoveryHash) return res.status(400).json({ error: 'No recovery key on this account — sign in and generate one in Account settings' });
    if (!(await bcrypt.compare(normKey(recoveryKey), user.recoveryHash)))
      return res.status(401).json({ error: 'Email or recovery key is wrong' });
    const fresh = genRecoveryKey();
    user.passHash = await bcrypt.hash(newPassword, 10);
    user.recoveryHash = await bcrypt.hash(normKey(fresh), 10);
    await user.save();
    const token = jwt.sign({ id: user._id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, name: user.name, recoveryKey: fresh });
  } catch { res.status(500).json({ error: 'Reset failed' }); }
});

// Regenerate recovery key (logged in)
app.post('/api/auth/recovery-key', auth, async (req, res) => {
  try {
    const fresh = genRecoveryKey();
    await User.findByIdAndUpdate(req.user.id, { recoveryHash: await bcrypt.hash(normKey(fresh), 10) });
    res.json({ recoveryKey: fresh });
  } catch { res.status(500).json({ error: 'Could not generate key' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const user = await User.findOne({ email: (req.body.email || '').toLowerCase() });
    if (!user || !(await bcrypt.compare(req.body.password || '', user.passHash)))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, name: user.name });
  } catch { res.status(500).json({ error: 'Login failed' }); }
});

app.get('/api/me', auth, async (req, res) => {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const usedToday = await Analysis.countDocuments({ user: req.user.id, createdAt: { $gte: since } });
  res.json({ name: req.user.name, usedToday, dailyLimit: DAILY_LIMIT, aiEnabled: !!process.env.ANTHROPIC_API_KEY });
});

// ── Analyze (the core endpoint) ─────────────────────────────
app.post('/api/analyze', auth, async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    const label = String(req.body.label || '').slice(0, 60);
    if (text.length < 40) return res.status(400).json({ error: 'Give at least 40 characters — more text, better analysis' });

    // 1. Cache: same user + same text → return stored snapshot (zero cost)
    const textHash = hashText(text);
    const cached = await Analysis.findOne({ user: req.user.id, textHash, engineVersion: ENGINE_VERSION }).lean();
    if (cached) return res.json({ id: cached._id, result: cached.result, engine: cached.engine, cached: true, createdAt: cached.createdAt });

    // 2. Rate limit per day
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const usedToday = await Analysis.countDocuments({ user: req.user.id, createdAt: { $gte: since } });
    if (usedToday >= DAILY_LIMIT) return res.status(429).json({ error: `Daily limit of ${DAILY_LIMIT} analyses reached — resets at midnight` });

    // 3. Engine: Claude primary, rules fallback
    let result, engine = 'rules';
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        result = await claudeEngine(text, process.env.ANTHROPIC_API_KEY, process.env.CLAUDE_MODEL);
        engine = 'claude';
      } catch (e) { result = rulesEngine(text); }
    } else {
      result = rulesEngine(text);
    }

    // 4. Snapshot
    const doc = await Analysis.create({ user: req.user.id, textHash, inputText: text.slice(0, 1200), engine, engineVersion: ENGINE_VERSION, label, result });
    res.json({ id: doc._id, result, engine, cached: false, createdAt: doc.createdAt });
  } catch (e) { res.status(500).json({ error: 'Analysis failed — try again' }); }
});

// ── Snapshots / Evolution ───────────────────────────────────
app.get('/api/analyses', auth, async (req, res) => {
  const docs = await Analysis.find({ user: req.user.id })
    .sort({ createdAt: 1 }).limit(100)
    .select('result.prism result.archetype.primary engine label createdAt').lean();
  res.json({ analyses: docs });
});

app.get('/api/analyses/:id', auth, async (req, res) => {
  const doc = await Analysis.findOne({ _id: req.params.id, user: req.user.id }).lean();
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

app.delete('/api/analyses/:id', auth, async (req, res) => {
  await Analysis.deleteOne({ _id: req.params.id, user: req.user.id });
  res.json({ ok: true });
});

// ── Share ───────────────────────────────────────────────────
app.post('/api/share', auth, async (req, res) => {
  const doc = await Analysis.findOne({ _id: req.body.id, user: req.user.id }).lean();
  if (!doc) return res.status(404).json({ error: 'Analysis not found' });
  const shareId = crypto.randomBytes(6).toString('base64url');
  await Share.create({ shareId, owner: req.user.id, payload: { result: doc.result, name: req.user.name, date: doc.createdAt } });
  res.json({ shareId });
});

app.get('/api/share/:id', async (req, res) => {
  const s = await Share.findOne({ shareId: req.params.id }).lean();
  if (!s) return res.status(404).json({ error: 'Link expired or invalid' });
  res.json(s.payload);
});

app.get('/s/:id', (req, res) => res.redirect(`/#s=${req.params.id}`));

// ── Boot ────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/psyche10')
  .then(() => app.listen(PORT, () => console.log(`Psyche v12 Keymaster running → http://localhost:${PORT}  [AI: ${process.env.ANTHROPIC_API_KEY ? 'Claude' : 'rule-based fallback'}]`)))
  .catch(err => { console.error('MongoDB connection failed:', err.message); process.exit(1); });
