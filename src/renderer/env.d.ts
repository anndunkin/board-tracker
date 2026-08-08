/// <reference types="vite/client" />
import type { BoardTrackerApi } from '../shared/types';
declare global { interface Window { boardTracker: BoardTrackerApi; } }
export {};
