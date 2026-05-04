import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// POST /auth/signup
router.post("/auth/signup", async (req, res): Promise<void> => {
  const { email, password, name } = req.body as { email: string; password: string; name: string };
  if (!email || !password || !name) {
    res.status(400).json({ error: "email, password and name are required" });
    return;
  }
  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      email_confirm: true,
    });
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    // Auto sign-in after signup
    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const tokenData = await tokenRes.json() as Record<string, unknown>;
    if (!tokenRes.ok) {
      res.status(201).json({ user: data.user, message: "Account created. Please sign in." });
      return;
    }
    res.status(201).json({
      user: { id: data.user!.id, email: data.user!.email, name },
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Signup failed" });
  }
});

// POST /auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  try {
    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await tokenRes.json() as Record<string, unknown>;
    if (!tokenRes.ok) {
      res.status(401).json({ error: (data as { error_description?: string }).error_description ?? "Invalid credentials" });
      return;
    }
    const userMeta = (data.user as { user_metadata?: { name?: string } } | undefined)?.user_metadata;
    res.json({
      user: {
        id: (data.user as { id: string }).id,
        email: (data.user as { email: string }).email,
        name: userMeta?.name ?? email.split("@")[0],
      },
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// POST /auth/refresh
router.post("/auth/refresh", async (req, res): Promise<void> => {
  const { refreshToken } = req.body as { refreshToken: string };
  if (!refreshToken) { res.status(400).json({ error: "refreshToken required" }); return; }
  try {
    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await tokenRes.json() as Record<string, unknown>;
    if (!tokenRes.ok) { res.status(401).json({ error: "Token refresh failed" }); return; }
    res.json({ accessToken: data.access_token, refreshToken: data.refresh_token });
  } catch {
    res.status(500).json({ error: "Token refresh failed" });
  }
});

// GET /auth/me
router.get("/auth/me", async (req, res): Promise<void> => {
  const token = req.headers.authorization?.slice(7);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) { res.status(401).json({ error: "Invalid token" }); return; }
    res.json({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? "User",
    });
  } catch {
    res.status(500).json({ error: "Failed to get user" });
  }
});

// POST /auth/logout
router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.headers.authorization?.slice(7);
  if (token) {
    try { await supabase.auth.admin.signOut(token); } catch {}
  }
  res.json({ message: "Logged out" });
});

export default router;
