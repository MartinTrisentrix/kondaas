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
    
    // 🔍 Extract only the mandatory key parameters required for validation, Zoho lookup, and Geolocation
    const mobile = body.mobileNumber || body.mobile; 
    const customerName = body.customerName || body.firstName;
    const { latitude, longitude, description } = body;

    // 🛑 Strict Business Rule: Mobile Number is mandatory!
    if (!mobile) {
      return c.json({ error: "Validation Error: Mobile number field is required to register a lead." }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 1. Strict Local Duplicate Check: Ensure this mobile isn't already registered in the forms collection
      const existingForm = await db.collection("forms").findOne({ 
        $or: [{ mobile: String(mobile) }, { mobileNumber: String(mobile) }] 
      });
      
      if (existingForm) {
        return c.json({ error: "Validation Error: This mobile number is already registered!" }, 400);
      }

      const { todayKey } = getISTDateStrings();

      // 🔐 Grab active authorization credentials dynamically out of RAM / config collection
      const zohoToken = await getZohoAccessToken(db);

      // 🗺️ Format Coordinate notes cleanly to bundle at the top of description details
      const geoInfo = latitude && longitude ? `[Coordinates: ${latitude}, ${longitude}]\n` : '';
      const finalDescription = `${geoInfo}${description || ''}`.trim();

      // 🏷️ Compute the Last_Name property cleanly since Zoho strictly mandates its existence
      const computedLastName = body.lastName || body.firstName || customerName || "Unknown Lead";

      // 📦 Structure the payload dynamically matching what Zoho expects, filling from the dynamic body keys
      const zohoPayload = {
        data: [
          {
            // Mandatory Profile Block
            Last_Name: computedLastName,
            Customer_Name: customerName || "Unknown Lead",
            Salutation: body.title || null,
            First_Name: body.firstName || null,
            Employee_Name: body.employeeName || null,
            
            // Communications
            Phone: body.phone ? String(body.phone) : null,
            Mobile: String(mobile),
            Whatsapp_Number: body.whatsapp || body.whatsappNo ? String(body.whatsapp || body.whatsappNo) : null,
            Email: body.email || null,
            Secondary_Email: body.secondaryEmail || null,
            Fax: body.fax ? String(body.fax) : null,
            Skype_ID: body.skypeId || null,
            Twitter: body.twitter || null,
            Social_Lead_ID: body.socialLeadId || null,
            Email_Opt_Out: body.emailOptOut === true || body.emailOptOut === "true",

            // Company Meta Info
            Company: body.company || "Individual",
            Website: body.website || null,
            Industry: body.industry || null,
            Annual_Revenue: body.annualRevenue ? Number(body.annualRevenue) : null,
            No_of_Employees: body.noOfEmployees ? Number(body.noOfEmployees) : null,
            Rating: body.rating || null,

            // Core Source & Custom Manual Lifecycle settings 
            Lead_Source: body.leadSource || null,
            Lead_Status: body.leadStatus || null,

            // Solar Engineering Requirements Mappings
            Requirement_Type: body.requirementType || null,
            Service_Type: body.serviceType || null,
            EB_Numbers: body.ebNumbers || null,
            Wattage_Required: body.wattageRequired || body.kilovolt ? String(body.wattageRequired || body.kilovolt) : null,
            Type_of_Roof: body.typeOfRoof || null,
            When_Planning_to_Install: body.planningToInstall || null,
            Average_Monthly_Bill: body.monthlyBill ? Number(body.monthlyBill) : null,
            Purpose_of_Solar: body.purposeOfSolar || null,

            // Core Address Block Info
            Street: body.street || body.address || null,
            City: body.district || body.city || null,
            State: body.province || null,
            Country: body.country || null,
            Zip_Code: body.postalCode ? String(body.postalCode) : null,

            // Operational Scheduler & Dynamic Description Strings
            Description: finalDescription || null,
            Next_Follow_Up: body.nextFollowUp || null,
            Future_Prospect_Date: body.futureProspect || null
          }
        ]
      };

      console.log(`📡 Sending dynamic form payload to Zoho CRM for customer: ${customerName || 'New Lead'}`);

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

      // 📥 Save the complete dynamic payload to MongoDB exactly like your addForm controller!
      await db.collection("forms").insertOne({
        mobileNumber: String(mobile),
        zohoLeadId: zohoLeadId,
        createdAt: new Date(),
        ...body // Saves all key-values produced by the UI schema directly into Atlas
      });

      console.log(`📥 Raw form data successfully archived in local Atlas 'forms' collection.`);

      return c.json({ 
        success: true,
        message: "Order successfully added, Zoho synced, and dynamic form collection archived!", 
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
    const { customerMobile, surveyorNumber, comment, receivedAt } = body;

    if (!comment) {
      return c.json({ error: "Rejection reason (comment) is required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Safe local insert maintaining standard auditing schemas exclusively
      const adminRejectPayload = {
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

/**
 * 🔄 Update Order (Matches fields exactly with addOrder manual fallback pattern)
 */
export const updateOrder = async (c) => {
  try {
    const body = await c.req.json();
    
    // Extract every single field exactly like your addOrder function
    const {
      // Section 1: Lead Information
      title,
      firstName,
      lastName,
      customerName,
      employeeName,
      phone,
      mobile,
      whatsapp,
      email,
      secondaryEmail,
      company,
      website,
      fax,
      leadSource,
      leadStatus,
      industry,
      annualRevenue,
      noOfEmployees,
      rating,
      skypeId,
      twitter,
      socialLeadId,
      emailOptOut,

      // Section 2: Requirements
      requirementType,
      serviceType,
      ebNumbers,
      wattageRequired,
      typeOfRoof,
      planningToInstall,
      monthlyBill,
      purposeOfSolar,

      // Section 3: Address Information
      street,
      district,
      province,
      country,
      postalCode,

      // Section 4: Description Information
      description,

      // Section 5: Follow Up Information
      nextFollowUp,
      futureProspect,

      // Geolocation Coordinates
      latitude,
      longitude
    } = body;

    // 🛑 Strict Business Rule: Mobile Number is mandatory to run the search lookup
    if (!mobile) {
      return c.json({ error: "Validation Error: Mobile number is required to update a lead." }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically out of RAM / config collection
      const zohoToken = await getZohoAccessToken(db);

      // 🔍 Find the unique Zoho record ID by searching for the mobile number
      console.log(`🔍 Searching Zoho CRM for profile matching phone: ${mobile}`);
      const searchResponse = await fetch(`https://www.zohoapis.in/crm/v8/Leads/search?phone=${mobile}`, {
        method: "GET",
        headers: { "Authorization": `Zoho-oauthtoken ${zohoToken}` }
      });

      const searchResult = await searchResponse.json();
      const zohoRecord = searchResult.data?.[0];

      if (!zohoRecord?.id) {
        return c.json({ error: "Lead profile not found in Zoho CRM using provided mobile key." }, 404);
      }

      // 🗺️ Format Coordinate notes cleanly to bundle at the top of description details
      const geoInfo = latitude && longitude ? `[Coordinates: ${latitude}, ${longitude}]\n` : '';
      const finalDescription = `${geoInfo}${description || ''}`.trim();

      // 🏷️ Compute the Last_Name property cleanly matching addOrder logic
      const computedLastName = lastName || firstName || customerName || "Unknown Lead";

      // 📦 Structure the payload using your exact manual fallback layout block style
      const zohoPayload = {
        data: [
          {
            // Zoho mandates the record ID inside the data block array for PUT requests
            id: zohoRecord.id,

            // Mandatory Profile Block
            Last_Name: computedLastName,
            Customer_Name: customerName || firstName || "Unknown Lead",
            Salutation: title || null,
            First_Name: firstName || null,
            Employee_Name: employeeName || null,
            
            // Communications
            Phone: phone ? String(phone) : null,
            Mobile: String(mobile),
            Whatsapp_Number: whatsapp ? String(whatsapp) : null,
            Email: email || null,
            Secondary_Email: secondaryEmail || null,
            Fax: fax ? String(fax) : null,
            Skype_ID: skypeId || null,
            Twitter: twitter || null,
            Social_Lead_ID: socialLeadId || null,
            Email_Opt_Out: emailOptOut === true || emailOptOut === "true",

            // Company Meta Info
            Company: company || "Individual", 
            Website: website || null,
            Industry: industry || null,
            Annual_Revenue: annualRevenue ? Number(annualRevenue) : null,
            No_of_Employees: noOfEmployees ? Number(noOfEmployees) : null,
            Rating: rating || null,

            // Core Source & Custom Manual Lifecycle settings 
            Lead_Source: leadSource || null,
            Lead_Status: leadStatus || null,

            // Solar Engineering Requirements Mappings
            Requirement_Type: requirementType || null,
            Service_Type: serviceType || null,
            EB_Numbers: ebNumbers || null,
            Wattage_Required: wattageRequired ? String(wattageRequired) : null,
            Type_of_Roof: typeOfRoof || null,
            When_Planning_to_Install: planningToInstall || null,
            Average_Monthly_Bill: monthlyBill ? Number(monthlyBill) : null,
            Purpose_of_Solar: purposeOfSolar || null,

            // Core Address Block Info
            Street: street || null,
            City: district || null,        // District maps to Zoho standard 'City' field
            State: province || null,
            Country: country || null,
            Zip_Code: postalCode ? String(postalCode) : null,

            // Operational Scheduler & Dynamic Description Strings
            Description: finalDescription || null,
            Next_Follow_Up: nextFollowUp || null,
            Future_Prospect_Date: futureProspect || null
          }
        ]
      };

      console.log(`📡 Sending layout sync updates to Zoho CRM for Lead ID: ${zohoRecord.id}`);

      // 3. Make the PUT update request to Zoho CRM API module endpoint
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Leads/${zohoRecord.id}`, {
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
        message: "Zoho CRM profile data synchronized cleanly!", 
        id: zohoRecord.id 
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
    const { mobile } = body;

    // 🛑 Strict Business Rule: Mobile Number is required to locate the profile to remove
    if (!mobile) {
      return c.json({ error: "Validation Error: Mobile number field key is required to delete a lead." }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically out of RAM / config collection
      const zohoToken = await getZohoAccessToken(db);

      console.log(`🔍 Searching Zoho CRM to find profile deletion match for phone: ${mobile}`);
      
      // 🔍 Find the unique Zoho record ID by searching for the mobile number
      const searchResponse = await fetch(`https://www.zohoapis.in/crm/v8/Leads/search?phone=${mobile}`, {
        method: "GET",
        headers: { "Authorization": `Zoho-oauthtoken ${zohoToken}` }
      });

      const searchResult = await searchResponse.json();
      const zohoRecord = searchResult.data?.[0];

      if (!zohoRecord?.id) {
        return c.json({ error: "Lead profile not found in Zoho CRM using provided mobile key." }, 404);
      }

      console.log(`🗑️ Erasing record from Zoho CRM matching Lead ID: ${zohoRecord.id}`);

      // 💥 Send the HTTP DELETE request straight to Zoho's explicit record endpoint URL
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Leads/${zohoRecord.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Zoho-oauthtoken ${zohoToken}` }
      });

      if (!response.ok) {
        const errDetails = await response.text();
        console.error("❌ Zoho Deletion Blocked:", errDetails);
        return c.json({ error: "Zoho CRM deletion operation failed.", details: errDetails }, 500);
      }

      console.log(`✅ Successfully deleted lead with mobile: ${mobile} from Zoho CRM.`);
      
      return c.json({ 
        success: true, 
        message: "Lead record deleted successfully from Zoho CRM.",
        id: zohoRecord.id
      }, 200);
    });
  } catch (err) {
    console.error("❌ DeleteOrder Error Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};