import { MongoClient, ServerApiVersion } from "mongodb";

// One MongoDB connection for the whole server process.
// The promise lives on globalThis so dev hot reloads reuse it instead of
// opening a new pool each time, and concurrent first requests share it.

const globalForMongo = globalThis;

async function connect() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }
  const client = new MongoClient(process.env.MONGO_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();
  const db = client.db(); // database name comes from the URI path

  try {
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
  } catch (error) {
    // Usually means duplicate emails already exist. Log and keep serving.
    console.error("Could not create unique index on users.email:", error.message);
  }
  return db;
}

export function getDb() {
  if (!globalForMongo._bloodlinkDb) {
    globalForMongo._bloodlinkDb = connect().catch((error) => {
      globalForMongo._bloodlinkDb = undefined; // allow a retry on the next request
      throw error;
    });
  }
  return globalForMongo._bloodlinkDb;
}
