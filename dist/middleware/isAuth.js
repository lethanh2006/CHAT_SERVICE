import jwt, {} from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();
export const isAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const token = authHeader.split(" ")[1];
        // verify token
        const decodedValue = jwt.verify(token, process.env.JWT_SECRET);
        if (!decodedValue) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const { password, ...userWithoutPassword } = decodedValue.user;
        req.user = userWithoutPassword;
        next();
    }
    catch (error) {
        res.status(401).json({ message: "Unauthorized" });
    }
};
//# sourceMappingURL=isAuth.js.map