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
  deviceId: { type: String, required: true, index: true },
  deviceName: { type: String },
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

// Compound index for efficient querying by device and time
locationSchema.index({ deviceId: 1, timestamp: -1 });

const Location = mongoose.model('Location', locationSchema, 'alerts');

// Store latest status per device for WebSocket broadcast
let latestStatusByDevice = new Map();

// Load latest alert for each device from database on startup
async function loadLatestStatus() {
  try {
    // Get distinct device IDs
    const deviceIds = await Location.distinct('deviceId');

    // Load latest alert for each device
    for (const deviceId of deviceIds) {
      const latestAlert = await Location.findOne({ deviceId }).sort({ timestamp: -1 });
      if (latestAlert) {
        latestStatusByDevice.set(deviceId, {
          deviceId: latestAlert.deviceId,
          deviceName: latestAlert.deviceName || deviceId,
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
        });
      }
    }
    console.log(`📍 Loaded latest status for ${deviceIds.length} device(s) from database`);
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

  // Send latest status for all devices immediately
  latestStatusByDevice.forEach((status, deviceId) => {
    ws.send(JSON.stringify(status));
  });

  ws.on('close', () => {
    console.log('❌ WebSocket client disconnected');
  });
});

// API endpoint to receive alerts from ESP8266 receiver
app.post('/api/alerts', async (req, res) => {
  try {
    const { status, payload } = req.body;

    if (!status || !payload) {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    console.log('📨 Received from ESP8266:', { status, payload });

    // Parse the payload: DEVICE_ID|STATUS|lat|lng|speed|satellites|uptime,rssi,snr
    const parts = payload.split('|');

    console.log('🔍 Parsed parts:', parts);
    console.log('🔍 Parts length:', parts.length);

    if (parts.length < 2) {
      return res.status(400).json({ success: false, message: 'Invalid payload format - missing device ID' });
    }

    const deviceId = parts[0];
    const actualStatus = parts[1];

    console.log('📱 Device ID:', deviceId);
    console.log('📝 Actual Status:', actualStatus);

  // STATUS messages might have less data, that's okay - just update live status
  if (actualStatus === 'STATUS' && parts.length >= 7) {
    // Parse uptime which may contain rssi and snr: "uptime,rssi,snr"
    let uptime = '0';
    let rssi = '';
    let snr = '';

    if (parts[6]) {
      const uptimeParts = parts[6].split(',');
      uptime = uptimeParts[0] || '0';
      rssi = uptimeParts[1] || '';
      snr = uptimeParts[2] || '';
    }

    const statusData = {
      deviceId: deviceId,
      deviceName: deviceId,
      status: actualStatus,
      latitude: parseFloat(parts[2]),
      longitude: parseFloat(parts[3]),
      speed: parts[4] || '0km/h',
      satellites: parts[5] || '0sat',
      uptime: uptime,
      rssi: rssi,
      snr: snr,
      payload: payload,
      timestamp: Date.now(),
    };

    latestStatusByDevice.set(deviceId, statusData);
    broadcast(statusData);
    return res.json({ success: true, message: 'Status updated' });
  }

  // EMERGENCY and NORMAL messages need full GPS data
  if (parts.length >= 7) {
    // Parse uptime which may contain rssi and snr: "uptime,rssi,snr"
    let uptime = '0';
    let rssi = '';
    let snr = '';

    if (parts[6]) {
      const uptimeParts = parts[6].split(',');
      uptime = uptimeParts[0] || '0';
      rssi = uptimeParts[1] || '';
      snr = uptimeParts[2] || '';
    }

    const alertData = {
      deviceId: deviceId,
      deviceName: deviceId,
      status: actualStatus,
      latitude: parseFloat(parts[2]),
      longitude: parseFloat(parts[3]),
      speed: parts[4] || '0km/h',
      satellites: parts[5] || '0sat',
      uptime: uptime,
      rssi: rssi,
      snr: snr,
      timestamp: Date.now(),
      rawPayload: payload
    };

    // Update latest status for this device
    latestStatusByDevice.set(deviceId, {
      ...alertData,
      payload: payload,
    });

    // Save only EMERGENCY and NORMAL to MongoDB (not STATUS)
    if (actualStatus === 'EMERGENCY' || actualStatus === 'NORMAL') {
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
    broadcast(latestStatusByDevice.get(deviceId));

    res.json({ success: true, message: 'Alert received' + (actualStatus === 'EMERGENCY' || actualStatus === 'NORMAL' ? ' and saved' : '') });
  } else {
    res.status(400).json({ success: false, message: 'Invalid payload format - insufficient data' });
  }
  } catch (error) {
    console.error('❌ Error processing alert:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
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

// Get latest status for all devices
app.get('/api/status', (req, res) => {
  const allStatuses = Array.from(latestStatusByDevice.values());
  res.json({ devices: allStatuses, count: allStatuses.length });
});

// Get latest status for specific device
app.get('/api/status/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const status = latestStatusByDevice.get(deviceId);

  if (status) {
    res.json(status);
  } else {
    res.status(404).json({ success: false, message: 'Device not found' });
  }
});

// Get all unique devices
app.get('/api/devices', async (req, res) => {
  try {
    const deviceIds = await Location.distinct('deviceId');
    const devices = deviceIds.map(id => ({
      deviceId: id,
      deviceName: id,
      latestStatus: latestStatusByDevice.get(id) || null
    }));
    res.json({ devices, count: devices.length });
  } catch (error) {
    console.error('❌ Error fetching devices:', error);
    res.status(500).json({ success: false, message: 'Error fetching devices' });
  }
});

// Get alerts for specific device
app.get('/api/alerts/device/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const locations = await Location.find({ deviceId }).sort({ timestamp: -1 });
    res.json({ locations, count: locations.length });
  } catch (error) {
    console.error('❌ Error fetching alerts for device:', error);
    res.status(500).json({ success: false, message: 'Error fetching alerts' });
  }
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
