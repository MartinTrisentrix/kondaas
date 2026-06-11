import { withDatabase, getSystemKeys } from '../utils/config.js';
import { getZohoAccessToken } from '../utils/zohoAuth.js'; // 🔑 Imported from your utils helper!

const MONGODB_URI = process.env.MONGODB_URI;

// 🧮 Geolocation mathematical routing formula
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const getISTDateStrings = () => {
  const date = new Date();
  const todayDateOnly = date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const todayKey = todayDateOnly.replace(/-/g, "");
  return { todayDateOnly, todayKey };
};

/**
 * 📥 Add Order (Create Lead inside Zoho CRM & Init Surveyor Dispatch Queue)
 */
/**
 * 📥 Add Order (Extracts all form card fields, validates mobile, and pushes to Zoho CRM)
 */
export const addOrder = async (c) => {
  try {
    const body = await c.req.json();
    
    // 🔍 Extract only what's needed for the background geolocation dispatch engine
    const mobile = body.mobileNumber || body.mobile || body.Mobile; 
    const customerName = body.customerName || body.firstName || body.First_Name;
    const { latitude, longitude } = body;

    // 🛑 Strict Business Rule: Mobile Number is mandatory for Zoho Leads
    if (!mobile) {
      return c.json({ error: "Validation Error: Mobile number field is required to register a lead." }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically
      const zohoToken = await getZohoAccessToken(db);

      // 🏷️ Compute mandatory fallback fields that Zoho strictly rejects if missing
      const computedLastName = body.lastName || body.Last_Name || body.firstName || body.First_Name || customerName || "Unknown Lead";

      // 📦 Pure Dynamic Payload Builder
      const zohoPayload = {
        data: [
          {
            ...body,

            // Enforce mandatory fallbacks so the API remains happy
            Last_Name: computedLastName,
            Mobile: String(mobile)
          }
        ]
      };

      console.log(`📡 Forwarding pure dynamic payload to Zoho CRM for customer: ${customerName || 'New Lead'}`);

      const zohoResponse = await fetch("https://www.zohoapis.in/crm/v8/Leads", {
        method: "POST",
        headers: {
          "Authorization": `Zoho-oauthtoken ${zohoToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(zohoPayload)
      });

      if (!zohoResponse.ok) {
        const errDetails = await zohoResponse.text();
        console.error("❌ Zoho Insertion Blocked:", errDetails);
        return c.json({ error: "Failed to create lead inside Zoho CRM module.", details: errDetails }, 500);
      }

      const zohoResult = await zohoResponse.json();
      const statusBlock = zohoResult.data?.[0];

      if (statusBlock?.status !== "success") {
        return c.json({ error: "High level payload error rejected by Zoho.", details: statusBlock }, 400);
      }

      const zohoLeadId = statusBlock.details.id;
      console.log(`✅ Record successfully provisioned. Zoho Lead ID: ${zohoLeadId}`);

      // 📡 Proximity Geolocation Scan and Surveyor Queue Cascading Dispatch Engine
      if (latitude && longitude) {
        const { todayKey } = getISTDateStrings();
        const activeWorkers = await db.collection("locations")
          .find({ [todayKey]: { $exists: true } }).toArray();

        if (activeWorkers.length > 0) {
          const customerLat = parseFloat(latitude);
          const customerLon = parseFloat(longitude);

          const workersWithDistance = activeWorkers.map(worker => {
            const latestEntry = worker[todayKey]?.find(e => e.isLatest === true);
            if (!latestEntry) return null;

            return {
              phoneNo: worker.phoneNo,
              distance: haversineDistance(customerLat, customerLon, parseFloat(latestEntry.latitude), parseFloat(latestEntry.longitude))
            };
          }).filter(Boolean);

          if (workersWithDistance.length > 0) {
            workersWithDistance.sort((a, b) => a.distance - b.distance);
            
            await db.collection("jobs_queue").insertOne({
              taskType: "SURVEYOR_CASCADING_DISPATCH",
              leadId: zohoLeadId,
              surveyorsList: workersWithDistance, 
              currentIndex: 0,                                    
              status: "pending",
              runAt: new Date()                                  
            });

            console.log(`⏳ Cascading dispatch engine task initialized for Zoho Lead ID: ${zohoLeadId}`);
          }
        }
      }

      return c.json({ 
        success: true,
        message: "Order successfully added, Zoho synced dynamically, and dispatch engine triggered!", 
        id: zohoLeadId
      }, 201);
    });
  } catch (err) {
    console.error("❌ AddOrder Error Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const rejectOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { customerMobile, surveyorNumber, comment, receivedAt,name,address } = body;

    if (!comment) {
      return c.json({ error: "Rejection reason (comment) is required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Safe local insert maintaining standard auditing schemas exclusively
      const adminRejectPayload = {
        name: name,
        address: address,
        surveyorNumber: surveyorNumber || "N/A",
        customerMobile: customerMobile,
        comment: comment,
        time: receivedAt ? new Date(Number(receivedAt)).toISOString() : null
      };

      await db.collection("admin_reject").insertOne(adminRejectPayload);
      console.log(`✅ Rejection tracked locally in admin_reject collection for surveyor: ${surveyorNumber}`);
      
      return c.json({ success: true, message: "Order rejection cataloged locally." });
    });
  } catch (err) {
    console.error("❌ RejectOrder Exception Error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const completeOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { customerMobile, surveyorNumber, receivedAt,name,address } = body;

    return await withDatabase(MONGODB_URI, async (db) => {
      // Safe local insert maintaining standard auditing schemas exclusively
      const adminCompletePayload = {
        surveyorNumber: surveyorNumber || "N/A",
        customerMobile: customerMobile,
        name: name,
        address: address,
        time: receivedAt ? new Date(Number(receivedAt)).toISOString() : null
      };

      await db.collection("admin_complete").insertOne(adminCompletePayload);
      console.log(`✅ Completion tracked locally in admin_complete collection for surveyor: ${surveyorNumber}`);
      
      return c.json({ success: true, message: "Order completion cataloged locally." });
    });
  } catch (err) {
    console.error("❌ Completion Exception Error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const getAdminRejections = async (c) => {
  try {
    return await withDatabase(MONGODB_URI, async (db) => {
      const rejections = await db.collection("admin_reject").find({}).sort({ time: -1 }).toArray();
      return c.json({ success: true, count: rejections.length, data: rejections }, 200);
    });
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const getAdminCompletions = async (c) => {
  try {
    return await withDatabase(MONGODB_URI, async (db) => {
      const completions = await db.collection("admin_complete").find({}).sort({ time: -1 }).toArray();
      return c.json({ success: true, count: completions.length, data: completions }, 200);
    });
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**

 * 🔄 Update Order (Matches fields exactly with addOrder manual fallback pattern)
 */
export const updateOrder = async (c) => {
  try {
    const body = await c.req.json();
    
    // 🛑 Strict Business Rule: Explicit Zoho 'id' string is mandatory to target the right lead
    if (!body.id) {
      return c.json({ error: "Validation Error: A specific Zoho 'id' field is required to update an order." }, 400);
    }

    const targetZohoId = body.id;

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically
      const zohoToken = await getZohoAccessToken(db);

      // 📦 Build the pure dynamic update payload
      const zohoPayload = {
        data: [
          {
            // Inject the specific ID inside the data block array as mandated by Zoho API guidelines
            id: targetZohoId,

            // 🚀 Directly dump every single other field passed from the frontend completely as-is
            ...body
          }
        ]
      };

      console.log(`📡 Forwarding pure target update to Zoho CRM for explicit Record ID: ${targetZohoId}`);

      // 3. Make the PUT update request directly to that specific record's endpoint string
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Leads/${targetZohoId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Zoho-oauthtoken ${zohoToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(zohoPayload)
      });

      if (!response.ok) {
        const errDetails = await response.text();
        console.error("❌ Zoho Modification Blocked:", errDetails);
        return c.json({ error: "Failed to update record inside Zoho CRM module.", details: errDetails }, 500);
      }

      return c.json({ 
        success: true, 
        message: "Targeted Zoho CRM profile data synchronized cleanly!", 
        id: targetZohoId 
      });
    });
  } catch (err) {
    console.error("❌ UpdateOrder Error Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};


/**
 * 📋 Get Orders (Fetches records from Zoho including the profile Creation Timestamp)
 */
export const getOrders = async (c) => {
  try {
    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically out of RAM / config collection
      const zohoToken = await getZohoAccessToken(db);

      // 🏷️ Explicitly append 'Created_Time' field to request the record timestamp from Zoho
      const fieldsParam = "Last_Name,Customer_Name,Mobile,Whatsapp_Number,Email,City,Lead_Status,Street,Description,Wattage_Required,Created_Time";
      
      console.log("📡 Fetching active leads list from Zoho CRM index...");
      
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Leads?fields=${fieldsParam}&per_page=50`, {
        method: "GET",
        headers: {
          "Authorization": `Zoho-oauthtoken ${zohoToken}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const errTxt = await response.text();
        console.error("❌ Zoho Fetch Leads failed:", errTxt);
        return c.json({ error: "Failed to retrieve records from Zoho." }, 500);
      }

      const result = await response.json();
      
      // Remap Zoho API fields to clean, standardized JSON keys for mobile app UI rendering
      const orders = (result.data || []).map(lead => {
        const coordMatch = lead.Description?.match(/\[Coordinates:\s*([^,]+),\s*([^\]]+)\]/);
        
        return {
          id: lead.id,
          name: lead.Customer_Name || lead.Last_Name,
          mobile: lead.Mobile,
          whatsappNo: lead.Whatsapp_Number,
          email: lead.Email,
          city: lead.City,
          address: lead.Street,
          comment: lead.Description?.replace(/\[Coordinates:\s*[^\]]+\]\n?/, ''),
          status: lead.Lead_Status?.toLowerCase() || "unaccepted",
          latitude: coordMatch ? coordMatch[1] : null,
          longitude: coordMatch ? coordMatch[2] : null,
          kilovolt: lead.Wattage_Required,
          
          // 🗓️ Extract the profile creation timestamp cleanly
          date: lead.Created_Time || null 
        };
      });

      return c.json(orders);
    });
  } catch (err) {
    console.error("❌ GetOrders Error Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * 🗑️ Delete Order (Searches Zoho CRM by mobile number field key and deletes the record)
 */
export const deleteOrder = async (c) => {
  try {
    const body = await c.req.json();
    
    // 🛑 Strict Business Rule: Explicit Zoho 'id' string is mandatory to target the precise lead
    if (!body.id) {
      return c.json({ error: "Validation Error: A specific Zoho 'id' field is required to delete an order." }, 400);
    }

    const targetZohoId = body.id;

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically
      const zohoToken = await getZohoAccessToken(db);

      console.log(`🗑️ Initializing targeted erasure from Zoho CRM for Lead ID: ${targetZohoId}`);

      // 💥 Send the HTTP DELETE request straight to Zoho's explicit record endpoint URL string
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Leads/${targetZohoId}`, {
        method: "DELETE",
        headers: { 
          "Authorization": `Zoho-oauthtoken ${zohoToken}` 
        }
      });

      if (!response.ok) {
        const errDetails = await response.text();
        console.error("❌ Zoho Deletion Blocked:", errDetails);
        return c.json({ error: "Zoho CRM deletion operation failed.", details: errDetails }, 500);
      }

      console.log(`✅ Successfully deleted lead with ID: ${targetZohoId} from Zoho CRM.`);
      
      return c.json({ 
        success: true, 
        message: "Lead record deleted successfully from Zoho CRM.",
        id: targetZohoId
      }, 200);
    });
  } catch (err) {
    console.error("❌ DeleteOrder Error Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};