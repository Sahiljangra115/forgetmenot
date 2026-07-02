"""LLM helpers for reminder text and note distillation.

Supports multiple LLM providers: OpenAI, Anthropic, OpenRouter, DeepSeek, Google, and Ollama.
API keys and provider settings can be configured via the /api/llm/config endpoint.
Falls back to plain string handling if no provider is configured.
"""

import os
import io
import json

_client = None
_tried = False
_config = {
    "provider": os.getenv("LLM_PROVIDER", "openai"),
    "api_key": os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY") or "",
    "model": os.getenv("SUMMARY_MODEL", "gpt-4o-mini"),
}


def set_config(provider: str, api_key: str, model: str):
    """Update LLM configuration from frontend."""
    global _client, _tried
    _config["provider"] = provider
    _config["api_key"] = api_key
    _config["model"] = model
    _client = None
    _tried = False
    print(f"[llm] config updated: provider={provider}, model={model}")


def _get_base_url() -> str | None:
    """Get base URL for OpenAI-compatible servers."""
    provider = _config.get("provider", "openai")
    
    if provider == "ollama":
        return os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    elif provider == "openrouter":
        return "https://openrouter.ai/api/v1"
    elif provider == "deepseek":
        return "https://api.deepseek.com/v1"
    elif provider == "anthropic":
        return "https://api.anthropic.com/v1"
    
    return os.getenv("LLM_BASE_URL")


def _get_provider_key() -> str | None:
    """Get API key for the configured provider."""
    provider = _config.get("provider", "openai")
    api_key = _config.get("api_key", "")
    
    if api_key:
        return api_key
    
    if provider == "openai":
        return os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY")
    elif provider == "anthropic":
        return os.getenv("ANTHROPIC_API_KEY")
    elif provider == "openrouter":
        return os.getenv("OPENROUTER_API_KEY")
    elif provider == "deepseek":
        return os.getenv("DEEPSEEK_API_KEY")
    elif provider == "google":
        return os.getenv("GOOGLE_API_KEY")
    elif provider == "ollama":
        return "local"
    
    return None


def _get():
    """Get or create LLM client."""
    global _client, _tried
    if _tried:
        return _client
    _tried = True
    
    provider = _config.get("provider", "openai")
    key = _get_provider_key()
    base_url = _get_base_url()
    
    if not key:
        print(f"[llm] no API key for provider {provider}, using plain-text fallback")
        return None
    
    try:
        if provider == "anthropic":
            from anthropic import AsyncAnthropic
            _client = AsyncAnthropic(api_key=key)
            print(f"[llm] using Anthropic provider, model={_config.get('model')}")
        elif provider in ["openrouter", "deepseek", "ollama"]:
            from openai import AsyncOpenAI
            _client = AsyncOpenAI(api_key=key, base_url=base_url)
            print(f"[llm] using {provider} at {base_url}, model={_config.get('model')}")
        elif provider == "google":
            import anthropic
            _client = anthropic.AsyncAnthropic(api_key=key)
            print(f"[llm] using Google Gemini via Anthropic SDK, model={_config.get('model')}")
        else:
            from openai import AsyncOpenAI
            _client = AsyncOpenAI(api_key=key, base_url=base_url) if base_url else AsyncOpenAI(api_key=key)
            print(f"[llm] using OpenAI provider, model={_config.get('model')}")
    except Exception as e:
        print(f"[llm] client creation failed for {provider}: {e}")
        _client = None
    
    return _client


def _model() -> str:
    """Get configured model name."""
    return _config.get("model", "gpt-4o-mini")


def _stt_model() -> str:
    """Get STT model (OpenAI Whisper only)."""
    return os.getenv("STT_MODEL", "whisper-1")


async def transcribe(audio_bytes: bytes, filename: str = "clip.webm") -> str | None:
    """Transcribe audio. Only works with OpenAI provider."""
    if not audio_bytes:
        return None
    
    provider = _config.get("provider", "openai")
    if provider != "openai":
        print(f"[llm] transcription not supported for {provider}")
        return None
    
    client = _get()
    if client is None:
        return None
    
    try:
        buf = io.BytesIO(audio_bytes)
        buf.name = filename
        r = await client.audio.transcriptions.create(model=_stt_model(), file=buf)
        text = (r.text or "").strip()
        return text or None
    except Exception as e:
        print(f"[llm] transcribe failed: {e}")
        return None


