import { MongoClient, Binary, ObjectId } from 'mongodb';

// --- HELPER: Database Connection ---
const withDatabase = async (uri, fn) => {
  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client.connect();
    const db = client.db("Kondaas");
    return await fn(db);
  } finally {
    await client.close(true);
  }
};

// --- THE WORKER: Background WhatsApp Process ---
const processWhatsAppNotification = async (notificationId, c) => {
  const uri = c.env.MONGODB_URI;
  const BASE_URL = c.env.WHATSAPP_API_URL; // Value: https://team.trisentrix.com/message/
  const API_KEY = c.env.WHATSAPP_API_KEY;

  try {
    await withDatabase(uri, async (db) => {
      // 1. CLAIM: Lock the notification
      const notification = await db.collection("notifications").findOneAndUpdate(
        { _id: notificationId, status: "pending" },
        { $set: { status: "processing", startedAt: new Date() } },
        { returnDocument: 'after' }
      );

      if (!notification) return;

      const buffer = notification.content.buffer;
      const type = notification.contentType;
      const formattedNumber = `91${notification.to}`;

      let action = "";
      let payload = { number: formattedNumber };

      if (type === "text") {
        // 1. We define the endpoint (Note: Change this to sendText)
        action = "sendText/trisentrix";

        // 2. THIS IS THE DECODING STEP
        // It takes the binary buffer and turns it into readable words
        payload.text = buffer.toString('utf8');
      }

      else if (type === "pdf") {

        action = "sendMedia/trisentrix";



        // Decodes the URL string from the stored buffer

        const fileUrl = buffer.toString('utf8');



        payload = {

          number: formattedNumber,

          mediatype: "document",

          media: fileUrl,

          fileName: "Kondaas_Report.pdf", // You can make this dynamic later

          caption: "Your document from Kondaas is ready."

        };

      }

      else if (type === "audio") {

        action = "sendMedia/trisentrix";



        // We will treat the content as a URL for this test

        const audioUrl = buffer.toString('utf8');



        payload = {

          number: formattedNumber,

          mediatype: "audio",      // Changed to 'audio'

          media: audioUrl,         // The link to the .mp3 or .ogg file

        };
        // Note: Evolution API usually doesn't use fileName/caption for audio 
        // as it displays as a player in WhatsApp.
      }
      // 3. SEND: Dynamic URL construction
      const response = await fetch(`${BASE_URL}${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": API_KEY
        },
        body: JSON.stringify(payload)
      });

      // 4. FINALIZE
      if (response.ok) {
        await db.collection("notifications").updateOne(
          { _id: notificationId },
          { $set: { status: "completed", completedAt: new Date() } }
        );
        console.log(`✅ WhatsApp ${type} sent to ${formattedNumber}`);
      } else {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }
    });
  } catch (err) {
    console.error("❌ WhatsApp Task Failed:", err.message);
    await withDatabase(uri, async (db) => {
      await db.collection("notifications").updateOne(
        { _id: notificationId },
        { $set: { status: "failed" }, $inc: { retryCount: 1 } }
      );
    });
  }
};

// --- THE OFFICE: Add Notification ---
export const addNotification = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const body = await c.req.json();
    const { from, to, mode, content, contentType } = body;

    if (!from || !to || !mode || !content || !contentType) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const contentBinary = new Binary(Buffer.from(content, 'base64'));

    const notificationId = await withDatabase(uri, async (db) => {
      const result = await db.collection("notifications").insertOne({
        ...body,
        content: contentBinary,
        status: "pending",
        createdAt: new Date()
      });
      return result.insertedId;
    });

    if (mode === "whatsapp") {
      c.executionCtx.waitUntil(processWhatsAppNotification(notificationId, c));
    }

    return c.json({ message: "Notification queued", id: notificationId }, 201);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};
// --- THE BRIDGE: Automated Scenario Notification ---
export const triggerScenarioNotification = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { customerMobile, scenarioType } = await c.req.json();

    return await withDatabase(uri, async (db) => {
      // 1. Fetch Lead
      const lead = await db.collection("lead").findOne({ mobile: customerMobile });
      if (!lead) return c.json({ error: "Lead not found" }, 404);

      const customerName = lead.name || "Customer";
      const whatsappTo = lead.whatsappNo || lead.mobile;
      
      // 2. Prepare the Scenario Message
      let messageText = "";
      if (scenarioType === 1) {
        messageText = `Hello ${customerName}, your Kondaas technician has started from the office.`;
      } else if (scenarioType === 2) {
        messageText = `Hello ${customerName}, your technician is just 300 meters away!`;
      } else if (scenarioType === 3) {
        messageText = `Hello ${customerName}, your technician has arrived.`;
      }

      // 3. Automation Step: Convert text to Base64 (Matching your manual tests)
      const base64Content = Buffer.from(messageText).toString('base64');

      // 4. Create Notification Entry (Exactly like addNotification does)
      const notificationResult = await db.collection("notifications").insertOne({
        from: "7305165859", // Your main Evolution API number
        to: whatsappTo,
        mode: "whatsapp",
        content: new Binary(Buffer.from(base64Content, 'base64')),
        contentType: "text",
        status: "pending",
        retryCount: 0,
        createdAt: new Date()
      });

      // 5. Fire the Worker
      c.executionCtx.waitUntil(processWhatsAppNotification(notificationResult.insertedId, c));

      return c.json({ 
        message: `Scenario ${scenarioType} queued for ${customerName}`, 
        id: notificationResult.insertedId 
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};




export const updateNotification = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { id, status, retryAt, startedAt, retryCount } = await c.req.json();

    if (!id) return c.json({ error: "id is required!" }, 400);

    const updateFields = {};
    if (status !== undefined) updateFields.status = status;
    if (retryCount !== undefined) updateFields.retryCount = retryCount;
    if (retryAt !== undefined) updateFields.retryAt = retryAt ? epochToTime(retryAt) : null;
    if (startedAt !== undefined) updateFields.startedAt = startedAt ? epochToTime(startedAt) : null;

    if (Object.keys(updateFields).length === 0) {
      return c.json({ error: "No fields to update!" }, 400);
    }

    let notFound = false;
    await withDatabase(uri, async (db) => {
      const existing = await db.collection("notifications").findOne({ _id: new ObjectId(id) });
      if (!existing) {
        notFound = true;
        return;
      }
      await db.collection("notifications").updateOne(
        { _id: new ObjectId(id) },
        { $set: updateFields }
      );
    });

    if (notFound) return c.json({ error: "Notification not found!" }, 404);

    return c.json({ message: "Notification updated successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};