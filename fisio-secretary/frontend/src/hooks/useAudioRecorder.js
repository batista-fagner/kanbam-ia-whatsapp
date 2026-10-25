import { useEffect, useRef, useState } from 'react'

const MAX_AUDIO_BYTES = 5 * 1024 * 1024 // 5 MB

// Gravação de nota de voz no navegador (mesmo formato do chat do card do Kanban).
// onDone(blob, mimeType) só é chamado quando o operador para a gravação (não ao cancelar).
export function useAudioRecorder(onDone) {
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const cancelledRef = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => () => {
    clearInterval(timerRef.current)
    cancelledRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  async function start() {
    if (isRecording) return
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      cancelledRef.current = false
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        clearInterval(timerRef.current)
        setSeconds(0)
        if (cancelledRef.current) return
        const blob = new Blob(chunksRef.current, { type: mimeType })
        if (blob.size === 0) return
        if (blob.size > MAX_AUDIO_BYTES) { setError('Áudio muito longo (máx. 5 MB)'); return }
        onDoneRef.current?.(blob, mimeType)
      }
      recorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
    } catch {
      setError('Não foi possível acessar o microfone')
    }
  }

  function stop() {
    recorderRef.current?.stop()
    setIsRecording(false)
  }

  function cancel() {
    cancelledRef.current = true
    recorderRef.current?.stop()
    setIsRecording(false)
  }

  return { isRecording, seconds, error, setError, start, stop, cancel }
}
