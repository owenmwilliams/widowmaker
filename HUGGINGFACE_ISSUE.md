# HuggingFace Vision Models Issue & Solution

## The Problem

You asked why Florence-2 and Nemotron can't work with the HuggingFace Inference API. The answer is **they DO accept visual and textual data simultaneously**, but there are two critical issues:

### Issue 1: Not Deployed on Inference API
**Florence-2-base** and **Nemotron-4-140B** are NOT deployed on HuggingFace's serverless Inference API. According to the model cards:
- Florence-2: "This model isn't deployed by any Inference Provider on Hugging Face"
- Nemotron: Same issue - requires self-hosting

This means you cannot use them via the public `https://router.huggingface.co/hf-inference/` endpoint without deploying your own Inference Endpoint (which costs money).

### Issue 2: Wrong API Endpoint
The old HuggingFace Inference API endpoint (`https://api-inference.huggingface.co`) was deprecated and returns a 410 error directing users to use `https://router.huggingface.co/hf-inference` instead.

## How Vision-Language Models Work

Florence-2, Nemotron, and other VLMs DO work with both text and images:

1. **Input**: Image + Text prompt
2. **Processing**: Vision encoder converts image to embeddings, text encoder processes prompt
3. **Output**: Text response (can include JSON, captions, object detection, etc.)

The issue isn't their capability - it's availability on the public API.

## Solutions

### Option 1: Use Models Available on Inference API

Replace Florence-2 and Nemotron with models that ARE deployed:

**Recommended Models (Free via Inference API):**
- `HuggingFaceM4/idefics2-8b` - Strong multimodal model
- `Qwen/Qwen2-VL-7B-Instruct` - Excellent vision-language model
- `HuggingFaceM4/SmolVLM-Instruct` - Small (2B) but capable
- `meta-llama/Llama-3.2-11B-Vision-Instruct` - If you have access

### Option 2: Deploy Your Own Inference Endpoint

Use HuggingFace's paid Inference Endpoints to deploy Florence-2 or Nemotron:
1. Go to https://ui.endpoints.huggingface.co/
2. Create new endpoint with your chosen model
3. Use the endpoint URL in your code
4. Cost: ~$0.06-$0.60/hour depending on GPU

### Option 3: Run Locally

Install and run the models on your own hardware:
```bash
pip install transformers torch pillow
```

Then use them via Python scripts instead of API calls.

## Recommended Fix (IMPLEMENTED)

**✅ Implemented Together.ai Integration** - Best solution for cost-effective open-source models.

Together.ai provides:
- **Llama-Vision-Free**: Completely FREE vision model (11B parameters)
- **Qwen2.5-VL-72B**: State-of-the-art vision model at ~$0.0003-0.0005 per image
- **True pay-per-use**: Auto-scales to $0 when idle (no manual pausing needed)
- **Better than HuggingFace**: More models available, better pricing, auto-scaling

## Available Models on Together.ai

Based on research, Together.ai has these vision models available:

### Confirmed Available:
- **meta-llama/Llama-Vision-Free** - FREE 11B multimodal model
- **meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo** - Pay-per-use
- **meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo** - Enterprise-grade
- **Qwen/Qwen2.5-VL-72B-Instruct** - State-of-the-art multilingual VLM
- **Qwen/Qwen2-VL-72B-Instruct** - Previous generation

### NOT Available on Together.ai:
- ❌ **Florence-2** - Microsoft model, not on Together.ai (available on HuggingFace with paid endpoints or fal.ai)
- ❌ **Nemotron** - Nvidia model, not on Together.ai (available on build.nvidia.com or OpenRouter)

## Current Status

✅ Fixed: API endpoint updated to new router URL
✅ Fixed: Added logging for HuggingFace configuration
✅ Implemented: Together.ai integration with Llama-Vision-Free and Qwen2.5-VL-72B
✅ Created: Test script (test-together.js) to verify Together.ai setup
✅ Updated: .env.example with Together.ai configuration
❌ Blocked: Florence-2 and Nemotron not available on free Inference API OR Together.ai

## Cost Comparison

For your business model (pay less for open source, charge more for premium):

**Free Tier:**
- Together.ai Llama-Vision-Free: **$0** per image

**Standard Tier:**
- Together.ai Qwen2.5-VL-72B: **~$0.0003-0.0005** per image

**Premium Tier:**
- Claude 3.5 Sonnet: **~$0.015** per image
- GPT-4o: **~$0.01** per image
- Gemini 2.0 Flash: **~$0.01** per image

## Setup Instructions

1. Get Together.ai API key: https://api.together.xyz/settings/api-keys
2. Add to `.env`: `TOGETHER_API_KEY=your-key-here`
3. Set provider: `VISION_PROVIDER=together-llama` (free) or `together-qwen` (premium open-source)
4. Test: `node test-together.js`

## Recommendation

Use Together.ai for open-source models instead of HuggingFace:
- Lower cost (~50x cheaper than Claude/GPT)
- Better availability (no deployment needed)
- Auto-scaling to zero (true pay-per-use)
- Free tier available (Llama-Vision-Free)

