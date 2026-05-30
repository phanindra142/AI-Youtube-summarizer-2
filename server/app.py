from flask import Flask, request
from flask_cors import CORS
from youtube_transcript_api import (
    YouTubeTranscriptApi,
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
    AgeRestricted,
    YouTubeTranscriptApiException
)
import requests
import os
import json
import re
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# Print basic configuration status (obfuscated)
print("=== SERVER INITIALIZATION ===")
openrouter_key = os.getenv("OPENROUTER_API_KEY")
print(f"OPENROUTER_API_KEY status: {'Loaded (ends in ...' + openrouter_key[-5:] + ')' if openrouter_key else 'Missing'}")
http_proxy = os.getenv("HTTP_PROXY")
https_proxy = os.getenv("HTTPS_PROXY")
print(f"HTTP_PROXY status: {'Configured' if http_proxy else 'Not Configured'}")
print(f"HTTPS_PROXY status: {'Configured' if https_proxy else 'Not Configured'}")
print("=============================")

# =========================================
# YOUTUBE HELPERS
# =========================================
def extract_video_id(url):
    if not url:
        return None
    url = url.strip()
    # If the URL is just an 11 character ID, return it
    if len(url) == 11 and re.match(r'^[a-zA-Z0-9_-]{11}$', url):
        return url
    
    # Check for v= parameter
    v_match = re.search(r'[?&]v=([a-zA-Z0-9_-]{11})', url)
    if v_match:
        return v_match.group(1)
        
    # Check for paths like /embed/ID, /v/ID, /shorts/ID, /live/ID, /e/ID
    path_match = re.search(r'/(?:embed|v|shorts|live|e)/([a-zA-Z0-9_-]{11})', url)
    if path_match:
        return path_match.group(1)
        
    # Check for youtu.be/ID
    youtu_match = re.search(r'youtu\.be/([a-zA-Z0-9_-]{11})', url)
    if youtu_match:
        return youtu_match.group(1)
        
    return None

def extract_text_from_snippets(snippets_data):
    if hasattr(snippets_data, "snippets"):
        snippets = snippets_data.snippets
    elif isinstance(snippets_data, list):
        snippets = snippets_data
    else:
        snippets = list(snippets_data)
        
    text_parts = []
    for item in snippets:
        if hasattr(item, "text"):
            text_parts.append(item.text)
        elif isinstance(item, dict) and "text" in item:
            text_parts.append(item["text"])
        else:
            text_parts.append(str(item))
    return " ".join(text_parts)

def get_transcript_list_with_fallback(video_id):
    # Try direct connection first
    try:
        print(f"[DEBUG] [Direct Fetch] Attempting direct fetch for video {video_id}...")
        return YouTubeTranscriptApi().list(video_id)
    except Exception as direct_err:
        print(f"[WARNING] [Direct Fetch] Failed: {direct_err}. Retrying with proxy rotation...")
        
        # Fetch active free proxies
        try:
            url = 'https://proxylist.geonode.com/api/proxy-list?limit=150&page=1&sort_by=lastChecked&sort_type=desc'
            r = requests.get(url, timeout=10)
            data = r.json().get('data', [])
        except Exception as api_err:
            print(f"[ERROR] [Proxy Fallback] Failed to fetch proxy list from Geonode: {api_err}")
            raise direct_err
            
        http_proxies = []
        for x in data:
            ip = x.get('ip')
            port = x.get('port')
            protocols = x.get('protocols', [])
            if 'http' in protocols or 'https' in protocols:
                http_proxies.append(f"http://{ip}:{port}")
                
        print(f"[DEBUG] [Proxy Fallback] Found {len(http_proxies)} HTTP proxies. Iterating top 30...")
        
        last_err = direct_err
        for i, proxy in enumerate(http_proxies[:30]):
            print(f"[DEBUG] [Proxy Fallback] Trying proxy {i+1}/30: {proxy} ...")
            try:
                session = requests.Session()
                session.proxies = {
                    "http": proxy,
                    "https": proxy
                }
                api = YouTubeTranscriptApi(http_client=session)
                result = api.list(video_id)
                print(f"[SUCCESS] [Proxy Fallback] Successfully fetched transcript list using proxy: {proxy}")
                return result
            except Exception as e:
                print(f"[DEBUG] [Proxy Fallback] Proxy {proxy} failed: {e}")
                last_err = e
                
        raise last_err

