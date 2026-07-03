import { Hono } from 'hono';

import { addLocation, getLocationByTime, getCurrentLocation,saveJobCoordinates } from '../controllers/locationController.js';

const locationRoutes = new Hono();

locationRoutes.post('/add', addLocation);
locationRoutes.post('/bytime', getLocationByTime);
locationRoutes.post('/current', getCurrentLocation);
locationRoutes.post('/distance', saveJobCoordinates);


export default locationRoutes;