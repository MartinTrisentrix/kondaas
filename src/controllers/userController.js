import { withDatabase } from '../utils/config.js';
import fs from 'fs';
import path from 'path';
import { uploadToZohoWorkDrive } from '../utils/uploadToZohoWorkDrive.js';

const MONGODB_URI = process.env.MONGODB_URI;


export const addForm = async (c) => {
  // Array to track temporary files for guaranteed disk cleanup
  const temporaryFilesToClean = [];

  try {
    // 1. Parse Multipart Form-Data instead of raw JSON
    const body = await c.req.parseBody({ all: true });
    
    // Extract metadata text. Handles both flat properties and nested data blocks gracefully
    const dataFields = typeof body.data === 'string' ? JSON.parse(body.data) : body;
    const mobileNumber = dataFields.mobileNumber || dataFields.customerDetails?.mobileNumber;

    if (!mobileNumber) {
      return c.json({ error: "Mobile number is required!" }, 400);
    }

    // 🎯 TARGET RESOLUTION: Extract the Deal ID field for custom file naming structures
    const dealId = dataFields.deal_id || dataFields.id || mobileNumber;

    // 2. Extract and Isolate the Image Files from the payload boundary
    const rawPhotos = body.ebBillPhotos;
    const photoFiles = Array.isArray(rawPhotos) ? rawPhotos : (rawPhotos ? [rawPhotos] : []);

    const uploadedPhotoUrls = [];

    // 3. Loop through each uploaded EB bill photo binary stream
    for (let i = 0; i < photoFiles.length; i++) {
      const file = photoFiles[i];

      // Validate that it's a valid file stream object
      if (file && file.name) {
        // Create a unique temporary file path on your server disk space
        const tempDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        const tempFilePath = path.join(tempDir, `temp_eb_${dealId}_${i}_${Date.now()}${path.extname(file.name)}`);
        temporaryFilesToClean.push(tempFilePath);

        // Stream the incoming binary array buffer down to our temporary file slot
        const arrayBuffer = await file.arrayBuffer();
        fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));

        // 🎯 FIX: Formats naming configuration layout to match lead specs: e.g., 923194000004459074-ebslot 1.jpg
        const customZohoName = `${dealId}-ebslot ${i + 1}${path.extname(file.name)}`;

        console.log(`📸 Forwarding EB Bill File [${i + 1}/${photoFiles.length}] named as: ${customZohoName} to Zoho engine...`);
        
        // Push straight up to your existing WorkDrive utility function!
        const publicUrl = await uploadToZohoWorkDrive(tempFilePath, customZohoName);
        uploadedPhotoUrls.push(publicUrl);
      }
    }

    // 4. Save everything neatly into MongoDB Atlas
    return await withDatabase(MONGODB_URI, async (db) => {
      const existing = await db.collection("forms").findOne({ mobileNumber });
      
      if (existing) {
        return c.json({ error: "Mobile number already registered!" }, 400);
      }

      // Combine text fields + your brand new Zoho downloadable links array
      const finalDocument = {
        mobileNumber,
        ...dataFields,
        ebBillPhotos: uploadedPhotoUrls, // Keeps links tracking alive in background metrics records
        createdAt: new Date().toISOString()
      };

      await db.collection("forms").insertOne(finalDocument);
      console.log(`✅ Form and ${uploadedPhotoUrls.length} EB bill links successfully synced to Atlas!`);

      return c.json({ message: "Form submitted successfully with EB bill photos!" }, 201);
    });

  } catch (err) {
    console.error("❌ Exception inside multipart addForm controller:", err.message);
    return c.json({ error: err.message }, 500);
  } finally {
    // 5. 🛡️ Bulletproof Cleanup Loop: Wipes all short-lived temp files from your local environment disk
    for (const filePath of temporaryFilesToClean) {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (cleanupError) {
          console.error(`⚠️ Failed to delete temporary file: ${filePath}`, cleanupError.message);
        }
      }
    }
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