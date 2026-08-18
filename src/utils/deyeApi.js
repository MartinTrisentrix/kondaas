import axios from 'axios';

// Base URL for Deye Cloud India Developer API
const DEYE_BASE_URL = "https://india-developer.deyecloud.com";

/**
 * Fetch detailed station information from Deye
 */
export const fetchDeyeStationInfo = async (stationId, token, db, getKeys) => {
  try {
    const response = await axios.post(
      `${DEYE_BASE_URL}/v1.0/station/list`,
      { page: 1, size: 100 },
      {
        headers: {
          'Authorization': `bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = response.data;
    if (!data.success) throw new Error(data.msg || "Failed to fetch station list");

    const stations = data.stationList || [];
    const targetStation = stations.find(s => Number(s.id) === Number(stationId));

    if (!targetStation) throw new Error("Station not found in Deye station list");

    return targetStation;
  } catch (error) {
    const errorMsg = error.response?.data?.msg || error.message;
    throw new Error(`Failed to fetch Deye station details: ${errorMsg}`);
  }
};

/**
 * Get Internal Deye Access Token
 * Expects the password already SHA-256 hashed from the mobile client
 */
export const getInternalDeyeToken = async (db, email, password, getKeys) => {
  try {
    const keys = await getKeys(db);
    const deyeKeys = keys.deye || keys.solarman || keys;

    if (!deyeKeys?.appId || !deyeKeys?.appSecret) {
      throw new Error("Deye API Keys (appId/appSecret) missing in database configuration.");
    }

    const { appId, appSecret } = deyeKeys;

    const response = await axios.post(
      `${DEYE_BASE_URL}/v1.0/account/token?appId=${appId}`,
      {
        appSecret,
        email,
        password
      },
      {
        headers: { "Content-Type": "application/json" }
      }
    );

    const data = response.data;

    if (data && (data.accessToken || data.access_token)) {
      return data.accessToken || data.access_token;
    } else {
      throw new Error(data.msg || "Authentication failed with Deye Cloud.");
    }
  } catch (error) {
    const errorMsg = error.response?.data?.msg || error.message;
    console.error("❌ Deye Auth Utility Error:", errorMsg);
    throw new Error(`Deye Auth Failed: ${errorMsg}`);
  }
};

/**
 * Fetch Historical / Metric Data from Deye via /v1.0/device/history
 */
export const fetchDeyeHistory = async ({ deviceSn, timeType, startTime, endTime, token, db, getKeys }) => {
  try {
    const granularity = Number(timeType); // 1: Day, 2: Days/Month, 3: Months/Year, 4: Years

    const payload = {
      deviceSn,
      granularity,
      startAt: startTime,
      endAt: endTime
    };

    if (granularity === 1) {
      payload.measurePoints = ["TotalActiveACOutputPower", "DailyActiveProduction"];
    }

    const response = await axios.post(
      `${DEYE_BASE_URL}/v1.0/device/history`,
      payload,
      {
        headers: {
          'Authorization': `bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    const errorMsg = error.response?.data?.msg || error.message;
    console.error("❌ Deye History Utility Error:", errorMsg);
    throw new Error(`Failed to fetch Deye history: ${errorMsg}`);
  }
};