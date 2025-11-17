import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import L from 'leaflet';
import '../utils/leafletIcon';

interface LocationMarker {
  deviceId: string;
  deviceName?: string;
  position: LatLngExpression;
  timestamp: number;
  status: string;
  speed?: string;
  satellites?: string;
  rssi?: string;
  snr?: string;
}

interface LoRaData {
  deviceId: string;
  deviceName?: string;
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
  const [deviceMarkers, setDeviceMarkers] = useState<Map<string, LocationMarker>>(new Map());
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceLocation, setDeviceLocation] = useState<LatLngExpression | null>(null);
  const [deviceLocationAccuracy, setDeviceLocationAccuracy] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loraStatus, setLoraStatus] = useState<string>('Connecting...');
  const [lastLoraUpdate, setLastLoraUpdate] = useState<string>('');
  const [loraConnected, setLoraConnected] = useState(false);
  const [isAlertRinging, setIsAlertRinging] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const previousStatusRef = useRef<string>(''); // Track previous status to detect changes

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

          if (data.latitude && data.longitude && data.deviceId) {
            const newPosition: LatLngExpression = [data.latitude, data.longitude];

            // Update map center to the latest device update
            setUserLocation(newPosition);

            // Create marker for this device
            const newMarker: LocationMarker = {
              deviceId: data.deviceId,
              deviceName: data.deviceName || data.deviceId,
              position: newPosition,
              timestamp: data.timestamp || Date.now(),
              status: data.status,
              speed: undefined,  // Speed no longer transmitted
              satellites: data.satellites,
              rssi: data.rssi,
              snr: data.snr
            };

            // Update markers map for this device
            setDeviceMarkers(prev => {
              const updated = new Map(prev);
              updated.set(data.deviceId, newMarker);
              return updated;
            });

            // Update status (for the most recent update)
            const statusChanged = data.status !== previousStatusRef.current;
            setLoraStatus(data.status);
            setLastLoraUpdate(new Date(data.timestamp).toLocaleTimeString());

            // Show notifications and play alerts ONLY when status changes
            if (statusChanged) {
              if (data.status === 'EMERGENCY') {
                showToast(`🚨 EMERGENCY from ${data.deviceName || data.deviceId}!`);
                playEmergencyAlert(); // Play alarm sound
              } else if (data.status === 'NORMAL') {
                showToast(`✅ ${data.deviceName || data.deviceId} - Normal status`);
                playEmergencyAlert(); // Play alarm sound for NORMAL mode too
              } else if (data.status === 'STATUS') {
                showToast(`📍 Status update from ${data.deviceName || data.deviceId}`);
              }
              // Update the ref to the new status
              previousStatusRef.current = data.status;
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
      // Stop any playing alerts on unmount
      stopEmergencyAlert();
    };
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // Play emergency alarm sound (continuous until stopped)
  const playEmergencyAlert = () => {
    // Stop any existing alert first
    stopEmergencyAlert();

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      // Create an oscillator for continuous beeping
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Set frequency for an alert tone (2300 Hz - urgent sound)
      oscillator.frequency.value = 2300;
      oscillator.type = 'sine';

      // Set initial volume to 0
      gainNode.gain.value = 0;

      // Create repeating beep pattern
      const beepDuration = 0.15; // seconds
      const pauseDuration = 0.1; // seconds
      let currentTime = audioContext.currentTime;

      // Loop 40 beeps (about 10 seconds of beeping)
      for (let i = 0; i < 40; i++) {
        gainNode.gain.setValueAtTime(0.9, currentTime);
        gainNode.gain.setValueAtTime(0, currentTime + beepDuration);
        currentTime += beepDuration + pauseDuration;
      }

      oscillator.start(audioContext.currentTime);
      oscillator.stop(currentTime);
      oscillatorRef.current = oscillator;

      setIsAlertRinging(true);
      console.log('🔊 Emergency alert sound started');

      // Auto-stop after completion
      setTimeout(() => {
        setIsAlertRinging(false);
      }, currentTime * 1000);
    } catch (error) {
      console.error('Error playing emergency alert:', error);
    }
  };

  // Stop the emergency alert sound
  const stopEmergencyAlert = () => {
    try {
      if (oscillatorRef.current) {
        try {
          // Try to stop the oscillator immediately
          oscillatorRef.current.stop(0);
        } catch (e) {
          // Oscillator might already be stopped or stopping, ignore error
          console.log('Oscillator already stopped or stopping');
        }
        try {
          oscillatorRef.current.disconnect();
        } catch (e) {
          // Might already be disconnected, ignore error
        }
        oscillatorRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      setIsAlertRinging(false);
      console.log('🔇 Emergency alert stopped');
    } catch (error) {
      console.error('Error stopping alert:', error);
      // Ensure state is updated even if there's an error
      setIsAlertRinging(false);
    }
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

  // Calculate distance between device and nearest/selected transmitter
  const getDistanceToTransmitter = (): string | null => {
    if (!deviceLocation || deviceMarkers.size === 0) return null;

    const [devLat, devLon] = deviceLocation as [number, number];

    // Use selected device or the first available device
    const targetMarker = selectedDeviceId
      ? deviceMarkers.get(selectedDeviceId)
      : Array.from(deviceMarkers.values())[0];

    if (!targetMarker) return null;

    const [transLat, transLon] = targetMarker.position as [number, number];
    const distance = calculateDistance(devLat, devLon, transLat, transLon);
    return formatDistance(distance);
  };

  // Auto-start device tracking on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const newPosition: LatLngExpression = [latitude, longitude];
        setDeviceLocation(newPosition);
        setDeviceLocationAccuracy(accuracy);

        console.log(`📍 Device location updated: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${accuracy.toFixed(1)}m)`);

        // Show warning if accuracy is poor (> 50 meters)
        if (accuracy > 50) {
          console.warn(`⚠️ Low GPS accuracy: ±${accuracy.toFixed(1)}m. Move to open area for better signal.`);
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        let errorMessage = 'Failed to get device location';

        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied. Please enable location access.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location unavailable. Check your GPS settings.';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out. Retrying...';
            break;
        }

        showToast(errorMessage);
        console.error('Geolocation error details:', errorMessage);
      },
      {
        enableHighAccuracy: true,
        timeout: 30000, // Increased to 30 seconds for better accuracy
        maximumAge: 5000, // Allow cached position up to 5 seconds old
      }
    );

    watchIdRef.current = watchId;

    return () => {
      // Cleanup on unmount
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-2 sm:p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header with LoRa Status */}
        <div className="bg-white rounded-lg shadow-lg p-3 sm:p-4 md:p-6 mb-3 sm:mb-4 md:mb-6">
          <div className="flex justify-between items-start flex-wrap gap-2 sm:gap-3 md:gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800 mb-1">SEATAG</h1>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${loraConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                <span className="text-xs sm:text-sm font-semibold">{loraStatus}</span>
              </div>
              {lastLoraUpdate && (
                <p className="text-[10px] sm:text-xs text-gray-500 mt-1">Last: {lastLoraUpdate}</p>
              )}
            </div>
          </div>
        </div>

        {/* GPS Accuracy Indicator */}
        {deviceLocation && deviceLocationAccuracy !== null && (
          <div className={`rounded-lg shadow-lg p-3 sm:p-4 mb-3 sm:mb-4 md:mb-6 ${deviceLocationAccuracy > 50 ? 'bg-gradient-to-r from-orange-400 to-red-500' : deviceLocationAccuracy > 20 ? 'bg-gradient-to-r from-yellow-400 to-orange-500' : 'bg-gradient-to-r from-green-400 to-green-600'} text-white`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1">
                <h3 className="text-xs sm:text-sm font-medium opacity-90">📍 GPS Accuracy</h3>
                <p className="text-lg sm:text-xl md:text-2xl font-bold mt-0.5 sm:mt-1">±{deviceLocationAccuracy.toFixed(1)}m</p>
                <p className="text-[10px] sm:text-xs mt-0.5 sm:mt-1 opacity-90">
                  {deviceLocationAccuracy <= 20 && '✓ Excellent'}
                  {deviceLocationAccuracy > 20 && deviceLocationAccuracy <= 50 && '⚠️ Good'}
                  {deviceLocationAccuracy > 50 && '⚠️ Poor - Move outside'}
                </p>
              </div>
              <div className="text-2xl sm:text-3xl md:text-4xl">
                {deviceLocationAccuracy <= 20 && '✓'}
                {deviceLocationAccuracy > 20 && deviceLocationAccuracy <= 50 && '⚠️'}
                {deviceLocationAccuracy > 50 && '❌'}
              </div>
            </div>
          </div>
        )}

        {/* Distance Display */}
        {getDistanceToTransmitter() && (
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg shadow-lg p-3 sm:p-4 md:p-6 mb-3 sm:mb-4 md:mb-6 text-white">
            <div className="flex items-center justify-between flex-wrap gap-2 sm:gap-3 md:gap-4">
              <div className="flex-1">
                <h2 className="text-xs sm:text-sm font-medium opacity-90">Distance</h2>
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold mt-0.5 sm:mt-1">{getDistanceToTransmitter()}</p>
              </div>
              <div className="text-right">
                <svg
                  className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 opacity-80"
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
            <div className="mt-2 sm:mt-3 text-xs sm:text-sm opacity-90">
              <p>📱 You ← → 📡 Tracker</p>
            </div>
          </div>
        )}

        {/* Stop Buzzer Button */}
        {isAlertRinging && (
          <div className="bg-gradient-to-r from-red-600 to-orange-600 rounded-lg shadow-2xl p-3 sm:p-4 md:p-6 mb-3 sm:mb-4 md:mb-6 text-white border-2 sm:border-4 border-yellow-400 animate-pulse">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
              <div className="flex-1 text-center sm:text-left">
                <p className="font-bold text-lg sm:text-xl md:text-2xl mb-1 sm:mb-2">
                  🚨 ALERT RINGING
                </p>
                <p className="text-sm sm:text-base md:text-lg mb-0.5 sm:mb-1">
                  Buzzer is active
                </p>
                <p className="text-xs sm:text-sm opacity-90">
                  Click to stop the buzzer
                </p>
              </div>
              <button
                onClick={stopEmergencyAlert}
                className="font-bold py-3 px-6 sm:py-4 sm:px-8 rounded-lg shadow-lg bg-white text-red-600 hover:bg-gray-100 transition duration-300 transform hover:scale-105 border-2 sm:border-4 border-yellow-400 w-full sm:w-auto"
              >
                <div className="flex flex-col items-center">
                  <span className="text-2xl sm:text-3xl mb-1 sm:mb-2">
                    🛑
                  </span>
                  <span className="text-base sm:text-lg">
                    STOP BUZZER
                  </span>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Status Banner */}
        {loraStatus === 'EMERGENCY' && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 sm:p-4 mb-3 sm:mb-4 md:mb-6 rounded animate-pulse">
            <p className="font-bold text-sm sm:text-base md:text-lg">🚨 EMERGENCY ALERT</p>
            <p className="text-xs sm:text-sm">Emergency signal received</p>
          </div>
        )}

        {loraStatus === 'NORMAL' && (
          <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-3 sm:p-4 mb-3 sm:mb-4 md:mb-6 rounded">
            <p className="font-semibold text-sm sm:text-base">✅ Normal Status</p>
            <p className="text-xs sm:text-sm">Systems operating normally</p>
          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <div className={`fixed top-4 right-4 ${toast.includes('EMERGENCY') ? 'bg-red-500' : toast.includes('Normal') ? 'bg-green-500' : 'bg-blue-500'} text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-bounce`}>
            {toast}
          </div>
        )}

        {/* Device Selector */}
        {deviceMarkers.size > 1 && (
          <div className="bg-white rounded-lg shadow-lg p-3 sm:p-4 mb-3 sm:mb-4 md:mb-6">
            <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
              Select Device ({deviceMarkers.size} active)
            </label>
            <select
              value={selectedDeviceId || ''}
              onChange={(e) => setSelectedDeviceId(e.target.value || null)}
              className="w-full p-2 sm:p-3 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All Devices</option>
              {Array.from(deviceMarkers.values()).map((marker) => (
                <option key={marker.deviceId} value={marker.deviceId}>
                  {marker.deviceName || marker.deviceId} - {marker.status}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Map Container */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-3 sm:mb-4 md:mb-6">
          <div className="h-[300px] sm:h-[400px] md:h-[500px] relative">
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

              {Array.from(deviceMarkers.values()).map((marker) => {
                const isEmergency = marker.status === 'EMERGENCY';
                const isNormal = marker.status === 'NORMAL';
                const isStatus = marker.status === 'STATUS';

                // Different colored markers for different statuses
                let markerIconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png';
                if (isEmergency) {
                  markerIconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png';
                } else if (isNormal) {
                  markerIconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png';
                } else if (isStatus) {
                  markerIconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png';
                }

                return (
                  <Marker
                    key={marker.deviceId}
                    position={marker.position}
                    icon={new L.Icon({
                      iconUrl: markerIconUrl,
                      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                      iconSize: [25, 41],
                      iconAnchor: [12, 41],
                      popupAnchor: [1, -34],
                      shadowSize: [41, 41]
                    })}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-semibold text-blue-600">
                          📡 {marker.deviceName || marker.deviceId}
                        </p>
                        <p className={`font-semibold ${isEmergency ? 'text-red-600' : isNormal ? 'text-green-600' : 'text-yellow-600'}`}>
                          {isEmergency ? '🚨 EMERGENCY' : isNormal ? '✅ Normal' : isStatus ? '📍 Status' : 'Location'}
                        </p>
                        <p className="text-gray-600">
                          {new Date(marker.timestamp).toLocaleString()}
                        </p>
                        {marker.satellites && <p className="text-gray-600">Satellites: {marker.satellites}</p>}
                        {marker.rssi && <p className="text-gray-600">RSSI: {marker.rssi} dBm</p>}
                        {marker.snr && <p className="text-gray-600">SNR: {marker.snr} dB</p>}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

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
                      {deviceLocationAccuracy !== null && (
                        <p className={`text-xs font-medium mt-1 ${deviceLocationAccuracy > 50 ? 'text-orange-600' : 'text-green-600'}`}>
                          Accuracy: ±{deviceLocationAccuracy.toFixed(1)}m
                          {deviceLocationAccuracy > 50 && ' ⚠️'}
                        </p>
                      )}
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
        <div className="flex gap-2 sm:gap-3 md:gap-4 flex-wrap">
          <button
            onClick={onNavigateToLogs}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 sm:py-3.5 md:py-4 px-4 sm:px-5 md:px-6 rounded-lg shadow-md transition duration-300 transform hover:scale-105 text-sm sm:text-base"
          >
            View Location History
          </button>
        </div>

        {/* Info Card */}
        <div className="mt-3 sm:mt-4 md:mt-6 bg-white rounded-lg shadow-lg p-3 sm:p-4 md:p-6">
          <h2 className="text-base sm:text-lg md:text-xl font-semibold text-gray-800 mb-2 sm:mb-3">System Info</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3 md:gap-4">
            <div className="bg-red-50 p-2 sm:p-3 md:p-4 rounded-lg">
              <h3 className="font-semibold text-red-700 mb-1 sm:mb-2 text-xs sm:text-sm">🚨 EMERGENCY</h3>
              <p className="text-xs sm:text-sm text-gray-600">Hold RED 2.5s</p>
              <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">Updates every 5s</p>
            </div>
            <div className="bg-green-50 p-2 sm:p-3 md:p-4 rounded-lg">
              <h3 className="font-semibold text-green-700 mb-1 sm:mb-2 text-xs sm:text-sm">✅ NORMAL</h3>
              <p className="text-xs sm:text-sm text-gray-600">Hold GREEN 2.5s</p>
              <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">Updates every 5s</p>
            </div>
            <div className="bg-blue-50 p-2 sm:p-3 md:p-4 rounded-lg">
              <h3 className="font-semibold text-blue-700 mb-1 sm:mb-2 text-xs sm:text-sm">📍 STATUS</h3>
              <p className="text-xs sm:text-sm text-gray-600">Hold BOTH</p>
              <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">Updates every 5s</p>
            </div>
          </div>
          <div className="mt-3 sm:mt-4 p-2 sm:p-3 md:p-4 bg-gray-50 rounded-lg">
            <h3 className="font-semibold text-gray-700 mb-1 sm:mb-2 text-xs sm:text-sm">📍 Map Markers</h3>
            <div className="space-y-1 sm:space-y-2 text-xs sm:text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 sm:w-5 sm:h-5 bg-red-500 rounded-full flex-shrink-0"></div>
                <span className="text-[10px] sm:text-xs"><strong>Red:</strong> EMERGENCY</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 sm:w-5 sm:h-5 bg-blue-500 rounded-full flex-shrink-0"></div>
                <span className="text-[10px] sm:text-xs"><strong>Blue:</strong> NORMAL</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 sm:w-5 sm:h-5 bg-yellow-500 rounded-full flex-shrink-0"></div>
                <span className="text-[10px] sm:text-xs"><strong>Yellow:</strong> STATUS</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 sm:w-5 sm:h-5 bg-green-500 rounded-full flex-shrink-0"></div>
                <span className="text-[10px] sm:text-xs"><strong>Green:</strong> Your device</span>
              </div>
              {deviceMarkers.size > 0 && (
                <p className="mt-1 sm:mt-2 text-[10px] sm:text-xs text-indigo-600 font-semibold">
                  {deviceMarkers.size} device{deviceMarkers.size > 1 ? 's' : ''} active
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
