// src/controllers/queueEngine.js
import { withDatabase } from '../utils/config.js';
import { getSolarmanDataCore } from './solarmanController.js'; 
import admin from 'firebase-admin';

// 🌐 Global Production Database Configuration Connection Key
const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Returns current Date components evaluated specifically in India Time (Asia/Kolkata)
 */
const getIndiaDateParts = (date = new Date()) => {
  const options = { timeZone: 'Asia/Kolkata', hour12: false };
  const formatter = new Intl.DateTimeFormat('en-US', {
    ...options,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });

  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10) - 1, // 0-indexed
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10)
  };
};

/**
 * Helper to build an absolute UTC Date instance corresponding to target IST parameters
 */
const createISTDate = (year, month, day, hours = 20, minutes = 0, seconds = 0) => {
  // IST is UTC + 5 hours 30 minutes
  const pad = (num) => String(num).padStart(2, '0');
  const monthStr = pad(month + 1);
  const dayStr = pad(day);
  const hourStr = pad(hours);
  const minStr = pad(minutes);
  const secStr = pad(seconds);

  // ISO string forced to +05:30 timezone
  return new Date(`${year}-${monthStr}-${dayStr}T${hourStr}:${minStr}:${secStr}+05:30`);
};

const getNextSunday8PM = () => {
  const now = new Date();
  const india = getIndiaDateParts(now);

  // Determine current day of week in India (0 = Sunday, 1 = Monday, etc.)
  const indiaDateObj = new Date(Date.UTC(india.year, india.month, india.day));
  const currentDay = indiaDateObj.getUTCDay();
  
  let daysUntilSunday = (7 - currentDay) % 7;
  
  let targetYear = india.year;
  let targetMonth = india.month;
  let targetDay = india.day + daysUntilSunday;

  let targetISTDate = createISTDate(targetYear, targetMonth, targetDay, 20, 0, 0);

  // If today is Sunday and past 8:00 PM IST, move to next week's Sunday
  if (targetISTDate <= now) {
    targetISTDate = createISTDate(targetYear, targetMonth, targetDay + 7, 20, 0, 0);
  }

  return targetISTDate;
};

const getNextMonthEnd8PM = () => {
  const now = new Date();
  const india = getIndiaDateParts(now);

  // Get last day of current month in IST
  const lastDayOfCurrentMonth = new Date(Date.UTC(india.year, india.month + 1, 0)).getUTCDate();
  let currentMonthEnd = createISTDate(india.year, india.month, lastDayOfCurrentMonth, 20, 0, 0);

  // If already past 8:00 PM IST on the last day of this month, target next month's end
  if (currentMonthEnd <= now) {
    const lastDayOfNextMonth = new Date(Date.UTC(india.year, india.month + 2, 0)).getUTCDate();
    currentMonthEnd = createISTDate(india.year, india.month + 1, lastDayOfNextMonth, 20, 0, 0);
  }

  return currentMonthEnd;
};

export const startQueueRunner = () => {
  console.log("⏳ Mongo Queue Runner Started (Production Calendar Schedule Engine)...");

  setInterval(async () => {
    try {
      const now = new Date();

      if (!MONGODB_URI) {
        console.error("⚠️ Master Queue Runner: MONGODB_URI configuration string is completely missing.");
        return;
      }

      // 🔐 Standardized connection lifecycle execution abstraction wrapper
      await withDatabase(MONGODB_URI, async (db) => {
        
        // 🔍 Find pending solar report summaries ready to run right now
        const job = await db.collection("jobs_queue").findOneAndUpdate(
          {
            status: "pending",
            runAt: { $lte: now }
          },
          {
            $set: { status: "processing", lockedAt: now }
          },
          {
            returnDocument: "after"
          }
        );

        if (!job) return; 

        console.log(`🚀 Found active task to run: [${job.taskType}] (ID: ${job._id})`);

        // 🔀 TASK ROUTER
        switch (job.taskType) {
          case "WEEKLY_MASTER_SOLAR_SUMMARY":
            await processAllCustomersWeeklyJobs(db, job);
            break;

          case "MONTHLY_MASTER_SOLAR_SUMMARY": 
            await processAllCustomersMonthlyJobs(db, job);
            break;

          default:
            console.log(`⚠️ Unknown or retired task type encountered: ${job.taskType}`);
            await db.collection("jobs_queue").updateOne(
              { _id: job._id },
              { $set: { status: "failed", reason: "Unknown or retired task type" } }
            );
        }
      });

    } catch (error) {
      console.error("❌ Error in Master Queue Runner loop:", error.message);
    }
  }, 30000); // Polls database state safely every 30 seconds
};

