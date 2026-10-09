import { Router, Request, Response, NextFunction } from "express";
import { validate } from "../middleware/validate.js";
import { loginSchema } from "../utils/schemas.js";
import { loginService } from "../services/auth.service.js";

const router = Router();

router.post(
  "/login",
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await loginService(req.body);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
