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
export const uploadSurveyorAttendancePhoto = async (filePath, mobileNumber, time, fileExtension) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`; // "2026-06-19"

    // Fetch the target 3-tier Day Folder ID passing both the date and surveyor's phone
    const targetDayFolderId = await getOrCreateDateFolder(dateString, mobileNumber);

    // 🎯 NEW FILENAME RULE: SI_HH-MM-SS.ext (Dropped mobile from filename since it's now the parent folder)
    const customZohoName = `SI_${time}${fileExtension}`;
    console.log(`📸 Target Surveyor Day Folder Resolved. Storing photo as: ${customZohoName}`);
    
    const uploadedUrl = await uploadToZohoWorkDrive(filePath, customZohoName, targetDayFolderId);
    return uploadedUrl;

  } catch (err) {
    console.error(`❌ Attendance wrapper crashed for surveyor mobile: ${mobileNumber}`, err.message);
    throw err;
  }
};


//sur-Attendance folder creation
export const getOrCreateDateFolder = async (dateString, mobileNumber) => {
  // 🎯 Master Anchor: Your dedicated Attendance root folder ID
  const ATTENDANCE_FOLDER_ID = "sfoej0bf69353dfa0460c9a2264540039d5d0";

  const [year, month, day] = dateString.split('-'); 
  const monthFolderName = `${year}-${month}`; // "2026-06"
  const dayFolderName = day;                  // "19"
  
  // Unique database lookup paths scoped exactly to this surveyor phone number
  const surveyorPathKey = `${mobileNumber}`;
  const monthPathKey = `${mobileNumber}/${monthFolderName}`;
  const fullDayPathKey = `${mobileNumber}/${monthFolderName}/${dayFolderName}`;

  return await withDatabase(MONGODB_URI, async (db) => {
    const cacheCollection = db.collection("zoho_folders");

    // 🔎 STEP 1: Check MongoDB if this surveyor's specific day folder already exists
    const cachedDayFolder = await cacheCollection.findOne({ 
      type: "day", 
      path: fullDayPathKey 
    });

    if (cachedDayFolder) {
      console.log(`📋 Cache Hit! Found Surveyor Day Folder ID: ${cachedDayFolder.zohoFolderId}`);
      return cachedDayFolder.zohoFolderId;
    }

    console.log(`📝 Cache Miss! First upload for path [${fullDayPathKey}]. Resolving tree via Zoho API...`);
    const zAccessToken = await getZohoAccessToken(db);

    // 🔎 STEP 2: Check or Create the Surveyor's Parent Folder inside Attendance Root
    let surveyorFolderId;
    const cachedSurveyorFolder = await cacheCollection.findOne({ type: "surveyor", path: surveyorPathKey });

    if (cachedSurveyorFolder) {
      surveyorFolderId = cachedSurveyorFolder.zohoFolderId;
    } else {
      console.log(`📁 Creating Surveyor Mobile Folder "${mobileNumber}" inside Attendance Root...`);
      
      const surveyorRes = await axios.post('https://www.zohoapis.in/workdrive/api/v1/files', {
        data: {
          type: "files",
          attributes: {
            name: mobileNumber,
            parent_id: ATTENDANCE_FOLDER_ID
          }
        }
      }, {
        headers: { 
          'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
          'Content-Type': 'application/json'
        }
      });

      surveyorFolderId = surveyorRes.data?.data?.id || surveyorRes.data?.data?.attributes?.id;

      if (!surveyorFolderId) {
        throw new Error("Failed to extract surveyorFolderId from Zoho response schema.");
      }

      await cacheCollection.insertOne({
        type: "surveyor",
        path: surveyorPathKey,
        zohoFolderId: surveyorFolderId,
        createdAt: new Date()
      });
    }

    // 🔎 STEP 3: Check or Create the Month Folder (YYYY-MM) inside Surveyor's Mobile Folder
    let monthFolderId;
    const cachedMonthFolder = await cacheCollection.findOne({ type: "month", path: monthPathKey });

    if (cachedMonthFolder) {
      monthFolderId = cachedMonthFolder.zohoFolderId;
    } else {
      console.log(`📁 Creating Month Folder "${monthFolderName}" inside Surveyor folder...`);
      
      const monthRes = await axios.post('https://www.zohoapis.in/workdrive/api/v1/files', {
        data: {
          type: "files",
          attributes: {
            name: monthFolderName,
            parent_id: surveyorFolderId // Nesting inside surveyor folder ID
          }
        }
      }, {
        headers: { 
          'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
          'Content-Type': 'application/json'
        }
      });

      monthFolderId = monthRes.data?.data?.id || monthRes.data?.data?.attributes?.id;

      if (!monthFolderId) {
        throw new Error("Failed to extract monthFolderId from Zoho response schema.");
      }

      await cacheCollection.insertOne({
        type: "month",
        path: monthPathKey,
        zohoFolderId: monthFolderId,
        createdAt: new Date()
      });
    }

  // 🔎 STEP 4: Create the Day Folder (DD) inside the resolved Month Folder
    console.log(`📁 Creating Day Folder "${dayFolderName}" inside Month Folder...`);
    
    const dayRes = await axios.post('https://www.zohoapis.in/workdrive/api/v1/files', {
      data: {
        type: "files",
        attributes: {
          name: dayFolderName,
          parent_id: monthFolderId // Nesting inside month folder ID
        }
      }
    }, {
      headers: { 
        'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const dayFolderId = dayRes.data?.data?.id || dayRes.data?.data?.attributes?.id;

    if (!dayFolderId) {
      throw new Error("Failed to extract dayFolderId from Zoho response schema.");
    }

    await cacheCollection.insertOne({
      type: "day",
      path: fullDayPathKey,
      zohoFolderId: dayFolderId,
      createdAt: new Date()
    });

    return dayFolderId;
  });
};


//Lead details 
export const getOrCreateLeadsSEFolder = async (dealId, subfolderType) => {
  // 🎯 Master Anchor: Double check this matches your Zoho folder properties link!
  const LEADS_SE_ROOT_ID = "sfoeja4258e75cef24ca7bcc99b036b7610a7";

  const dealPathKey = `${dealId}`;
  const fullSubfolderPathKey = `${dealId}/${subfolderType}`;

  return await withDatabase(MONGODB_URI, async (db) => {
    const cacheCollection = db.collection("zoho_folders");

    // 🔎 STEP 1: Check MongoDB Cache
    const cachedSubfolder = await cacheCollection.findOne({ 
      type: "leads_se_subfolder", 
      path: fullSubfolderPathKey 
    });

    if (cachedSubfolder) {
      console.log(`📋 Cache Hit! Found Leads_SE Subfolder [${subfolderType}] ID: ${cachedSubfolder.zohoFolderId}`);
      return cachedSubfolder.zohoFolderId;
    }

    console.log(`📝 Cache Miss! First upload for path [${fullSubfolderPathKey}]. Resolving tree via Zoho API...`);
    const zAccessToken = await getZohoAccessToken(db);

    // 🔎 STEP 2: Check or Create the Deal's Parent Folder
    let dealFolderId;
    const cachedDealFolder = await cacheCollection.findOne({ type: "leads_se_deal", path: dealPathKey });

    if (cachedDealFolder) {
      dealFolderId = cachedDealFolder.zohoFolderId;
    } else {
      console.log(`📁 Creating Deal ID Folder "${dealId}" inside Leads_SE Root [${LEADS_SE_ROOT_ID}]...`);
      
      try {
        const dealRes = await axios.post('https://www.zohoapis.in/workdrive/api/v1/files', {
          data: {
            type: "files",
            attributes: {
              name: String(dealId),
              parent_id: LEADS_SE_ROOT_ID
            }
          }
        }, {
          headers: { 
            'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
            'Content-Type': 'application/json'
          }
        });

        dealFolderId = dealRes.data?.data?.id || dealRes.data?.data?.attributes?.id;

        if (!dealFolderId) {
          throw new Error("Failed to extract dealFolderId from Zoho response schema.");
        }

        await cacheCollection.insertOne({
          type: "leads_se_deal",
          path: dealPathKey,
          zohoFolderId: dealFolderId,
          createdAt: new Date()
        });

      } catch (err) {
        if (err.isAxiosError && err.response) {
          console.error("❌ Zoho API Refused Folder Creation (Step 2)!");
          console.error("🔹 Status Code:", err.response.status);
          console.error("🔹 Error Details:", JSON.stringify(err.response.data, null, 2));
        }
        throw err;
      }
    }

    // 🔎 STEP 3: Create the requested Subfolder
    console.log(`📁 Creating Subfolder "${subfolderType}" inside Deal folder [${dealFolderId}]...`);
    
    try {
      const subfolderRes = await axios.post('https://www.zohoapis.in/workdrive/api/v1/files', {
        data: {
          type: "files",
          attributes: {
            name: subfolderType,
            parent_id: dealFolderId
          }
        }
      }, {
        headers: { 
          'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const subfolderFolderId = subfolderRes.data?.data?.id || subfolderRes.data?.data?.attributes?.id;

      if (!subfolderFolderId) {
        throw new Error(`Failed to extract subfolderFolderId for ${subfolderType} from Zoho response schema.`);
      }

      await cacheCollection.insertOne({
        type: "leads_se_subfolder",
        path: fullSubfolderPathKey,
        zohoFolderId: subfolderFolderId,
        createdAt: new Date()
      });

      return subfolderFolderId;

    } catch (err) {
      if (err.isAxiosError && err.response) {
        console.error(`❌ Zoho API Refused Subfolder [${subfolderType}] Creation (Step 3)!`);
        console.error("🔹 Status Code:", err.response.status);
        console.error("🔹 Error Details:", JSON.stringify(err.response.data, null, 2));
      }
      throw err;
    }
  });
};









