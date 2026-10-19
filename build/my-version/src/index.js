/* TVPCamera — façade v2: size keys + camera path + corners (SPEC §1–§5). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./cameraTrack.js')); }
  else { root.TVPCamera = factory(root.TVPCameraTrack); }
})(this, function (T) {
  class Camera {
    constructor(opts) { this.track = new T.CameraTrack(opts); }
    addSizeKey(frame, width, height) {
      return this.track.setKey(frame, 'size', { width, height: height === undefined ? this.track.cameraHeight : height });
    }
    addRotationKey(frame, degrees) { return this.track.setKey(frame, 'rotation', { rotation: degrees }); }
    addZoomKey(frame, zoom) { return this.track.setKey(frame, 'zoom', { zoom }); }
    addPathPoint(frame, x, y) { return this.track.setPathPoint(frame, x, y); }
    removePathPoint(frame) { return this.track.removePathPoint(frame); }
    removeKey(frame) { return this.track.removeKey(frame); }
    atFrame(frame) { return this.track.evaluate(frame); }
    corners(frame) { return this.track.corners(frame); }
    infoFrame(frame) { return this.track.infoFrame(frame); }
    atSceneT(t) {
      return this.track.evaluate(this.track.frameAtProgress(this.track.progressAtSceneTime(t)));
    }
  }
  return Camera;
});
