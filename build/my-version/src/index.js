/* TVPCamera — façade: build a track, evaluate, render helper for the canvas demo (SPEC §5). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./cameraTrack.js')); }
  else { root.TVPCamera = factory(root.TVPCameraTrack); }
})(this, function (T) {
  class Camera {
    constructor(opts) { this.track = new T.CameraTrack(opts); }
    addPositionKey(frame, x, y) { return this.track.setKey(frame, 'position', { x, y: y === undefined ? (this.track.cameraHeight / 2) : y });}
    addRotationKey(frame, degrees) { return this.track.setKey(frame, 'rotation', { rotation: degrees }); }
    addZoomKey(frame, zoom) { return this.track.setKey(frame, 'zoom', { zoom }); }
    removeKey(frame) { return this.track.removeKey(frame); }
    atFrame(frame) { return this.track.evaluate(frame); }
    atSceneT(t) { return this.track.evaluate(Math.round(this.track.startFrame + this.track.progressAtSceneTime(t) * (this.track.endFrame - this.track.startFrame))); }
  }
  return Camera;
});
