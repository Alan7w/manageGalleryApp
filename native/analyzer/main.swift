// Sift Analyzer
// ----------------------------------------------------------------------------
// A small, long-running helper process that does the heavy per-file work with
// Apple's native frameworks, so the Electron app never has to decode photos in
// JavaScript:
//
//   • ImageIO       – reads every format macOS can (HEIC, RAW, JPEG, PNG, …),
//                     EXIF metadata, and makes thumbnails / previews
//   • Vision        – visual fingerprint (for "similar" detection), aesthetic
//                     score, face capture quality, content labels (for search)
//   • AVFoundation  – video duration, metadata and a poster frame
//   • CryptoKit     – SHA-256 content hash (for exact duplicates)
//   • FileManager   – Move to Trash, returning where the file went (for undo)
//
// Protocol: newline-delimited JSON over stdin / stdout.
//   → {"id": 7, "op": "analyze", "path": "/a/b.heic", "kind": "image", "thumb": "/cache/7.jpg", "vision": true}
//   ← {"id": 7, "ok": true, "width": 4032, ...}
//   ← {"id": 8, "ok": false, "error": "Unreadable image"}
//
// Ops: ping · analyze · sha · preview · trash
// Build: npm run build:native  (see scripts/build-native.mjs)

import AVFoundation
import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

let VERSION = 1

// MARK: - Output

let outputQueue = DispatchQueue(label: "sift.output")

func send(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: sanitize(object), options: []) else { return }
  outputQueue.sync {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
  }
}

/// JSONSerialization rejects NaN / Infinity; replace them with null.
func sanitize(_ value: Any) -> Any {
  switch value {
  case let d as Double: return d.isFinite ? d : NSNull()
  case let f as Float: return f.isFinite ? Double(f) : NSNull()
  case let dict as [String: Any]: return dict.mapValues(sanitize)
  case let arr as [Any]: return arr.map(sanitize)
  default: return value
  }
}

struct SiftError: Error, CustomStringConvertible {
  let description: String
  let code: String
  init(_ description: String, code: String = "failed") {
    self.description = description
    self.code = code
  }
}

// MARK: - Image helpers

func loadSource(_ path: String) throws -> CGImageSource {
  let url = URL(fileURLWithPath: path)
  guard let src = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
        CGImageSourceGetCount(src) > 0
  else { throw SiftError("Unreadable image") }
  return src
}

/// Decodes a down-scaled, orientation-corrected copy of the image.
func decode(_ src: CGImageSource, maxPixel: Int) throws -> CGImage {
  let opts: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceShouldCacheImmediately: true,
    kCGImageSourceThumbnailMaxPixelSize: maxPixel,
  ]
  guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else {
    throw SiftError("Could not decode image")
  }
  return img
}

