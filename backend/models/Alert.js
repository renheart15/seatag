import mongoose from "mongoose";

const alertSchema = new mongoose.Schema({
  status: { type: String, enum: ["EMERGENCY", "NORMAL"], required: true },
  payload: { type: String, required: true }, // store full LoRa message
  timestamp: { type: Date, default: Date.now }
});

export const Alert = mongoose.model("Alert", alertSchema);
