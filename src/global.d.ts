// Debug and test hook exposed on window. Temporary shape: replaced with the real game state later.
interface OverdriveDebugState {
  ready: boolean;
  frames: number;
  scenario: string;
  errors: string[];
}

interface Window {
  __game: OverdriveDebugState;
}
