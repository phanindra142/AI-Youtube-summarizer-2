import { useState, useEffect, useRef } from "react"
import axios from "axios"
import jsPDF from "jspdf"
import { auth, db } from "../firebase"
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth"
import {
  collection,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc
} from "firebase/firestore"
import {
  Menu,
  X,
  Play,
  Pause,
  Volume2,
  RotateCcw,
  Copy,
  Check,
  Download,
  Pin,
  Trash2,
  Edit3,
  BookOpen,
  Bookmark,
  Lightbulb,
  Award,
  Globe,
  FileText,
  CheckCircle,
  Compass,
  HelpCircle,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Languages,
  Sparkles,
  Video,
  LogOut,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Star,
  Search,
  Info
} from "lucide-react"

// Icon mapping helper for Lucide icons
const HeaderIcon = ({ name, className = "w-5 h-5 text-red-400 font-sans" }) => {
  switch (name) {
    case "BookOpen": return <BookOpen className={className} />
    case "Bookmark": return <Bookmark className={className} />
    case "Lightbulb": return <Lightbulb className={className} />
    case "Award": return <Award className={className} />
    case "Globe": return <Globe className={className} />
    case "FileText": return <FileText className={className} />
    case "CheckCircle": return <CheckCircle className={className} />
    case "Compass": return <Compass className={className} />
    default: return <HelpCircle className={className} />
  }
}

