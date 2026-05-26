// src/controllers/queueEngine.js
import { withDatabase } from '../utils/config.js';
import { getSolarmanDataCore } from './solarmanController.js'; 
import admin from 'firebase-admin';

// 🚀 Helper function to send notifications for cascading leads
const sendLeadFCMNotification = async (deviceToken, customerName, leadId, kilovolt, address) => {
  try {
    if (!deviceToken) return false;

    const kvInfo = kilovolt ? ` [${kilovolt}]` : "";
    const addrInfo = address ? ` at ${address}` : "";
    const statusBody = `Customer: ${customerName || "New"}${kvInfo}${addrInfo}. Tap to accept.`;
    const statusTitle = "New Lead Assigned!";

    const response = await admin.messaging().send({
      token: deviceToken.trim(),
      android: {
        priority: "high",
        notification: {
          title: statusTitle,
          body: statusBody,
          sound: "kondaas",
          channelId: "custom_sound_channel_v2",
          clickAction: "LEAD_NOTIFICATION_ACTION",
        }
      },
      data: {
        type: "new_order",
        title: statusTitle,
        body: statusBody,
        customerName: String(customerName || "New Customer"),
        leadId: leadId ? leadId.toString() : "",
        kilovolt: kilovolt ? String(kilovolt) : "",
        address: address || "",
        show_actions: "true"
      }
    });

    console.log("🚀 FCM Server Accepted Lead Message ID:", response);
    return true;
  } catch (err) {
    console.error("❌ Firebase Admin SDK Lead Exception:", err.message);
    return false;
  }
};

export const startQueueRunner = () => {
  console.log("⏳ Mongo Queue Runner Started (30-Second Dynamic Mode)...");

  setInterval(async () => {
    try {
      const now = new Date();
      const mongoUri = process.env.MONGODB_URI;

      if (!mongoUri) return;

      await withDatabase(mongoUri, async (db) => {
        
        // 🔍 MULTI-TASK LOOKUP: Find any pending task that is ready to run right now
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

          case "SURVEYOR_CASCADING_DISPATCH":
            await handleCascadingDispatchJob(db, job);
            break;

          default:
            console.log(`⚠️ Unknown task type encountered: ${job.taskType}`);
            await db.collection("jobs_queue").updateOne(
              { _id: job._id },
              { $set: { status: "failed", reason: "Unknown task type" } }
            );
        }
      });

    } catch (error) {
      console.error("❌ Error in Master Queue Runner loop:", error);
    }
  }, 30000);
};

const handleCascadingDispatchJob = async (db, job) => {
  const { leadId, surveyorsList, currentIndex } = job;

  try {
    // 1. Fetch current live status of this lead
    const lead = await db.collection("lead").findOne({ _id: leadId });
    
    // 2. Short-circuit: If the lead doesn't exist or has already been accepted, kill this ticket chain
    if (!lead || lead.status === "accepted") {
      console.log(`🎯 Lead ${leadId} was already accepted or completed. Ending cascade chain.`);
      await db.collection("jobs_queue").updateOne(
        { _id: job._id },
        { $set: { status: "completed", completedAt: new Date() } }
      );
      return;
    }

    // 3. Out-of-bounds check: If we've exhausted our entire list of local surveyors
    if (currentIndex >= surveyorsList.length) {
      console.log(`❌ All surveyors exhausted for Lead ${leadId}. None accepted.`);
      await db.collection("jobs_queue").updateOne(
        { _id: job._id },
        { $set: { status: "failed", reason: "All active surveyors timed out or rejected.", updatedAt: new Date() } }
      );
      return;
    }

    // 4. Extract target worker information from the sorted array
    const targetSurveyor = surveyorsList[currentIndex];
    console.log(`🔍 Attempting assignment to Surveyor #${currentIndex + 1}: ${targetSurveyor.phoneNo} (${targetSurveyor.distance.toFixed(2)} km away)`);

    // 5. Look up their FCM device token inside userDetails Safely
    const workerProfile = await db.collection("userDetails").findOne({ _id: targetSurveyor.phoneNo });
    
    let tokenSent = false;
    // 🔑 ALIGNED: Applied the exact safe device fallback validation to eliminate surveyor leaks
    if (workerProfile && workerProfile.PlatformInfo && Array.isArray(workerProfile.PlatformInfo.devices)) {
      const devices = workerProfile.PlatformInfo.devices;
      const activeDevice = devices.find(d => d.isLastLoggedIn === true && d.fcmToken);
      const fallbackDevice = !activeDevice ? devices.find(d => d.fcmToken) : null;
      
      const targetDevice = activeDevice || fallbackDevice;
      const fcmToken = targetDevice ? targetDevice.fcmToken : null;

      if (fcmToken && fcmToken.trim().length > 0) {
        tokenSent = await sendLeadFCMNotification(
          fcmToken.trim(),
          lead.name,
          leadId,
          lead.kilovolt,
          lead.address
        );
      }
    }

    if (tokenSent) {
      console.log(`⚡ Dispatch notification pushed out successfully to ${targetSurveyor.phoneNo}`);
    } else {
      console.log(`⚠️ Could not transmit notification directly to phone (missing token/profile for ${targetSurveyor.phoneNo}).`);
    }

    // 6. Schedule next countdown window (Now + 30 Seconds)
    const nextTickTime = new Date();
    nextTickTime.setSeconds(nextTickTime.getSeconds() + 30);

    await db.collection("jobs_queue").updateOne(
      { _id: job._id },
      {
        $set: {
          currentIndex: currentIndex + 1,
          runAt: nextTickTime,              
          status: "pending",               
          lockedAt: null
        }
      }
    );
    console.log(`⏰ Next countdown heartbeat set for: ${nextTickTime.toLocaleTimeString()}`);

  } catch (err) {
    console.error(`❌ Critical failure inside handleCascadingDispatchJob for task ${job._id}:`, err.message);
    await db.collection("jobs_queue").updateOne(
      { _id: job._id },
      { $set: { status: "pending", lockedAt: null } }
    );
  }
};