func scaled(_ image: CGImage, maxPixel: Int) -> CGImage {
  let longest = max(image.width, image.height)
  if longest <= maxPixel { return image }
  let scale = Double(maxPixel) / Double(longest)
  let w = max(1, Int((Double(image.width) * scale).rounded()))
  let h = max(1, Int((Double(image.height) * scale).rounded()))
  guard let ctx = CGContext(
    data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { return image }
  ctx.interpolationQuality = .high
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  return ctx.makeImage() ?? image
}

func writeJPEG(_ image: CGImage, to path: String, quality: Double) throws {
  let url = URL(fileURLWithPath: path)
  try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  // Write to a temp file first so a half-written JPEG is never served.
  let tmp = url.appendingPathExtension("tmp")
  guard let dest = CGImageDestinationCreateWithURL(tmp as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
    throw SiftError("Could not create JPEG")
  }
  CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
  guard CGImageDestinationFinalize(dest) else { throw SiftError("Could not write JPEG") }
  _ = try? FileManager.default.removeItem(at: url)
  try FileManager.default.moveItem(at: tmp, to: url)
}

/// Renders the image into an 8-bit grayscale buffer of the given size.
func grayscale(_ image: CGImage, width: Int, height: Int) -> [UInt8] {
  var pixels = [UInt8](repeating: 0, count: width * height)
  pixels.withUnsafeMutableBytes { buf in
    guard let ctx = CGContext(
      data: buf.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else { return }
    ctx.interpolationQuality = .medium
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  }
  return pixels
}

/// 64-bit difference hash: robust to resizing / re-encoding, cheap to compare.
func dHash(_ image: CGImage) -> String {
  let px = grayscale(image, width: 9, height: 8)
  var hash: UInt64 = 0
  for y in 0..<8 {
    for x in 0..<8 {
      hash <<= 1
      if px[y * 9 + x] > px[y * 9 + x + 1] { hash |= 1 }
    }
  }
  return String(format: "%016llx", hash)
}

struct Quality {
  var sharpness: Double  // variance of Laplacian in the sharpest tile ("is anything in focus?")
  var globalSharpness: Double
  var brightness: Double  // mean luminance 0…1
  var contrast: Double  // luminance std-dev 0…1
  var clipped: Double  // fraction of pure-black or pure-white pixels
}

/// Focus + exposure metrics on a grayscale copy (longest side 1024px).
/// Sharpness is measured per tile and the best tile wins, so a portrait with a
/// blurred background still counts as sharp when the subject is in focus.
func quality(_ image: CGImage) -> Quality {
  let longest = max(image.width, image.height)
  let scale = min(1.0, 1024.0 / Double(longest))
  let w = max(3, Int(Double(image.width) * scale))
  let h = max(3, Int(Double(image.height) * scale))
  let px = grayscale(image, width: w, height: h)

  var sum = 0.0, sumSq = 0.0, clippedCount = 0
  for v in px {
    let d = Double(v)
    sum += d
    sumSq += d * d
    if v <= 4 || v >= 251 { clippedCount += 1 }
  }
  let n = Double(px.count)
  let mean = sum / n
  let std = (max(0, sumSq / n - mean * mean)).squareRoot()

  // Laplacian variance, accumulated per tile on a 4×4 grid.
  let tiles = 4
  var tSum = [Double](repeating: 0, count: tiles * tiles)
  var tSq = [Double](repeating: 0, count: tiles * tiles)
  var tCount = [Double](repeating: 0, count: tiles * tiles)
  var gSum = 0.0, gSq = 0.0, gCount = 0.0
  for y in 1..<(h - 1) {
    let ty = min(tiles - 1, y * tiles / h)
    for x in 1..<(w - 1) {
      let i = y * w + x
      let lap = Double(px[i - w]) + Double(px[i + w]) + Double(px[i - 1]) + Double(px[i + 1]) - 4 * Double(px[i])
      let t = ty * tiles + min(tiles - 1, x * tiles / w)
      tSum[t] += lap
      tSq[t] += lap * lap
      tCount[t] += 1
      gSum += lap
      gSq += lap * lap
      gCount += 1
    }
  }
  var best = 0.0
  for t in 0..<(tiles * tiles) where tCount[t] > 0 {
    let m = tSum[t] / tCount[t]
    best = max(best, tSq[t] / tCount[t] - m * m)
  }
  let gm = gCount > 0 ? gSum / gCount : 0
  let global = gCount > 0 ? gSq / gCount - gm * gm : 0

  return Quality(
    sharpness: best, globalSharpness: global, brightness: mean / 255, contrast: std / 255,
    clipped: Double(clippedCount) / n)
}

// MARK: - Vision

struct VisionResult {
  var feature: String?  // base64 of int8-quantized, L2-normalised feature print
  var labels: [[Any]] = []  // [[identifier, confidence]]
  var aesthetic: Double?
  var isUtility: Bool?
  var faceCount = 0
  var faceQuality: Double?
}

func runVision(_ image: CGImage, wantAesthetics: Bool = true) -> VisionResult {
  var result = VisionResult()
  let featureReq = VNGenerateImageFeaturePrintRequest()
  let classifyReq = VNClassifyImageRequest()
  let faceReq = VNDetectFaceCaptureQualityRequest()
  var requests: [VNRequest] = [featureReq, classifyReq, faceReq]

  var aestheticsReq: VNRequest?
  if wantAesthetics, #available(macOS 15.0, *) {
    let r = VNCalculateImageAestheticsScoresRequest()
    aestheticsReq = r
    requests.append(r)
  }

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  // Each request is independent; if one fails we still keep the others.
  for req in requests { try? handler.perform([req]) }

  if let obs = featureReq.results?.first, obs.elementType == .float {
    let count = obs.elementCount
    var floats = [Float](repeating: 0, count: count)
    _ = floats.withUnsafeMutableBytes { obs.data.copyBytes(to: $0) }
    let norm = floats.reduce(0) { $0 + $1 * $1 }.squareRoot()
    if norm > 0 {
      let bytes = floats.map { v -> Int8 in
        Int8(max(-127, min(127, (v / norm * 127).rounded())))
      }
      result.feature = bytes.withUnsafeBufferPointer { Data(buffer: $0) }.base64EncodedString()
    }
  }

  if let labels = classifyReq.results {
    result.labels = labels
      .filter { $0.confidence >= 0.12 }
      .sorted { $0.confidence > $1.confidence }
      .prefix(16)
      .map { [$0.identifier, (Double($0.confidence) * 1000).rounded() / 1000] }
  }

  if let faces = faceReq.results {
    result.faceCount = faces.count
    let qualities = faces.compactMap { $0.faceCaptureQuality }.map(Double.init)
    if !qualities.isEmpty { result.faceQuality = qualities.reduce(0, +) / Double(qualities.count) }
  }

  if #available(macOS 15.0, *), let r = aestheticsReq as? VNCalculateImageAestheticsScoresRequest,
     let obs = r.results?.first
  {
    result.aesthetic = Double(obs.overallScore)
    result.isUtility = obs.isUtility
  }
  return result
}

func put(_ v: VisionResult, into out: inout [String: Any]) {
  if let f = v.feature { out["feature"] = f }
  out["labels"] = v.labels
  if let a = v.aesthetic { out["aesthetic"] = a }
  if let u = v.isUtility { out["isUtility"] = u }
  out["faceCount"] = v.faceCount
  if let q = v.faceQuality { out["faceQuality"] = q }
}

// MARK: - Metadata

let exifDate: DateFormatter = {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.dateFormat = "yyyy:MM:dd HH:mm:ss"
  f.timeZone = TimeZone.current
  return f
}()

let exifDateWithOffset: DateFormatter = {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.dateFormat = "yyyy:MM:dd HH:mm:ssXXXXX"
  return f
}()

/// EXIF "2024:07:14 18:22:05" (+ optional offset and sub-seconds) → epoch ms.
func parseExifDate(_ raw: String?, offset: String?, subsec: String?) -> Double? {
  guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), raw.count >= 19 else { return nil }
  let base = String(raw.prefix(19))
  var date: Date?
  if let off = offset?.trimmingCharacters(in: .whitespaces), off.count == 6 {
    date = exifDateWithOffset.date(from: base + off)
  }
  if date == nil { date = exifDate.date(from: base) }
  guard var ms = date.map({ $0.timeIntervalSince1970 * 1000 }) else { return nil }
  // Burst shots share a second; sub-seconds keep them in the right order.
  if let s = subsec?.trimmingCharacters(in: .whitespaces), !s.isEmpty, let frac = Double("0." + s) {
    ms += (frac * 1000).rounded()
  }
  return ms
}

