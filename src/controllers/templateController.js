import { withDatabase } from '../utils/config.js';

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * 📝 Create Template (Expects id, schema, and uischema in body)
 */
export const createTemplate = async (c) => {
  try {
    const { id, schema, uischema } = await c.req.json();

    if (!id || !schema || !uischema) {
      return c.json({ error: "id, schema, and uischema are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Look for an existing template matching the user-provided ID
      const existing = await db.collection("templates").findOne({ id });

      if (existing) {
        return c.json({ error: `Template with ID '${id}' already exists!` }, 400);
      }

      await db.collection("templates").insertOne({
        id,
        schema,
        uischema
      });

      return c.json({ message: `Template '${id}' created successfully!` }, 201);
    });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

/**
 * 🔄 Update Template (Expects id, schema, and uischema in body)
 */
export const updateTemplate = async (c) => {
  try {
    const { id, schema, uischema } = await c.req.json();

    if (!id || !schema || !uischema) {
      return c.json({ error: "id, schema, and uischema are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const existing = await db.collection("templates").findOne({ id });

      if (!existing) {
        return c.json({ error: `Template with ID '${id}' not found!` }, 404);
      }

      await db.collection("templates").updateOne(
        { id },
        { $set: { schema, uischema } }
      );

      return c.json({ message: `Template '${id}' updated successfully!` });
    });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

/**
 * 🔍 Get Template (Dynamic path parameter lookup)
 */
export const getTemplate = async (c) => {
  try {
    // Extract the dynamic id from the URL parameters
    const id = c.req.param('id');

    if (!id) {
      return c.json({ error: "Template ID param is required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const template = await db.collection("templates").findOne({ id });

      if (!template) {
        return c.json({ error: `Template '${id}' not found!` }, 404);
      }

      return c.json(template);
    });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};