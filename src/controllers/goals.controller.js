import { requireAuth } from "../auth.config.js";
import {
  createGoalPeriodByUserId,
  updateGoalPeriodByUserId,
  getCurrentGoalByUserId,
  updateGoalRatioByUserId,
  getGoalRatioPresets,
  getGoalDetailByUserId,
  getGoalProgressByUserId,
  deleteGoalByUserId,
} from "../services/goals.service.js";

function getAuthUserIdSafe(req) {
  return req.auth?.userId ?? req.userId; 
}
export function registerGoalRoutes(app) {
  // POST /api/goals
  app.post("/api/goals", requireAuth, async (req, res) => {
    try {
      const userIdRaw = getAuthUserIdSafe(req);
      if (!userIdRaw) return res.status(401).json(defaultGoalsFail());
      const userId = Number(userIdRaw);

      const result = await createGoalPeriodByUserId(userId, req.body);

      return res.status(201).json(result);
    } catch (e) {
      console.error("[POST /api/goals] error:", e);
      return res.status(e.statusCode ?? 500).json(e.payload ?? defaultGoalsFail());
    }
  });

  // DELETE /api/goals/:goalId (목표 삭제)
  app.delete("/api/goals/:goalId", requireAuth, async (req, res) => { //
    try {
      const userIdRaw = getAuthUserIdSafe(req);
      if (!userIdRaw) return res.status(401).json(defaultGoalsFail());
      const userId = Number(userIdRaw);

      const result = await deleteGoalByUserId(userId, req.params.goalId);
      return res.status(200).json(result);
    } catch (e) {
      console.error("[DELETE /api/goals/:goalId] error:", e);
      return res.status(e.statusCode ?? 500).json(e.payload ?? defaultGoalsFail()); //
    }
  });

  // GET /api/goals/current (현재 목표 조회)
  app.get("/api/goals/current", requireAuth, async (req, res) => {
    try {
      const userIdRaw = getAuthUserIdSafe(req);
      if (!userIdRaw) return res.status(401).json(defaultGoalsFail());
      const userId = Number(userIdRaw);

      const result = await getCurrentGoalByUserId(userId);

      return res.status(200).json(result);
    } catch (e) {
      console.error("[GET /api/goals/current] error:", e);
      return res.status(e.statusCode ?? 500).json(e.payload ?? defaultGoalsFail());
    }
  });

  // GET /api/goals/ratio-presets (프리셋 목록)
  app.get("/api/goals/ratio-presets", requireAuth, async (req, res) => {
    try {
      const result = await getGoalRatioPresets();
      return res.status(200).json(result);
    } catch (e) {
      console.error("[GET /api/goals/ratio-presets] error:", e);
      return res.status(e.statusCode ?? 500).json(e.payload ?? defaultGoalsFail());
    }
  });

  // GET /api/goals/:goalId/progress (진행 비율)  ← :goalId 보다 위!
  app.get("/api/goals/:goalId/progress", requireAuth, async (req, res) => {
    try {
      const userIdRaw = getAuthUserIdSafe(req);
      if (!userIdRaw) return res.status(401).json(defaultGoalsFail());
      const userId = Number(userIdRaw);

      const result = await getGoalProgressByUserId(userId, req.params.goalId);
      return res.status(200).json(result);
    } catch (e) {
      console.error("[GET /api/goals/:goalId/progress] error:", e);
      return res.status(e.statusCode ?? 500).json(e.payload ?? defaultGoalsFail());
    }
  });

  // PATCH /api/goals/:goalId/ratio
  app.patch("/api/goals/:goalId/ratio", requireAuth, async (req, res) => {
    try {
      const userIdRaw = getAuthUserIdSafe(req);
      if (!userIdRaw) return res.status(401).json(defaultGoalsFail());
      const userId = Number(userIdRaw);

      const result = await updateGoalRatioByUserId(userId, req.params.goalId, req.body);
      return res.status(200).json(result);
    } catch (e) {
      console.error("[PATCH /api/goals/:goalId/ratio] error:", e);
      return res.status(e.statusCode ?? 500).json(e.payload ?? defaultGoalsFail());
    }
  });

  // PATCH /api/goals/:goalId (기간/이름 수정)
  app.patch("/api/goals/:goalId", requireAuth, async (req, res) => {
    try {
      const userIdRaw = getAuthUserIdSafe(req);
      if (!userIdRaw) return res.status(401).json(defaultGoalsFail());
      const userId = Number(userIdRaw);

      const result = await updateGoalPeriodByUserId(userId, req.params.goalId, req.body);
      return res.status(200).json(result);
    } catch (e) {
      console.error("[PATCH /api/goals/:goalId] error:", e);
      return res.status(e.statusCode ?? 500).json(e.payload ?? defaultGoalsFail());
    }
  });

  // GET /api/goals/:goalId (목표 상세: 기간 + 타겟비율)
  app.get("/api/goals/:goalId", requireAuth, async (req, res) => {
    try {
      const userIdRaw = getAuthUserIdSafe(req);
      if (!userIdRaw) return res.status(401).json(defaultGoalsFail());
      const userId = Number(userIdRaw);

      const result = await getGoalDetailByUserId(userId, req.params.goalId);
      return res.status(200).json(result);
    } catch (e) {
      console.error("[GET /api/goals/:goalId] error:", e);
      return res.status(e.statusCode ?? 500).json(e.payload ?? defaultGoalsFail());
    }
  });
}

function defaultGoalsFail() {
  return {
    resultType: "FAIL",
    error: { reason: "목표 처리 중 서버 오류가 발생했습니다.", data: null },
    success: null,
  };
}