export const processAllCustomersWeeklyJobs = async (db, masterJob) => {
  try {
    const users = await db.collection("userDetails").find({ 
      "UserInfo.role": "user",
      "PlatformInfo.devices.0": { $exists: true } 
    }).toArray();
    
    console.log(`📋 Found ${users.length} customer users with registered devices for Weekly Report.`);

    const now = new Date();
    const india = getIndiaDateParts(now);

    const indiaDateObj = new Date(Date.UTC(india.year, india.month, india.day));
    const currentDay = indiaDateObj.getUTCDay();
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;

    const mondayDate = new Date(Date.UTC(india.year, india.month, india.day + distanceToMonday));
    const sundayDate = new Date(Date.UTC(mondayDate.getUTCFullYear(), mondayDate.getUTCMonth(), mondayDate.getUTCDate() + 6));

    const startTime = mondayDate.toISOString().split('T')[0]; 
    const endTime = sundayDate.toISOString().split('T')[0];

    for (const user of users) {
      const phoneNo = user._id;
      const stations = user.devicelist || [];
      
      let tokensToBroadcast = [];
      if (user.PlatformInfo && Array.isArray(user.PlatformInfo.devices)) {
        tokensToBroadcast = user.PlatformInfo.devices
          .map(d => d.fcmToken)
          .filter(token => token && token.trim().length > 0);
      }

      if (tokensToBroadcast.length === 0) continue;

      let totalUserWeeklyUnits = 0;
      let processedStationsCount = 0;
      let stationBreakdownText = ""; 

      for (const station of stations) {
        const stationId = station.id;
        const stationCustomName = station.name || `Station ${stationId}`;
        if (!stationId) continue;

        try {
          const data = await getSolarmanDataCore(db, user, stationId, 2, startTime, endTime);

          let stationUnits = 0;
          if (data && data.stationDataItems && Array.isArray(data.stationDataItems)) {
            data.stationDataItems.forEach(item => {
              if (item.generationValue) {
                stationUnits += Number(item.generationValue);
              }
            });
          }

          totalUserWeeklyUnits += stationUnits;
          processedStationsCount++;
          stationBreakdownText += `• ${stationCustomName}: ${stationUnits.toFixed(2)} Units\n`;

        } catch (stationError) {
          console.error(`   ⚠️ Failed to fetch weekly data for Station ${stationId}:`, stationError.message);
        }
      }

      if (processedStationsCount > 0) {
        totalUserWeeklyUnits = Number(totalUserWeeklyUnits.toFixed(2));
        const statusTitle = "☀️ Your Weekly Solar Report is Ready!";
        const finalNotificationBody = `Your weekly summary breakdown:\n${stationBreakdownText}Total Generation: ${totalUserWeeklyUnits} Units`;
        
        const messagesPayload = tokensToBroadcast.map(token => ({
          token: token.trim(),
          notification: { title: statusTitle, body: finalNotificationBody },
          android: {
            priority: "high",
            notification: {
              channelId: "weekly_summary_channel_v1",
              sound: "default",
              clickAction: "WEEKLY_SUMMARY_NOTIFICATION_ACTION",
            }
          },
          apns: {
            payload: {
              aps: { sound: "default", category: "WEEKLY_SUMMARY_NOTIFICATION_ACTION" }
            }
          },
          data: {
            type: "weekly_summary",
            title: statusTitle,
            body: finalNotificationBody,
            totalUnits: String(totalUserWeeklyUnits),
            show_actions: "false"
          }
        }));

        try {
          const batchResponse = await admin.messaging().sendEach(messagesPayload);
          
          for (let index = 0; index < batchResponse.responses.length; index++) {
            const singleResponse = batchResponse.responses[index];
            if (!singleResponse.success) {
              const errorInstance = singleResponse.error;
              const targetBadToken = tokensToBroadcast[index];

              if (errorInstance.code === 'messaging/registration-token-not-registered') {
                await db.collection("userDetails").updateOne(
                  { _id: phoneNo },
                  { $pull: { "PlatformInfo.devices": { fcmToken: targetBadToken } } }
                );
              }
            }
          }
        } catch (multicastErr) {
          console.error(`❌ Breakdown executing multi-device send operation:`, multicastErr.message);
        }
      }
    }

    // 🎯 CALENDAR UPDATE: Calculate exact upcoming Sunday at 8 PM IST
    const nextRunTime = getNextSunday8PM(); 

    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", runAt: nextRunTime, lockedAt: null, lastRunAt: new Date() } }
    );

    console.log(`✅ Weekly Master Loop finished. RESCHEDULED TARGET: ${nextRunTime.toString()}`);

  } catch (error) {
    console.error("❌ Critical breakdown in Weekly Master Loop processing:", error.message);
    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", lockedAt: null } }
    );
  }
};