function Home() {
  // ==========================================
  // STATE INITIALIZATIONS
  // ==========================================
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [availableLangs, setAvailableLangs] = useState([])
  const [videoDuration, setVideoDuration] = useState(0)
  const [summary, setSummary] = useState("")
  const [copied, setCopied] = useState(false)

  // Speech states
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [activeSentenceIndex, setActiveSentenceIndex] = useState(-1)
  
  // Translation Speech States
  const [isSpeakingTranslation, setIsSpeakingTranslation] = useState(false)
  const [translatedActiveSentenceIndex, setTranslatedActiveSentenceIndex] = useState(-1)

  // Speech controls and configuration states
  const [voices, setVoices] = useState([])
  const [selectedVoiceName, setSelectedVoiceName] = useState("")
  const [speechRate, setSpeechRate] = useState(1.0)
  const [speechPitch, setSpeechPitch] = useState(1.0)
  const [speechIsTranslation, setSpeechIsTranslation] = useState(false)

  const [thumbnail, setThumbnail] = useState("")
  const [videoTitle, setVideoTitle] = useState("")
  const [videoId, setVideoId] = useState("")
  const [mode, setMode] = useState("general")

  // SIDEBAR
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // THEME SYSTEM
  const [theme, setTheme] = useState(localStorage.getItem("summarai-theme") || "dark")

  // AUTHENTICATION STATES
  const [userToken, setUserToken] = useState(localStorage.getItem("summarai-user-token") || "")
  const [userEmail, setUserEmail] = useState(localStorage.getItem("summarai-user-email") || "")
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState("login")
  const [authEmail, setAuthEmail] = useState("")
  const [authPassword, setAuthPassword] = useState("")
  const [authConfirmPassword, setAuthConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState("")

  // SEARCH AND KEYBOARD STATES
  const [searchQuery, setSearchQuery] = useState("")
  const [showShortcutsModal, setShowShortcutsModal] = useState(false)

  // HISTORY
  const [history, setHistory] = useState([])
  const [activeHistoryId, setActiveHistoryId] = useState(null)
  const [activeMenu, setActiveMenu] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editedTitle, setEditedTitle] = useState("")

  // QUIZ STATES
  const [quiz, setQuiz] = useState([])
  const [showQuiz, setShowQuiz] = useState(false)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState(null)
  const [isAnswered, setIsAnswered] = useState(false)
  const [score, setScore] = useState(0)
  const [quizFinished, setQuizFinished] = useState(false)

  // TRANSLATION STATES
  const [translatedSummary, setTranslatedSummary] = useState("")
  const [selectedLanguage, setSelectedLanguage] = useState("Telugu")
  const [translationLoading, setTranslationLoading] = useState(false)

  // ==========================================
  // REFS DEFINITIONS
  // ==========================================
  const activeUtteranceRef = useRef(null)
  const summaryRef = useRef(null)
  const searchInputRef = useRef(null)

  // ==========================================
  // PARSING & DERIVED STATES (TEMPORAL DEAD ZONE RESILIENT)
  // ==========================================
  const parseSummarySections = (text, currentMode) => {
    if (!text) return []

    const lines = text.split("\n")
    const sectionsList = []
    let currentSection = null
    let currentContent = []

    const getIconForHeader = (title) => {
      const t = title.toLowerCase()
      if (t.includes("explanation") || t.includes("summary")) return "BookOpen"
      if (t.includes("definition")) return "Bookmark"
      if (t.includes("concept")) return "Lightbulb"
      if (t.includes("exam") || t.includes("point")) return "Award"
      if (t.includes("application")) return "Globe"
      if (t.includes("revision") || t.includes("notes")) return "FileText"
      if (t.includes("conclusion")) return "CheckCircle"
      if (t.includes("topic")) return "Compass"
      return "HelpCircle"
    }

    const isHeader = (line) => {
      const cleaned = line.trim().replace(/[*#_\d\.\:]/g, "").trim().toLowerCase()
      const headers = [
        "topic explanation",
        "short summary",
        "summary",
        "important definitions",
        "definitions",
        "key concepts",
        "important points for exams",
        "points for exams",
        "exam points",
        "realworld applications",
        "real-world applications",
        "applications",
        "short revision notes",
        "revision notes",
        "final conclusion",
        "conclusion",
        "important key points",
        "key points",
        "main topic"
      ]

      const isMarkdownHeader = line.startsWith("#") || (line.startsWith("**") && line.endsWith("**"))
      const isNumberedHeader = /^\d+\.\s+/.test(line.trim())

      return (isMarkdownHeader || isNumberedHeader || headers.includes(cleaned)) &&
             headers.some(h => cleaned.includes(h) || h.includes(cleaned))
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (isHeader(line)) {
        if (currentSection) {
          sectionsList.push({
            ...currentSection,
            content: currentContent.join("\n").trim()
          })
        }

        const cleanTitle = line.replace(/[*#_\d\.\:]/g, "").trim()
        currentSection = {
          title: cleanTitle || "Overview",
          icon: getIconForHeader(cleanTitle),
          content: ""
        }
        currentContent = []
      } else {
        if (currentSection) {
          currentContent.push(line)
        } else if (line.trim()) {
          currentSection = {
            title: "Introduction",
            icon: "Compass",
            content: ""
          }
          currentContent.push(line)
        }
      }
    }

    if (currentSection) {
      sectionsList.push({
        ...currentSection,
        content: currentContent.join("\n").trim()
      })
    }

    if (sectionsList.length === 0) {
      sectionsList.push({
        title: currentMode === "study" ? "Study Notes" : "General Summary",
        icon: "BookOpen",
        content: text
      })
    }

    return sectionsList
  }

  const getGlobalSentences = (sections) => {
    const globalSentences = []
    sections.forEach((section, sectionIdx) => {
      const paragraphs = section.content.split("\n\n").filter(p => p.trim() !== "")

      paragraphs.forEach((para, paraIdx) => {
        const rawSentences = para
          .split(/(?<=[.!?])\s+/)
          .filter(s => s.trim() !== "")

        rawSentences.forEach((s) => {
          globalSentences.push({
            text: s,
            cleanText: s.replace(/[*#_\-•]/g, "").trim(),
            sectionIndex: sectionIdx,
            paraIndex: paraIdx,
            globalIndex: globalSentences.length
          })
        })
      })
    })
    return globalSentences
  }

  const parsedSections = parseSummarySections(summary, mode)
  const sentences = getGlobalSentences(parsedSections)

  // ==========================================
  // CORE HANDLERS
  // ==========================================
  const stopSpeech = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    setIsSpeaking(false)
    setIsSpeakingTranslation(false)
    setIsPaused(false)
    setActiveSentenceIndex(-1)
    setTranslatedActiveSentenceIndex(-1)
    setSpeechIsTranslation(false)
  }

  const loadHistory = async (currentUser = auth.currentUser) => {
    if (currentUser) {
      try {
        const historyRef = collection(db, "users", currentUser.uid, "history")
        const querySnapshot = await getDocs(historyRef)
        const historyList = []
        querySnapshot.forEach((docSnapshot) => {
          historyList.push({ id: docSnapshot.id, ...docSnapshot.data() })
        })
        historyList.sort((a, b) => {
          const pinA = a.pinned ? 1 : 0
          const pinB = b.pinned ? 1 : 0
          if (pinA !== pinB) {
            return pinB - pinA
          }
          return b.timestamp - a.timestamp
        })
        setHistory(historyList)
      } catch (err) {
        console.error("Failed to fetch Firestore history, falling back to local:", err)
        const local = JSON.parse(localStorage.getItem("summarai-history")) || []
        setHistory(local)
      }
    } else {
      const local = JSON.parse(localStorage.getItem("summarai-history")) || []
      setHistory(local)
    }
  }

  const speakFromIndex = (startIndex, isTranslation = false) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return

    window.speechSynthesis.cancel()
    
    let sentenceList = []
    if (isTranslation) {
      if (!translatedSummary) return
      const rawChunks = translatedSummary
        .split(/(?<=[.!?])\s+/)
        .filter(s => s.trim() !== "")
      sentenceList = rawChunks.map((text, idx) => ({
        cleanText: text.replace(/[*#_\-•]/g, "").trim(),
        globalIndex: idx
      }))
      setIsSpeakingTranslation(true)
      setIsSpeaking(false)
      setActiveSentenceIndex(-1)
      setSpeechIsTranslation(true)
    } else {
      sentenceList = sentences
      setIsSpeaking(true)
      setIsSpeakingTranslation(false)
      setTranslatedActiveSentenceIndex(-1)
      setSpeechIsTranslation(false)
    }

    setIsPaused(false)
    let index = startIndex

    const speakChunk = () => {
      if (index >= sentenceList.length) {
        if (isTranslation) {
          setTranslatedActiveSentenceIndex(-1)
          setIsSpeakingTranslation(false)
        } else {
          setActiveSentenceIndex(-1)
          setIsSpeaking(false)
        }
        return
      }

      if (isTranslation) {
        setTranslatedActiveSentenceIndex(index)
      } else {
        setActiveSentenceIndex(index)
      }

      const cleanText = sentenceList[index].cleanText || sentenceList[index].text
      if (!cleanText || !cleanText.trim()) {
        index++
        speakChunk()
        return
      }

      const speech = new SpeechSynthesisUtterance(cleanText)
      speech.rate = speechRate
      speech.pitch = speechPitch

      if (isTranslation) {
        const langAccentMapping = {
          "Hindi": "hi-IN",
          "Telugu": "te-IN",
          "Tamil": "ta-IN",
          "Kannada": "kn-IN",
          "Malayalam": "ml-IN"
        }
        const langCode = langAccentMapping[selectedLanguage] || "en-US"
        speech.lang = langCode
        const nativeVoice = voices.find(v => 
          v.lang.toLowerCase().includes(langCode.toLowerCase()) ||
          v.lang.toLowerCase().replace("-", "_").includes(langCode.toLowerCase().replace("-", "_"))
        )
        if (nativeVoice) {
          speech.voice = nativeVoice
        }
      } else {
        speech.lang = "en-US"
        const selectedVoice = voices.find(v => v.name === selectedVoiceName)
        if (selectedVoice) {
          speech.voice = selectedVoice
        }
      }

      activeUtteranceRef.current = speech

      speech.onend = () => {
        index++
        if (!isTranslation && summaryRef.current) {
          summaryRef.current.scrollTop += 30
        }
        speakChunk()
      }

      speech.onerror = (e) => {
        if (e.error !== "interrupted") {
          if (isTranslation) {
            setIsSpeakingTranslation(false)
            setTranslatedActiveSentenceIndex(-1)
          } else {
            setIsSpeaking(false)
            setActiveSentenceIndex(-1)
          }
        }
      }

      window.speechSynthesis.speak(speech)
    }

    speakChunk()
  }

  const handleSpeak = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) return

    if (isPaused) {
      window.speechSynthesis.resume()
      setIsPaused(false)
      setIsSpeaking(true)
      return
    }

    if (window.speechSynthesis.speaking && !isPaused && isSpeaking) {
      window.speechSynthesis.pause()
      setIsPaused(true)
      setIsSpeaking(false)
      return
    }

    const startIdx = activeSentenceIndex >= 0 ? activeSentenceIndex : 0
    speakFromIndex(startIdx, false)
  }

  const handleRestart = () => {
    stopSpeech()
    setTimeout(() => {
      speakFromIndex(0, false)
    }, 150)
  }

  const handleTranslateSpeak = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) return

    if (isPaused) {
      window.speechSynthesis.resume()
      setIsPaused(false)
      setIsSpeakingTranslation(true)
      return
    }

    if (window.speechSynthesis.speaking && !isPaused && isSpeakingTranslation) {
      window.speechSynthesis.pause()
      setIsPaused(true)
      setIsSpeakingTranslation(false)
      return
    }

    const startIdx = translatedActiveSentenceIndex >= 0 ? translatedActiveSentenceIndex : 0
    speakFromIndex(startIdx, true)
  }

  const handleProgressBarClick = (e) => {
    if (sentences.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = clickX / rect.width
    const targetIndex = Math.min(
      Math.max(0, Math.floor(percentage * sentences.length)),
      sentences.length - 1
    )
    speakFromIndex(targetIndex, false)
  }

  const handleTranslationProgressBarClick = (e) => {
    if (!translatedSummary) return
    const rawChunks = translatedSummary.split(/(?<=[.!?])\s+/).filter(s => s.trim() !== "")
    if (rawChunks.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = clickX / rect.width
    const targetIndex = Math.min(
      Math.max(0, Math.floor(percentage * rawChunks.length)),
      rawChunks.length - 1
    )
    speakFromIndex(targetIndex, true)
  }

  const handleGenerate = async () => {
    stopSpeech()
    setError("")
    setAvailableLangs([])
    setVideoDuration(0)
    setSummary("")
    setThumbnail("")
    setVideoTitle("")
    setVideoId("")
    setQuiz([])
    setShowQuiz(false)
    setTranslatedSummary("")

    if (!youtubeUrl.trim()) {
      setError("Please enter one or more YouTube URLs")
      return
    }

    // Split inputs by comma to support single and multi-video
    const urls = youtubeUrl
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.length > 0)

    if (urls.length === 0) {
      setError("Please enter a valid YouTube URL")
      return
    }

    const youtubePattern = /^(https?\:\/\/)?(www\.youtube\.com|youtu\.be)\/.+$/
    for (const url of urls) {
      if (!youtubePattern.test(url)) {
        setError(`Invalid YouTube URL detected: "${url}". URLs must start with youtube.com or youtu.be`)
        return
      }
    }

    setLoading(true)

    try {
      let response
      if (urls.length === 1) {
        response = await axios.post("http://127.0.0.1:5000/summarize", {
          url: urls[0],
          mode: mode
        })
      } else {
        response = await axios.post("http://127.0.0.1:5000/summarize_multi", {
          urls: urls,
          mode: mode
        })
      }

      setSummary(response.data.summary)
      setThumbnail(response.data.thumbnail)
      setVideoTitle(response.data.title)
      setVideoId(response.data.video_id)
      setQuiz(response.data.quiz || [])
      setVideoDuration(response.data.duration || 0)

      const historyItem = {
        title: response.data.title,
        url: youtubeUrl,
        summary: response.data.summary,
        thumbnail: response.data.thumbnail,
        videoId: response.data.video_id,
        mode: mode,
        quiz: response.data.quiz || [],
        createdAt: new Date().toLocaleString(),
        timestamp: Date.now(),
        pinned: false,
        starred: false,
        duration: response.data.duration || 0
      }

      if (auth.currentUser) {
        try {
          const historyRef = collection(db, "users", auth.currentUser.uid, "history")
          const docRef = doc(historyRef)
          await setDoc(docRef, historyItem)
          const syncedItem = { ...historyItem, id: docRef.id }
          setHistory(prev => [syncedItem, ...prev])
          setActiveHistoryId(docRef.id)
        } catch (dbErr) {
          console.error("Failed to save history in Cloud Firestore:", dbErr)
        }
      } else {
        const newId = Date.now()
        const guestItem = { ...historyItem, id: newId }
        const existingHistory = JSON.parse(localStorage.getItem("summarai-history")) || []
        const updatedHistory = [guestItem, ...existingHistory]
        localStorage.setItem("summarai-history", JSON.stringify(updatedHistory))
        setHistory(updatedHistory)
        setActiveHistoryId(newId)
      }

    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || "Failed to generate summary. Please check your backend connection."
      setError(errMsg)
      if (err.response?.data?.available_languages) {
        setAvailableLangs(err.response.data.available_languages)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(summary)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  const handleDownloadMarkdown = () => {
    if (!summary) return

    let content = `# ${videoTitle}\n\n`
    content += `**Source Video URL:** ${youtubeUrl}\n`
    content += `**Generated on:** ${new Date().toLocaleString()} • **Mode:** ${mode.toUpperCase()}\n\n`
    content += `## Summary\n\n`
    content += `${summary}\n`

    if (mode === "study" && quiz && quiz.length > 0) {
      content += `\n## Practice Quiz (MCQs)\n\n`
      quiz.forEach((q, idx) => {
        content += `### Q${idx + 1}: ${q.question}\n`
        q.options.forEach((opt) => {
          const isCorrect = opt === q.answer
          content += `- [${isCorrect ? "x" : " "}] ${opt}\n`
        })
        content += `\n**Correct Answer:** ${q.answer}\n\n`
      })
    }

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    const safeTitle = videoTitle.replace(/[^a-zA-Z0-9]/g, "_") || "summary"
    link.setAttribute("download", `SummarAI_${safeTitle}.md`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleDownloadPDF = () => {
    if (!summary) return

    const doc = new jsPDF()
    const pageHeight = doc.internal.pageSize.height
    const pageWidth = doc.internal.pageSize.width
    const margin = 20
    const contentWidth = pageWidth - (margin * 2)
    let yPosition = 60

    doc.setFillColor(24, 24, 27)
    doc.rect(0, 0, pageWidth, 45, "F")

    doc.setFillColor(239, 68, 68)
    doc.rect(0, 45, pageWidth, 2, "F")

    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(22)
    doc.text("SummarAI", margin, 20)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.setTextColor(228, 228, 231)
    doc.text("AI-Powered YouTube Video Notes & Structured Summary", margin, 28)

    doc.setFontSize(8.5)
    doc.setTextColor(161, 161, 170)
    doc.text(`Generated on ${new Date().toLocaleString()} • Mode: ${mode.toUpperCase()}`, margin, 36)

    doc.setTextColor(39, 39, 42)

    parsedSections.forEach((section) => {
      if (yPosition + 25 > pageHeight - margin) {
        doc.addPage()
        yPosition = margin + 10
      }

      doc.setFont("helvetica", "bold")
      doc.setFontSize(13)
      doc.setTextColor(220, 38, 38)
      doc.text(section.title.toUpperCase(), margin, yPosition)
      yPosition += 8

      doc.setDrawColor(228, 228, 231)
      doc.setLineWidth(0.4)
      doc.line(margin, yPosition - 4, pageWidth - margin, yPosition - 4)

      doc.setFont("helvetica", "normal")
      doc.setFontSize(10.5)
      doc.setTextColor(63, 63, 70)

      const paragraphs = section.content.split("\n\n")
      paragraphs.forEach((para) => {
        const processedText = para.replace(/^[-•]\s*/, "• ")
        const splitText = doc.splitTextToSize(processedText, contentWidth)

        splitText.forEach((line) => {
          if (yPosition + 6.5 > pageHeight - margin) {
            doc.addPage()
            yPosition = margin + 10
          }
          doc.text(line, margin, yPosition)
          yPosition += 6.2
        })
        yPosition += 3.5
      })
      yPosition += 5
    })

    if (mode === "study" && quiz && quiz.length > 0) {
      if (yPosition + 35 > pageHeight - margin) {
        doc.addPage()
        yPosition = margin + 10
      }

      doc.setFont("helvetica", "bold")
      doc.setFontSize(13)
      doc.setTextColor(220, 38, 38)
      doc.text("PRACTICE QUIZ (MCQS)", margin, yPosition)
      yPosition += 8

      doc.setDrawColor(228, 228, 231)
      doc.setLineWidth(0.4)
      doc.line(margin, yPosition - 4, pageWidth - margin, yPosition - 4)

      quiz.forEach((q, idx) => {
        if (yPosition + 25 > pageHeight - margin) {
          doc.addPage()
          yPosition = margin + 10
        }

        doc.setFont("helvetica", "bold")
        doc.setFontSize(10.5)
        doc.setTextColor(39, 39, 42)

        const qLines = doc.splitTextToSize(`Q${idx + 1}: ${q.question}`, contentWidth)
        qLines.forEach((line) => {
          if (yPosition + 6 > pageHeight - margin) {
            doc.addPage()
            yPosition = margin + 10
          }
          doc.text(line, margin, yPosition)
          yPosition += 5.8
        })

        q.options.forEach((opt) => {
          const isCorrect = opt === q.answer
          const prefix = isCorrect ? "  [Correct Answer] - " : "  [ ] "
          
          if (isCorrect) {
            doc.setFont("helvetica", "bold")
            doc.setTextColor(22, 101, 52)
          } else {
            doc.setFont("helvetica", "normal")
            doc.setTextColor(82, 82, 91)
          }

          const optLines = doc.splitTextToSize(prefix + opt, contentWidth - 10)
          optLines.forEach((line) => {
            if (yPosition + 5.5 > pageHeight - margin) {
              doc.addPage()
              yPosition = margin + 10
            }
            doc.text(line, margin + 4, yPosition)
            yPosition += 5.5
          })
        })
        yPosition += 4.5
      })
    }

    const totalPages = doc.internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      doc.setFont("helvetica", "italic")
      doc.setFontSize(8)
      doc.setTextColor(161, 161, 170)
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 15, pageHeight - 10)
      doc.text("SummarAI Study Helper - converting long video to clear study notes.", margin, pageHeight - 10)
    }

    const safeTitle = videoTitle.replace(/[^a-zA-Z0-9]/g, "_") || "summary"
    doc.save(`SummarAI_${safeTitle}.pdf`)
  }

  const handleTranslate = async () => {
    if (!summary) return

    setTranslationLoading(true)
    try {
      const response = await axios.post("http://127.0.0.1:5000/translate", {
        text: summary,
        language: selectedLanguage
      })
      setTranslatedSummary(response.data.translated_text)
    } catch (err) {
      setError("Translation failed. Please verify openrouter connection.")
    } finally {
      setTranslationLoading(false)
    }
  }

  const handleClear = () => {
    stopSpeech()
    setYoutubeUrl("")
    setSummary("")
    setError("")
    setAvailableLangs([])
    setVideoDuration(0)
    setThumbnail("")
    setVideoTitle("")
    setVideoId("")
    setQuiz([])
    setShowQuiz(false)
    setTranslatedSummary("")
    setActiveHistoryId(null)
  }

  const handleHistoryClick = (item) => {
    stopSpeech()
    setActiveHistoryId(item.id)
    setSummary(item.summary)
    setVideoTitle(item.title)
    setThumbnail(item.thumbnail)
    setVideoId(item.videoId)
    setYoutubeUrl(item.url)
    setMode(item.mode)
    setQuiz(item.quiz || [])
    setVideoDuration(item.duration || 0)
    setTranslatedSummary("")
    setShowQuiz(false)
  }

  const migrateGuestHistoryToCloud = async (currentUser) => {
    const guestHistory = JSON.parse(localStorage.getItem("summarai-history")) || []
    if (guestHistory.length === 0) return

    const historyRef = collection(db, "users", currentUser.uid, "history")
    for (let i = 0; i < guestHistory.length; i++) {
      const item = guestHistory[i]
      try {
        const docRef = doc(historyRef)
        await setDoc(docRef, {
          title: item.title,
          url: item.url,
          summary: item.summary,
          thumbnail: item.thumbnail,
          videoId: item.videoId,
          mode: item.mode,
          quiz: item.quiz || [],
          pinned: item.pinned || false,
          starred: item.starred || false,
          createdAt: item.createdAt,
          timestamp: item.timestamp,
          duration: item.duration || 0
        })
      } catch (err) {
        console.error("Failed to migrate guest item to Firestore:", item.title, err)
      }
    }
    localStorage.removeItem("summarai-history")
  }

  const handleAuthSubmit = async (e) => {
    e.preventDefault()
    setAuthError("")
    
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("All fields are required")
      return
    }

    if (authMode === "signup" && authPassword !== authConfirmPassword) {
      setAuthError("Passwords do not match")
      return
    }

    setAuthLoading(true)

    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail, authPassword)
      } else {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword)
      }

      setAuthEmail("")
      setAuthPassword("")
      setAuthConfirmPassword("")
      setShowAuthModal(false)
    } catch (err) {
      let friendlyError = "Authentication failed"
      if (err.code === "auth/email-already-in-use") {
        friendlyError = "An account with this email already exists"
      } else if (err.code === "auth/wrong-password" || err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
        friendlyError = "Invalid email or password"
      } else if (err.code === "auth/weak-password") {
        friendlyError = "Password must be at least 6 characters"
      } else {
        friendlyError = err.message
      }
      setAuthError(friendlyError)
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    stopSpeech()
    try {
      await signOut(auth)
      handleClear()
    } catch (err) {
      console.error("Logout failed:", err)
    }
  }

  const handlePinToggle = async (item, e) => {
    e.stopPropagation()
    const newPinnedState = !item.pinned

    setHistory(prev =>
      prev.map(x => (x.id === item.id ? { ...x, pinned: newPinnedState } : x))
    )

    if (auth.currentUser) {
      try {
        const itemRef = doc(db, "users", auth.currentUser.uid, "history", item.id)
        await updateDoc(itemRef, { pinned: newPinnedState })
      } catch (err) {
        console.error("Cloud Firestore pin update failed:", err)
      }
    } else {
      const local = JSON.parse(localStorage.getItem("summarai-history")) || []
      const updated = local.map(x => x.id === item.id ? { ...x, pinned: newPinnedState } : x)
      localStorage.setItem("summarai-history", JSON.stringify(updated))
    }
  }

  const handleStarToggle = async (item, e) => {
    e.stopPropagation()
    const newStarredState = !item.starred

    setHistory(prev =>
      prev.map(x => (x.id === item.id ? { ...x, starred: newStarredState } : x))
    )

    if (auth.currentUser) {
      try {
        const itemRef = doc(db, "users", auth.currentUser.uid, "history", item.id)
        await updateDoc(itemRef, { starred: newStarredState })
      } catch (err) {
        console.error("Cloud Firestore star update failed:", err)
      }
    } else {
      const local = JSON.parse(localStorage.getItem("summarai-history")) || []
      const updated = local.map(x => x.id === item.id ? { ...x, starred: newStarredState } : x)
      localStorage.setItem("summarai-history", JSON.stringify(updated))
    }
  }

  const handleRenameSubmit = async (item) => {
    if (!editedTitle.trim()) {
      setEditingId(null)
      return
    }

    setHistory(prev =>
      prev.map(x => (x.id === item.id ? { ...x, title: editedTitle } : x))
    )
    setEditingId(null)

    if (auth.currentUser) {
      try {
        const itemRef = doc(db, "users", auth.currentUser.uid, "history", item.id)
        await updateDoc(itemRef, { title: editedTitle })
      } catch (err) {
        console.error("Cloud Firestore rename failed:", err)
      }
    } else {
      const local = JSON.parse(localStorage.getItem("summarai-history")) || []
      const updated = local.map(x => x.id === item.id ? { ...x, title: editedTitle } : x)
      localStorage.setItem("summarai-history", JSON.stringify(updated))
    }
  }

  const handleDeleteItem = async (item, e) => {
    e.stopPropagation()
    
    setHistory(prev => prev.filter(x => x.id !== item.id))
    if (activeHistoryId === item.id) {
      handleClear()
    }

    if (auth.currentUser) {
      try {
        const itemRef = doc(db, "users", auth.currentUser.uid, "history", item.id)
        await deleteDoc(itemRef)
      } catch (err) {
        console.error("Cloud Firestore delete failed:", err)
      }
    } else {
      const local = JSON.parse(localStorage.getItem("summarai-history")) || []
      const updated = local.filter(x => x.id !== item.id)
      localStorage.setItem("summarai-history", JSON.stringify(updated))
    }
  }

  const handleOptionSelect = (option) => {
    if (isAnswered) return
    setSelectedOption(option)
    setIsAnswered(true)
    const currentQuestion = quiz[currentQuestionIndex]
    if (option === currentQuestion.answer) {
      setScore(prevScore => prevScore + 1)
    }
  }

  const handleNextQuestion = () => {
    setSelectedOption(null)
    setIsAnswered(false)
    if (currentQuestionIndex + 1 < quiz.length) {
      setCurrentQuestionIndex(prevIndex => prevIndex + 1)
    } else {
      setQuizFinished(true)
    }
  }

  const handleRetakeQuiz = () => {
    setCurrentQuestionIndex(0)
    setSelectedOption(null)
    setIsAnswered(false)
    setScore(0)
    setQuizFinished(false)
  }

  const handleCloseQuiz = () => {
    setShowQuiz(false)
    setQuizFinished(false)
    setCurrentQuestionIndex(0)
    setSelectedOption(null)
    setIsAnswered(false)
    setScore(0)
  }

  const renderSentence = (sentenceObj) => {
    const isBullet = sentenceObj.text.trim().startsWith("-") || sentenceObj.text.trim().startsWith("•")
    const cleanDisplay = sentenceObj.text.replace(/^[-•]\s*/, "").trim()
    const highlightClass = activeSentenceIndex === sentenceObj.globalIndex
      ? "text-glow-active"
      : "text-glow-inactive hover:text-white"

    if (isBullet) {
      return (
        <div key={sentenceObj.globalIndex} className="flex items-start gap-3 my-3.5 pl-2 transition-all duration-300">
          <span className="w-2.5 h-2.5 rounded-full mt-2 shrink-0 custom-list-bullet" />
          <span className={`text-base leading-7 transition-all duration-300 ${highlightClass}`}>
            {cleanDisplay}
          </span>
        </div>
      )
    }

    return (
      <span
        key={sentenceObj.globalIndex}
        className={`text-base leading-8 inline mr-1 transition-all duration-300 rounded cursor-pointer ${highlightClass}`}
        onClick={() => {
          speakFromIndex(sentenceObj.globalIndex, false)
        }}
      >
        {sentenceObj.text}{" "}
      </span>
    )
  }

  // ==========================================
  // LIFECYCLES EFFECT DECLARATIONS (RESOLVES TDZ CRASH)
  // ==========================================
  // Fetch system voices for TTS
  useEffect(() => {
    const updateVoices = () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        const availableVoices = window.speechSynthesis.getVoices()
        setVoices(availableVoices)
        
        if (availableVoices.length > 0) {
          const defaultVoice = availableVoices.find(v => (v.lang.startsWith("en") || v.lang.startsWith("EN")) && v.localService) ||
                               availableVoices.find(v => v.lang.startsWith("en") || v.lang.startsWith("EN")) ||
                               availableVoices[0]
          if (defaultVoice) {
            setSelectedVoiceName(prev => prev || defaultVoice.name)
          }
        }
      }
    }

    updateVoices()
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = updateVoices
    }
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null
      }
    }
  }, [])

  // Refs to allow settings effect to access hot states without causing dependency cycles
  const activeSentenceIndexRef = useRef(activeSentenceIndex)
  const isSpeakingRef = useRef(isSpeaking)
  const translatedActiveSentenceIndexRef = useRef(translatedActiveSentenceIndex)
  const isSpeakingTranslationRef = useRef(isSpeakingTranslation)

  useEffect(() => {
    activeSentenceIndexRef.current = activeSentenceIndex
    isSpeakingRef.current = isSpeaking
    translatedActiveSentenceIndexRef.current = translatedActiveSentenceIndex
    isSpeakingTranslationRef.current = isSpeakingTranslation
  }, [activeSentenceIndex, isSpeaking, translatedActiveSentenceIndex, isSpeakingTranslation])

  // Apply speed / voice / pitch adjustments on-the-fly when speaking
  useEffect(() => {
    if (isSpeakingRef.current && activeSentenceIndexRef.current >= 0) {
      speakFromIndex(activeSentenceIndexRef.current, false)
    }
  }, [speechRate, selectedVoiceName, speechPitch])

  useEffect(() => {
    if (isSpeakingTranslationRef.current && translatedActiveSentenceIndexRef.current >= 0) {
      speakFromIndex(translatedActiveSentenceIndexRef.current, true)
    }
  }, [speechRate, speechPitch])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserToken(user.uid)
        setUserEmail(user.email)
        localStorage.setItem("summarai-user-token", user.uid)
        localStorage.setItem("summarai-user-email", user.email)
        await migrateGuestHistoryToCloud(user)
        await loadHistory(user)
      } else {
        setUserToken("")
        setUserEmail("")
        localStorage.removeItem("summarai-user-token")
        localStorage.removeItem("summarai-user-email")
        const guestLocal = JSON.parse(localStorage.getItem("summarai-history")) || []
        setHistory(guestLocal)
      }
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    localStorage.setItem("summarai-theme", theme)
  }, [theme])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") {
        if (e.code === "Escape") {
          document.activeElement.blur()
        }
        return
      }

      if (e.code === "Space") {
        e.preventDefault()
        handleSpeak()
      }

      if (e.code === "Escape") {
        stopSpeech()
        setShowAuthModal(false)
        setShowShortcutsModal(false)
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault()
        if (sidebarOpen && searchInputRef.current) {
          searchInputRef.current.focus()
        } else {
          setSidebarOpen(true)
          setTimeout(() => {
            if (searchInputRef.current) searchInputRef.current.focus()
          }, 150)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [sentences, isSpeaking, isPaused, sidebarOpen])

  // ==========================================
  // DYNAMIC HISTORY QUERY FILTERING
  // ==========================================
  const filteredHistory = history.filter((item) =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const wordCount = summary ? summary.split(/\s+/).filter(Boolean).length : 0
  const readTime = Math.ceil(wordCount / 200)
  const timeSaved = videoDuration > 0 ? Math.max(0, Math.round(videoDuration / 60) - readTime) : 0

  return (
    <div className={`theme-${theme} flex bg-[var(--color-bg-canvas)] text-[var(--color-text-body)] h-screen overflow-hidden font-sans page-transition relative`} onClick={() => setActiveMenu(null)}>
      
      {/* Premium Ambient Radial Mesh Grid */}
      <div className="cyber-grid" />

      {/* Premium Background Image Overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center pointer-events-none z-0 mix-blend-overlay transition-opacity duration-500 app-bg-overlay" 
        style={{ backgroundImage: 'url("/youtube_ai_bg.png")' }}
      />

      {/* Mobile Drawer Overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/75 backdrop-blur-md z-45 lg:hidden transition-all duration-300"
        />
      )}

      {/* ==========================================
          PREMIUM VIEWPORT SIDEBAR (FIXED VIEWPORT HEIGHT)
          ========================================== */}
      <aside
        onClick={(e) => e.stopPropagation()}
        className={`fixed lg:relative z-50 border-r border-[var(--color-border-main)] bg-[var(--color-bg-sidebar)] transition-all duration-300 h-screen shrink-0 flex flex-col ${
          sidebarOpen ? "translate-x-0 w-80" : "-translate-x-full lg:translate-x-0 lg:w-20"
        }`}
      >
        {/* Sidebar Brand Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--color-border-main)] bg-[var(--color-bg-sidebar)] shrink-0">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-red-600 to-rose-500 flex items-center justify-center shadow-lg shadow-red-500/20">
                <Sparkles className="w-5 h-5 text-white animate-pulse" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-[var(--color-text-title)] to-[var(--color-text-muted)] bg-clip-text text-transparent tracking-wide font-sans">
                SummarAI
              </span>
            </div>
          )}

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-title)] p-2 hover:bg-[var(--color-input-bg)] rounded-xl transition cursor-pointer"
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Sidebar Scrollable Body */}
        {sidebarOpen ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin">
            
            {/* Elegant Auth Profile card */}
            {userToken ? (
              <div className="bg-[var(--color-card-fill)] border border-[var(--color-border-main)] p-4 rounded-2xl flex items-center justify-between shadow-md">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-red-600 to-rose-500 flex items-center justify-center text-white text-xs font-black shrink-0 shadow-lg shadow-red-500/25">
                    {userEmail.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-red-500 font-extrabold uppercase tracking-widest leading-none">Cloud Synced</p>
                    <p className="text-xs text-[var(--color-text-title)] font-semibold truncate leading-tight mt-1">{userEmail}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-[var(--color-text-muted)] hover:text-red-500 p-2 hover:bg-[var(--color-input-bg)] rounded-xl transition cursor-pointer shrink-0"
                  title="Log Out Session"
                >
                  <LogOut size={13} />
                </button>
              </div>
            ) : (
              <div className="bg-[var(--color-card-fill)] border border-[var(--color-border-main)] p-4 rounded-2xl text-center space-y-3 shadow-sm">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-[var(--color-text-title)] flex items-center justify-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-red-500" />
                    <span>Sync Notes to Cloud</span>
                  </h4>
                  <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">Access summaries and quizzes on any browser or device.</p>
                </div>
                <button
                  onClick={() => {
                    setAuthMode("login")
                    setAuthError("")
                    setShowAuthModal(true)
                  }}
                  className="w-full bg-red-600 hover:bg-red-500 text-white font-bold text-xs py-2.5 rounded-xl transition-all duration-300 cursor-pointer shadow-lg shadow-red-600/10"
                >
                  Sign Up / Log In
                </button>
              </div>
            )}

            {/* Quick Stats Panel */}
            <div className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] p-3 rounded-2xl flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
              <div>Notes: <span className="text-[var(--color-text-title)] font-bold">{history.length}</span></div>
              <div>Pinned: <span className="text-red-500 font-bold">{history.filter(item => item.pinned).length}</span></div>
              <div className="capitalize">Sync: <span className={userToken ? "text-emerald-500 font-bold" : "text-[var(--color-text-muted)] font-semibold"}>{userToken ? "Active" : "Guest"}</span></div>
            </div>

            {/* History Search Box */}
            <div className="bg-[var(--color-input-bg)] border border-[var(--color-input-border)] p-2 rounded-xl flex items-center gap-2 focus-within:border-red-500/50 transition-all duration-350 shrink-0">
              <Search className="w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search history... (Ctrl+F)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-xs text-[var(--color-text-title)] outline-none placeholder:text-[var(--color-text-muted)]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="text-xs text-[var(--color-text-muted)] hover:text-white px-1">
                  ✕
                </button>
              )}
            </div>

            <div className="space-y-4">
              
              {/* STARRED/FAVORITE SECTION */}
              {filteredHistory.some((item) => item.starred) && (
                <div className="space-y-2">
                  <h2 className="text-[var(--color-text-muted)] text-[10px] font-extrabold uppercase tracking-widest pl-1 flex items-center gap-1.5">
                    <Star size={12} className="text-amber-400 fill-amber-400" /> Starred Favorites
                  </h2>
                  
                  <div className="space-y-2">
                    {filteredHistory
                      .filter((item) => item.starred)
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map((item) => (
                        <div
                          key={item.id}
                          onClick={() => handleHistoryClick(item)}
                          className={`group relative transition-all duration-300 cursor-pointer p-3 rounded-xl border ${
                            activeHistoryId === item.id
                              ? "bg-[var(--color-input-bg)] border-red-500/50 shadow-md shadow-red-500/5"
                              : "bg-[var(--color-card-fill)] border-[var(--color-border-card)] hover:border-[var(--color-border-main)] hover:bg-[var(--color-input-bg)]"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            {editingId === item.id ? (
                              <input
                                type="text"
                                value={editedTitle}
                                onChange={(e) => setEditedTitle(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => handleRenameSubmit(item)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleRenameSubmit(item)
                                  if (e.key === "Escape") setEditingId(null)
                                }}
                                className="bg-[var(--color-input-bg)] border border-red-500/30 rounded-lg px-2 py-1 text-xs w-full text-[var(--color-text-title)] focus:outline-none"
                                autoFocus
                              />
                            ) : (
                              <h3 className="text-xs font-bold line-clamp-2 text-[var(--color-text-body)] group-hover:text-[var(--color-text-title)] leading-normal">
                                {item.title}
                              </h3>
                            )}

                            <div className="relative shrink-0 flex items-center gap-1">
                              <button
                                onClick={(e) => handleStarToggle(item, e)}
                                className="text-amber-400 p-0.5 hover:scale-110 transition shrink-0"
                              >
                                <Star size={12} className="fill-amber-400 text-amber-400" />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setActiveMenu(activeMenu === item.id ? null : item.id)
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--color-input-bg)] rounded text-[var(--color-text-muted)] hover:text-white transition shrink-0"
                              >
                                •••
                              </button>

                              {activeMenu === item.id && (
                                <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-4.5 w-36 bg-[var(--color-bg-sidebar)] border border-[var(--color-border-main)] rounded-xl shadow-2xl z-50 overflow-hidden py-1">
                                  <button
                                    onClick={() => {
                                      setEditingId(item.id)
                                      setEditedTitle(item.title)
                                      setActiveMenu(null)
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-input-bg)] text-xs transition text-[var(--color-text-body)] flex items-center gap-2"
                                  >
                                    <Edit3 size={12} /> Rename
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      handlePinToggle(item, e)
                                      setActiveMenu(null)
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-input-bg)] text-xs transition text-[var(--color-text-body)] flex items-center gap-2"
                                  >
                                    📌 {item.pinned ? "Unpin" : "Pin"}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      handleDeleteItem(item, e)
                                      setActiveMenu(null)
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-input-bg)] text-xs transition text-red-500 hover:bg-red-500/10 flex items-center gap-2"
                                  >
                                    <Trash2 size={12} /> Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex justify-between items-center mt-2.5 text-[9px] text-[var(--color-text-muted)]">
                            <span className="text-red-500 font-extrabold tracking-wider uppercase bg-red-500/5 px-2 py-0.5 rounded-full border border-red-500/10">{item.mode}</span>
                            <span>{(item.createdAt || "").split(",")[0]}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* PINNED SECTION */}
              {filteredHistory.some((item) => item.pinned && !item.starred) && (
                <div className="space-y-2">
                  <h2 className="text-[var(--color-text-muted)] text-[10px] font-extrabold uppercase tracking-widest pl-1 flex items-center gap-1.5">
                    <span>📌</span> Pinned Notes
                  </h2>
                  
                  <div className="space-y-2">
                    {filteredHistory
                      .filter((item) => item.pinned && !item.starred)
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map((item) => (
                        <div
                          key={item.id}
                          onClick={() => handleHistoryClick(item)}
                          className={`group relative transition-all duration-300 cursor-pointer p-3 rounded-xl border ${
                            activeHistoryId === item.id
                              ? "bg-[var(--color-input-bg)] border-red-500/50 shadow-md shadow-red-500/5"
                              : "bg-[var(--color-card-fill)] border-[var(--color-border-card)] hover:border-[var(--color-border-main)] hover:bg-[var(--color-input-bg)]"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            {editingId === item.id ? (
                              <input
                                type="text"
                                value={editedTitle}
                                onChange={(e) => setEditedTitle(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => handleRenameSubmit(item)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleRenameSubmit(item)
                                  if (e.key === "Escape") setEditingId(null)
                                }}
                                className="bg-[var(--color-input-bg)] border border-red-500/30 rounded-lg px-2 py-1 text-xs w-full text-[var(--color-text-title)] focus:outline-none"
                                autoFocus
                              />
                            ) : (
                              <h3 className="text-xs font-bold line-clamp-2 text-[var(--color-text-body)] group-hover:text-[var(--color-text-title)] leading-normal">
                                {item.title}
                              </h3>
                            )}

                            <div className="relative shrink-0 flex items-center gap-1">
                              <button
                                onClick={(e) => handleStarToggle(item, e)}
                                className="text-[var(--color-text-muted)] hover:text-amber-400 p-0.5 hover:scale-110 transition shrink-0"
                              >
                                <Star size={12} />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setActiveMenu(activeMenu === item.id ? null : item.id)
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--color-input-bg)] rounded text-[var(--color-text-muted)] hover:text-white transition shrink-0"
                              >
                                •••
                              </button>

                              {activeMenu === item.id && (
                                <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-4.5 w-36 bg-[var(--color-bg-sidebar)] border border-[var(--color-border-main)] rounded-xl shadow-2xl z-50 overflow-hidden py-1">
                                  <button
                                    onClick={() => {
                                      setEditingId(item.id)
                                      setEditedTitle(item.title)
                                      setActiveMenu(null)
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-input-bg)] text-xs transition text-[var(--color-text-body)] flex items-center gap-2"
                                  >
                                    <Edit3 size={12} /> Rename
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      handlePinToggle(item, e)
                                      setActiveMenu(null)
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-input-bg)] text-xs transition text-[var(--color-text-body)] flex items-center gap-2"
                                  >
                                    📌 Unpin
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      handleDeleteItem(item, e)
                                      setActiveMenu(null)
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-input-bg)] text-xs transition text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                                  >
                                    <Trash2 size={12} /> Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex justify-between items-center mt-2.5 text-[9px] text-[var(--color-text-muted)]">
                            <span className="text-red-500 font-extrabold tracking-wider uppercase bg-red-500/5 px-2 py-0.5 rounded-full border border-red-500/10">{item.mode}</span>
                            <span>{(item.createdAt || "").split(",")[0]}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* RECENT SEARCHES */}
              <div className="space-y-2">
                <h2 className="text-[var(--color-text-muted)] text-[10px] font-extrabold uppercase tracking-widest pl-1 flex items-center gap-1.5">
                  <span>🕘</span> Recent Notes
                </h2>
                
                {filteredHistory.filter(item => !item.pinned && !item.starred).length === 0 ? (
                  <div className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] p-5 rounded-2xl text-center text-[var(--color-text-muted)] text-xs">
                    No matching recent notes
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredHistory
                      .filter((item) => !item.pinned && !item.starred)
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map((item) => (
                        <div
                          key={item.id}
                          onClick={() => handleHistoryClick(item)}
                          className={`group relative transition-all duration-300 cursor-pointer p-3 rounded-xl border ${
                            activeHistoryId === item.id
                              ? "bg-[var(--color-input-bg)] border-red-500/50 shadow-md shadow-red-500/5"
                              : "bg-[var(--color-card-fill)] border-[var(--color-border-card)] hover:border-[var(--color-border-main)] hover:bg-[var(--color-input-bg)]"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            {editingId === item.id ? (
                              <input
                                type="text"
                                value={editedTitle}
                                onChange={(e) => setEditedTitle(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => handleRenameSubmit(item)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleRenameSubmit(item)
                                  if (e.key === "Escape") setEditingId(null)
                                }}
                                className="bg-[var(--color-input-bg)] border border-red-500/30 rounded-lg px-2 py-1 text-xs w-full text-[var(--color-text-title)] focus:outline-none"
                                autoFocus
                              />
                            ) : (
                              <h3 className="text-xs font-bold line-clamp-2 text-[var(--color-text-body)] group-hover:text-[var(--color-text-title)] leading-normal">
                                {item.title}
                              </h3>
                            )}

                            <div className="relative shrink-0 flex items-center gap-1">
                              <button
                                onClick={(e) => handleStarToggle(item, e)}
                                className="text-[var(--color-text-muted)] hover:text-amber-400 p-0.5 hover:scale-110 transition shrink-0"
                              >
                                <Star size={12} />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setActiveMenu(activeMenu === item.id ? null : item.id)
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--color-input-bg)] rounded text-[var(--color-text-muted)] hover:text-white transition shrink-0"
                              >
                                •••
                              </button>

                              {activeMenu === item.id && (
                                <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-4.5 w-36 bg-[var(--color-bg-sidebar)] border border-[var(--color-border-main)] rounded-xl shadow-2xl z-50 overflow-hidden py-1">
                                  <button
                                    onClick={() => {
                                      setEditingId(item.id)
                                      setEditedTitle(item.title)
                                      setActiveMenu(null)
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-input-bg)] text-xs transition text-[var(--color-text-body)] flex items-center gap-2"
                                  >
                                    <Edit3 size={12} /> Rename
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      handlePinToggle(item, e)
                                      setActiveMenu(null)
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-input-bg)] text-xs transition text-[var(--color-text-body)] flex items-center gap-2"
                                  >
                                    📌 Pin
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      handleDeleteItem(item, e)
                                      setActiveMenu(null)
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-input-bg)] text-xs transition text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                                  >
                                    <Trash2 size={12} /> Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex justify-between items-center mt-2.5 text-[9px] text-[var(--color-text-muted)]">
                            <span className="text-red-500 font-extrabold tracking-wider uppercase bg-red-500/5 px-2 py-0.5 rounded-full border border-red-500/10">{item.mode}</span>
                            <span>{(item.createdAt || "").split(",")[0]}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        ) : (
          /* Mini compact sidebar indicators */
          <div className="flex-1 flex flex-col items-center py-6 gap-6 shrink-0">
            {userToken && (
              <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-white text-xs font-black shadow-lg shadow-red-500/25 cursor-pointer" title={userEmail}>
                {userEmail.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="w-8 h-8 rounded-full bg-[var(--color-input-bg)] border border-[var(--color-border-main)] flex items-center justify-center text-zinc-500 cursor-pointer" title="Favorites">
              ⭐
            </div>
            <div className="w-8 h-8 rounded-full bg-[var(--color-input-bg)] border border-[var(--color-border-main)] flex items-center justify-center text-zinc-500 cursor-pointer" title="Pinned">
              📌
            </div>
          </div>
        )}
      </aside>

      {/* ==========================================
          MAIN VIEWPORT PANEL (INDEPENDENT SCROLL)
          ========================================== */}
      <main className="flex-1 h-screen overflow-y-auto flex flex-col relative z-10 page-transition bg-transparent">
        
        {/* Floating Glass Navbar */}
        <nav className="flex justify-between items-center px-8 py-5 sticky top-0 bg-[var(--color-card-fill)] backdrop-blur-xl z-30 border-b border-[var(--color-border-main)] shrink-0">
          <div className="flex items-center gap-4">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-[var(--color-text-muted)] bg-[var(--color-input-bg)] border border-[var(--color-border-main)] p-2.5 rounded-xl hover:text-white transition cursor-pointer"
                title="Open History"
              >
                <Menu size={18} />
              </button>
            )}
            {!sidebarOpen && (
              <span className="text-lg font-bold bg-gradient-to-r from-red-500 to-rose-450 bg-clip-text text-transparent lg:hidden">
                SummarAI
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Theme Toggle Moon/Sun Switch */}
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-2.5 rounded-xl bg-[var(--color-input-bg)] border border-[var(--color-border-main)] text-[var(--color-text-body)] hover:text-[var(--color-text-title)] transition-all cursor-pointer flex items-center justify-center shrink-0"
              title="Switch Theme"
            >
              {theme === "dark" ? (
                <Sun size={15} className="text-amber-400 fill-amber-400/20" />
              ) : (
                <Moon size={15} className="text-indigo-650" />
              )}
            </button>

            {/* Keyboard Shortcuts trigger */}
            <button
              onClick={() => setShowShortcutsModal(true)}
              className="p-2.5 rounded-xl bg-[var(--color-input-bg)] border border-[var(--color-border-main)] text-[var(--color-text-muted)] hover:text-[var(--color-text-title)] transition-all cursor-pointer flex items-center justify-center shrink-0"
              title="Keyboard Shortcuts"
            >
              <Info size={15} />
            </button>

            <a 
              href="#generate-panel"
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4.5 py-2.5 rounded-xl transition-all duration-300 shadow-md shadow-red-600/20 shrink-0"
            >
              Try Now
            </a>
          </div>
        </nav>

        {/* Hero Input Box Panel */}
        <section id="generate-panel" className="flex-1 flex flex-col items-center text-center px-6 py-12 md:py-20 max-w-5xl mx-auto w-full">
          
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--color-card-fill)] border border-[var(--color-border-main)] text-[10px] font-bold text-red-500 uppercase tracking-widest mb-6">
            <Sparkles className="w-3 h-3 text-red-500" />
            <span>Futuristic Layouts & Dual Theme persistence active</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-tight text-[var(--color-text-title)]">
            Summarize YouTube Videos <br/>
            <span className="bg-gradient-to-r from-red-500 via-rose-500 to-[var(--color-text-title)] bg-clip-text text-transparent">With Real-Time AI</span>
          </h1>

          <p className="text-[var(--color-text-muted)] mt-5 text-sm sm:text-base max-w-2xl font-normal leading-relaxed">
            Instantly parse long YouTube lectures and summaries into organized notes, generate practice MCQ exam quizzes, and listen with local language accent highlights.
          </p>

          {/* Segmented Mode Selector */}
          <div className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] p-1 rounded-2xl flex gap-1.5 mt-8 shadow-sm">
            <button
              onClick={() => setMode("general")}
              className={`px-5 py-2 rounded-xl text-xs font-bold transition-all duration-300 cursor-pointer ${
                mode === "general"
                  ? "bg-red-600 text-white shadow-md shadow-red-600/25"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-title)] hover:bg-[var(--color-border-card)]"
              }`}
            >
              General Notes
            </button>
            <button
              onClick={() => setMode("study")}
              className={`px-5 py-2 rounded-xl text-xs font-bold transition-all duration-300 cursor-pointer ${
                mode === "study"
                  ? "bg-red-600 text-white shadow-md shadow-red-600/25"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-title)] hover:bg-[var(--color-border-card)]"
              }`}
            >
              Study Exam Helper
            </button>
          </div>

          {/* URL Input Box */}
          <div className="mt-8 w-full max-w-2xl bg-[var(--color-card-fill)] p-2 rounded-2xl border border-[var(--color-border-main)] focus-within:border-red-500/50 transition-all duration-300 flex flex-col sm:flex-row gap-2 shadow-xl">
            <div className="flex-1 flex items-center gap-2.5 px-3">
              <Video className="w-5 h-5 text-red-500 shrink-0" />
              <input
                type="text"
                placeholder="Paste YouTube Video URL here..."
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="w-full py-3 bg-transparent text-sm text-[var(--color-text-title)] outline-none placeholder:text-[var(--color-text-muted)]"
              />
            </div>
            
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold px-6 py-3.5 sm:py-0 rounded-xl transition-all duration-300 cursor-pointer shadow-md shadow-red-600/25 active:scale-98"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>Analyzing...</span>
                  </div>
                ) : (
                  "Generate Summary"
                )}
              </button>
              
              <button
                onClick={handleClear}
                className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] hover:bg-[var(--color-card-fill)] hover:border-[var(--color-text-muted)] text-[var(--color-text-body)] text-xs font-semibold px-4.5 rounded-xl transition cursor-pointer shadow-sm"
              >
                Clear
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-5 px-6 py-5 rounded-2xl border border-red-900/30 bg-red-950/15 text-red-400 text-sm max-w-2xl mx-auto flex flex-col gap-4 items-center shadow-xl shadow-red-950/5 w-full">
              <div className="flex items-start gap-3 w-full text-left">
                <span className="text-base mt-0.5">⚠️</span>
                <div className="space-y-2 flex-1">
                  <p className="font-semibold leading-relaxed text-red-300">{error}</p>
                  
                  {availableLangs && availableLangs.length > 0 && (
                    <div className="bg-black/20 p-3 rounded-xl border border-red-900/20 space-y-1.5">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-red-400">Available Subtitle Languages:</p>
                      <p className="text-xs text-zinc-400 leading-normal font-sans">
                        {availableLangs.join(" • ")}
                      </p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex gap-3 w-full justify-end border-t border-red-900/20 pt-3 shrink-0">
                <button
                  onClick={handleClear}
                  className="bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 text-[var(--color-text-body)] hover:text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer"
                >
                  Dismiss
                </button>
                <button
                  onClick={handleGenerate}
                  className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition cursor-pointer shadow-lg shadow-red-600/10 flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Summarization</span>
                </button>
              </div>
            </div>
          )}

          {/* ==========================================
              PREMIUM SHIMMERING SKELETON LOADER
              ========================================== */}
          {loading && (
            <div className="w-full max-w-4xl mt-12 space-y-6 text-left animate-pulse">
              <div className="bg-[var(--color-card-fill)] p-8 rounded-3xl border border-[var(--color-border-main)] space-y-4">
                <div className="h-4.5 w-1/3 bg-zinc-800 rounded-lg shimmer" />
                <div className="h-7 w-2/3 bg-zinc-850 rounded-lg shimmer" />
                <div className="h-64 w-full bg-zinc-900/80 rounded-2xl shimmer" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[1, 2, 3, 4].map(x => (
                  <div key={x} className="bg-[var(--color-card-fill)] border border-[var(--color-border-card)] p-6 rounded-2xl space-y-3">
                    <div className="w-8 h-8 rounded-lg bg-zinc-850 shimmer" />
                    <div className="h-5 w-2/5 bg-zinc-800 rounded-lg shimmer" />
                    <div className="h-3.5 w-full bg-zinc-850 rounded-lg shimmer" />
                    <div className="h-3.5 w-5/6 bg-zinc-850 rounded-lg shimmer" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ==========================================
              AI SUMMARY CONTAINER & DASHBOARD
              ========================================== */}
          {summary && !loading && (
            <div className="mt-12 w-full max-w-4xl text-left space-y-8">
              
              {/* Media Card Container */}
              <div className="bg-[var(--color-card-fill)] border border-[var(--color-border-main)] p-5 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row gap-6 items-center">
                {videoId && (
                  <div className="w-full md:w-96 aspect-video shrink-0 rounded-2xl overflow-hidden border border-[var(--color-border-card)] shadow-lg relative group">
                    <iframe
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${videoId}`}
                      title="YouTube video player"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="absolute inset-0"
                    />
                  </div>
                )}

                <div className="flex-1 space-y-3 py-1">
                  <span className="text-[9px] tracking-widest font-extrabold text-red-500 uppercase bg-red-500/10 px-3 py-1 rounded-full border border-red-500/20 font-sans">
                    {mode.toUpperCase()} MODE ACTIVE
                  </span>
                  <h2 className="text-xl sm:text-2xl font-black leading-snug text-[var(--color-text-title)]">
                    {videoTitle}
                  </h2>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Video ID: <span className="font-mono text-[var(--color-text-body)]">{videoId}</span> • URL: <a href={youtubeUrl} target="_blank" rel="noreferrer" className="text-[var(--color-text-body)] hover:text-red-500 transition inline-flex items-center gap-1">Open link <ExternalLink size={10} /></a>
                  </p>
                </div>
              </div>

              {/* Quick Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-4">
                <div className="bg-[var(--color-card-fill)] border border-[var(--color-border-main)] p-4 rounded-2xl flex items-center gap-3.5 shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
                    ⏱️
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-extrabold">Reading Time</p>
                    <p className="text-sm font-bold text-[var(--color-text-title)] mt-0.5">{readTime} min read</p>
                  </div>
                </div>

                <div className="bg-[var(--color-card-fill)] border border-[var(--color-border-main)] p-4 rounded-2xl flex items-center gap-3.5 shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                    📝
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-extrabold">Word Count</p>
                    <p className="text-sm font-bold text-[var(--color-text-title)] mt-0.5">{wordCount} words</p>
                  </div>
                </div>

                <div className="bg-[var(--color-card-fill)] border border-[var(--color-border-main)] p-4 rounded-2xl flex items-center gap-3.5 shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
                    ⚡
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-extrabold">Time Saved</p>
                    <p className="text-sm font-bold text-[var(--color-text-title)] mt-0.5">
                      {videoDuration > 0 ? (timeSaved > 0 ? `${timeSaved} mins saved` : "N/A (Short Video)") : "N/A (No Duration)"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Main Action Controllers */}
              <div className="bg-[var(--color-card-fill)] border border-[var(--color-border-main)] p-4.5 rounded-2xl flex flex-wrap gap-4 items-center justify-between shadow-lg">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSpeak}
                    className={`px-5 py-3 rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-2 cursor-pointer ${
                      isSpeaking
                        ? "bg-amber-600 text-white shadow-lg shadow-amber-600/15"
                        : "bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-600/25"
                    }`}
                  >
                    {isPaused ? (
                      <>
                        <Play size={13} /> Resume
                      </>
                    ) : isSpeaking ? (
                      <>
                        <Pause size={13} /> Pause
                      </>
                    ) : (
                      <>
                        <Volume2 size={13} /> Listen Summary
                      </>
                    )}
                  </button>

                  {(isSpeaking || isPaused) && (
                    <button
                      onClick={handleRestart}
                      className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] hover:bg-[var(--color-card-fill)] text-[var(--color-text-title)] p-3 rounded-xl transition cursor-pointer"
                      title="Restart speech"
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] hover:bg-[var(--color-card-fill)] text-[var(--color-text-body)] hover:text-[var(--color-text-title)] text-xs font-semibold px-4.5 py-3 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check size={13} className="text-emerald-400" /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy size={13} /> Copy Summary
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleDownloadMarkdown}
                    className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] hover:bg-[var(--color-card-fill)] hover:border-[var(--color-text-muted)] text-[var(--color-text-body)] hover:text-[var(--color-text-title)] text-xs font-semibold px-4.5 py-3 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <FileText size={13} /> Export Markdown
                  </button>

                  <button
                    onClick={handleDownloadPDF}
                    className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] hover:bg-[var(--color-card-fill)] hover:border-[var(--color-text-muted)] text-[var(--color-text-body)] hover:text-[var(--color-text-title)] text-xs font-semibold px-4.5 py-3 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <Download size={13} /> Export PDF
                  </button>

                  {mode === "study" && quiz.length > 0 && (
                    <button
                      onClick={() => setShowQuiz(!showQuiz)}
                      className={`text-xs font-bold px-5 py-3 rounded-xl transition-all cursor-pointer ${
                        showQuiz
                          ? "bg-[var(--color-input-bg)] text-[var(--color-text-title)] border border-[var(--color-border-main)]"
                          : "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-lg shadow-rose-600/10"
                      }`}
                    >
                      {showQuiz ? "Back to Notes" : "Take Practice Quiz"}
                    </button>
                  )}
                </div>
              </div>

              {/* ==========================================
                  INTERACTIVE QUIZ INTERFACE
                  ========================================== */}
              {showQuiz ? (
                <div className="bg-[var(--color-bg-sidebar)] border border-[var(--color-border-main)] p-8 rounded-3xl shadow-2xl relative overflow-hidden">
                  
                  <div className="flex justify-between items-center mb-6">
                    <span className="text-xs font-semibold text-[var(--color-text-muted)] tracking-wider">
                      QUESTION {currentQuestionIndex + 1} OF {quiz.length}
                    </span>
                    <span className="text-xs font-bold text-red-500 bg-red-500/5 px-3.5 py-1.5 rounded-full border border-red-500/10 shadow-sm">
                      SCORE: {score}/{quiz.length}
                    </span>
                  </div>

                  <div className="w-full bg-[var(--color-input-bg)] h-2 rounded-full mb-8 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-red-600 to-rose-500 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${((currentQuestionIndex + 1) / quiz.length) * 100}%` }}
                    />
                  </div>

                  {!quizFinished ? (
                    <div className="space-y-6">
                      <h3 className="text-xl md:text-2xl font-bold text-[var(--color-text-title)] leading-snug">
                        {quiz[currentQuestionIndex]?.question}
                      </h3>

                      <div className="grid grid-cols-1 gap-4.5">
                        {quiz[currentQuestionIndex]?.options.map((option, idx) => {
                          const isSelected = selectedOption === option
                          const isCorrect = option === quiz[currentQuestionIndex]?.answer

                          let optionStyles = "bg-[var(--color-card-fill)] border-[var(--color-border-card)] text-[var(--color-text-body)] hover:bg-[var(--color-input-bg)] hover:border-[var(--color-border-main)] cursor-pointer"

                          if (isAnswered) {
                            if (isCorrect) {
                              optionStyles = "bg-emerald-950/20 border-emerald-500 text-emerald-600 font-bold shadow-[0_0_20px_rgba(16,185,129,0.05)] cursor-not-allowed"
                            } else if (isSelected) {
                              optionStyles = "bg-red-950/20 border-red-500 text-red-500 font-bold shadow-[0_0_20px_rgba(239,68,68,0.05)] cursor-not-allowed"
                            } else {
                              optionStyles = "bg-[var(--color-bg-sidebar)] border-[var(--color-border-main)] text-[var(--color-text-muted)] cursor-not-allowed opacity-35"
                            }
                          }

                          return (
                            <button
                              key={idx}
                              onClick={() => handleOptionSelect(option)}
                              disabled={isAnswered}
                              className={`w-full text-left px-5.5 py-4.5 rounded-2xl border text-sm transition-all duration-200 flex items-center justify-between ${optionStyles}`}
                            >
                              <span>{option}</span>
                              {isAnswered && isCorrect && (
                                <span className="text-[10px] text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 font-extrabold uppercase tracking-wide">
                                  Correct ✓
                                </span>
                              )}
                              {isAnswered && isSelected && !isCorrect && (
                                <span className="text-[10px] text-red-500 bg-red-500/10 px-2.5 py-1 rounded-full border border-red-500/20 font-extrabold uppercase tracking-wide">
                                  Wrong ✗
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>

                      {/* Next / Back Controllers */}
                      <div className="flex justify-between items-center pt-4 border-t border-[var(--color-border-main)]">
                        <button
                          onClick={handleCloseQuiz}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] text-xs font-semibold transition"
                        >
                          ← Back to Study Notes
                        </button>

                        {isAnswered && (
                          <button
                            onClick={handleNextQuestion}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-6 py-3.5 rounded-xl transition shadow-md shadow-red-600/25 cursor-pointer flex items-center gap-1"
                          >
                            <span>
                              {currentQuestionIndex + 1 === quiz.length ? "Submit & View Score" : "Next Question"}
                            </span>
                            <ArrowRight size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* SCORE SCREEN */
                    <div className="text-center py-10 space-y-6 max-w-md mx-auto animate-fade-in">
                      <div className="w-20 h-20 bg-red-500/5 border border-red-500/15 rounded-3xl flex items-center justify-center mx-auto shadow-xl">
                        <span className="text-3xl">🎓</span>
                      </div>
                      
                      <div className="space-y-2">
                        <h3 className="text-2xl font-black text-[var(--color-text-title)]">Quiz Finished!</h3>
                        <p className="text-[var(--color-text-muted)] text-sm leading-relaxed">
                          Great job! Taking active recall quizzes is a proven scientific method to double your memory retention.
                        </p>
                      </div>

                      <div className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] p-6 rounded-2xl">
                        <div className="text-4xl font-black text-red-500">
                          {Math.round((score / quiz.length) * 100)}%
                        </div>
                        <p className="text-[var(--color-text-body)] text-xs mt-2">
                          You answered <span className="text-[var(--color-text-title)] font-bold">{score}</span> out of <span className="text-[var(--color-text-title)] font-bold">{quiz.length}</span> questions correctly.
                        </p>
                      </div>

                      <div className="flex gap-3 justify-center">
                        <button
                          onClick={handleRetakeQuiz}
                          className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] hover:bg-[var(--color-card-fill)] text-[var(--color-text-title)] font-bold text-xs px-5 py-3.5 rounded-xl transition cursor-pointer"
                        >
                          🔄 Retake Quiz
                        </button>
                        
                        <button
                          onClick={handleCloseQuiz}
                          className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-7 py-3.5 rounded-xl transition cursor-pointer shadow-md shadow-red-600/25"
                        >
                          Close Notes
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                /* ==========================================
                    STRUCTURED PARSED NOTE CARDS (DEFAULT SUMMARY VIEW)
                    ========================================== */
                <div className="space-y-8 font-sans">
                  
                  {/* Render Parsed Structured Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6" ref={summaryRef}>
                    {parsedSections.map((section, sectionIdx) => {
                      const sectionSentences = sentences.filter(s => s.sectionIndex === sectionIdx)

                      return (
                        <div
                          key={sectionIdx}
                          className="glass-panel p-6.5 rounded-3xl shadow-xl flex flex-col space-y-4 hover:-translate-y-1 transition-all duration-300 relative group border border-[var(--color-border-card)]"
                        >
                          {/* Card Section Header */}
                          <div className="flex items-center gap-3 pb-3 border-b border-[var(--color-border-main)]">
                            <div className="w-9 h-9 rounded-xl bg-[var(--color-input-bg)] border border-[var(--color-border-card)] flex items-center justify-center shrink-0">
                              <HeaderIcon name={section.icon} />
                            </div>
                            <h3 className="font-black text-xs tracking-wider text-[var(--color-text-title)] uppercase">
                              {section.title}
                            </h3>
                          </div>

                          {/* Card Content Rendered Sentence-by-Sentence */}
                          <div className="text-[var(--color-text-body)] leading-relaxed text-sm flex-1">
                            {sectionSentences.map((sentenceObj) => renderSentence(sentenceObj))}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* ==========================================
                      MULTILINGUAL REGIONAL TRANSLATOR CARD
                      ========================================== */}
                  <div className="glass-panel p-8 rounded-3xl shadow-2xl space-y-6">
                    
                    <div className="flex items-center gap-3 pb-3 border-b border-[var(--color-border-main)]">
                      <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500">
                        <Languages className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-black text-xs tracking-wider text-[var(--color-text-title)] uppercase font-sans">
                          Regional Multilingual Translation
                        </h3>
                        <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 font-medium">Translate summaries into Indian regional accents</p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 items-center">
                      <div className="relative w-full sm:w-48">
                        <select
                          value={selectedLanguage}
                          onChange={(e) => setSelectedLanguage(e.target.value)}
                          className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-4 py-3 rounded-xl text-xs text-[var(--color-text-title)] appearance-none cursor-pointer outline-none focus:border-red-500"
                        >
                          <option>Telugu</option>
                          <option>Hindi</option>
                          <option>Tamil</option>
                          <option>Kannada</option>
                          <option>Malayalam</option>
                        </select>
                      </div>

                      <button
                        onClick={handleTranslate}
                        disabled={translationLoading}
                        className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-6 py-3.5 rounded-xl transition cursor-pointer shadow-md shadow-red-600/25 active:scale-98"
                      >
                        {translationLoading ? "Translating..." : `Translate into ${selectedLanguage}`}
                      </button>
                    </div>

                    {/* Translated text block */}
                    {translatedSummary && (
                      <div className="bg-[var(--color-input-bg)] border border-[var(--color-border-main)] p-6 rounded-2xl space-y-4 relative">
                        <div className="flex justify-between items-center pb-3 border-b border-[var(--color-border-main)]">
                          <span className="text-[10px] tracking-widest font-extrabold text-red-500 uppercase bg-red-500/10 px-3 py-1 rounded-full border border-red-500/20 font-sans">
                            {selectedLanguage.toUpperCase()} TRANSLATION
                          </span>

                          <button
                            onClick={handleTranslateSpeak}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                              isSpeakingTranslation
                                ? "bg-amber-600 text-white animate-pulse"
                                : "bg-[var(--color-card-fill)] border border-[var(--color-border-card)] text-[var(--color-text-body)]"
                            }`}
                          >
                            {isSpeakingTranslation ? <Pause size={12} /> : <Volume2 size={12} />}
                            <span>{isSpeakingTranslation ? "Pause" : "Listen Translation"}</span>
                          </button>
                        </div>

                        <p className="text-[var(--color-text-body)] leading-9 text-base whitespace-pre-wrap font-sans">
                          {translatedSummary.split(/(?<=[.!?])\s+/).map((sentence, idx) => {
                            const highlightClass = translatedActiveSentenceIndex === idx
                              ? "text-glow-active"
                              : "text-[var(--color-text-body)]"
                            return (
                              <span 
                                key={idx} 
                                className={`transition-all duration-300 mr-1 rounded cursor-pointer ${highlightClass}`}
                                onClick={() => speakFromIndex(idx, true)}
                              >
                                {sentence}{" "}
                              </span>
                            )
                          })}
                        </p>
                      </div>
                    )}

                  </div>

                </div>
              )}

            </div>
          )}

        </section>

      </main>

      {/* ==========================================
          STUNNING GLASSMORPHIC AUTHENTICATION MODAL
          ========================================== */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4" onClick={() => setShowAuthModal(false)}>
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-zinc-950 border border-zinc-900 rounded-3xl p-8 relative shadow-2xl space-y-6 transition-all duration-300 scale-100"
          >
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute right-5 top-5 p-1.5 hover:bg-zinc-900 text-zinc-400 hover:text-white rounded-xl transition cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="text-center space-y-2">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-red-600 to-rose-500 flex items-center justify-center mx-auto shadow-lg shadow-red-500/20">
                <Sparkles className="w-5 h-5 text-white animate-pulse" />
              </div>
              <h3 className="text-2xl font-black bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
                {authMode === "login" ? "Welcome Back" : "Create Account"}
              </h3>
              <p className="text-xs text-zinc-500">
                {authMode === "login" ? "Log in to sync video summaries to your cloud account" : "Sign up to start saving video notes across devices"}
              </p>
            </div>

            {authError && (
              <div className="px-4 py-3 rounded-xl border border-red-900/30 bg-red-950/20 text-red-400 text-xs text-center font-semibold">
                {authError}
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider pl-1">Email Address</label>
                <input
                  type="email"
                  placeholder="name@domain.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full bg-zinc-900/60 border border-zinc-850 px-4 py-3 rounded-xl text-sm text-white focus:outline-none focus:border-red-500 transition-all duration-300 placeholder:text-zinc-650"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center pl-1">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Password</label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-[9px] font-extrabold uppercase text-red-400 hover:text-red-300 transition"
                  >
                    {showPassword ? <span className="flex items-center gap-1"><EyeOff size={10} /> Hide</span> : <span className="flex items-center gap-1"><Eye size={10} /> Show</span>}
                  </button>
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full bg-zinc-900/60 border border-zinc-850 px-4 py-3 rounded-xl text-sm text-white focus:outline-none focus:border-red-500 transition-all duration-300"
                  minLength={6}
                  required
                />
              </div>

              {authMode === "signup" && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider pl-1">Confirm Password</label>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••"
                    value={authConfirmPassword}
                    onChange={(e) => setAuthConfirmPassword(e.target.value)}
                    className="w-full bg-zinc-900/60 border border-zinc-850 px-4 py-3 rounded-xl text-sm text-white focus:outline-none focus:border-red-500 transition-all duration-300"
                    required
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs py-3.5 rounded-xl transition-all duration-300 cursor-pointer shadow-lg shadow-red-600/10 mt-6"
              >
                {authLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>Processing Session...</span>
                  </div>
                ) : (
                  authMode === "login" ? "Access Account" : "Register Account"
                )}
              </button>

            </form>

            <div className="text-center pt-2">
              <button
                onClick={() => {
                  setAuthMode(authMode === "login" ? "signup" : "login")
                  setAuthError("")
                  setAuthPassword("")
                  setAuthConfirmPassword("")
                }}
                className="text-xs text-zinc-400 hover:text-white transition font-medium"
              >
                {authMode === "login" ? (
                  <span>New to SummarAI? <span className="text-red-400 font-bold hover:underline">Create an account</span></span>
                ) : (
                  <span>Already have an account? <span className="text-red-400 font-bold hover:underline">Log in</span></span>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ==========================================
          ACCESSIBILITY SHORTCUTS GUIDE MODAL
          ========================================== */}
      {showShortcutsModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4" onClick={() => setShowShortcutsModal(false)}>
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-zinc-950 border border-zinc-900 rounded-3xl p-8 relative shadow-2xl space-y-6"
          >
            <button
              onClick={() => setShowShortcutsModal(false)}
              className="absolute right-5 top-5 p-1.5 hover:bg-zinc-900 text-zinc-400 hover:text-white rounded-xl transition cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="text-center space-y-2">
              <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-350">
                <Info size={18} />
              </div>
              <h3 className="text-xl font-black text-white">Keyboard Shortcuts</h3>
              <p className="text-xs text-zinc-500">Accessible hotkeys to navigate the learning platform</p>
            </div>

            <div className="space-y-3 pt-2">
              
              <div className="flex justify-between items-center p-3.5 bg-zinc-900/50 border border-zinc-900 rounded-2xl text-xs">
                <span className="text-zinc-300 font-semibold">Play / Pause Summary Speech</span>
                <span className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-xl font-mono text-[10px] font-bold shadow-inner">Spacebar</span>
              </div>

              <div className="flex justify-between items-center p-3.5 bg-zinc-900/50 border border-zinc-900 rounded-2xl text-xs">
                <span className="text-zinc-300 font-semibold">Stop Speech / Close Modals</span>
                <span className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-xl font-mono text-[10px] font-bold shadow-inner">Esc</span>
              </div>

              <div className="flex justify-between items-center p-3.5 bg-zinc-900/50 border border-zinc-900 rounded-2xl text-xs">
                <span className="text-zinc-300 font-semibold">Focus History Search Input</span>
                <span className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-xl font-mono text-[10px] font-bold shadow-inner">Ctrl + F</span>
              </div>

              <div className="flex justify-between items-center p-3.5 bg-zinc-900/50 border border-zinc-900 rounded-2xl text-xs">
                <span className="text-zinc-300 font-semibold">Audio Highlight Click</span>
                <span className="text-zinc-400 font-medium italic text-[10px]">Click any sentence</span>
              </div>

            </div>

            <button
              onClick={() => setShowShortcutsModal(false)}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs py-3 rounded-xl transition cursor-pointer mt-4"
            >
              Got It
            </button>
          </div>
        </div>
      )}

      {/* ==========================================
          PREMIUM FLOATING AUDIO PLAYER PANEL
          ========================================== */}
      {(isSpeaking || isPaused || isSpeakingTranslation) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-4xl bg-zinc-950/85 backdrop-blur-xl border border-zinc-800/80 p-4 rounded-3xl shadow-2xl z-50 flex flex-col md:flex-row gap-4 items-center justify-between transition-all duration-500 animate-slide-up">
          {/* Left: Thumbnail & Title */}
          <div className="flex items-center gap-3 w-full md:w-auto">
            {thumbnail ? (
              <img src={thumbnail} alt="Video thumbnail" className="w-16 h-10 object-cover rounded-lg border border-zinc-800 shrink-0" />
            ) : (
              <div className="w-16 h-10 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center justify-center shrink-0">
                <Video size={16} className="text-zinc-600" />
              </div>
            )}
            <div className="min-w-0 flex-1 md:max-w-[200px]">
              <p className="text-xs font-bold text-white truncate leading-tight">
                {speechIsTranslation ? `${selectedLanguage} Translation` : videoTitle || "YouTube Summary"}
              </p>
              <p className="text-[10px] text-zinc-400 mt-1 font-mono font-medium">
                {speechIsTranslation ? "TTS: Indian Accent" : "TTS: English Audio"} • {
                  speechIsTranslation 
                    ? `Sentence ${translatedActiveSentenceIndex + 1} / ${translatedSummary.split(/(?<=[.!?])\s+/).filter(s => s.trim() !== "").length}`
                    : `Sentence ${activeSentenceIndex + 1} / ${sentences.length}`
                }
              </p>
            </div>
          </div>

          {/* Center: Controls & Timeline */}
          <div className="flex flex-col items-center gap-2 flex-1 w-full max-w-md">
            {/* Buttons */}
            <div className="flex items-center gap-4">
              <button 
                onClick={() => {
                  const currentIdx = speechIsTranslation ? translatedActiveSentenceIndex : activeSentenceIndex
                  if (currentIdx > 0) {
                    speakFromIndex(currentIdx - 1, speechIsTranslation)
                  }
                }}
                disabled={(speechIsTranslation ? translatedActiveSentenceIndex : activeSentenceIndex) <= 0}
                className="text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition cursor-pointer p-1"
                title="Previous Sentence"
              >
                <ChevronRight size={18} className="rotate-180" />
              </button>

              <button
                onClick={() => {
                  speakFromIndex(0, speechIsTranslation)
                }}
                className="text-zinc-400 hover:text-white transition cursor-pointer p-1"
                title="Restart Audio"
              >
                <RotateCcw size={14} />
              </button>

              <button
                onClick={speechIsTranslation ? handleTranslateSpeak : handleSpeak}
                className="w-10 h-10 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-red-600/20 active:scale-95 p-0"
                title={isPaused ? "Play" : "Pause"}
              >
                {isPaused ? <Play size={16} fill="white" className="ml-0.5" /> : <Pause size={16} fill="white" />}
              </button>

              <button
                onClick={() => {
                  const currentIdx = speechIsTranslation ? translatedActiveSentenceIndex : activeSentenceIndex
                  const limit = speechIsTranslation 
                    ? translatedSummary.split(/(?<=[.!?])\s+/).filter(s => s.trim() !== "").length
                    : sentences.length
                  if (currentIdx < limit - 1) {
                    speakFromIndex(currentIdx + 1, speechIsTranslation)
                  }
                }}
                disabled={
                  speechIsTranslation 
                    ? translatedActiveSentenceIndex >= (translatedSummary.split(/(?<=[.!?])\s+/).filter(s => s.trim() !== "").length - 1)
                    : activeSentenceIndex >= (sentences.length - 1)
                }
                className="text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition cursor-pointer p-1"
                title="Next Sentence"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Timeline Progress Bar */}
            <div className="flex items-center gap-2.5 w-full">
              <span className="text-[9px] font-mono text-zinc-500">
                {speechIsTranslation ? `${translatedActiveSentenceIndex >= 0 ? translatedActiveSentenceIndex : 0}` : `${activeSentenceIndex >= 0 ? activeSentenceIndex : 0}`}
              </span>
              <div 
                onClick={speechIsTranslation ? handleTranslationProgressBarClick : handleProgressBarClick}
                className="flex-1 bg-zinc-800 h-1.5 rounded-full cursor-pointer relative group"
              >
                <div 
                  style={{ width: `${speechIsTranslation ? (translatedSummary.split(/(?<=[.!?])\s+/).filter(s => s.trim() !== "").length > 0 ? ((translatedActiveSentenceIndex + 1) / translatedSummary.split(/(?<=[.!?])\s+/).filter(s => s.trim() !== "").length) * 100 : 0) : (sentences.length > 0 ? ((activeSentenceIndex + 1) / sentences.length) * 100 : 0)}%` }}
                  className="bg-red-600 h-full rounded-full transition-all duration-300 relative group-hover:bg-red-500"
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border border-red-600 scale-0 group-hover:scale-100 transition-all shadow-md" />
                </div>
              </div>
              <span className="text-[9px] font-mono text-zinc-500">
                {speechIsTranslation 
                  ? `${translatedSummary.split(/(?<=[.!?])\s+/).filter(s => s.trim() !== "").length}`
                  : `${sentences.length}`
                }
              </span>
            </div>
          </div>

          {/* Right: Pitch, Rate, Voice & Close */}
          <div className="flex items-center gap-4 w-full md:w-auto justify-end">
            {/* Speed slider */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-400 font-extrabold uppercase tracking-wider">Speed</span>
              <input
                type="range"
                min="0.75"
                max="2.0"
                step="0.25"
                value={speechRate}
                onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                className="w-16 h-1 bg-zinc-800 accent-red-600 rounded-lg cursor-pointer appearance-none"
                title={`Speed: ${speechRate}x`}
              />
              <span className="text-[10px] font-bold text-red-500 min-w-[32px] bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20 text-center font-mono">
                {speechRate.toFixed(2)}x
              </span>
            </div>

            {/* Voice Dropdown */}
            {!speechIsTranslation ? (
              <div className="relative">
                <select
                  value={selectedVoiceName}
                  onChange={(e) => setSelectedVoiceName(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-xl text-[10px] font-bold text-zinc-300 outline-none focus:border-red-500 cursor-pointer max-w-[140px] truncate"
                  title="Choose English voice accent"
                >
                  {voices.filter(v => v.lang.startsWith("en") || v.lang.startsWith("EN")).map((voice, idx) => (
                    <option key={idx} value={voice.name}>
                      {voice.name.replace("Microsoft", "").replace("Google", "").trim()} ({voice.lang})
                    </option>
                  ))}
                  {voices.filter(v => v.lang.startsWith("en") || v.lang.startsWith("EN")).length === 0 && (
                    <option>System Default Voice</option>
                  )}
                </select>
              </div>
            ) : (
              <div className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 rounded-xl">
                Accent: Auto ({selectedLanguage})
              </div>
            )}

            {/* Close/Stop button */}
            <button
              onClick={stopSpeech}
              className="text-zinc-500 hover:text-white hover:bg-zinc-900 border border-zinc-900 hover:border-zinc-850 p-2 rounded-xl transition cursor-pointer shrink-0"
              title="Close Player & Stop Audio"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

export default Home