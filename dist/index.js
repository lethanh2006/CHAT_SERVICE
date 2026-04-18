import express from 'express';
import dotenv from 'dotenv';
import connectDb from './config/db.js';
import chatRoutes from './routes/chat.js';
import cors from "cors";
import { app, server } from './config/socket.js';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
dotenv.config();
connectDb();
app.use(express.json());
app.use(cors());
app.use('/api/v1', chatRoutes);
const swaggerSpec = swaggerJsdoc({
    definition: {
        openapi: '3.0.0',
        info: { title: 'Chat Service API', version: '1.0.0' },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [
            {
                bearerAuth: [],
            },
        ],
    },
    apis: ['./src/routes/*.ts', './dist/routes/*.js'],
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
});
const port = process.env.PORT;
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
//# sourceMappingURL=index.js.map