import { Hono } from 'hono';
import { addUser, updateUser, updateMobile } from '../controllers/userController.js';

const userRoutes = new Hono();

userRoutes.post('/add', addUser);
userRoutes.put('/update', updateUser);
userRoutes.put('/updatemobile', updateMobile);

export default userRoutes;
