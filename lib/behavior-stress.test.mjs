import assert from 'node:assert/strict';
import test from 'node:test';
import { getStressSuggestion } from './behavior-stress.ts';
import { averageAvailableSensorValues } from './telemetry-averages.ts';

const behaviors = {
  reducedFeeding: 0,
  reducedDrinking: 0,
  prolongedInactivity: 0,
  featherPecking: 0,
};

function input(overrides = {}) {
  return {
    birdName: 'Hen1 (Yellow)',
    thiCategory: 'Normal',
    thi: 70,
    tempC: 25,
    humidityPct: 60,
    behaviors,
    ...overrides,
  };
}

test('suggests possible stress only when behavior and elevated THI coincide', () => {
  const result = getStressSuggestion(input({
    thiCategory: 'Moderate',
    thi: 75.2,
    behaviors: { ...behaviors, reducedFeeding: 1, prolongedInactivity: 2 },
  }));

  assert.equal(result.status, 'possible');
  assert.equal(result.label, 'Possible stress indicators');
  assert.match(result.detail, /same six-hour interval/);
  assert.match(result.detail, /might indicate stress/);
  assert.match(result.detail, /does not prove stress or establish a cause/);
});

test('does not make a stress suggestion from elevated THI alone', () => {
  const result = getStressSuggestion(input({ thiCategory: 'Severe', thi: 80 }));

  assert.equal(result.status, 'partial_evidence');
  assert.equal(result.label, 'No correlated suggestion');
});

test('does not make a stress suggestion from behavior flags with normal THI', () => {
  const result = getStressSuggestion(input({
    behaviors: { ...behaviors, reducedDrinking: 1 },
  }));

  assert.equal(result.status, 'partial_evidence');
  assert.equal(result.label, 'No correlated suggestion');
});

test('reports no combined indicators without claiming the bird is stress-free', () => {
  const result = getStressSuggestion(input());

  assert.equal(result.status, 'no_combined_indicators');
  assert.equal(result.label, 'No paired indicators recorded');
  assert.match(result.detail, /does not confirm the bird is stress-free/);
});

test('requires both paired behavior and sensor data', () => {
  const missingBehavior = getStressSuggestion(input({
    thiCategory: 'Emergency',
    thi: 85,
    behaviors: undefined,
  }));

  const missingThi = getStressSuggestion(input({
    thiCategory: 'Unavailable',
    thi: null,
    behaviors: { ...behaviors, reducedFeeding: 1 },
  }));

  assert.equal(missingBehavior.status, 'insufficient_data');
  assert.equal(missingBehavior.label, 'Insufficient paired data');
  assert.equal(missingThi.status, 'insufficient_data');
});

test('does not use legacy pecking counts as stress evidence', () => {
  const result = getStressSuggestion(input({
    thiCategory: 'Moderate',
    thi: 75,
    behaviors: { ...behaviors, featherPecking: 2 },
  }));

  assert.equal(result.status, 'partial_evidence');
});

test('sensor averages ignore missing values without treating them as zero', () => {
  assert.equal(averageAvailableSensorValues([null, 28, undefined]), 28);
  assert.equal(averageAvailableSensorValues([null, undefined]), null);
  assert.equal(averageAvailableSensorValues([0, 10]), 5);
});