def fetch_best_transcript(video_id):
    """
    Fetches the best transcript available for a video based on priorities:
    1. English manual captions
    2. English auto-generated captions
    3. Translated English captions
    4. Any available transcript language
    5. Graceful fallback error
    """
    print(f"[DEBUG] Fetching transcript list for video ID: {video_id}")
    try:
        transcript_list = get_transcript_list_with_fallback(video_id)
    except TranscriptsDisabled as e:
        print(f"[ERROR] Transcripts are disabled for video {video_id}: {e}")
        return {"success": False, "error": "Transcripts are disabled for this video.", "available_languages": []}
    except VideoUnavailable as e:
        print(f"[ERROR] Video {video_id} is unavailable: {e}")
        return {"success": False, "error": "This video is unavailable.", "available_languages": []}
    except AgeRestricted as e:
        print(f"[ERROR] Video {video_id} is age restricted: {e}")
        return {"success": False, "error": "This video is age restricted and requires sign-in.", "available_languages": []}
    except Exception as e:
        print(f"[ERROR] Failed to list transcripts for video {video_id}: {e}")
        return {"success": False, "error": f"Failed to retrieve transcript information: {str(e)}", "available_languages": []}

    available_langs = []
    
    # Compile list of available languages for logging and user feedback
    for t in transcript_list:
        type_str = "auto-generated" if t.is_generated else "manual"
        lang_desc = f"{t.language} ({type_str})" if t.language else f"{t.language_code} ({type_str})"
        available_langs.append(lang_desc)
        
    print(f"[DEBUG] Video ID: {video_id}")
    print(f"[DEBUG] Available transcript languages: {', '.join(available_langs)}")

    # 1. English manual captions
    for t in transcript_list:
        if not t.is_generated and (t.language_code == 'en' or t.language_code.startswith('en-')):
            print(f"[DEBUG] Selected transcript language: {t.language_code} (manual, English)")
            try:
                raw_snippets = t.fetch()
                duration = 0
                if raw_snippets:
                    last_item = raw_snippets[-1]
                    duration = int(getattr(last_item, 'start', 0) + getattr(last_item, 'duration', 0))
                return {
                    "success": True, 
                    "transcript": extract_text_from_snippets(raw_snippets), 
                    "language": t.language_code,
                    "duration": duration
                }
            except Exception as fetch_err:
                print(f"[ERROR] Failed to fetch English manual transcript for video {video_id}: {fetch_err}")

    # 2. English auto-generated captions
    for t in transcript_list:
        if t.is_generated and (t.language_code == 'en' or t.language_code.startswith('en-')):
            print(f"[DEBUG] Selected transcript language: {t.language_code} (auto-generated, English)")
            try:
                raw_snippets = t.fetch()
                duration = 0
                if raw_snippets:
                    last_item = raw_snippets[-1]
                    duration = int(getattr(last_item, 'start', 0) + getattr(last_item, 'duration', 0))
                return {
                    "success": True, 
                    "transcript": extract_text_from_snippets(raw_snippets), 
                    "language": t.language_code,
                    "duration": duration
                }
            except Exception as fetch_err:
                print(f"[ERROR] Failed to fetch English auto-generated transcript for video {video_id}: {fetch_err}")

    # 3. Translated English captions
    for t in transcript_list:
        if t.is_translatable:
            translation_codes = [getattr(lang, 'language_code', None) for lang in t.translation_languages]
            translation_codes = [c for c in translation_codes if c]
            if 'en' in translation_codes:
                print(f"[DEBUG] Selected transcript language: {t.language_code} (translated to en)")
                try:
                    translated_t = t.translate('en')
                    raw_snippets = translated_t.fetch()
                    duration = 0
                    if raw_snippets:
                        last_item = raw_snippets[-1]
                        duration = int(getattr(last_item, 'start', 0) + getattr(last_item, 'duration', 0))
                    return {
                        "success": True, 
                        "transcript": extract_text_from_snippets(raw_snippets), 
                        "language": f"{t.language_code} -> en",
                        "duration": duration
                    }
                except Exception as fetch_err:
                    print(f"[ERROR] Failed to translate/fetch transcript to English for video {video_id}: {fetch_err}")

    # 4. Any available transcript language
    for t in transcript_list:
        type_str = "auto-generated" if t.is_generated else "manual"
        print(f"[DEBUG] Selected transcript language: {t.language_code} ({type_str})")
        try:
            raw_snippets = t.fetch()
            duration = 0
            if raw_snippets:
                last_item = raw_snippets[-1]
                duration = int(getattr(last_item, 'start', 0) + getattr(last_item, 'duration', 0))
            return {
                "success": True, 
                "transcript": extract_text_from_snippets(raw_snippets), 
                "language": t.language_code,
                "duration": duration
            }
        except Exception as fetch_err:
            print(f"[ERROR] Failed to fetch transcript for {t.language_code} for video {video_id}: {fetch_err}")

    # 5. Graceful fallback error
    print(f"[ERROR] No transcripts could be successfully fetched for video {video_id}")
    return {
        "success": False,
        "error": f"Could not retrieve transcript in any available language for video {video_id}.",
        "available_languages": available_langs,
        "duration": 0
    }

