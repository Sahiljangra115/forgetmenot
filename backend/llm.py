"""LLM helpers for reminder text and note distillation.

Supports multiple LLM providers: OpenAI, Anthropic, OpenRouter, DeepSeek, Google, and Ollama.
API keys and provider settings can be configured via the /api/llm/config endpoint.
Falls back to plain string handling if no provider is configured.
"""

import os
import io
import json

_DEFAULT_CONFIG = {
    "provider": os.getenv("LLM_PROVIDER", "openai"),
    "api_key": os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY") or "",
    "model": os.getenv("SUMMARY_MODEL", "gpt-4o-mini"),
}

# ponytail: cache clients using a tuple key of (user_id, provider, key, base_url, model)
# so that the client automatically updates when settings change.
_clients: dict[tuple, object] = {}


def set_config(user_id: str | None, provider: str, api_key: str, model: str, base_url: str = ""):
    """Update LLM configuration for one user, saved to persistent auth store."""
    import auth
    auth.save_llm_config(user_id, provider, api_key, model, base_url)
    # Clear client cache entries for this user
    for k in list(_clients.keys()):
        if k[0] == user_id:
            _clients.pop(k, None)
    print(f"[llm] config updated persistently for user={user_id}: provider={provider}, model={model}, base_url={base_url}")


def _config_for(user_id: str | None) -> dict:
    if user_id:
        import auth
        cfg = auth.get_llm_config(user_id)
        if cfg:
            return cfg
    return _DEFAULT_CONFIG


def _get_base_url(user_id: str | None) -> str | None:
    """Get base URL for OpenAI-compatible servers."""
    config = _config_for(user_id)
    provider = config.get("provider", "openai")

    if provider == "ollama":
        stored_url = config.get("base_url", "")
        if stored_url:
            return stored_url
        return os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    elif provider == "openrouter":
        return "https://openrouter.ai/api/v1"
    elif provider == "deepseek":
        return "https://api.deepseek.com/v1"
    elif provider == "anthropic":
        return "https://api.anthropic.com/v1"

    return os.getenv("LLM_BASE_URL")


def _get_provider_key(user_id: str | None) -> str | None:
    """Get API key for the configured provider."""
    config = _config_for(user_id)
    provider = config.get("provider", "openai")
    api_key = config.get("api_key", "")

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


def _get(user_id: str | None = None):
    """Get or create this user's LLM client."""
    config = _config_for(user_id)
    provider = config.get("provider", "openai")
    key = _get_provider_key(user_id)
    base_url = _get_base_url(user_id)
    model = config.get("model", "gpt-4o-mini")

    cache_key = (user_id, provider, key, base_url, model)
    if cache_key in _clients:
        return _clients[cache_key]

    if not key:
        print(f"[llm] no API key for provider {provider}, using plain-text fallback")
        return None

    client = None
    try:
        if provider == "anthropic":
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=key)
            print(f"[llm] using Anthropic provider, model={model}")
        elif provider in ["openrouter", "deepseek", "ollama"]:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=key, base_url=base_url)
            print(f"[llm] using {provider} at {base_url}, model={model}")
        elif provider == "google":
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=key, base_url="https://generativelanguage.googleapis.com/v1beta/openai/")
            print(f"[llm] using Google Gemini via OpenAI-compatible endpoint, model={model}")
        else:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=key, base_url=base_url) if base_url else AsyncOpenAI(api_key=key)
            print(f"[llm] using OpenAI provider, model={model}")
    except Exception as e:
        print(f"[llm] client creation failed for {provider}: {e}")
        client = None

    _clients[cache_key] = client
    return client


def _model(user_id: str | None) -> str:
    """Get configured model name."""
    return _config_for(user_id).get("model", "gpt-4o-mini")


def _stt_provider() -> str:
    """Which STT backend to use: groq (free, hosted) / openai (paid) / local (free, offline, CPU)."""
    explicit = os.getenv("STT_PROVIDER")
    if explicit:
        return explicit
    if os.getenv("GROQ_API_KEY"):
        return "groq"
    if os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY"):
        return "openai"
    return "local"


