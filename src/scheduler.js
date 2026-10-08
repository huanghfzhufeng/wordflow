import { fsrs, createEmptyCard, Rating, State } from 'ts-fsrs';

export const SCHEDULER_VERSION = 'ts-fsrs@5.4.2';
const scheduler = fsrs({
  request_retention: 0.9, enable_short_term: true,
  learning_steps: ['1m', '10m'], relearning_steps: ['10m'], enable_fuzz: true
});
const phases = ['new', 'learning', 'review', 'relearning'];

export function scheduleReview(serialized, rating, now, ratingVersion = 2) {
  const card = serialized ? JSON.parse(serialized) : createEmptyCard(now);
  card.due = new Date(card.due);
  if (card.last_review) card.last_review = new Date(card.last_review);
  const grade = rating === 'again' || (rating === 'hard' && ratingVersion === 1)
    ? Rating.Again : rating === 'hard' ? Rating.Hard : Rating.Good;
  const next = scheduler.next(card, now, grade).card;
  return {
    cardJson: JSON.stringify(next), nextReviewAt: next.due.toISOString(),
    phase: phases[next.state], stateBefore: card.state, wasLongTerm: card.state === State.Review
  };
}
