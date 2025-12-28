const MISTRAL_API_URL = "https://api.mistral.ai/v1/embeddings";
const EMBEDDING_MODEL = "mistral-embed";

// Throttling utilities
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let lastEmbeddingCall = 0;
const MIN_DELAY_MS = 250;

interface EmbeddingResponse {
  id: string;
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  // Retry loop for rate limiting
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Throttling: ensure minimum delay between calls
      const now = Date.now();
      const timeSinceLastCall = now - lastEmbeddingCall;
      if (timeSinceLastCall < MIN_DELAY_MS) {
        const throttleMs = MIN_DELAY_MS - timeSinceLastCall;
        console.log(`[EMBEDDING] Throttling ${throttleMs}ms`);
        await delay(throttleMs);
      }
      lastEmbeddingCall = Date.now();

      const response = await fetch(MISTRAL_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: [text],
        }),
      });

      // Handle rate limiting
      if (response.status === 429) {
        console.log(`[EMBEDDING] Rate limited, retry ${attempt + 1}`);
        await delay(500 * (attempt + 1));
        continue;
      }

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Mistral API error: ${error}`);
      }

      const data: EmbeddingResponse = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      if (attempt === 2) throw error;
      console.log(`[EMBEDDING] Error on attempt ${attempt + 1}, retrying...`);
      await delay(500 * (attempt + 1));
    }
  }

  // Fallback (should never reach here)
  throw new Error('Failed to generate embedding after 3 attempts');
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Mistral embed API supports batch processing
  const response = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mistral API error: ${error}`);
  }

  const data: EmbeddingResponse = await response.json();

  // Sort by index to maintain order
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}
