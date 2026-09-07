export const PLAYBACK_EVENT = "vyro:playback";
export const PLAYBACK_TIME_EVENT = "vyro:playback-time";

export type PlaybackCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "seek"; time: number };

export type PlaybackTimeDetail = {
  time: number;
  duration: number;
  playing: boolean;
};

export function dispatchPlayback(command: PlaybackCommand) {
  window.dispatchEvent(new CustomEvent<PlaybackCommand>(PLAYBACK_EVENT, { detail: command }));
}

export function dispatchPlaybackTime(detail: PlaybackTimeDetail) {
  window.dispatchEvent(new CustomEvent<PlaybackTimeDetail>(PLAYBACK_TIME_EVENT, { detail }));
}
