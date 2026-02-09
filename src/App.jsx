import { useState, useRef, useCallback } from 'react'
import './App.css'

const AGENT_WS_URL = 'wss://agent.deepgram.com/v1/agent/converse'
const API_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY

/*
 ╔══════════════════════════════════════════════════════════╗
 ║  CHANGE YOUR AGENT PROMPT HERE                          ║
 ╚══════════════════════════════════════════════════════════╝
*/
const AGENT_PROMPT =
  ' '

const AGENT_GREETING = 'Hello! How can I help you today?'

const AGENT_CONFIG = {
  type: 'Settings',
  audio: {
    input: { encoding: 'linear16', sample_rate: 16000 },
    output: { encoding: 'linear16', sample_rate: 16000, container: 'none' },
  },
  agent: {
    listen: { provider: { type: 'deepgram', model: 'nova-3' } },
    think: {
      provider: { type: 'open_ai', model: 'gpt-4o-mini' },
      prompt: AGENT_PROMPT,
    },
    speak: { provider: { type: 'deepgram', model: 'aura-2-thalia-en' } },
    greeting: AGENT_GREETING,
  },
}

export default function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [agentState, setAgentState] = useState('idle') // idle | listening | thinking | speaking

  const wsRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const audioContextRef = useRef(null)
  const processorRef = useRef(null)
  const playbackContextRef = useRef(null)
  const audioQueueRef = useRef([])
  const isPlayingRef = useRef(false)

  const playNextAudio = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return
    isPlayingRef.current = true

    while (audioQueueRef.current.length > 0) {
      const audioData = audioQueueRef.current.shift()
      if (!playbackContextRef.current) {
        playbackContextRef.current = new AudioContext({ sampleRate: 16000 })
      }
      const ctx = playbackContextRef.current
      const int16 = new Int16Array(audioData)
      const float32 = new Float32Array(int16.length)
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768
      }
      const buffer = ctx.createBuffer(1, float32.length, 16000)
      buffer.getChannelData(0).set(float32)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      await new Promise((resolve) => {
        source.onended = resolve
        source.start()
      })
    }
    isPlayingRef.current = false
  }, [])

  const handleMessage = useCallback(
    async (event) => {
      if (event.data instanceof Blob) {
        const arrayBuffer = await event.data.arrayBuffer()
        audioQueueRef.current.push(arrayBuffer)
        playNextAudio()
        return
      }
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'SettingsApplied':
            setIsConnected(true)
            break
          case 'UserStartedSpeaking':
            setAgentState('listening')
            audioQueueRef.current = []
            break
          case 'ConversationText':
            if (msg.role === 'user') setAgentState('thinking')
            break
          case 'AgentThinking':
            setAgentState('thinking')
            break
          case 'AgentStartedSpeaking':
            setAgentState('speaking')
            break
          case 'AgentAudioDone':
            setAgentState('listening')
            break
        }
      } catch {
        // ignore
      }
    },
    [playNextAudio]
  )

  const startAgent = useCallback(async () => {
    try {
      const ws = new WebSocket(AGENT_WS_URL, ['token', API_KEY])
      wsRef.current = ws

      ws.onopen = () => ws.send(JSON.stringify(AGENT_CONFIG))
      ws.onmessage = handleMessage
      ws.onerror = () => {
        setIsConnected(false)
        setAgentState('idle')
      }
      ws.onclose = () => {
        setIsConnected(false)
        setAgentState('idle')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      mediaStreamRef.current = stream

      const audioContext = new AudioContext({ sampleRate: 16000 })
      audioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const float32 = e.inputBuffer.getChannelData(0)
          const int16 = new Int16Array(float32.length)
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]))
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
          }
          ws.send(int16.buffer)
        }
      }

      source.connect(processor)
      processor.connect(audioContext.destination)
      setAgentState('listening')
    } catch (err) {
      console.error('Failed to start:', err)
      setAgentState('idle')
    }
  }, [handleMessage])

  const stopAgent = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
    mediaStreamRef.current = null
    processorRef.current?.disconnect()
    processorRef.current = null
    audioContextRef.current?.close()
    audioContextRef.current = null
    playbackContextRef.current?.close()
    playbackContextRef.current = null
    audioQueueRef.current = []
    isPlayingRef.current = false
    setIsConnected(false)
    setAgentState('idle')
  }, [])

  const toggle = isConnected ? stopAgent : startAgent

  const stateLabel = {
    idle: 'Tap to start',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking',
  }

  return (
    <div className="app">
      <div className="center-stage">
        {/* Animated rings */}
        <div className={`orb-wrap orb-wrap--${agentState}`}>
          <div className="ring ring-1" />
          <div className="ring ring-2" />
          <div className="ring ring-3" />

          <button className={`orb orb--${agentState}`} onClick={toggle}>
            {isConnected ? (
              <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2Z" />
              </svg>
            )}
          </button>
        </div>

        <p className="state-label">{stateLabel[agentState]}</p>
      </div>
    </div>
  )
}
