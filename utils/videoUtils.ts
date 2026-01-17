/**
 * Extracts a sequence of frames from a video file.
 * This simulates "Video Understanding" by feeding the model a visual storyboard
 * since we cannot easily upload large video files in a client-side only demo.
 */
export const extractFramesFromVideo = async (
  videoFile: File,
  numberOfFrames: number = 10
): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const frames: string[] = [];
    
    // Create a URL for the video file
    const url = URL.createObjectURL(videoFile);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    video.onloadedmetadata = async () => {
      canvas.width = video.videoWidth / 4; // Downscale for API payload size optimization
      canvas.height = video.videoHeight / 4;
      const duration = video.duration;
      const interval = duration / (numberOfFrames + 1);

      try {
        for (let i = 1; i <= numberOfFrames; i++) {
          const currentTime = interval * i;
          video.currentTime = currentTime;
          
          // Wait for seek to complete
          await new Promise<void>((seekResolve) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              seekResolve();
            };
            video.addEventListener('seeked', onSeeked);
          });

          // Draw frame
          if (context) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            // Low quality jpeg to save tokens/bandwidth
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            frames.push(dataUrl);
          }
        }
        
        URL.revokeObjectURL(url);
        resolve(frames);
      } catch (e) {
        reject(e);
      }
    };

    video.onerror = (e) => {
        reject(e);
    };
  });
};
