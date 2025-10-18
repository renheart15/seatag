import { useState } from "react";
import LocationTracker from "./pages/LocationTracker";
import DataLogs from "./pages/DataLogs";

type Page = 'tracker' | 'logs';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('tracker');

  return (
    <>
      {currentPage === 'tracker' ? (
        <LocationTracker onNavigateToLogs={() => setCurrentPage('logs')} />
      ) : (
        <DataLogs onNavigateToMap={() => setCurrentPage('tracker')} />
      )}
    </>
  );
}

export default App;
