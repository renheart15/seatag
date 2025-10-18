# How to Start the LoRa Location Tracker

## Option 1: With MongoDB (Recommended)

### Step 1: Install MongoDB
Download and install MongoDB Community Server from:
https://www.mongodb.com/try/download/community

### Step 2: Start MongoDB
Open a new terminal and run:
```bash
mongod
```

### Step 3: Start Backend Server
Open another terminal in this project folder and run:
```bash
npm run server
```

### Step 4: Start Frontend
Open another terminal in this project folder and run:
```bash
npm run dev
```

### Step 5: Access the App
Open your browser to: http://localhost:8080

---

## Option 2: Without MongoDB (In-Memory Storage)

If you don't want to install MongoDB, I can modify the backend to use in-memory storage instead.

---

## Troubleshooting

**"Failed to fetch locations" error:**
- Make sure the backend server is running on port 5000
- Check that MongoDB is running (if using MongoDB)
- Verify the ESP8266 is sending data to https://seatag.vercel.app

**WebSocket connection fails:**
- Make sure both frontend and backend are running
- Check that your firewall allows connections on port 5000
- Verify the WebSocket URL matches your PC's IP address

---

## System Architecture

1. **TRANSMITTER** (Arduino + GPS) → Sends location via LoRa
2. **RECEIVER** (ESP8266) → Receives LoRa → Posts to backend
3. **BACKEND** (Node.js + MongoDB) → Saves data → Broadcasts via WebSocket
4. **FRONTEND** (React) → Displays real-time map and location history
