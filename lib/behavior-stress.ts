export type ThiCategory = 'Normal' | 'Moderate' | 'Severe' | 'Emergency' | 'Unavailable';

/**
 * Ethological 4-behavior indicator specifications and thresholds.
 */
export const BEHAVIOR_THRESHOLDS = {
  feedingActivity: {
    indicator: 'Feeding Activity',
    thresholdPct: 0.3,
    condition: 'At or below',
    operator: '<=',
    description: 'Feeding activity at or below 0.3% flags a feeding deficit / stress.',
  },
  drinkingActivity: {
    indicator: 'Drinking Activity',
    thresholdPct: 0.2,
    condition: 'At or below',
    operator: '<=',
    description: 'Drinking activity at or below 0.2% flags a drinking deficit / stress.',
  },
  socialIsolation: {
    indicator: 'Social Isolation',
    thresholdPct: 29.5,
    condition: 'Above',
    operator: '>',
    description: 'Spatial isolation from flock above 29.5% flags social isolation.',
  },
  reducedLocomotor: {
    indicator: 'Reduced Locomotor Activity',
    thresholdPct: 78.0,
    condition: 'Above',
    operator: '>',
    description: 'Inactivity or low velocity above 78% flags reduced locomotor activity.',
  },
} as const;

export interface BehaviorIndicators {
  reducedFeeding: number;
  reducedDrinking: number;
  prolongedInactivity: number;
  featherPecking: number;
  socialIsolation?: number;
  reducedLocomotor?: number;
}

export interface StressSuggestionInput {
  birdName: string;
  thiCategory: ThiCategory;
  thi: number | null;
  tempC: number | null;
  humidityPct: number | null;
  behaviors: BehaviorIndicators | undefined;
}

export interface StressSuggestion {
  status: 'possible' | 'no_combined_indicators' | 'partial_evidence' | 'insufficient_data';
  label: string;
  detail: string;
}

export function getStressSuggestion(input: StressSuggestionInput): StressSuggestion {
  if (
    !input.behaviors ||
    input.thiCategory === 'Unavailable' ||
    input.thi === null ||
    !Number.isFinite(input.thi)
  ) {
    return {
      status: 'insufficient_data',
      label: 'Insufficient paired data',
      detail: `A suggestion for ${input.birdName} requires both behavior records and a sensor-derived THI reading for this interval.`,
    };
  }

  // Legacy featherPecking without socialIsolation is not used as stress evidence
  const locomotorCount = input.behaviors.reducedLocomotor ?? input.behaviors.prolongedInactivity ?? 0;
  const isolationCount = input.behaviors.socialIsolation ?? 0;
  const behaviorSignals = [
    { name: 'reduced feeding', count: input.behaviors.reducedFeeding },
    { name: 'reduced drinking', count: input.behaviors.reducedDrinking },
    { name: 'reduced locomotor activity', count: locomotorCount },
    ...(isolationCount > 0 ? [{ name: 'social isolation', count: isolationCount }] : []),
  ].filter((signal) => Number.isFinite(signal.count) && signal.count > 0);
  const elevatedThi = input.thiCategory !== 'Normal';
  const thiReading = `THI ${input.thi.toFixed(1)} (${input.thiCategory.toLowerCase()})`;
  const sensorContext = [
    input.tempC !== null && Number.isFinite(input.tempC) ? `${input.tempC.toFixed(1)} °C` : null,
    input.humidityPct !== null && Number.isFinite(input.humidityPct)
      ? `${input.humidityPct.toFixed(1)}% humidity`
      : null,
  ].filter((reading): reading is string => reading !== null);
  const sensorDescription = sensorContext.length
    ? `${thiReading}, derived from ${sensorContext.join(' and ')}`
    : thiReading;

  if (elevatedThi && behaviorSignals.length > 0) {
    const behaviorDescription = behaviorSignals.map(({ name }) => name).join(', ');
    return {
      status: 'possible',
      label: 'Possible stress indicators',
      detail: `${input.birdName} had ${behaviorDescription} flags in the same six-hour interval as ${sensorDescription}. This overlap might indicate stress; it does not prove stress or establish a cause. Check the bird directly and consider other conditions.`,
    };
  }

  if (elevatedThi || behaviorSignals.length > 0) {
    const evidence = elevatedThi
      ? `${sensorDescription} was recorded, but no feeding, drinking, or inactivity flag was recorded for ${input.birdName}.`
      : `${input.birdName} had ${behaviorSignals.map(({ name }) => name).join(', ')} flags while THI was normal.`;
    return {
      status: 'partial_evidence',
      label: 'No correlated suggestion',
      detail: `${evidence} Both a behavior indicator and elevated THI are required for a stress suggestion; this does not rule out other causes or stressors.`,
    };
  }

  return {
    status: 'no_combined_indicators',
    label: 'No paired indicators recorded',
    detail: `No feeding, drinking, or inactivity flags were recorded for ${input.birdName}, and THI was normal in this interval. This describes the available data only and does not confirm the bird is stress-free.`,
  };
}
