import { Hono } from 'hono';
import { getDeyeToken,saveDeyeUserDetails,getDeyeHistory,getDeyeStations,getDeyeDevices,getDeyeDataCore,getDeyeRealTimeData} from '../controllers/deyeController.js';

const deyeRoutes = new Hono();

deyeRoutes.post('/token', getDeyeToken);
deyeRoutes.post('/save-user', saveDeyeUserDetails);
deyeRoutes.post('/history', getDeyeHistory);
deyeRoutes.post('/stations', getDeyeStations);
deyeRoutes.post('/devices', getDeyeDevices);
deyeRoutes.post('/data', getDeyeDataCore);
deyeRoutes.post('/real-time', getDeyeRealTimeData);

export default deyeRoutes;   