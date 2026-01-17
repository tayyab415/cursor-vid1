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
  
  CRITICAL DATA REQUIREMENT:
  The 'Clip' object now has a 'sourceStartTime' field. This represents the timestamp in the ORIGINAL raw footage.
  - When trimming: 'sourceStartTime' + 'duration' determines the range.
  - When splitting: The second part's 'sourceStartTime' must equal (Original 'sourceStartTime' + First Part 'duration').
  - When copying (Hook): The new hook clip MUST have the SAME 'sourceStartTime' as the segment it was copied from.

  Suggestion 1 ("Social Media Teaser Hook"):
  1. Identify a clip from the MIDDLE or END.
  2. Create a NEW clip (3s duration).
     - ID: "hook_from_[original_id]"
     - Title: "⚡️ HOOK"
     - sourceStartTime: [The sourceStartTime of the selected clip] + [Offset if grabbing from middle]
  3. Insert at index 0.
  4. Shift all other clips down (update 'startTime').

  Other Suggestions:
  - "Quick Cut": Trim 20%. Update 'sourceStartTime' if trimming the start.
  - "Reorder": Swap clips. Keep 'sourceStartTime' intact.

  Return a JSON object with a 'suggestions' array.
  For each suggestion, provide:
  - 'label', 'description', 'reasoning'
  - 'clips': The COMPLETE new array.
    - 'id', 'title', 'duration', 'startTime' (Timeline Position), 'sourceStartTime' (Original Video Position)`;
  
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
                          sourceStartTime: { type: Type.NUMBER }
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