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

// Store latest status per device for WebSocket broadcast
let latestStatusByDevice = new Map();

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
app.post('/api/alerts', (req, res) => {
  try {
    const { status, payload } = req.body;

    if (!status || !payload) {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    console.log('📨 Received:', { status, payload });

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
        _id: (locationIdCounter++).toString(),
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
        timestamp: new Date().toISOString(),
        rawPayload: payload
      };

      // Update latest status for this device
      latestStatusByDevice.set(deviceId, {
        ...alertData,
        payload: payload,
      });

      // Save only EMERGENCY and NORMAL to in-memory storage (not STATUS)
      if (actualStatus === 'EMERGENCY' || actualStatus === 'NORMAL') {
        locations.push(alertData);
        console.log('💾 Location saved:', alertData);
        console.log(`📊 Total locations: ${locations.length}`);
      } else {
        console.log('📍 STATUS mode - displayed on frontend only');
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
