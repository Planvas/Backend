import { prisma } from "../db.config.js";

// 1. 최신 목표(가장 최근 생성)
export const findRecentGoal = async (userId) => {
  return await prisma.goalPeriod.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
};

// ✅ 1-1. 진행중 목표(오늘이 기간 안)
export const findCurrentGoal = async (userId, today = new Date()) => {
  return await prisma.goalPeriod.findFirst({
    where: {
      userId,
      startDate: { lte: today },
      endDate: { gte: today },
    },
    orderBy: { startDate: "desc" },
  });
};

// 2. 주간 일정 조회 (✅ 기간 겹치는 일정 포함)
export const findWeeklyActivities = async (userId, startDate, endDate) => {
  return await prisma.userActivity.findMany({
    where: {
      userId,
      // (startAt <= endDate) AND (endAt >= startDate)
      startAt: { lte: endDate },
      endAt: { gte: startDate },
    },
    select: {
      id: true,
      title: true,
      type: true,
      startAt: true,
      endAt: true,
      status: true,
      googleEventId: true,
    },
    orderBy: { startAt: "asc" },
  });
};

// 3. 오늘의 할 일 조회 (✅ 기간 겹치는 일정 포함)
export const findTodayActivities = async (userId, startOfDay, endOfDay) => {
  return await prisma.userActivity.findMany({
    where: {
      userId,
      startAt: { lte: endOfDay },
      endAt: { gte: startOfDay },
    },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      startAt: true,
      endAt: true,
      googleEventId: true,
    },
    orderBy: { startAt: "asc" },
  });
};

// ✅ 4. 목표 진행률 계산용 (MyActivity + Activity.tab)
export const findMyActivitiesForGoal = async (userId, goalId) => {
  return await prisma.myActivity.findMany({
    where: { userId, goalId },
    select: {
      id: true,
      Activity: { select: { tab: true } }, // "GROWTH" | "REST"
    },
  });
};

// 5. 추천 활동 조회
export const findRecommendations = async () => {
    return await prisma.activity.findMany({
        take: 3,
        select: {
            id: true,
            title: true,
            organizer: true,
            thumbnailUrl: true,
            tags: true,
            recruit_end_date: true, 
            tab: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });
};
