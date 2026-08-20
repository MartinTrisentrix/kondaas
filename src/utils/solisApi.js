import crypto from 'crypto';
import axios from 'axios';

const SOLIS_BASE_URL = "https://www.soliscloud.com:13333";

/**
 * Generates SolisCloud HMAC-SHA1 headers and executes signed POST request
 */
export const postSolisApi = async (endpoint, body = {}, db, getKeys) => {
  try {
    const keys = await getKeys(db);
    const solisKeys = keys.solis || keys;

    if (!solisKeys?.keyId || !solisKeys?.keySecret) {
      throw new Error("Solis API Keys (keyId/keySecret) missing in database configuration.");
    }

    const { keyId, keySecret } = solisKeys;
    const bodyStr = JSON.stringify(body);

    // 1. Content-MD5 (Base64 encoded MD5 of body)
    const contentMd5 = crypto.createHash('md5').update(bodyStr, 'utf8').digest('base64');

    // 2. GMT Date String
    const gmtDate = new Date().toUTCString();

    // 3. String to sign: POST\n<Content-MD5>\napplication/json\n<Date>\n<Endpoint>
    const stringToSign = `POST\n${contentMd5}\napplication/json\n${gmtDate}\n${endpoint}`;

    // 4. HMAC-SHA1 signature
    const signature = crypto.createHmac('sha1', keySecret).update(stringToSign, 'utf8').digest('base64');

    // 5. Authorization header: "API <keyId>:<signature>"
    const authorization = `API ${keyId}:${signature}`;

    const response = await axios.post(`${SOLIS_BASE_URL}${endpoint}`, body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-MD5': contentMd5,
        'Date': gmtDate,
        'Authorization': authorization
      }
    });

    const data = response.data;
    if (data.code !== "0" && data.code !== 0 && !data.success) {
      throw new Error(data.msg || data.message || "Solis API Request Failed");
    }

    return data;
  } catch (error) {
    const errorMsg = error.response?.data?.msg || error.response?.data?.message || error.message;
    console.error(`❌ Solis API Error [${endpoint}]:`, errorMsg);
    throw new Error(`Solis API Error: ${errorMsg}`);
  }
};

/**
 * Fetch station list for user
 */
export const fetchSolisStationList = async (db, getKeys, pageNo = 1, pageSize = 20) => {
  return await postSolisApi('/v1/api/userStationList', { pageNo, pageSize }, db, getKeys);
};

/**
 * Fetch detailed station info
 */
export const fetchSolisStationDetail = async (stationId, db, getKeys) => {
  const res = await postSolisApi('/v1/api/stationDetail', { id: String(stationId) }, db, getKeys);
  return res.data;
};

/**
 * Fetch inverters associated with a station
 */
export const fetchSolisInverterList = async (stationId, db, getKeys, pageNo = 1, pageSize = 20) => {
  const res = await postSolisApi('/v1/api/inverterList', { stationId: String(stationId), pageNo, pageSize }, db, getKeys);
  return res.data?.page?.records || res.data?.records || [];
};

/**
 * Fetch Day/Month/Year Station Generation History
  */

/**
 * Fetch Day/Month/Year Station Generation History
 */
/**
 * Fetch Day/Month/Year Station Generation History from SolisCloud
 */
export const fetchSolisStationHistory = async ({ stationId, timeType, startTime, db, getKeys }) => {
  const numTimeType = Number(timeType);
  const cleanStationId = String(stationId);

  let endpoint = '';
  let payload = {};

  // 1 = Day (/v1/api/stationDay) -> Requires "YYYY-MM-DD" & timeZone
  if (numTimeType === 1) {
    endpoint = '/v1/api/stationDay';
    payload = {
      id: cleanStationId,
      money: "INR",
      time: startTime,
      timeZone: 5.5
    };
  } 
  // 2 or 3 = Month (/v1/api/stationMonth) -> Requires "YYYY-MM"
  else if (numTimeType === 2 || numTimeType === 3) {
    endpoint = '/v1/api/stationMonth';
    payload = {
      id: cleanStationId,
      money: "INR",
      month: startTime
    };
  } 
  // 4 or Default = Year (/v1/api/stationYear) -> Requires "YYYY"
  else {
    endpoint = '/v1/api/stationYear';
    payload = {
      id: cleanStationId,
      money: "INR",
      year: startTime
    };
  }

  return await postSolisApi(endpoint, payload, db, getKeys);
};
/**
 * Fetch All-time cumulative generation details
 */
export const fetchSolisStationAll = async (stationId, db, getKeys) => {
  return await postSolisApi('/v1/api/stationAll', {
    id: String(stationId),
    money: "INR"
  }, db, getKeys);
};