@app.route("/")
def home():
    return {
        "message": "SummarAI Security & Sync Backend is running successfully"
    }

# Authentication handled directly on frontend via Firebase

# =========================================
# OPENROUTER AI FALLBACK ENGINE
# =========================================
def call_openrouter(prompt, system_message=""):
    models = [
        "google/gemini-2.5-flash",
        "openrouter/free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "meta-llama/llama-3.2-3b-instruct:free",
        "google/gemma-4-26b-a4b-it:free",
        "nvidia/nemotron-3-super-120b-a12b:free"
    ]
    
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        print("[ERROR] OPENROUTER_API_KEY environment variable is not defined.")
        raise ValueError("OPENROUTER_API_KEY is missing in server environment")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "SummarAI"
    }

    last_error = None
    for model in models:
        payload = {
            "model": model,
            "messages": []
        }
        if system_message:
            payload["messages"].append({"role": "system", "content": system_message})
        payload["messages"].append({"role": "user", "content": prompt})

        try:
            print(f"[DEBUG] Attempting generation with model: {model}")
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=35
            )
            
            if response.status_code == 200:
                result = response.json()
                if "choices" in result and len(result["choices"]) > 0:
                    content = result["choices"][0]["message"]["content"]
                    if content and content.strip():
                        print(f"[DEBUG] Success with model: {model}")
                        return content
                print(f"[WARNING] Model {model} returned successful status but malformed choices payload: {result}")
                last_error = f"Malformed response from {model}"
            else:
                print(f"[WARNING] Model {model} returned status code {response.status_code}: {response.text}")
                last_error = f"Status {response.status_code} from {model}: {response.text}"
        except Exception as e:
            print(f"[ERROR] Exception calling model {model}: {e}")
            last_error = str(e)
            
    raise RuntimeError(f"All fallback models failed. Last error: {last_error}")


