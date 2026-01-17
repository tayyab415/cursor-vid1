import React, { useRef } from 'react';
import { Clip } from '../types';
import { X } from 'lucide-react';

interface TimelineProps {
  clips: Clip[];
  currentTime: number;
  onSeek: (time: number) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  selectedClipId: string | null;
}

export const Timeline: React.FC<TimelineProps> = ({ 
    clips, 
    currentTime, 
    onSeek, 
    onDelete, 
    onSelect, 
    selectedClipId 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate total duration
  const totalDuration = clips.reduce((acc, clip) => acc + clip.duration, 0);
  
  // Generate markers every 5 seconds. 
  const markers: number[] = [];
  const interval = 5;
  const endMarker = Math.ceil(totalDuration / interval) * interval + interval;
  
  for (let t = 0; t <= endMarker; t += interval) {
      markers.push(t);
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      // Prevent default to stop text selection, but manually blur any active input
      // so that keyboard shortcuts (like Backspace) work immediately.
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

  return (
    <div className="w-full h-full bg-neutral-900 border-t border-neutral-800 p-4 overflow-x-auto">
      <div 
        className="min-w-max relative h-full select-none cursor-crosshair"
        ref={containerRef}
        onMouseDown={handleMouseDown}
      >
        
        {/* Playhead */}
        <div 
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none transition-all duration-75 ease-linear"
            style={{ left: `${currentTime * 40}px` }}
        >
            <div className="absolute -top-1.5 -left-[4px] w-2.5 h-2.5 bg-red-500 rotate-45 border border-red-600 shadow-sm" />
        </div>

        {/* Clips Row */}
        <div className="flex items-center pt-4">
          {clips.map((clip) => {
            const isActive = currentTime >= clip.startTime && currentTime < (clip.startTime + clip.duration);
            const isSelected = selectedClipId === clip.id;
            
            return (
                <div
                key={clip.id}
                onClick={(e) => {
                    // Clicking selects the clip.
                    // Note: MouseDown on container handles seeking. Click event happens on mouse up.
                    e.stopPropagation(); // Stop propagation to prevent double processing if necessary
                    onSelect(clip.id);
                }}
                className={`group relative h-24 rounded-md flex flex-col justify-between p-2 transition-all duration-300 ease-in-out border ${
                    isSelected 
                        ? 'bg-blue-600/50 border-white ring-2 ring-white/50 z-20'
                        : isActive 
                            ? 'bg-blue-600/40 border-yellow-400 ring-1 ring-yellow-400 z-10' 
                            : 'bg-blue-600/20 border-blue-500/50 hover:bg-blue-600/30'
                }`}
                style={{ width: `${clip.duration * 40}px` }}
                >
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

                    <span className={`text-xs font-medium truncate ${isActive || isSelected ? 'text-white' : 'text-blue-100'}`}>{clip.title}</span>
                    <span className={`text-[10px] ${isActive || isSelected ? 'text-yellow-200' : 'text-blue-300'}`}>{clip.duration.toFixed(1)}s</span>
                    
                    {/* Hover Handle */}
                    <div className="absolute right-0 top-0 bottom-0 w-1 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-400/30" />
                </div>
            );
          })}
          {/* Placeholder for empty space at end of timeline */}
          <div className="h-24 flex-1 border-b border-dashed border-neutral-700 ml-2 opacity-50 min-w-[100px]" />
        </div>
        
        {/* Time markers Row */}
        <div className="relative mt-2 h-6" style={{ width: `${endMarker * 40}px` }}>
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