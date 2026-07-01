import { Hono } from 'hono';

import { addLocation, getLocationByTime, getCurrentLocation,createLogisticsProduct,logLogisticsCompletion,updateProductStatus,updateLogisticsStatus,getLogisticsDealsByMobile,rejectLogisticsDeal } from '../controllers/logisticController.js';

const logisticRoutes = new Hono();

logisticRoutes.post('/add', addLocation);
logisticRoutes.post('/bytime', getLocationByTime);
logisticRoutes.post('/current', getCurrentLocation);

logisticRoutes.get('/deals', getLogisticsDealsByMobile);

logisticRoutes.post('/products', createLogisticsProduct);

logisticRoutes.put('/update-products', updateProductStatus);
logisticRoutes.put('/update-status', updateLogisticsStatus);

logisticRoutes.post('/reject', rejectLogisticsDeal);
logisticRoutes.post('/complete', logLogisticsCompletion);

export default logisticRoutes;