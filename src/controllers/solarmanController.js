import { withDatabase, getSystemKeys } from '../utils/config.js';
import { SolarParser } from '../utils/SolarParser.js';

const SOLARMAN_BASE_URL = "https://globalapi.solarmanpv.com";
const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Helper to fetch Solarman keys once per request
 */
const getKeys = async (db) => {
  const keys = await getSystemKeys(db);
  return keys.solarman;
};

export const getSolarmanToken = async (c) => {
  try {
    const { email, password } = await c.req.json();
   
    if (!email || !password) {
      return c.json({ error: "email and password are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const { appId, appSecret } = await getKeys(db);

      const response = await fetch(
        `${SOLARMAN_BASE_URL}/account/v1.0/token?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appSecret, email, password })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return c.json({
          error: data.msg || "Failed to get token",
          raw: data
        }, 400);
      }

      return c.json(data);
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  } 
};

export const getSolarmanStations = async (c) => {
  try {
    // 🛡️ Get the token sent by the mobile from the request header
    const incomingToken = c.req.header('x-auth-token');
    
    // ✅ Extract deviceId alongside token and phoneNo from the request body
    const { token, phoneNo, deviceId } = await c.req.json();

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    // 🚨 NEW MANDATORY CHECK: Ensure deviceId is provided to map token validation context
    if (!deviceId) {
      return c.json({ error: "deviceId is required in the request body" }, 400);
    }

    if (!incomingToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    if (!token) {
      return c.json({ error: "Access token is required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Fetch the full user document to cross-examine device lists and tokens
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      // 🛡️ NEW MULTI-DEVICE SECURITY CHECK: Locate target device session inside the devices list array
      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === deviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered device layout for ${phoneNo} on device ${deviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      // --- TOKEN VERIFIED: Proceed to Solarman API ---
      const { appId } = await getKeys(db);

      const response = await fetch(
        `${SOLARMAN_BASE_URL}/station/v1.0/list?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ page: 1, size: 10 })
        }
      );

      const data = await response.json();

      if (!data.success) {
        return c.json({ error: data.msg || "Failed to fetch stations", raw: data }, 400);
      }

      return c.json({
        message: "Stations retrieved successfully",
        stations: data.stationList || []
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getSolarmanDevices = async (c) => {
  try {
    // 🛡️ Get the token sent by the mobile from the request header
    const incomingToken = c.req.header('x-auth-token');
    
    // Parameters from the request body
    const { token, stationId, phoneNo } = await c.req.json();

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    if (!incomingToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    if (!stationId) {
      return c.json({ error: "Station ID is required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Fetch the full user document without projections
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      // 🛡️ SECURITY CHECK: Compare the header token with the stored authToken
      const storedToken = user.UserInfo?.authToken;

      if (!storedToken || storedToken !== incomingToken) {
        console.error(`❌ Security Alert: Token mismatch for ${phoneNo}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      // --- TOKEN VERIFIED: Proceed to Solarman API ---
      const { appId } = await getKeys(db);

      const response = await fetch(
        `${SOLARMAN_BASE_URL}/station/v1.0/device?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ stationId, page: 1, size: 20 })
        }
      );

      const data = await response.json();

      return c.json({
        success: data.success,
        message: data.msg || "Response received",
        devices: data.deviceList || data.deviceListItems || data.stationDeviceList || []
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getSolarmanRealTimeData = async (c) => {
  try {
    const { token, deviceId } = await c.req.json();

    if (!token || !deviceId) {
      return c.json({ error: "Token and Device ID are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const { appId } = await getKeys(db);

      const response = await fetch(
        `${SOLARMAN_BASE_URL}/device/v1.0/currentData?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ deviceId })
        }
      );

      const data = await response.json();

      if (!data.success) {
        return c.json({ error: data.msg || "Failed to fetch real-time data", raw: data }, 400);
      }

      return c.json({
        message: "Real-time data retrieved successfully",
        deviceId,
        dataList: data.dataList || []
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getSolarmanHistory = async (c) => {
  try {
    // 🛡️ SECURITY FEATURE: Firebase token from mobile app header
    const incomingSecurityToken = c.req.header('x-auth-token');
    
    // Extract deviceId from request JSON body parameters alongside others
    const { token, stationId, timeType, startTime, endTime, phoneNo, deviceId } = await c.req.json();

    if (!incomingSecurityToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    if (!deviceId) {
      return c.json({ error: "deviceId is required in the request body" }, 400);
    }

    if (!token || !stationId || !timeType) {
      return c.json({ error: "Token, Station ID, and TimeType are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🛡️ SECURITY LOOKUP: Find user by phone and verify station ownership array link
      const user = await db.collection("userDetails").findOne({ 
        _id: phoneNo,
        "devicelist.id": Number(stationId)
      });

      if (!user) {
        return c.json({ error: "Unauthorized: Invalid profile or unlinked station" }, 401);
      }

      // 🛡️ MULTI-DEVICE SECURITY CHECK: Scan array for matching hardware session string
      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === deviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingSecurityToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered hardware configuration for user: ${phoneNo}, device: ${deviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      // 🕒 LAYER 2 CHECK: Cache Logic for non-day timeTypes (Week, Month, Year)
      const isDayRequest = Number(timeType) === 1; 
      const cacheKey = `history_${timeType}_${startTime}_${endTime}`;

      if (!isDayRequest) {
        const cache = await db.collection("solarSavingsCache").findOne({ _id: String(stationId) });

        if (cache && cache.historyCache?.[cacheKey]) {
          const storedChart = cache.historyCache[cacheKey];
          const lastCachedTime = new Date(storedChart.lastCalculatedAt);
          const currentTime = new Date();
          
          const hoursPassed = (currentTime - lastCachedTime) / (1000 * 60 * 60);

          // If this chart data was fetched less than 24 hours ago, return it immediately!
          if (hoursPassed < 24) {
            console.log(`⚡ [History Cache Hit] Returning stored ${cacheKey} from DB`);
            return c.json({
              success: true,
              fromCache: true,
              data: storedChart.data
            });
          }
        }
      } else {
        console.log(`☀️ [Live Day Request] Bypassing cache checks completely for station: ${stationId}`);
      }

      // 💥 LAYER 3: FETCH FRESH DATA FROM EXTERNAL API
      console.log(`🔄 Fetching fresh metrics from Solarman API for key: ${cacheKey}`);
      const { appId } = await getKeys(db);

      const response = await fetch(
        `${SOLARMAN_BASE_URL}/station/v1.0/history?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}` // Solarman Token
          },
          body: JSON.stringify({ 
            stationId, 
            timeType, 
            startTime, 
            endTime 
          })
        }
      );

      const data = await response.json();

      if (!data.success) {
        return c.json({ 
          error: data.msg || "Solarman History Error", 
          code: data.code,
          raw: data 
        }, 400);
      }

      const rawItems = data.stationDataItems || [];

      // 🚨 REAL FIX: If it is a live day request, return it NOW. Do not let it hit the code below!
      if (isDayRequest) {
        console.log(`✅ [Live Day Success] Successfully returning un-cached data to device.`);
        return c.json({
          success: true,
          fromCache: false,
          data: rawItems
        });
      }

      // 💾 SAVE TO DB CACHE (Strictly executed ONLY for Week, Month, and Year charts)
      console.log(`💾 Caching heavy historical chart data for key: ${cacheKey}`);
      const chartDataToCache = {
        data: rawItems,
        lastCalculatedAt: new Date().toISOString()
      };

      await db.collection("solarSavingsCache").updateOne(
        { _id: String(stationId) },
        { 
          $set: { 
            [`historyCache.${cacheKey}`]: chartDataToCache 
          } 
        },
        { upsert: true }
      );

      return c.json({
        success: true,
        fromCache: false,
        data: rawItems
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};
//user details  alternate for firebase storage are

export const saveUserDetails = async (c) => {
  try {
    const data = await c.req.json();
    const mobile = data.UserInfo?.phoneNo;
    
    // 🚨 Extract device specifications from the new PlatformInfo block
    const incomingDevice = data.PlatformInfo?.devices?.[0] || data.PlatformInfo?.device;
    const deviceId = incomingDevice?.deviceId;

    if (!mobile) return c.json({ error: "Mobile number is required" }, 400);
    if (!deviceId) return c.json({ error: "Device ID is required for session tracking" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      // Fetch the existing profile to prevent blowing away other active device sessions
      const existingUser = await db.collection("userDetails").findOne({ _id: mobile });
      
      // Initialize or pull existing devices array
      let currentDevicesList = existingUser?.PlatformInfo?.devices || [];

      // Clean out any old session tracking for THIS specific hardware ID
      currentDevicesList = currentDevicesList.filter(d => d.deviceId !== deviceId);

      // Construct the pristine new session block to be pushed
      const newDeviceSession = {
        deviceId: deviceId,
        os: incomingDevice.os || "Unknown",
        version: incomingDevice.version || "Unknown",
        authToken: incomingDevice.authToken || data.UserInfo?.authToken,
        fcmToken: incomingDevice.fcmToken || data.UserInfo?.fcmToken,
        lastUsedAt: new Date().toISOString()
      };

      // Append the clean session object to our tracking array
      currentDevicesList.push(newDeviceSession);

      const setFields = {};

      // Map basic app metrics
      if (data.AppInfo) setFields.AppInfo = data.AppInfo;
      setFields["PlatformInfo.devices"] = currentDevicesList;
      setFields.updatedAt = new Date();

      // Map core identity profile with the new role field fallback
      if (data.UserInfo) {
        const ui = data.UserInfo;
        if (ui.phoneNo)  setFields["UserInfo.phoneNo"]  = ui.phoneNo;
        if (ui.email)    setFields["UserInfo.email"]    = ui.email;
        if (ui.password) setFields["UserInfo.password"] = ui.password;
        if (ui.name)     setFields["UserInfo.name"]     = ui.name;
        
        // Setup role configuration block. Retain existing role if it exists, otherwise set to default 'user'
        setFields["UserInfo.role"] = existingUser?.UserInfo?.role || ui.role || "user";
      }

      // Handle multi-station generation parser array (Untouched from yesterday)
      if (data.devicelist && data.devicelist.length > 0) {
        const firstParsed = SolarParser.parse(data.devicelist[0]);
        if (firstParsed.state) setFields["UserInfo.state"] = firstParsed.state;
        
        setFields.devicelist = data.devicelist.map((rawStation) => {
          const parsed = SolarParser.parse(rawStation);
          return {
            ...rawStation,
            operationalTimestamp: parsed.operationalTimestamp,
            stationId: parsed.stationId,
            capacityKw: parsed.capacityKw
          };
        });
      }

      // Commit changes surgically to MongoDB
      await db.collection("userDetails").updateOne(
        { _id: mobile },
        { $set: setFields }, 
        { upsert: true }
      );

      return c.json({ 
        success: true, 
        message: "Profile settings and active device session synced successfully" 
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};



export const getUser = async (c) => {
  try {
    // ✅ Extract deviceId alongside phoneNo from request JSON body parameters
    const { phoneNo, deviceId } = await c.req.json();
    
    // 🛡️ Get the token sent by the mobile from the request header
    const incomingToken = c.req.header('x-auth-token');

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    // 🚨 NEW MANDATORY CHECK: Ensure deviceId is provided to track multi-device context
    if (!deviceId) {
      return c.json({ error: "deviceId is required in the request body" }, 400);
    }

    if (!incomingToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 1. We fetch the user with targeted fields including role and our array of sessions
      const user = await db.collection("userDetails").findOne(
        { _id: phoneNo },
        { 
          projection: { 
            "UserInfo.email": 1, 
            "UserInfo.password": 1, 
            "UserInfo.role": 1,          // ✅ Projection updated to fetch role
            "PlatformInfo.devices": 1    // ✅ Projection updated to fetch active device list array
          } 
        }
      );

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      // 🛡️ NEW MULTI-DEVICE SECURITY CHECK: Drill into array to find matching deviceId
      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === deviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered device configuration for ${phoneNo} on device ${deviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      // ✅ SUCCESS: Send back email, password, and the newly added role field fallback
      return c.json({
        success: true,
        data: {
          email: user.UserInfo?.email,
          password: user.UserInfo?.password,
          role: user.UserInfo?.role || "user" // Fallback default to 'user' safely if missing
        }
      });
    });
  } catch (err) {
    console.error("❌ Error in getUser:", err.message);
    return c.json({ error: err.message }, 500);
  }
};


export const seedTariffSlabs = async (c) => {
  try {
    return await withDatabase(MONGODB_URI, async (db) => {
      const collection = db.collection("solarExportSlabs");

      const tamilNaduData = {
        state: "Tamil Nadu",
        category: "solar_export_credit",
        type: "progressive",
        slabs: [
          { from: 1, to: 100, rate: 0 },
          { from: 101, to: 200, rate: 2.35 },
          { from: 201, to: 400, rate: 4.7 },
          { from: 401, to: 500, rate: 6.3 },
          { from: 501, to: 600, rate: 8.4 },
          { from: 601, to: 800, rate: 9.45 },
          { from: 801, to: 1000, rate: 10.5 },
          { from: 1001, to: null, rate: 11.55 }
        ],
        updatedAt: new Date()
      };

      const keralaData = {
        state: "kerala",
        category: "domestic_consumption",
        type: "telescopic + non-telescopic",
        fixedCharges: {
          // SET TO 0: This prevents the ₹160 from being added every month in the loop
          single_phase: { up_to_250: 0 } 
        },
        slabs: {
          telescopic_up_to_250: [
            { from: 0, to: 50, rate: 3.35 },
            { from: 51, to: 100, rate: 4.25 },
            { from: 101, to: 150, rate: 5.35 },
            { from: 151, to: 200, rate: 7.2 },
            { from: 201, to: 250, rate: 8.5 }
          ],
          non_telescopic_above_250: [
            { from: 251, to: 300, rate: 6.75 },
            { from: 301, to: 350, rate: 7.6 },
            { from: 351, to: 400, rate: 7.95 },
            { from: 401, to: 500, rate: 8.25 },
            { from: 501, to: null, rate: 9.2 }
          ]
        },
        updatedAt: new Date()
      };

      await collection.updateOne({ _id: "tamil-nadu" }, { $set: tamilNaduData }, { upsert: true });
      await collection.updateOne({ _id: "kerala" }, { $set: keralaData }, { upsert: true });

      return c.json({ success: true, message: "Tariff slabs updated successfully with 0 fixed charges" });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};


