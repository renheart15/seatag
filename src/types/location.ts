export interface LocationLog {
  id: string;
  deviceId: string;
  deviceName?: string;
  latitude: number;
  longitude: number;
  timestamp: number;
  status?: string;
  speed?: string;
  satellites?: string;
  uptime?: string;
  rssi?: string;
  snr?: string;
}
