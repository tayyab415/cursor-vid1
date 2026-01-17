import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Timeline } from './components/Timeline';
import { CanvasControls } from './components/CanvasControls';
import { Clip, ChatMessage, Suggestion } from './types';
import { analyzeVideoFrames, suggestEdits } from './services/gemini';
import { extractFramesFromVideo } from './utils/videoUtils';
import { Video, Wand2, Play, Pause, Loader2, Upload, MessageSquare, RotateCcw, RotateCw, Sparkles, ArrowRight, Scissors, Maximize2, Gauge, ChevronUp, ChevronRight, ChevronLeft, Download } from 'lucide-react';
import * as Mp4Muxer from 'mp4-muxer';

// Initialize with defaults
const INITIAL_CLIPS: Clip[] = [
  { id: 'c1', title: 'Intro Scene', duration: 5, startTime: 0, sourceStartTime: 0, type: 'video', totalDuration: 60, trackId: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1 },
  { id: 'c2', title: 'Main Action', duration: 8, startTime: 5, sourceStartTime: 5, type: 'video', totalDuration: 60, trackId: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1 },
  { id: 'c3', title: 'Outro', duration: 4, startTime: 13, sourceStartTime: 13, type: 'video', totalDuration: 60, trackId: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1 },
];

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

export default function App() {
  const [tracks, setTracks] = useState<number[]>([0, 1, 2]);

  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: INITIAL_CLIPS,
    future: []
  });
  
  const clips = history.present;
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isCustomSpeed, setIsCustomSpeed] = useState(false);
  const [customSpeedText, setCustomSpeedText] = useState('');

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null); // For canvas dimensions
  
  // Refs for video elements to sync
  const videoRefs = useRef<{[key: string]: HTMLVideoElement | null}>({});

  // Use a ref for currentTime to access it in the animation loop without restarting the effect
  const currentTimeRef = useRef(currentTime);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- VIRTUAL PLAYER ENGINE ---
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
        
        // 1. Identify "Master" Video Candidate
        const activeVideoClip = clips.find(c =>
            c.type === 'video' &&
            currentT >= c.startTime &&
            currentT < c.startTime + c.duration
        );

        if (activeVideoClip) {
             const el = videoRefs.current[activeVideoClip.id];
             const speed = activeVideoClip.speed || 1;
             
             if (el && !el.paused && !el.seeking && el.readyState > 2) {
                 const timeInClip = el.currentTime - activeVideoClip.sourceStartTime;
                 const calculatedTimelineTime = activeVideoClip.startTime + (timeInClip / speed);

                 const syncTolerance = Math.max(0.5, 0.2 * speed);

                 if (Math.abs(calculatedTimelineTime - currentT) < syncTolerance) {
                     masterTimeDelta = calculatedTimelineTime - currentT;
                     syncedToMaster = true;
                     masterClipId = activeVideoClip.id;
                 }
             }
        }

        // 2. Advance Timeline
        setCurrentTime(prevTime => {
            let nextTime;
            
            if (syncedToMaster) {
                nextTime = prevTime + masterTimeDelta;
            } else {
                nextTime = prevTime + delta;
            }
            
            // 3. Sync Secondary Videos
            const visibleClips = clips.filter(c => nextTime >= c.startTime && nextTime < c.startTime + c.duration);
            
            visibleClips.forEach(clip => {
                if (clip.type === 'video' && videoRefs.current[clip.id]) {
                    const el = videoRefs.current[clip.id];
                    if (el) {
                         const speed = clip.speed || 1;
                         
                         if (Math.abs(el.playbackRate - speed) > 0.01) {
                             el.playbackRate = speed;
                         }

                         if (el.paused) {
                             el.play().catch(() => {});
                         }

                         const isMaster = syncedToMaster && masterClipId === clip.id;
                         
                         if (!isMaster) {
                             const offsetInClip = nextTime - clip.startTime;
                             const targetSourceTime = clip.sourceStartTime + (offsetInClip * speed);
                             const drift = el.currentTime - targetSourceTime;

                             let tolerance = 0.3;
                             if (speed > 2) tolerance = 2.0; 
                             if (speed > 4) tolerance = 4.0;

                             if (Math.abs(drift) > tolerance) {
                                 if (el.readyState >= 1) {
                                     el.currentTime = targetSourceTime;
                                 }
                             }
                         }
                    }
                }
            });

            // End Check
            const maxDuration = clips.reduce((acc, c) => Math.max(acc, c.startTime + c.duration), 0);
            if (nextTime > maxDuration) {
                setIsPlaying(false);
                return prevTime; 
            }
            return nextTime;
        });

        animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, clips]);

  // --- STATIC SYNC (PAUSED STATE) ---
  useEffect(() => {
      if (isPlaying || isExporting) return; // Don't fight export logic

      const visibleClips = clips.filter(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration);
      visibleClips.forEach(clip => {
           if (clip.type === 'video' && videoRefs.current[clip.id]) {
              const el = videoRefs.current[clip.id];
              if (el) {
                  el.pause();
                  const speed = clip.speed || 1;
                  const offsetInClip = currentTime - clip.startTime;
                  const targetTime = clip.sourceStartTime + (offsetInClip * speed);
                  
                  if (Math.abs(el.currentTime - targetTime) > 0.05) {
                      el.currentTime = targetTime;
                  }
              }
           }
      });
  }, [isPlaying, isExporting, currentTime, clips]);

  const handleExport = async () => {
      if (isExporting) return;
      setIsPlaying(false);
      setIsExporting(true);
      setExportProgress(0);

      if (typeof VideoEncoder === 'undefined') {
          alert("Your browser does not support VideoEncoder.");
          setIsExporting(false);
          return;
      }

      let videoEncoder: VideoEncoder | null = null;
      let muxer: any = null;
      const mediaCache: Record<string, HTMLVideoElement | HTMLImageElement> = {};

      try {
          const width = 1280;
          const height = 720;
          const fps = 30;
          const bitRate = 4_000_000;

          muxer = new Mp4Muxer.Muxer({
              target: new Mp4Muxer.ArrayBufferTarget(),
              video: { codec: 'avc', width, height },
              fastStart: 'in-memory'
          });

          let encoderError: Error | null = null;
          videoEncoder = new VideoEncoder({
              output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
              error: (e) => {
                  console.error("VideoEncoder Error:", e);
                  encoderError = new Error(e.message || "Encoding failed");
              }
          });

          const configsToCheck = [
              { codec: 'avc1.42001f', width, height, bitrate: bitRate, framerate: fps },
              { codec: 'avc1.4d002a', width, height, bitrate: bitRate, framerate: fps },
              { codec: 'avc1.64001f', width, height, bitrate: bitRate, framerate: fps },
          ];

          let selectedConfig = null;
          for (const config of configsToCheck) {
              try {
                  const support = await VideoEncoder.isConfigSupported(config);
                  if (support.supported) {
                      selectedConfig = config;
                      break;
                  }
              } catch (e) {}
          }

          if (!selectedConfig) throw new Error("No supported AVC codec found.");
          videoEncoder.configure(selectedConfig);

          // Create canvas without 'desynchronized' to avoid potential readback issues
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) throw new Error("Could not create canvas context");

          const totalDuration = clips.reduce((acc, c) => Math.max(acc, c.startTime + c.duration), 0);
          const totalFrames = Math.ceil(totalDuration * fps);
          const frameDuration = 1 / fps;

          // Helper to get media off-screen (avoiding React refs/DOM issues)
          const getMedia = async (url: string, type: 'video' | 'image') => {
              if (mediaCache[url]) return mediaCache[url];

              return new Promise<HTMLVideoElement | HTMLImageElement>((resolve, reject) => {
                  if (type === 'video') {
                      const v = document.createElement('video');
                      // Only set crossOrigin if NOT a blob to avoid "CORS not supported" for opaque blobs
                      if (!url.startsWith('blob:') && !url.startsWith('data:')) {
                           v.crossOrigin = "anonymous";
                      }
                      v.muted = true;
                      v.playsInline = true;
                      v.autoplay = false;
                      v.src = url;
                      v.onloadedmetadata = () => resolve(v);
                      v.onerror = () => reject(new Error(`Failed to load video ${url}`));
                  } else {
                      const img = new Image();
                      if (!url.startsWith('blob:') && !url.startsWith('data:')) {
                          img.crossOrigin = "anonymous";
                      }
                      img.onload = () => resolve(img);
                      img.onerror = () => reject(new Error(`Failed to load image ${url}`));
                      img.src = url;
                  }
              }).then(el => {
                  mediaCache[url] = el;
                  return el;
              });
          };

          for (let i = 0; i < totalFrames; i++) {
              if (encoderError) throw encoderError;
              const t = i * frameDuration;
              setExportProgress(Math.round((i / totalFrames) * 100));

              ctx.fillStyle = '#000000';
              ctx.fillRect(0, 0, width, height);

              const activeClips = clips
                  .filter(c => t >= c.startTime && t < c.startTime + c.duration)
                  .sort((a, b) => a.trackId - b.trackId);

              for (const clip of activeClips) {
                  const sourceUrl = clip.sourceUrl || videoUrl;
                  if (!sourceUrl) continue;

                  const mediaEl = await getMedia(sourceUrl, clip.type || 'video');
                  const offsetInClip = t - clip.startTime;
                  const speed = clip.speed || 1;
                  const sourceTime = clip.sourceStartTime + (offsetInClip * speed);

                  if (mediaEl instanceof HTMLVideoElement) {
                      mediaEl.currentTime = sourceTime;
                      // Wait for seek if needed
                      if (Math.abs(mediaEl.currentTime - sourceTime) > 0.1 || mediaEl.readyState < 2) {
                          await new Promise<void>(resolve => {
                              const onSeeked = () => {
                                  mediaEl.removeEventListener('seeked', onSeeked);
                                  resolve();
                              };
                              mediaEl.addEventListener('seeked', onSeeked);
                              // Safety timeout
                              setTimeout(() => {
                                  mediaEl.removeEventListener('seeked', onSeeked);
                                  resolve();
                              }, 1000);
                          });
                      }
                  }
                  
                  drawClipToCanvas(ctx, clip, mediaEl, width, height);
              }

              // Try/Catch specific to frame creation to catch "Tainted Canvas"
              try {
                  const frame = new VideoFrame(canvas, { timestamp: i * 1000000 / fps });
                  videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
                  frame.close();
              } catch (frameErr: any) {
                  console.error("Frame Error:", frameErr);
                  // If it's a SecurityError, the canvas is tainted.
                  if (frameErr.name === 'SecurityError') {
                      throw new Error("Canvas Tainted: A media source (video/image) does not support CORS. Cannot export.");
                  }
                  throw frameErr;
              }
          }

          await videoEncoder.flush();
          muxer.finalize();

          const { buffer } = muxer.target;
          if (buffer.byteLength === 0) throw new Error("Output video is empty");
          
          const blob = new Blob([buffer], { type: 'video/mp4' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `cursor_video_${Date.now()}.mp4`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);

      } catch (err: any) {
          console.error("Export Error:", err);
          alert(`Export failed: ${err.message || "Unknown error"}`);
      } finally {
          if (videoEncoder && videoEncoder.state !== "closed") {
              try { videoEncoder.close(); } catch(e) {}
          }
          setIsExporting(false);
          setExportProgress(0);
          setCurrentTime(0);
      }
  };

  const drawClipToCanvas = (ctx: CanvasRenderingContext2D, clip: Clip, source: CanvasImageSource, containerW: number, containerH: number) => {
      const transform = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
      
      ctx.save();
      ctx.translate(containerW / 2, containerH / 2);
      ctx.translate(transform.x * containerW, transform.y * containerH);
      ctx.scale(transform.scale, transform.scale);
      ctx.rotate((transform.rotation * Math.PI) / 180);

      let srcW = 0, srcH = 0;
      if (source instanceof HTMLVideoElement) {
          srcW = source.videoWidth;
          srcH = source.videoHeight;
      } else if (source instanceof HTMLImageElement) {
          srcW = source.naturalWidth;
          srcH = source.naturalHeight;
      }

      if (srcW && srcH) {
          const aspectSrc = srcW / srcH;
          const aspectDest = containerW / containerH;
          
          let drawW, drawH;
          if (aspectSrc > aspectDest) {
              drawW = containerW;
              drawH = containerW / aspectSrc;
          } else {
              drawH = containerH;
              drawW = containerH * aspectSrc;
          }
          ctx.drawImage(source, -drawW/2, -drawH/2, drawW, drawH);
      }
      ctx.restore();
  };

  const setClipsWithHistory = (newClips: Clip[]) => {
    setHistory(curr => ({
      past: [...curr.past, curr.present],
      present: newClips,
      future: []
    }));
  };

  const handleUpdateClipTransform = (id: string, newTransform: NonNullable<Clip['transform']>) => {
      setHistory(curr => {
          const index = curr.present.findIndex(c => c.id === id);
          if (index === -1) return curr;
          
          const newClips = [...curr.present];
          newClips[index] = { ...newClips[index], transform: newTransform };
          
          return {
              ...curr,
              present: newClips
          };
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

        // Magnetize
        const trackClips = newClips.filter(c => c.trackId === clip.trackId);
        trackClips.sort((a, b) => a.startTime - b.startTime);
        
        let accumulated = 0;
        const normalizedTrack = trackClips.map(c => {
            const n = { ...c, startTime: accumulated };
            accumulated += c.duration;
            return n;
        });

        const otherClips = newClips.filter(c => c.trackId !== clip.trackId);
        return {
            past: [...curr.past, curr.present],
            present: [...otherClips, ...normalizedTrack],
            future: []
        };
      });
      setShowSpeedMenu(false);
      setIsCustomSpeed(false);
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

  const handleAddTrack = (position: 'top' | 'bottom') => {
      let nextId = 0;
      if (position === 'top') {
          nextId = tracks.length > 0 ? Math.max(...tracks) + 1 : 0;
      } else {
          nextId = tracks.length > 0 ? Math.min(...tracks) - 1 : 0;
      }
      const newTracks = [...tracks, nextId].sort((a, b) => a - b);
      setTracks(newTracks);
  };

  const handleDeleteClip = useCallback((id: string) => {
    setHistory(curr => {
        const clipToDelete = curr.present.find(c => c.id === id);
        if (!clipToDelete) return curr;
        
        const remainingClips = curr.present.filter(c => c.id !== id);
        const trackClips = remainingClips.filter(c => c.trackId === clipToDelete.trackId);
        trackClips.sort((a, b) => a.startTime - b.startTime);
        
        let accumulatedTime = 0;
        const normalizedTrackClips = trackClips.map(clip => {
            const updated = { ...clip, startTime: accumulatedTime };
            accumulatedTime += clip.duration;
            return updated;
        });

        const otherClips = remainingClips.filter(c => c.trackId !== clipToDelete.trackId);
        const finalClips = [...otherClips, ...normalizedTrackClips];

        return {
            past: [...curr.past, curr.present],
            present: finalClips,
            future: []
        };
    });
    if (selectedClipId === id) setSelectedClipId(null);
  }, [selectedClipId]);

  const handleSplitClip = () => {
      let targetClip: Clip | undefined;
      const visibleClips = clips.filter(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration);
      
      if (selectedClipId) {
          targetClip = visibleClips.find(c => c.id === selectedClipId);
      }
      if (!targetClip) {
           targetClip = visibleClips.sort((a, b) => b.trackId - a.trackId)[0];
      }

      if (!targetClip) return;
      if (targetClip.type === 'image') {
          setMessages(prev => [...prev, { role: 'system', text: `Cannot split static images.` }]);
          return;
      }

      const offset = currentTime - targetClip.startTime;
      if (offset < 0.5 || offset > targetClip.duration - 0.5) return;

      const clipA: Clip = {
          ...targetClip,
          id: crypto.randomUUID(),
          duration: offset
      };
      const speed = targetClip.speed || 1;
      const sourceAdvance = offset * speed;

      const clipB: Clip = {
          ...targetClip,
          id: crypto.randomUUID(),
          startTime: currentTime,
          duration: targetClip.duration - offset,
          sourceStartTime: targetClip.sourceStartTime + sourceAdvance,
          title: targetClip.title + " (Part 2)"
      };

      const index = clips.findIndex(c => c.id === targetClip!.id);
      const newClips = [...clips];
      newClips.splice(index, 1, clipA, clipB);

      setClipsWithHistory(newClips);
      setMessages(prev => [...prev, { role: 'system', text: `✂️ Split "${targetClip!.title}"` }]);
  };

  const handleClipResize = (id: string, newDuration: number, trimMode: 'start' | 'end', commit: boolean) => {
      setHistory(curr => {
          const clipIndex = curr.present.findIndex(c => c.id === id);
          if (clipIndex === -1) return curr;

          const clip = curr.present[clipIndex];
          const speed = clip.speed || 1;
          let updatedClip = { ...clip };

          if (trimMode === 'end') {
              updatedClip.duration = Math.max(0.5, newDuration);
              if (clip.type === 'video' && clip.totalDuration) {
                  const remainingSourceDuration = clip.totalDuration - clip.sourceStartTime;
                  const maxTimelineDuration = remainingSourceDuration / speed;
                  updatedClip.duration = Math.min(updatedClip.duration, maxTimelineDuration);
              }
          } else {
              const durationDelta = newDuration - clip.duration;
              const sourceDelta = durationDelta * speed;
              let newSourceStart = clip.sourceStartTime - sourceDelta;
              let finalDuration = newDuration;

              if (newSourceStart < 0) {
                  newSourceStart = 0;
                  finalDuration = (clip.sourceStartTime / speed) + clip.duration;
              }
              if (finalDuration < 0.5) {
                  finalDuration = 0.5;
                  newSourceStart = clip.sourceStartTime + ((clip.duration - 0.5) * speed);
              }
              
              if (clip.type === 'video') {
                 updatedClip.sourceStartTime = newSourceStart;
              }
              updatedClip.duration = finalDuration;
          }

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
          const finalClips = [...otherClips, ...normalizedTrack];

          if (!commit) {
              return { ...curr, present: finalClips };
          }
          
          return {
              past: [...curr.past, curr.present],
              present: finalClips,
              future: []
          };
      });
  };

  const handleClipReorder = (sourceId: string, targetId: string | null, targetTrackId: number) => {
      const sourceClip = clips.find(c => c.id === sourceId);
      if (!sourceClip) return;

      const sourceTrackId = sourceClip.trackId;
      const remaining = clips.filter(c => c.id !== sourceId);
      const updatedSourceClip = { ...sourceClip, trackId: targetTrackId };

      const targetTrackClips = remaining.filter(c => c.trackId === targetTrackId);
      targetTrackClips.sort((a, b) => a.startTime - b.startTime);

      let newTargetOrder = [];
      if (targetId) {
          const targetIndex = targetTrackClips.findIndex(c => c.id === targetId);
          if (targetIndex !== -1) {
              targetTrackClips.splice(targetIndex, 0, updatedSourceClip);
              newTargetOrder = targetTrackClips;
          } else {
             newTargetOrder = [...targetTrackClips, updatedSourceClip]; 
          }
      } else {
          newTargetOrder = [...targetTrackClips, updatedSourceClip];
      }

      let tAcc = 0;
      const finalTargetTrack = newTargetOrder.map(c => {
          const u = { ...c, startTime: tAcc };
          tAcc += c.duration;
          return u;
      });

      let finalSourceTrack: Clip[] = [];
      if (sourceTrackId !== targetTrackId) {
          const sourceTrackClips = remaining.filter(c => c.trackId === sourceTrackId);
          sourceTrackClips.sort((a, b) => a.startTime - b.startTime);
          let sAcc = 0;
          finalSourceTrack = sourceTrackClips.map(c => {
              const u = { ...c, startTime: sAcc };
              sAcc += c.duration;
              return u;
          });
      }

      const untouchedClips = remaining.filter(c => c.trackId !== targetTrackId && c.trackId !== sourceTrackId);
      const result = [...untouchedClips, ...finalTargetTrack, ...finalSourceTrack];

      setClipsWithHistory(result);
  };

  const handleApplySuggestion = (suggestion: Suggestion) => {
    let t = 0;
    const cleanClips = suggestion.clips.map(c => {
        const clip = { ...c, startTime: t, trackId: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, speed: 1 };
        t += c.duration;
        return clip;
    });
    setClipsWithHistory(cleanClips);
    setMessages(prev => [...prev, { role: 'system', text: `✨ Applied suggestion` }]);
    setSelectedClipId(null);
  };

  const handleSelectClip = (id: string) => {
      setSelectedClipId(id);
      setShowSpeedMenu(false);
      setIsCustomSpeed(false);
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
      if (e.target === containerRef.current || e.target === e.currentTarget) {
          setSelectedClipId(null);
          setShowSpeedMenu(false);
          setIsCustomSpeed(false);
      }
  };

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
      if (e.key === 'b' && (e.metaKey || e.ctrlKey)) { 
          handleSplitClip();
          e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleDeleteClip, selectedClipId, isPlaying, clips, currentTime]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url); 
      setMessages(prev => [...prev, { role: 'model', text: `Loaded **${file.name}**. Click "Analyze Video" to process it with **Gemini 3 Pro**.` }]);
      
      setCurrentTime(0);
      setIsPlaying(false);
      setHasAnalyzed(false);
    }
  };

  const handleAddMedia = (event: React.ChangeEvent<HTMLInputElement>, trackId: number) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) return;

    const trackClips = clips.filter(c => c.trackId === trackId);
    const trackEndTime = trackClips.reduce((acc, c) => Math.max(acc, c.startTime + c.duration), 0);

    const newClipBase = {
        id: crypto.randomUUID(),
        title: file.name,
        startTime: trackEndTime,
        sourceStartTime: 0,
        type: isImage ? 'image' : 'video' as 'image' | 'video',
        sourceUrl: url,
        trackId: trackId,
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        speed: 1
    };

    if (isImage) {
        const newClip: Clip = { ...newClipBase, duration: 3 };
        setClipsWithHistory([...clips, newClip]);
        setMessages(prev => [...prev, { role: 'system', text: `Added image to Track ${trackId + 1}` }]);
    } else {
        const tempVideo = document.createElement('video');
        tempVideo.src = url;
        tempVideo.onloadedmetadata = () => {
             const newClip: Clip = { ...newClipBase, duration: tempVideo.duration, totalDuration: tempVideo.duration };
             setClipsWithHistory([...clips, newClip]);
             setMessages(prev => [...prev, { role: 'system', text: `Added video to Track ${trackId + 1}` }]);
        };
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

  const parseUserAction = (text: string) => {
      const lowerText = text.toLowerCase();
      if (lowerText.includes('cut') || lowerText.includes('split')) {
          handleSplitClip();
          return { handled: true, response: null }; 
      }
      return { handled: false, response: "" };
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    const text = inputText;
    setInputText('');
    setMessages(prev => [...prev, { role: 'user', text }]);

    const actionResult = parseUserAction(text);
    if (actionResult.handled) {
        if (actionResult.response) {
            setMessages(prev => [...prev, { role: 'model', text: actionResult.response }]);
        }
        return;
    }

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
    
    // Sync logic on seek
    const visibleClips = clips.filter(c => newTime >= c.startTime && newTime < c.startTime + c.duration);
    visibleClips.forEach(clip => {
         if (clip.type === 'video' && videoRefs.current[clip.id]) {
            const el = videoRefs.current[clip.id];
            if (el) {
                const speed = clip.speed || 1;
                const offsetInClip = newTime - clip.startTime;
                el.currentTime = clip.sourceStartTime + (offsetInClip * speed);
            }
         }
    });
  };

  // Derive visible clips for rendering (Layers)
  const visibleClips = clips
        .filter(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration)
        .sort((a, b) => a.trackId - b.trackId); 

  const selectedClip = clips.find(c => c.id === selectedClipId);
  const isSelectedClipVisible = selectedClip && visibleClips.some(vc => vc.id === selectedClip.id);

  const formatTime = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 100);
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 font-sans overflow-hidden">
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
            <button onClick={handleUndo} disabled={!canUndo} className="p-1.5 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white disabled:opacity-30 transition-colors">
                <RotateCcw className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-neutral-700 mx-0.5" />
            <button onClick={handleRedo} disabled={!canRedo} className="p-1.5 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white disabled:opacity-30 transition-colors">
                <RotateCw className="w-4 h-4" />
            </button>
          </div>
          
           {/* EXPORT BUTTON IN HEADER */}
           <button 
                onClick={handleExport}
                disabled={isExporting}
                className="flex items-center gap-2 text-sm text-white bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded-full shadow-lg transition-all disabled:opacity-50"
           >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{isExporting ? `${exportProgress}%` : 'Export MP4'}</span>
           </button>

           <label className="flex items-center gap-2 text-sm text-white cursor-pointer transition-all bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded-full shadow-lg hover:shadow-blue-500/20 active:scale-95 font-medium">
            <Upload className="w-4 h-4" />
            <span>Import Video</span>
            <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          
          {/* Video Canvas Container */}
          <div className="flex-1 bg-neutral-950 flex flex-col">
              
              <div 
                className="flex-1 relative flex items-center justify-center p-8 overflow-hidden" 
                onClick={handleCanvasClick}
              >
                <div ref={containerRef} className="relative w-full max-w-4xl aspect-video bg-neutral-900 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 group">
                
                {/* RENDER LAYERS */}
                {visibleClips.map((clip) => {
                    const transform = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
                    const isSelected = selectedClipId === clip.id;
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
                    };

                    const handleClipClick = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        if (!isPlaying) {
                            handleSelectClip(clip.id);
                        }
                    };

                    if (clip.type === 'video') {
                        return (
                            <div key={clip.id} style={style} onClick={handleClipClick} className={isPlaying ? 'pointer-events-none' : ''}>
                                <video 
                                    ref={(el) => { videoRefs.current[clip.id] = el; }}
                                    src={clip.sourceUrl || videoUrl || ''}
                                    className="w-full h-full object-contain pointer-events-none" 
                                    muted={false} 
                                    playsInline // Crucial for reliable seek/play behavior
                                    crossOrigin={(!clip.sourceUrl && !videoUrl) ? undefined : "anonymous"} // Conditional for DOM playback if needed, but safe here
                                />
                            </div>
                        );
                    } else {
                        return (
                            <div key={clip.id} style={style} onClick={handleClipClick} className={isPlaying ? 'pointer-events-none' : ''}>
                                <img 
                                    src={clip.sourceUrl || ''}
                                    alt={clip.title}
                                    className="w-full h-full object-contain pointer-events-none"
                                />
                            </div>
                        );
                    }
                })}

                {/* Empty State */}
                {!videoUrl && clips.length === 0 && (
                    <label className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors z-20">
                        <Video className="w-16 h-16 mb-4 opacity-20" />
                        <p className="font-medium text-lg mb-2">Click to upload video</p>
                        <p className="text-sm opacity-50">or drag and drop here</p>
                        <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
                    </label>
                )}

                {/* Canvas Controls Overlay (Transform) - ONLY SHOW IF NOT PLAYING */}
                {!isPlaying && isSelectedClipVisible && selectedClip && (
                    <CanvasControls 
                        clip={selectedClip} 
                        containerRef={containerRef} 
                        onUpdate={handleUpdateClipTransform} 
                    />
                )}
                
                {/* Export Overlay */}
                {isExporting && (
                    <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50">
                        <Loader2 className="w-12 h-12 text-green-500 animate-spin mb-4" />
                        <h3 className="text-xl font-bold text-white mb-2">Rendering Video...</h3>
                        <p className="text-neutral-400 mb-4">Frame by frame analysis to ensure smooth motion</p>
                        <div className="w-64 h-2 bg-neutral-800 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-green-500 transition-all duration-75"
                                style={{ width: `${exportProgress}%` }}
                            />
                        </div>
                    </div>
                )}
                
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur px-2 py-1 rounded text-xs font-mono text-neutral-400 border border-white/5 z-40 pointer-events-none">
                    VIRTUAL PLAYER ENGINE
                </div>
                </div>
              </div>

              {/* Player Control Bar */}
              <div className="h-12 bg-neutral-900 border-t border-neutral-800 flex items-center justify-between px-6 z-[200] relative">
                  <div className="flex items-center gap-4">
                      <button 
                          onClick={togglePlay}
                          className="w-8 h-8 flex items-center justify-center rounded-full bg-white text-black hover:bg-neutral-200 transition-colors"
                      >
                          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                      </button>
                      <span className="font-mono text-sm text-neutral-400">
                          <span className="text-white">{formatTime(currentTime)}</span>
                      </span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                       {/* Speed and Other Controls */}
                       {selectedClip && selectedClip.type === 'video' && (
                           <div className="relative">
                               <button 
                                   onClick={() => {
                                       setShowSpeedMenu(!showSpeedMenu);
                                       setIsCustomSpeed(false);
                                   }}
                                   className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${showSpeedMenu ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'}`}
                               >
                                   <Gauge className="w-3.5 h-3.5" />
                                   {selectedClip.speed}x
                                   <ChevronUp className={`w-3 h-3 transition-transform ${showSpeedMenu ? 'rotate-180' : ''}`} />
                               </button>
                               
                               {showSpeedMenu && (
                                   <div className="absolute bottom-full mb-2 right-0 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl overflow-hidden min-w-[140px] flex flex-col p-1 z-50 animate-in fade-in zoom-in-95 duration-100 origin-bottom-right">
                                       {!isCustomSpeed ? (
                                           <>
                                               {[0.25, 0.5, 1, 1.5, 2, 4, 8].map(s => (
                                                   <button
                                                       key={s}
                                                       onClick={() => handleClipSpeed(selectedClip.id, s)}
                                                       className={`text-left px-3 py-1.5 text-xs rounded hover:bg-neutral-700 transition-colors w-full ${selectedClip.speed === s ? 'text-blue-400 font-bold bg-neutral-700/50' : 'text-neutral-300'}`}
                                                   >
                                                       {s}x
                                                   </button>
                                               ))}
                                               <div className="h-px bg-neutral-700/50 my-1 mx-2" />
                                                <button
                                                    onClick={() => {
                                                        setIsCustomSpeed(true);
                                                        setCustomSpeedText(selectedClip.speed?.toString() || '1');
                                                    }}
                                                    className="text-left px-3 py-1.5 text-xs rounded hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors flex justify-between items-center group w-full"
                                                >
                                                    <span>Custom...</span>
                                                    <ChevronRight className="w-3 h-3 text-neutral-500 group-hover:text-white" />
                                                </button>
                                           </>
                                       ) : (
                                            <div className="p-2 w-32">
                                                <button 
                                                    onClick={() => setIsCustomSpeed(false)}
                                                    className="flex items-center gap-1 mb-3 text-[10px] font-medium text-neutral-400 hover:text-white uppercase tracking-wider transition-colors"
                                                >
                                                   <ChevronLeft className="w-3 h-3" /> Back
                                                </button>
                                                <div className="space-y-2">
                                                    <div className="relative">
                                                        <input 
                                                           autoFocus
                                                           type="number"
                                                           step="0.1"
                                                           min="0.1"
                                                           max="10"
                                                           value={customSpeedText}
                                                           onChange={(e) => setCustomSpeedText(e.target.value)}
                                                           onKeyDown={(e) => {
                                                               e.stopPropagation(); // Prevent global hotkeys
                                                               if (e.key === 'Enter') {
                                                                   const val = parseFloat(customSpeedText);
                                                                   if (!isNaN(val) && val > 0) handleClipSpeed(selectedClip.id, val);
                                                               }
                                                           }}
                                                           className="w-full bg-neutral-900 border border-neutral-600 rounded px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-neutral-600 pr-6"
                                                           placeholder="1.0"
                                                        />
                                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500 font-medium">x</span>
                                                    </div>
                                                    <button 
                                                       onClick={() => {
                                                           const val = parseFloat(customSpeedText);
                                                           if (!isNaN(val) && val > 0) handleClipSpeed(selectedClip.id, val);
                                                       }}
                                                       className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-medium py-1.5 rounded transition-colors"
                                                   >
                                                       Apply
                                                    </button>
                                                </div>
                                           </div>
                                       )}
                                   </div>
                               )}
                           </div>
                       )}

                       <button className="p-2 hover:bg-neutral-800 rounded-md text-neutral-400 hover:text-white transition-colors">
                           <Scissors className="w-4 h-4" onClick={handleSplitClip} />
                       </button>
                       <button className="p-2 hover:bg-neutral-800 rounded-md text-neutral-400 hover:text-white transition-colors">
                           <Maximize2 className="w-4 h-4" />
                       </button>
                  </div>
              </div>
          </div>

          {/* Timeline */}
          <div className="h-64 border-t border-neutral-800 bg-neutral-900/50 backdrop-blur-sm z-10 flex flex-col">
            <Timeline 
                clips={clips} 
                tracks={tracks}
                currentTime={currentTime} 
                onSeek={handleSeek} 
                onDelete={handleDeleteClip}
                onSelect={handleSelectClip}
                onAddMedia={handleAddMedia}
                onResize={handleClipResize}
                onReorder={handleClipReorder}
                onAddTrack={handleAddTrack}
                selectedClipId={selectedClipId}
            />
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-80 border-l border-neutral-800 bg-neutral-900 flex flex-col z-20">
          <div className="p-4 border-b border-neutral-800 flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-purple-400" />
            <h2 className="font-semibold text-sm">AI Assistant</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, idx) => {
              if (msg.role === 'system') {
                return (
                   <div key={idx} className="flex justify-center my-3 opacity-80 hover:opacity-100 transition-opacity">
                     <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-400 bg-neutral-800/50 border border-neutral-800 px-3 py-1 rounded-full flex items-center gap-2 shadow-sm">
                       {msg.text}
                     </span>
                   </div>
                );
              }

              return (
                <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white rounded-br-none' 
                      : 'bg-neutral-800 text-neutral-200 rounded-bl-none border border-neutral-700'
                  }`}>
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