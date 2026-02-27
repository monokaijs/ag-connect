import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ag-connect';

let connected = false;

async function connectDB() {
  if (connected) return;
  await mongoose.connect(MONGODB_URI);
  connected = true;
  console.log('[db] Connected to MongoDB');
}

export { connectDB };
