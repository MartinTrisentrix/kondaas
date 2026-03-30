import { Hono } from 'hono';
import { addOrder,getOrders} from '../controllers/orderController.js';

const orderRoutes = new Hono();

orderRoutes.post('/add', addOrder);
orderRoutes.get('/all', getOrders);

export default orderRoutes;