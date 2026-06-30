import { Hono } from 'hono';

import { getDealInfo,assignLogisticsMember,getAdminRejections,getAdminCompletions } from '../controllers/adminController.js';

const adminRoutes = new Hono();

adminRoutes.get('/products', getDealInfo);
adminRoutes.post('/assign', assignLogisticsMember);

adminRoutes.get('/rejections', getAdminRejections);
adminRoutes.get('/completions', getAdminCompletions);



export default adminRoutes;
