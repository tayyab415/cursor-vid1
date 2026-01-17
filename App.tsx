import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Timeline } from './components/Timeline';
import { Clip, ChatMessage, Suggestion } from './types';
import { analyzeVideoFrames, suggestEdits } from './services/gemini';
import { extractFramesFromVideo } from './utils/videoUtils';
import { Video, Wand2, Play, Pause, Loader2, Upload, MessageSquare, RotateCcw, RotateCw, Sparkles, ArrowRight } from 'lucide-react';

const INITIAL_CLIPS: Clip[] = [
  { id: 'c1', title: 'Intro Scene', duration: 5, startTime: 0 },
  { id: 'c2', title: 'Main Action', duration: 8, startTime: 5 },
  { id: 'c3', title: 'Outro', duration: 4, startTime: 13 },
];

interface HistoryState {
  past: Clip[][];
  present: Clip[];
  future: Clip[][];
}

export default function App() {
  // History State Management
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: INITIAL_CLIPS,
    future: []
  });
  
  // Derived state for easier access
  const clips = history.present;
  
  // Selection State
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  // Analysis State
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: 'Hello! I am your AI assistant. Upload a video and I can analyze its content, mood, and key events for you.' }
  ]);
  const [inputText, setInputText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  // --- Clip Management Actions ---

  const handleDeleteClip = useCallback((id: string) => {
    setHistory(curr => {
        const remainingClips = curr.present.filter(c => c.id !== id);
        
        // Recalculate start times to fill the gap
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

    if (selectedClipId === id) {
        setSelectedClipId(null);
    }
  }, [selectedClipId]);

  const handleSelectClip = (id: string) => {
      setSelectedClipId(id);
  };

  const handleApplySuggestion = (suggestion: Suggestion) => {
    // Safety: Recalculate start times sequentially to ensure no gaps from AI math
    let t = 0;
    const cleanClips = suggestion.clips.map(c => {
        const clip = { ...c, startTime: t };
        t += c.duration;
        return clip;
    });

    setClipsWithHistory(cleanClips);
    setMessages(prev => [...prev, { role: 'user', text: `Applied suggestion: ${suggestion.label}` }]);
    setSelectedClipId(null);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        e.preventDefault();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        handleRedo();
        e.preventDefault();
      }

      // Delete / Backspace
      if (e.key === 'Backspace' || e.key === 'Delete') {
          if (selectedClipId) {
              handleDeleteClip(selectedClipId);
              e.preventDefault();
          }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleDeleteClip, selectedClipId]);

  // --- Event Handlers ---

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setMessages(prev => [...prev, { role: 'model', text: `Loaded "${file.name}". Click "Analyze Video" to process it with Gemini 3 Pro.` }]);
      
      // Reset state for new video
      setCurrentTime(0);
      setIsPlaying(false);
      setHasAnalyzed(false); // Reset analysis state on new file
    }
  };

  const handleVideoLoad = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const duration = e.currentTarget.duration;
    if (duration && !isNaN(duration) && videoFile) {
        // Replace clips with a single clip representing the uploaded video
        setClipsWithHistory([
            {
                id: 'main-clip',
                title: videoFile.name,
                duration: duration,
                startTime: 0
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
      // 1. Extract frames
      const frames = await extractFramesFromVideo(videoFile, 10);
      
      // 2. Call Gemini
      const prompt = "Analyze this video sequence. Identify key events, the general mood, and what happens in the scene. Provide a concise summary.";
      const analysis = await analyzeVideoFrames(frames, prompt);
      
      setMessages(prev => [...prev, { role: 'model', text: analysis }]);
      setHasAnalyzed(true); // Enable suggestions
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error analyzing the video.' }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSuggestEdits = async () => {
    setIsAnalyzing(true);
    // User message just to show interaction
    setMessages(prev => [...prev, { role: 'user', text: 'Suggest some edits.' }]);

    try {
      const suggestions = await suggestEdits(clips);
      
      if (suggestions.length > 0) {
        setMessages(prev => [...prev, { 
          role: 'model', 
          text: `I've generated ${suggestions.length} edit ideas for you. Click one to apply it to your timeline.`,
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

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    
    const text = inputText;
    setInputText('');
    setMessages(prev => [...prev, { role: 'user', text }]);

    if (videoFile) {
        setIsAnalyzing(true);
        try {
            const frames = await extractFramesFromVideo(videoFile, 5); // Fewer frames for quick chat
            const response = await analyzeVideoFrames(frames, text);
            setMessages(prev => [...prev, { role: 'model', text: response }]);
        } catch (e) {
            setMessages(prev => [...prev, { role: 'model', text: "Error processing your request." }]);
        } finally {
            setIsAnalyzing(false);
        }
    } else {
        // Fallback for no video loaded
        setMessages(prev => [...prev, { role: 'model', text: "Please upload a video first so I can see what you are talking about!" }]);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (time: number) => {
    const newTime = Math.max(0, time);
    setCurrentTime(newTime);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 font-sans overflow-hidden">
      {/* 1. Top Area: Header */}
      <header className="h-14 border-b border-neutral-800 flex items-center px-4 justify-between bg-neutral-900/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Video className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-semibold text-lg tracking-tight">Cursor for Video <span className="text-xs font-normal text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded ml-2">Demo</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Undo / Redo Controls */}
          <div className="flex items-center bg-neutral-800 rounded-lg p-0.5 border border-neutral-700 mr-2">
            <button 
                onClick={handleUndo} 
                disabled={!canUndo}
                className="p-1.5 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Undo (Ctrl+Z)"
            >
                <RotateCcw className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-neutral-700 mx-0.5" />
            <button 
                onClick={handleRedo}
                disabled={!canRedo}
                className="p-1.5 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Redo (Ctrl+Shift+Z)"
            >
                <RotateCw className="w-4 h-4" />
            </button>
          </div>

           <label className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white cursor-pointer transition-colors bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 rounded-full">
            <Upload className="w-4 h-4" />
            <span>Import Video</span>
            <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          
          {/* 2. Center: Video Canvas */}
          <div className="flex-1 bg-neutral-950 relative flex items-center justify-center p-8">
            <div className="relative w-full max-w-4xl aspect-video bg-neutral-900 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 group">
              {videoUrl ? (
                <video 
                  ref={videoRef}
                  src={videoUrl} 
                  className="w-full h-full object-contain"
                  onClick={togglePlay}
                  onEnded={() => setIsPlaying(false)}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={handleVideoLoad}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500">
                  <Video className="w-16 h-16 mb-4 opacity-20" />
                  <p>No video selected</p>
                </div>
              )}
              
              {/* Play Button Overlay */}
              {videoUrl && (
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <button className="w-16 h-16 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white ring-1 ring-white/20">
                    {isPlaying ? <Pause className="fill-current w-6 h-6" /> : <Play className="fill-current w-6 h-6 ml-1" />}
                  </button>
                </div>
              )}

               {/* Label */}
               <div className="absolute top-4 left-4 bg-black/60 backdrop-blur px-2 py-1 rounded text-xs font-mono text-neutral-400 border border-white/5">
                 VIDEO CANVAS
               </div>
            </div>
          </div>

          {/* 3. Bottom: Timeline */}
          <div className="h-48 border-t border-neutral-800 bg-neutral-900/50 backdrop-blur-sm z-10 flex flex-col">
            <div className="h-8 border-b border-neutral-800 flex items-center px-4 gap-4 text-xs text-neutral-400">
                <span className="hover:text-white cursor-pointer">Timeline 1</span>
                <span className="hover:text-white cursor-pointer">Audio L1</span>
            </div>
            <Timeline 
                clips={clips} 
                currentTime={currentTime} 
                onSeek={handleSeek} 
                onDelete={handleDeleteClip}
                onSelect={handleSelectClip}
                selectedClipId={selectedClipId}
            />
          </div>
        </div>

        {/* 4. Right Sidebar: AI Assistant */}
        <aside className="w-80 border-l border-neutral-800 bg-neutral-900 flex flex-col z-20">
          <div className="p-4 border-b border-neutral-800 flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-purple-400" />
            <h2 className="font-semibold text-sm">AI Assistant</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm ${
                  msg.role === 'user' 
                    ? 'bg-blue-600 text-white rounded-br-none' 
                    : 'bg-neutral-800 text-neutral-200 rounded-bl-none border border-neutral-700'
                }`}>
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                  
                  {/* Suggestion Buttons */}
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
            ))}
            <div ref={messagesEndRef} />
            
            {isAnalyzing && (
              <div className="flex items-center gap-2 text-xs text-purple-400 animate-pulse px-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Gemini is thinking...</span>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-neutral-800 space-y-3 bg-neutral-900">
            {/* Quick Actions */}
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

            {/* Input Area */}
            <div className="relative">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Ask about the video..."
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