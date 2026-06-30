import { withDatabase } from '../utils/config.js'; 

const MONGODB_URI = process.env.MONGODB_URI;

const parseTime = (timeStr) => {
  const [time, modifier] = timeStr.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  if (modifier === 'PM' && hours !== 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

const epochToDateTime = (epoch) => {
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(epoch + IST_OFFSET);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  const date = `${year}${month}${day}`;

  let hours = istDate.getUTCHours();
  const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
  const modifier = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const time = `${String(hours).padStart(2, '0')}:${minutes} ${modifier}`;

  return { date, time };
};

export const addLocation = async (c) => {
  try {
    const { phoneNo, latitude, longitude, epoch } = await c.req.json();
    if (!phoneNo || !latitude || !longitude || !epoch) {
      return c.json({ error: "Required fields missing!" }, 400);
    }

    const { date, time } = epochToDateTime(epoch);
    const newEntry = { time, latitude, longitude, isLatest: true };

    return await withDatabase(MONGODB_URI, async (db) => {
      const doc = await db.collection("logistic-location").findOne({ phoneNo });

      if (!doc || !doc[date]) {
        // Handle first entry of the day
        await db.collection("logistic-location").updateOne(
          { phoneNo },
          { $push: { [date]: newEntry } },
          { upsert: true }
        );
      } else {
        // Recalculate based on time-strings to handle network lag/out-of-order pings
        const entries = [...doc[date], newEntry];
        let latestTime = -1;
        let latestIndex = -1;

        entries.forEach((entry, index) => {
          const entryTime = parseTime(entry.time);
          if (entryTime >= latestTime) {
            latestTime = entryTime;
            latestIndex = index;
          }
        });

        const updatedEntries = entries.map((entry, index) => ({
          ...entry,
          isLatest: index === latestIndex
        }));

        await db.collection("logistic-location").updateOne(
          { phoneNo },
          { $set: { [date]: updatedEntries } }
        );
      }
      return c.json({ message: "Location saved successfully!" });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getLocationByTime = async (c) => {
  try {
    const { mobiles, date, startTime, endTime } = await c.req.json();
    if (!mobiles || !date || !startTime || !endTime) return c.json({ error: "Missing fields" }, 400);

    const start = parseTime(startTime);
    const end = parseTime(endTime);

    return await withDatabase(MONGODB_URI, async (db) => {
      const docs = await db.collection("logistic-location").find({ phoneNo: { $in: mobiles } }).toArray();
      const result = docs.map((doc) => {
        const entries = doc[date] || [];
        const filtered = entries.filter((entry) => {
          const entryTime = parseTime(entry.time);
          return entryTime >= start && entryTime <= end;
        });
        return { phoneNo: doc.phoneNo, entries: filtered };
      });
      return c.json(result);
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getCurrentLocation = async (c) => {
  try {
    const { mobiles } = await c.req.json();
    if (!mobiles) return c.json({ error: "mobiles is required!" }, 400);

    const { date } = epochToDateTime(Date.now());

    return await withDatabase(MONGODB_URI, async (db) => {
      const docs = await db.collection("logistic-location").find({ phoneNo: { $in: mobiles } }).toArray();
      const result = docs.map((doc) => {
        const entries = doc[date] || [];
        const latest = entries.find((entry) => entry.isLatest === true);
        return { phoneNo: doc.phoneNo, currentLocation: latest || null };
      });
      return c.json(result);
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getLogisticsDealsByMobile = async (c) => {
  try {
    // 1. Grab the mobile number from the query string parameters (e.g., ?mobile=6666666666)
    const mobile = c.req.query("mobile");

    if (!mobile) {
      return c.json({ success: false, error: "Missing mobile query parameter" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 2. Fetch all assignments matching this mobile number
      const deals = await db
        .collection("logistics_deals")
        .find({ mobile: mobile })
        .sort({ assignedAt: -1 }) // ✨ Newest runs appear at the top of their screen
        .toArray();

      // 3. Return the array to populate the app's list view
      return c.json({
        success: true,
        count: deals.length,
        data: deals
      }, 200);
    });

  } catch (err) {
    console.error("❌ Fetching Logistics Deals Exception:", err.message);
    return c.json({ success: false, error: "Failed to retrieve logistics assignments" }, 500);
  }
};


export const rejectLogisticsDeal = async (c) => {
  try {
    const body = await c.req.json();
    // 1. Destructure only the relevant logistics parameters
    const { deal_id, mobile, comment } = body;

    if (!deal_id || !comment) {
      return c.json({ success: false, error: "deal_id and rejection reason (comment) are required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 2. Insert lightweight audit document into 'logistics_rejects'
      const rejectPayload = {
        deal_id: String(deal_id),
        mobile: mobile || "N/A",
        comment: comment,
        rejectedAt: new Date()
      };

      await db.collection("logistics_reject").insertOne(rejectPayload);
      console.log(`✅ Rejection tracked in logistics_reject for driver: ${mobile}`);

     

      // 4. Look up active Administrator accounts to fetch their FCM tokens
      try {
        const admins = await db.collection("userdetails").find({
          "UserInfo.role": "admin"
        }).toArray();

        let adminTokens = [];

        admins.forEach((adminUser) => {
          const devices = adminUser.PlatformInfo?.devices;
          if (devices && Array.isArray(devices)) {
            devices.forEach((device) => {
              if (device.fcmToken) {
                adminTokens.push(device.fcmToken);
              }
            });
          }
        });

        // 5. Send standard push notification to Admins
        if (adminTokens.length > 0) {
          const message = {
            notification: {
              title: "🚨 Delivery Assignment Rejected!",
              body: `Logistics member (${mobile || 'Driver'}) rejected Deal ID: ${deal_id}. Reason: ${comment}`,
            },
            android: {
              priority: "high",
              notification: {
                channelId: "weekly_summary_channel_v1",
                sound: "default",
              }
            },
            apns: {
              payload: {
                aps: {
                  sound: "default"
                }
              }
            },
            data: {
              click_action: "FLUTTER_NOTIFICATION_CLICK",
              type: "LOGISTICS_REJECTION",
              deal_id: String(deal_id)
            },
            tokens: adminTokens,
          };

          const response = await admin.messaging().sendEachForMulticast(message);
          console.log(`🚀 Rejection alert pushed to Admin devices. Success count: ${response.successCount}`);
        } else {
          console.log(`⚠️ Rejection recorded, but no active Admin FCM tokens found.`);
        }
      } catch (pushErr) {
        console.error("⚠️ Non-blocking warning: Failed to send Admin notification:", pushErr.message);
      }

      return c.json({ success: true, message: "Logistics deal rejection tracked and Admin notified." }, 200);
    });
  } catch (err) {
    console.error("❌ rejectLogisticsDeal Exception Error:", err.message);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
};


export const createLogisticsProduct = async (c) => {
  try {
    const body = await c.req.json();

    // 1. Basic Payload Validation
    if (!body || Object.keys(body).length === 0) {
      return c.json({ 
        error: "Validation Error: Request body is empty. No data received." 
      }, 400);
    }

    // 2. Persist to MongoDB Atlas
    return await withDatabase(MONGODB_URI, async (db) => {
      const collection = db.collection("kondaas-products");

      // 🚀 THE MAGIC DUMP: Accepts whatever comes here as it is
      const newLogisticsRecord = {
        ...body,
        createdAt: new Date(), // Record tracking timestamp
        status: "picked" 
      };

      console.log(`📦 Storing dynamic product details into kondaas-products...`);
      
      const insertResult = await collection.insertOne(newLogisticsRecord);

      return c.json({
        success: true,
        message: "Logistics product and pricing records successfully stored.",
        recordId: insertResult.insertedId
      }, 201);
    });

  } catch (err) {
    console.error("❌ Logistics Product Capture Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const updateProductStatus = async (c) => {
  try {
    const body = await c.req.json();
    const { id, status } = body;

    // 1. Basic validation
    if (!id || !status) {
      return c.json({ error: "Validation Error: Both 'id' and 'status' are required in the body." }, 400);
    }

    const allowedStatuses = [ "dropped", "received", "inprogress", "installed"];
    if (!allowedStatuses.includes(status)) {
      return c.json({ error: `Validation Error: Invalid status. Must be one of: ${allowedStatuses.join(', ')}` }, 400);
    }

    // 2. Update directly in MongoDB
    return await withDatabase(MONGODB_URI, async (db) => {
      const collection = db.collection("kondaas-products");
      const { ObjectId } = await import('mongodb');

      const updateResult = await collection.updateOne(
        { _id: new ObjectId(id) },
        { 
          $set: { 
            status: status
          } 
        }
      );

      if (updateResult.matchedCount === 0) {
        return c.json({ error: "Product record not found." }, 404);
      }

      console.log(`🔄 Product ${id} updated to status: ${status}`);

      return c.json({
        success: true,
        message: `Product status successfully updated to '${status}'.`
      }, 200);
    });

  } catch (err) {
    console.error("❌ Product Status Update Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const logLogisticsCompletion = async (c) => {
  try {
    const body = await c.req.json();
    // 1. Extract only the identifying fields from the request body
    const { deal_id, mobile } = body;

    if (!deal_id || !mobile) {
      return c.json({ success: false, error: "Missing deal_id or mobile number" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 2. Insert a clean, lightweight entry into the completion log collection
      const completionPayload = {
        deal_id: String(deal_id),
        mobile: mobile,
        completedAt: new Date()
      };

      await db.collection("logistics_completed").insertOne(completionPayload);
      console.log(`✅ Completion log created for Deal ID: ${deal_id} by driver: ${mobile}`);

      // 3. Send back a clean success response to the app
      return c.json({ 
        success: true, 
        message: "Delivery completion successfully logged." 
      }, 200);
    });

  } catch (err) {
    console.error("❌ logLogisticsCompletion Exception Error:", err.message);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
};