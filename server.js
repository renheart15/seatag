import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
app.use(cors());
app.use(express.json());

// In-memory storage
let locations = [];
let locationIdCounter = 1;

// Latest status (shared across all requests)
let latestStatus = {
  status: 'WAITING',
  payload: 'Waiting for data...',
  timestamp: Date.now(),
};

// Create HTTP server
const server = createServer(app);
const wss = new WebSocketServer({ server });

// --- WebSocket Setup ---
wss.on('connection', (ws) => {
  console.log('✅ WebSocket client connected');
  ws.send(JSON.stringify(latestStatus));

  ws.on('close', () => {
    console.log('❌ WebSocket client disconnected');
  });
});

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(JSON.stringify(data));
  });
}

// --- API Routes ---

app.get('/api/status', (req, res) => {
  res.json(latestStatus);
});

app.get('/api/alerts', (req, res) => {
  const sorted = [...locations].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
  res.json({ locations: sorted, count: sorted.length });
});

app.post('/api/alerts', (req, res) => {
  const { status, payload } = req.body;
  if (!status || !payload) {
    return res.status(400).json({ success: false, message: 'Invalid payload' });
  }

  console.log('📨 Received:', { status, payload });

  const parts = payload.split('|');
  if (parts.length < 3) {
    return res.status(400).json({ success: false, message: 'Invalid format' });
  }

  let uptime = parts[5] || '0';
  let rssi = '';
  let snr = '';

  if (parts[5] && parts[5].includes(',')) {
    const uptimeParts = parts[5].split(',');
    uptime = uptimeParts[0] || '0';
    rssi = uptimeParts[1] || '';
    snr = uptimeParts[2] || '';
  }

  const alertData = {
    _id: (locationIdCounter++).toString(),
    status,
    latitude: parseFloat(parts[1]),
    longitude: parseFloat(parts[2]),
    speed: parts[3] || '0km/h',
    satellites: parts[4] || '0sat',
    uptime,
    rssi,
    snr,
    timestamp: new Date().toISOString(),
    rawPayload: payload,
  };

  latestStatus = {
    status,
    payload,
    timestamp: Date.now(),
    ...alertData,
  };

  if (status === 'EMERGENCY' || status === 'NORMAL') {
    locations.push(alertData);
    console.log('💾 Location saved');
  }

  broadcast(latestStatus);
  res.json({ success: true, message: 'Alert processed' });
});

app.delete('/api/alerts/:id', (req, res) => {
  const { id } = req.params;
  const before = locations.length;
  locations = locations.filter((l) => l._id !== id);
  res.json({
    success: locations.length < before,
    message: locations.length < before ? 'Deleted' : 'Not found',
  });
});

app.delete('/api/alerts', (req, res) => {
  locations = [];
  locationIdCounter = 1;
  res.json({ success: true, message: 'All cleared' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
});
