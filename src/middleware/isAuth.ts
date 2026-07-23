import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

interface IUser extends Document {
    _id: string;
    name: string;
    email: string;
}

export interface AuthenticatedRequest extends Request {
    user?: IUser | null;
    
}

export const isAuth = async (req : AuthenticatedRequest, res: Response, next: NextFunction) :
    Promise<void> => {
    try { 
        const authHeader = req.headers.authorization;

        if(!authHeader || !authHeader.startsWith("Bearer ")) {
            res.status(401).json({ message: "Unauthorized" });
            return ;
        }
        const token = authHeader.split(" ")[1];
        // verify token
        const decodedValue = jwt.verify(token as string, process.env.JWT_SECRET as string) as JwtPayload;
        if(!decodedValue) {
            res.status(401).json({ message: "Unauthorized" });
            return ;
        }
        const { password, ...userWithoutPassword } = decodedValue.user;
        req.user = userWithoutPassword;
        next();
     }
    catch (error) {
        res.status(401).json({ message: "Unauthorized" });
    }
};
