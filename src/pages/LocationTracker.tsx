import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import L from 'leaflet';
import '../utils/leafletIcon';

interface LocationMarker {
  position: LatLngExpression;
  timestamp: number;
  status: string;
  speed?: string;
  satellites?: string;
  rssi?: string;
  snr?: string;
}

interface LoRaData {
  status: string;
  latitude: number;
  longitude: number;
  speed?: string;
  satellites?: string;
  rssi?: string;
  snr?: string;
  timestamp: number;
  payload?: string;
}

function RecenterMap({ center, zoom }: { center: LatLngExpression; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom || 13);
  }, [center, map, zoom]);
  return null;
}

function CenterMapButton({ center }: { center: LatLngExpression }) {
  const map = useMap();

  const handleCenter = () => {
    map.setView(center, 13, { animate: true });
  };

  return (
    <button
      onClick={handleCenter}
      className="leaflet-control bg-white hover:bg-gray-100 border-2 border-gray-400 rounded shadow-md w-8 h-8 flex items-center justify-center cursor-pointer"
      style={{ position: 'absolute', top: '80px', left: '10px', zIndex: 1000 }}
      title="Center map on location"
    >
      <svg
        className="w-5 h-5 text-gray-700"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    </button>
  );
}

interface LocationTrackerProps {
  onNavigateToLogs: () => void;
}

