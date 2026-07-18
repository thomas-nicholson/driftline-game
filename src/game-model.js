export const TRACK_HALF_WIDTH = 2.35;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function steeringTargetFromClientX(clientX, viewportWidth) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  const normalised = clamp(clientX / viewportWidth, 0, 1) * 2 - 1;
  return normalised * TRACK_HALF_WIDTH;
}

export function difficultyForScore(score) {
  const progress = clamp(score / 1800, 0, 5);
  const speed = Math.min(29, 15 + progress * 10);
  const spawnEvery = Math.max(0.5, 0.95 - progress * 0.39);

  return {
    speed: Number(speed.toFixed(2)),
    spawnEvery: Number(spawnEvery.toFixed(2)),
  };
}

export function spawnDelayForScore(score, random = Math.random) {
  const { spawnEvery } = difficultyForScore(score);
  return spawnEvery * (0.85 + clamp(random(), 0, 1) * 0.3);
}

export function scoreAfterStep(score, speed, deltaSeconds) {
  return score + speed * deltaSeconds * 5;
}

export function collisionHit(player, object, lateralTolerance, depthTolerance) {
  return (
    Math.abs(player.x - object.x) <= lateralTolerance
    && Math.abs(player.z - object.z) <= depthTolerance
  );
}