def _stt_model() -> str:
    """Get STT model name for the active provider."""
    defaults = {"groq": "whisper-large-v3", "openai": "whisper-1", "local": "base"}
    return os.getenv("STT_MODEL", defaults.get(_stt_provider(), "whisper-1"))


_stt_client = None
_local_whisper = None


def _get_stt_client():
    """Hosted STT client (Groq or OpenAI), OpenAI-SDK compatible."""
    global _stt_client
    if _stt_client is not None:
        return _stt_client

    from openai import AsyncOpenAI

    provider = _stt_provider()
    if provider == "groq":
        _stt_client = AsyncOpenAI(api_key=os.getenv("GROQ_API_KEY"), base_url="https://api.groq.com/openai/v1")
    elif provider == "openai":
        _stt_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY"))
    return _stt_client


def _get_local_whisper():
    """Local, offline, free STT via faster-whisper. No API key, runs on CPU."""
    global _local_whisper
    if _local_whisper is None:
        from faster_whisper import WhisperModel
        _local_whisper = WhisperModel(_stt_model(), device="cpu", compute_type="int8")
    return _local_whisper


async def transcribe(audio_bytes: bytes, filename: str = "clip.webm", user_id: str | None = None) -> str | None:
    """Transcribe audio. STT_PROVIDER=groq (free, hosted, default if GROQ_API_KEY set) /
    openai (paid) / local (free, offline faster-whisper, no key, needs CPU)."""
    if not audio_bytes:
        return None

    provider = _stt_provider()

    try:
        if provider == "local":
            import asyncio
            model = _get_local_whisper()
            buf = io.BytesIO(audio_bytes)
            buf.name = filename
            segments, _ = await asyncio.to_thread(model.transcribe, buf)
            text = " ".join(seg.text for seg in segments).strip()
            return text or None

        client = _get_stt_client()
        if client is None:
            print(f"[llm] transcription unavailable: no key for provider {provider}")
            return None
        buf = io.BytesIO(audio_bytes)
        buf.name = filename
        r = await client.audio.transcriptions.create(model=_stt_model(), file=buf)
        text = (r.text or "").strip()
        return text or None
    except Exception as e:
        print(f"[llm] transcribe failed ({provider}): {e}")
        return None


async def one_liner(person: dict, snippets: list[str], user_id: str | None = None) -> str:
    """Turn recalled memory into one short reminder sentence."""
    joined = " ".join(s for s in snippets if s).strip()
    if not joined:
        return f"This is {person['name']}, your {person['relation']}."

    client = _get(user_id)
    if client is None:
        return joined[:160]

    provider = _config_for(user_id).get("provider", "openai")

    try:
        if provider == "anthropic":
            r = await client.messages.create(
                model=_model(user_id),
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
                model=_model(user_id),
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


async def summarize_conversation(person: dict, notes: list[str], user_id: str | None = None) -> dict:
    """Turn accumulated session notes into a summary and bullet points."""
    joined = " ".join(n for n in notes if n).strip()
    if not joined:
        return {"short": "Listening for conversation...", "bullets": []}

    client = _get(user_id)
    if client is None:
        return {"short": joined[:120], "bullets": notes[-5:]}

    provider = _config_for(user_id).get("provider", "openai")

    try:
        if provider == "anthropic":
            r = await client.messages.create(
                model=_model(user_id),
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
                model=_model(user_id),
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


async def distill(person: dict, notes: list[str], user_id: str | None = None) -> str | None:
    """Compress raw session notes into one durable fact for the graph."""
    joined = " ".join(n for n in notes if n).strip()
    if not joined:
        return None

    client = _get(user_id)
    prefix = f"About {person['name']} ({person['relation']}): "
    if client is None:
        return prefix + joined[:200]

    provider = _config_for(user_id).get("provider", "openai")

    try:
        if provider == "anthropic":
            r = await client.messages.create(
                model=_model(user_id),
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
                model=_model(user_id),
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

