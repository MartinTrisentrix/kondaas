import { Hono } from 'hono';

import { addLocation, getLocationByTime, getCurrentLocation,saveDealDistance } from '../controllers/locationController.js';

const locationRoutes = new Hono();

locationRoutes.post('/add', addLocation);
locationRoutes.post('/bytime', getLocationByTime);
locationRoutes.post('/current', getCurrentLocation);
locationRoutes.post('/distance', saveDealDistance);


export default locationRoutes;