export default function LocationTracker({ onNavigateToLogs }: LocationTrackerProps) {
  const [userLocation, setUserLocation] = useState<LatLngExpression>([14.5995, 120.9842]); // Manila default
  const [latestMarker, setLatestMarker] = useState<LocationMarker | null>(null);
  const [deviceLocation, setDeviceLocation] = useState<LatLngExpression | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loraStatus, setLoraStatus] = useState<string>('Connecting...');
  const [lastLoraUpdate, setLastLoraUpdate] = useState<string>('');
  const [loraConnected, setLoraConnected] = useState(false);
  const [trackingDevice, setTrackingDevice] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // WebSocket connection for LoRa data
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket('wss://seatag.onrender.com');

      ws.onopen = () => {
        console.log('✅ WebSocket connected to LoRa receiver');
        setLoraConnected(true);
        setLoraStatus('Connected');
      };

      ws.onmessage = (event) => {
        try {
          const data: LoRaData = JSON.parse(event.data);
          console.log('📡 Received LoRa data:', data);

          if (data.latitude && data.longitude) {
            const newPosition: LatLngExpression = [data.latitude, data.longitude];

            // Update map center
            setUserLocation(newPosition);

            // Update latest marker (only keep the most recent one)
            const newMarker: LocationMarker = {
              position: newPosition,
              timestamp: data.timestamp || Date.now(),
              status: data.status,
              speed: data.speed,
              satellites: data.satellites,
              rssi: data.rssi,
              snr: data.snr
            };

            setLatestMarker(newMarker);

            // Update status
            setLoraStatus(data.status);
            setLastLoraUpdate(new Date(data.timestamp).toLocaleTimeString());

            // Show notifications
            if (data.status === 'EMERGENCY') {
              showToast('🚨 EMERGENCY ALERT RECEIVED!');
            } else if (data.status === 'NORMAL') {
              showToast('✅ Location updated - Normal status');
            } else if (data.status === 'STATUS') {
              showToast('📍 Status update received');
            }
          }
        } catch (err) {
          console.error('Error parsing WebSocket data:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('❌ WebSocket error:', err);
        setLoraConnected(false);
        setLoraStatus('Connection error');
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting...');
        setLoraConnected(false);
        setLoraStatus('Reconnecting...');
        setTimeout(connectWebSocket, 3000);
      };

      wsRef.current = ws;
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // Calculate distance using Haversine formula
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  };

  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${meters.toFixed(2)} m`;
    } else {
      return `${(meters / 1000).toFixed(2)} km`;
    }
  };

  // Calculate distance between device and transmitter
  const getDistanceToTransmitter = (): string | null => {
    if (!deviceLocation || !latestMarker) return null;

    const [devLat, devLon] = deviceLocation as [number, number];
    const [transLat, transLon] = latestMarker.position as [number, number];

    const distance = calculateDistance(devLat, devLon, transLat, transLon);
    return formatDistance(distance);
  };

  const toggleDeviceTracking = () => {
    if (trackingDevice) {
      // Stop tracking
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setTrackingDevice(false);
      setDeviceLocation(null);
      showToast('Device tracking stopped');
    } else {
      // Start tracking
      if (!navigator.geolocation) {
        showToast('Geolocation is not supported');
        return;
      }

      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const newPosition: LatLngExpression = [latitude, longitude];
          setDeviceLocation(newPosition);
          if (!trackingDevice) {
            showToast('Device tracking started');
          }
        },
        (error) => {
          console.error('Geolocation error:', error);
          showToast('Failed to get device location');
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );

      watchIdRef.current = watchId;
      setTrackingDevice(true);
    }
  };

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header with LoRa Status */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-start flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-800 mb-2">SEATAG</h1>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${loraConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                <span className="text-sm font-semibold">{loraStatus}</span>
              </div>
              {lastLoraUpdate && (
                <p className="text-xs text-gray-500 mt-1">Last update: {lastLoraUpdate}</p>
              )}
            </div>
          </div>
        </div>

        {/* Distance Display */}
        {getDistanceToTransmitter() && (
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg shadow-lg p-6 mb-6 text-white">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-sm font-medium opacity-90">Distance to Transmitter</h2>
                <p className="text-4xl font-bold mt-1">{getDistanceToTransmitter()}</p>
              </div>
              <div className="text-right">
                <svg
                  className="w-16 h-16 opacity-80"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
            </div>
            <div className="mt-3 text-sm opacity-90">
              <p>📱 Your Device ← → 📡 Transmitter</p>
            </div>
          </div>
        )}

        {/* Status Banner */}
        {loraStatus === 'EMERGENCY' && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded animate-pulse">
            <p className="font-bold text-lg">🚨 EMERGENCY ALERT ACTIVE</p>
            <p>Emergency distress signal received from transmitter</p>
          </div>
        )}

        {loraStatus === 'NORMAL' && (
          <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 mb-6 rounded">
            <p className="font-semibold">✅ Normal Status</p>
            <p>All systems operating normally</p>
          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <div className={`fixed top-4 right-4 ${toast.includes('EMERGENCY') ? 'bg-red-500' : toast.includes('Normal') ? 'bg-green-500' : 'bg-blue-500'} text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-bounce`}>
            {toast}
          </div>
        )}

        {/* Map Container */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-6">
          <div className="h-[500px] relative">
            <MapContainer
              center={userLocation}
              zoom={13}
              style={{ height: '100%', width: '100%' }}
              className="z-0"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <RecenterMap center={userLocation} />
              <CenterMapButton center={userLocation} />

              {latestMarker && (
                <Marker position={latestMarker.position}>
                  <Popup>
                    <div className="text-sm">
                      <p className="font-semibold text-blue-600">
                        📡 TRANSMITTER - {latestMarker.status === 'EMERGENCY' ? '🚨 EMERGENCY' :
                         latestMarker.status === 'NORMAL' ? '✅ Normal' :
                         latestMarker.status === 'STATUS' ? '📍 Status' : 'Location'}
                      </p>
                      <p className="text-gray-600">
                        {new Date(latestMarker.timestamp).toLocaleString()}
                      </p>
                      {latestMarker.speed && <p className="text-gray-600">Speed: {latestMarker.speed}</p>}
                      {latestMarker.satellites && <p className="text-gray-600">Satellites: {latestMarker.satellites}</p>}
                      {latestMarker.rssi && <p className="text-gray-600">RSSI: {latestMarker.rssi} dBm</p>}
                      {latestMarker.snr && <p className="text-gray-600">SNR: {latestMarker.snr} dB</p>}
                    </div>
                  </Popup>
                </Marker>
              )}

              {deviceLocation && (
                <Marker
                  position={deviceLocation}
                  icon={new L.Icon({
                    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
                    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                    iconSize: [25, 41],
                    iconAnchor: [12, 41],
                    popupAnchor: [1, -34],
                    shadowSize: [41, 41]
                  })}
                >
                  <Popup>
                    <div className="text-sm">
                      <p className="font-semibold text-green-600">📱 YOUR DEVICE</p>
                      <p className="text-gray-600">Current location</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {(deviceLocation as [number, number])[0].toFixed(6)}, {(deviceLocation as [number, number])[1].toFixed(6)}
                      </p>
                      {getDistanceToTransmitter() && (
                        <p className="text-xs font-semibold text-blue-600 mt-2 border-t pt-2">
                          Distance to transmitter: {getDistanceToTransmitter()}
                        </p>
                      )}
                    </div>
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 flex-wrap">
          <button
            onClick={toggleDeviceTracking}
            className={`flex-1 min-w-[200px] ${trackingDevice ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'} text-white font-semibold py-4 px-6 rounded-lg shadow-md transition duration-300 transform hover:scale-105`}
          >
            {trackingDevice ? '📱 Stop Device Tracking' : '📱 Track My Device'}
          </button>

          <button
            onClick={onNavigateToLogs}
            className="flex-1 min-w-[200px] bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-4 px-6 rounded-lg shadow-md transition duration-300 transform hover:scale-105"
          >
            View Location History
          </button>
        </div>

        {/* Info Card */}
        <div className="mt-6 bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">System Info</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-red-50 p-4 rounded-lg">
              <h3 className="font-semibold text-red-700 mb-2">🚨 EMERGENCY Mode</h3>
              <p className="text-sm text-gray-600">Hold RED button for 2.5s</p>
              <p className="text-xs text-gray-500 mt-1">Updates every 5 seconds</p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-semibold text-green-700 mb-2">✅ NORMAL Mode</h3>
              <p className="text-sm text-gray-600">Hold GREEN button for 2.5s</p>
              <p className="text-xs text-gray-500 mt-1">Updates every 60 seconds</p>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-semibold text-blue-700 mb-2">📍 STATUS Mode</h3>
              <p className="text-sm text-gray-600">Hold BOTH buttons for 2.5s</p>
              <p className="text-xs text-gray-500 mt-1">Updates every 60 seconds</p>
            </div>
          </div>
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-semibold text-gray-700 mb-2">📍 Map Markers</h3>
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-blue-500 rounded-full"></div>
                <span><strong>Blue Marker:</strong> Transmitter location (LoRa GPS)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-green-500 rounded-full"></div>
                <span><strong>Green Marker:</strong> Your device location</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
