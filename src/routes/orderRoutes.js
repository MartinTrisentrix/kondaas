import { Hono } from 'hono';
import { addOrder, rejectOrder,updateOrder, updateOrderStatus, getOrders } from '../controllers/orderController.js';

const orderRoutes = new Hono();

orderRoutes.post('/add', addOrder);
orderRoutes.post('/reject',rejectOrder)
orderRoutes.put('/update', updateOrder);
orderRoutes.put('/updatestatus', updateOrderStatus);
orderRoutes.get('/all', getOrders);

export default orderRoutes;