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
import sqlite3
import hashlib
import hmac
import base64
import time
import secrets
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

DATABASE = "summarai.db"
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "summarai_super_secret_cryptographic_signing_key_98231")

# =========================================
# DATABASE INITIALIZATION
# =========================================
def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)
    
    # Create history table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        summary TEXT NOT NULL,
        thumbnail TEXT NOT NULL,
        video_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        quiz TEXT, -- JSON string representing questions
        pinned INTEGER DEFAULT 0,
        starred INTEGER DEFAULT 0, -- new column for favorites
        duration INTEGER DEFAULT 0, -- video duration in seconds
        created_at TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    
    # Dynamic schema migration for existing databases
    try:
        cursor.execute("ALTER TABLE history ADD COLUMN starred INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE history ADD COLUMN duration INTEGER DEFAULT 0")
    except Exception:
        pass
        
    conn.commit()
    conn.close()

# Auto initialize database on module load
init_db()

# =========================================
# SECURITY & AUTHENTICATION HELPERS
# =========================================
def hash_password(password, salt=None):
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000 # iterations
    )
    return f"{salt}:{key.hex()}"

def verify_password(password, stored_hash):
    try:
        salt, expected_key = stored_hash.split(":")
        actual_key = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            100000
        )
        return secrets.compare_digest(expected_key, actual_key.hex())
    except Exception:
        return False

def generate_token(user_id, email):
    payload = {
        "user_id": user_id,
        "email": email,
        "exp": time.time() + 86400 * 30 # 30 days session
    }
    payload_serialized = json.dumps(payload)
    payload_b64 = base64.b64encode(payload_serialized.encode()).decode()
    signature = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{signature}"

def verify_token(token):
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        
        payload_b64, signature = parts
        expected_sig = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        
        if not hmac.compare_digest(signature, expected_sig):
            return None
            
        payload_serialized = base64.b64decode(payload_b64.encode()).decode()
        payload = json.loads(payload_serialized)
        
        if time.time() > payload.get("exp", 0):
            return None
            
        return payload
    except Exception:
        return None

def get_current_user():
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ")[1]
    return verify_token(token)

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
        transcript_list = YouTubeTranscriptApi().list(video_id)
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

# =========================================
# SIGNUP & LOGIN ROUTES
# =========================================
@app.route("/signup", methods=["POST"])
def signup():
    data = request.get_json()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return {"success": False, "error": "Email and password are required"}, 400
        
    if len(password) < 6:
        return {"success": False, "error": "Password must be at least 6 characters"}, 400

    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    try:
        password_hash = hash_password(password)
        cursor.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, password_hash))
        conn.commit()
        user_id = cursor.lastrowid
        token = generate_token(user_id, email)
        return {
            "success": True,
            "token": token,
            "email": email,
            "user_id": user_id
        }
    except sqlite3.IntegrityError:
        return {"success": False, "error": "An account with this email already exists"}, 400
    except Exception as e:
        return {"success": False, "error": str(e)}, 500
    finally:
        conn.close()

@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return {"success": False, "error": "Email and password are required"}, 400

    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, password_hash FROM users WHERE email = ?", (email,))
        row = cursor.fetchone()
        if not row:
            return {"success": False, "error": "Invalid email or password"}, 401
            
        user_id, stored_hash = row
        if not verify_password(password, stored_hash):
            return {"success": False, "error": "Invalid email or password"}, 401
            
        token = generate_token(user_id, email)
        return {
            "success": True,
            "token": token,
            "email": email,
            "user_id": user_id
        }
    except Exception as e:
        return {"success": False, "error": str(e)}, 500
    finally:
        conn.close()

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
    data = request.get_json()
    youtube_url = data.get("url")
    mode = data.get("mode")

    try:
        video_id = extract_video_id(youtube_url)
        if not video_id:
            print(f"[ERROR] Invalid YouTube URL provided: {youtube_url}")
            return {"success": False, "error": "Invalid YouTube URL"}, 400

        # FETCH TRANSCRIPT
        transcript_res = fetch_best_transcript(video_id)
        if not transcript_res["success"]:
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
        full_response = call_openrouter(prompt)
        
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
    data = request.get_json()
    urls = data.get("urls", [])
    mode = data.get("mode")

    if not urls:
        print("[ERROR] summarize_multi called without urls")
        return {"success": False, "error": "No URLs provided"}, 400

    try:
        combined_transcripts = []
        all_errors = []
        total_duration = 0
        for url in urls:
            video_id = extract_video_id(url)
            if not video_id:
                print(f"[WARNING] Invalid URL skipped in multi-video: {url}")
                continue
            
            print(f"[DEBUG] Fetching multi-video transcript for: {video_id}")
            transcript_res = fetch_best_transcript(video_id)
            if transcript_res["success"]:
                combined_transcripts.append(f"Video ({video_id}): {transcript_res['transcript']}")
                total_duration += transcript_res.get("duration", 0)
            else:
                err_msg = transcript_res["error"]
                print(f"[ERROR] Failed to fetch transcript for {video_id} in multi-video: {err_msg}")
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
        full_response = call_openrouter(prompt)
        
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
    data = request.get_json()
    text = data.get("text")
    language = data.get("language")

    if not text or not language:
        return {"success": False, "error": "Text and language are required"}, 400

    try:
        prompt = f"""
Translate the following text into {language}.
Keep the meaning accurate and natural. Do not add any conversational commentary.

Text:
{text}
"""
        translated_text = call_openrouter(prompt)
        return {
            "success": True,
            "translated_text": translated_text
        }

    except Exception as e:
        print(f"[ERROR] Translate endpoint failed: {e}")
        return {"success": False, "error": str(e)}, 500


