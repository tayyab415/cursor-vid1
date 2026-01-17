import React, { useEffect, useRef, useState } from 'react';
import { Clip } from '../types';
import { Maximize, Move } from 'lucide-react';

interface CanvasControlsProps {
  clip: Clip;
  containerRef: React.RefObject<HTMLDivElement>;
  onUpdate: (id: string, newTransform: NonNullable<Clip['transform']>) => void;
}

export const CanvasControls: React.FC<CanvasControlsProps> = ({ clip, containerRef, onUpdate }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  // Snapshot of transform when drag starts
  const [initialTransform, setInitialTransform] = useState(clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging && !isResizing) return;
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const deltaX = e.clientX - startPos.x;
      const deltaY = e.clientY - startPos.y;

      if (isDragging) {
        // Convert pixel delta to percentage
        const xPercent = deltaX / rect.width;
        const yPercent = deltaY / rect.height;

        onUpdate(clip.id, {
          ...initialTransform,
          x: initialTransform.x + xPercent,
          y: initialTransform.y + yPercent,
        });
      } else if (isResizing) {
        // Simple scaling based on X movement
        // Moving right increases scale, left decreases
        // Sensitivity: 100px = 1x scale change
        const scaleDelta = deltaX / 200;
        const newScale = Math.max(0.1, initialTransform.scale + scaleDelta);

        onUpdate(clip.id, {
          ...initialTransform,
          scale: newScale,
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, startPos, initialTransform, clip.id, containerRef, onUpdate]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    setStartPos({ x: e.clientX, y: e.clientY });
    setInitialTransform(clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 });
  };

  const handleResizeDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResizing(true);
    setStartPos({ x: e.clientX, y: e.clientY });
    setInitialTransform(clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 });
  };

  const transform = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
  
  // Calculate style to match the element
  // Since x/y are percentages from center, we translate
  const style: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '100%', // The controls wrapper matches the element's size if we knew aspect ratio, 
                   // but here we just center a box that scales with the element?
                   // Easier: The controls are absolute 0,0,0,0 relative to the element container itself.
                   // Wait, the element is transformed. We need this box to be transformed identically.
    height: '100%', 
    transform: `translate(-50%, -50%) translate(${transform.x * 100}%, ${transform.y * 100}%) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
    pointerEvents: 'none', // Allow clicks to pass through to the actual media if needed, but we capture on handles
    zIndex: 100,
  };

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* We need a container that matches the transform to draw the border */}
        {/* Note: In a real app, we'd need to know the aspect ratio of the target clip to draw a tight border. 
            For this demo, we assume 16:9 for videos and maybe variable for images. 
            To keep it simple, we'll draw a box that is 50% width/height of container as a base size 
            or rely on the fact that the media is width:100% height:100% object-contain.
        */}
        <div style={style}>
            {/* The Border Box */}
            {/* We assume the content fills the 100%x100% of this transformed div? 
                Actually the media is usually object-contain. 
                Let's simplify: Put a border box in the center that represents the interaction area.
            */}
             <div className="w-full h-full border-2 border-blue-500 relative pointer-events-auto cursor-move group" onMouseDown={handleMouseDown}>
                
                {/* Drag Indicator */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-500/50 p-2 rounded-full">
                    <Move className="w-4 h-4 text-white" />
                </div>

                {/* Resize Handle (Bottom Right) */}
                <div 
                    className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border border-blue-500 rounded-full cursor-se-resize flex items-center justify-center hover:scale-125 transition-transform"
                    onMouseDown={handleResizeDown}
                >
                </div>

                 {/* Resize Handle (Top Left - just for visual symmetry, functional one is bottom right) */}
                <div className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white border border-blue-500 rounded-full"></div>
                <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border border-blue-500 rounded-full"></div>
                <div className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-white border border-blue-500 rounded-full"></div>
             </div>
        </div>
    </div>
  );
};