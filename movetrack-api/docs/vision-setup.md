# Vision AI Setup Guide

> Written: 2025-11-09 | Status: **Current** | Multi-provider vision configuration

Nexus Moves supports multiple vision AI providers for analyzing item photos:

1. **Google Gemini 2.0 Flash** (Recommended for MVP)
2. **Anthropic Claude 3.5 Sonnet**
3. **OpenAI GPT-4o**

## Quick Start

### 1. Choose Your Provider(s)

You can configure one or all three providers. The app will use whichever you set as default in `.env`.

### 2. Get API Keys

#### Google Gemini (Free Tier Available)
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Get API Key"
3. Copy your API key
4. Add to `.env`: `GOOGLE_AI_API_KEY=your-key-here`

**Cost**: Free tier includes 15 requests/minute, 1M tokens/day
**Best for**: MVP, testing, low-cost production

#### Anthropic Claude (Most Accurate)
1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an account
3. Navigate to API Keys
4. Generate a new key
5. Add to `.env`: `ANTHROPIC_API_KEY=your-key-here`

**Cost**: ~$3 per 1M input tokens, ~$15 per 1M output tokens (~$0.005-0.015 per image)
**Best for**: Highest accuracy, detailed analysis

#### OpenAI GPT-4o (Well-Rounded)
1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create account
3. Click "Create new secret key"
4. Copy your API key
5. Add to `.env`: `OPENAI_API_KEY=your-key-here`

**Cost**: ~$0.01-0.03 per image
**Best for**: General purpose, familiar platform

### 3. Configure Environment Variables

Edit your `.env` file:

```bash
# Set your default provider
VISION_PROVIDER=gemini

# Add API keys for the providers you want to use
GOOGLE_AI_API_KEY=your-google-key
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
```

### 4. Restart the API Server

```bash
cd movetrack-api
npm start
```

## Using the Vision Providers

### Authentication Required

All vision features require user authentication. Users must be logged in to access vision AI capabilities.

### API Endpoints

All endpoints require authentication via `Authorization: Bearer <session_token>` header.

Routes are mounted under `/api/vision/` (see `routes/api/vision/`).

#### Analyze Item Photo
```bash
POST /api/vision/analyze-item
Content-Type: multipart/form-data
Authorization: Bearer <session_token>

# Body: form-data with 'image' field containing the photo file
# Optional query param: ?provider=gemini|claude|gpt4
```

#### Get Current Provider
```bash
GET /api/vision/provider
Authorization: Bearer <session_token>
```

#### Set Provider
```bash
POST /api/vision/provider
Content-Type: application/json
Authorization: Bearer <session_token>

{ "provider": "claude" }
```

## Cost Comparison

| Provider | Free Tier | Cost per 1K Images | Speed | Accuracy |
|----------|-----------|-------------------|-------|----------|
| Gemini 2.0 Flash | Yes (1M tokens/day) | $0-3 | Fast | High |
| Claude 3.5 Sonnet | No | $5-15 | Medium | Highest |
| GPT-4o | No | $10-30 | Medium | Highest |

## Recommended Setup

### For Development/Testing
```bash
VISION_PROVIDER=gemini
GOOGLE_AI_API_KEY=your-key
```

### For Production (Low Volume)
```bash
VISION_PROVIDER=gemini
GOOGLE_AI_API_KEY=your-key
```

### For Production (High Accuracy)
```bash
VISION_PROVIDER=claude
ANTHROPIC_API_KEY=your-key
GOOGLE_AI_API_KEY=your-fallback-key
```

## Response Format

All providers return data in this format:

```json
{
  "success": true,
  "provider": "gemini",
  "model": "gemini-2.0-flash-exp",
  "data": {
    "name": "Ceramic Vase",
    "material": "ceramic",
    "color": "white",
    "estimatedDimensions": { "length": 8, "width": 4, "height": 4 },
    "estimatedWeight": 1.5,
    "fragile": true,
    "tags": ["Fragile", "Ceramic", "Decorative"],
    "confidence": 0.85,
    "reasoning": "Based on the smooth surface and delicate appearance..."
  }
}
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| "No vision providers configured" | Set at least one API key in `.env`, restart server |
| "Failed to analyze image" | Check API key validity and remaining quota |
| "Provider not available" | The requested provider's API key is not configured |
