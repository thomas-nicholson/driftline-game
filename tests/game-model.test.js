import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRACK_HALF_WIDTH,
  clamp,
  collisionHit,
  difficultyForScore,
  scoreAfterStep,
  spawnDelayForScore,
  steeringTargetFromClientX,
} from '../src/game-model.js';

test('steering maps the full screen to the playable track and clamps edges', () => {
  assert.equal(steeringTargetFromClientX(0, 400), -TRACK_HALF_WIDTH);
  assert.equal(steeringTargetFromClientX(200, 400), 0);
  assert.equal(steeringTargetFromClientX(400, 400), TRACK_HALF_WIDTH);
  assert.equal(steeringTargetFromClientX(900, 400), TRACK_HALF_WIDTH);
});

test('difficulty rises steadily but remains mobile-playable', () => {
  assert.deepEqual(difficultyForScore(0), { speed: 15, spawnEvery: 0.95 });
  assert.deepEqual(difficultyForScore(1800), { speed: 25, spawnEvery: 0.56 });
  assert.deepEqual(difficultyForScore(9000), { speed: 29, spawnEvery: 0.5 });
});

test('spawn jitter is deterministic with an injected random value', () => {
  assert.ok(Math.abs(spawnDelayForScore(0, () => 0) - 0.8075) < 1e-12);
  assert.ok(Math.abs(spawnDelayForScore(0, () => 1) - 1.0925) < 1e-12);
});

test('score accumulation is frame-rate independent', () => {
  const oneFrame = scoreAfterStep(0, 15, 1);
  const sixtyFrames = Array.from({ length: 60 }).reduce(
    (score) => scoreAfterStep(score, 15, 1 / 60),
    0,
  );
  assert.equal(oneFrame, 75);
  assert.ok(Math.abs(sixtyFrames - oneFrame) < 1e-9);
});

test('collisionHit uses separate lateral and depth tolerances', () => {
  assert.equal(collisionHit({ x: 0, z: 4 }, { x: 0.8, z: 5.1 }, 1, 1.2), true);
  assert.equal(collisionHit({ x: 0, z: 4 }, { x: 1.1, z: 4.2 }, 1, 1.2), false);
  assert.equal(collisionHit({ x: 0, z: 4 }, { x: 0.1, z: 5.3 }, 1, 1.2), false);
});

test('clamp handles either edge', () => {
  assert.equal(clamp(-9, -2, 2), -2);
  assert.equal(clamp(9, -2, 2), 2);
  assert.equal(clamp(1, -2, 2), 1);
});
