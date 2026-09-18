const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ====== CONFIG ======
// Set ADMIN_PASSWORD in Render's environment variables!
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';
const DATA_FILE = path.join(__dirname, 'data.json');

// ====== MIDDLEWARE ======
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'demo-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 4 } // 4 hours
}));

// ====== DATA STORAGE (JSON file) ======
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data:', e);
  }
  // Default data
  return {
    alex: { balance: 200.00, transactions: [] }
  };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error saving data:', e);
  }
}

// ====== AUTH MIDDLEWARE ======
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect('/admin/login');
}

// ====== PUBLIC API ======
// Get list of personas (names + balances) for the public dropdown
app.get('/api/personas', (req, res) => {
  const data = loadData();
  const list = Object.keys(data).map(name => ({
    name,
    balance: data[name].balance
  }));
  res.json(list);
});

// Get a specific persona's data
app.get('/api/persona/:name', (req, res) => {
  const data = loadData();
  const persona = data[req.params.name];
  if (!persona) return res.status(404).json({ error: 'Not found' });
  res.json(persona);
});

// Deposit / withdraw for a persona
app.post('/api/persona/:name/transaction', (req, res) => {
  const { type, amount } = req.body;
  const name = req.params.name;
  const data = loadData();

  if (!data[name]) return res.status(404).json({ error: 'Persona not found' });
  if (type !== 'deposit' && type !== 'withdraw') {
    return res.status(400).json({ error: 'Invalid type' });
  }

  const amt = Math.round(parseFloat(amount) * 100) / 100;
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const persona = data[name];
  if (type === 'withdraw' && amt > persona.balance + 0.0001) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  if (type === 'deposit') {
    persona.balance += amt;
  } else {
    persona.balance -= amt;
  }
  persona.balance = Math.round(persona.balance * 100) / 100;

  if (!persona.transactions) persona.transactions = [];
  persona.transactions.push({ type, amount: amt, timestamp: Date.now() });
  if (persona.transactions.length > 30) {
    persona.transactions = persona.transactions.slice(-30);
  }

  saveData(data);
  res.json({ success: true, balance: persona.balance, transactions: persona.transactions });
});

// Reset a persona's balance
app.post('/api/persona/:name/reset', (req, res) => {
  const name = req.params.name;
  const data = loadData();
  if (!data[name]) return res.status(404).json({ error: 'Persona not found' });

  data[name].balance = 200.00;
  data[name].transactions = [];
  saveData(data);
  res.json({ success: true, balance: 200.00, transactions: [] });
});

// ====== ADMIN AUTH ROUTES ======
app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?error=1');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ====== PROTECTED ADMIN ROUTES ======
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Admin: set balance directly
app.post('/admin/api/set-balance', requireAdmin, (req, res) => {
  const { name, balance } = req.body;
  const data = loadData();
  if (!data[name]) return res.status(404).json({ error: 'Persona not found' });

  const newBalance = Math.round(parseFloat(balance) * 100) / 100;
  if (isNaN(newBalance) || newBalance < 0) {
    return res.status(400).json({ error: 'Invalid balance' });
  }

  data[name].balance = newBalance;
  saveData(data);
  res.json({ success: true });
});

// Admin: add persona
app.post('/admin/api/add-persona', requireAdmin, (req, res) => {
  const { name } = req.body;
  const cleanName = (name || '').trim().toLowerCase();

  if (!cleanName || !/^[a-z0-9_-]{1,20}$/.test(cleanName)) {
    return res.status(400).json({ error: 'Invalid name (a-z, 0-9, _, - only)' });
  }

  const data = loadData();
  if (data[cleanName]) {
    return res.status(400).json({ error: 'Persona already exists' });
  }

  data[cleanName] = { balance: 200.00, transactions: [] };
  saveData(data);
  res.json({ success: true });
});

// Admin: delete persona
app.post('/admin/api/delete-persona', requireAdmin, (req, res) => {
  const { name } = req.body;
  const data = loadData();

  if (Object.keys(data).length <= 1) {
    return res.status(400).json({ error: 'Cannot delete the last persona' });
  }
  if (!data[name]) return res.status(404).json({ error: 'Not found' });

  delete data[name];
  saveData(data);
  res.json({ success: true });
});

// ====== STATIC FILES ======
app.use(express.static(path.join(__dirname, 'public')));

// ====== START SERVER ======
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔒 Admin password: ${ADMIN_PASSWORD === 'changeme123' ? '⚠️  DEFAULT (change it!)' : '✓ Set'}`);
});
