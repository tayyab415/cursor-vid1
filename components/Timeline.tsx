import React, { useRef, useEffect, useState } from 'react';
import { Clip } from '../types';
import { X, Plus, Image as ImageIcon, Video, Layers, GripVertical, Mic, Wand2, Captions } from 'lucide-react';

interface TimelineProps {
  clips: Clip[];
  tracks: number[]; // Array of track IDs
  currentTime: number;
  onSeek: (time: number) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onAddMediaRequest: (trackId: number) => void;
  onResize: (id: string, newDuration: number, mode: 'start' | 'end', commit: boolean) => void;
  onReorder: (sourceId: string, targetId: string | null, targetTrackId: number) => void;
  onAddTrack: (position: 'top' | 'bottom') => void;
  selectedClipIds: string[];
  onTransitionRequest?: (clipA: Clip, clipB: Clip) => void;
  onCaptionRequest?: () => void;
}

export const Timeline: React.FC<TimelineProps> = ({ 
    clips, 
    tracks,
    currentTime, 
    onSeek, 
    onDelete, 
    onSelect, 
    onAddMediaRequest,
    onResize,
    onReorder,
    onAddTrack,
    selectedClipIds,
    onTransitionRequest,
    onCaptionRequest
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
      active: boolean;
      clipId: string | null;
      mode: 'start' | 'end';
      startX: number;
      startDuration: number;
  } | null>(null);

  const [dragOverClipId, setDragOverClipId] = useState<string | null>(null);
  const [dragOverTrackId, setDragOverTrackId] = useState<number | null>(null);
  const [hoveredGap, setHoveredGap] = useState<{ trackId: number, index: number } | null>(null);

  useEffect(() => {
    if (containerRef.current && !dragState?.active) {
        const container = containerRef.current.parentElement;
        if (container) {
            const pxPerSec = 40;
            const playheadPos = currentTime * pxPerSec;
            const halfWidth = container.clientWidth / 2;
            if (playheadPos > halfWidth) {
                container.scrollTo({ left: playheadPos - halfWidth, behavior: 'smooth' });
            } else {
                container.scrollTo({ left: 0, behavior: 'smooth' });
            }
        }
    }
  }, [currentTime, dragState]);

  useEffect(() => {
      if (!dragState?.active) return;
      const handleMouseMove = (e: MouseEvent) => {
          if (!dragState.active || !dragState.clipId) return;
          const deltaX = e.clientX - dragState.startX;
          const deltaSeconds = deltaX / 40; 
          let newDuration = dragState.startDuration;
          if (dragState.mode === 'end') {
              newDuration = Math.max(0.5, dragState.startDuration + deltaSeconds);
          } else {
              newDuration = Math.max(0.5, dragState.startDuration - deltaSeconds);
          }
          onResize(dragState.clipId, newDuration, dragState.mode, false);
      };
      const handleMouseUp = (e: MouseEvent) => {
        if (dragState.active && dragState.clipId) {
             const deltaX = e.clientX - dragState.startX;
             const deltaSeconds = deltaX / 40;
             let newDuration = dragState.startDuration;
             if (dragState.mode === 'end') {
                newDuration = Math.max(0.5, dragState.startDuration + deltaSeconds);
            } else {
                newDuration = Math.max(0.5, dragState.startDuration - deltaSeconds);
            }
            onResize(dragState.clipId, newDuration, dragState.mode, true);
        }
        setDragState(null);
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
      };
  }, [dragState, onResize]);

  const totalDuration = clips.reduce((acc, clip) => Math.max(acc, clip.startTime + clip.duration), 0);
  const markers: number[] = [];
  const interval = 5;
  const endMarker = Math.max(Math.ceil(totalDuration / interval) * interval + interval, 30);
  for (let t = 0; t <= endMarker; t += interval) markers.push(t);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button') || 
          (e.target as HTMLElement).closest('label') ||
          (e.target as HTMLElement).hasAttribute('data-resize-handle') ||
          (e.target as HTMLElement).closest('[draggable="true"]') 
      ) return;
      e.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const calculateTime = (clientX: number) => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const offsetX = clientX - rect.left;
          const time = Math.max(0, offsetX / 40);
          onSeek(time);
      };
      calculateTime(e.clientX);
      const handleMouseMove = (moveEvent: MouseEvent) => calculateTime(moveEvent.clientX);
      const handleMouseUp = () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
  };

  const startResize = (e: React.MouseEvent, clip: Clip, mode: 'start' | 'end') => {
      e.preventDefault();
      e.stopPropagation();
      setDragState({ active: true, clipId: clip.id, mode, startX: e.clientX, startDuration: clip.duration });
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
      if ((e.target as HTMLElement).hasAttribute('data-resize-handle')) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
  };
  const handleTrackDragOver = (e: React.DragEvent, trackId: number) => {
      e.preventDefault(); 
      if (dragOverTrackId !== trackId) setDragOverTrackId(trackId);
  };
  const handleClipDragOver = (e: React.DragEvent, id: string) => {
      e.preventDefault(); e.stopPropagation();
      if (dragOverClipId !== id) setDragOverClipId(id);
  };
  const handleDrop = (e: React.DragEvent, targetTrackId: number, targetClipId: string | null = null) => {
      e.preventDefault(); e.stopPropagation();
      const sourceId = e.dataTransfer.getData('text/plain');
      if (sourceId) onReorder(sourceId, targetClipId, targetTrackId);
      setDragOverClipId(null); setDragOverTrackId(null);
  };

  return (
    <div className="w-full h-full bg-neutral-900 border-t border-neutral-800 flex flex-col relative select-none">
       <div className="h-8 border-b border-neutral-800 flex items-center justify-between px-2 bg-neutral-800/50">
           <div className="flex items-center gap-2">
                <button onClick={() => onAddTrack('top')} className="flex items-center gap-1 text-[10px] bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-2 py-0.5 rounded text-neutral-300 hover:text-white transition-colors">
                    <Layers size={10} /> Add Track Above
                </button>
                <button onClick={() => onAddTrack('bottom')} className="flex items-center gap-1 text-[10px] bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-2 py-0.5 rounded text-neutral-300 hover:text-white transition-colors">
                    <Layers size={10} /> Add Track Below
                </button>
                <div className="w-px h-4 bg-neutral-700 mx-1" />
                <button onClick={onCaptionRequest} className="flex items-center gap-1.5 text-[10px] bg-purple-900/30 hover:bg-purple-900/50 border border-purple-500/30 px-2 py-0.5 rounded text-purple-200 hover:text-white transition-colors">
                    <Mic size={10} /> Generate Captions
                </button>
           </div>
           <span className="text-[10px] text-neutral-500 font-mono">Total: {formatTime(totalDuration)}</span>
       </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto scroll-smooth relative">
        <div className="min-w-max relative min-h-full cursor-crosshair pb-8" ref={containerRef} onMouseDown={handleMouseDown}>
            <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-50 pointer-events-none" style={{ left: `${currentTime * 40}px` }}>
                <div className="absolute -top-1.5 -left-[4px] w-2.5 h-2.5 bg-red-500 rotate-45 border border-red-600 shadow-sm" />
                <div className="absolute top-0 bottom-0 left-0 right-0 bg-red-500/20 w-px blur-[1px]" />
            </div>

            <div className="flex flex-col py-4 gap-2">
                {[...tracks].reverse().map((trackId) => {
                    // Filter and sort clips
                    const trackClips = clips.filter(c => c.trackId === trackId).sort((a, b) => a.startTime - b.startTime);
                    const isTrackDragOver = dragOverTrackId === trackId;
                    
                    return (
                        <div key={trackId} className="relative">
                            <div className="absolute left-2 -top-3 text-[9px] font-bold text-neutral-600 uppercase tracking-widest pointer-events-none z-10">Track {trackId + 1}</div>
                            <div 
                                className={`h-24 w-full relative transition-colors ${isTrackDragOver ? 'bg-blue-900/10' : 'bg-neutral-800/20'} border-y border-neutral-800/30`}
                                style={{ minWidth: `${(endMarker + 10) * 40}px` }}
                                onDragOver={(e) => handleTrackDragOver(e, trackId)}
                                onDrop={(e) => handleDrop(e, trackId, null)}
                                onDragLeave={() => setDragOverTrackId(null)}
                            >
                                {trackClips.map((clip, index) => {
                                    const isActive = currentTime >= clip.startTime && currentTime < (clip.startTime + clip.duration);
                                    const isSelected = selectedClipIds.includes(clip.id);
                                    const isClipDragTarget = dragOverClipId === clip.id;
                                    const isAudio = clip.type === 'audio';
                                    const isText = clip.type === 'text';

                                    // Dynamic styles based on type
                                    let bgClass = '';
                                    let icon = null;
                                    if (isAudio) {
                                        bgClass = isSelected ? 'bg-orange-500/50' : isActive ? 'bg-orange-500/40' : 'bg-orange-500/20 border-orange-500/30 hover:bg-orange-600/30';
                                        icon = <Mic size={10} className="text-orange-300" />;
                                    } else if (isText) {
                                        bgClass = isSelected ? 'bg-emerald-500/50' : isActive ? 'bg-emerald-500/40' : 'bg-emerald-500/20 border-emerald-500/30 hover:bg-emerald-600/30';
                                        icon = <Captions size={10} className="text-emerald-300" />;
                                    } else {
                                        // Video/Image
                                        bgClass = isSelected ? 'bg-blue-600/50' : isActive ? 'bg-blue-600/40' : 'bg-blue-600/20 border-blue-500/30 hover:bg-blue-600/30';
                                        icon = clip.type === 'image' ? <ImageIcon size={10} className="text-purple-300" /> : <Video size={10} className="text-blue-300" />;
                                    }

                                    // Check for transition opportunity (only for video/image)
                                    let transitionBtn = null;
                                    if (!isAudio && !isText && index < trackClips.length - 1) {
                                        const nextClip = trackClips[index + 1];
                                        if (nextClip.type !== 'audio' && nextClip.type !== 'text') {
                                            const clipEndTime = clip.startTime + clip.duration;
                                            const gap = nextClip.startTime - clipEndTime;
                                            // Allow transition if gap is negligible (< 0.1s)
                                            if (gap < 0.1 && gap > -0.1) {
                                                transitionBtn = (
                                                    <div 
                                                        key={`trans-${clip.id}`}
                                                        className="absolute z-[60] top-1 bottom-1 w-6 -ml-3 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity group/trans"
                                                        style={{ left: `${clipEndTime * 40}px` }}
                                                        onMouseEnter={() => setHoveredGap({trackId, index})}
                                                        onMouseLeave={() => setHoveredGap(null)}
                                                    >
                                                         {/* Visual Guide Line in gap */}
                                                         <div className="absolute inset-y-0 w-0.5 bg-purple-500/50 opacity-50 group-hover/trans:opacity-100" />
                                                         
                                                         <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (onTransitionRequest) onTransitionRequest(clip, nextClip);
                                                            }}
                                                            className="relative w-6 h-6 rounded-full bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center shadow-lg transform scale-90 group-hover/trans:scale-110 transition-transform z-50 border border-purple-400"
                                                            title="Generate AI Transition with Veo"
                                                         >
                                                            <Wand2 size={12} />
                                                         </button>
                                                    </div>
                                                );
                                            }
                                        }
                                    }

                                    return (
                                        <React.Fragment key={clip.id}>
                                            <div
                                                draggable={true}
                                                onDragStart={(e) => handleDragStart(e, clip.id)}
                                                onDragOver={(e) => handleClipDragOver(e, clip.id)}
                                                onDrop={(e) => handleDrop(e, trackId, clip.id)}
                                                onDragLeave={() => setDragOverClipId(null)}
                                                onClick={(e) => { e.stopPropagation(); onSelect(clip.id, e); }}
                                                className={`group absolute top-1 bottom-1 rounded-md flex flex-col justify-between p-2 transition-all duration-200 ease-out border overflow-hidden cursor-grab active:cursor-grabbing ${bgClass} ${isSelected ? 'border-white ring-2 ring-white/50 z-20' : 'z-10'}`}
                                                style={{ 
                                                    left: `${clip.startTime * 40}px`,
                                                    width: `${clip.duration * 40}px`,
                                                    transition: dragState?.active ? 'none' : 'left 0.3s ease, width 0.1s ease',
                                                    boxShadow: isClipDragTarget ? '-4px 0 0 0 #ffffff' : undefined
                                                }}
                                            >
                                                <div data-resize-handle className="absolute left-0 top-0 bottom-0 w-3 cursor-w-resize hover:bg-white/20 z-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" onMouseDown={(e) => startResize(e, clip, 'start')}><div className="w-0.5 h-6 bg-white/50 rounded-full" /></div>
                                                <div data-resize-handle className="absolute right-0 top-0 bottom-0 w-3 cursor-e-resize hover:bg-white/20 z-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" onMouseDown={(e) => startResize(e, clip, 'end')}><div className="w-0.5 h-6 bg-white/50 rounded-full" /></div>
                                                <div className="flex items-center gap-1.5 mb-1 pointer-events-none">
                                                    {icon}
                                                    <span className={`text-xs font-medium truncate ${isActive || isSelected ? 'text-white' : isText ? 'text-emerald-100' : 'text-blue-100'}`}>{clip.title}</span>
                                                </div>
                                                <span className={`text-[10px] pointer-events-none ${isActive || isSelected ? 'text-yellow-200' : 'text-white/50'}`}>{clip.duration.toFixed(1)}s</span>
                                                <button onClick={(e) => { e.stopPropagation(); onDelete(clip.id); }} className="absolute top-1 right-1 p-0.5 rounded-full bg-black/40 hover:bg-red-500 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-30"><X size={10} strokeWidth={3} /></button>
                                            </div>
                                            {/* Render Transition Trigger Sibling */}
                                            {transitionBtn}
                                        </React.Fragment>
                                    );
                                })}
                                <button onClick={() => onAddMediaRequest(trackId)} className="group absolute h-20 w-20 border-2 border-dashed border-neutral-700/50 hover:border-blue-500/50 bg-neutral-800/10 hover:bg-blue-500/5 rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all z-0 top-2 hover:scale-105 active:scale-95" style={{ left: `${(trackClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0) * 40) + 20}px`, transition: dragState?.active ? 'none' : 'left 0.3s ease' }}>
                                    <div className="w-6 h-6 rounded-full bg-neutral-700 group-hover:bg-blue-500 flex items-center justify-center transition-colors"><Plus className="w-3 h-3 text-neutral-400 group-hover:text-white" strokeWidth={3} /></div>
                                    <span className="text-[9px] text-neutral-500 group-hover:text-blue-200 mt-1 font-medium">Add Media</span>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="relative mt-2 h-6 border-t border-neutral-800/50 pt-1" style={{ width: `${(endMarker + 10) * 40}px` }}>
            {markers.map((time) => (
                <div key={time} className="absolute top-0 flex flex-col items-center" style={{ left: `${time * 40}px`, transform: 'translateX(-50%)' }}>
                    <div className="h-1.5 w-px bg-neutral-600 mb-1"></div>
                    <span className="text-[10px] text-neutral-500 font-mono select-none">{formatTime(time)}</span>
                </div>
            ))}
            </div>
        </div>
      </div>
    </div>
  );
};