export const processAllCustomersMonthlyJobs = async (db, masterJob) => {
  try {
    const users = await db.collection("userDetails").find({ 
      "UserInfo.role": "user",
      "PlatformInfo.devices.0": { $exists: true } 
    }).toArray();
    
    console.log(`📋 Found ${users.length} customer users with registered devices for Monthly Summary.`);

    const now = new Date();
    const india = getIndiaDateParts(now);

    const pad = (num) => String(num).padStart(2, '0');
    const startTime = `${india.year}-${pad(india.month + 1)}-01`; 
    const endTime = `${india.year}-${pad(india.month + 1)}-${pad(india.day)}`;

    for (const user of users) {
      const phoneNo = user._id;
      const stations = user.devicelist || [];
      
      let tokensToBroadcast = [];
      if (user.PlatformInfo && Array.isArray(user.PlatformInfo.devices)) {
        tokensToBroadcast = user.PlatformInfo.devices
          .map(d => d.fcmToken)
          .filter(token => token && token.trim().length > 0);
      }

      if (tokensToBroadcast.length === 0) continue;

      let totalUserMonthlyUnits = 0;
      let processedStationsCount = 0;
      let stationBreakdownText = ""; 

      for (const station of stations) {
        const stationId = station.id;
        const stationCustomName = station.name || `Station ${stationId}`;
        if (!stationId) continue;

        try {
          const data = await getSolarmanDataCore(db, user, stationId, 2, startTime, endTime);

          let stationUnits = 0;
          if (data && data.stationDataItems && Array.isArray(data.stationDataItems)) {
            data.stationDataItems.forEach(item => {
              if (item.generationValue) {
                stationUnits += Number(item.generationValue);
              }
            }); 
          }                     

          totalUserMonthlyUnits += stationUnits;
          processedStationsCount++;
          stationBreakdownText += `• ${stationCustomName}: ${stationUnits.toFixed(2)} Units\n`;

        } catch (stationError) {
          console.error(`   ⚠️ Failed to fetch monthly data for Station ${stationId}:`, stationError.message);
        }
      }

      if (processedStationsCount > 0) {
        totalUserMonthlyUnits = Number(totalUserMonthlyUnits.toFixed(2));
        const statusTitle = "☀️ Your Monthly Solar Summary is Ready!";
        const finalNotificationBody = `Your monthly summary breakdown:\n${stationBreakdownText}Total Generation: ${totalUserMonthlyUnits} Units`;
        
        const messagesPayload = tokensToBroadcast.map(token => ({
          token: token.trim(),
          notification: { title: statusTitle, body: finalNotificationBody },
          android: {
            priority: "high",
            notification: {
              channelId: "monthly_summary_channel_v1",
              sound: "default",
              clickAction: "MONTHLY_SUMMARY_NOTIFICATION_ACTION",
            }
          },
          apns: {
            payload: {
              aps: { sound: "default", category: "MONTHLY_SUMMARY_NOTIFICATION_ACTION" }
            }
          },
          data: {
            type: "monthly_summary",
            title: statusTitle,
            body: finalNotificationBody,
            totalUnits: String(totalUserMonthlyUnits),
            show_actions: "false"
          }
        }));

        try {
          const batchResponse = await admin.messaging().sendEach(messagesPayload);
          
          for (let index = 0; index < batchResponse.responses.length; index++) {
            const singleResponse = batchResponse.responses[index];
            if (!singleResponse.success) {
              const errorInstance = singleResponse.error;
              const targetBadToken = tokensToBroadcast[index];

              if (errorInstance.code === 'messaging/registration-token-not-registered') {
                await db.collection("userDetails").updateOne(
                  { _id: phoneNo },
                  { $pull: { "PlatformInfo.devices": { fcmToken: targetBadToken } } }
                );
              }
            }
          }
        } catch (multicastErr) {
          console.error(`❌ Breakdown executing multi-device monthly operation:`, multicastErr.message);
        }
      }
    }

    // 🎯 CALENDAR UPDATE: Calculate exact month-end date at 8 PM IST
    const nextRunTime = getNextMonthEnd8PM(); 

    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", runAt: nextRunTime, lockedAt: null, lastRunAt: new Date() } }
    );

    console.log(`✅ Monthly Master Loop finished. RESCHEDULED TARGET: ${nextRunTime.toString()}`);

  } catch (error) {
    console.error("❌ Critical breakdown in Monthly Master Loop processing:", error.message);
    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", lockedAt: null } }
    );
  }
};