import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage (replaces MongoDB)
let locations = [];
let locationIdCounter = 1;

// Store latest status for WebSocket broadcast
let latestStatus = {
  status: 'WAITING',
  payload: 'Waiting for data...',
  timestamp: Date.now()
};

// HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server });

// Broadcast to all connected WebSocket clients
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(JSON.stringify(data));
    }
  });
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('✅ WebSocket client connected');

  // Send latest status immediately
  ws.send(JSON.stringify(latestStatus));

  ws.on('close', () => {
    console.log('❌ WebSocket client disconnected');
  });
});

// API endpoint to receive alerts from ESP8266 receiver
app.post('/api/alerts', (req, res) => {
  const { status, payload } = req.body;

  console.log('📨 Received from ESP8266:', { status, payload });

  // Parse the payload: STATUS|lat|lng|speed|satellites|uptime,rssi,snr
  const parts = payload.split('|');

  if (parts.length >= 3) {
    // Parse uptime, rssi, snr from the last part
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
      status: status,
      latitude: parseFloat(parts[1]),
      longitude: parseFloat(parts[2]),
      speed: parts[3] || '0km/h',
      satellites: parts[4] || '0sat',
      uptime: uptime,
      rssi: rssi,
      snr: snr,
      timestamp: new Date().toISOString(),
      rawPayload: payload
    };

    // Update latest status
    latestStatus = {
      status: status,
      payload: payload,
      timestamp: Date.now(),
      ...alertData
    };

    // Save only EMERGENCY and NORMAL to database (not STATUS)
    if (status === 'EMERGENCY' || status === 'NORMAL') {
      locations.push(alertData);
      console.log('💾 Location saved to database:', alertData);
      console.log(`📊 Total locations in database: ${locations.length}`);
    } else {
      console.log('📍 STATUS mode - displayed on frontend only (not saved to database)');
    }

    // Broadcast to all WebSocket clients (all modes including STATUS)
    broadcast(latestStatus);

    res.json({ success: true, message: 'Alert received' + (status === 'EMERGENCY' || status === 'NORMAL' ? ' and saved' : '') });
  } else {
    res.status(400).json({ success: false, message: 'Invalid payload format' });
  }
});

// Get all alerts from memory
app.get('/api/alerts', (req, res) => {
  // Sort by timestamp descending (newest first)
  const sortedLocations = [...locations].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  res.json({ locations: sortedLocations, count: sortedLocations.length });
});

// Get latest status
app.get('/api/status', (req, res) => {
  res.json(latestStatus);
});

// Delete a specific alert by ID
app.delete('/api/alerts/:id', (req, res) => {
  const { id } = req.params;
  const initialLength = locations.length;

  locations = locations.filter(loc => loc._id !== id);

  if (locations.length < initialLength) {
    console.log(`🗑️ Alert ${id} deleted from memory`);
    res.json({ success: true, message: 'Alert deleted' });
  } else {
    res.status(404).json({ success: false, message: 'Alert not found' });
  }
});

// Clear all alerts
app.delete('/api/alerts', (req, res) => {
  locations = [];
  locationIdCounter = 1;
  console.log('🗑️ All alerts cleared from memory');
  res.json({ success: true, message: 'All alerts cleared' });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`💾 Using IN-MEMORY storage (no database required)`);
  console.log(`🌐 API endpoints:`);
  console.log(`   POST   http://localhost:${PORT}/api/alerts - Receive alerts from ESP8266`);
  console.log(`   GET    http://localhost:${PORT}/api/alerts - Get all alerts`);
  console.log(`   GET    http://localhost:${PORT}/api/status - Get latest status`);
  console.log(`   DELETE http://localhost:${PORT}/api/alerts/:id - Delete specific alert`);
  console.log(`   DELETE http://localhost:${PORT}/api/alerts - Clear all alerts`);
  console.log(`\n⚠️  Note: Data will be lost when server restarts!`);
});
