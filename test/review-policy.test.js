import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReviewPolicy } from '../src/review-policy.js';

const timeZone = 'Asia/Singapore';

test('S1 does not become S2 on the same learning day', () => {
  const result = applyReviewPolicy({
    status: 'S1',
    rating: 'good',
    previousReviewedAt: '2026-07-14T01:00:00.000Z',
    reviewedAt: '2026-07-14T10:00:00.000Z',
    timeZone
  });
  assert.equal(result.nextStatus, 'S1');
  assert.equal(result.isDelayedReview, false);
});

test('S1 becomes S2 after an unprompted answer on a later day', () => {
  const result = applyReviewPolicy({
    status: 'S1',
    rating: 'good',
    previousReviewedAt: '2026-07-14T01:00:00.000Z',
    reviewedAt: '2026-07-15T01:00:00.000Z',
    timeZone
  });
  assert.equal(result.nextStatus, 'S2');
  assert.equal(result.isDelayedReview, true);
});

test('S3 requires an existing S2 plus real hits on two dates', () => {
  const result = applyReviewPolicy({
    status: 'S2',
    rating: 'real',
    previousReviewedAt: '2026-07-13T01:00:00.000Z',
    reviewedAt: '2026-07-15T01:00:00.000Z',
    realHitDays: 2,
    timeZone
  });
  assert.equal(result.nextStatus, 'S3');
});

test('a failed delayed item is conservatively downgraded', () => {
  assert.equal(applyReviewPolicy({ status: 'S2', rating: 'again' }).nextStatus, 'S1');
  assert.equal(applyReviewPolicy({ status: 'S3', rating: 'again' }).nextStatus, 'S2');
});