# =========================================
# SECURED CLOUD-SYNC HISTORY ENDPOINTS
# =========================================
@app.route("/api/history", methods=["GET"])
def get_user_history():
    user = get_current_user()
    if not user:
        return {"success": False, "error": "Unauthorized session"}, 401

    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT id, title, url, summary, thumbnail, video_id, mode, quiz, pinned, created_at, timestamp, starred, duration
            FROM history
            WHERE user_id = ?
            ORDER BY pinned DESC, timestamp DESC
        """, (user["user_id"],))
        rows = cursor.fetchall()
        
        history_list = []
        for r in rows:
            history_list.append({
                "id": r[0],
                "title": r[1],
                "url": r[2],
                "summary": r[3],
                "thumbnail": r[4],
                "videoId": r[5],
                "mode": r[6],
                "quiz": json.loads(r[7]) if r[7] else [],
                "pinned": bool(r[8]),
                "createdAt": r[9],
                "timestamp": r[10],
                "starred": bool(r[11]),
                "duration": r[12] if len(r) > 12 else 0
            })
        return {"success": True, "history": history_list}
    except Exception as e:
        return {"success": False, "error": str(e)}, 500
    finally:
        conn.close()

@app.route("/api/history", methods=["POST"])
def add_user_history():
    user = get_current_user()
    if not user:
        return {"success": False, "error": "Unauthorized session"}, 401

    data = request.get_json()
    title = data.get("title")
    url = data.get("url")
    summary = data.get("summary")
    thumbnail = data.get("thumbnail")
    video_id = data.get("videoId")
    mode = data.get("mode")
    quiz = data.get("quiz", [])
    pinned = 1 if data.get("pinned") else 0
    created_at = data.get("createdAt")
    timestamp = data.get("timestamp", int(time.time() * 1000))
    duration = data.get("duration", 0)

    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    try:
        starred = 1 if data.get("starred") else 0
        cursor.execute("""
            INSERT INTO history (user_id, title, url, summary, thumbnail, video_id, mode, quiz, pinned, starred, created_at, timestamp, duration)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (user["user_id"], title, url, summary, thumbnail, video_id, mode, json.dumps(quiz), pinned, starred, created_at, timestamp, duration))
        conn.commit()
        new_id = cursor.lastrowid
        return {"success": True, "id": new_id}
    except Exception as e:
        return {"success": False, "error": str(e)}, 500
    finally:
        conn.close()

@app.route("/api/history/<int:item_id>", methods=["PUT"])
def update_user_history(item_id):
    user = get_current_user()
    if not user:
        return {"success": False, "error": "Unauthorized session"}, 401

    data = request.get_json()

    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    try:
        update_fields = []
        params = []

        if "title" in data:
            update_fields.append("title = ?")
            params.append(data["title"])
        if "pinned" in data:
            update_fields.append("pinned = ?")
            params.append(1 if data["pinned"] else 0)
        if "starred" in data:
            update_fields.append("starred = ?")
            params.append(1 if data["starred"] else 0)

        if not update_fields:
            return {"success": False, "error": "No updates specified"}, 400

        params.append(item_id)
        params.append(user["user_id"])

        query = f"UPDATE history SET {', '.join(update_fields)} WHERE id = ? AND user_id = ?"
        cursor.execute(query, params)
        conn.commit()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}, 500
    finally:
        conn.close()

@app.route("/api/history/<int:item_id>", methods=["DELETE"])
def delete_user_history(item_id):
    user = get_current_user()
    if not user:
        return {"success": False, "error": "Unauthorized session"}, 401

    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM history WHERE id = ? AND user_id = ?", (item_id, user["user_id"]))
        conn.commit()
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}, 500
    finally:
        conn.close()

if __name__ == "__main__":
    app.run(debug=True)