# =========================================
# SUMMARIZE API (UNPROTECTED DIRECT ACCESS)
# =========================================
@app.route("/summarize", methods=["POST"])
def summarize():
    print("[LOG] [/summarize] Request received")
    data = request.get_json()
    youtube_url = data.get("url")
    mode = data.get("mode")
    print(f"[LOG] [/summarize] URL received: {youtube_url} | Mode: {mode}")

    try:
        video_id = extract_video_id(youtube_url)
        if not video_id:
            print(f"[ERROR] [/summarize] Invalid YouTube URL: {youtube_url}")
            return {"success": False, "error": "Invalid YouTube URL"}, 400

        print(f"[LOG] [/summarize] Transcript fetch started for video: {video_id}")
        # FETCH TRANSCRIPT
        transcript_res = fetch_best_transcript(video_id)
        if not transcript_res["success"]:
            print(f"[ERROR] [/summarize] Transcript fetch failed: {transcript_res['error']}")
            return {
                "success": False,
                "error": transcript_res["error"],
                "available_languages": transcript_res.get("available_languages", [])
            }, 400
            
        full_transcript = transcript_res["transcript"]
        video_duration = transcript_res.get("duration", 0)
        if not full_transcript.strip():
            return {
                "success": False,
                "error": "Transcript is empty.",
                "available_languages": transcript_res.get("available_languages", [])
            }, 400

        # STUDY MODE
        if mode == "study":
            prompt = f"""
You are an AI educational assistant.

Analyze the following educational YouTube transcript and provide:

1. Topic Explanation
2. Important Definitions
3. Key Concepts
4. Important Points for Exams
5. Real-world Applications
6. Short Revision Notes
7. Final Conclusion

AFTER the notes generate exactly 5 MCQ questions.

IMPORTANT:
Return the quiz ONLY in valid JSON array format at the very end of the response.

Example:
[
  {{
    "question": "What is Stack?",
    "options": [
      "FIFO",
      "LIFO",
      "Tree",
      "Graph"
    ],
    "answer": "LIFO"
  }}
]

Do not use markdown.
Do not explain the quiz.
Only return valid JSON for the quiz section.

Transcript:
{full_transcript}
"""
        else:
            prompt = f"""
You are an AI YouTube video summarizer.

Analyze the following transcript and provide:

1. Short Summary
2. Important Key Points
3. Main Topic
4. Final Conclusion

Keep the response concise and easy to understand.

Transcript:
{full_transcript}
"""

        # Call OpenRouter using our robust fallback engine
        print("[LOG] [/summarize] OpenRouter request started")
        full_response = call_openrouter(prompt)
        print("[LOG] [/summarize] OpenRouter response received")
        
        summary = full_response
        smart_title = "YouTube Video Summary"
        quiz = []

        # QUIZ EXTRACTION
        if mode == "study":
            try:
                quiz_start = full_response.find("[")
                if quiz_start != -1:
                    summary = full_response[:quiz_start]
                    quiz_text = full_response[quiz_start:]
                    quiz = json.loads(quiz_text)
            except Exception as quiz_error:
                print("[ERROR] Quiz Parsing Error:", quiz_error)

        # GENERATE SMART TITLE
        title_prompt = f"""
Generate a very short professional title for this YouTube video.
Rules:
- Maximum 6 words
- No quotes
- No special symbols
- Clean readable title

Transcript preview:
{full_transcript[:1500]}
"""
        try:
            smart_title = call_openrouter(title_prompt).strip()
        except Exception as title_err:
            print(f"[WARNING] Failed to generate smart title: {title_err}")
            smart_title = "YouTube Video Summary"

        thumbnail = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"

        print("[LOG] [/summarize] Final response returned successfully")
        return {
            "success": True,
            "video_id": video_id,
            "summary": summary,
            "quiz": quiz,
            "thumbnail": thumbnail,
            "title": smart_title,
            "duration": video_duration
        }

    except Exception as e:
        print(f"[ERROR] Summarize endpoint failed: {e}")
        return {"success": False, "error": str(e)}, 500


