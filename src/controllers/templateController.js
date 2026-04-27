import { withDatabase } from '../utils/config.js';

const MONGODB_URI = process.env.MONGODB_URI;
const TEMPLATE_ID = "solarv1";

export const createTemplate = async (c) => {
  try {
    const { schema, uischema } = await c.req.json();

    if (!schema || !uischema) {
      return c.json({ error: "schema and uischema are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const existing = await db.collection("templates").findOne({ id: TEMPLATE_ID });

      if (existing) {
        return c.json({ error: "Template already exists!" }, 400);
      }

      await db.collection("templates").insertOne({
        id: TEMPLATE_ID,
        schema,
        uischema
      });

      return c.json({ message: "Template created successfully!" }, 201);
    });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateTemplate = async (c) => {
  try {
    const { schema, uischema } = await c.req.json();

    if (!schema || !uischema) {
      return c.json({ error: "schema and uischema are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const existing = await db.collection("templates").findOne({ id: TEMPLATE_ID });

      if (!existing) {
        return c.json({ error: "Template not found!" }, 404);
      }

      await db.collection("templates").updateOne(
        { id: TEMPLATE_ID },
        { $set: { schema, uischema } }
      );

      return c.json({ message: "Template updated successfully!" });
    });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getTemplate = async (c) => {
  try {
    return await withDatabase(MONGODB_URI, async (db) => {
      const template = await db.collection("templates").findOne({ id: TEMPLATE_ID });

      if (!template) {
        return c.json({ error: "Template not found!" }, 404);
      }

      return c.json(template);
    });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};