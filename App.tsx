import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Timeline } from './components/Timeline';
import { CanvasControls } from './components/CanvasControls';
import { Clip, ChatMessage, Suggestion } from './types';
import { analyzeVideoFrames, suggestEdits, generateImage, generateVideo, generateSpeech, generateSubtitles, chatWithGemini } from './services/gemini';
import { extractFramesFromVideo, captureFrameFromVideoUrl, extractAudioFromVideo } from './utils/videoUtils';
import { Video, Wand2, Play, Pause, Loader2, Upload, MessageSquare, RotateCcw, RotateCw, Sparkles, ArrowRight, Scissors, Maximize2, Gauge, ChevronUp, ChevronRight, ChevronLeft, Download, Volume2, VolumeX, X, Image as ImageIcon, Music, Film, Mic, Camera, Trash2, Info, ArrowLeftRight, FileAudio, Captions, Type, Bold, Italic, Underline, Palette, AlignCenter } from 'lucide-react';
import * as Mp4Muxer from 'mp4-muxer';

// Initialize with defaults
const INITIAL_CLIPS: Clip[] = [
  { id: 'c1', title: 'Intro Scene', duration: 5, startTime: 0, sourceStartTime: 0, type: 'video', totalDuration: 60, trackId: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1, volume: 1 },
  { id: 'c2', title: 'Main Action', duration: 8, startTime: 5, sourceStartTime: 5, type: 'video', totalDuration: 60, trackId: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1, volume: 1 },
];

const DEFAULT_TEXT_STYLE = {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 10, // Updated default to 10 as requested
    isBold: true,
    isItalic: false,
    isUnderline: false,
    color: '#ffffff',
    backgroundColor: '#000000',
    backgroundOpacity: 0.0, // Transparent by default
    align: 'center' as const
};

interface HistoryState {
  past: Clip[][];
  present: Clip[];
  future: Clip[][];
}

const MarkdownText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <span className="leading-relaxed">
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-bold text-white/90">{part.slice(2, -2)}</strong>;
        }
        return part;
      })}
    </span>
  );
};

