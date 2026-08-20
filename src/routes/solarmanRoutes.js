import { Hono } from 'hono';
import { getSolarmanStations,saveUserDetails,getUser,getSolarmanHistory,seedTariffSlabs} from '../controllers/solarmanController.js';

const solarmanRoutes = new Hono();


solarmanRoutes.post('/stations', getSolarmanStations);
solarmanRoutes.post('/history', getSolarmanHistory);


solarmanRoutes.post('/user', saveUserDetails);
solarmanRoutes.post('/get', getUser);
solarmanRoutes.post('/slabs', seedTariffSlabs);

export default solarmanRoutes;   