// Format seconds into hh:mm:ss or mm:ss format
export const formatSecondsToTimestamp = (seconds: number): string => {
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = Math.floor((seconds % 3600) % 60);

  const time = [hh, mm, ss]
    .map((t) => t.toString().padStart(2, '0'))
    .filter((t, i) => t !== '00' || i > 0)
    .join(':');
  return time;
};
