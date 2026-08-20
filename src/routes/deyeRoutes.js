import { Hono } from 'hono';
import { getDeyeHistory,getDeyeStations,calculateDeyeUserSavings} from '../controllers/deyeController.js';

const deyeRoutes = new Hono();


deyeRoutes.post('/stations', getDeyeStations);
deyeRoutes.post('/history', getDeyeHistory);
deyeRoutes.post('/savings', calculateDeyeUserSavings);

export default deyeRoutes;   