import { MongoClient } from 'mongodb';

const withDatabase = async (uri, fn) => {
  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 5000,
  });
  try {
    await client.connect();
    const db = client.db("Kondaas");
    return await fn(db);
  } finally {
    await client.close(true);
  }
};

export const addForm = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const {
      mobileNumber,
      customerDetails,
      customerRequirements,
      safetyAndInstallation,
      cableRequirements,
      collectedDocumentChecklist,
      paymentDetails,
      remarks,
      signatures
    } = await c.req.json();

    await withDatabase(uri, async (db) => {
      const existing = await db.collection("forms").findOne({ mobileNumber: mobileNumber });

      if (existing) {
        return c.json({ error: "Mobile number already registered!" }, 400);
      }

      await db.collection("forms").insertOne({
        mobileNumber,
        customerDetails,
        customerRequirements,
        safetyAndInstallation,
        cableRequirements,
        collectedDocumentChecklist,
        paymentDetails,
        remarks,
        signatures
      });
    });

    return c.json({ message: "Form submitted successfully!" }, 201);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateForm = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const {
      mobileNumber,
      customerDetails,
      customerRequirements,
      safetyAndInstallation,
      cableRequirements,
      collectedDocumentChecklist,
      paymentDetails,
      remarks,
      signatures
    } = await c.req.json();

    await withDatabase(uri, async (db) => {
      const existing = await db.collection("forms").findOne({ mobileNumber: mobileNumber });

      if (!existing) {
        return c.json({ error: "Mobile number not found!" }, 404);
      }

      await db.collection("forms").updateOne(
        { mobileNumber: mobileNumber },
        {
          $set: {
            customerDetails,
            customerRequirements,
            safetyAndInstallation,
            cableRequirements,
            collectedDocumentChecklist,
            paymentDetails,
            remarks,
            signatures
          }
        }
      );
    });

    return c.json({ message: "Form updated successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateMobileNumber = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { oldMobileNumber, newMobileNumber } = await c.req.json();

    await withDatabase(uri, async (db) => {
      const oldExisting = await db.collection("forms").findOne({ mobileNumber: oldMobileNumber });

      if (!oldExisting) {
        return c.json({ error: "Old mobile number not found!" }, 404);
      }

      const newExisting = await db.collection("forms").findOne({ mobileNumber: newMobileNumber });

      if (newExisting) {
        return c.json({ error: "New mobile number already registered!" }, 400);
      }

      await db.collection("forms").updateOne(
        { mobileNumber: oldMobileNumber },
        { $set: { mobileNumber: newMobileNumber } }
      );
    });

    return c.json({ message: "Mobile number updated successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};