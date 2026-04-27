import { withDatabase } from '../utils/config.js';

const MONGODB_URI = process.env.MONGODB_URI;

export const addForm = async (c) => {
  try {
    const body = await c.req.json();
    const mobileNumber = body.mobileNumber || body.customerDetails?.mobileNumber;

    if (!mobileNumber) {
      return c.json({ error: "Mobile number is required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const existing = await db.collection("forms").findOne({ mobileNumber });
      
      if (existing) {
        return c.json({ error: "Mobile number already registered!" }, 400);
      }

      await db.collection("forms").insertOne({
        mobileNumber,
        ...body
      });

      return c.json({ message: "Form submitted successfully!" }, 201);
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateForm = async (c) => {
  try {
    const body = await c.req.json();
    const { mobileNumber } = body;

    return await withDatabase(MONGODB_URI, async (db) => {
      // One operation instead of two
      const result = await db.collection("forms").updateOne(
        { mobileNumber },
        { $set: { ...body } }
      );

      if (result.matchedCount === 0) {
        return c.json({ error: "Mobile number not found!" }, 404);
      }

      return c.json({ message: "Form updated successfully!" });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateMobileNumber = async (c) => {
  try {
    const { oldMobileNumber, newMobileNumber } = await c.req.json();

    if (!oldMobileNumber || !newMobileNumber) {
      return c.json({ error: "Both numbers are required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 1. Check if the new number is already taken
      const newExists = await db.collection("forms").findOne({ mobileNumber: newMobileNumber });
      if (newExists) {
        return c.json({ error: "New mobile number already registered!" }, 400);
      }

      // 2. Perform the swap
      const result = await db.collection("forms").updateOne(
        { mobileNumber: oldMobileNumber },
        { $set: { mobileNumber: newMobileNumber } }
      );

      if (result.matchedCount === 0) {
        return c.json({ error: "Old mobile number not found!" }, 404);
      }

      return c.json({ message: "Mobile number updated successfully!" });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};