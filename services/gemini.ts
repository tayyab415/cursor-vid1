import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Clip, Suggestion } from "../types";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY is not defined");
  }
  return new GoogleGenAI({ apiKey });
};

// --- UTILS ---

// Helper to convert raw PCM to WAV Blob URL
const pcmToWav = (pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1): string => {
    const buffer = new ArrayBuffer(44 + pcmData.length);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length, true);
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true); // 16-bit

    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, pcmData.length, true);

    // Write PCM data
    const payload = new Uint8Array(buffer, 44);
    payload.set(pcmData);

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
};

const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
};

const base64ToUint8Array = (base64: string) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};


// --- API CALLS ---

export const analyzeVideoFrames = async (
  base64Frames: string[],
  prompt: string
): Promise<string> => {
  const ai = getAiClient();
  const parts: any[] = [{ text: prompt }];
  
  base64Frames.forEach((frameData) => {
    const cleanData = frameData.split(',')[1] || frameData;
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: cleanData,
      },
    });
  });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: { parts: parts },
      config: { thinkingConfig: { thinkingBudget: 1024 } }
    });
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};

export const suggestEdits = async (currentClips: Clip[]): Promise<Suggestion[]> => {
  const ai = getAiClient();
  const prompt = `You are a professional video editor.
  Here is the current timeline of video clips: 
  ${JSON.stringify(currentClips, null, 2)}
  Task: Provide 3 distinct, high-quality edit suggestions.
  Return a JSON object with a 'suggestions' array.`;
  
  try {
    const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingBudget: 1024 },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    description: { type: Type.STRING },
                    reasoning: { type: Type.STRING },
                    clips: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          title: { type: Type.STRING },
                          duration: { type: Type.NUMBER },
                          startTime: { type: Type.NUMBER },
                          sourceStartTime: { type: Type.NUMBER },
                          type: { type: Type.STRING }
                        },
                        required: ['id', 'title', 'duration', 'startTime', 'sourceStartTime']
                      }
                    }
                  },
                  required: ['label', 'description', 'reasoning', 'clips']
                }
              }
            }
          }
        }
    });

    const json = JSON.parse(response.text || "{ \"suggestions\": [] }");
    return json.suggestions || [];
  } catch (error) {
    console.error("Suggestion Error:", error);
    return [];
  }
};

export const generateImage = async (
    prompt: string, 
    model: string = 'gemini-2.5-flash-image', 
    aspectRatio: string = '16:9'
): Promise<string> => {
    const ai = getAiClient();
    try {
        const config: any = {
             imageConfig: { aspectRatio: aspectRatio }
        };

        // gemini-3-pro-image-preview supports imageSize, flash-image does not
        if (model === 'gemini-3-pro-image-preview') {
             config.imageConfig.imageSize = '2K';
        }

        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [{ text: prompt }] },
            config: config
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                const base64EncodeString = part.inlineData.data;
                return `data:${part.inlineData.mimeType};base64,${base64EncodeString}`;
            }
        }
        throw new Error("No image data found in response");
    } catch (error) {
        console.error("Image Generation Error:", error);
        throw error;
    }
};

export const generateVideo = async (
    prompt: string,
    model: string = 'veo-3.1-fast-generate-preview',
    aspectRatio: string = '16:9'
): Promise<string> => {
    // Check for API key selection for Veo models
    if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
             await window.aistudio.openSelectKey();
             // Re-instantiate client after selection if needed, but getAiClient pulls process.env
        }
    }

    const ai = getAiClient();
    try {
        let operation = await ai.models.generateVideos({
            model: model,
            prompt: prompt,
            config: {
                numberOfVideos: 1,
                resolution: '720p',
                aspectRatio: aspectRatio === '16:9' || aspectRatio === '9:16' ? aspectRatio as any : '16:9'
            }
        });

        // Polling loop
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) throw new Error("No video URI in response");

        // Fetch and blobify to avoid CORS/expiration issues in simple tags
        const apiKey = process.env.API_KEY;
        const res = await fetch(`${downloadLink}&key=${apiKey}`);
        const blob = await res.blob();
        return URL.createObjectURL(blob);

    } catch (error) {
        console.error("Video Generation Error:", error);
        throw error;
    }
};

export const generateSpeech = async (
    text: string,
    voiceName: string = 'Kore'
): Promise<string> => {
    const ai = getAiClient();
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) throw new Error("No audio data found");

        // Decode base64 to raw PCM then add WAV header
        const pcmData = base64ToUint8Array(base64Audio);
        const wavUrl = pcmToWav(pcmData, 24000, 1);
        
        return wavUrl;
    } catch (error) {
        console.error("Speech Generation Error:", error);
        throw error;
    }
};
