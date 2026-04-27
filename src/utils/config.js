import { MongoClient, Binary, ObjectId } from 'mongodb';

export { Binary, ObjectId };

let cachedClient = null;


export const getSystemKeys = async (db) => {
  const config = await db.collection("config").findOne({ _id: "system_keys" });
  if (!config) {
    throw new Error("System configuration ('system_keys') not found in MongoDB!");
  }
  return config;
};


export const withDatabase = async (uri, callback) => {
  try {
    if (!cachedClient) {
      console.log("🐘 AWS: Using Persistent Connection Pool");
      cachedClient = new MongoClient(uri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        // Recommended for stable Atlas connections on EC2
        connectTimeoutMS: 5000,
        socketTimeoutMS: 45000, 
      });
      await cachedClient.connect();
    }

    const db = cachedClient.db("Kondaas");
    return await callback(db);
    
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error);
    // Reset so the next request tries a fresh connection
    cachedClient = null; 
    throw error;
  }
};