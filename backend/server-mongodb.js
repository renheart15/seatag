import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import mongoose from 'mongoose';

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/lora-tracker';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB Atlas connected');
    loadLatestStatus(); // Load latest alert on startup
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Location Schema
const locationSchema = new mongoose.Schema({
  status: { type: String, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  speed: String,
  satellites: String,
  uptime: String,
  rssi: String,
  snr: String,
  rawPayload: String,
  timestamp: { type: Date, default: Date.now }
});

const Location = mongoose.model('Location', locationSchema, 'alerts');

// Store latest status for WebSocket broadcast
let latestStatus = {
  status: 'WAITING',
  payload: 'Waiting for data...',
  timestamp: Date.now()
};

// Load latest alert from database on startup
async function loadLatestStatus() {
  try {
    const latestAlert = await Location.findOne().sort({ timestamp: -1 });
    if (latestAlert) {
      latestStatus = {
        status: latestAlert.status,
        payload: latestAlert.rawPayload,
        timestamp: latestAlert.timestamp.getTime(),
        latitude: latestAlert.latitude,
        longitude: latestAlert.longitude,
        speed: latestAlert.speed,
        satellites: latestAlert.satellites,
        uptime: latestAlert.uptime,
        rssi: latestAlert.rssi,
        snr: latestAlert.snr,
      };
      console.log('📍 Loaded latest status from database:', latestStatus);
    }
  } catch (err) {
    console.error('❌ Error loading latest status:', err);
  }
}

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
app.post('/api/alerts', async (req, res) => {
  const { status, payload } = req.body;

  if (!status || !payload) {
    return res.status(400).json({ success: false, message: 'Invalid payload' });
  }

  console.log('📨 Received from ESP8266:', { status, payload });

  // Parse the payload: STATUS|lat|lng|speed|satellites|uptime,rssi,snr
  const parts = payload.split('|');

  // STATUS messages might have less data, that's okay - just update live status
  if (status === 'STATUS') {
    latestStatus = {
      status,
      payload,
      timestamp: Date.now(),
    };
    broadcast(latestStatus);
    return res.json({ success: true, message: 'Status updated' });
  }

  // EMERGENCY and NORMAL messages need full GPS data
  if (parts.length >= 3) {
    // Parse uptime which may contain rssi and snr: "uptime,rssi,snr"
    let uptime = '0';
    let rssi = '';
    let snr = '';

    if (parts[5]) {
      const uptimeParts = parts[5].split(',');
      uptime = uptimeParts[0] || '0';
      rssi = uptimeParts[1] || '';
      snr = uptimeParts[2] || '';
    }

    const alertData = {
      status: status,
      latitude: parseFloat(parts[1]),
      longitude: parseFloat(parts[2]),
      speed: parts[3] || '0km/h',
      satellites: parts[4] || '0sat',
      uptime: uptime,
      rssi: rssi,
      snr: snr,
      timestamp: Date.now(),
      rawPayload: payload
    };

    // Update latest status
    latestStatus = {
      status: status,
      payload: payload,
      timestamp: Date.now(),
      ...alertData
    };

    // Save only EMERGENCY and NORMAL to MongoDB (not STATUS)
    if (status === 'EMERGENCY' || status === 'NORMAL') {
      try {
        const location = new Location(alertData);
        await location.save();
        console.log('💾 Location saved to database:', alertData);
      } catch (error) {
        console.error('❌ Error saving to database:', error);
      }
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

// Get all alerts from database
app.get('/api/alerts', async (req, res) => {
  try {
    const locations = await Location.find().sort({ timestamp: -1 });
    res.json({ locations, count: locations.length });
  } catch (error) {
    console.error('❌ Error fetching alerts:', error);
    res.status(500).json({ success: false, message: 'Error fetching alerts' });
  }
});

// Get latest status
app.get('/api/status', (req, res) => {
  res.json(latestStatus);
});

// Delete a specific alert by ID
app.delete('/api/alerts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await Location.findByIdAndDelete(id);

    if (result) {
      console.log(`🗑️ Alert ${id} deleted from database`);
      res.json({ success: true, message: 'Alert deleted' });
    } else {
      res.status(404).json({ success: false, message: 'Alert not found' });
    }
  } catch (error) {
    console.error('❌ Error deleting alert:', error);
    res.status(500).json({ success: false, message: 'Error deleting alert' });
  }
});

// Clear all alerts
app.delete('/api/alerts', async (req, res) => {
  try {
    await Location.deleteMany({});
    console.log('🗑️ All alerts cleared from database');
    res.json({ success: true, message: 'All alerts cleared' });
  } catch (error) {
    console.error('❌ Error clearing alerts:', error);
    res.status(500).json({ success: false, message: 'Error clearing alerts' });
  }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌐 API endpoints:`);
  console.log(`   POST   http://localhost:${PORT}/api/alerts - Receive alerts from ESP8266`);
  console.log(`   GET    http://localhost:${PORT}/api/alerts - Get all alerts from DB`);
  console.log(`   GET    http://localhost:${PORT}/api/status - Get latest status`);
  console.log(`   DELETE http://localhost:${PORT}/api/alerts/:id - Delete specific alert`);
  console.log(`   DELETE http://localhost:${PORT}/api/alerts - Clear all alerts`);
});
