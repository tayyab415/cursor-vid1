import { GoogleGenAI, Type } from "@google/genai";
import { Clip, Suggestion } from "../types";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY is not defined");
  }
  return new GoogleGenAI({ apiKey });
};

export const analyzeVideoFrames = async (
  base64Frames: string[],
  prompt: string
): Promise<string> => {
  const ai = getAiClient();
  
  // Prepare parts: Text prompt + Image frames
  const parts: any[] = [{ text: prompt }];
  
  // Add each frame as an inline image
  base64Frames.forEach((frameData) => {
    // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
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
      contents: {
        parts: parts,
      },
      config: {
        thinkingConfig: { thinkingBudget: 1024 }, // Enable thinking for better analysis
      }
    });

    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};

export const suggestEdits = async (
  currentClips: Clip[]
): Promise<Suggestion[]> => {
  const ai = getAiClient();
  
  const prompt = `You are a professional video editor.
  Here is the current timeline of video clips: 
  ${JSON.stringify(currentClips, null, 2)}

  Task: Provide 3 distinct, high-quality edit suggestions.
  
  CRITICAL REQUIREMENT for Suggestion 1 ("Social Media Teaser Hook"):
  You MUST conceptually "copy-paste" a segment from later in the video to the very beginning.
  
  Logic for "Social Media Teaser Hook":
  1. Identify a clip from the MIDDLE or END of the list (index > 0).
  2. Create a NEW clip entry representing a 3-second highlight of that clip.
     - ID: "hook_from_[original_id]"
     - Title: "⚡️ HOOK: [Original Title]"
     - Duration: 3
  3. Insert this NEW clip at index 0 (Start of array).
  4. Preserve all original clips after it (do not delete them, just shift them down).
  
  Example Transformation:
  Input: [{id: "c1"}, {id: "c2"}]
  Output: [{id: "hook_c2", title: "⚡️ HOOK"}, {id: "c1"}, {id: "c2"}]

  Other Suggestions:
  - "Quick Cut / Pacing Fix": Trim 10-20% off durations.
  - "Narrative Reorder": Reverse the order or swap middle/end.

  Return a JSON object with a 'suggestions' array.
  For each suggestion, provide:
  - 'label', 'description', 'reasoning'
  - 'clips': The complete new array of clips. Ensure 'startTime' is sequential starting from 0.`;
  
  try {
    const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview', // Upgraded from Flash for better logic
        contents: prompt,
        config: {
          thinkingConfig: { thinkingBudget: 1024 }, // Enable thinking to plan the array manipulation
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
                          startTime: { type: Type.NUMBER }
                        },
                        required: ['id', 'title', 'duration', 'startTime']
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