const GeminiLogo = ({ className = "w-6 h-6" }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M16 3C16 3 16.0375 8.525 21.0625 10.9375C16.0375 13.35 16 19 16 19C16 19 15.9625 13.35 11 11C15.9625 8.525 16 3 16 3Z" fill="url(#gemini-gradient)" />
        <path d="M4 11C4 11 4.5 13.5 7 14.5C4.5 15.5 4 18 4 18C4 18 3.5 15.5 1 14.5C3.5 13.5 4 11 4 11Z" fill="url(#gemini-gradient)" />
        <defs>
            <linearGradient id="gemini-gradient" x1="1" y1="3" x2="21" y2="19" gradientUnits="userSpaceOnUse">
                <stop stopColor="#4E75F6" />
                <stop offset="1" stopColor="#E93F33" />
            </linearGradient>
        </defs>
    </svg>
);

export default function App() {
  const [tracks, setTracks] = useState<number[]>([0, 1, 2, 3]);

  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: INITIAL_CLIPS,
    future: []
  });
  
  const clips = history.present;
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]); // Multi-select support
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const clipboardRef = useRef<Clip[]>([]); // Copy/Paste buffer
  
  // Menus
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isCustomSpeed, setIsCustomSpeed] = useState(false);
  const [customSpeedText, setCustomSpeedText] = useState('');
  const [showVolumeMenu, setShowVolumeMenu] = useState(false);
  const [showTextStyleMenu, setShowTextStyleMenu] = useState(false);

  // Generation Modal States
  const [captionStyle, setCaptionStyle] = useState(DEFAULT_TEXT_STYLE);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: 'Hello! I am your AI assistant. Upload a video and I can analyze its content, mood, and key events for you.' }
  ]);
  const [inputText, setInputText] = useState('');
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0); 
  
  // Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // ADD MEDIA MODAL STATE
  const [mediaModalTrackId, setMediaModalTrackId] = useState<number | null>(null);
  const [modalMode, setModalMode] = useState<'initial' | 'generate'>('initial');
  const [genTab, setGenTab] = useState<'image' | 'video' | 'audio'>('image');
  
  // CAPTION MODAL STATE
  const [captionModalOpen, setCaptionModalOpen] = useState(false);
  
  // TRANSITION MODAL STATE
  const [transitionModal, setTransitionModal] = useState<{
      active: boolean;
      clipA: Clip | null;
      clipB: Clip | null;
      startFrame: string | null;
      endFrame: string | null;
      prompt: string;
      model: string;
      resolution: '720p' | '1080p' | '4k';
      duration: '4' | '8';
  }>({
      active: false,
      clipA: null,
      clipB: null,
      startFrame: null,
      endFrame: null,
      prompt: "Smooth cinematic transition between these two shots",
      model: 'veo-3.1-fast-generate-preview',
      resolution: '720p',
      duration: '8' 
  });

  // Generation States
  const [isGenerating, setIsGenerating] = useState(false);
  const [genPrompt, setGenPrompt] = useState('');
  // Image Config
  const [imgModel, setImgModel] = useState<'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview'>('gemini-2.5-flash-image');
  const [imgAspect, setImgAspect] = useState('16:9');
  
  // Video Config (Veo)
  const [vidModel, setVidModel] = useState<string>('veo-3.1-fast-generate-preview');
  const [vidResolution, setVidResolution] = useState<'720p' | '1080p' | '4k'>('720p');
  const [vidAspect, setVidAspect] = useState('16:9');
  const [vidDuration, setVidDuration] = useState<'4' | '8'>('4');
  const [veoStartImg, setVeoStartImg] = useState<string | null>(null);
  const [veoEndImg, setVeoEndImg] = useState<string | null>(null);

  // Audio Config
  const [audioVoice, setAudioVoice] = useState('Kore');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null); 
  const canvasRef = useRef<HTMLCanvasElement>(null); 
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceImageInputRef = useRef<HTMLInputElement>(null);
  const mediaRefs = useRef<{[key: string]: HTMLVideoElement | HTMLAudioElement | null}>({});
  const currentTimeRef = useRef(currentTime);

  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Enforce Veo Logic Constraints for Generator Tab
  useEffect(() => {
    const isHighRes = vidResolution === '1080p' || vidResolution === '4k';
    const hasRefImages = !!veoStartImg || !!veoEndImg;
    if (isHighRes || hasRefImages) { if (vidDuration !== '8') setVidDuration('8'); }
  }, [vidResolution, veoStartImg, veoEndImg, vidDuration]);

  // --- DRAWING HELPER ---
  const drawClipToCanvas = (ctx: CanvasRenderingContext2D, clip: Clip, source: CanvasImageSource, containerW: number, containerH: number) => {
      const transform = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
      
      ctx.save();
      ctx.translate(containerW / 2, containerH / 2);
      ctx.translate(transform.x * containerW, transform.y * containerH);
      ctx.scale(transform.scale, transform.scale);
      ctx.rotate((transform.rotation * Math.PI) / 180);

      if (clip.type === 'text' && clip.text) {
          const style = clip.textStyle || DEFAULT_TEXT_STYLE;
          const fontWeight = style.isBold ? 'bold' : 'normal';
          const fontStyle = style.isItalic ? 'italic' : 'normal';
          
          ctx.font = `${fontStyle} ${fontWeight} ${style.fontSize}px ${style.fontFamily || 'Plus Jakarta Sans'}, sans-serif`;
          ctx.textAlign = style.align || 'center';
          ctx.textBaseline = 'middle';
          
          const lines = clip.text.split('\n');
          const metrics = ctx.measureText(lines[0]); 
          const lineHeight = style.fontSize * 1.2;
          const bgWidth = metrics.width + (style.fontSize * 0.5);
          const bgHeight = lineHeight * lines.length + (style.fontSize * 0.2);

          if (style.backgroundOpacity > 0) {
              const prevAlpha = ctx.globalAlpha;
              ctx.globalAlpha = style.backgroundOpacity;
              ctx.fillStyle = style.backgroundColor;
              ctx.fillRect(-bgWidth/2, -bgHeight/2, bgWidth, bgHeight);
              ctx.globalAlpha = prevAlpha;
          }

          ctx.fillStyle = style.color;
          lines.forEach((line, i) => {
              const yOffset = (i - (lines.length - 1) / 2) * lineHeight;
              if (style.backgroundOpacity < 0.5) {
                  ctx.strokeStyle = 'black';
                  ctx.lineWidth = style.fontSize / 15;
                  ctx.strokeText(line, 0, yOffset);
              }
              ctx.fillText(line, 0, yOffset);
              if (style.isUnderline) {
                  const lineWidth = ctx.measureText(line).width;
                  ctx.fillRect(-lineWidth / 2, yOffset + style.fontSize/2, lineWidth, style.fontSize/15);
              }
          });
      } else {
        let srcW = 0, srcH = 0;
        if (source instanceof HTMLVideoElement) { srcW = source.videoWidth; srcH = source.videoHeight; } 
        else if (source instanceof HTMLImageElement) { srcW = source.naturalWidth; srcH = source.naturalHeight; }

        if (srcW && srcH) {
            const aspectSrc = srcW / srcH;
            const aspectDest = containerW / containerH;
            let drawW, drawH;
            if (aspectSrc > aspectDest) { drawW = containerW; drawH = containerW / aspectSrc; } 
            else { drawH = containerH; drawW = containerH * aspectSrc; }
            ctx.drawImage(source, -drawW/2, -drawH/2, drawW, drawH);
        }
      }
      ctx.restore();
  };

  const captureCurrentFrame = async (): Promise<string | null> => {
      if (!containerRef.current) return null;
      const width = 1280; const height = 720;
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); if (!ctx) return null;
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, width, height);
      const visible = clips.filter(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration).sort((a, b) => a.trackId - b.trackId);
      for (const clip of visible) {
           if (clip.type === 'audio') continue;
           if (clip.type === 'text') { drawClipToCanvas(ctx, clip, canvas as any, width, height); } 
           else {
               const el = mediaRefs.current[clip.id] as HTMLVideoElement | null;
               if (clip.type === 'video' && el) { drawClipToCanvas(ctx, clip, el, width, height); } 
               else if (clip.type === 'image') {
                   const img = new Image(); img.crossOrigin = "anonymous"; img.src = clip.sourceUrl || '';
                   await new Promise((resolve) => { if (img.complete) resolve(true); img.onload = () => resolve(true); img.onerror = () => resolve(false); });
                   drawClipToCanvas(ctx, clip, img, width, height);
               }
           }
      }
      return canvas.toDataURL('image/jpeg', 0.8);
  };

  useEffect(() => {
    if (!isPlaying) return;
    let animationFrameId: number;
    let lastTimestamp: number;
    const loop = (timestamp: number) => {
        if (!lastTimestamp) lastTimestamp = timestamp;
        const delta = (timestamp - lastTimestamp) / 1000;
        lastTimestamp = timestamp;
        let masterTimeDelta = delta;
        let syncedToMaster = false;
        let masterClipId: string | null = null;
        const currentT = currentTimeRef.current;
        const activeMediaClip = clips.filter(c => (c.type === 'video' || c.type === 'audio') && currentT >= c.startTime && currentT < c.startTime + c.duration).sort((a, b) => b.trackId - a.trackId)[0];
        if (activeMediaClip) {
             const el = mediaRefs.current[activeMediaClip.id];
             const speed = activeMediaClip.speed || 1;
             if (el && !el.paused && !el.seeking && el.readyState > 2) {
                 const timeInClip = el.currentTime - activeMediaClip.sourceStartTime;
                 const calculatedTimelineTime = activeMediaClip.startTime + (timeInClip / speed);
                 const syncTolerance = Math.max(0.5, 0.2 * speed);
                 if (Math.abs(calculatedTimelineTime - currentT) < syncTolerance) { masterTimeDelta = calculatedTimelineTime - currentT; if (masterTimeDelta > 0 && masterTimeDelta < 1.0) { syncedToMaster = true; masterClipId = activeMediaClip.id; } }
             }
        }
        let nextTime = syncedToMaster ? currentT + masterTimeDelta : currentT + delta;
        const maxDuration = clips.reduce((acc, c) => Math.max(acc, c.startTime + c.duration), 0);
        if (nextTime >= maxDuration) { nextTime = maxDuration; setIsPlaying(false); setCurrentTime(0); return; }
        setCurrentTime(nextTime);
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            const width = canvasRef.current.width;
            const height = canvasRef.current.height;
            if (ctx) {
                ctx.clearRect(0, 0, width, height); 
                const visible = clips.filter(c => nextTime >= c.startTime && nextTime < c.startTime + c.duration).sort((a, b) => a.trackId - b.trackId);
                visible.forEach(clip => {
                    if (clip.type === 'audio') return; 
                    if (clip.type === 'text') { drawClipToCanvas(ctx, clip, canvasRef.current as any, width, height); } 
                    else {
                        const el = mediaRefs.current[clip.id] as HTMLVideoElement | null;
                        if (clip.type === 'video' && el) { drawClipToCanvas(ctx, clip, el, width, height); } 
                        else if (clip.type === 'image') { const img = new Image(); img.src = clip.sourceUrl || ''; if (img.complete) drawClipToCanvas(ctx, clip, img, width, height); }
                    }
                });
            }
        }
        const visibleClips = clips.filter(c => nextTime >= c.startTime && nextTime < c.startTime + c.duration);
        visibleClips.forEach(clip => {
            if ((clip.type === 'video' || clip.type === 'audio') && mediaRefs.current[clip.id]) {
                const el = mediaRefs.current[clip.id];
                if (el) {
                        if (el.muted) el.muted = false;
                        const speed = clip.speed || 1;
                        if (Math.abs(el.playbackRate - speed) > 0.05) el.playbackRate = speed;
                        const targetVolume = clip.volume ?? 1;
                        if (Math.abs(el.volume - targetVolume) > 0.01) el.volume = targetVolume;
                        if (el.paused) el.play().catch(() => {});
                        const isMaster = syncedToMaster && masterClipId === clip.id;
                        if (!isMaster) {
                            const offsetInClip = nextTime - clip.startTime;
                            const targetSourceTime = clip.sourceStartTime + (offsetInClip * speed);
                            const safeTargetTime = Math.max(0, Math.min(el.duration || Infinity, targetSourceTime));
                            const drift = el.currentTime - safeTargetTime;
                            let tolerance = 0.25; if (speed > 2) tolerance = 0.5;
                            if (Math.abs(drift) > tolerance) { if (el.readyState >= 1) { el.currentTime = safeTargetTime; } }
                        }
                }
            }
        });
        clips.forEach(clip => { if (clip.type === 'video' || clip.type === 'audio') { const isVisible = nextTime >= clip.startTime && nextTime < clip.startTime + clip.duration; const el = mediaRefs.current[clip.id]; if (!isVisible && el && !el.paused) { el.pause(); } } });
        animationFrameId = requestAnimationFrame(loop);
    };
    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, clips]);

  useEffect(() => {
      if (isPlaying || isExporting) return;
      const visibleClips = clips.filter(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration);
      visibleClips.forEach(clip => {
           if ((clip.type === 'video' || clip.type === 'audio') && mediaRefs.current[clip.id]) {
              const el = mediaRefs.current[clip.id];
              if (el) {
                  el.pause(); if (el.muted) el.muted = false;
                  const speed = clip.speed || 1;
                  const offsetInClip = currentTime - clip.startTime;
                  const targetTime = clip.sourceStartTime + (offsetInClip * speed);
                  const safeTargetTime = Math.max(0, Math.min(el.duration || Infinity, targetTime));
                  const targetVolume = clip.volume ?? 1;
                  if (Math.abs(el.volume - targetVolume) > 0.01) el.volume = targetVolume;
                  if (Math.abs(el.currentTime - safeTargetTime) > 0.1) { if (el.readyState >= 1) { el.currentTime = safeTargetTime; } }
              }
           }
      });
  }, [isPlaying, isExporting, currentTime, clips]);

  const handleExport = async () => { alert("Full audio mixing export not supported in demo. Visual export only."); };
  const setClipsWithHistory = (newClips: Clip[]) => { setHistory(curr => ({ past: [...curr.past, curr.present], present: newClips, future: [] })); };
  const handleUpdateClipTransform = (id: string, newTransform: NonNullable<Clip['transform']>) => {
      setHistory(curr => {
          const index = curr.present.findIndex(c => c.id === id);
          if (index === -1) return curr;
          const newClips = [...curr.present];
          newClips[index] = { ...newClips[index], transform: newTransform };
          return { ...curr, present: newClips };
      });
  };
  const handleClipSpeed = (id: string, newSpeed: number) => {
      setHistory(curr => {
        const clipIndex = curr.present.findIndex(c => c.id === id);
        if (clipIndex === -1) return curr;
        const clip = curr.present[clipIndex];
        const oldSpeed = clip.speed || 1;
        const currentSourceDuration = clip.duration * oldSpeed;
        const newDuration = currentSourceDuration / newSpeed;
        const updatedClip = { ...clip, speed: newSpeed, duration: newDuration };
        const newClips = [...curr.present];
        newClips[clipIndex] = updatedClip;
        const trackClips = newClips.filter(c => c.trackId === clip.trackId);
        trackClips.sort((a, b) => a.startTime - b.startTime);
        let accumulated = 0;
        const normalizedTrack = trackClips.map(c => {
            const n = { ...c, startTime: accumulated };
            accumulated += c.duration;
            return n;
        });
        const otherClips = newClips.filter(c => c.trackId !== clip.trackId);
        return { past: [...curr.past, curr.present], present: [...otherClips, ...normalizedTrack], future: [] };
      });
      setShowSpeedMenu(false); setIsCustomSpeed(false);
  };
  const handleClipVolume = (id: string, newVolume: number) => {
      setHistory(curr => {
          const index = curr.present.findIndex(c => c.id === id);
          if (index === -1) return curr;
          const newClips = [...curr.present];
          newClips[index] = { ...newClips[index], volume: newVolume };
          return { ...curr, present: newClips };
      });
  };

  // --- TEXT STYLE HANDLERS ---
  const handleUpdateTextStyle = (updates: Partial<NonNullable<Clip['textStyle']>>) => {
      setHistory(curr => {
          const newClips = curr.present.map(clip => {
              if (selectedClipIds.includes(clip.id) && clip.type === 'text') {
                  const currentStyle = clip.textStyle || DEFAULT_TEXT_STYLE;
                  return { ...clip, textStyle: { ...currentStyle, ...updates } };
              }
              return clip;
          });
          return { ...curr, present: newClips };
      });
  };

  const handleUpdateTextContent = (id: string, newText: string) => {
      setHistory(curr => {
          const index = curr.present.findIndex(c => c.id === id);
          if (index === -1) return curr;
          const newClips = [...curr.present];
          newClips[index] = { ...newClips[index], text: newText };
          return { ...curr, present: newClips };
      });
  };

  const handleUndo = useCallback(() => { setHistory(curr => { if (curr.past.length === 0) return curr; const previous = curr.past[curr.past.length - 1]; const newPast = curr.past.slice(0, -1); return { past: newPast, present: previous, future: [curr.present, ...curr.future] }; }); }, []);
  const handleRedo = useCallback(() => { setHistory(curr => { if (curr.future.length === 0) return curr; const next = curr.future[0]; const newFuture = curr.future.slice(1); return { past: [...curr.past, curr.present], present: next, future: newFuture }; }); }, []);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const handleAddTrack = (position: 'top' | 'bottom') => {
      let nextId = 0;
      if (position === 'top') { nextId = tracks.length > 0 ? Math.max(...tracks) + 1 : 0; } 
      else { nextId = tracks.length > 0 ? Math.min(...tracks) - 1 : 0; }
      const newTracks = [...tracks, nextId].sort((a, b) => a - b);
      setTracks(newTracks);
  };
  const handleDelete = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setHistory(curr => {
        const remainingClips = curr.present.filter(c => !ids.includes(c.id));
        return { past: [...curr.past, curr.present], present: remainingClips, future: [] };
    });
    setSelectedClipIds(prev => prev.filter(i => !ids.includes(i)));
  }, []);

  const handleSelectClip = (id: string, e?: React.MouseEvent) => {
      if (e?.shiftKey) {
          setSelectedClipIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
      } else {
          setSelectedClipIds([id]);
      }
      setShowSpeedMenu(false); setIsCustomSpeed(false); setShowVolumeMenu(false); setShowTextStyleMenu(false);
  };

  // --- REORDER/SPLIT/RESIZE/ETC Handlers ---
  const handleClipReorder = (sourceId: string, newStartTime: number, targetTrackId: number, commit: boolean = true) => {
      setHistory(curr => {
          const sourceClip = curr.present.find(c => c.id === sourceId); 
          if (!sourceClip) return curr;
          
          const updatedSource = { ...sourceClip, trackId: targetTrackId, startTime: newStartTime };
          const remaining = curr.present.filter(c => c.id !== sourceId);
          
          // No sorting or magnetizing. Just update position.
          const finalClips = [...remaining, updatedSource];
          
          if (!commit) return { ...curr, present: finalClips };
          return { past: [...curr.past, curr.present], present: finalClips, future: [] };
      });
  };

  const handleSplitClip = () => {
      // Prioritize primary selected clip or finding one at playhead
      const clipId = selectedClipIds[selectedClipIds.length - 1];
      const clip = clips.find(c => c.id === clipId) || clips.find(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration);
      if (!clip) return;
      const offset = currentTime - clip.startTime;
      if (offset <= 0.1 || offset >= clip.duration - 0.1) return;
      const speed = clip.speed || 1;
      const newClip1: Clip = { ...clip, duration: offset, id: crypto.randomUUID() };
      const newClip2: Clip = { ...clip, id: crypto.randomUUID(), startTime: clip.startTime + offset, duration: clip.duration - offset, sourceStartTime: clip.sourceStartTime + (offset * speed), title: `${clip.title} (Split)` };
      setHistory(curr => {
          const index = curr.present.findIndex(c => c.id === clip.id);
          const newClips = [...curr.present];
          newClips.splice(index, 1, newClip1, newClip2);
          return { past: [...curr.past, curr.present], present: newClips, future: [] };
      });
  };

  const handleClipResize = (id: string, newDuration: number, trimMode: 'start' | 'end', commit: boolean) => {
     setHistory(curr => {
        const clip = curr.present.find(c => c.id === id); if (!clip) return curr;
        const speed = clip.speed || 1; 
        let updated = { ...clip };

        if (trimMode === 'end') { 
            if (clip.type === 'video' && clip.totalDuration) { 
                const maxDur = (clip.totalDuration - clip.sourceStartTime) / speed; 
                updated.duration = Math.min(newDuration, maxDur); 
            } else { 
                updated.duration = newDuration; 
            } 
        } else { 
            // Handle Start Trim logic without magnetization
            const durationDiff = clip.duration - newDuration; // + if shrinking, - if growing
            const proposedSourceStart = clip.sourceStartTime + (durationDiff * speed);
            
            if (proposedSourceStart < 0) {
                // Hit file start
                updated.sourceStartTime = 0;
                const maxExtension = clip.sourceStartTime / speed;
                updated.duration = clip.duration + maxExtension;
                updated.startTime = clip.startTime - maxExtension;
            } else {
                updated.sourceStartTime = proposedSourceStart;
                updated.duration = newDuration;
                updated.startTime = clip.startTime + durationDiff;
            }
        }
        
        // Update only the specific clip, remove all magnetic re-layout logic
        const newClips = curr.present.map(c => c.id === id ? updated : c);
        
        if (!commit) return { ...curr, present: newClips };
        return { past: [...curr.past, curr.present], present: newClips, future: [] };
     });
  };

  const togglePlay = useCallback(() => setIsPlaying(p => !p), []);

  const handleCanvasClick = (e: React.MouseEvent) => {
      if (e.target === containerRef.current || e.target === e.currentTarget) {
          setSelectedClipIds([]); setShowSpeedMenu(false); setIsCustomSpeed(false); setShowVolumeMenu(false); setShowTextStyleMenu(false);
      }
  };

  const handleGenerateCaptions = async () => {
      let targetFile: File | Blob | null = videoFile;
      if (!targetFile) {
          const videoClip = clips.find(c => c.type === 'video' && c.sourceUrl);
          if (videoClip && videoClip.sourceUrl) {
              try { const response = await fetch(videoClip.sourceUrl); targetFile = await response.blob(); } catch (e) { console.error(e); }
          }
      }
      if (!targetFile) return;
      setIsGenerating(true);
      try {
          const audioBase64 = await extractAudioFromVideo(targetFile);
          const subtitles = await generateSubtitles(audioBase64);
          if (!subtitles.length) { setMessages(prev => [...prev, { role: 'system', text: `⚠️ No subtitles were generated. Audio might be unclear.` }]); setIsGenerating(false); setCaptionModalOpen(false); return; }
          const subtitleTrackId = tracks[tracks.length - 1] + 1;
          if (!tracks.includes(subtitleTrackId)) setTracks(prev => [...prev, subtitleTrackId]);
          const newClips = subtitles.map(sub => ({
              id: crypto.randomUUID(),
              title: sub.text,
              startTime: sub.start,
              sourceStartTime: 0,
              type: 'text' as const,
              text: sub.text,
              textStyle: { ...captionStyle }, 
              trackId: subtitleTrackId,
              duration: sub.end - sub.start,
              transform: { x: 0, y: 0.35, scale: 1, rotation: 0 },
              speed: 1, volume: 1
          }));
          setClipsWithHistory([...clips, ...newClips]);
          setMessages(prev => [...prev, { role: 'system', text: `✨ Generated ${newClips.length} subtitle segments` }]);
          setCaptionModalOpen(false);
      } catch (e: any) { console.error(e); setMessages(prev => [...prev, { role: 'system', text: `❌ Subtitle Error: ${e.message}` }]); } 
      finally { setIsGenerating(false); }
  };

  const availableVideo = videoFile || clips.find(c => c.type === 'video');
  const visibleClips = clips.filter(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration).sort((a, b) => a.trackId - b.trackId); 
  const selectedClips = clips.filter(c => selectedClipIds.includes(c.id));
  const primarySelectedClip = selectedClips.length > 0 ? selectedClips[selectedClips.length - 1] : null;
  const isSelectedClipVisible = primarySelectedClip && visibleClips.some(vc => vc.id === primarySelectedClip.id);
  const isMultiSelection = selectedClipIds.length > 1;
  const allSelectedAreText = selectedClips.length > 0 && selectedClips.every(c => c.type === 'text');
  const allSelectedAreMedia = selectedClips.length > 0 && selectedClips.every(c => c.type === 'video' || c.type === 'audio');

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) { setVideoFile(file); const url = URL.createObjectURL(file); setVideoUrl(url); setMessages(prev => [...prev, { role: 'model', text: `Loaded **${file.name}**. Click "Analyze Video" to process it with **Gemini 3 Pro**.` }]); setCurrentTime(0); setIsPlaying(false); setHasAnalyzed(false); } };
  const handleTransitionRequest = async (clipA: Clip, clipB: Clip) => { let startFrame = null; if (clipA.type === 'image' && clipA.sourceUrl) startFrame = clipA.sourceUrl; else if (clipA.type === 'video' && clipA.sourceUrl) { const endTime = clipA.sourceStartTime + (clipA.duration * (clipA.speed || 1)); try { startFrame = await captureFrameFromVideoUrl(clipA.sourceUrl, endTime); } catch (e) { console.error(e); } } let endFrame = null; if (clipB.type === 'image' && clipB.sourceUrl) endFrame = clipB.sourceUrl; else if (clipB.type === 'video' && clipB.sourceUrl) { const startTime = clipB.sourceStartTime; try { endFrame = await captureFrameFromVideoUrl(clipB.sourceUrl, startTime); } catch (e) { console.error(e); } } if (startFrame && endFrame) { setTransitionModal({ active: true, clipA, clipB, startFrame, endFrame, prompt: "Smooth cinematic transition between these two shots", model: 'veo-3.1-fast-generate-preview', resolution: '720p', duration: '8' }); } else { setMessages(prev => [...prev, { role: 'system', text: `❌ Could not extract frames for transition.` }]); } };
  const handleGenerateTransition = async () => { if (!transitionModal.clipA || !transitionModal.clipB || !transitionModal.startFrame || !transitionModal.endFrame) return; setIsGenerating(true); try { const videoUrl = await generateVideo(transitionModal.prompt, transitionModal.model, '16:9', transitionModal.resolution, 8, transitionModal.startFrame, transitionModal.endFrame); const tempVideo = document.createElement('video'); tempVideo.src = videoUrl; await new Promise(r => { tempVideo.onloadedmetadata = r; tempVideo.onerror = r; }); const duration = tempVideo.duration || 8; const transitionClip: Clip = { id: crypto.randomUUID(), title: `Transition`, startTime: transitionModal.clipA.startTime + transitionModal.clipA.duration, sourceStartTime: 0, type: 'video', sourceUrl: videoUrl, trackId: transitionModal.clipA.trackId, duration: duration, totalDuration: duration, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1, volume: 1 }; const currentClips = clips; const trackId = transitionModal.clipA.trackId; const insertionTime = transitionClip.startTime; const trackClips = currentClips.filter(c => c.trackId === trackId); const laterClips = trackClips.filter(c => c.startTime >= insertionTime); const shiftedLaterClips = laterClips.map(c => ({ ...c, startTime: c.startTime + duration })); const otherTracks = currentClips.filter(c => c.trackId !== trackId); const earlierClips = trackClips.filter(c => c.startTime < insertionTime); const finalClips = [...otherTracks, ...earlierClips, transitionClip, ...shiftedLaterClips]; setClipsWithHistory(finalClips); setMessages(prev => [...prev, { role: 'system', text: `✨ Generated transition between "${transitionModal.clipA?.title}" and "${transitionModal.clipB?.title}"` }]); setTransitionModal(prev => ({ ...prev, active: false })); } catch (e: any) { console.error(e); setMessages(prev => [...prev, { role: 'system', text: `❌ Transition Error: ${e.message}` }]); } finally { setIsGenerating(false); } };
  const handleOpenMediaModal = (trackId: number) => { setMediaModalTrackId(trackId); setModalMode('initial'); setGenTab('image'); setGenPrompt(''); setVeoStartImg(null); setVeoEndImg(null); };
  const handleCloseMediaModal = () => { setMediaModalTrackId(null); setIsGenerating(false); };
  const triggerLocalUpload = () => { if (fileInputRef.current) fileInputRef.current.click(); };
  const handleVeoReferenceUpload = (target: 'start' | 'end') => { if (referenceImageInputRef.current) { referenceImageInputRef.current.setAttribute('data-target', target); referenceImageInputRef.current.click(); } };
  const handleReferenceImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; const target = e.target.getAttribute('data-target'); if (file && target) { const reader = new FileReader(); reader.onload = (ev) => { if (ev.target?.result) { if (target === 'start') setVeoStartImg(ev.target.result as string); else if (target === 'end') setVeoEndImg(ev.target.result as string); } }; reader.readAsDataURL(file); } e.target.value = ''; };
  const handleCaptureFrame = async (target: 'start' | 'end') => { const base64 = await captureCurrentFrame(); if (base64) { if (target === 'start') setVeoStartImg(base64); else setVeoEndImg(base64); } else { alert("Could not capture frame. Ensure content is visible."); } };
  const handleGenerate = async () => { if ((genTab !== 'video' && !genPrompt.trim()) || mediaModalTrackId === null) return; if (genTab === 'video' && !genPrompt.trim() && !veoStartImg) return; setIsGenerating(true); try { const trackId = mediaModalTrackId; const trackClips = clips.filter(c => c.trackId === trackId); const trackEndTime = trackClips.reduce((acc, c) => Math.max(acc, c.startTime + c.duration), 0); let newClip: Clip; if (genTab === 'image') { const base64Image = await generateImage(genPrompt, imgModel, imgAspect); newClip = { id: crypto.randomUUID(), title: `Img: ${genPrompt.slice(0, 10)}...`, startTime: trackEndTime, sourceStartTime: 0, type: 'image', sourceUrl: base64Image, trackId: trackId, duration: 3, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1, volume: 1 }; } else if (genTab === 'video') { const videoUrl = await generateVideo(genPrompt, vidModel, vidAspect, vidResolution, parseInt(vidDuration), veoStartImg, veoEndImg); const tempVideo = document.createElement('video'); tempVideo.src = videoUrl; await new Promise(r => { tempVideo.onloadedmetadata = r; tempVideo.onerror = r; }); newClip = { id: crypto.randomUUID(), title: `Veo: ${genPrompt ? genPrompt.slice(0, 10) : 'Img2Vid'}...`, startTime: trackEndTime, sourceStartTime: 0, type: 'video', sourceUrl: videoUrl, trackId: trackId, duration: tempVideo.duration || 5, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1, volume: 1 }; } else { const wavUrl = await generateSpeech(genPrompt, audioVoice); const tempAudio = document.createElement('audio'); tempAudio.src = wavUrl; await new Promise(r => { tempAudio.onloadedmetadata = r; tempAudio.onerror = r; }); newClip = { id: crypto.randomUUID(), title: `TTS: ${genPrompt.slice(0, 10)}...`, startTime: trackEndTime, sourceStartTime: 0, type: 'audio', sourceUrl: wavUrl, trackId: trackId, duration: tempAudio.duration || 3, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1, volume: 1 }; } setClipsWithHistory([...clips, newClip]); setMessages(prev => [...prev, { role: 'system', text: `✨ Generated ${genTab} for Track ${trackId + 1}` }]); setMediaModalTrackId(null); } catch (e: any) { console.error(e); setMessages(prev => [...prev, { role: 'system', text: `❌ Generation Error: ${e.message}` }]); } finally { setIsGenerating(false); } };
  const handleSeek = (time: number) => { const newTime = Math.max(0, time); setCurrentTime(newTime); const visibleClips = clips.filter(c => newTime >= c.startTime && newTime < c.startTime + c.duration); visibleClips.forEach(clip => { if ((clip.type === 'video' || clip.type === 'audio') && mediaRefs.current[clip.id]) { const el = mediaRefs.current[clip.id]; if (el) { const speed = clip.speed || 1; const offsetInClip = newTime - clip.startTime; el.currentTime = clip.sourceStartTime + (offsetInClip * speed); } } }); };
  const handleAddMedia = async (event: React.ChangeEvent<HTMLInputElement>) => { const trackId = mediaModalTrackId; if (trackId === null || !event.target.files?.length) return; const files = Array.from(event.target.files) as File[]; const trackClips = clips.filter(c => c.trackId === trackId); let currentTrackEndTime = trackClips.reduce((acc, c) => Math.max(acc, c.startTime + c.duration), 0); const newClips: Clip[] = []; let firstVideoSet = false; for (const file of files) { const isImage = file.type.startsWith('image/'); const isVideo = file.type.startsWith('video/'); const isAudio = file.type.startsWith('audio/'); if (!isImage && !isVideo && !isAudio) continue; const url = URL.createObjectURL(file); const duration = await getMediaDuration(file); if (isVideo && !videoFile && !firstVideoSet) { setVideoFile(file); setVideoUrl(url); setHasAnalyzed(false); firstVideoSet = true; } newClips.push({ id: crypto.randomUUID(), title: file.name, startTime: currentTrackEndTime, sourceStartTime: 0, sourceUrl: url, trackId: trackId, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1, volume: 1, type: isImage ? 'image' : (isAudio ? 'audio' : 'video'), duration: duration, totalDuration: (isVideo || isAudio) ? duration : undefined }); currentTrackEndTime += duration; } if (newClips.length > 0) { setClipsWithHistory([...clips, ...newClips]); setMessages(prev => [...prev, { role: 'system', text: `Added ${newClips.length} items to Track ${trackId + 1}` }]); } setMediaModalTrackId(null); if (fileInputRef.current) fileInputRef.current.value = ''; };
  const getMediaDuration = (file: File): Promise<number> => { return new Promise((resolve) => { if (file.type.startsWith('image/')) { resolve(3); return; } const element = file.type.startsWith('audio/') ? document.createElement('audio') : document.createElement('video'); element.preload = 'metadata'; element.onloadedmetadata = () => { resolve(element.duration || 5); }; element.onerror = () => { resolve(5); }; element.src = URL.createObjectURL(file); }); };
  const formatTime = (seconds: number) => { const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60); const ms = Math.floor((seconds % 1) * 100); return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`; };
  
  const getVeoMode = () => { if (veoStartImg && veoEndImg) return { label: 'Interpolation', color: 'border-purple-500/50 text-purple-300 bg-purple-500/10' }; if (veoStartImg) return { label: 'Image-to-Video', color: 'border-blue-500/50 text-blue-300 bg-blue-500/10' }; return { label: 'Text-to-Video', color: 'border-neutral-700 text-neutral-400 bg-neutral-800' }; };
  const { label: veoModeLabel, color: veoModeColor } = getVeoMode();

  const handleSendMessage = async () => { if (!inputText.trim()) return; const userMessage: ChatMessage = { role: 'user', text: inputText }; setMessages(prev => [...prev, userMessage]); setInputText(''); setIsAnalyzing(true); try { if (videoFile && (inputText.toLowerCase().includes('analyze') || inputText.toLowerCase().includes('review'))) { setMessages(prev => [...prev, { role: 'system', text: "Analyzing video frames... (this uses Gemini 3 Pro Vision)" }]); const frames = await extractFramesFromVideo(videoFile, 10); const result = await analyzeVideoFrames(frames, inputText); setMessages(prev => [...prev, { role: 'model', text: result }]); } else if (inputText.toLowerCase().includes('suggest') || inputText.toLowerCase().includes('edit')) { setMessages(prev => [...prev, { role: 'system', text: "Reviewing timeline for edit suggestions..." }]); const suggestions = await suggestEdits(clips); const text = suggestions.map((s, i) => `**${i+1}. ${s.label}**\n${s.description}`).join('\n\n'); setMessages(prev => [...prev, { role: 'model', text: text }]); } else { const response = await chatWithGemini(messages, inputText); setMessages(prev => [...prev, { role: 'model', text: response }]); } } catch (error: any) { console.error(error); setMessages(prev => [...prev, { role: 'system', text: `Error: ${error.message}` }]); } finally { setIsAnalyzing(false); } };
  
  // Hotkeys Effect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;

        // Space -> Play/Pause
        if (e.code === 'Space') {
            e.preventDefault();
            togglePlay();
        }

        // Delete / Backspace
        if (e.code === 'Delete' || e.code === 'Backspace') {
            if (selectedClipIds.length > 0) {
                e.preventDefault();
                handleDelete(selectedClipIds);
            }
        }

        // Escape -> Deselect
        if (e.code === 'Escape') {
            e.preventDefault();
            setSelectedClipIds([]);
        }

        // Select All (Cmd+A)
        if ((e.metaKey || e.ctrlKey) && e.code === 'KeyA') {
            e.preventDefault();
            setSelectedClipIds(clips.map(c => c.id));
        }

        // Copy (Cmd+C)
        if ((e.metaKey || e.ctrlKey) && e.code === 'KeyC') {
            e.preventDefault();
            const toCopy = clips.filter(c => selectedClipIds.includes(c.id));
            if (toCopy.length > 0) {
                clipboardRef.current = toCopy;
            }
        }

        // Paste (Cmd+V)
        if ((e.metaKey || e.ctrlKey) && e.code === 'KeyV') {
            e.preventDefault();
            const toPaste = clipboardRef.current;
            if (toPaste.length > 0) {
                const earliestStart = Math.min(...toPaste.map(c => c.startTime));
                const offset = currentTime - earliestStart;
                
                const newClips = toPaste.map(clip => ({
                    ...clip,
                    id: crypto.randomUUID(),
                    startTime: Math.max(0, clip.startTime + offset),
                    trackId: clip.trackId 
                }));

                setHistory(curr => ({
                    past: [...curr.past, curr.present],
                    present: [...curr.present, ...newClips],
                    future: []
                }));
                setSelectedClipIds(newClips.map(c => c.id));
            }
        }

        // Cut (Cmd+X)
        if ((e.metaKey || e.ctrlKey) && e.code === 'KeyX') {
            e.preventDefault();
            const toCopy = clips.filter(c => selectedClipIds.includes(c.id));
            if (toCopy.length > 0) {
                clipboardRef.current = toCopy;
                handleDelete(selectedClipIds);
            }
        }

        // Undo (Cmd+Z)
        if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey) {
            e.preventDefault();
            if (canUndo) handleUndo();
        }

        // Redo (Cmd+Shift+Z)
        if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && e.shiftKey) {
            e.preventDefault();
            if (canRedo) handleRedo();
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clips, selectedClipIds, currentTime, isPlaying, canUndo, canRedo, handleDelete, handleUndo, handleRedo, togglePlay]);

  // Reused Controls for Caption Modal
  const TextControls = ({ values, onChange }: { values: any, onChange: (u: any) => void }) => (
      <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1"><label className="text-[10px] text-neutral-500 uppercase font-semibold mb-1 block">Font</label><select value={values.fontFamily || 'Plus Jakarta Sans'} onChange={(e) => onChange({ fontFamily: e.target.value })} className="w-full bg-neutral-900 border border-neutral-700 rounded text-xs text-white py-1.5 px-2 focus:outline-none focus:border-blue-500"><option value="Plus Jakarta Sans">Plus Jakarta Sans</option><option value="Google Sans Flex">Google Sans Flex</option><option value="Helvetica">Helvetica</option><option value="Arial">Arial</option><option value="Times New Roman">Times New Roman</option><option value="Courier New">Courier New</option></select></div>
              <div className="col-span-2 sm:col-span-1"><label className="text-[10px] text-neutral-500 uppercase font-semibold mb-1 block">Size</label><div className="flex items-center gap-2"><input type="range" min="6" max="18" step="1" value={Math.min(Math.max(values.fontSize || 10, 6), 18)} onChange={(e) => onChange({ fontSize: parseInt(e.target.value) })} className="flex-1 h-1.5 bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-blue-500" /><input type="number" min="1" value={values.fontSize || 10} onChange={(e) => onChange({ fontSize: parseInt(e.target.value) || 10 })} className="w-12 bg-neutral-900 border border-neutral-700 rounded text-xs text-center py-0.5 text-white focus:outline-none focus:border-blue-500" /></div></div>
          </div>
          <div><label className="text-[10px] text-neutral-500 uppercase font-semibold mb-1 block">Style</label><div className="flex bg-neutral-900 rounded p-1 gap-1 border border-neutral-800"><button onClick={() => onChange({ isBold: !values.isBold })} className={`flex-1 p-1.5 rounded flex justify-center transition-colors ${values.isBold ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}><Bold size={14} /></button><button onClick={() => onChange({ isItalic: !values.isItalic })} className={`flex-1 p-1.5 rounded flex justify-center transition-colors ${values.isItalic ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}><Italic size={14} /></button><button onClick={() => onChange({ isUnderline: !values.isUnderline })} className={`flex-1 p-1.5 rounded flex justify-center transition-colors ${values.isUnderline ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}><Underline size={14} /></button></div></div>
          <div className="grid grid-cols-2 gap-4"><div><label className="text-[10px] text-neutral-500 uppercase font-semibold mb-1 block">Text Color</label><div className="flex items-center gap-2 bg-neutral-900 p-1.5 rounded border border-neutral-800"><input type="color" value={values.color || '#ffffff'} onChange={(e) => onChange({ color: e.target.value })} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0" /><span className="text-xs text-neutral-400 uppercase font-mono">{values.color}</span></div></div><div><label className="text-[10px] text-neutral-500 uppercase font-semibold mb-1 block">Bg Color</label><div className="flex items-center gap-2 bg-neutral-900 p-1.5 rounded border border-neutral-800"><input type="color" value={values.backgroundColor || '#000000'} onChange={(e) => onChange({ backgroundColor: e.target.value })} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0" /><span className="text-xs text-neutral-400 uppercase font-mono">{values.backgroundColor}</span></div></div></div>
          <div><label className="text-[10px] text-neutral-500 uppercase font-semibold mb-1 block">Background Opacity</label><div className="flex items-center gap-2"><input type="range" min="0" max="1" step="0.1" value={values.backgroundOpacity ?? 0} onChange={(e) => onChange({ backgroundOpacity: parseFloat(e.target.value) })} className="flex-1 h-1.5 bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-blue-500" /><span className="text-xs w-8 text-right text-neutral-400">{Math.round((values.backgroundOpacity ?? 0) * 100)}%</span></div></div>
      </div>
  );

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 font-sans overflow-hidden">
      {/* ... (UI layout identical to previous, just function references updated) ... */}
      {/* ... Modals ... */}
      <input type="file" multiple accept="video/*,image/*,audio/*" className="hidden" ref={fileInputRef} onChange={handleAddMedia} />
      <input type="file" accept="image/*" className="hidden" ref={referenceImageInputRef} onChange={handleReferenceImageFileChange} />
      {captionModalOpen && (
          <div className="fixed inset-0 z-[600] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCaptionModalOpen(false)} />
              <div className="relative w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                  <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900">
                      <div className="flex items-center gap-2"><Captions className="w-5 h-5 text-purple-400" /><h3 className="text-lg font-semibold text-white">Generate Subtitles</h3></div>
                      <button onClick={() => setCaptionModalOpen(false)} className="p-1.5 hover:bg-neutral-800 rounded-full text-neutral-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="p-6 space-y-6">
                      <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700/50"><div className="flex items-start gap-3"><Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" /><div className="space-y-1"><p className="text-sm font-medium text-white">Source Selection</p><p className="text-xs text-neutral-400 leading-relaxed">Subtitles will be generated from the <strong>Main Video</strong> uploaded to the project. {videoFile ? ` (Main Video: ${videoFile.name})` : (availableVideo ? " (Using first timeline video)" : " (No video detected)")}</p></div></div></div>
                      <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-950/50"><label className="text-xs font-semibold text-neutral-400 uppercase mb-3 block tracking-wider">Default Style</label><TextControls values={captionStyle} onChange={(updates) => setCaptionStyle(prev => ({...prev, ...updates}))} /></div>
                      <div className="flex justify-end pt-2"><button onClick={handleGenerateCaptions} disabled={isGenerating || !availableVideo} className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white px-6 py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 shadow-lg w-full justify-center">{isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Generate with Gemini 2.5 Flash</button></div>
                  </div>
              </div>
          </div>
      )}
      {/* ... Transition & Media Modals (Identical) ... */}
      {transitionModal.active && ( <div className="fixed inset-0 z-[600] flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTransitionModal(prev => ({ ...prev, active: false }))} /><div className="relative w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"><div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900"><div className="flex items-center gap-2"><Wand2 className="w-5 h-5 text-purple-400" /><h3 className="text-lg font-semibold text-white">Generate Transition</h3></div><button onClick={() => setTransitionModal(prev => ({ ...prev, active: false }))} className="p-1.5 hover:bg-neutral-800 rounded-full text-neutral-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button></div><div className="p-6 space-y-6"><div className="flex items-center gap-2 justify-center"><div className="relative w-32 aspect-video bg-neutral-800 rounded-lg overflow-hidden border border-neutral-700"><img src={transitionModal.startFrame || ''} className="w-full h-full object-cover" alt="Out Point" /><div className="absolute bottom-1 left-1 bg-black/50 px-1.5 py-0.5 rounded text-[9px] text-white backdrop-blur">Clip A End</div></div><ArrowRight className="w-5 h-5 text-neutral-500" /><div className="relative w-32 aspect-video bg-neutral-800 rounded-lg overflow-hidden border border-neutral-700"><img src={transitionModal.endFrame || ''} className="w-full h-full object-cover" alt="In Point" /><div className="absolute bottom-1 right-1 bg-black/50 px-1.5 py-0.5 rounded text-[9px] text-white backdrop-blur">Clip B Start</div></div></div><div className="space-y-4"><div><label className="block text-xs font-medium text-neutral-400 mb-1.5">Transition Description</label><textarea value={transitionModal.prompt} onChange={(e) => setTransitionModal(prev => ({ ...prev, prompt: e.target.value }))} placeholder="Describe the transition..." className="w-full h-20 bg-neutral-950 border border-neutral-700 rounded-lg p-3 text-sm focus:outline-none focus:border-purple-500 resize-none transition-all" /></div><div className="grid grid-cols-2 gap-4"><div className="col-span-2"><label className="block text-xs font-medium text-neutral-400 mb-1.5">Model</label><select value={transitionModal.model} onChange={(e) => setTransitionModal(prev => ({ ...prev, model: e.target.value }))} className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-sm focus:outline-none focus:border-purple-500"><option value="veo-3.1-fast-generate-preview">Veo 3.1 Fast</option><option value="veo-3.1-generate-preview">Veo 3.1 Quality</option><option value="veo-3.0-fast-generate-preview">Veo 3 Fast</option><option value="veo-3.0-generate-preview">Veo 3 Quality</option></select></div><div><label className="block text-xs font-medium text-neutral-400 mb-1.5">Resolution</label><select value={transitionModal.resolution} onChange={(e) => setTransitionModal(prev => ({ ...prev, resolution: e.target.value as any }))} className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-sm focus:outline-none focus:border-purple-500"><option value="720p">720p</option><option value="1080p">1080p (8s only)</option><option value="4k">4k (8s only)</option></select></div><div><label className="block text-xs font-medium text-neutral-400 mb-1.5">Duration</label><select value={transitionModal.duration} disabled={true} className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm text-neutral-500 cursor-not-allowed" title="Transitions with reference images require 8s duration"><option value="8">8s (Forced)</option></select></div></div></div><div className="flex justify-end pt-2"><button onClick={handleGenerateTransition} disabled={isGenerating} className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white px-6 py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 shadow-lg">{isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Generate & Insert</button></div></div></div></div> )}
      {mediaModalTrackId !== null && ( <div className="fixed inset-0 z-[500] flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleCloseMediaModal} /><div className="relative w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-0 overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"><div className="p-4 border-b border-neutral-800 flex items-center justify-between"><h3 className="text-lg font-semibold text-white">Add Media to Track {mediaModalTrackId + 1}</h3><button onClick={handleCloseMediaModal} className="p-2 hover:bg-neutral-800 rounded-full text-neutral-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button></div>{modalMode === 'initial' ? (<div className="p-8 grid grid-cols-2 gap-6"><button onClick={triggerLocalUpload} className="flex flex-col items-center justify-center gap-4 p-12 rounded-xl bg-neutral-800/50 border border-neutral-700 hover:border-blue-500/50 hover:bg-neutral-800 transition-all group"><div className="w-16 h-16 rounded-full bg-neutral-700 group-hover:bg-blue-600 flex items-center justify-center transition-colors shadow-lg"><Upload className="w-8 h-8 text-neutral-300 group-hover:text-white" /></div><div className="text-center"><p className="text-lg font-medium text-white mb-1">Upload Files</p><p className="text-sm text-neutral-400">Select multiple items</p></div></button><button onClick={() => setModalMode('generate')} className="flex flex-col items-center justify-center gap-4 p-12 rounded-xl bg-neutral-800/50 border border-neutral-700 hover:border-purple-500/50 hover:bg-neutral-800 transition-all group relative overflow-hidden"><div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity" /><div className="w-16 h-16 rounded-full bg-neutral-700 group-hover:bg-purple-600 flex items-center justify-center transition-colors shadow-lg relative z-10"><GeminiLogo className="w-8 h-8" /></div><div className="text-center relative z-10"><p className="text-lg font-medium text-white mb-1">Generate with Gemini</p><p className="text-sm text-neutral-400">Image, Video, or Speech</p></div></button></div>) : (<div className="flex flex-1 min-h-0"><div className="w-48 border-r border-neutral-800 bg-neutral-900 p-2 space-y-1"><button onClick={() => setModalMode('initial')} className="flex items-center gap-2 w-full p-2 text-neutral-400 hover:text-white mb-4 transition-colors"><ChevronLeft className="w-4 h-4" /> Back</button>{[{ id: 'image', icon: ImageIcon, label: 'Image' },{ id: 'video', icon: Film, label: 'Video (Veo)' },{ id: 'audio', icon: Mic, label: 'Speech (TTS)' }].map(tab => (<button key={tab.id} onClick={() => setGenTab(tab.id as any)} className={`flex items-center gap-3 w-full p-3 rounded-lg text-sm font-medium transition-all ${genTab === tab.id ? 'bg-purple-600/20 text-purple-300' : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'}`}><tab.icon className="w-4 h-4" /> {tab.label}</button>))}</div><div className="flex-1 p-6 overflow-y-auto bg-neutral-950/50"><div className="max-w-xl mx-auto space-y-6"><div><label className="block text-sm font-medium text-neutral-400 mb-2">{genTab === 'audio' ? 'Text to Speak' : 'Prompt'}</label><textarea value={genPrompt} onChange={(e) => setGenPrompt(e.target.value)} placeholder={genTab === 'audio' ? "Enter text..." : "Describe what you want to generate..."} className="w-full h-24 bg-neutral-900 border border-neutral-700 rounded-xl p-3 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-none transition-all" autoFocus /></div>{genTab === 'video' && (<div className="space-y-4 pt-2 border-t border-neutral-800"><div className="flex items-center justify-between mb-2"><span className="text-sm font-medium text-neutral-300">Reference Images</span><span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 ${veoModeColor}`}>{veoModeLabel}</span></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><div className="flex items-center justify-between"><label className="text-xs font-medium text-neutral-500">Start Frame (Optional)</label>{veoStartImg && <button onClick={() => setVeoStartImg(null)} className="text-xs text-red-400 hover:text-red-300"><Trash2 className="w-3 h-3" /></button>}</div><div className="relative aspect-video bg-neutral-900 border border-neutral-700 rounded-lg overflow-hidden group hover:border-blue-500/50 transition-colors">{veoStartImg ? (<img src={veoStartImg} className="w-full h-full object-cover" alt="Start Frame" />) : (<div className="absolute inset-0 flex flex-col items-center justify-center gap-2"><button onClick={() => handleCaptureFrame('start')} className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-neutral-300 transition-colors"><Camera className="w-3 h-3" /> Timeline</button><button onClick={() => handleVeoReferenceUpload('start')} className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-neutral-300 transition-colors"><Upload className="w-3 h-3" /> Upload</button></div>)}</div><p className="text-[10px] text-neutral-600">Tip: Position playhead to capture specific timeline frame.</p></div><div className="space-y-2"><div className="flex items-center justify-between"><label className={`text-xs font-medium ${!veoStartImg ? 'text-neutral-700' : 'text-neutral-500'}`}>End Frame (Requires Start Frame)</label>{veoEndImg && <button onClick={() => setVeoEndImg(null)} className="text-xs text-red-400 hover:text-red-300"><Trash2 className="w-3 h-3" /></button>}</div><div className={`relative aspect-video bg-neutral-900 border rounded-lg overflow-hidden group transition-colors ${!veoStartImg ? 'border-neutral-800 opacity-50 pointer-events-none' : 'border-neutral-700 hover:border-purple-500/50'}`}>{veoEndImg ? (<img src={veoEndImg} className="w-full h-full object-cover" alt="End Frame" />) : (<div className="absolute inset-0 flex flex-col items-center justify-center gap-2"><button onClick={() => handleCaptureFrame('end')} className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-neutral-300 transition-colors"><Camera className="w-3 h-3" /> Timeline</button><button onClick={() => handleVeoReferenceUpload('end')} className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-neutral-300 transition-colors"><Upload className="w-3 h-3" /> Upload</button></div>)}</div></div></div></div>)}{genTab === 'image' && (<div className="grid grid-cols-2 gap-4"><div><label className="block text-xs font-medium text-neutral-500 mb-1">Model</label><select value={imgModel} onChange={(e) => setImgModel(e.target.value as any)} className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-2 text-sm focus:outline-none focus:border-purple-500"><option value="gemini-2.5-flash-image">Fast (Flash)</option><option value="gemini-3-pro-image-preview">High Quality (Pro)</option></select></div><div><label className="block text-xs font-medium text-neutral-500 mb-1">Aspect Ratio</label><select value={imgAspect} onChange={(e) => setImgAspect(e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-2 text-sm focus:outline-none focus:border-purple-500"><option value="16:9">16:9 (Landscape)</option><option value="9:16">9:16 (Portrait)</option><option value="1:1">1:1 (Square)</option></select></div></div>)}{genTab === 'video' && (<div className="grid grid-cols-2 gap-4"><div className="col-span-2 grid grid-cols-2 gap-4"><div><label className="block text-xs font-medium text-neutral-500 mb-1">Model</label><select value={vidModel} onChange={(e) => setVidModel(e.target.value as any)} className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-2 text-sm focus:outline-none focus:border-purple-500"><option value="veo-3.1-fast-generate-preview">Veo 3.1 Fast</option><option value="veo-3.1-generate-preview">Veo 3.1 Quality</option><option value="veo-3.0-fast-generate-preview">Veo 3 Fast</option><option value="veo-3.0-generate-preview">Veo 3 Quality</option></select></div><div><label className="block text-xs font-medium text-neutral-500 mb-1">Resolution</label><select value={vidResolution} onChange={(e) => setVidResolution(e.target.value as any)} className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-2 text-sm focus:outline-none focus:border-purple-500"><option value="720p">720p</option><option value="1080p">1080p (8s only)</option><option value="4k">4k (8s only)</option></select></div><div><label className="block text-xs font-medium text-neutral-500 mb-1">Duration</label><select value={vidDuration} onChange={(e) => setVidDuration(e.target.value as any)} disabled={vidResolution === '1080p' || vidResolution === '4k' || !!veoStartImg || !!veoEndImg} className={`w-full bg-neutral-900 border border-neutral-700 rounded-lg p-2 text-sm focus:outline-none focus:border-purple-500 ${vidResolution === '1080p' || vidResolution === '4k' || !!veoStartImg || !!veoEndImg ? 'opacity-50 cursor-not-allowed bg-neutral-800' : ''}`}><option value="4">4s</option><option value="8">8s</option></select></div><div><label className="block text-xs font-medium text-neutral-500 mb-1">Aspect Ratio</label><select value={vidAspect} onChange={(e) => setVidAspect(e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-2 text-sm focus:outline-none focus:border-purple-500"><option value="16:9">16:9 (Landscape)</option><option value="9:16">9:16 (Portrait)</option></select></div></div><div className="col-span-2 p-3 bg-blue-900/20 border border-blue-500/20 rounded-lg flex items-start gap-2"><Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" /><span className="text-xs text-blue-300 leading-relaxed">Video generation takes 1-2 minutes. A paid billing project is required.<br/><strong>Note:</strong> 1080p, 4K, and Image-to-Video operations are locked to 8s duration.</span></div></div>)}{genTab === 'audio' && (<div><label className="block text-xs font-medium text-neutral-500 mb-1">Voice</label><div className="grid grid-cols-5 gap-2">{['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].map(voice => (<button key={voice} onClick={() => setAudioVoice(voice)} className={`p-2 rounded border text-xs font-medium transition-all ${audioVoice === voice ? 'bg-purple-600 border-purple-500 text-white' : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-600'}`}>{voice}</button>))}</div></div>)}<div className="flex justify-end pt-4"><button onClick={handleGenerate} disabled={isGenerating || (genTab !== 'video' && !genPrompt.trim()) || (genTab === 'video' && !genPrompt.trim() && !veoStartImg)} className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white px-8 py-3 rounded-lg font-medium text-sm transition-all disabled:opacity-50 shadow-lg shadow-purple-900/20 w-full justify-center">{isGenerating ? (<><Loader2 className="w-5 h-5 animate-spin" />{genTab === 'video' ? 'Generating Video...' : 'Generating...'}</>) : (<><Sparkles className="w-5 h-5" />Generate {genTab.charAt(0).toUpperCase() + genTab.slice(1)}</>)}</button></div></div></div></div>)}</div></div>)}

      {/* Header */}
      <header className="h-14 border-b border-neutral-800 flex items-center px-4 justify-between bg-neutral-900/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Video className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-semibold text-lg tracking-tight">Cursor for Video <span className="text-xs font-normal text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded ml-2">Demo</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-neutral-800 rounded-lg p-0.5 border border-neutral-700 mr-2">
            <button onClick={handleUndo} disabled={!canUndo} className="p-1.5 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white disabled:opacity-30 transition-colors"><RotateCcw className="w-4 h-4" /></button>
            <div className="w-px h-4 bg-neutral-700 mx-0.5" />
            <button onClick={handleRedo} disabled={!canRedo} className="p-1.5 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white disabled:opacity-30 transition-colors"><RotateCw className="w-4 h-4" /></button>
          </div>
           {/* EXPORT BUTTON */}
           <button onClick={handleExport} disabled={isExporting} className="flex items-center gap-2 text-sm text-white bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded-full shadow-lg transition-all disabled:opacity-50">{isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}<span>{isExporting ? `${exportProgress}%` : 'Export MP4'}</span></button>
           <label className="flex items-center gap-2 text-sm text-white cursor-pointer transition-all bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded-full shadow-lg hover:shadow-blue-500/20 active:scale-95 font-medium"><Upload className="w-4 h-4" /><span>Import Video</span><input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} /></label>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          
          {/* Video Canvas Container */}
          <div className="flex-1 bg-neutral-950 flex flex-col">
              <div className="flex-1 relative flex items-center justify-center p-8 overflow-hidden" onClick={handleCanvasClick}>
                <div ref={containerRef} className="relative w-full max-w-4xl aspect-video bg-neutral-900 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 group">
                
                {/* RENDER LAYERS */}
                {clips.map((clip) => {
                    const isVisible = currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration;
                    const transform = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
                    
                    const style: React.CSSProperties = {
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: '100%',
                        height: '100%',
                        transform: `translate(-50%, -50%) translate(${transform.x * 100}%, ${transform.y * 100}%) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
                        objectFit: 'contain',
                        cursor: isPlaying ? 'default' : 'pointer',
                        zIndex: clip.trackId * 10,
                        opacity: isVisible ? 1 : 0, 
                        pointerEvents: isVisible ? (isPlaying ? 'none' : 'auto') : 'none'
                    };

                    const handleClipClick = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        if (!isPlaying && isVisible) { handleSelectClip(clip.id, e); }
                    };
                    
                    if (clip.type === 'text' && clip.text) {
                        const ts = clip.textStyle || DEFAULT_TEXT_STYLE;
                        return (
                             <div key={clip.id} style={style} onClick={handleClipClick} className="flex items-center justify-center">
                                <span 
                                    className="px-4 py-2 text-center whitespace-pre-wrap"
                                    style={{ 
                                        fontFamily: ts.fontFamily || 'Plus Jakarta Sans',
                                        fontSize: `${ts.fontSize}px`,
                                        fontWeight: ts.isBold ? 'bold' : 'normal',
                                        fontStyle: ts.isItalic ? 'italic' : 'normal',
                                        textDecoration: ts.isUnderline ? 'underline' : 'none',
                                        color: ts.color,
                                        backgroundColor: ts.backgroundColor ? `${ts.backgroundColor}${Math.round((ts.backgroundOpacity ?? 0) * 255).toString(16).padStart(2,'0')}` : 'transparent',
                                        lineHeight: 1.2,
                                        // Slight shadow for contrast if bg is transparent
                                        textShadow: (ts.backgroundOpacity ?? 0) < 0.3 ? '1px 1px 2px rgba(0,0,0,0.8)' : 'none'
                                    }}
                                >
                                    {clip.text}
                                </span>
                             </div>
                        );
                    }

                    if (clip.type === 'video' || clip.type === 'audio') {
                        const isAudio = clip.type === 'audio';
                        return (
                            <div key={clip.id} style={{...style, display: isAudio ? 'none' : 'block'}} onClick={handleClipClick}>
                                {isAudio ? ( <audio ref={(el) => { mediaRefs.current[clip.id] = el; }} src={clip.sourceUrl || ''} muted={false} /> ) : ( <video ref={(el) => { mediaRefs.current[clip.id] = el; }} src={clip.sourceUrl || videoUrl || ''} className="w-full h-full object-contain pointer-events-none" muted={false} playsInline crossOrigin={(!clip.sourceUrl && !videoUrl) ? undefined : "anonymous"} /> )}
                            </div>
                        );
                    } else {
                        return ( <div key={clip.id} style={style} onClick={handleClipClick}><img src={clip.sourceUrl || ''} alt={clip.title} className="w-full h-full object-contain pointer-events-none" /></div> );
                    }
                })}

                {!videoUrl && clips.length === 0 && ( <label className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors z-20"><Video className="w-16 h-16 mb-4 opacity-20" /><p className="font-medium text-lg mb-2">Click to upload video</p><p className="text-sm opacity-50">or drag and drop here</p><input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} /></label> )}
                {!isPlaying && isSelectedClipVisible && primarySelectedClip && primarySelectedClip.type !== 'audio' && !isMultiSelection && ( <CanvasControls clip={primarySelectedClip} containerRef={containerRef} onUpdate={handleUpdateClipTransform} /> )}
                {isExporting && ( <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50"><Loader2 className="w-12 h-12 text-green-500 animate-spin mb-4" /><h3 className="text-xl font-bold text-white mb-2">Rendering Video...</h3><p className="text-neutral-400 mb-4">Frame by frame analysis</p><div className="w-64 h-2 bg-neutral-800 rounded-full overflow-hidden"><div className="h-full bg-green-500 transition-all duration-75" style={{ width: `${exportProgress}%` }} /></div></div> )}
                <canvas ref={canvasRef} width={1280} height={720} className="absolute inset-0 w-full h-full pointer-events-none opacity-0" />
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur px-2 py-1 rounded text-xs font-mono text-neutral-400 border border-white/5 z-40 pointer-events-none">VIRTUAL PLAYER ENGINE</div>
                </div>
              </div>

              {/* Player Control Bar */}
              <div className="h-12 bg-neutral-900 border-t border-neutral-800 flex items-center justify-between px-6 z-[200] relative">
                  <div className="flex items-center gap-4">
                      <button onClick={togglePlay} className="w-8 h-8 flex items-center justify-center rounded-full bg-white text-black hover:bg-neutral-200 transition-colors">{isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}</button>
                      <span className="font-mono text-sm text-neutral-400"><span className="text-white">{formatTime(currentTime)}</span></span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                       {/* Show Text Toolbar if only Text clips are selected (one or more) */}
                       {allSelectedAreText && (
                           <>
                            {/* Text Content Input (Only show for single selection for obvious reasons) */}
                            {!isMultiSelection && primarySelectedClip && (
                                <input 
                                    type="text" 
                                    value={primarySelectedClip.text || ''} 
                                    onChange={(e) => handleUpdateTextContent(primarySelectedClip.id, e.target.value)}
                                    className="w-48 bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 mr-2"
                                    placeholder="Enter text..."
                                />
                            )}

                            {/* Text Style Controls (Batch Compatible) */}
                            <div className="relative">
                                <button onClick={() => { setShowTextStyleMenu(!showTextStyleMenu); setShowVolumeMenu(false); setShowSpeedMenu(false); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${showTextStyleMenu ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'}`}>
                                    <Type className="w-3.5 h-3.5" /> Style {isMultiSelection ? `(${selectedClips.length})` : ''}
                                </button>
                                {showTextStyleMenu && (
                                    <div className="absolute bottom-full mb-2 right-0 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl p-4 z-50 min-w-[280px] animate-in fade-in zoom-in-95 duration-100">
                                        <TextControls 
                                            // Use first clip values as baseline for UI, or default
                                            values={primarySelectedClip?.textStyle || DEFAULT_TEXT_STYLE} 
                                            onChange={handleUpdateTextStyle}
                                        />
                                    </div>
                                )}
                            </div>
                           </>
                       )}

                       {/* Show Media Toolbar if Media clips selected */}
                       {allSelectedAreMedia && (
                           <>
                           {/* Speed Control */}
                           <div className="relative">
                               <button onClick={() => { setShowSpeedMenu(!showSpeedMenu); setShowVolumeMenu(false); setIsCustomSpeed(false); setShowTextStyleMenu(false); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${showSpeedMenu ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'}`}><Gauge className="w-3.5 h-3.5" />{primarySelectedClip?.speed}x</button>
                               {showSpeedMenu && (<div className="absolute bottom-full mb-2 right-0 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl overflow-hidden min-w-[140px] flex flex-col p-1 z-50">{[0.5, 1, 1.5, 2].map(s => (<button key={s} onClick={() => primarySelectedClip && handleClipSpeed(primarySelectedClip.id, s)} className="text-left px-3 py-1.5 text-xs rounded hover:bg-neutral-700 transition-colors w-full text-neutral-300">{s}x</button>))}</div>)}
                           </div>
                           
                           {/* Volume Control */}
                           <div className="relative">
                                <button onClick={() => { setShowVolumeMenu(!showVolumeMenu); setShowSpeedMenu(false); setShowTextStyleMenu(false); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${showVolumeMenu ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'}`}>{primarySelectedClip?.volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}{Math.round((primarySelectedClip?.volume ?? 1) * 100)}%</button>
                                {showVolumeMenu && (<div className="absolute bottom-full mb-2 right-0 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl p-3 z-50 min-w-[120px]"><input type="range" min="0" max="1" step="0.05" value={primarySelectedClip?.volume ?? 1} onChange={(e) => primarySelectedClip && handleClipVolume(primarySelectedClip.id, parseFloat(e.target.value))} className="w-full h-1.5 bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-blue-500" /></div>)}
                            </div>
                           </>
                       )}
                       <button className="p-2 hover:bg-neutral-800 rounded-md text-neutral-400 hover:text-white transition-colors"><Scissors className="w-4 h-4" onClick={handleSplitClip} /></button>
                  </div>
              </div>
          </div>

          {/* Timeline */}
          <div className="h-64 border-t border-neutral-800 bg-neutral-900/50 backdrop-blur-sm z-10 flex flex-col">
            <Timeline 
                clips={clips} tracks={tracks} currentTime={currentTime} 
                onSeek={handleSeek} onDelete={handleDelete} onSelect={handleSelectClip}
                onAddMediaRequest={handleOpenMediaModal} onResize={handleClipResize}
                onReorder={handleClipReorder} onAddTrack={handleAddTrack} selectedClipIds={selectedClipIds}
                onTransitionRequest={handleTransitionRequest}
                onCaptionRequest={() => setCaptionModalOpen(true)}
            />
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-80 border-l border-neutral-800 bg-neutral-900 flex flex-col z-20">
          <div className="p-4 border-b border-neutral-800 flex items-center gap-2"><Wand2 className="w-4 h-4 text-purple-400" /><h2 className="font-semibold text-sm">AI Assistant</h2></div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">{messages.map((msg, idx) => (<div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}><div className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-neutral-800 text-neutral-200 rounded-bl-none border border-neutral-700'}`}>{msg.role === 'model' ? <MarkdownText text={msg.text} /> : msg.text}</div></div>))}<div ref={messagesEndRef} />{isAnalyzing && (<div className="flex items-center gap-2 text-xs text-purple-400 animate-pulse px-2"><Loader2 className="w-3 h-3 animate-spin" /><span>Gemini is thinking...</span></div>)}</div>
           <div className="p-4 border-t border-neutral-800 space-y-3 bg-neutral-900"><div className="relative"><input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Ask or type 'Cut'..." className="w-full bg-neutral-950 border border-neutral-700 rounded-lg pl-3 pr-10 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-neutral-600" /><button onClick={handleSendMessage} disabled={!inputText.trim() || isAnalyzing} className="absolute right-2 top-2 p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors disabled:opacity-50"><MessageSquare className="w-4 h-4" /></button></div></div>
        </aside>
      </div>
    </div>
  );
}