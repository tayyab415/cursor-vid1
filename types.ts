export interface Clip {
  id: string;
  title: string;
  duration: number; // in seconds
  startTime: number;
}

export interface AnalysisResult {
  summary: string;
  keyEvents: { timestamp: string; description: string }[];
  mood: string;
}

export interface Suggestion {
  label: string;
  description: string;
  reasoning: string;
  clips: Clip[];
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  suggestions?: Suggestion[];
}