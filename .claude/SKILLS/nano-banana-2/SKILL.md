---
name: nano-banana-2
description: Generate and edit images using Google Nano Banana 2 (Gemini image model) via the mcp-image MCP server. Use when asked to create, generate, edit, or produce any image. Calls the generate_image MCP tool. Requires GEMINI_API_KEY environment variable and the mcp-image MCP server to be active.
---

# Nano Banana 2 — Image Generation Skill

Generates and edits images using Google Nano Banana 2 (Gemini 3.1 Flash Image) via the `mcp-image` MCP server.

## Setup

The `mcp-image` MCP server must be configured in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "mcp-image": {
      "command": "npx",
      "args": ["-y", "mcp-image"],
      "env": {
        "GEMINI_API_KEY": "${GEMINI_API_KEY}",
        "IMAGE_OUTPUT_DIR": "<absolute-path-to-outputs-folder>"
      }
    }
  }
}
```

**Required:** `GEMINI_API_KEY` — get from [Google AI Studio](https://aistudio.google.com/apikey)

To install manually via CLI:
```bash
claude mcp add mcp-image --env GEMINI_API_KEY=your-key \
  --env IMAGE_OUTPUT_DIR=/absolute/path/to/outputs -- npx -y mcp-image
```

## Workflow

1. **Build prompt** — clear, descriptive text. Include style, mood, subject, composition, color palette
2. **Call `generate_image`** — pass prompt + relevant parameters
3. **Return result** — the tool returns a file URI; report the saved path to the user

## Tool: generate_image

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `prompt` | string | ✅ | Text description of the image |
| `quality` | string | — | `fast` (default), `balanced`, `quality` |
| `aspectRatio` | string | — | `1:1`, `2:3`, `3:2`, `16:9`, `21:9` |
| `imageSize` | string | — | `1K`, `2K`, `4K` |
| `fileName` | string | — | Custom output filename (no extension needed) |
| `inputImagePath` | string | — | Absolute path — for image-to-image editing |
| `maintainCharacterConsistency` | boolean | — | Preserve character appearance across variations |
| `useWorldKnowledge` | boolean | — | Accurate rendering of real-world subjects |
| `useGoogleSearch` | boolean | — | Real-time factual grounding |
| `purpose` | string | — | Context hint (e.g., `"social media post"`, `"book cover"`) |

**Response format:**
```json
{
  "resource": {
    "uri": "file:///path/to/generated/image.png",
    "name": "image-filename.png"
  },
  "metadata": {
    "model": "gemini-3.1-flash-image-preview",
    "processingTime": 5000
  }
}
```

## Quality Presets

| Preset | Speed | Use when |
|--------|-------|----------|
| `fast` | ~30–40s | Drafts, iteration, testing prompts |
| `balanced` | ~60s | Most use cases |
| `quality` | ~90s+ | Final output, hero images |

## Examples

**Basic generation:**
```
prompt: "A minimalist Japanese garden with koi pond, soft morning light, muted earth tones"
quality: "balanced"
aspectRatio: "16:9"
```

**Image editing:**
```
prompt: "Change the background to a sunset"
inputImagePath: "/absolute/path/to/image.png"
quality: "balanced"
```

**High-res with consistency:**
```
prompt: "Portrait of a young woman in 1920s fashion, Art Deco style"
imageSize: "4K"
maintainCharacterConsistency: true
quality: "quality"
```
