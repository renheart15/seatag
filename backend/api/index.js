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

// Latest status per device (shared across all requests)
let latestStatusByDevice = new Map();

// Create a simple HTTP server (Vercel will handle it)
const server = createServer(app);
const wss = new WebSocketServer({ server });

// --- WebSocket Setup ---
wss.on('connection', (ws) => {
  console.log('✅ WebSocket client connected');

  // Send latest status for all devices
  latestStatusByDevice.forEach((status, deviceId) => {
    ws.send(JSON.stringify(status));
  });

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
  const allStatuses = Array.from(latestStatusByDevice.values());
  res.json({ devices: allStatuses, count: allStatuses.length });
});

app.get('/api/alerts', (req, res) => {
  const sorted = [...locations].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
  res.json({ locations: sorted, count: sorted.length });
});

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

    // Parse full GPS data
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
        uptime,
        rssi,
        snr,
        timestamp: new Date().toISOString(),
        rawPayload: payload,
      };

      // Update latest status for this device
      latestStatusByDevice.set(deviceId, {
        ...alertData,
        payload: payload,
        timestamp: Date.now(),
      });

      if (actualStatus === 'EMERGENCY' || actualStatus === 'NORMAL') {
        locations.push(alertData);
        console.log('💾 Location saved:', deviceId, actualStatus);
      }

      broadcast(latestStatusByDevice.get(deviceId));
      res.json({ success: true, message: 'Alert processed' });
    } else {
      res.status(400).json({ success: false, message: 'Invalid payload format - insufficient data' });
    }
  } catch (error) {
    console.error('❌ Error processing alert:', error);
    console.error('❌ Stack:', error.stack);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
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

// ✅ Export handler for Vercel
export default function handler(req, res) {
  app(req, res);
}

// WebSocket server (Vercel doesn’t persist, so only works temporarily)
server.listen(5000, () => {
  console.log('🚀 Local server running on port 5000 (for dev only)');
});
