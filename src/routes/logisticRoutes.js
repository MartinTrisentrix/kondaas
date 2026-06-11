import { Hono } from 'hono';

import { addLocation, getLocationByTime, getCurrentLocation } from '../controllers/logisticController.js';

const logisticRoutes = new Hono();

logisticRoutes.post('/add', addLocation);
logisticRoutes.post('/bytime', getLocationByTime);
logisticRoutes.post('/current', getCurrentLocation);


export default logisticRoutes;