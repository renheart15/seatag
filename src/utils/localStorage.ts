import type { LocationLog } from '../types/location';

const STORAGE_KEY = 'location-logs';

export const getLocationLogs = (): LocationLog[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error reading from localStorage:', error);
    return [];
  }
};

export const saveLocationLog = (latitude: number, longitude: number): LocationLog => {
  const newLog: LocationLog = {
    id: crypto.randomUUID(),
    latitude,
    longitude,
    timestamp: Date.now(),
  };

  try {
    const logs = getLocationLogs();
    logs.push(newLog);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    return newLog;
  } catch (error) {
    console.error('Error saving to localStorage:', error);
    throw error;
  }
};

export const clearLocationLogs = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing localStorage:', error);
    throw error;
  }
};
