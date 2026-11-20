import React, {useEffect,useId,useLayoutEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {Camera,RotateCcw,Check,X} from 'lucide-react'
import {cameraErrorMessage,captureCameraPhoto,stopCamera} from '../utils/cameraPhoto'
import '../camera-capture.css'

export default function CameraCapture({onCapture,onClose}) {
  const dialog = useRef(null)
  const video = useRef(null)
  const stream = useRef(null)
  const [photo,setPhoto] = useState('')
  const [ready,setReady] = useState(false)
  const [starting,setStarting] = useState(true)
  const [error,setError] = useState('')
  const [devices,setDevices] = useState([])
  const [deviceId,setDeviceId] = useState('')
  const [attempt,setAttempt] = useState(0)
  const titleId = useId()
  const descriptionId = useId()

  useLayoutEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    element.showModal()
    return () => {
      if (element.open) element.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  },[])

  useEffect(() => {
    if (photo) return
    let cancelled = false
    let acquired
    setReady(false);setStarting(true);setError('')
    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(!window.isSecureContext
          ? 'Camera access needs HTTPS or localhost. Open the secure site, or upload a photo instead.'
          : 'This browser does not support camera capture. Try another browser or upload a photo instead.')
        setStarting(false)
        return
      }
      try {
        acquired = await navigator.mediaDevices.getUserMedia({
          audio:false,
          video:{width:{ideal:1280},height:{ideal:960},...(deviceId ? {deviceId:{exact:deviceId}} : {facingMode:{ideal:'user'}})},
        })
        if (cancelled) {stopCamera(acquired);return}
        stream.current = acquired
        const player = video.current
        player.srcObject = acquired
        acquired.getVideoTracks().forEach(track => {
          track.onended = () => {
            if (cancelled) return
            stopCamera(acquired);setReady(false);setStarting(false)
            setError('The camera was disconnected. Connect it and try again, or upload a photo.')
          }
        })
        await player.play()
        if (cancelled) return
        setReady(player.readyState >= 2 && player.videoWidth > 0)
        setStarting(false)
        if (navigator.mediaDevices.enumerateDevices) {
          const available = await navigator.mediaDevices.enumerateDevices().catch(() => [])
          if (!cancelled) setDevices(available.filter(device => device.kind === 'videoinput'))
        }
      } catch (failure) {
        stopCamera(acquired)
        if (!cancelled) {stream.current = null;setReady(false);setError(cameraErrorMessage(failure))}
      } finally {if (!cancelled) setStarting(false)}
    }
    void start()
    return () => {
      cancelled = true
      stopCamera(acquired)
      if (stream.current === acquired) stream.current = null
      if (video.current && video.current.srcObject === acquired) video.current.srcObject = null
    }
  },[deviceId,attempt,photo])

  function capture() {
    if (!ready) return
    try {
      const captured = captureCameraPhoto(video.current)
      stopCamera(stream.current)
      stream.current = null
      setReady(false);setPhoto(captured);setError('')
    } catch (failure) {setError(failure.message)}
  }

  return createPortal(<dialog className="camera-dialog" ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => {event.preventDefault();onClose()}}>
    <header className="camera-dialog-header"><h2 id={titleId}>{photo ? 'Review Photo' : 'Take a Photo'}</h2><button type="button" className="camera-close" aria-label="Close camera" onClick={onClose}><X size={21}/></button></header>
    <p id={descriptionId} className="camera-description">{photo ? 'Check the photo, then choose Use Photo or retake it.' : 'Position the person in the frame, then select Capture Photo.'}</p>
    {!photo && devices.length > 1 && <label className="camera-device">Camera<select value={deviceId || stream.current?.getVideoTracks()[0]?.getSettings().deviceId || ''} disabled={starting} onChange={event => setDeviceId(event.target.value)}>{devices.map((device,index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>}
    <div className="camera-preview">
      {photo ? <img src={photo} alt="Captured profile photo"/> : <video ref={video} autoPlay muted playsInline aria-label="Live camera preview" onCanPlay={() => {if (stream.current?.active) setReady(true)}}/>}
      {!photo && starting && <div className="camera-placeholder" role="status"><Camera size={36}/><span>Opening camera…</span><small>Allow camera access if your browser asks.</small></div>}
      {!photo && !starting && !ready && <div className="camera-placeholder" aria-hidden="true"><Camera size={36}/><span>Camera unavailable</span></div>}
    </div>
    {error && <p className="camera-error" role="alert">{error}</p>}
    <footer className="camera-actions">
      <button type="button" className="camera-secondary" onClick={onClose}>Cancel</button>
      <div>{photo ? <>
        <button type="button" className="camera-secondary" onClick={() => {setPhoto('');setAttempt(value => value + 1)}}><RotateCcw size={16}/> Retake</button>
        <button type="button" className="camera-primary" onClick={() => {onCapture(photo);onClose()}}><Check size={17}/> Use Photo</button>
      </> : <>
        {error && <button type="button" className="camera-secondary" onClick={() => setAttempt(value => value + 1)} disabled={starting}><RotateCcw size={16}/> Try Again</button>}
        <button type="button" className="camera-primary" onClick={capture} disabled={!ready || starting}><Camera size={17}/> Capture Photo</button>
      </>}</div>
    </footer>
  </dialog>,document.body)
}