const sendWeeklySummaryNotification = async (deviceToken, totalUnits, summaryBody) => {
  try {
    if (!deviceToken) return false;

    const statusTitle = "☀️ Your Weekly Solar Report is Ready!";

    const response = await admin.messaging().send({
      token: deviceToken.trim(),
      notification: {
        title: statusTitle,
        body: summaryBody,
      },
      android: {
        priority: "high",
        notification: {
          sound: "kondaas",
          channelId: "custom_sound_channel_v2",
          clickAction: "WEEKLY_SUMMARY_NOTIFICATION_ACTION",
        }
      },
      data: {
        type: "weekly_summary",
        title: statusTitle,
        body: summaryBody,
        totalUnits: String(totalUnits),
        show_actions: "false"
      }
    });

    console.log("🚀 FCM Server Accepted Summary Message ID:", response);
    return true;
  } catch (err) {
    // 🔑 CHANGED HERE: Log the entire error structure to uncover hidden messages
    console.error("❌ Firebase Admin SDK Summary Exception Details:", JSON.stringify(err, null, 2) || err);
    return false;
  }
};

const processAllCustomersWeeklyJobs = async (db, masterJob) => {
  try {
    const users = await db.collection("userDetails").find({ "devicelist.0": { $exists: true } }).toArray();
    console.log(`📋 Found ${users.length} users in local userDetails collection.`);

    const today = new Date();
    const currentDay = today.getDay();
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    
    const monday = new Date(today);
    monday.setDate(today.getDate() + distanceToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const startTime = monday.toISOString().split('T')[0]; 
    const endTime = sunday.toISOString().split('T')[0];

    for (const user of users) {
      const phoneNo = user._id;
      const stations = user.devicelist || [];
      
      // 📱 STEP 1: SAFE DEVICE IDENTIFICATION & FILTERING
      let fcmToken = null;
      if (user.PlatformInfo && Array.isArray(user.PlatformInfo.devices)) {
        const devices = user.PlatformInfo.devices;
        const activeDevice = devices.find(d => d.isLastLoggedIn === true && d.fcmToken);
        const fallbackDevice = !activeDevice ? devices.find(d => d.fcmToken) : null;
        
        const targetDevice = activeDevice || fallbackDevice;
        fcmToken = targetDevice ? targetDevice.fcmToken : null;
      }

      let totalUserWeeklyUnits = 0;
      let processedStationsCount = 0;
      let stationBreakdownText = ""; 

      console.log(`👤 Processing user ${phoneNo} with ${stations.length} connected station(s)...`);

      for (const station of stations) {
        const stationId = station.id;
        const stationCustomName = station.name || `Station ${stationId}`;
        if (!stationId) continue;

        try {
          console.log(`   📊 Fetching solar data for Station ID: ${stationId}`);
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
          console.error(`   ⚠️ Failed to fetch data for Station ${stationId}:`, stationError.message);
        }
      }

      // 🚀 STEP 2: TRANSMIT WEEKLY REPORT VIA MOBILE PUSH ONLY
      if (processedStationsCount > 0) {
        totalUserWeeklyUnits = Number(totalUserWeeklyUnits.toFixed(2));
        const finalNotificationBody = `Your weekly summary breakdown:\n${stationBreakdownText}Total Generation: ${totalUserWeeklyUnits} Units`;
        
        if (fcmToken && fcmToken.trim().length > 0) {
          console.log(`⚡ Sending FCM push notification to user ${phoneNo}...`);
          await sendWeeklySummaryNotification(fcmToken.trim(), totalUserWeeklyUnits, finalNotificationBody);
        } else {
          console.log(`ℹ️ User ${phoneNo} skipped: No active device found with a valid FCM token.`);
        }
      }
    }

    // ⏱️ STEP 3: TEMPORARY TESTING CLOCK - SET TO 30 SECONDS
    const nextRunTime = new Date();
    nextRunTime.setSeconds(nextRunTime.getSeconds() + 30); 

    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      {
        $set: {
          status: "pending",
          runAt: nextRunTime,
          lockedAt: null,
          lastRunAt: new Date()
        }
      }
    );

    console.log(`✅ Master Loop finished. NEXT TESTING TICK SCHEDULED FOR: ${nextRunTime.toLocaleTimeString()}`);

  } catch (error) {
    console.error("❌ Critical breakdown in Master Loop processing:", error.message);
    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", lockedAt: null } }
    );
  }
};