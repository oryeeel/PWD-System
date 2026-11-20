import {test} from 'node:test'
import assert from 'node:assert/strict'
import {captureCameraPhoto,stopCamera,cameraErrorMessage,MAX_PHOTO_BYTES} from '../src/utils/cameraPhoto.js'

const frame = {videoWidth:1920,videoHeight:1080,readyState:2}
const jpeg = bytes => `data:image/jpeg;base64,${Buffer.alloc(bytes).toString('base64')}`
function canvasFixture(encode) {
  const calls = []
  const canvas = {
    width:0,height:0,
    getContext:() => ({drawImage(...args){calls.push(args)}}),
    toDataURL(type,quality){assert.equal(type,'image/jpeg');return encode(quality,canvas)},
  }
  return {canvas,calls}
}

test('capture preserves the full frame aspect ratio and scales down large camera frames',() => {
  const image = jpeg(100)
  const {canvas,calls} = canvasFixture(() => image)
  assert.equal(captureCameraPhoto(frame,() => canvas),image)
  assert.equal(canvas.width,1280);assert.equal(canvas.height,720)
  assert.deepEqual(calls[0],[frame,0,0,1280,720])
})

test('capture does not enlarge small camera frames',() => {
  const {canvas} = canvasFixture(() => jpeg(100))
  captureCameraPhoto({...frame,videoWidth:320,videoHeight:240},() => canvas)
  assert.equal(canvas.width,320);assert.equal(canvas.height,240)
})

test('JPEG byte limit counts base64 padding correctly and tries lower quality',() => {
  for (const extra of [1,2,3]) {
    let attempts = 0
    const fitting = jpeg(MAX_PHOTO_BYTES)
    const {canvas} = canvasFixture(() => ++attempts === 1 ? jpeg(MAX_PHOTO_BYTES + extra) : fitting)
    assert.equal(captureCameraPhoto(frame,() => canvas),fitting)
    assert.equal(attempts,2)
  }
})

test('large photos are resized when reducing JPEG quality alone is not enough',() => {
  const {canvas,calls} = canvasFixture((quality,current) => jpeg(current.width > 1000 ? 400001 : 300000))
  const result = captureCameraPhoto(frame,() => canvas)
  assert.equal(Buffer.from(result.split(',')[1],'base64').length,300000)
  assert.equal(canvas.width,960);assert.equal(canvas.height,540)
  assert.equal(calls.length,2)
})

test('capture refuses unavailable frames, unsupported encoding and photos that cannot fit',() => {
  assert.throws(() => captureCameraPhoto({...frame,videoWidth:0}),/Wait for the camera/)
  assert.throws(() => captureCameraPhoto({...frame,readyState:1}),/Wait for the camera/)
  assert.throws(() => captureCameraPhoto(frame,() => ({getContext:() => null})),/could not capture/)
  const unsupported = canvasFixture(() => 'data:image/png;base64,AAAA')
  assert.throws(() => captureCameraPhoto(frame,() => unsupported.canvas),/JPEG/)
  const large = canvasFixture(() => jpeg(MAX_PHOTO_BYTES + 1))
  assert.throws(() => captureCameraPhoto(frame,() => large.canvas),/too large/)
  assert.equal(large.calls.length,8)
})

test('closing a camera stops all tracks and removes disconnection listeners',() => {
  const tracks = [0,1].map(() => ({onended(){},stopped:false,stop(){this.stopped=true}}))
  stopCamera({getTracks:() => tracks})
  assert.ok(tracks.every(track => track.stopped && track.onended === null))
  assert.doesNotThrow(() => stopCamera(null))
})

test('camera errors tell the user how to recover without exposing raw device errors',() => {
  assert.match(cameraErrorMessage({name:'NotAllowedError'}),/permission was denied/)
  assert.match(cameraErrorMessage({name:'NotFoundError'}),/No camera/)
  assert.match(cameraErrorMessage({name:'NotReadableError'}),/Close other apps/)
  assert.match(cameraErrorMessage({name:'OverconstrainedError'}),/another camera/)
  assert.doesNotMatch(cameraErrorMessage({message:'private device diagnostics'}),/private device/)
})
