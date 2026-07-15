const STATUS_RANK = {
  candidate: -1,
  S0: 0,
  S1: 1,
  S2: 2,
  S3: 3
};

export function statusRank(status) {
  return STATUS_RANK[status] ?? -1;
}

export function localDay(value, timeZone = 'Asia/Singapore') {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function addMinutes(now, minutes) {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

function addDays(now, days) {
  return addMinutes(now, days * 24 * 60);
}

export function applyReviewPolicy({
  status,
  rating,
  reviewedAt = new Date(),
  previousReviewedAt = null,
  realHitDays = 0,
  timeZone = 'Asia/Singapore'
}) {
  if (!['again', 'hard', 'good', 'real'].includes(rating)) {
    throw new Error('无效的复习结果');
  }

  const now = reviewedAt instanceof Date ? reviewedAt : new Date(reviewedAt);
  const previousDay = localDay(previousReviewedAt, timeZone);
  const today = localDay(now, timeZone);
  const isDelayedReview = Boolean(previousDay && previousDay !== today);
  let nextStatus = status === 'candidate' ? 'S0' : status;
  let nextReviewAt;

  if (rating === 'again') {
    if (status === 'S3') nextStatus = 'S2';
    if (status === 'S2') nextStatus = 'S1';
    nextReviewAt = addMinutes(now, 10);
  } else if (rating === 'hard') {
    nextReviewAt = addDays(now, 1);
  } else {
    if (nextStatus === 'S0') {
      nextStatus = 'S1';
    } else if (nextStatus === 'S1' && isDelayedReview) {
      nextStatus = 'S2';
    } else if (nextStatus === 'S2' && rating === 'real' && realHitDays >= 2) {
      nextStatus = 'S3';
    }

    const intervalDays = nextStatus === 'S3' ? 14 : nextStatus === 'S2' ? 7 : 1;
    nextReviewAt = addDays(now, intervalDays);
  }

  return {
    previousStatus: status,
    nextStatus,
    nextReviewAt,
    isDelayedReview
  };
}
