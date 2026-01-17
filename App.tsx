import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Timeline } from './components/Timeline';
import { Clip, ChatMessage, Suggestion } from './types';
import { analyzeVideoFrames, suggestEdits } from './services/gemini';
import { extractFramesFromVideo } from './utils/videoUtils';
import { Video, Wand2, Play, Pause, Loader2, Upload, MessageSquare, RotateCcw, RotateCw, Sparkles, ArrowRight, Scissors, CheckCircle2 } from 'lucide-react';

// Initialize with sourceStartTime (assuming 0 for initial generic clips for demo purposes)
const INITIAL_CLIPS: Clip[] = [
  { id: 'c1', title: 'Intro Scene', duration: 5, startTime: 0, sourceStartTime: 0, type: 'video', totalDuration: 60 },
  { id: 'c2', title: 'Main Action', duration: 8, startTime: 5, sourceStartTime: 5, type: 'video', totalDuration: 60 },
  { id: 'c3', title: 'Outro', duration: 4, startTime: 13, sourceStartTime: 13, type: 'video', totalDuration: 60 },
];

interface HistoryState {
  past: Clip[][];
  present: Clip[];
  future: Clip[][];
}

// Simple Markdown Formatter
const MarkdownText: React.FC<{ text: string }> = ({ text }) => {
  // Split by bold syntax (**text**)
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

export default function App() {
  // History State Management
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: INITIAL_CLIPS,
    future: []
  });
  
  const clips = history.present;
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null); // Main Source
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: 'Hello! I am your AI assistant. Upload a video and I can analyze its content, mood, and key events for you.' }
  ]);
  const [inputText, setInputText] = useState('');
  
  // PLAYBACK STATE
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0); // TIMELINE Time
  
  // Active Clip State for rendering correct media
  const [activeClip, setActiveClip] = useState<Clip | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Determine active clip based on time
  useEffect(() => {
     const clip = clips.find(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration);
     setActiveClip(clip || null);
  }, [currentTime, clips]);

  // --- VIRTUAL PLAYER ENGINE ---
  useEffect(() => {
    let animationFrameId: number;
    let lastTimestamp: number;

    const loop = (timestamp: number) => {
        if (!isPlaying) return;
        
        if (!lastTimestamp) lastTimestamp = timestamp;
        const delta = (timestamp - lastTimestamp) / 1000;
        lastTimestamp = timestamp;

        setCurrentTime(prevTime => {
            const nextTime = prevTime + delta;
            
            // 1. Find which clip we are currently inside
            const activeClip = clips.find(c => nextTime >= c.startTime && nextTime < c.startTime + c.duration);
            
            if (activeClip) {
                // If it's a video type, we need to sync the video element
                if (activeClip.type !== 'image' && videoRef.current) {
                    const offsetInClip = nextTime - activeClip.startTime;
                    const targetSourceTime = activeClip.sourceStartTime + offsetInClip;
                    
                    // Only try to seek if the video source is loaded and duration is valid
                    if (!isNaN(videoRef.current.duration)) {
                         if (Math.abs(videoRef.current.currentTime - targetSourceTime) > 0.2) {
                            videoRef.current.currentTime = targetSourceTime;
                        }
                        if (videoRef.current.paused) {
                            videoRef.current.play().catch(() => {});
                        }
                    }
                }
            } else {
                // GAP DETECTION or END
                const nextClip = clips.find(c => c.startTime > nextTime);
                if (nextClip) {
                    // Skip to next clip
                    return nextClip.startTime; 
                } else {
                    // End of timeline
                    setIsPlaying(false);
                    return prevTime;
                }
            }

            return nextTime;
        });

        animationFrameId = requestAnimationFrame(loop);
    };

    if (isPlaying) {
        animationFrameId = requestAnimationFrame(loop);
    } else {
        // Ensure video pauses when app state is paused
        if (videoRef.current) {
            videoRef.current.pause();
        }
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, clips]);


  // --- Undo / Redo Logic ---
  const setClipsWithHistory = (newClips: Clip[]) => {
    setHistory(curr => ({
      past: [...curr.past, curr.present],
      present: newClips,
      future: []
    }));
  };

  const handleUndo = useCallback(() => {
    setHistory(curr => {
      if (curr.past.length === 0) return curr;
      const previous = curr.past[curr.past.length - 1];
      const newPast = curr.past.slice(0, -1);
      return {
        past: newPast,
        present: previous,
        future: [curr.present, ...curr.future]
      };
    });
  }, []);

  const handleRedo = useCallback(() => {
    setHistory(curr => {
      if (curr.future.length === 0) return curr;
      const next = curr.future[0];
      const newFuture = curr.future.slice(1);
      return {
        past: [...curr.past, curr.present],
        present: next,
        future: newFuture
      };
    });
  }, []);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // --- Actions ---

  const handleDeleteClip = useCallback((id: string) => {
    setHistory(curr => {
        const remainingClips = curr.present.filter(c => c.id !== id);
        // Magnetic Timeline
        let accumulatedTime = 0;
        const normalizedClips = remainingClips.map(clip => {
            const updated = { ...clip, startTime: accumulatedTime };
            accumulatedTime += clip.duration;
            return updated;
        });
        return {
            past: [...curr.past, curr.present],
            present: normalizedClips,
            future: []
        };
    });
    if (selectedClipId === id) setSelectedClipId(null);
  }, [selectedClipId]);

  const handleSplitClip = () => {
      const active = clips.find(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration);
      if (!active) return;
      if (active.type === 'image') {
          setMessages(prev => [...prev, { role: 'system', text: `Cannot split static images.` }]);
          return;
      }

      const offset = currentTime - active.startTime;
      if (offset < 0.5 || offset > active.duration - 0.5) return;

      const clipA: Clip = {
          ...active,
          id: crypto.randomUUID(),
          duration: offset
      };

      const clipB: Clip = {
          ...active,
          id: crypto.randomUUID(),
          startTime: currentTime,
          duration: active.duration - offset,
          sourceStartTime: active.sourceStartTime + offset,
          title: active.title + " (Part 2)"
      };

      const index = clips.findIndex(c => c.id === active.id);
      const newClips = [...clips];
      newClips.splice(index, 1, clipA, clipB);

      setClipsWithHistory(newClips);
      // Clean System Message
      setMessages(prev => [...prev, { role: 'system', text: `✂️ Split "${active.title}" at ${offset.toFixed(1)}s` }]);
  };

  const handleClipResize = (id: string, newDuration: number, trimMode: 'start' | 'end', commit: boolean) => {
      setHistory(curr => {
          const clipIndex = curr.present.findIndex(c => c.id === id);
          if (clipIndex === -1) return curr;

          const clip = curr.present[clipIndex];
          let updatedClip = { ...clip };

          if (trimMode === 'end') {
              // Standard duration update
              updatedClip.duration = Math.max(0.5, newDuration);
              // Limit by source total duration
              if (clip.type === 'video' && clip.totalDuration) {
                  const maxDur = clip.totalDuration - clip.sourceStartTime;
                  updatedClip.duration = Math.min(updatedClip.duration, maxDur);
              }
          } else {
              // Trimming start
              const durationDelta = newDuration - clip.duration;
              // If dragging left (duration increases), delta > 0. Start time should decrease.
              // If dragging right (duration decreases), delta < 0. Start time should increase.
              
              let newSourceStart = clip.sourceStartTime - durationDelta;
              let finalDuration = newDuration;

              // Constraint 1: Can't start before 0
              if (newSourceStart < 0) {
                  newSourceStart = 0;
                  finalDuration = clip.duration + clip.sourceStartTime;
              }

              // Constraint 2: Can't shrink below 0.5s
              if (finalDuration < 0.5) {
                  finalDuration = 0.5;
                  newSourceStart = clip.sourceStartTime + (clip.duration - 0.5);
              }
              
              // Constraint 3 (Video): Can't start after end of video (unlikely in this interaction model but good safety)
              if (clip.type === 'video' && clip.totalDuration && newSourceStart >= clip.totalDuration) {
                   // Clamp
                   // ... implementation complex for this edge case, skipping for demo simplicity
              }

              if (clip.type === 'video') {
                 updatedClip.sourceStartTime = newSourceStart;
              }
              updatedClip.duration = finalDuration;
          }

          const newClips = [...curr.present];
          newClips[clipIndex] = updatedClip;

          // Re-magnetize timeline
          let accumulated = 0;
          const normalized = newClips.map(c => {
              const n = { ...c, startTime: accumulated };
              accumulated += c.duration;
              return n;
          });

          // If not committing (dragging), just update present without history
          if (!commit) {
              return { ...curr, present: normalized };
          }
          
          // If committing, push to history
          return {
              past: [...curr.past, curr.present],
              present: normalized,
              future: []
          };
      });
  };

  const handleClipReorder = (sourceId: string, targetId: string) => {
      const sourceIndex = clips.findIndex(c => c.id === sourceId);
      const targetIndex = clips.findIndex(c => c.id === targetId);

      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;

      const newClips = [...clips];
      const [movedClip] = newClips.splice(sourceIndex, 1);
      newClips.splice(targetIndex, 0, movedClip);

      // Re-magnetize
      let accumulated = 0;
      const normalized = newClips.map(c => {
          const n = { ...c, startTime: accumulated };
          accumulated += c.duration;
          return n;
      });

      setClipsWithHistory(normalized);
  };

  const handleApplySuggestion = (suggestion: Suggestion) => {
    let t = 0;
    const cleanClips = suggestion.clips.map(c => {
        const clip = { ...c, startTime: t };
        t += c.duration;
        return clip;
    });

    setClipsWithHistory(cleanClips);
    // Clean System Message
    setMessages(prev => [...prev, { role: 'system', text: `✨ Applied suggestion: ${suggestion.label}` }]);
    setSelectedClipId(null);
  };

  const handleSelectClip = (id: string) => {
      setSelectedClipId(id);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.shiftKey ? handleRedo() : handleUndo();
        e.preventDefault();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        handleRedo();
        e.preventDefault();
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
          if (selectedClipId) {
              handleDeleteClip(selectedClipId);
              e.preventDefault();
          }
      }
      if (e.key === ' ') {
          togglePlay();
          e.preventDefault();
      }
      if (e.key === 'b' && (e.metaKey || e.ctrlKey)) { // Ctrl+B for Blade/Cut
          handleSplitClip();
          e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleDeleteClip, selectedClipId, isPlaying, clips, currentTime]);

  // --- Event Handlers ---

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url); // Sets as main source
      setMessages(prev => [...prev, { role: 'model', text: `Loaded **${file.name}**. Click "Analyze Video" to process it with **Gemini 3 Pro**.` }]);
      
      setCurrentTime(0);
      setIsPlaying(false);
      setHasAnalyzed(false);
    }
  };

  const handleAddMedia = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) return;

    const newClipBase = {
        id: crypto.randomUUID(),
        title: file.name,
        startTime: clips.reduce((acc, c) => Math.max(acc, c.startTime + c.duration), 0),
        sourceStartTime: 0,
        type: isImage ? 'image' : 'video' as 'image' | 'video',
        sourceUrl: url
    };

    if (isImage) {
        // Images default to 3 seconds
        const newClip: Clip = { ...newClipBase, duration: 3 };
        setClipsWithHistory([...clips, newClip]);
        setMessages(prev => [...prev, { role: 'system', text: `Added image "${file.name}"` }]);
    } else {
        // Videos need metadata to determine duration
        const tempVideo = document.createElement('video');
        tempVideo.src = url;
        tempVideo.onloadedmetadata = () => {
             const newClip: Clip = { ...newClipBase, duration: tempVideo.duration, totalDuration: tempVideo.duration };
             setClipsWithHistory([...clips, newClip]);
             setMessages(prev => [...prev, { role: 'system', text: `Added video "${file.name}"` }]);
        };
    }
  };

  const handleVideoLoad = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    // Only set initial clips if we have NO clips or just the default demo ones, AND this is the main video file loading
    const duration = e.currentTarget.duration;
    if (duration && !isNaN(duration) && videoFile && clips === INITIAL_CLIPS) {
        setClipsWithHistory([
            {
                id: 'main-clip',
                title: videoFile.name,
                duration: duration,
                startTime: 0,
                sourceStartTime: 0,
                type: 'video',
                sourceUrl: videoUrl || undefined,
                totalDuration: duration
            }
        ]);
        setSelectedClipId(null);
    }
  };

  const handleAnalyze = async () => {
    if (!videoFile) return;

    setIsAnalyzing(true);
    setMessages(prev => [...prev, { role: 'user', text: 'Analyze this video.' }]);
    
    try {
      const frames = await extractFramesFromVideo(videoFile, 10);
      const prompt = "Analyze this video sequence. Identify key events, the general mood, and what happens in the scene. Provide a concise summary.";
      const analysis = await analyzeVideoFrames(frames, prompt);
      
      setMessages(prev => [...prev, { role: 'model', text: analysis }]);
      setHasAnalyzed(true); 
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error analyzing the video.' }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSuggestEdits = async () => {
    setIsAnalyzing(true);
    setMessages(prev => [...prev, { role: 'user', text: 'Suggest some edits.' }]);

    try {
      const suggestions = await suggestEdits(clips);
      
      if (suggestions.length > 0) {
        setMessages(prev => [...prev, { 
          role: 'model', 
          text: `I've generated **${suggestions.length} edit ideas** for you.`,
          suggestions: suggestions
        }]);
      } else {
        setMessages(prev => [...prev, { role: 'model', text: "I couldn't generate any specific suggestions right now." }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'model', text: "Error generating suggestions." }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- Chat Action Parser ---
  const parseUserAction = (text: string) => {
      const lowerText = text.toLowerCase();
      // "Cut" command
      if (lowerText.includes('cut') || lowerText.includes('split')) {
          handleSplitClip();
          // We let the System Message handle the feedback instead of a redundant Model message
          return { handled: true, response: null }; 
      }
      return { handled: false, response: "" };
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    
    const text = inputText;
    setInputText('');
    setMessages(prev => [...prev, { role: 'user', text }]);

    // 1. Check for Actions
    const actionResult = parseUserAction(text);
    if (actionResult.handled) {
        if (actionResult.response) {
            setMessages(prev => [...prev, { role: 'model', text: actionResult.response }]);
        }
        return;
    }

    // 2. Fallback to Gemini
    if (videoFile) {
        setIsAnalyzing(true);
        try {
            const frames = await extractFramesFromVideo(videoFile, 5);
            const response = await analyzeVideoFrames(frames, text);
            setMessages(prev => [...prev, { role: 'model', text: response }]);
        } catch (e) {
            setMessages(prev => [...prev, { role: 'model', text: "Error processing your request." }]);
        } finally {
            setIsAnalyzing(false);
        }
    } else {
        setMessages(prev => [...prev, { role: 'model', text: "Please upload a video first." }]);
    }
  };

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (time: number) => {
    const newTime = Math.max(0, time);
    setCurrentTime(newTime);
    const active = clips.find(c => newTime >= c.startTime && newTime < c.startTime + c.duration);
    if (active && active.type !== 'image' && videoRef.current) {
        const offsetInClip = newTime - active.startTime;
        videoRef.current.currentTime = active.sourceStartTime + offsetInClip;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 font-sans overflow-hidden">
      {/* 1. Header */}
      <header className="h-14 border-b border-neutral-800 flex items-center px-4 justify-between bg-neutral-900/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Video className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-semibold text-lg tracking-tight">Cursor for Video <span className="text-xs font-normal text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded ml-2">Demo</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-neutral-800 rounded-lg p-0.5 border border-neutral-700 mr-2">
            <button onClick={handleUndo} disabled={!canUndo} className="p-1.5 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white disabled:opacity-30 transition-colors">
                <RotateCcw className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-neutral-700 mx-0.5" />
            <button onClick={handleRedo} disabled={!canRedo} className="p-1.5 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white disabled:opacity-30 transition-colors">
                <RotateCw className="w-4 h-4" />
            </button>
          </div>
           <label className="flex items-center gap-2 text-sm text-white cursor-pointer transition-all bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded-full shadow-lg hover:shadow-blue-500/20 active:scale-95 font-medium">
            <Upload className="w-4 h-4" />
            <span>Import Video</span>
            <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          
          {/* 2. Video Canvas */}
          <div className="flex-1 bg-neutral-950 relative flex items-center justify-center p-8">
            <div className="relative w-full max-w-4xl aspect-video bg-neutral-900 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 group">
              
              {/* VIDEO LAYER - Renders if active clip is video or if we have a main videoUrl acting as placeholder */}
              {((activeClip?.type !== 'image') && (activeClip?.sourceUrl || videoUrl)) && (
                    <video 
                    ref={videoRef}
                    // Dynamically switch source. 
                    // Note: In a real app we'd want to preload or use multiple video elements to avoid black flashes
                    src={activeClip?.sourceUrl || videoUrl || ''} 
                    onLoadedMetadata={handleVideoLoad}
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none bg-black"
                    muted={false} 
                    />
              )}

              {/* IMAGE LAYER - Renders if active clip is an image */}
              {activeClip?.type === 'image' && activeClip.sourceUrl && (
                  <img 
                    src={activeClip.sourceUrl} 
                    alt={activeClip.title}
                    className="absolute inset-0 w-full h-full object-contain bg-black z-10"
                  />
              )}

              {/* EMPTY STATE */}
              {!videoUrl && !activeClip && (
                 <label className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors z-20">
                    <Video className="w-16 h-16 mb-4 opacity-20" />
                    <p className="font-medium text-lg mb-2">Click to upload video</p>
                    <p className="text-sm opacity-50">or drag and drop here</p>
                    <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
                 </label>
              )}

              {/* PLAY BUTTON OVERLAY */}
              {(videoUrl || (clips.length > 0)) && (
                    <div 
                        className="absolute inset-0 z-30 cursor-pointer" 
                        onClick={togglePlay}
                    >
                        <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'}`}>
                            <button className="w-20 h-20 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center text-white ring-1 ring-white/20 shadow-2xl hover:scale-105 transition-transform">
                                {isPlaying ? <Pause className="fill-current w-8 h-8" /> : <Play className="fill-current w-8 h-8 ml-1" />}
                            </button>
                        </div>
                    </div>
              )}
              

               <div className="absolute top-4 left-4 bg-black/60 backdrop-blur px-2 py-1 rounded text-xs font-mono text-neutral-400 border border-white/5 z-40 pointer-events-none">
                 VIRTUAL PLAYER ENGINE
               </div>
            </div>
          </div>

          {/* 3. Timeline */}
          <div className="h-56 border-t border-neutral-800 bg-neutral-900/50 backdrop-blur-sm z-10 flex flex-col">
             <div className="h-10 border-b border-neutral-800 flex items-center justify-between px-4 text-xs text-neutral-400">
                <div className="flex gap-4">
                    <span className="hover:text-white cursor-pointer flex items-center gap-1"><Video size={12}/> Track 1</span>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleSplitClip} className="hover:text-white flex items-center gap-1" title="Split Clip (Ctrl+B)">
                        <Scissors size={12}/> Split
                    </button>
                </div>
            </div>
            <Timeline 
                clips={clips} 
                currentTime={currentTime} 
                onSeek={handleSeek} 
                onDelete={handleDeleteClip}
                onSelect={handleSelectClip}
                onAddMedia={handleAddMedia}
                onResize={handleClipResize}
                onReorder={handleClipReorder}
                selectedClipId={selectedClipId}
            />
          </div>
        </div>

        {/* 4. Sidebar */}
        <aside className="w-80 border-l border-neutral-800 bg-neutral-900 flex flex-col z-20">
          <div className="p-4 border-b border-neutral-800 flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-purple-400" />
            <h2 className="font-semibold text-sm">AI Assistant</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, idx) => {
              // --- SYSTEM MESSAGE RENDERING ---
              if (msg.role === 'system') {
                return (
                   <div key={idx} className="flex justify-center my-3 opacity-80 hover:opacity-100 transition-opacity">
                     <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-400 bg-neutral-800/50 border border-neutral-800 px-3 py-1 rounded-full flex items-center gap-2 shadow-sm">
                       {msg.text}
                     </span>
                   </div>
                );
              }

              // --- CHAT MESSAGE RENDERING ---
              return (
                <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white rounded-br-none' 
                      : 'bg-neutral-800 text-neutral-200 rounded-bl-none border border-neutral-700'
                  }`}>
                    {/* Markdown Renderer */}
                    {msg.role === 'model' ? <MarkdownText text={msg.text} /> : msg.text}
                    
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="mt-4 flex flex-col gap-2">
                          {msg.suggestions.map((s, i) => (
                              <button
                                  key={i}
                                  onClick={() => handleApplySuggestion(s)}
                                  className="text-left bg-neutral-900/50 hover:bg-neutral-700 border border-neutral-700/50 hover:border-blue-500/50 rounded-xl p-3 transition-all group"
                              >
                                  <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-2">
                                          <Sparkles className="w-3 h-3 text-purple-400" />
                                          <span className="font-medium text-white group-hover:text-blue-200">{s.label}</span>
                                      </div>
                                      <ArrowRight className="w-3 h-3 text-neutral-500 group-hover:text-white opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                                  </div>
                                  <p className="text-xs text-neutral-400 leading-relaxed">{s.description}</p>
                                  {s.reasoning && (
                                      <p className="text-[10px] text-neutral-500 italic mt-2 border-l-2 border-neutral-700 pl-2">
                                          "{s.reasoning}"
                                      </p>
                                  )}
                              </button>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
            
            {isAnalyzing && (
              <div className="flex items-center gap-2 text-xs text-purple-400 animate-pulse px-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Gemini is thinking...</span>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-neutral-800 space-y-3 bg-neutral-900">
            <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => handleAnalyze()}
                  disabled={!videoFile || isAnalyzing}
                  className={`flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-xs py-2 rounded border border-neutral-700 disabled:opacity-50 transition-colors ${!hasAnalyzed ? 'col-span-2' : ''}`}
                >
                    <Video className="w-3 h-3" />
                    Analyze Video
                </button>
                {hasAnalyzed && (
                    <button 
                    onClick={handleSuggestEdits}
                    disabled={isAnalyzing}
                    className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-xs py-2 rounded border border-neutral-700 disabled:opacity-50 transition-colors"
                    >
                        <Wand2 className="w-3 h-3" />
                        Suggest Edit
                    </button>
                )}
            </div>

            <div className="relative">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Ask or type 'Cut'..."
                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg pl-3 pr-10 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-neutral-600"
              />
              <button 
                onClick={handleSendMessage}
                disabled={!inputText.trim() || isAnalyzing}
                className="absolute right-2 top-2 p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors disabled:opacity-50"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}