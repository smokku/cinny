import { EventTimelineSet } from 'matrix-js-sdk';

const preprocessingTimelineResets = new WeakSet<EventTimelineSet>();

export const markPreprocessingSlidingSyncTimelineReset = (
  timelineSet: EventTimelineSet,
  reset: () => void
): void => {
  preprocessingTimelineResets.add(timelineSet);
  try {
    reset();
  } finally {
    preprocessingTimelineResets.delete(timelineSet);
  }
};

export const isPreprocessingSlidingSyncTimelineReset = (timelineSet: EventTimelineSet): boolean =>
  preprocessingTimelineResets.has(timelineSet);
