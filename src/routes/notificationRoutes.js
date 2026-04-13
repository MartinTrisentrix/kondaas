import { Hono } from 'hono';
import { addNotification,triggerScenarioNotification,updateNotification} from '../controllers/notificationController.js';

const notificationRoutes = new Hono();

notificationRoutes.post('/add', addNotification);
notificationRoutes.post('/trigger', triggerScenarioNotification);
notificationRoutes.put('/update',updateNotification);

export default notificationRoutes;