import {
  parseGoalIdParam,
  validateCreateGoalBody,
  validateUpdateGoalBody,
  validateUpdateGoalRatioBody,
} from "../dtos/goals.dto.js";

import { findUserById, updateOnboardingStatus } from "../repositories/user.repository.js";
import {
  findCurrentGoalPeriodByUserId,
  findOngoingGoalPeriodByUserId,
  createGoalPeriod,
  findGoalPeriodById,
  updateGoalPeriod,
  updateGoalPeriodRatio,
  findActivitiesForGoalProgress,
  deleteGoalPeriod,
  findOverlappingGoalPeriodByUserId,
} from "../repositories/goals.repository.js";

const formatDateOnly = (d) => d.toISOString().slice(0, 10);

function endDateToExclusive(endDate) {
  // goalPeriod.endDate(00:00Z) 기준으로 "다음날 00:00Z"를 exclusive로 만들어 날짜 전체 포함
  const endExclusive = new Date(endDate);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return endExclusive;
}

function calcCurrentRatios(activities) {
  // 분 단위 합산
  let growthMin = 0;
  let restMin = 0;

  for (const a of activities) {
    // start/end 없는 데이터 방어
    if (!a.startAt || !a.endAt) continue;
    const ms = new Date(a.endAt).getTime() - new Date(a.startAt).getTime();
    if (!Number.isFinite(ms) || ms <= 0) continue;

    const minutes = ms / (1000 * 60);
    if (a.category === "GROWTH") growthMin += minutes;
    if (a.category === "REST") restMin += minutes;
  }

  const total = growthMin + restMin;
  if (total <= 0) return { currentGrowthRatio: 0, currentRestRatio: 0 };

  let currentGrowthRatio = Math.round((growthMin / total) * 100);
  // 합이 100 안 맞는 케이스 보정
  if (currentGrowthRatio < 0) currentGrowthRatio = 0;
  if (currentGrowthRatio > 100) currentGrowthRatio = 100;
  const currentRestRatio = 100 - currentGrowthRatio;

  return { currentGrowthRatio, currentRestRatio };
}

/**
 * POST /api/goals
 */
export async function createGoalPeriodByUserId(userId, body) {
  // 1) 유저 확인
  const user = await findUserById(userId);
  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "사용자 정보를 찾을 수 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  // 2) 바디 검증
  const dto = validateCreateGoalBody(body);

  // 3) 정책: 기간이 겹치는 목표가 있으면 생성 제한
  const overlap = await findOverlappingGoalPeriodByUserId(userId, dto.start, dto.end);

  if (overlap) {
    const err = new Error("Overlapping goal exists");
    err.statusCode = 409;
    err.payload = {
      resultType: "FAIL",
      error: {
        reason: "이미 해당 기간과 겹치는 목표가 존재합니다.",
        data: {
          overlappingGoalId: overlap.id,
          overlappingStartDate: overlap.startDate.toISOString().slice(0, 10),
          overlappingEndDate: overlap.endDate.toISOString().slice(0, 10),
        },
      },
      success: null,
    };
    throw err;
  }


  // 4) presetType 결정
  // - schema에서 presetType @default("CUSTOM") 해뒀다면 아래는 그냥 CUSTOM로 고정해도 됨
  const presetType = dto.presetId != null ? "PRESET" : "CUSTOM";

  // 5) 생성
  const created = await createGoalPeriod({
    userId,
    presetId: dto.presetId,
    presetType,
    title: dto.title,
    startDate: dto.start,
    endDate: dto.end,
    targetGrowthRatio: dto.targetGrowthRatio,
    targetRestRatio: dto.targetRestRatio,
  });

  // 6) 응답
  return {
    resultType: "SUCCESS",
    error: null,
    success: {
      goalId: created.id,
      title: created.title,
      startDate: dto.startDateRaw,
      endDate: dto.endDateRaw,
      createdAt: created.createdAt.toISOString(),
    },
  };
}

/**
 * PATCH /api/goals/:goalId (기간/이름 수정)
 */
