import { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase.js";

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    req.userId = user.id;
    req.userEmail = user.email;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
