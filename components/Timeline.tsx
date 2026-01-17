import React, { useRef, useEffect, useState } from 'react';
import { Clip } from '../types';
import { X, Plus, Image as ImageIcon, Video } from 'lucide-react';

interface TimelineProps {
  clips: Clip[];
  currentTime: number;
  onSeek: (time: number) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  onAddMedia: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onResize: (id: string, newDuration: number, mode: 'start' | 'end', commit: boolean) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  selectedClipId: string | null;
}

export const Timeline: React.FC<TimelineProps> = ({ 
    clips, 
    currentTime, 
    onSeek, 
    onDelete, 
    onSelect, 
    onAddMedia,
    onResize,
    onReorder,
    selectedClipId 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
      active: boolean;
      clipId: string | null;
      mode: 'start' | 'end';
      startX: number;
      startDuration: number;
  } | null>(null);

  // State for Reordering
  const [dragOverClipId, setDragOverClipId] = useState<string | null>(null);

  // Auto-scroll logic: Keep playhead centered
  useEffect(() => {
    if (containerRef.current && !dragState?.active) {
        const container = containerRef.current.parentElement; // The scrollable parent
        if (container) {
            const pxPerSec = 40;
            const playheadPos = currentTime * pxPerSec;
            const halfWidth = container.clientWidth / 2;
            
            // Only scroll if we are past the middle
            if (playheadPos > halfWidth) {
                container.scrollTo({
                    left: playheadPos - halfWidth,
                    behavior: 'smooth'
                });
            } else {
                container.scrollTo({ left: 0, behavior: 'smooth' });
            }
        }
    }
  }, [currentTime, dragState]);

  // Global Mouse Events for Resize Dragging
  useEffect(() => {
      if (!dragState?.active) return;

      const handleMouseMove = (e: MouseEvent) => {
          if (!dragState.active || !dragState.clipId) return;
          
          const deltaX = e.clientX - dragState.startX;
          const deltaSeconds = deltaX / 40; // 40px per second

          let newDuration = dragState.startDuration;
          
          if (dragState.mode === 'end') {
              newDuration = Math.max(0.5, dragState.startDuration + deltaSeconds);
          } else {
              // Dragging left handle: moving right (positive delta) decreases duration
              newDuration = Math.max(0.5, dragState.startDuration - deltaSeconds);
          }

          onResize(dragState.clipId, newDuration, dragState.mode, false);
      };

      const handleMouseUp = (e: MouseEvent) => {
        if (dragState.active && dragState.clipId) {
             // Final commit
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


  // Calculate total duration
  const totalDuration = clips.reduce((acc, clip) => Math.max(acc, clip.startTime + clip.duration), 0);
  
  // Generate markers every 5 seconds. 
  const markers: number[] = [];
  const interval = 5;
  // Make timeline slightly longer than content to fit the add button
  const endMarker = Math.max(Math.ceil(totalDuration / interval) * interval + interval, 30);
  
  for (let t = 0; t <= endMarker; t += interval) {
      markers.push(t);
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      // Don't seek if clicking buttons, inputs, DRAG HANDLES, or CLIPS (to allow drag)
      if ((e.target as HTMLElement).closest('button') || 
          (e.target as HTMLElement).closest('label') ||
          (e.target as HTMLElement).hasAttribute('data-resize-handle') ||
          (e.target as HTMLElement).closest('[draggable="true"]') 
      ) return;

      e.preventDefault();
      if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
      }

      const calculateTime = (clientX: number) => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const offsetX = clientX - rect.left;
          const time = Math.max(0, offsetX / 40);
          onSeek(time);
      };

      calculateTime(e.clientX);

      const handleMouseMove = (moveEvent: MouseEvent) => {
          calculateTime(moveEvent.clientX);
      };

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
      setDragState({
          active: true,
          clipId: clip.id,
          mode,
          startX: e.clientX,
          startDuration: clip.duration
      });
  };

  // --- Drag and Drop Handlers ---
  const handleDragStart = (e: React.DragEvent, id: string) => {
      // Prevent drag if we clicked a resize handle
      if ((e.target as HTMLElement).hasAttribute('data-resize-handle')) {
          e.preventDefault();
          return;
      }
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
      e.preventDefault(); // Necessary to allow dropping
      if (dragOverClipId !== id) {
          setDragOverClipId(id);
      }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData('text/plain');
      if (sourceId && sourceId !== targetId) {
          onReorder(sourceId, targetId);
      }
      setDragOverClipId(null);
  };

  const handleDragEnd = () => {
      setDragOverClipId(null);
  };

  return (
    <div className="w-full h-full bg-neutral-900 border-t border-neutral-800 p-4 overflow-x-auto scroll-smooth relative select-none">
      <div 
        className="min-w-max relative h-full cursor-crosshair"
        ref={containerRef}
        onMouseDown={handleMouseDown}
      >
        
        {/* Playhead */}
        <div 
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none transition-all duration-75 ease-linear"
            style={{ left: `${currentTime * 40}px` }}
        >
            <div className="absolute -top-1.5 -left-[4px] w-2.5 h-2.5 bg-red-500 rotate-45 border border-red-600 shadow-sm" />
            <div className="absolute top-0 bottom-0 left-0 right-0 bg-red-500/20 w-px blur-[1px]" />
        </div>

        {/* Clips Row */}
        <div className="flex items-center pt-4 relative" style={{ height: '120px' }}>
          {clips.map((clip) => {
            const isActive = currentTime >= clip.startTime && currentTime < (clip.startTime + clip.duration);
            const isSelected = selectedClipId === clip.id;
            const isDragTarget = dragOverClipId === clip.id;
            
            return (
                <div
                key={clip.id}
                draggable={true}
                onDragStart={(e) => handleDragStart(e, clip.id)}
                onDragOver={(e) => handleDragOver(e, clip.id)}
                onDrop={(e) => handleDrop(e, clip.id)}
                onDragEnd={handleDragEnd}
                onDragLeave={() => setDragOverClipId(null)}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(clip.id);
                }}
                className={`group relative h-24 rounded-md flex flex-col justify-between p-2 transition-all duration-200 ease-out border overflow-hidden cursor-grab active:cursor-grabbing ${
                    isSelected 
                        ? 'bg-blue-600/50 border-white ring-2 ring-white/50 z-20 shadow-[0_0_15px_rgba(37,99,235,0.5)]'
                        : isActive 
                            ? 'bg-blue-600/40 border-white shadow-[0_0_10px_rgba(255,255,255,0.3)] z-10' 
                            : 'bg-blue-600/20 border-blue-500/30 hover:bg-blue-600/30'
                }`}
                style={{ 
                    position: 'absolute',
                    left: `${clip.startTime * 40}px`,
                    width: `${clip.duration * 40}px`,
                    transition: dragState?.active ? 'none' : 'left 0.3s ease, width 0.1s ease', // Smooth movement for magnet effect
                    // Visual cue for insertion
                    boxShadow: isDragTarget ? '-4px 0 0 0 #ffffff' : undefined
                }}
                >
                    {/* LEFT RESIZE HANDLE */}
                    <div 
                        data-resize-handle
                        className="absolute left-0 top-0 bottom-0 w-4 cursor-w-resize hover:bg-white/20 z-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => startResize(e, clip, 'start')}
                    >
                        <div className="w-1 h-8 bg-white/50 rounded-full" />
                    </div>

                    {/* RIGHT RESIZE HANDLE */}
                    <div 
                        data-resize-handle
                        className="absolute right-0 top-0 bottom-0 w-4 cursor-e-resize hover:bg-white/20 z-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => startResize(e, clip, 'end')}
                    >
                        <div className="w-1 h-8 bg-white/50 rounded-full" />
                    </div>


                    {/* Delete Button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(clip.id);
                        }}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/40 hover:bg-red-500 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-30"
                        title="Delete clip (Backspace)"
                    >
                        <X size={12} strokeWidth={3} />
                    </button>

                    <div className="flex items-center gap-1.5 mb-1 pointer-events-none">
                        {clip.type === 'image' ? <ImageIcon size={10} className="text-purple-300" /> : <Video size={10} className="text-blue-300" />}
                        <span className={`text-xs font-medium truncate ${isActive || isSelected ? 'text-white' : 'text-blue-100'}`}>{clip.title}</span>
                    </div>
                    
                    <span className={`text-[10px] pointer-events-none ${isActive || isSelected ? 'text-yellow-200' : 'text-blue-300'}`}>{clip.duration.toFixed(1)}s</span>
                    
                </div>
            );
          })}

          {/* ADD BUTTON */}
          <label 
            className="group absolute h-24 w-24 border-2 border-dashed border-neutral-700 hover:border-blue-500 bg-neutral-800/30 hover:bg-blue-500/10 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all z-10 hover:scale-105 active:scale-95"
            style={{ 
                left: `${totalDuration * 40 + 10}px`,
                transition: dragState?.active ? 'none' : 'left 0.3s ease'
            }}
          >
             <div className="w-8 h-8 rounded-full bg-neutral-700 group-hover:bg-blue-500 flex items-center justify-center transition-colors mb-2">
                <Plus className="w-5 h-5 text-neutral-400 group-hover:text-white" strokeWidth={3} />
             </div>
             <span className="text-[10px] font-medium text-neutral-500 group-hover:text-blue-300">Add Media</span>
             <input type="file" accept="video/*,image/*" className="hidden" onChange={onAddMedia} />
          </label>
        </div>
        
        {/* Time markers Row */}
        <div className="relative mt-2 h-6 border-t border-neutral-800/50 pt-1" style={{ width: `${(endMarker + 10) * 40}px` }}>
           {markers.map((time) => (
              <div 
                  key={time} 
                  className="absolute top-0 flex flex-col items-center"
                  style={{ left: `${time * 40}px`, transform: 'translateX(-50%)' }}
              >
                  {/* Tick mark */}
                  <div className="h-1.5 w-px bg-neutral-600 mb-1"></div>
                  {/* Label */}
                  <span className="text-[10px] text-neutral-500 font-mono select-none">
                      {formatTime(time)}
                  </span>
              </div>
           ))}
        </div>
      </div>
    </div>
  );
};