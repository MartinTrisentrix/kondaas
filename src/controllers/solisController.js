import { withDatabase, getSystemKeys } from '../utils/config.js';
import SolarExportCalculator from '../utils/SolarExportCalculator.js';
import { SolarParser } from '../utils/SolarParser.js';
import {
  fetchSolisStationList,
  fetchSolisStationDetail,
  fetchSolisInverterList,
  fetchSolisStationHistory,
  fetchSolisStationAll
} from '../utils/solisApi.js';

const MONGODB_URI = process.env.MONGODB_URI;

const getKeys = async (db) => {
  const keys = await getSystemKeys(db);
  return keys.solis || keys;
};


export const getSolisStations = async (c) => {
  try {
    const incomingSecurityToken = c.req.header('x-auth-token');
    const incomingDeviceId = c.req.header('x-device-id');
    
    // Accept email, inverter SN, or stationId from request
    const { phoneNo, email, deviceSn, stationName, stationId } = await c.req.json();

    if (!incomingSecurityToken) return c.json({ error: "Unauthorized" }, 401);
    if (!phoneNo) return c.json({ error: "phoneNo is required" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });
      if (!user) return c.json({ error: "User profile not found" }, 404);

      // 1. Direct single lookup if stationId is already known
      if (stationId) {
        const singlePlant = await fetchSolisStationDetail(String(stationId), db, getKeys);
        return c.json({ success: true, stations: [singlePlant] });
      }

      // 2. Otherwise search the master list
      const solisResponse = await fetchSolisStationList(db, getKeys, 1, 100);
      const allStations = solisResponse.data?.page?.records || solisResponse.data?.records || [];

      const searchEmail = (email || user.UserInfo?.email || "").toLowerCase().trim();
      const searchSn = (deviceSn || "").toLowerCase().trim();
      const searchName = (stationName || "").toLowerCase().trim();

      // Flexible matching cascade
      const matchedStations = allStations.filter(station => {
        const matchEmail = searchEmail && station.userEmail && station.userEmail.toLowerCase().trim() === searchEmail;
        const matchSn = searchSn && station.sno && station.sno.toLowerCase().trim() === searchSn;
        const matchName = searchName && station.stationName && station.stationName.toLowerCase().trim().includes(searchName);

        return matchEmail || matchSn || matchName;
      });

      if (matchedStations.length === 0) {
        return c.json({
          message: "No Solis plant matched. Please provide your Inverter Serial Number or registered Plant Name.",
          stations: []
        });
      }

      // 🛡️ Save matched station preserving string IDs to prevent 64-bit float truncation
      const formattedDeviceList = matchedStations.map(station => ({
        id: String(station.id),
        name: station.stationName,
        deviceSn: station.sno || "",
        stationId: String(station.id),
        capacityKw: Number(station.capacity || 0),
        state: station.regionStr || "",
        operationalTimestamp: station.createDate ? Math.floor(station.createDate / 1000) : null
      }));

      await db.collection("userDetails").updateOne(
        { _id: phoneNo },
        { 
          $set: { 
            devicelist: formattedDeviceList,
            "UserInfo.state": matchedStations[0].regionStr || user.UserInfo?.state
          } 
        }
      );

      return c.json({
        success: true,
        stations: matchedStations
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

/**
 * 2. Pure Core Helper Function for Solis API Calls (Bypasses Hono Context)
 */
export const getSolisDataCore = async (db, user, stationId, timeType, startTime, endTime) => {
  try {
    const stringStationId = String(stationId);

    const response = await fetchSolisStationHistory({
      stationId: stringStationId,
      timeType: Number(timeType),
      startTime,
      endTime,
      db,
      getKeys
    });

    if (!response) {
      throw new Error("No response received from Solis Cloud API");
    }

    // 🛡️ Flexible validation: Solis considers '0', 0, or success: true as OK
    const isSuccess = response.success === true || response.code === "0" || response.code === 0;

    if (!isSuccess) {
      throw new Error(response.msg || response.message || "Solis External API Request Failed");
    }

    return response;
  } catch (error) {
    console.error("❌ Error in getSolisDataCore helper:", error.message);
    throw error;
  }
};


/**
 * Normalizes input date to local calendar format expected by Solis API
 */
/**
 * Normalizes input date to local calendar format (IST/Local aware)
 */
const formatSolisDate = (rawDate, timeType) => {
  let d;
  if (!rawDate) {
    d = new Date();
  } else if (typeof rawDate === 'number' || !isNaN(Number(rawDate))) {
    const num = Number(rawDate);
    d = new Date(num > 1e11 ? num : num * 1000);
  } else if (typeof rawDate === 'string' && rawDate.length === 10 && rawDate.includes('-')) {
    const parts = rawDate.split('-');
    const numType = Number(timeType);
    if (numType === 1) return rawDate;
    if (numType === 2 || numType === 3) return `${parts[0]}-${parts[1]}`;
    return parts[0];
  } else {
    d = new Date(rawDate);
  }

  if (isNaN(d.getTime())) {
    d = new Date();
  }

  // Use local date values to prevent UTC rollback
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  const numType = Number(timeType);
  if (numType === 1) return `${yyyy}-${mm}-${dd}`;
  if (numType === 2 || numType === 3) return `${yyyy}-${mm}`;
  return `${yyyy}`;
};

export const getSolisHistory = async (c) => {
  try {
    const incomingSecurityToken = c.header('x-auth-token') || c.req.header('x-auth-token');
    const incomingDeviceId = c.header('x-device-id') || c.req.header('x-device-id');

    const { stationId, timeType, startTime, endTime, phoneNo } = await c.req.json();

    if (!incomingSecurityToken) return c.json({ error: "Unauthorized: No security token provided" }, 401);
    if (!incomingDeviceId) return c.json({ error: "Unauthorized: No deviceId provided in headers" }, 401);
    if (!phoneNo) return c.json({ error: "phoneNo is required in the request body" }, 400);
    if (!stationId || !timeType) return c.json({ error: "Station ID and TimeType are required!" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      const stringStationId = String(stationId);

      const user = await db.collection("userDetails").findOne({
        _id: phoneNo,
        $or: [
          { "devicelist.stationId": stringStationId },
          { "devicelist.stationId": stationId },
          { "devicelist.id": stringStationId },
          { "devicelist.id": stationId }
        ]
      });

      if (!user) return c.json({ error: "Unauthorized: Invalid profile or unlinked station" }, 401);

      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === incomingDeviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingSecurityToken) {
        return c.json({ error: "Unauthorized: Invalid security token configuration" }, 401);
      }

      const formattedStartTime = formatSolisDate(startTime, timeType);
      const isDayRequest = Number(timeType) === 1;
      const cacheKey = `history_${timeType}_${formattedStartTime}`;

      // Cache validation
      if (!isDayRequest) {
        const cache = await db.collection("solarSavingsCache").findOne({ _id: stringStationId });

        if (cache && cache.historyCache?.[cacheKey]) {
          const storedChart = cache.historyCache[cacheKey];
          const lastCachedTime = new Date(storedChart.lastCalculatedAt);
          const currentTime = new Date();

          const hoursPassed = (currentTime - lastCachedTime) / (1000 * 60 * 60);

          if (hoursPassed < 24 && Array.isArray(storedChart.data) && storedChart.data.length > 0) {
            return c.json({
              success: true,
              fromCache: true,
              data: storedChart.data
            });
          }
        }
      }

      const historyRes = await getSolisDataCore(db, user, stringStationId, timeType, formattedStartTime, endTime);

      // Unwrap array if nested inside data or data.records
      let rawItems = [];
      if (Array.isArray(historyRes?.data)) {
        rawItems = historyRes.data;
      } else if (Array.isArray(historyRes?.data?.records)) {
        rawItems = historyRes.data.records;
      } else if (historyRes?.data) {
        rawItems = historyRes.data;
      }

      if (isDayRequest) {
        return c.json({
          success: true,
          fromCache: false,
          data: rawItems
        });
      }

      if (Array.isArray(rawItems) && rawItems.length > 0) {
        const chartDataToCache = {
          data: rawItems,
          lastCalculatedAt: new Date().toISOString()
        };

        await db.collection("solarSavingsCache").updateOne(
          { _id: stringStationId },
          {
            $set: {
              [`historyCache.${cacheKey}`]: chartDataToCache
            }
          },
          { upsert: true }
        );
      }

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


export const calculateSolisUserSavings = async (c) => {
  try {
    const incomingToken = c.req.header('x-auth-token');
    const headerDeviceId = c.req.header('x-device-id');

    const data = await c.req.json();
    const phoneNo = data.phoneNo;
    const selectedStationId = data.stationId;
    const deviceId = headerDeviceId || data.deviceId;

    if (!phoneNo) return c.json({ error: "Phone number is required" }, 400);
    if (!incomingToken) return c.json({ error: "Unauthorized: No security token provided" }, 401);
    if (!deviceId) return c.json({ error: "Unauthorized: No deviceId provided in headers or body" }, 401);

    return await withDatabase(MONGODB_URI, async (db) => {
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });
      if (!user) return c.json({ error: "User profile not found" }, 404);

      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === deviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingToken) {
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      let targetDevice = null;
      if (selectedStationId) {
        const stringSelectedId = String(selectedStationId);
        targetDevice = user.devicelist?.find(
          d => String(d.id) === stringSelectedId || String(d.stationId) === stringSelectedId
        );
      }
      if (!targetDevice) {
        targetDevice = user.devicelist?.find(d => d.isLastLoggedIn === true) || user.devicelist?.[0];
      }

      const rawStationId = targetDevice?.stationId || targetDevice?.id;
      if (!rawStationId) return c.json({ error: "No solar station linked or found match" }, 404);
      
      const stringStationId = String(rawStationId);

      // 🕒 24-Hour Cache Check (Only if monthlyRecords has data)
      const cache = await db.collection("solarSavingsCache").findOne({ _id: stringStationId });
      if (cache && cache.lastCalculatedAt && cache.monthlyRecords && Object.keys(cache.monthlyRecords).length > 0) {
        const lastCachedTime = new Date(cache.lastCalculatedAt);
        const currentTime = new Date();
        const hoursPassed = (currentTime - lastCachedTime) / (1000 * 60 * 60);

        if (hoursPassed < 24) {
          return c.json({
            success: true,
            fromCache: true,
            data: {
              stationId: stringStationId,
              state: cache.state,
              cumulativeUnits: cache.cumulativeUnits,
              cumulativeCost: cache.cumulativeCost,
              monthlyRecords: cache.monthlyRecords
            }
          });
        }
      }

      // Station info & Location Parsing
      const rawStationData = await fetchSolisStationDetail(stringStationId, db, getKeys);
      const parsed = SolarParser.parse(rawStationData);

      if (!parsed?.state) {
        return c.json({ error: "Could not detect state" }, 404);
      }

      const stateId = parsed.state.toLowerCase().replace(/\s+/g, '-');
      const tariffTemplate = await db.collection("solarExportSlabs").findOne({ _id: stateId });
      if (!tariffTemplate) {
        return c.json({ error: `Tariff not found for: ${stateId}` }, 404);
      }

      if (user.UserInfo?.state !== parsed.state) {
        await db.collection("userDetails").updateOne(
          { _id: phoneNo },
          { $set: { "UserInfo.state": parsed.state } }
        );
      }

      // Auto-inverter SN lookup if missing
      if (!targetDevice?.deviceSn || targetDevice.deviceSn.trim() === "") {
        try {
          const inverters = await fetchSolisInverterList(stringStationId, db, getKeys);
          if (inverters.length > 0 && inverters[0].sn) {
            await db.collection("userDetails").updateOne(
              { 
                _id: phoneNo, 
                $or: [
                  { "devicelist.stationId": stringStationId },
                  { "devicelist.stationId": rawStationId },
                  { "devicelist.id": stringStationId },
                  { "devicelist.id": rawStationId }
                ]
              },
              { $set: { "devicelist.$.deviceSn": inverters[0].sn } }
            );
          }
        } catch (snErr) {
          console.warn("⚠️ Solis inverter SN auto-fetch skipped:", snErr.message);
        }
      }

      // Operational date resolution
      const startTs = targetDevice?.operationalTimestamp
        || rawStationData?.createDate
        || rawStationData?.operTimestamp
        || targetDevice?.createdDate
        || Math.floor(Date.now() / 1000);

      const startDate = new Date(startTs * 1000);
      const now = new Date();
      const monthlyRecords = {};
      let cumulativeUnits = 0;
      let cumulativeCost = 0;

      // Start from operational month
      let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

      while (cursor <= now) {
        const year = cursor.getFullYear();
        const month = String(cursor.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;

        // Fetch monthly history from Solis (timeType = 3)
        const monthRes = await getSolisDataCore(db, user, stringStationId, 3, monthKey, monthKey);

        // 🔍 Robust item unwrapping
        let rawList = [];
        if (Array.isArray(monthRes?.data)) {
          rawList = monthRes.data;
        } else if (Array.isArray(monthRes?.data?.records)) {
          rawList = monthRes.data.records;
        } else if (Array.isArray(monthRes)) {
          rawList = monthRes;
        }

        let rawUnits = 0;
        if (rawList.length > 0) {
          rawUnits = rawList.reduce((acc, item) => {
            const val = Number(item.energy ?? item.energyPrc ?? item.eToday ?? item.value ?? item.power ?? 0);
            return acc + (isNaN(val) ? 0 : val);
          }, 0);
        } else if (monthRes?.data?.monthEnergy !== undefined) {
          // If Solis returned single summary object with monthEnergy
          rawUnits = Number(monthRes.data.monthEnergy || 0);
        }

        cumulativeUnits += rawUnits;

        const cost = SolarExportCalculator.calculateMonthlyCredit(rawUnits, tariffTemplate, monthKey);

        monthlyRecords[monthKey] = {
          units: Number(rawUnits.toFixed(2)),
          cost: Number(cost.toFixed(2))
        };

        cumulativeCost += cost;
        cursor.setMonth(cursor.getMonth() + 1);
      }

      // Lifetime Odometer benchmark via /v1/api/stationAll
      let trueApiLifetimeUnits = 0;
      try {
        const stationAllRes = await fetchSolisStationAll(stringStationId, db, getKeys);
        if (stationAllRes?.data?.allEnergy !== undefined) {
          trueApiLifetimeUnits = Number(stationAllRes.data.allEnergy);
        }
      } catch (allErr) {
        console.warn("⚠️ Solis allEnergy odometer check skipped:", allErr.message);
      }

      const finalCumulativeUnits = (trueApiLifetimeUnits > cumulativeUnits)
        ? trueApiLifetimeUnits
        : cumulativeUnits;

      const savingsResult = {
        state: stateId,
        cumulativeUnits: Number(finalCumulativeUnits.toFixed(2)),
        cumulativeCost: Number(cumulativeCost.toFixed(2)),
        monthlyRecords,
        lastCalculatedAt: new Date().toISOString()
      };

      await db.collection("solarSavingsCache").updateOne(
        { _id: stringStationId },
        {
          $set: {
            state: savingsResult.state,
            cumulativeUnits: savingsResult.cumulativeUnits,
            cumulativeCost: savingsResult.cumulativeCost,
            monthlyRecords: savingsResult.monthlyRecords,
            lastCalculatedAt: savingsResult.lastCalculatedAt
          }
        },
        { upsert: true }
      );

      return c.json({
        success: true,
        fromCache: false,
        data: {
          stationId: stringStationId,
          ...savingsResult
        }
      });
    });
  } catch (err) {
    console.error("❌ Solis Savings Calculation Error:", err.message);
    return c.json({ error: err.message }, 500);
  }
};