async def one_liner(person: dict, snippets: list[str]) -> str:
    """Turn recalled memory into one short reminder sentence."""
    joined = " ".join(s for s in snippets if s).strip()
    if not joined:
        return f"This is {person['name']}, your {person['relation']}."
    
    client = _get()
    if client is None:
        return joined[:160]
    
    provider = _config.get("provider", "openai")
    
    try:
        if provider == "anthropic":
            r = await client.messages.create(
                model=_model(),
                max_tokens=60,
                system=(
                    "You help someone with memory loss. Write one short, warm "
                    "reminder sentence about the person in front of them, using "
                    "the memory provided. Max 18 words. No preamble, no quotes."
                ),
                messages=[{
                    "role": "user",
                    "content": f"Person: {person['name']} ({person['relation']}). What I remember: {joined}"
                }],
            )
            return r.content[0].text.strip()
        else:
            r = await client.chat.completions.create(
                model=_model(),
                messages=[
                    {"role": "system", "content": (
                        "You help someone with memory loss. Write one short, warm "
                        "reminder sentence about the person in front of them, using "
                        "the memory provided. Max 18 words. No preamble, no quotes."
                    )},
                    {"role": "user", "content": (
                        f"Person: {person['name']} ({person['relation']}). "
                        f"What I remember: {joined}"
                    )},
                ],
                max_tokens=60,
                temperature=0.4,
            )
            return r.choices[0].message.content.strip()
    except Exception as e:
        print(f"[llm] one_liner failed: {e}")
        return joined[:160]


async def summarize_conversation(person: dict, notes: list[str]) -> dict:
    """Turn accumulated session notes into a summary and bullet points."""
    joined = " ".join(n for n in notes if n).strip()
    if not joined:
        return {"short": "Listening for conversation...", "bullets": []}
    
    client = _get()
    if client is None:
        return {"short": joined[:120], "bullets": notes[-5:]}
    
    provider = _config.get("provider", "openai")
    
    try:
        if provider == "anthropic":
            r = await client.messages.create(
                model=_model(),
                max_tokens=200,
                system=(
                    "Summarize this conversation transcript for a caregiver dashboard. "
                    "Reply as JSON: {\"short\": one sentence under 14 words, "
                    "\"bullets\": 2-5 short bullet points with concrete details "
                    "mentioned (names, plans, feelings, topics)}. No preamble."
                ),
                messages=[{
                    "role": "user",
                    "content": f"Person: {person['name']} ({person['relation']}). Transcript: {joined}"
                }],
            )
            data = json.loads(r.content[0].text)
        else:
            r = await client.chat.completions.create(
                model=_model(),
                messages=[
                    {"role": "system", "content": (
                        "Summarize this conversation transcript for a caregiver dashboard. "
                        "Reply as JSON: {\"short\": one sentence under 14 words, "
                        "\"bullets\": 2-5 short bullet points with concrete details "
                        "mentioned (names, plans, feelings, topics)}. No preamble."
                    )},
                    {"role": "user", "content": (
                        f"Person: {person['name']} ({person['relation']}). Transcript: {joined}"
                    )},
                ],
                max_tokens=200,
                temperature=0.3,
                response_format={"type": "json_object"},
            )
            data = json.loads(r.choices[0].message.content)
        
        return {
            "short": str(data.get("short", "")).strip() or joined[:120],
            "bullets": [str(b).strip() for b in data.get("bullets", []) if str(b).strip()],
        }
    except Exception as e:
        print(f"[llm] summarize_conversation failed: {e}")
        return {"short": joined[:120], "bullets": notes[-5:]}


async def distill(person: dict, notes: list[str]) -> str | None:
    """Compress raw session notes into one durable fact for the graph."""
    joined = " ".join(n for n in notes if n).strip()
    if not joined:
        return None
    
    client = _get()
    prefix = f"About {person['name']} ({person['relation']}): "
    if client is None:
        return prefix + joined[:200]
    
    provider = _config.get("provider", "openai")
    
    try:
        if provider == "anthropic":
            r = await client.messages.create(
                model=_model(),
                max_tokens=80,
                system=(
                    "Distill these raw observation notes into one durable, "
                    "factual sentence worth remembering long-term. No preamble."
                ),
                messages=[{
                    "role": "user",
                    "content": f"Person: {person['name']} ({person['relation']}). Notes: {joined}"
                }],
            )
            return prefix + r.content[0].text.strip()
        else:
            r = await client.chat.completions.create(
                model=_model(),
                messages=[
                    {"role": "system", "content": (
                        "Distill these raw observation notes into one durable, "
                        "factual sentence worth remembering long-term. No preamble."
                    )},
                    {"role": "user", "content": (
                        f"Person: {person['name']} ({person['relation']}). "
                        f"Notes: {joined}"
                    )},
                ],
                max_tokens=80,
                temperature=0.3,
            )
            return prefix + r.choices[0].message.content.strip()
    except Exception as e:
        print(f"[llm] distill failed: {e}")
        return prefix + joined[:200]

