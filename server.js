import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import mongoose from 'mongoose';

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://seatag:seatag123@cluster0.zuw4ldg.mongodb.net/seatag?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    loadLatestStatus(); // Load latest alert on startup
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// MongoDB Schema
const alertSchema = new mongoose.Schema({
  deviceId: String,
  deviceName: String,
  status: String,
  latitude: Number,
  longitude: Number,
  speed: String,
  satellites: String,
  uptime: String,
  rssi: String,
  snr: String,
  timestamp: { type: Date, default: Date.now },
  rawPayload: String,
});

const Alert = mongoose.model('Alert', alertSchema);

// Latest status (shared across all requests)
let latestStatus = {
  status: 'WAITING',
  payload: 'Waiting for data...',
  timestamp: Date.now(),
};

// Load latest alert from database on startup
async function loadLatestStatus() {
  try {
    const latestAlert = await Alert.findOne().sort({ timestamp: -1 });
    if (latestAlert) {
      latestStatus = {
        deviceId: latestAlert.deviceId || 'Unknown',
        deviceName: latestAlert.deviceName || latestAlert.deviceId || 'Unknown Device',
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

// Create HTTP server
const server = createServer(app);
const wss = new WebSocketServer({ server });

// --- WebSocket Setup ---
wss.on('connection', (ws) => {
  console.log('✅ Frontend WebSocket client connected');
  ws.send(JSON.stringify(latestStatus));

  ws.on('close', () => {
    console.log('❌ Frontend WebSocket client disconnected');
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

app.get('/api/alerts', async (req, res) => {
  try {
    const locations = await Alert.find().sort({ timestamp: -1 });
    res.json({ locations, count: locations.length });
  } catch (err) {
    console.error('Error fetching alerts:', err);
    res.status(500).json({ success: false, message: 'Error fetching alerts' });
  }
});

app.post('/api/alerts', async (req, res) => {
  // Log raw request for debugging
  console.log('📥 Raw body:', JSON.stringify(req.body));
  console.log('📥 Headers:', JSON.stringify(req.headers));

  const { status, payload } = req.body;
  if (!status || !payload) {
    console.error('❌ Missing status or payload:', { status, payload, body: req.body });
    return res.status(400).json({ success: false, message: 'Invalid payload' });
  }

  console.log('📨 Received:', { status, payload });

  const parts = payload.split('|');

  // Parse device ID and actual status from payload
  // Format: DEVICE_ID|STATUS|lat|lng|satellites|uptime,rssi,snr
  if (parts.length < 6) {
    console.error('❌ Invalid format - not enough parts:', { payload, parts });
    return res.status(400).json({ success: false, message: 'Invalid format' });
  }

  const deviceId = parts[0] || 'Unknown';
  const actualStatus = parts[1] || status;

  console.log('📱 Device ID:', deviceId);
  console.log('📝 Status:', actualStatus);

  // Parse uptime,rssi,snr from parts[5]
  let uptime = '0';
  let rssi = '';
  let snr = '';

  if (parts[5] && parts[5].includes(',')) {
    const uptimeParts = parts[5].split(',');
    uptime = uptimeParts[0] || '0';
    rssi = uptimeParts[1] || '';
    snr = uptimeParts[2] || '';
  }

  const alertData = {
    deviceId,
    deviceName: deviceId,
    status: actualStatus,
    latitude: parseFloat(parts[2]),
    longitude: parseFloat(parts[3]),
    speed: null,  // Speed no longer transmitted
    satellites: parts[4] || '0sat',
    uptime,
    rssi,
    snr,
    timestamp: new Date(),
    rawPayload: payload,
  };

  latestStatus = {
    deviceId,
    deviceName: deviceId,
    status: actualStatus,
    payload,
    timestamp: Date.now(),
    latitude: alertData.latitude,
    longitude: alertData.longitude,
    speed: null,  // Speed no longer transmitted
    satellites: alertData.satellites,
    uptime: alertData.uptime,
    rssi: alertData.rssi,
    snr: alertData.snr,
  };

  try {
    // Save all modes to database (EMERGENCY, NORMAL, and STATUS)
    const alert = new Alert(alertData);
    await alert.save();
    console.log(`💾 ${actualStatus} alert saved to MongoDB`);

    // Broadcast all messages to frontend
    broadcast(latestStatus);
    res.json({ success: true, message: 'Alert processed' });
  } catch (err) {
    console.error('Error saving alert:', err);
    res.status(500).json({ success: false, message: 'Error saving alert' });
  }
});

app.delete('/api/alerts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await Alert.findByIdAndDelete(id);
    res.json({
      success: !!result,
      message: result ? 'Deleted' : 'Not found',
    });
  } catch (err) {
    console.error('Error deleting alert:', err);
    res.status(500).json({ success: false, message: 'Error deleting alert' });
  }
});

app.delete('/api/alerts', async (req, res) => {
  try {
    await Alert.deleteMany({});
    res.json({ success: true, message: 'All cleared' });
  } catch (err) {
    console.error('Error clearing alerts:', err);
    res.status(500).json({ success: false, message: 'Error clearing alerts' });
  }
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
