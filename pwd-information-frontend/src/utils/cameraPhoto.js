export const MAX_PHOTO_BYTES = 400000

export function stopCamera(stream) {
  stream?.getTracks().forEach(track => {
    track.onended = null
    track.stop()
  })
}

export function cameraErrorMessage(error) {
  if (['NotAllowedError','PermissionDeniedError','SecurityError'].includes(error?.name)) return 'Camera permission was denied. Allow camera access in your browser, then try again. You can also upload a photo.'
  if (['NotFoundError','DevicesNotFoundError'].includes(error?.name)) return 'No camera was found. Connect a camera or upload a photo instead.'
  if (['NotReadableError','TrackStartError','AbortError'].includes(error?.name)) return 'The camera could not start. Close other apps using it, then try again.'
  if (error?.name === 'OverconstrainedError') return 'The selected camera is unavailable. Select another camera or try again.'
  return 'Could not open the camera. Try again or upload a photo instead.'
}

export function captureCameraPhoto(video, createCanvas = () => document.createElement('canvas')) {
  if (!video?.videoWidth || !video?.videoHeight || video.readyState < 2) throw new Error('Wait for the camera preview before taking a photo.')
  const canvas = createCanvas()
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not capture the photo. Try uploading a photo instead.')
  let scale = Math.min(1,1280 / Math.max(video.videoWidth,video.videoHeight))
  // Encode from the original frame each time, preserving the aspect ratio.
  // The limit uses decoded JPEG bytes, matching the server's 400 KB limit.
  for (let attempt = 0; attempt < 8; attempt++) {
    canvas.width = Math.max(1,Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1,Math.round(video.videoHeight * scale))
    context.drawImage(video,0,0,canvas.width,canvas.height)
    for (const quality of [.88,.72,.56]) {
      const image = canvas.toDataURL('image/jpeg',quality)
      const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
      if (!match) throw new Error('Your browser could not create a JPEG photo. Try uploading a photo instead.')
      const encoded = match[1]
      const bytes = encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
      if (bytes <= MAX_PHOTO_BYTES) return image
    }
    scale *= .75
  }
  throw new Error('The captured photo is too large. Retake it or upload an image under 400 KB.')
}
