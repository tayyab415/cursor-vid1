export interface Clip {
  id: string;
  title: string;
  duration: number; // in seconds
  startTime: number; // Where it sits on the timeline
  sourceStartTime: number; // Where it starts in the original video file
  type?: 'video' | 'image';
  sourceUrl?: string;
  totalDuration?: number; // The full length of the source media file (if applicable)
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
  role: 'user' | 'model' | 'system';
  text: string;
  suggestions?: Suggestion[];
}