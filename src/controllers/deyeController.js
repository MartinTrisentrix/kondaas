import { withDatabase, getSystemKeys } from '../utils/config.js';
import { SolarParser } from '../utils/SolarParser.js';
import { getInternalDeyeToken, fetchDeyeHistory } from '../utils/deyeApi.js';

const DEYE_BASE_URL = "https://india-developer.deyecloud.com";
const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Helper to fetch Deye keys once per request
 */
const getKeys = async (db) => {
  const keys = await getSystemKeys(db);
  return keys.deye || keys.solarman || keys;
};

/**
 * 1. Direct Token Retrieval Endpoint
 */
export const getDeyeToken = async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "email and password are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const { appId, appSecret } = await getKeys(db);

      const response = await fetch(
        `${DEYE_BASE_URL}/v1.0/account/token?appId=${appId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appSecret, email, password })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
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

/**
 * 2. Fetch Station List with Device Verification & Session Auth
 */
export const getDeyeStations = async (c) => {
  try {
    const incomingSecurityToken = c.req.header('x-auth-token');
    const incomingDeviceId = c.req.header('x-device-id');

    const { phoneNo } = await c.req.json();

    if (!incomingSecurityToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    if (!incomingDeviceId) {
      return c.json({ error: "Unauthorized: No deviceId provided in headers" }, 401);
    }

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === incomingDeviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingSecurityToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered device layout for ${phoneNo} on device ${incomingDeviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      if (!user.UserInfo?.email || !user.UserInfo?.password) {
        return c.json({ error: "Deye credentials missing on profile" }, 404);
      }

      const token = await getInternalDeyeToken(
        db,
        user.UserInfo.email,
        user.UserInfo.password,
        getKeys
      );

      const response = await fetch(
        `${DEYE_BASE_URL}/v1.0/station/list`,
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

/**
 * 3. Fetch Devices inside a Station
 */
export const getDeyeDevices = async (c) => {
  try {
    const incomingToken = c.req.header('x-auth-token');
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
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      const storedToken = user.UserInfo?.authToken;

      if (!storedToken || storedToken !== incomingToken) {
        console.error(`❌ Security Alert: Token mismatch for ${phoneNo}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      // Tested endpoint: /v1.0/station/device with stationIds array
      const response = await fetch(
        `${DEYE_BASE_URL}/v1.0/station/device`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ stationIds: [Number(stationId)], page: 1, size: 20 })
        }
      );

      const data = await response.json();

      return c.json({
        success: data.success,
        message: data.msg || "Response received",
        devices: data.deviceListItems || data.deviceList || []
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

/**
 * 4. Fetch Real-Time Data for a Device
 */
export const getDeyeRealTimeData = async (c) => {
  try {
    const { token, deviceSn } = await c.req.json();

    if (!token || !deviceSn) {
      return c.json({ error: "Token and Device SN are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Tested endpoint: /v1.0/device/latest with deviceList array
      const response = await fetch(
        `${DEYE_BASE_URL}/v1.0/device/latest`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ deviceList: [deviceSn] })
        }
      );

      const data = await response.json();

      if (!data.success) {
        return c.json({ error: data.msg || "Failed to fetch real-time data", raw: data }, 400);
      }

      const inverterMetrics = data.deviceDataList?.[0]?.dataList || [];

      return c.json({
        message: "Real-time data retrieved successfully",
        deviceSn,
        dataList: inverterMetrics
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

/**
 * 5. Pure Core Helper Function for Deye History Calls
 */
export const getDeyeDataCore = async (db, user, deviceSn, timeType, startTime, endTime) => {
  try {
    if (!user.UserInfo?.email || !user.UserInfo?.password) {
      throw new Error("Deye credentials missing on profile");
    }

    const token = await getInternalDeyeToken(
      db,
      user.UserInfo.email,
      user.UserInfo.password,
      getKeys
    );

    const data = await fetchDeyeHistory({
      deviceSn,
      timeType: Number(timeType),
      startTime,
      endTime,
      token,
      db,
      getKeys
    });

    if (!data.success) {
      throw new Error(data.msg || "Deye External API Request Failed");
    }

    return data;
  } catch (error) {
    console.error("❌ Error in getDeyeDataCore helper:", error.message);
    throw error;
  }
};

/**
 * 6. Historical Data with Multi-Device Auth & Caching Layer
 */
export const getDeyeHistory = async (c) => {
  try {
    const incomingSecurityToken = c.header('x-auth-token') || c.req.header('x-auth-token');
    const incomingDeviceId = c.header('x-device-id') || c.req.header('x-device-id');

    const { stationId, deviceSn, timeType, startTime, endTime, phoneNo } = await c.req.json();

    if (!incomingSecurityToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    if (!incomingDeviceId) {
      return c.json({ error: "Unauthorized: No deviceId provided in headers" }, 401);
    }

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    if (!stationId || !timeType) {
      return c.json({ error: "Station ID and TimeType are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const user = await db.collection("userDetails").findOne({
        _id: phoneNo,
        "devicelist.id": Number(stationId)
      });

      if (!user) {
        return c.json({ error: "Unauthorized: Invalid profile or unlinked station" }, 401);
      }

      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === incomingDeviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingSecurityToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered hardware configuration for user: ${phoneNo}, device: ${incomingDeviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token configuration" }, 401);
      }

      if (!user.UserInfo?.email || !user.UserInfo?.password) {
        return c.json({ error: "Deye credentials missing on profile" }, 404);
      }

      const isDayRequest = Number(timeType) === 1;
      const cacheKey = `history_${timeType}_${startTime}_${endTime}`;

      if (!isDayRequest) {
        const cache = await db.collection("solarSavingsCache").findOne({ _id: String(stationId) });

        if (cache && cache.historyCache?.[cacheKey]) {
          const storedChart = cache.historyCache[cacheKey];
          const lastCachedTime = new Date(storedChart.lastCalculatedAt);
          const currentTime = new Date();

          const hoursPassed = (currentTime - lastCachedTime) / (1000 * 60 * 60);

          if (hoursPassed < 24) {
            return c.json({
              success: true,
              fromCache: true,
              data: storedChart.data
            });
          }
        }
      }

      // Determine target inverter serial number
      const targetDeviceSn = deviceSn || user.devicelist?.find(d => Number(d.id) === Number(stationId))?.deviceSn;

      if (!targetDeviceSn) {
        return c.json({ error: "Device SN (inverter serial number) is required for Deye history retrieval." }, 400);
      }

      const data = await getDeyeDataCore(db, user, targetDeviceSn, timeType, startTime, endTime);
      const rawItems = data.deviceDataList || data.dataList || [];

      if (isDayRequest) {
        let computedDayUnits = 0;

        try {
          const currentLifetimeTotal = Number(data.generationTotal ?? 0);
          const historyCacheDoc = await db.collection("solarSavingsCache").findOne({ _id: String(stationId) });
          const midnightBaselineTotal = Number(historyCacheDoc?.dayStartBaselineTotal ?? 0);

          if (currentLifetimeTotal > 0 && midnightBaselineTotal > 0) {
            computedDayUnits = Number((currentLifetimeTotal - midnightBaselineTotal).toFixed(2));
          } else {
            let maxVal = 0;
            for (const item of rawItems) {
              const val = Number(item.generationValue ?? item.value ?? 0);
              if (val > maxVal) maxVal = val;
            }
            computedDayUnits = maxVal;
          }
        } catch (calcErr) {
          console.error("⚠️ Failed calculating live units via total fallback:", calcErr.message);
        }

        return c.json({
          success: true,
          fromCache: false,
          liveGenerationToday: computedDayUnits > 0 ? computedDayUnits : 0,
          data: rawItems
        });
      }

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

/**
 * 7. Save User Profile Details & Parse Station Device List
 */
export const saveDeyeUserDetails = async (c) => {
  try {
    const incomingSecurityToken = c.req.header('x-auth-token');
    const headerDeviceId = c.req.header('x-device-id');

    const data = await c.req.json();
    const mobile = data.UserInfo?.phoneNo;

    const incomingDevice = data.PlatformInfo?.devices?.[0] || data.PlatformInfo?.device;
    const deviceId = headerDeviceId || incomingDevice?.deviceId;

    if (!incomingSecurityToken) {
      return c.json({ error: "Unauthorized: No security token provided in headers" }, 401);
    }
    if (!mobile) {
      return c.json({ error: "Mobile number is required" }, 400);
    }
    if (!deviceId) {
      return c.json({ error: "Device ID is required for session tracking" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const existingUser = await db.collection("userDetails").findOne({ _id: mobile });

      let deviceExistsInDb = false;

      if (existingUser) {
        const devicesList = existingUser.PlatformInfo?.devices || [];
        const currentDeviceSession = devicesList.find(d => d.deviceId === deviceId);
        if (currentDeviceSession) {
          deviceExistsInDb = true;
        }
      }

      let currentDevicesList = existingUser?.PlatformInfo?.devices || [];

      currentDevicesList = currentDevicesList.map(d => {
        if (d.deviceId === deviceId) {
          return {
            ...d,
            os: incomingDevice?.os || d.os || "Unknown",
            version: incomingDevice?.version || d.version || "Unknown",
            authToken: incomingSecurityToken,
            fcmToken: incomingDevice?.fcmToken || d.fcmToken || data.UserInfo?.fcmToken,
            lastUsedAt: new Date().toISOString(),
            isLastLoggedIn: true
          };
        }
        return {
          ...d,
          isLastLoggedIn: false
        };
      });

      if (!deviceExistsInDb) {
        currentDevicesList.push({
          deviceId: deviceId,
          os: incomingDevice?.os || "Unknown",
          version: incomingDevice?.version || "Unknown",
          authToken: incomingSecurityToken,
          fcmToken: incomingDevice?.fcmToken || data.UserInfo?.fcmToken,
          lastUsedAt: new Date().toISOString(),
          isLastLoggedIn: true
        });
      }

      const setFields = {};
      if (data.AppInfo) setFields.AppInfo = data.AppInfo;
      setFields["PlatformInfo.devices"] = currentDevicesList;
      setFields.updatedAt = new Date();

      if (data.UserInfo) {
        const ui = data.UserInfo;
        if (ui.phoneNo)  setFields["UserInfo.phoneNo"]  = ui.phoneNo;
        if (ui.email)    setFields["UserInfo.email"]    = ui.email;
        if (ui.password) setFields["UserInfo.password"] = ui.password;
        if (ui.name)     setFields["UserInfo.name"]     = ui.name;

        setFields["UserInfo.role"] = existingUser?.UserInfo?.role || ui.role || "user";
      }

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

/**
 * 8. Get User Profile with Device Session Authorization
 */
export const getDeyeUser = async (c) => {
  try {
    const incomingToken = c.req.header('x-auth-token');
    const incomingDeviceId = c.req.header('x-device-id');

    const { phoneNo } = await c.req.json();

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    if (!incomingToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    if (!incomingDeviceId) {
      return c.json({ error: "Unauthorized: No deviceId provided in headers" }, 401);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const user = await db.collection("userDetails").findOne(
        { _id: phoneNo },
        {
          projection: {
            "UserInfo.email": 1,
            "UserInfo.password": 1,
            "UserInfo.role": 1,
            "PlatformInfo.devices": 1
          }
        }
      );

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === incomingDeviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered device configuration for ${phoneNo} on device ${incomingDeviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      return c.json({
        success: true,
        data: {
          email: user.UserInfo?.email,
          password: user.UserInfo?.password,
          role: user.UserInfo?.role || "user"
        }
      });
    });
  } catch (err) {
    console.error("❌ Error in getDeyeUser:", err.message);
    return c.json({ error: err.message }, 500);
  }
};