func imageMetadata(_ src: CGImageSource, into out: inout [String: Any]) {
  let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] ?? [:]
  let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
  let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
  let gps = props[kCGImagePropertyGPSDictionary] as? [CFString: Any] ?? [:]

  var w = props[kCGImagePropertyPixelWidth] as? Int ?? 0
  var h = props[kCGImagePropertyPixelHeight] as? Int ?? 0
  let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
  if orientation >= 5 { swap(&w, &h) }
  out["width"] = w
  out["height"] = h

  if let taken = parseExifDate(
    exif[kCGImagePropertyExifDateTimeOriginal] as? String,
    offset: exif[kCGImagePropertyExifOffsetTimeOriginal] as? String,
    subsec: exif[kCGImagePropertyExifSubsecTimeOriginal] as? String)
    ?? parseExifDate(exif[kCGImagePropertyExifDateTimeDigitized] as? String, offset: nil, subsec: nil)
    ?? parseExifDate(tiff[kCGImagePropertyTIFFDateTime] as? String, offset: nil, subsec: nil)
  {
    out["takenAt"] = taken
  }

  let make = (tiff[kCGImagePropertyTIFFMake] as? String ?? "").trimmingCharacters(in: .whitespaces)
  let model = (tiff[kCGImagePropertyTIFFModel] as? String ?? "").trimmingCharacters(in: .whitespaces)
  if !model.isEmpty {
    out["camera"] = model.lowercased().hasPrefix(make.lowercased()) || make.isEmpty ? model : "\(make) \(model)"
  }

  if let lat = gps[kCGImagePropertyGPSLatitude] as? Double, let lon = gps[kCGImagePropertyGPSLongitude] as? Double {
    out["lat"] = (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S" ? -lat : lat
    out["lon"] = (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W" ? -lon : lon
  }

  if let comment = exif[kCGImagePropertyExifUserComment] as? String { out["userComment"] = comment }
  out["hasCameraInfo"] = !model.isEmpty || exif[kCGImagePropertyExifExposureTime] != nil
}

// MARK: - Ops

func analyzeImage(path: String, thumbPath: String?, vision: Bool) throws -> [String: Any] {
  let src = try loadSource(path)
  var out: [String: Any] = [:]
  imageMetadata(src, into: &out)

  let working = try decode(src, maxPixel: 1024)
  if let thumbPath { try writeJPEG(scaled(working, maxPixel: 512), to: thumbPath, quality: 0.8) }

  out["dhash"] = dHash(working)
  let q = quality(working)
  out["sharpness"] = q.sharpness
  out["globalSharpness"] = q.globalSharpness
  out["brightness"] = q.brightness
  out["contrast"] = q.contrast
  out["clipped"] = q.clipped

  if vision { put(runVision(working), into: &out) }
  return out
}

/// Bridges an async AVFoundation call into this synchronous worker.
func blocking<T>(_ body: @escaping () async throws -> T) throws -> T {
  let sem = DispatchSemaphore(value: 0)
  var result: Result<T, Error>?
  Task.detached {
    do { result = .success(try await body()) } catch { result = .failure(error) }
    sem.signal()
  }
  sem.wait()
  return try result!.get()
}

/// "+41.3111+069.2797+455.000/" → (lat, lon)
func parseISO6709(_ s: String) -> (Double, Double)? {
  let pattern = #"([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)"#
  guard let re = try? NSRegularExpression(pattern: pattern),
        let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
        let latR = Range(m.range(at: 1), in: s), let lonR = Range(m.range(at: 2), in: s),
        let lat = Double(s[latR]), let lon = Double(s[lonR])
  else { return nil }
  return (lat, lon)
}

func analyzeVideo(path: String, thumbPath: String?, vision: Bool) throws -> [String: Any] {
  let asset = AVURLAsset(url: URL(fileURLWithPath: path))
  var out: [String: Any] = [:]

  let duration = try blocking { try await asset.load(.duration) }
  out["duration"] = duration.seconds

  if let track = try blocking({ try await asset.loadTracks(withMediaType: .video) }).first {
    let (size, transform) = try blocking { try await track.load(.naturalSize, .preferredTransform) }
    let rect = CGRect(origin: .zero, size: size).applying(transform)
    out["width"] = Int(abs(rect.width))
    out["height"] = Int(abs(rect.height))
  }

  let metadata = (try? blocking { try await asset.load(.metadata) }) ?? []
  if let created = try? blocking({ try await asset.load(.creationDate)?.load(.dateValue) }) {
    out["takenAt"] = created.timeIntervalSince1970 * 1000
  }
  for item in metadata {
    guard let key = item.identifier else { continue }
    if key == .quickTimeMetadataLocationISO6709 || key == .commonIdentifierLocation,
       let s = try? blocking({ try await item.load(.stringValue) }), let (lat, lon) = parseISO6709(s)
    {
      out["lat"] = lat
      out["lon"] = lon
    }
    if key == .quickTimeMetadataModel || key == .commonIdentifierModel,
       let s = try? blocking({ try await item.load(.stringValue) })
    {
      out["camera"] = s
    }
  }

  let generator = AVAssetImageGenerator(asset: asset)
  generator.appliesPreferredTrackTransform = true
  generator.maximumSize = CGSize(width: 1024, height: 1024)
  let seconds = duration.seconds.isFinite ? min(1.0, duration.seconds * 0.1) : 0
  let time = CMTime(seconds: seconds, preferredTimescale: 600)
  if let frame = try? blocking({ try await generator.image(at: time).image }) {
    if let thumbPath { try writeJPEG(scaled(frame, maxPixel: 512), to: thumbPath, quality: 0.8) }
    out["dhash"] = dHash(frame)
    let q = quality(frame)
    out["sharpness"] = q.sharpness
    out["globalSharpness"] = q.globalSharpness
    out["brightness"] = q.brightness
    out["contrast"] = q.contrast
    out["clipped"] = q.clipped
    if vision { put(runVision(frame, wantAesthetics: false), into: &out) }
  }
  return out
}

func sha256(path: String) throws -> String {
  guard let handle = FileHandle(forReadingAtPath: path) else { throw SiftError("Cannot open file") }
  defer { try? handle.close() }
  var hasher = SHA256()
  while true {
    let chunk = try autoreleasepool { try handle.read(upToCount: 4 << 20) }
    guard let chunk, !chunk.isEmpty else { break }
    hasher.update(data: chunk)
  }
  return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

func preview(path: String, kind: String, out: String, maxPixel: Int) throws -> [String: Any] {
  let image: CGImage
  if kind == "video" {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: URL(fileURLWithPath: path)))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: maxPixel, height: maxPixel)
    image = try blocking { try await generator.image(at: .zero).image }
  } else {
    image = try decode(try loadSource(path), maxPixel: maxPixel)
  }
  try writeJPEG(image, to: out, quality: 0.9)
  return ["width": image.width, "height": image.height]
}

