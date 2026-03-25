import { Hono } from 'hono';
import { addUser, updateUser } from '../controllers/userController.js';

const userRoutes = new Hono();

userRoutes.post('/add', addUser);
userRoutes.put('/update', updateUser);

export default userRoutes;