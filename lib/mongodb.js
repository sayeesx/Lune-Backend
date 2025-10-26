import mongoose from "mongoose";

const { MONGODB_URI } = process.env;
let cached = global.mongooseConn;
if (!cached) cached = global.mongooseConn = { conn: null, promise: null };

export default async function dbConnect() {
  if (!MONGODB_URI) throw new Error("MONGODB_URI is not set");
  
  // Return cached connection if exists
  if (cached.conn) {
    if (cached.conn.readyState === 1) {
      return cached.conn;
    }
    // If connection is not ready, clear cache and reconnect
    cached.conn = null;
    cached.promise = null;
  }

  try {
    if (!cached.promise) {
      const options = {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        family: 4,  // Use IPv4, skip IPv6
        retryWrites: true,
        retryReads: true,
        connectTimeoutMS: 10000,
      };

      cached.promise = mongoose
        .connect(MONGODB_URI, options)
        .then((mongoose) => {
          console.log('MongoDB connected successfully');
          return mongoose.connection;
        });
    }
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    // Clear cache on error
    cached.conn = null;
    cached.promise = null;
    throw error;
  }
}
