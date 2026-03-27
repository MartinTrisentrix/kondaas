import { Hono } from 'hono';
import { addForm, updateForm, updateMobileNumber } from '../controllers/userController.js';

const userRoutes = new Hono();

userRoutes.post('/add', addForm);
userRoutes.put('/update', updateForm);
userRoutes.put('/updatemobile', updateMobileNumber);

export default userRoutes;
