import { MongoClient, Binary, ObjectId } from 'mongodb';

export { Binary, ObjectId };
export const getSystemKeys = async (db) => {
  const config = await db.collection("config").findOne({ _id: "system_keys" });
  if (!config) {
    throw new Error("System configuration ('system_keys') not found in MongoDB!");
  }
  return config;
};

let cachedClient = null;

export const withDatabase = async (uri, callback) => {
  const isNode = typeof process !== 'undefined' && process.release?.name === 'node';

  if (isNode) {
    try {
      if (!cachedClient) {
        console.log("🐘 AWS: Using Persistent Connection Pool");
        cachedClient = new MongoClient(uri, {
          maxPoolSize: 10,
          minPoolSize: 2
        });
        await cachedClient.connect();
      }
      const db = cachedClient.db("Kondaas");
      return await callback(db);
    } catch (error) {
      console.error("MongoDB Connection Error:", error);
      cachedClient = null; // 🚨 Reset cache so it tries a fresh connection next time
      throw error;
    }
  } else {
    // --- CLOUDFLARE SAFE PATH ---
    const client = new MongoClient(uri);
    try {
      await client.connect();
      return await callback(client.db("Kondaas"));
    } finally {
      await client.close();
    }
  }
};