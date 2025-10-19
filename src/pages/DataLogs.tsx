import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';
import 'leaflet/dist/leaflet.css';

interface LocationLog {
  _id: string;
  status: string;
  latitude?: number;
  longitude?: number;
  speed?: string;
  satellites?: string;
  uptime?: string;
  rssi?: string;
  snr?: string;
  rawPayload?: string;
  payload?: string;
  timestamp: string;
}

interface DataLogsProps {
  onNavigateToMap: () => void;
}

type ViewMode = 'cards' | 'table';

export default function DataLogs({ onNavigateToMap }: DataLogsProps) {
  const [logs, setLogs] = useState<LocationLog[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationLog | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [showExportDropdown, setShowExportDropdown] = useState(false);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('https://seatag.onrender.com/api/alerts');
      if (!response.ok) {
        throw new Error('Failed to fetch alerts');
      }

      const data = await response.json();

      // Parse payload for old records that don't have latitude/longitude parsed
      const processedLogs = (data.locations || []).map((log: LocationLog) => {
        // If latitude/longitude are missing but payload exists, parse it
        if ((log.latitude === undefined || log.longitude === undefined) && log.payload) {
          const parts = log.payload.split('|');
          if (parts.length >= 3) {
            // Parse uptime which may contain rssi and snr
            let uptime = parts[5] || log.uptime || '';
            let rssi = log.rssi || '';
            let snr = log.snr || '';

            if (parts[5] && parts[5].includes(',')) {
              const uptimeParts = parts[5].split(',');
              uptime = uptimeParts[0] || '';
              rssi = uptimeParts[1] || '';
              snr = uptimeParts[2] || '';
            }

            return {
              ...log,
              latitude: parseFloat(parts[1]),
              longitude: parseFloat(parts[2]),
              speed: parts[3] || log.speed,
              satellites: parts[4] || log.satellites,
              uptime: uptime,
              rssi: rssi,
              snr: snr,
            };
          }
        }
        return log;
      });

      // Filter out locations without valid latitude/longitude
      const validLogs = processedLogs.filter((log: LocationLog) =>
        log.latitude !== undefined && log.longitude !== undefined &&
        !isNaN(log.latitude) && !isNaN(log.longitude)
      );

      setLogs(validLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
      console.error('Error fetching locations:', err);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const handleClearLogs = () => {
    if (logs.length === 0) {
      showToast('No logs to clear');
      return;
    }

    if (window.confirm('Clear all logs from display? (Data will remain in database)')) {
      setLogs([]);
      showToast('Display cleared! Refresh to reload data.');
    }
  };

  const handleDeleteAll = async () => {
    if (logs.length === 0) {
      showToast('No logs to delete');
      return;
    }

    if (window.confirm('⚠️ DELETE ALL LOGS FROM DATABASE? This action cannot be undone!')) {
      try {
        const response = await fetch('https://seatag.onrender.com/api/alerts', {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error('Failed to delete alerts');
        }

        setLogs([]);
        showToast('All logs permanently deleted from database!');
      } catch (err) {
        showToast('Failed to delete logs');
        console.error('Error deleting alerts:', err);
      }
    }
  };

  const handleDeleteLog = async (id: string) => {
    if (window.confirm('Delete this log from database?')) {
      try {
        const response = await fetch(`https://seatag.onrender.com/api/alerts/${id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error('Failed to delete alert');
        }

        setLogs(logs.filter(log => log._id !== id));
        showToast('Log deleted successfully!');
      } catch (err) {
        showToast('Failed to delete log');
        console.error('Error deleting alert:', err);
      }
    }
  };

  const exportToPDF = () => {
    const doc = new jsPDF();

    // Add title
    doc.setFontSize(18);
    doc.text('LoRa Location Tracker - Data Export', 14, 22);

    // Add generation date
    doc.setFontSize(11);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);

    // Prepare table data
    const tableData = logs.map(log => [
      new Date(log.timestamp).toLocaleString(),
      log.status,
      log.latitude?.toFixed(6) || 'N/A',
      log.longitude?.toFixed(6) || 'N/A',
      log.speed || 'N/A',
      log.satellites || 'N/A',
      log.rssi || 'N/A',
      log.snr || 'N/A'
    ]);

    // Add table
    autoTable(doc, {
      head: [['Timestamp', 'Status', 'Latitude', 'Longitude', 'Speed', 'Satellites', 'RSSI', 'SNR']],
      body: tableData,
      startY: 35,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [79, 70, 229] },
    });

    // Save PDF
    doc.save(`lora-tracker-data-${Date.now()}.pdf`);
    showToast('PDF exported successfully!');
  };

  const exportToCSV = () => {
    const csvData = logs.map(log => ({
      Timestamp: new Date(log.timestamp).toLocaleString(),
      Status: log.status,
      Latitude: log.latitude?.toFixed(6) || 'N/A',
      Longitude: log.longitude?.toFixed(6) || 'N/A',
      Speed: log.speed || 'N/A',
      Satellites: log.satellites || 'N/A',
      RSSI: log.rssi || 'N/A',
      SNR: log.snr || 'N/A',
      Uptime: log.uptime || 'N/A'
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `lora-tracker-data-${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('CSV exported successfully!');
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const copyToClipboard = (lat: number, lng: number) => {
    const text = `${lat}, ${lng}`;
    navigator.clipboard.writeText(text);
    showToast('Coordinates copied to clipboard!');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'EMERGENCY':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'NORMAL':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'STATUS':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const openMapModal = (log: LocationLog) => {
    setSelectedLocation(log);
  };

  const closeMapModal = () => {
    setSelectedLocation(null);
  };

  const toggleCardExpansion = (id: string) => {
    setExpandedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-100 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
<div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-4 sm:mb-6">
  {/* Top Row: Title (left) + View Mode Toggle (right) */}
  <div className="flex items-center justify-between flex-wrap gap-3 sm:gap-4 mb-3">
    <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
      Location History
    </h1>

    {/* View Mode Toggle */}
    <div className="flex gap-1 sm:gap-2 bg-gray-100 p-1 rounded-lg">
      <button
        onClick={() => setViewMode('table')}
        className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm rounded-md transition-all duration-200 ${
          viewMode === 'table'
            ? 'bg-white text-indigo-600 shadow-sm'
            : 'text-gray-600 hover:text-gray-800'
        }`}
      >
        Table
      </button>
      <button
        onClick={() => setViewMode('cards')}
        className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm rounded-md transition-all duration-200 ${
          viewMode === 'cards'
            ? 'bg-white text-indigo-600 shadow-sm'
            : 'text-gray-600 hover:text-gray-800'
        }`}
      >
        Cards
      </button>
    </div>
  </div>

  {/* Inline Statistics Bar (Full Width) */}
  {!loading && logs.length > 0 ? (
    <div className="flex justify-between gap-2 sm:gap-3">
      <div className="flex-1 bg-blue-50 p-1.5 sm:p-2 rounded-md text-center">
        <p className="text-[10px] sm:text-sm font-semibold text-blue-600">
          Total = {logs.length}
        </p>
      </div>
      <div className="flex-1 bg-red-50 p-1.5 sm:p-2 rounded-md text-center">
        <p className="text-[10px] sm:text-sm font-semibold text-red-600">
          Emergency = {logs.filter(l => l.status === 'EMERGENCY').length}
        </p>
      </div>
      <div className="flex-1 bg-green-50 p-1.5 sm:p-2 rounded-md text-center">
        <p className="text-[10px] sm:text-sm font-semibold text-green-600">
          Normal = {logs.filter(l => l.status === 'NORMAL').length}
        </p>
      </div>
    </div>
  ) : (
    <p className="text-xs sm:text-sm text-gray-600">
      {loading ? 'Loading statistics...' : 'No data available'}
    </p>
  )}
</div>





        {/* Toast Notification */}
        {toast && (
          <div className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 sm:px-6 sm:py-3 rounded-lg shadow-lg z-50 animate-bounce text-sm sm:text-base max-w-xs sm:max-w-md">
            {toast}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 sm:p-4 mb-4 sm:mb-6 rounded text-sm sm:text-base">
            <p className="font-medium">Error</p>
            <p>{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 sm:gap-4 mb-4 sm:mb-6 pb-2 relative z-50">
          <button
            onClick={onNavigateToMap}
            className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-5 rounded-lg shadow-md transition duration-300 text-sm sm:text-base"
          >
            Back to Map
          </button>

          <button
            onClick={() => loadLogs()}
            className="flex-shrink-0 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-5 rounded-lg shadow-md transition duration-300 text-sm sm:text-base"
          >
            Refresh
          </button>

          {/* Export Dropdown */}
          <div className="relative flex-shrink-0 z-50">
            <button
              onClick={() => setShowExportDropdown(!showExportDropdown)}
              disabled={logs.length === 0 || loading}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-semibold py-3 px-5 rounded-lg shadow-md transition duration-300 flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Export</span>
              <svg className={`h-3 w-3 sm:h-4 sm:w-4 transition-transform duration-200 ${showExportDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {showExportDropdown && !loading && logs.length > 0 && (
              <div className="absolute top-full left-0 mt-2 bg-white rounded-lg shadow-lg border border-gray-200 z-[100] text-sm sm:text-base min-w-[280px]">
                <button
                  onClick={() => {
                    exportToPDF();
                    setShowExportDropdown(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-purple-50 transition-colors duration-150 text-left"
                >
                  <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <div>
                    <p className="font-semibold text-gray-800">Export as PDF</p>
                    <p className="text-xs text-gray-500">Download formatted PDF document</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    exportToCSV();
                    setShowExportDropdown(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-indigo-50 transition-colors duration-150 text-left border-t border-gray-100"
                >
                  <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div>
                    <p className="font-semibold text-gray-800">Export as CSV</p>
                    <p className="text-xs text-gray-500">Download Excel-compatible spreadsheet</p>
                  </div>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleClearLogs}
            disabled={logs.length === 0 || loading}
            className="flex-shrink-0 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-400 text-white font-semibold py-3 px-5 rounded-lg shadow-md transition duration-300 text-sm sm:text-base"
          >
            Clear
          </button>

          <button
            onClick={handleDeleteAll}
            disabled={logs.length === 0 || loading}
            className="flex-shrink-0 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-3 px-5 rounded-lg shadow-md transition duration-300 text-sm sm:text-base"
          >
            Delete All
          </button>
        </div>


        {/* Loading State */}
        {loading ? (
          <div className="bg-white rounded-lg shadow-lg p-8 sm:p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-10 w-10 sm:h-12 sm:w-12 border-b-2 border-blue-600 mb-3 sm:mb-4"></div>
            <p className="text-gray-600 text-sm sm:text-base">Loading location history...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-8 sm:p-12 text-center">
            <svg
              className="mx-auto h-16 w-16 sm:h-24 sm:w-24 text-gray-400 mb-3 sm:mb-4"
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
            <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-2">No Locations Tracked</h3>
            <p className="text-gray-600 mb-4 text-sm sm:text-base">
              Waiting for LoRa transmitter to send GPS data...
            </p>
            <button
              onClick={onNavigateToMap}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 sm:px-6 rounded-lg transition duration-300 text-sm sm:text-base"
            >
              Go to Map
            </button>
          </div>
        ) : viewMode === 'table' ? (
          /* Table View */
          <div className="bg-white rounded-lg shadow-lg overflow-hidden relative z-10">
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] sm:max-h-[75vh]
                            -mx-4 sm:mx-0 px-4 sm:px-0
                            scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent
                            touch-auto cursor-grab active:cursor-grabbing"
                  style={{
                    WebkitOverflowScrolling: 'touch', // smooth iOS scroll
                  }}>
              <table className="min-w-full divide-y divide-gray-200 text-xs sm:text-sm">
                <thead className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
                  <tr>
                    <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Latitude
                    </th>
                    <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Longitude
                    </th>
                    <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Speed
                    </th>
                    <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Sats
                    </th>
                    <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium uppercase tracking-wider">
                      RSSI
                    </th>
                    <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium uppercase tracking-wider">
                      SNR
                    </th>
                    <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {logs.map((log, index) => (
                    <tr
                      key={log._id}
                      className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-indigo-50 transition-colors duration-150`}
                    >
                      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-gray-900">
                        <div className="flex flex-col">
                          <span className="font-medium text-xs sm:text-sm">{formatTime(log.timestamp)}</span>
                          <span className="text-gray-500 text-xs hidden sm:inline">{formatDate(log.timestamp)}</span>
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                        <span className={`px-1.5 sm:px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(log.status)}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap font-mono text-gray-900">
                        {log.latitude?.toFixed(4)}
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap font-mono text-gray-900">
                        {log.longitude?.toFixed(4)}
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-gray-900">
                        {log.speed || 'N/A'}
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-gray-900">
                        {log.satellites || 'N/A'}
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-gray-900">
                        {log.rssi ? `${log.rssi}` : 'N/A'}
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-gray-900">
                        {log.snr ? `${log.snr}` : 'N/A'}
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap font-medium">
                        <div className="flex gap-1 sm:gap-2">
                          <button
                            onClick={() => openMapModal(log)}
                            className="text-indigo-600 hover:text-indigo-900 p-1"
                            title="View on map"
                          >
                            <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => copyToClipboard(log.latitude!, log.longitude!)}
                            className="text-green-600 hover:text-green-900 p-1 hidden sm:inline-block"
                            title="Copy coordinates"
                          >
                            <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteLog(log._id)}
                            className="text-red-600 hover:text-red-900 p-1"
                            title="Delete log"
                          >
                            <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Card View */
          <div className="space-y-4 overflow-y-auto max-h-[70vh] sm:max-h-[75vh] px-1 sm:px-2"
                style={{ WebkitOverflowScrolling: 'touch' }}>
            {logs.map((log) => {
              const isExpanded = expandedCards.has(log._id);
              return (
                <div
                  key={log._id}
                  className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 overflow-hidden"
                >
                  {/* Card Header */}
                  <div
                    className="p-4 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
                    onClick={() => toggleCardExpansion(log._id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusBadge(log.status)}`}>
                          {log.status === 'EMERGENCY' ? '🚨 EMERGENCY' :
                           log.status === 'NORMAL' ? '✅ NORMAL' :
                           log.status === 'STATUS' ? '📍 STATUS' : log.status}
                        </span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-gray-600">{formatDate(log.timestamp)}</span>
                          <span className="text-sm text-gray-500">{formatTime(log.timestamp)}</span>
                        </div>
                      </div>
                      <svg
                        className={`h-5 w-5 text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Card Content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100">
                      <div className="pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                          {log.latitude !== undefined && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">Latitude:</span>
                              <span className="text-sm text-gray-800 font-mono bg-gray-100 px-2 py-1 rounded">
                                {log.latitude.toFixed(6)}
                              </span>
                            </div>
                          )}

                          {log.longitude !== undefined && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">Longitude:</span>
                              <span className="text-sm text-gray-800 font-mono bg-gray-100 px-2 py-1 rounded">
                                {log.longitude.toFixed(6)}
                              </span>
                            </div>
                          )}

                          {log.speed && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">Speed:</span>
                              <span className="text-sm text-gray-800">{log.speed}</span>
                            </div>
                          )}

                          {log.satellites && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">Satellites:</span>
                              <span className="text-sm text-gray-800">{log.satellites}</span>
                            </div>
                          )}

                          {log.rssi && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">RSSI:</span>
                              <span className="text-sm text-gray-800">{log.rssi} dBm</span>
                            </div>
                          )}

                          {log.snr && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">SNR:</span>
                              <span className="text-sm text-gray-800">{log.snr} dB</span>
                            </div>
                          )}
                        </div>

                        {log.latitude !== undefined && log.longitude !== undefined && (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <button
                                onClick={() => copyToClipboard(log.latitude!, log.longitude!)}
                                className="flex-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium py-2 px-4 rounded-lg transition duration-300 flex items-center justify-center gap-2"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                <span>Copy Coordinates</span>
                              </button>

                              <button
                                onClick={() => openMapModal(log)}
                                className="flex-1 bg-green-100 hover:bg-green-200 text-green-700 font-medium py-2 px-4 rounded-lg transition duration-300 flex items-center justify-center gap-2"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                <span>View on Map</span>
                              </button>
                            </div>

                            <button
                              onClick={() => handleDeleteLog(log._id)}
                              className="w-full bg-red-100 hover:bg-red-200 text-red-700 font-medium py-2 px-4 rounded-lg transition duration-300 flex items-center justify-center gap-2"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              <span>Delete Log</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        
        {/* Map Modal */}
        {selectedLocation && selectedLocation.latitude !== undefined && selectedLocation.longitude !== undefined && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={closeMapModal}
          >
            <div
              className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">Location Details</h2>
                  <p className="text-sm opacity-90">
                    {selectedLocation.status === 'EMERGENCY' ? '🚨 Emergency Location' :
                     selectedLocation.status === 'NORMAL' ? '✅ Normal Location' : '📍 Location'}
                  </p>
                </div>
                <button
                  onClick={closeMapModal}
                  className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition duration-200"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6">
                {/* Location Info */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Latitude</p>
                    <p className="font-mono font-semibold text-sm">{selectedLocation.latitude.toFixed(6)}</p>
                  </div>
                  <div className="bg-purple-50 p-3 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Longitude</p>
                    <p className="font-mono font-semibold text-sm">{selectedLocation.longitude.toFixed(6)}</p>
                  </div>
                  {selectedLocation.speed && (
                    <div className="bg-green-50 p-3 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Speed</p>
                      <p className="font-semibold text-sm">{selectedLocation.speed}</p>
                    </div>
                  )}
                  {selectedLocation.satellites && (
                    <div className="bg-yellow-50 p-3 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Satellites</p>
                      <p className="font-semibold text-sm">{selectedLocation.satellites}</p>
                    </div>
                  )}
                  {selectedLocation.rssi && (
                    <div className="bg-orange-50 p-3 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">RSSI</p>
                      <p className="font-semibold text-sm">{selectedLocation.rssi} dBm</p>
                    </div>
                  )}
                  {selectedLocation.snr && (
                    <div className="bg-teal-50 p-3 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">SNR</p>
                      <p className="font-semibold text-sm">{selectedLocation.snr} dB</p>
                    </div>
                  )}
                </div>

                {/* Map */}
                <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-200">
                  <MapContainer
                    center={[selectedLocation.latitude, selectedLocation.longitude]}
                    zoom={17}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Marker position={[selectedLocation.latitude, selectedLocation.longitude]}>
                      <Popup>
                        <div className="text-center">
                          <p className="font-bold">{selectedLocation.status}</p>
                          <p className="text-sm">{selectedLocation.latitude.toFixed(6)}, {selectedLocation.longitude.toFixed(6)}</p>
                          {selectedLocation.speed && <p className="text-sm">Speed: {selectedLocation.speed}</p>}
                          <p className="text-xs text-gray-500 mt-1">{formatDate(selectedLocation.timestamp)} {formatTime(selectedLocation.timestamp)}</p>
                        </div>
                      </Popup>
                    </Marker>
                  </MapContainer>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 mt-4">
                  <a
                    href={`https://www.google.com/maps?q=${selectedLocation.latitude},${selectedLocation.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-300 text-center"
                  >
                    Open in Google Maps
                  </a>
                  <button
                    onClick={() => {
                      copyToClipboard(selectedLocation.latitude!, selectedLocation.longitude!);
                    }}
                    className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-300"
                  >
                    Copy Coordinates
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
