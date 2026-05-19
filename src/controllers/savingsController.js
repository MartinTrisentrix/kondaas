import { withDatabase, getSystemKeys } from '../utils/config.js';
import SolarExportCalculator from '../utils/SolarExportCalculator.js';
import { SolarParser } from '../utils/SolarParser.js'; 
import { fetchSolarmanHistory,getInternalSolarmanToken, fetchStationInfo } from '../utils/solarmanApi.js';

const MONGODB_URI = process.env.MONGODB_URI;

export const calculateUserSavings = async (c) => {
  try {
    // ✅ Extract deviceId from request body along with phoneNo and station ID selection
    const { phoneNo, stationId: selectedStationId, deviceId } = await c.req.json(); 
    const incomingToken = c.req.header('x-auth-token');

    if (!phoneNo) return c.json({ error: "Phone number is required" }, 400);
    
    // 🚨 NEW MANDATORY CHECK: Ensure deviceId is present to pinpoint session context
    if (!deviceId) return c.json({ error: "deviceId is required in the request body" }, 400);

    if (!incomingToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 1. Get User Data
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });
      if (!user) return c.json({ error: "User profile not found" }, 404);

      // 🛡️ NEW MULTI-DEVICE SECURITY CHECK: Scan active device tracking array list
      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === deviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered hardware configuration for ${phoneNo} on device ${deviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      if (!user.UserInfo?.email || !user.UserInfo?.password) {
        return c.json({ error: "Solarman credentials missing" }, 404);
      }

      // CHOOSE THE CORRECT STATION DYNAMICALLY
      let targetDevice = null;
      if (selectedStationId) {
        targetDevice = user.devicelist?.find(d => String(d.id) === String(selectedStationId));
      }
      if (!targetDevice) {
        targetDevice = user.devicelist?.[0];
      }

      const stationId = targetDevice?.id;
      if (!stationId) return c.json({ error: "No solar station linked or found match" }, 404);

      // 🕒 LAYER 2 CHECK: Look inside separate cache collection
      const cache = await db.collection("solarSavingsCache").findOne({ _id: String(stationId) });
      
      if (cache && cache.lastCalculatedAt) {
        const lastCachedTime = new Date(cache.lastCalculatedAt);
        const currentTime = new Date();
        
        // Calculate the difference in hours
        const hoursPassed = (currentTime - lastCachedTime) / (1000 * 60 * 60);

        // If it was calculated less than 24 hours ago, return it immediately!
        if (hoursPassed < 24) {
          console.log(`⚡ [Separate Cache Hit] Returning stored DB savings for station ${stationId}`);
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

      // 💥 LAYER 3: CACHE MISS -> DO THE HEAVY WORK
      console.log(`🔄 [Cache Miss/Expired] Fetching fresh calculations from Solarman for station ${stationId}`);

      // 2. Get Token for Solarman
      const token = await getInternalSolarmanToken(
        db,
        user.UserInfo.email,
        user.UserInfo.password, 
        getSystemKeys
      );

      // 3. State Detection
      const rawStationData = await fetchStationInfo(stationId, token, db, getSystemKeys);
      const parsed = SolarParser.parse(rawStationData);
      if (!parsed?.state) {
        return c.json({ error: "Could not detect state" }, 404);
      }

      // 4. Load Tariff
      const stateId = parsed.state.toLowerCase().replace(/\s+/g, '-');
      const tariffTemplate = await db.collection("solarExportSlabs").findOne({ _id: stateId });
      if (!tariffTemplate) {
        return c.json({ error: `Tariff not found for: ${stateId}` }, 404);
      }

      // 5. Sync state to DB if changed
      if (user.UserInfo.state !== parsed.state) {
        await db.collection("userDetails").updateOne(
          { _id: phoneNo },
          { $set: { "UserInfo.state": parsed.state } }
        );
      }

      const startTs = targetDevice?.operationalTimestamp
        || rawStationData?.startOperatingTime  
        || targetDevice?.createdDate;

      if (!startTs) return c.json({ error: "No operational date found" }, 404);

      // 6. Historical Calculation Loop
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

        const solarResponse = await fetchSolarmanHistory({
          stationId,
          timeType: 3,
          startTime: monthKey,
          endTime: monthKey,
          token,
          db,
          getKeys: getSystemKeys
        });

        const units = Number(solarResponse?.stationDataItems?.[0]?.generationValue || 0);
        const cost = SolarExportCalculator.calculateMonthlyCredit(units, tariffTemplate);

        monthlyRecords[monthKey] = {
          units: Number(units.toFixed(2)),
          cost: Number(cost.toFixed(2))
        };

        cumulativeUnits += units;
        cumulativeCost += cost;

        cursor.setMonth(cursor.getMonth() + 1);
      }

      // 💾 SAFE SAVE TO SEPARATE COLLECTION
      const savingsResult = {
        state: parsed.state,
        cumulativeUnits: Number(cumulativeUnits.toFixed(2)),
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
    console.error("❌ Calculation Error:", err.message);
    return c.json({ error: err.message }, 500);
  }
};