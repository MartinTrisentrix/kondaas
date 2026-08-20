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
        const singlePlant = await fetchSolisStationDetail(stationId, db, getKeys);
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

      // Save matched station to user's MongoDB record
      const formattedDeviceList = matchedStations.map(station => ({
        id: Number(station.id) || station.id,
        name: station.stationName,
        deviceSn: station.sno || "",
        stationId: station.id,
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
    const data = await fetchSolisStationHistory({
      stationId,
      timeType: Number(timeType),
      startTime,
      endTime,
      db,
      getKeys
    });

    if (data.code !== "0" && data.code !== 0 && !data.success) {
      throw new Error(data.msg || data.message || "Solis External API Request Failed");
    }

    return data;
  } catch (error) {
    console.error("❌ Error in getSolisDataCore helper:", error.message);
    throw error;
  }
};

/**
 * 3. Historical Station Data with Multi-Device Auth & Caching Layer
 */
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
      const user = await db.collection("userDetails").findOne({
        _id: phoneNo,
        "devicelist.id": Number(stationId)
      });

      if (!user) return c.json({ error: "Unauthorized: Invalid profile or unlinked station" }, 401);

      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === incomingDeviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingSecurityToken) {
        return c.json({ error: "Unauthorized: Invalid security token configuration" }, 401);
      }

      const isDayRequest = Number(timeType) === 1;
      const cacheKey = `history_${timeType}_${startTime}_${endTime || startTime}`;

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

      const historyRes = await getSolisDataCore(db, user, stationId, timeType, startTime, endTime);
      const rawItems = historyRes?.data || [];

      if (isDayRequest) {
        return c.json({
          success: true,
          fromCache: false,
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
 * 4. Calculate Cumulative & Monthly Solar Savings for Solis Users
 */
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
        targetDevice = user.devicelist?.find(d => String(d.id) === String(selectedStationId));
      }
      if (!targetDevice) {
        targetDevice = user.devicelist?.find(d => d.isLastLoggedIn === true) || user.devicelist?.[0];
      }

      const stationId = targetDevice?.id;
      if (!stationId) return c.json({ error: "No solar station linked or found match" }, 404);

      // 🕒 24-Hour Cache Check
      const cache = await db.collection("solarSavingsCache").findOne({ _id: String(stationId) });
      if (cache && cache.lastCalculatedAt) {
        const lastCachedTime = new Date(cache.lastCalculatedAt);
        const currentTime = new Date();
        const hoursPassed = (currentTime - lastCachedTime) / (1000 * 60 * 60);

        if (hoursPassed < 24) {
          return c.json({
            success: true,
            fromCache: true,
            data: {
              stationId: Number(stationId),
              state: cache.state,
              cumulativeUnits: cache.cumulativeUnits,
              cumulativeCost: cache.cumulativeCost,
              monthlyRecords: cache.monthlyRecords
            }
          });
        }
      }

      // Station info & Location Parsing
      const rawStationData = await fetchSolisStationDetail(stationId, db, getKeys);
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
          const inverters = await fetchSolisInverterList(stationId, db, getKeys);
          if (inverters.length > 0 && inverters[0].sn) {
            await db.collection("userDetails").updateOne(
              { _id: phoneNo, "devicelist.id": Number(stationId) },
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

      let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

      while (cursor <= now) {
        const year = cursor.getFullYear();
        const month = String(cursor.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;

        const monthRes = await getSolisDataCore(db, user, stationId, 3, monthKey, monthKey);

        const monthData = monthRes?.data || [];
        let rawUnits = 0;
        if (Array.isArray(monthData)) {
          rawUnits = monthData.reduce((acc, item) => acc + Number(item.energy || item.value || 0), 0);
        } else if (typeof monthData === 'object') {
          rawUnits = Number(monthData.energy || monthData.value || 0);
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
        const stationAllRes = await fetchSolisStationAll(stationId, db, getKeys);
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
        state: parsed.state,
        cumulativeUnits: Number(finalCumulativeUnits.toFixed(2)),
        cumulativeCost: Number(cumulativeCost.toFixed(2)),
        monthlyRecords,
        lastCalculatedAt: new Date().toISOString()
      };

      await db.collection("solarSavingsCache").updateOne(
        { _id: String(stationId) },
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
          stationId: Number(stationId),
          ...savingsResult
        }
      });
    });
  } catch (err) {
    console.error("❌ Solis Savings Calculation Error:", err.message);
    return c.json({ error: err.message }, 500);
  }
};