import { withDatabase } from '../utils/config.js';
import fs from 'fs';
import path from 'path';
import { uploadToZohoWorkDrive,getOrCreateLeadsSEFolder } from '../utils/uploadToZohoWorkDrive.js';

const MONGODB_URI = process.env.MONGODB_URI;


export const addForm = async (c) => {
  const temporaryFilesToClean = [];

  try {
    // 1. Parse Multipart Form-Data
    const body = await c.req.parseBody({ all: true });
    
    const dataFields = typeof body.data === 'string' ? JSON.parse(body.data) : body;
    const mobileNumber = dataFields.mobileNumber || dataFields.customerDetails?.mobileNumber;

    if (!mobileNumber) {
      return c.json({ error: "Mobile number is required!" }, 400);
    }

    // 🎯 TARGET RESOLUTION: Extract the raw deal_id string
    const dealId = dataFields.deal_id || dataFields.id || mobileNumber;

    // Isolate both array categories from the incoming body payload
    const rawEbPhotos = body.ebBillPhotos;
    const ebFiles = Array.isArray(rawEbPhotos) ? rawEbPhotos : (rawEbPhotos ? [rawEbPhotos] : []);

    const rawSitePhotos = body.sitePhotos; // 👈 Extract site photos array from frontend fields
    const siteFiles = Array.isArray(rawSitePhotos) ? rawSitePhotos : (rawSitePhotos ? [rawSitePhotos] : []);

    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    // -------------------------------------------------------------------------
    // PROCESS CATEGORY 1: last 6 month EBbill
    // -------------------------------------------------------------------------
    const uploadedEbUrls = [];
    if (ebFiles.length > 0) {
      // 🔍 Resolve or create the 3-tier folder structure: Leads_SE -> dealId -> last 6 month EBbill
      const targetEbFolderId = await getOrCreateLeadsSEFolder(dealId, "last 6 month EBbill");

      for (let i = 0; i < ebFiles.length; i++) {
        const file = ebFiles[i];
        if (file && file.name) {
          const ext = path.extname(file.name) || '.jpg';
          const tempPath = path.join(uploadDir, `temp_eb_${dealId}_${i}_${Date.now()}${ext}`);
          temporaryFilesToClean.push(tempPath);

          fs.writeFileSync(tempPath, Buffer.from(await file.arrayBuffer()));

          // 🎯 STICK NAMING CONFIG: eb bill 1.jpg, eb bill 2.jpg...
          const customFileName = `eb bill ${i + 1}${ext}`;
          console.log(`📸 Streaming EB Bill [${i + 1}/${ebFiles.length}] as: ${customFileName}`);

          const url = await uploadToZohoWorkDrive(tempPath, customFileName, targetEbFolderId);
          uploadedEbUrls.push(url);
        }
      }
    }

    // -------------------------------------------------------------------------
    // PROCESS CATEGORY 2: site photos
    // -------------------------------------------------------------------------
    const uploadedSiteUrls = [];
    if (siteFiles.length > 0) {
      // 🔍 Resolve or create the 3-tier folder structure: Leads_SE -> dealId -> site photos
      const targetSiteFolderId = await getOrCreateLeadsSEFolder(dealId, "site photos");

      for (let i = 0; i < siteFiles.length; i++) {
        const file = siteFiles[i];
        if (file && file.name) {
          const ext = path.extname(file.name) || '.jpg';
          const tempPath = path.join(uploadDir, `temp_site_${dealId}_${i}_${Date.now()}${ext}`);
          temporaryFilesToClean.push(tempPath);

          fs.writeFileSync(tempPath, Buffer.from(await file.arrayBuffer()));

          // 🎯 STICK NAMING CONFIG: 1.jpg, 2.jpg, 3.jpg...
          const customFileName = `${i + 1}${ext}`;
          console.log(`📸 Streaming Site Photo [${i + 1}/${siteFiles.length}] as: ${customFileName}`);

          const url = await uploadToZohoWorkDrive(tempPath, customFileName, targetSiteFolderId);
          uploadedSiteUrls.push(url);
        }
      }
    }

    // 2. Save everything neatly into MongoDB Atlas
    return await withDatabase(MONGODB_URI, async (db) => {
      const existing = await db.collection("forms").findOne({ mobileNumber });
      
      if (existing) {
        return c.json({ error: "Mobile number already registered!" }, 400);
      }

      const finalDocument = {
        mobileNumber,
        ...dataFields,
        ebBillPhotos: uploadedEbUrls,  // Array of live Zoho download links
        sitePhotos: uploadedSiteUrls,  // Array of live Zoho download links
        createdAt: new Date().toISOString()
      };

      await db.collection("forms").insertOne(finalDocument);
      console.log(`✅ Form completely matched and stored to MongoDB Atlas!`);

      return c.json({ 
        success: true, 
        message: "Form submitted successfully. Documents sorted and backed up to Zoho WorkDrive!" 
      }, 201);
    });

  } catch (err) {
    console.error("❌ Exception inside multipart addForm controller:", err.message);
    return c.json({ error: err.message }, 500);
  } finally {
    // 3. Disk Space Cleanup Loop
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