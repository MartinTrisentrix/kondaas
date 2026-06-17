import fs from 'fs';
import path from 'path'; // 🎯 Added to securely extract standard path strings
import axios from 'axios';
import FormData from 'form-data';
import { withDatabase } from './config.js'; // Adjust path to your config file
import { getZohoAccessToken } from './zohoAuth.js'; 

// 🎯 Consistent: Defined at the top just like your other controller/util files!
const MONGODB_URI = process.env.MONGODB_URI;

/**
 * 📂 ZOHO WORKDRIVE UPLOADER UTILITY (Core Engine)
 */
export const uploadToZohoWorkDrive = async (filePath, fileName) => {
  try {
    const WORKDRIVE_FOLDER_ID = "8sxm6a7d40a4e935d407ca08ff8243055a7b1";

    return await withDatabase(MONGODB_URI, async (db) => {
      
      const zAccessToken = await getZohoAccessToken(db);

      const form = new FormData();

      // 🎯 FIX: If fileName is passed, use it. If not, extract the clean filename from filePath automatically!
      const finalFileName = fileName || path.basename(filePath);
      
      form.append('content', fs.createReadStream(filePath), { filename: finalFileName });
      form.append('parent_id', WORKDRIVE_FOLDER_ID);
      form.append('override-name-exist', 'true');

      console.log(`📡 Pushing ${finalFileName} securely to Zoho WorkDrive Folder...`);

      const response = await axios.post('https://workdrive.zoho.in/api/v1/upload', form, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
          ...form.getHeaders()
        }
      });

      // Extract the data object out of Zoho's native payload array
      const resourceData = response.data?.data?.[0];

      // Pull the actual file resource ID from the true Zoho upload schema properties
      const fileId = resourceData?.id || resourceData?.attributes?.resource_id || resourceData?.attributes?.id;

      // 🎯 FIX: Force the fallback link to use the unauthenticated public direct download endpoint
      // This allows your message_api container to cleanly fetch the raw file stream for WhatsApp delivery!
      const workDriveUrl = resourceData?.attributes?.permalink || `https://workdrive.zoho.in/api/v1/download/${fileId}`;

      console.log(`✅ File synced to Zoho WorkDrive successfully: ${workDriveUrl}`);
      return workDriveUrl;
    });

  } catch (error) {
    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error("❌ Zoho WorkDrive Upload Failed:", errorDetails);
    throw new Error(`WorkDrive integration crash: ${errorDetails}`);
  }
};

/**
 * 📸 SURVEYOR PHOTO PROCESSOR WRAPPER
 * Takes the file, handles custom phone + date formatting, and uploads it.
 */
export const uploadSurveyorPhoto = async (filePath, phoneNo, date) => {
  // 1. Sanitize date formatting (replace slashes or backslashes with dashes so it doesn't break directory names)
  const cleanDate = date.replace(/[\/\\]/g, '-');
  
  // 2. Add a simple timestamp so multiple surveyor images on the same day don't overwrite each other
  const timestamp = Math.floor(Date.now() / 1000);
  
  // 3. Assemble filename string: phoneNo_date_timestamp.jpg
  const fileName = `${phoneNo}_${cleanDate}_${timestamp}.jpg`;

  try {
    // 4. Pass straight to your core upload engine above!
    const uploadedUrl = await uploadToZohoWorkDrive(filePath, fileName);
    return uploadedUrl;
  } catch (err) {
    console.error(`❌ Photo Flow wrapper crashed for surveyor: ${phoneNo}`, err.message);
    throw err;
  }
};