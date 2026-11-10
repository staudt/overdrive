// Debug and test hook exposed on window.__game.
interface OverdriveDebugState {
  ready: boolean;
  frames: number;
  scenario: string;
  errors: string[];
  world?: import('./sim/world').World;
  input?: import('./input/input').Input;
  config?: typeof import('./core/config').config;
  renderer?: import('three').WebGLRenderer;
  camera?: import('three').PerspectiveCamera;
}

interface Window {
  __game: OverdriveDebugState;
}
