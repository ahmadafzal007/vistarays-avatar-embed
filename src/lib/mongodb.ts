import mongoose from "mongoose";

// MongoDB is OPTIONAL in this embed-only deployment. It is used solely for
// conversation transcript logging and the admin context override — both are
// skipped gracefully when MONGODB_URL is not configured.

export function hasMongo(): boolean {
  return Boolean((process.env.MONGODB_URL ?? "").trim());
}

// Declare a global cache to reuse the connection across hot reloads in development
declare global {
  var _mongooseCache: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined;
}

const cache = global._mongooseCache ?? (global._mongooseCache = { conn: null, promise: null });

export async function connectDB(): Promise<typeof mongoose> {
  const url = (process.env.MONGODB_URL ?? "").trim();
  if (!url) {
    throw new Error("MONGODB_URL is not configured");
  }

  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose.connect(url, {
      bufferCommands: false,
    });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}
