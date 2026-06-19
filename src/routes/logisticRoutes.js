import { Hono } from 'hono';

import { addLocation, getLocationByTime, getCurrentLocation,createLogisticsProduct,updateProductStatus } from '../controllers/logisticController.js';

const logisticRoutes = new Hono();

logisticRoutes.post('/add', addLocation);
logisticRoutes.post('/bytime', getLocationByTime);
logisticRoutes.post('/current', getCurrentLocation);
logisticRoutes.post('/products', createLogisticsProduct);
logisticRoutes.put('/update-products', updateProductStatus);


export default logisticRoutes;