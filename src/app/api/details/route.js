


import { MongoClient, ServerApiVersion } from "mongodb";
let db;

async function connectDB() {
  if (db) return db;
  
  const client = new MongoClient(process.env.MONGO_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    }
  });
  
  await client.connect(); // Explicit connect call
  db = client.db();
  return db;
}


export async function POST(request) {
  try {
    const body = await request.json();
    const email= body.payload.email;
    const details = body.payload.details;
    console.log(details)
    const db = await connectDB();
    const result = await db.collection("users").updateOne(
      { email },
      { $set : {details: details, isProfileComplete: true } },
      { upsert: true }
    );
    return new Response(JSON.stringify({ message: "Details updated successfully" }), { status: 200 });
  } catch (error) {
    console.error("Error parsing request body:", error);
    return new Response(JSON.stringify({ error: "Invalid JSON format" }), { status: 400 });
  }
}