# =========================================
# SUMMARIZE MULTI-VIDEO API
# =========================================
@app.route("/summarize_multi", methods=["POST"])
def summarize_multi():
    print("[LOG] [/summarize_multi] Request received")
    data = request.get_json()
    urls = data.get("urls", [])
    mode = data.get("mode")
    print(f"[LOG] [/summarize_multi] URLs received: {urls} | Mode: {mode}")

    if not urls:
        print("[ERROR] [/summarize_multi] summarize_multi called without urls")
        return {"success": False, "error": "No URLs provided"}, 400

    try:
        combined_transcripts = []
        all_errors = []
        total_duration = 0
        for url in urls:
            video_id = extract_video_id(url)
            if not video_id:
                print(f"[WARNING] [/summarize_multi] Invalid URL skipped: {url}")
                continue
            
            print(f"[LOG] [/summarize_multi] Fetching transcript for: {video_id}")
            transcript_res = fetch_best_transcript(video_id)
            if transcript_res["success"]:
                print(f"[LOG] [/summarize_multi] Transcript fetch success for: {video_id}")
                combined_transcripts.append(f"Video ({video_id}): {transcript_res['transcript']}")
                total_duration += transcript_res.get("duration", 0)
            else:
                err_msg = transcript_res["error"]
                print(f"[ERROR] [/summarize_multi] Failed to fetch transcript for {video_id}: {err_msg}")
                all_errors.append(f"Video ({video_id}): {err_msg}")
                continue

        if not combined_transcripts:
            error_details = "; ".join(all_errors)
            return {"success": False, "error": f"Could not retrieve transcripts for any of the provided videos. Details: {error_details}"}, 400

        mega_transcript = "\n\n".join(combined_transcripts)

        # Generate prompt for combined summary
        if mode == "study":
            prompt = f"""
You are an AI educational assistant.

Analyze the transcripts of these related videos and provide a combined, cohesive study guide:

1. Combined Topic Explanation
2. Important Definitions (merged from all videos)
3. Key Concepts
4. Important Points for Exams
5. Real-world Applications
6. Short Revision Notes
7. Final Combined Conclusion

AFTER the notes, generate exactly 5 MCQ questions based on the combined contents.
Return the quiz ONLY in valid JSON array format at the end.
Example:
[
  {{
    "question": "What is...",
    "options": ["A", "B", "C", "D"],
    "answer": "A"
  }}
]
Do not use markdown.
Only return valid JSON for the quiz section.

Transcripts:
{mega_transcript}
"""
        else:
            prompt = f"""
You are an AI YouTube video summarizer.

Analyze the transcripts of these related videos and provide a cohesive combined summary:

1. Combined Short Summary (combining themes from all videos)
2. Important Key Points
3. Main Topic & Comparison
4. Final Conclusion

Keep the response concise and easy to understand.

Transcripts:
{mega_transcript}
"""

        # Call OpenRouter using our robust fallback engine
        print("[LOG] [/summarize_multi] OpenRouter request started")
        full_response = call_openrouter(prompt)
        print("[LOG] [/summarize_multi] OpenRouter response received")
        
        summary = full_response
        quiz = []

        # QUIZ EXTRACTION
        if mode == "study":
            try:
                quiz_start = full_response.find("[")
                if quiz_start != -1:
                    summary = full_response[:quiz_start]
                    quiz_text = full_response[quiz_start:]
                    quiz = json.loads(quiz_text)
            except Exception as quiz_error:
                print("[ERROR] Quiz Parsing Error:", quiz_error)

        # Smart title for combined videos
        title_prompt = f"""
Generate a very short professional title for this combined video summary.
Maximum 6 words. No quotes.

Transcripts preview:
{mega_transcript[:1000]}
"""
        try:
            smart_title = call_openrouter(title_prompt).strip()
        except Exception as title_err:
            print(f"[WARNING] Failed to generate smart title: {title_err}")
            smart_title = "Combined YouTube Summary"
        
        # Thumbnail of the first video
        first_video_id = extract_video_id(urls[0])
        thumbnail = f"https://img.youtube.com/vi/{first_video_id}/hqdefault.jpg" if first_video_id else ""

        print("[LOG] [/summarize_multi] Final response returned successfully")
        return {
            "success": True,
            "video_id": first_video_id or "multi",
            "summary": summary,
            "quiz": quiz,
            "thumbnail": thumbnail,
            "title": smart_title,
            "duration": total_duration
        }

    except Exception as e:
        print(f"[ERROR] summarize_multi failed: {e}")
        return {"success": False, "error": str(e)}, 500


# =========================================
# TRANSLATE API
# =========================================
@app.route("/translate", methods=["POST"])
def translate_text():
    print("[LOG] [/translate] Request received")
    data = request.get_json()
    text = data.get("text")
    language = data.get("language")
    print(f"[LOG] [/translate] Language: {language} | Text length: {len(text) if text else 0}")

    if not text or not language:
        print("[ERROR] [/translate] Text or language is missing")
        return {"success": False, "error": "Text and language are required"}, 400

    try:
        prompt = f"""
Translate the following text into {language}.
Keep the meaning accurate and natural. Do not add any conversational commentary.

Text:
{text}
"""
        print("[LOG] [/translate] OpenRouter request started")
        translated_text = call_openrouter(prompt)
        print("[LOG] [/translate] OpenRouter response received")
        return {
            "success": True,
            "translated_text": translated_text
        }

    except Exception as e:
        print(f"[ERROR] Translate endpoint failed: {e}")
        return {"success": False, "error": str(e)}, 500


# User history synchronized directly from frontend to Cloud Firestore

if __name__ == "__main__":
    app.run(debug=True)