func trash(path: String) throws -> [String: Any] {
  var resulting: NSURL?
  do {
    try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: &resulting)
  } catch {
    let ns = error as NSError
    let unsupported = ns.domain == NSCocoaErrorDomain && ns.code == NSFeatureUnsupportedError
    throw SiftError(ns.localizedDescription, code: unsupported ? "noTrash" : "failed")
  }
  return ["trashedPath": resulting?.path ?? NSNull()]
}

func capabilities() -> [String: Any] {
  var aesthetics = false
  if #available(macOS 15.0, *) { aesthetics = true }
  return ["version": VERSION, "aesthetics": aesthetics, "workers": workerCount]
}

// MARK: - Main loop

func handle(_ req: [String: Any]) {
  guard let id = req["id"] else { return }
  let op = req["op"] as? String ?? ""
  let path = req["path"] as? String ?? ""
  do {
    var body: [String: Any]
    switch op {
    case "ping":
      body = capabilities()
    case "analyze":
      let thumb = req["thumb"] as? String
      let vision = req["vision"] as? Bool ?? true
      body = (req["kind"] as? String) == "video"
        ? try analyzeVideo(path: path, thumbPath: thumb, vision: vision)
        : try analyzeImage(path: path, thumbPath: thumb, vision: vision)
    case "sha":
      body = ["sha": try sha256(path: path)]
    case "preview":
      guard let out = req["out"] as? String else { throw SiftError("Missing 'out'") }
      body = try preview(
        path: path, kind: req["kind"] as? String ?? "image", out: out, maxPixel: req["max"] as? Int ?? 2560)
    case "trash":
      body = try trash(path: path)
    default:
      throw SiftError("Unknown op '\(op)'")
    }
    body["id"] = id
    body["ok"] = true
    send(body)
  } catch let e as SiftError {
    send(["id": id, "ok": false, "error": e.description, "code": e.code])
  } catch {
    send(["id": id, "ok": false, "error": error.localizedDescription, "code": "failed"])
  }
}

let workerCount: Int = {
  if let env = ProcessInfo.processInfo.environment["SIFT_WORKERS"], let n = Int(env), n > 0 { return n }
  return max(2, ProcessInfo.processInfo.activeProcessorCount - 2)
}()

let slots = DispatchSemaphore(value: workerCount)
let group = DispatchGroup()
let workQueue = DispatchQueue(label: "sift.work", qos: .userInitiated, attributes: .concurrent)

while let line = readLine(strippingNewline: true) {
  guard !line.isEmpty,
        let data = line.data(using: .utf8),
        let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  else { continue }
  slots.wait()
  group.enter()
  workQueue.async {
    autoreleasepool { handle(req) }
    slots.signal()
    group.leave()
  }
}
// stdin closed (the app quit): finish in-flight work, then exit.
group.wait()
