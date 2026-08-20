import { Hono } from 'hono';
import { getSolisStations,getSolisHistory,calculateSolisUserSavings} from '../controllers/solisController.js';

const solisRoutes = new Hono();

solisRoutes.post('/stations', getSolisStations);
solisRoutes.post('/history', getSolisHistory);
solisRoutes.post('/savings', calculateSolisUserSavings);



export default solisRoutes;   