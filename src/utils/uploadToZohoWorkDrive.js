import fs from 'fs';
import path from 'path'; // 🎯 Securely extracts standard path strings
import axios from 'axios';
import FormData from 'form-data';
import { withDatabase } from './config.js'; // Adjust path to your config file
import { getZohoAccessToken } from './zohoAuth.js'; 

// 🎯 Consistent: Defined at the top just like your other controller/util files!
const MONGODB_URI = process.env.MONGODB_URI;

/**
 * 📂 ZOHO WORKDRIVE UPLOADER UTILITY (Core Engine)
 * 🎯 UPDATE: Added dynamic targetFolderId parameter
 */
export const uploadToZohoWorkDrive = async (filePath, fileName, targetFolderId) => {
  try {
    // Default fallback to your original survey root folder ID if no target is provided
    const DEFAULT_SURVEY_FOLDER_ID = "8sxm6a7d40a4e935d407ca08ff8243055a7b1";
    const WORKDRIVE_FOLDER_ID = targetFolderId || DEFAULT_SURVEY_FOLDER_ID;

    return await withDatabase(MONGODB_URI, async (db) => {
      
      const zAccessToken = await getZohoAccessToken(db);

      const form = new FormData();

      // 🎯 FIX: If fileName is passed, use it. If not, extract the clean filename from filePath automatically!
      const finalFileName = fileName || path.basename(filePath);
      
      form.append('content', fs.createReadStream(filePath), { filename: finalFileName });
      form.append('parent_id', WORKDRIVE_FOLDER_ID);
      form.append('override-name-exist', 'true');

      console.log(`📡 Pushing ${finalFileName} securely to Zoho WorkDrive Folder [${WORKDRIVE_FOLDER_ID}]...`);

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
 * 📸 NEW: SURVEYOR ATTENDANCE PHOTO WRAPPER
 * 🎯 Handles daily check-ins: names file strictly by mobile number and directs to attendance folder
 */
export const uploadSurveyorAttendancePhoto = async (filePath, mobileNumber, originalFileName) => {
  try {
    // Grab the exact extension (.jpg, .png, etc.) from the incoming file
    const fileExtension = path.extname(originalFileName) || '.jpg';
    
    // 🎯 RULE: Filename format is mobile number alone as requested by your lead
    const customZohoName = `${mobileNumber}${fileExtension}`;

    // 🎯 TARGET: Dedicated Attendance folder ID extracted from your shared URL
    const ATTENDANCE_FOLDER_ID = "f25r5e10f341b80fb410b85392b1c4834328f";

    console.log(`📸 Processing attendance photo. Naming structure: ${customZohoName}`);
    
    // Pass the file, custom name, and the specific attendance folder ID straight to the core engine!
    const uploadedUrl = await uploadToZohoWorkDrive(filePath, customZohoName, ATTENDANCE_FOLDER_ID);
    return uploadedUrl;
  } catch (err) {
    console.error(`❌ Attendance wrapper crashed for surveyor mobile: ${mobileNumber}`, err.message);
    throw err;
  }
};


const getOrCreateDateFolder = async (dateString) => {
  // 🎯 Master Anchor: Your manual Leads folder ID
  const LEADS_MASTER_FOLDER_ID = "321624257e8e50b1641688dfc711863900c30";

  const [year, month, day] = dateString.split('-'); 
  const monthFolderName = `${year}-${month}`; // "2026-06"
  const dayFolderName = day;                  // "18"
  const remotePathTree = `${monthFolderName}/${dayFolderName}`;

  return await withDatabase(MONGODB_URI, async (db) => {
    const cacheCollection = db.collection("zoho_folders");

    // 🔎 STEP 1: Check MongoDB if today's day folder already exists
    const cachedDayFolder = await cacheCollection.findOne({ 
      type: "day", 
      path: remotePathTree 
    });

    if (cachedDayFolder) {
      console.log(`📋 MongoDB Notebook Cache Hit! Found Day Folder ID: ${cachedDayFolder.zohoFolderId}`);
      return cachedDayFolder.zohoFolderId;
    }

    console.log(`📝 Cache Miss! First upload for ${remotePathTree}. Resolving tree via Zoho API...`);
    const zAccessToken = await getZohoAccessToken(db);

    // 🔎 STEP 2: Check or Create the Month Folder (YYYY-MM)
    let monthFolderId;
    const cachedMonthFolder = await cacheCollection.findOne({ type: "month", name: monthFolderName });

    if (cachedMonthFolder) {
      monthFolderId = cachedMonthFolder.zohoFolderId;
    } else {
      console.log(`📁 Creating Month Folder "${monthFolderName}" inside Leads Master...`);
      
      // 🎯 MATCHING YOUR CURL EXACTLY: URL endpoint and body payload
      const monthRes = await axios.post('https://www.zohoapis.in/workdrive/api/v1/files', {
        data: {
          type: "files",
          attributes: {
            name: monthFolderName,
            parent_id: LEADS_MASTER_FOLDER_ID
          }
        }
      }, {
        headers: { 
          'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
          'Content-Type': 'application/json'
        }
      });

      // Added fallback layout matching just in case Zoho puts the id inside attributes
      monthFolderId = monthRes.data?.data?.id || monthRes.data?.data?.attributes?.id;

      if (!monthFolderId) {
        throw new Error("Failed to extract monthFolderId from Zoho response schema.");
      }

      // Save month shortcut to MongoDB cache
      await cacheCollection.insertOne({
        type: "month",
        name: monthFolderName,
        zohoFolderId: monthFolderId,
        createdAt: new Date()
      });
    }

    // 🔎 STEP 3: Create the Day Folder (DD) inside the resolved Month Folder
    console.log(`📁 Creating Day Folder "${dayFolderName}" inside Month Folder...`);
    
    // 🎯 MATCHING YOUR CURL EXACTLY
    const dayRes = await axios.post('https://www.zohoapis.in/workdrive/api/v1/files', {
      data: {
        type: "files",
        attributes: {
          name: dayFolderName,
          parent_id: monthFolderId
        }
      }
    }, {
      headers: { 
        'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
        'Content-Type': 'application/json'
      }
    });

    // Added fallback layout matching here as well
    const dayFolderId = dayRes.data?.data?.id || dayRes.data?.data?.attributes?.id;

    if (!dayFolderId) {
      throw new Error("Failed to extract dayFolderId from Zoho response schema.");
    }

    // Save the day shortcut to MongoDB for all future uploads today
    await cacheCollection.insertOne({
      type: "day",
      path: remotePathTree,
      zohoFolderId: dayFolderId,
      createdAt: new Date()
    });

    return dayFolderId;
  });
};
/**
 * 📸 MAIN BRIDGE WRAPPER: UPLOAD PHOTO TO DYNAMIC LEADS CALENDAR TREE
 */
export const uploadLeadPhotoToDynamicTree = async (filePath, customerNumber, dateString, originalFileName) => {
  try {
    const normalizedDate = dateString.replace(/[\/\\]/g, '-');

    // 1. Resolve or create the nested folder path IDs via our smart uploader helper!
    const targetFolderId = await getOrCreateDateFolder(normalizedDate);

    const fileExtension = path.extname(originalFileName) || '.jpg';
    const customZohoName = `${customerNumber}${fileExtension}`;

    console.log(`🚀 Routing file ${customZohoName} into resolved sub-folder ID: ${targetFolderId}`);

    // 2. Hand it directly to your functioning core uploader function!
    const uploadedUrl = await uploadToZohoWorkDrive(filePath, customZohoName, targetFolderId);
    return uploadedUrl;

  } catch (err) {
    console.error(`❌ Dynamic tree upload pipeline crashed for Customer Number: ${customerNumber}`, err.message);
    throw err;
  }
};





