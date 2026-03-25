import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import dotenv from 'dotenv';
import locationRoutes from './src/routes/locationRoutes.js';
import userRoutes from './src/routes/userRoutes.js';

dotenv.config();

const app = new Hono();

app.use('*', cors());

app.route('/location', locationRoutes);
app.route('/user', userRoutes);

const port = 3000;
serve({ fetch: app.fetch, port });
console.log(`Kondaas server running on port 3000`);