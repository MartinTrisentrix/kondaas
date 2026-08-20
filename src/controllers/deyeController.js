import { withDatabase, getSystemKeys } from '../utils/config.js';
import SolarExportCalculator from '../utils/SolarExportCalculator.js';
import { SolarParser } from '../utils/SolarParser.js';
import {
  getInternalDeyeToken,
  fetchDeyeStationInfo,
  fetchDeyeHistory,
  fetchDeyeLatestData
} from '../utils/deyeApi.js';

const DEYE_BASE_URL = "https://india-developer.deyecloud.com";
const MONGODB_URI = process.env.MONGODB_URI;


const getKeys = async (db) => {
  const keys = await getSystemKeys(db);
  return keys.deye || keys.solarman || keys;
};

export const getDeyeStations = async (c) => {
  try {
    const incomingSecurityToken = c.req.header('x-auth-token');
    const incomingDeviceId = c.req.header('x-device-id');
    const { phoneNo } = await c.req.json();

    if (!incomingSecurityToken) return c.json({ error: "Unauthorized: No security token provided" }, 401);
    if (!incomingDeviceId) return c.json({ error: "Unauthorized: No deviceId provided in headers" }, 401);
    if (!phoneNo) return c.json({ error: "phoneNo is required in the request body" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });
      if (!user) return c.json({ error: "User profile not found" }, 404);

      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === incomingDeviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingSecurityToken) {
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      if (!user.UserInfo?.email || !user.UserInfo?.password) {
        return c.json({ error: "Deye credentials missing on profile" }, 404);
      }

      const token = await getInternalDeyeToken(db, user.UserInfo.email, user.UserInfo.password, getKeys);

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

//helper function to fetch Deye station details by stationId
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
 * 6. Historical Data with Multi-Device Auth, Caching & Auto-Inverter SN Lookup
 */
export const getDeyeHistory = async (c) => {
  try {
    const incomingSecurityToken = c.header('x-auth-token') || c.req.header('x-auth-token');
    const incomingDeviceId = c.header('x-device-id') || c.req.header('x-device-id');

    const { stationId, deviceSn, timeType, startTime, endTime, phoneNo } = await c.req.json();

    if (!incomingSecurityToken) return c.json({ error: "Unauthorized: No security token provided" }, 401);
    if (!incomingDeviceId) return c.json({ error: "Unauthorized: No deviceId provided in headers" }, 401);
    if (!phoneNo) return c.json({ error: "phoneNo is required in the request body" }, 400);
    if (!stationId || !timeType) return c.json({ error: "Station ID and TimeType are required!" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      const numStationId = Number(stationId);
      const strStationId = String(stationId);

      // 🛡️ Safe lookup matching either Number or String representation
      const user = await db.collection("userDetails").findOne({
        _id: phoneNo,
        $or: [
          { "devicelist.id": { $in: [numStationId, strStationId] } },
          { "devicelist.stationId": { $in: [numStationId, strStationId] } }
        ]
      });

      if (!user) return c.json({ error: "Unauthorized: Invalid profile or unlinked station" }, 401);

      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === incomingDeviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingSecurityToken) {
        return c.json({ error: "Unauthorized: Invalid security token configuration" }, 401);
      }

      if (!user.UserInfo?.email || !user.UserInfo?.password) {
        return c.json({ error: "Deye credentials missing on profile" }, 404);
      }

      const isDayRequest = Number(timeType) === 1;
      const cacheKey = `history_${timeType}_${startTime}_${endTime}`;

      if (!isDayRequest) {
        const cache = await db.collection("solarSavingsCache").findOne({ _id: strStationId });

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

      // 🔍 Dynamic SN Resolution
      let targetDeviceSn = deviceSn || user.devicelist?.find(
        d => String(d.id) === strStationId || String(d.stationId) === strStationId
      )?.deviceSn;

      if (!targetDeviceSn || targetDeviceSn.trim() === "") {
        const token = await getInternalDeyeToken(db, user.UserInfo.email, user.UserInfo.password, getKeys);
        
        const deviceRes = await fetch(`${DEYE_BASE_URL}/v1.0/station/device`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ stationIds: [numStationId || stationId], page: 1, size: 20 })
        });
        const devData = await deviceRes.json();
        const devices = devData.deviceListItems || devData.deviceList || [];
        const inverter = devices.find(d => d.deviceType === "INVERTER") || devices[0];

        if (inverter?.deviceSn) {
          targetDeviceSn = inverter.deviceSn;
          
          // 🔧 FIXED: Use arrayFilters instead of positional $ operator to avoid Plan executor error
          await db.collection("userDetails").updateOne(
            { _id: phoneNo },
            { $set: { "devicelist.$[elem].deviceSn": inverter.deviceSn } },
            { 
              arrayFilters: [
                { 
                  $or: [
                    { "elem.id": { $in: [numStationId, strStationId] } },
                    { "elem.stationId": { $in: [numStationId, strStationId] } }
                  ]
                }
              ] 
            }
          );
        }
      }

      if (!targetDeviceSn) {
        return c.json({ error: "Device SN (inverter serial number) could not be resolved." }, 400);
      }

      const data = await getDeyeDataCore(db, user, targetDeviceSn, timeType, startTime, endTime);
      const rawItems = data.deviceDataList || data.dataList || [];

      if (isDayRequest) {
        let computedDayUnits = 0;

        try {
          const currentLifetimeTotal = Number(data.generationTotal ?? 0);
          const historyCacheDoc = await db.collection("solarSavingsCache").findOne({ _id: strStationId });
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
        { _id: strStationId },
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
 * 7. Calculate Cumulative & Monthly Solar Savings for Deye Users
 */
export const calculateDeyeUserSavings = async (c) => {
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

      if (!user.UserInfo?.email || !user.UserInfo?.password) {
        return c.json({ error: "Deye credentials missing on profile" }, 404);
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

      // 🕒 Cache check
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

      // Generate Deye Token
      const token = await getInternalDeyeToken(db, user.UserInfo.email, user.UserInfo.password, getKeys);

      // 🔍 SELF-HEALING: Inverter Serial Number Lookup if missing or empty string
      let targetDeviceSn = (targetDevice?.deviceSn && targetDevice.deviceSn.trim() !== "") 
        ? targetDevice.deviceSn 
        : data.deviceSn;

      if (!targetDeviceSn || targetDeviceSn.trim() === "") {
        const deviceRes = await fetch(`${DEYE_BASE_URL}/v1.0/station/device`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ stationIds: [Number(stationId)], page: 1, size: 20 })
        });
        const devData = await deviceRes.json();
        const devices = devData.deviceListItems || devData.deviceList || [];
        const inverter = devices.find(d => d.deviceType === "INVERTER") || devices[0];

        if (inverter?.deviceSn) {
          targetDeviceSn = inverter.deviceSn;
          // Auto-persist deviceSn to MongoDB
          await db.collection("userDetails").updateOne(
            { _id: phoneNo, "devicelist.id": Number(stationId) },
            { $set: { "devicelist.$.deviceSn": inverter.deviceSn } }
          );
        }
      }

      if (!targetDeviceSn) {
        return c.json({ error: "Could not resolve Inverter Serial Number for station." }, 404);
      }

      // Station info & location parsing
      const rawStationData = await fetchDeyeStationInfo(stationId, token, db, getKeys);
      const parsed = SolarParser.parse(rawStationData);

      if (!parsed?.state) {
        return c.json({ error: "Could not detect state" }, 404);
      }

      const stateId = parsed.state.toLowerCase().replace(/\s+/g, '-');
      const tariffTemplate = await db.collection("solarExportSlabs").findOne({ _id: stateId });
      if (!tariffTemplate) {
        return c.json({ error: `Tariff not found for: ${stateId}` }, 404);
      }

      if (user.UserInfo.state !== parsed.state) {
        await db.collection("userDetails").updateOne(
          { _id: phoneNo },
          { $set: { "UserInfo.state": parsed.state } }
        );
      }

      // Fallback timestamp logic if operationalTimestamp is null
      const startTs = targetDevice?.operationalTimestamp
        || rawStationData?.startOperatingTime
        || rawStationData?.createTime
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

        const deyeHistoryRes = await fetchDeyeHistory({
          deviceSn: targetDeviceSn,
          timeType: 3,
          startTime: monthKey,
          endTime: monthKey,
          startAt: monthKey,
          endAt: monthKey,
          token,
          db,
          getKeys
        });

        const historyItems = deyeHistoryRes?.deviceDataList || deyeHistoryRes?.dataList || [];
        const rawUnits = Number(historyItems[0]?.generationValue ?? historyItems[0]?.value ?? 0);
        cumulativeUnits += rawUnits;

        const cost = SolarExportCalculator.calculateMonthlyCredit(rawUnits, tariffTemplate, monthKey);

        monthlyRecords[monthKey] = {
          units: Number(rawUnits.toFixed(2)),
          cost: Number(cost.toFixed(2))
        };

        cumulativeCost += cost;
        cursor.setMonth(cursor.getMonth() + 1);
      }

      // Lifetime units fallback check
      let trueApiLifetimeUnits = 0;
      try {
        const liveMetrics = await fetchDeyeLatestData(targetDeviceSn, token);
        const totalProductionObj = liveMetrics.find(m => m.key === "TotalActiveProduction");

        if (totalProductionObj && totalProductionObj.value !== undefined) {
          trueApiLifetimeUnits = Number(totalProductionObj.value);
        }
      } catch (liveErr) {
        console.error("⚠️ Real-time lifetime unit check skipped:", liveErr.message);
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
    console.error("❌ Deye Savings Calculation Error:", err.message);
    return c.json({ error: err.message }, 500);
  }
};

