import jwt, {} from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();
export const isAuth = async (req, res, next) => {
    try {
        const gatewayPayload = req.headers["x-user-payload"];
        if (typeof gatewayPayload === "string") {
            const user = JSON.parse(Buffer.from(gatewayPayload, "base64").toString("utf8"));
            if (!user?._id) {
                res.status(401).json({ message: "Payload người dùng không hợp lệ" });
                return;
            }
            req.user = user;
            next();
            return;
        }
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
        const { password: _password, ...userWithoutPassword } = decodedValue.user;
        req.user = userWithoutPassword;
        next();
    }
    catch (error) {
        res.status(401).json({ message: "Unauthorized" });
    }
};
//# sourceMappingURL=isAuth.js.map