export async function updateGoalPeriodByUserId(userId, goalIdParam, body) {
  const goalId = parseGoalIdParam(goalIdParam);
  const dto = validateUpdateGoalBody(body);

  // 1) 목표 존재 확인
  const existing = await findGoalPeriodById(goalId);
  if (!existing) {
    const err = new Error("Goal not found");
    err.statusCode = 404;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "목표 정보를 찾을 수 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  // 2) 소유권 체크
  if (Number(existing.userId) !== Number(userId)) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "해당 목표에 대한 권한이 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  // 3) 날짜 검증: 부분 수정이므로 기존값과 합쳐서 검증
  const nextStart = dto.hasStart ? dto.start : existing.startDate;
  const nextEnd = dto.hasEnd ? dto.end : existing.endDate;

  if (nextEnd.getTime() < nextStart.getTime()) {
    const err = new Error("endDate < startDate");
    err.statusCode = 400;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "종료일은 시작일보다 이전일 수 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  // 3-1) 정책: 수정 후 기간이 다른 목표와 겹치면 제한 (자기 자신은 제외)
const overlap = await findOverlappingGoalPeriodByUserId(userId, nextStart, nextEnd, existing.id);

if (overlap) {
  const err = new Error("Overlapping goal exists");
  err.statusCode = 409;
  err.payload = {
    resultType: "FAIL",
    error: {
      reason: "이미 해당 기간과 겹치는 목표가 존재합니다.",
      data: {
        overlappingGoalId: overlap.id,
        overlappingStartDate: overlap.startDate.toISOString().slice(0, 10),
        overlappingEndDate: overlap.endDate.toISOString().slice(0, 10),
      },
    },
    success: null,
  };
  throw err;
}


  // 4) 업데이트 payload 구성
  const updateData = {};
  if (dto.title != null) updateData.title = dto.title;
  if (dto.hasStart) updateData.startDate = dto.start;
  if (dto.hasEnd) updateData.endDate = dto.end;

  const updated = await updateGoalPeriod(goalId, updateData);

  // 5) 응답
  return {
    resultType: "SUCCESS",
    error: null,
    success: {
      goalId: updated.id,
      title: updated.title,
      startDate: dto.startDateRaw ?? formatDateOnly(updated.startDate),
      endDate: dto.endDateRaw ?? formatDateOnly(updated.endDate),
      growthRatio: updated.growth,
      restRatio: updated.rest,
    },
  };
}

/**
 * GET /api/goals/current (현재 목표 조회)
 */
export async function getCurrentGoalByUserId(userId) {
  const current = await findCurrentGoalPeriodByUserId(userId, new Date());

  if (!current) {
    return {
      resultType: "SUCCESS",
      error: null,
      success: { goalId: null },
    };
  }

  const endExclusive = endDateToExclusive(current.endDate);
  const activities = await findActivitiesForGoalProgress(userId, current.startDate, endExclusive);
  const { currentGrowthRatio, currentRestRatio } = calcCurrentRatios(activities);

  return {
    resultType: "SUCCESS",
    error: null,
    success: {
      goalId: current.id,
      title: current.title,
      startDate: formatDateOnly(current.startDate),
      endDate: formatDateOnly(current.endDate),

      // 목표(타겟) 비율
      growthRatio: current.growth,
      restRatio: current.rest,

      // 현재(실제 기록 기반) 비율
      currentGrowthRatio,
      currentRestRatio,

      // 필요하면 UI 라벨링용
      presetType: current.presetType,
      presetId: current.presetId ?? null,
    },
  };
}

/**
 * PATCH /api/goals/:goalId/ratio (성장/휴식 비율 변경)
 */
export async function updateGoalRatioByUserId(userId, goalIdParam, body) {
  const goalId = parseGoalIdParam(goalIdParam);
  const { growthRatio, restRatio } = validateUpdateGoalRatioBody(body);

  const existing = await findGoalPeriodById(goalId);
  if (!existing) {
    const err = new Error("Goal not found");
    err.statusCode = 404;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "목표 정보를 찾을 수 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  if (Number(existing.userId) !== Number(userId)) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "해당 목표에 대한 권한이 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  const updated = await updateGoalPeriodRatio(goalId, growthRatio, restRatio);

  return {
    resultType: "SUCCESS",
    error: null,
    success: {
      goalId: updated.id,
      growthRatio: updated.growth,
      restRatio: updated.rest,
    },
  };
}

/**
 * GET /api/goals/:goalId (기간 + 타겟 비율)
 */
export async function getGoalDetailByUserId(userId, goalIdParam) {
  const goalId = parseGoalIdParam(goalIdParam);
  const goal = await findGoalPeriodById(goalId);

  if (!goal) {
    const err = new Error("Goal not found");
    err.statusCode = 404;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "목표 정보를 찾을 수 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  if (Number(goal.userId) !== Number(userId)) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "해당 목표에 대한 권한이 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  return {
    resultType: "SUCCESS",
    error: null,
    success: {
      goalId: goal.id,
      title: goal.title,
      startDate: formatDateOnly(goal.startDate),
      endDate: formatDateOnly(goal.endDate),
      growthRatio: goal.growth,
      restRatio: goal.rest,
      presetType: goal.presetType,
      presetId: goal.presetId ?? null,
    },
  };
}

/**
 * GET /api/goals/:goalId/progress (현재 성장/휴식 비율)
 */
export async function getGoalProgressByUserId(userId, goalIdParam) {
  const goalId = parseGoalIdParam(goalIdParam);
  const goal = await findGoalPeriodById(goalId);

  if (!goal) {
    const err = new Error("Goal not found");
    err.statusCode = 404;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "목표 정보를 찾을 수 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  if (Number(goal.userId) !== Number(userId)) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "해당 목표에 대한 권한이 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  const endExclusive = endDateToExclusive(goal.endDate);
  const activities = await findActivitiesForGoalProgress(userId, goal.startDate, endExclusive);
  console.log("조회된 활동 데이터:", activities);
  const { currentGrowthRatio, currentRestRatio } = calcCurrentRatios(activities);

  return {
    resultType: "SUCCESS",
    error: null,
    success: {
      goalId: goal.id,
      currentGrowthRatio,
      currentRestRatio,
    },
  };
}

/**
 * GET /api/goals/ratio-presets
 */
export async function getGoalRatioPresets() {
  return {
    resultType: "SUCCESS",
    error: null,
    success: {
      presets: [
        {
          presetId: 1,
          title: "파워 갓생러 🔥",
          description:
            "잠은 죽어서 잔다!\n" +
            "이번 시즌, 후회 없이 모든 걸 쏟아붓습니다\n\n" +
            "지금 편안하게 쉬는 것보다,\n" +
            "미래의 압도적인 성취를 위해\n" +
            "성장에 올인(All-in)하는 유형",
          growthRatio: 90,
          restRatio: 10,
          recommendedFor:
            "고시, 취준, 공모전 마감이 코앞인 전사들",
        },
        {
          presetId: 2,
          title: "밸런스 챌린저 🏃",
          description:
            "열심히 달리지만 번아웃은 사절!\n" +
            "꽉 찬 일정 속, 전략적 휴식\n\n" +
            "가장 표준적인 '성장 지향형' 모델\n" +
            "주중엔 달리고 주말에는 확실히 쉬는 유형",
          growthRatio: 70,
          restRatio: 30,
          recommendedFor:
            "학점 관리와 대외활동을 병행하는\n" + "프로 N잡러",
        },
        {
          presetId: 3,
          title: "황금 밸런스형 ⚖️",
          description:
            "성장도 휴식도 놓칠 수 없어!\n" +
            "딱 반반, 완벽한 조화를 꿈꿉니다\n\n" +
            "적극적으로 성장과 휴식을 탐색하는,\n" +
            "이상적이고 건강한 루틴을 지향하는 유형",
          growthRatio: 50,
          restRatio: 50,
          recommendedFor:
            "방학을 알차게 보내고 싶지만,\n" + "여행도 다니고 싶은 여유 있는 대학생",
        },
        {
          presetId: 4,
          title: "에너지 충전형 🔋",
          description:
            "지난 학기 너무 달린 나,\n" +
            "이번엔 나를 돌보며 천천히 갑니다\n\n" +
            "휴식이 메인이지만, '감'을 잃지 않기 위해\n" +
            "최소한의 자기 개발은 유지하는 유형",
          growthRatio: 30,
          restRatio: 70,
          recommendedFor:
            "종강 직후 지친, 번아웃을 피하려는 대학생",
        },
        {
          presetId: 5,
          title: "슬로우 스타터 🐢",
          description:
            "무리하지 말고 딱 하나만!\n" +
            "작은 습관부터 천천히 시작해볼까요?\n\n" +
            "거창한 목표 대신 '하루 30분 독서' 같은\n" +
            "작은 목표 하나에 집중이 필요한 유형",
          growthRatio: 20,
          restRatio: 80,
          recommendedFor:
            "무기력증을 극복하고 싶은 대학생,\n" + "아주 작은 성취부터 맛보고 싶은 입문자",
        },
        {
          presetId: 6,
          title: "갭이어 탐험가 ✈️",
          description:
            "이번 시즌의 목표는 경험!\n" +
            "마음껏 놀고, 보고, 느끼는 게 나의 스펙\n\n" +
            "단순한 휴식이 아니라\n" +
            "여행이나 새로운 경험을 통한\n" +
            "'적극적인 휴식'으로 청춘을 즐기려는 유형",
          growthRatio: 10,
          restRatio: 90,
          recommendedFor:
            "배낭 여행, 워킹 홀리데이, 휴학 후\n" + "자아를 찾는 여행자",
        },
      ],
    },
  };
}


export async function deleteGoalByUserId(userId, goalIdParam) {
  const goalId = parseGoalIdParam(goalIdParam); //

  // 1) 목표 존재 확인
  const goal = await findGoalPeriodById(goalId); //
  if (!goal) {
    const err = new Error("Goal not found");
    err.statusCode = 404;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "목표 정보를 찾을 수 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  // 2) 소유권 체크 (보안)
  if (Number(goal.userId) !== Number(userId)) { //
    const err = new Error("Forbidden");
    err.statusCode = 403;
    err.payload = {
      resultType: "FAIL",
      error: { reason: "해당 목표에 대한 권한이 없습니다.", data: null },
      success: null,
    };
    throw err;
  }

  // 3) 삭제 수행
  await deleteGoalPeriod(goalId);

  // 4) 온보딩 상태 초기화 (다시 온보딩을 할 수 있도록!)
  await updateOnboardingStatus(userId, false);

  return {
    resultType: "SUCCESS",
    error: null,
    success: {
      message: "목표가 성공적으로 삭제되었습니다.",
      deletedGoalId: goalId
    }
  };
}


