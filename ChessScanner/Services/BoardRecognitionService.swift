import SwiftUI
import OnnxRuntimeBindings

/// What the recognizer read from a photo.
struct RecognitionResult: Sendable {
    let fen: String
}

@MainActor
class BoardRecognitionService: ObservableObject {
    @Published var isProcessing = false
    @Published var result: RecognitionResult?
    @Published var error: String?

    var detectedFEN: String? { result?.fen }

    private var processingTask: Task<Void, Never>?
    private let recognizer: BoardRecognizer?
    private let loadError: String?

    init() {
        do {
            recognizer = try BoardRecognizer()
            loadError = nil
        } catch {
            recognizer = nil
            loadError = error.localizedDescription
        }
    }

    /// Recognizes the board in `image`. `cropToGuide` crops camera shots to the
    /// on-screen square frame; gallery photos are used whole.
    func processImage(_ image: UIImage, cropToGuide: Bool = false) {
        processingTask?.cancel()
        isProcessing = true
        result = nil
        error = nil

        let recognizer = recognizer
        let loadError = loadError
        processingTask = Task {
            do {
                guard let recognizer else {
                    throw RecognitionError.modelNotLoaded(loadError ?? "unknown error")
                }
                let output = try await Task.detached(priority: .userInitiated) {
                    try recognizer.recognize(image, cropToGuide: cropToGuide)
                }.value
                guard !Task.isCancelled else { return }
                self.result = output
            } catch {
                guard !Task.isCancelled else { return }
                self.error = error.localizedDescription
            }
            self.isProcessing = false
        }
    }

    func cancel() {
        processingTask?.cancel()
        isProcessing = false
    }
}

// MARK: - Recognizer

/// Runs ChessQueries Lite (Seytre 2026, ViT-S/14, int8 ONNX) with ONNX Runtime.
///
/// Input contract, from the model's evaluation transform: plain (non-aspect-preserving)
/// resize of the whole photo to 644x644, RGB scaled to [0, 1], ImageNet mean/std, CHW.
/// Output: [1, 64, 13] logits, squares in FEN order (a8...h8, ..., a1...h1), classes
/// ".PNBRQKpnbrqk". No board detection or cropping is needed.
///
/// License: the model weights are PolyForm Noncommercial 1.0.0.
final class BoardRecognizer: @unchecked Sendable {
    static let modelName = "chessquerieslite-vits-644-int8"
    static let inputSize = 644
    static let pieces = Array(".PNBRQKpnbrqk")
    /// Below this mean confidence the photo most likely has no readable board. Every
    /// real board in the CVChess benchmark scored at least 0.975.
    ///
    /// Per-square confidence is not used to flag doubtful squares: on CVChess even a
    /// 0.999 cut-off caught only half the errors, with most flags on correct squares.
    static let minimumBoardConfidence: Float = 0.5

    private let session: ORTSession
    private let inputName: String
    private let outputName: String

    init() throws {
        guard let path = Bundle.main.path(forResource: Self.modelName, ofType: "onnx") else {
            throw RecognitionError.modelNotLoaded("\(Self.modelName).onnx is missing from the app bundle; run scripts/fetch_models.sh")
        }
        let env = try ORTEnv(loggingLevel: .warning)
        let options = try ORTSessionOptions()
        try options.setGraphOptimizationLevel(.all)
        try options.setIntraOpNumThreads(Int32(max(1, min(4, ProcessInfo.processInfo.activeProcessorCount))))
        session = try ORTSession(env: env, modelPath: path, sessionOptions: options)
        guard let input = try session.inputNames().first, let output = try session.outputNames().first else {
            throw RecognitionError.modelNotLoaded("model has no inputs or outputs")
        }
        inputName = input
        outputName = output
    }

    func recognize(_ image: UIImage, cropToGuide: Bool) throws -> RecognitionResult {
        guard var cgImage = Self.uprightCGImage(image) else {
            throw RecognitionError.invalidImage
        }
        if cropToGuide {
            cgImage = try Self.centerSquareCrop(cgImage)
        }
        let tensor = try Self.preprocess(cgImage)
        let value = try ORTValue(tensorData: tensor, elementType: .float,
                                 shape: [1, 3, NSNumber(value: Self.inputSize), NSNumber(value: Self.inputSize)])
        let outputs = try session.run(withInputs: [inputName: value], outputNames: [outputName], runOptions: nil)
        guard let logits = try outputs[outputName]?.tensorData() else {
            throw RecognitionError.inferenceFailed
        }
        return try Self.decode(logits as Data)
    }

    // MARK: Image preparation

    /// `UIImage.cgImage` ignores `imageOrientation`, so camera photos would reach
    /// the model rotated. Redraw upright first.
    static func uprightCGImage(_ image: UIImage) -> CGImage? {
        if image.imageOrientation == .up, let cg = image.cgImage { return cg }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let pixelSize = CGSize(width: image.size.width * image.scale,
                               height: image.size.height * image.scale)
        let renderer = UIGraphicsImageRenderer(size: pixelSize, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: pixelSize))
        }.cgImage
    }

    /// Camera shots are 4:3; the viewfinder frame is the centered square, and a
    /// square crop avoids squashing the board when resizing to 644x644.
    static func centerSquareCrop(_ image: CGImage) throws -> CGImage {
        let side = min(image.width, image.height)
        let rect = CGRect(x: (image.width - side) / 2, y: (image.height - side) / 2, width: side, height: side)
        guard let cropped = image.cropping(to: rect) else { throw RecognitionError.preprocessingFailed }
        return cropped
    }

    /// Returns a [1, 3, 644, 644] float32 tensor (CHW, ImageNet-normalized RGB).
    static func preprocess(_ image: CGImage) throws -> NSMutableData {
        let size = inputSize
        guard let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                                      bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue),
              let tensor = NSMutableData(length: 3 * size * size * MemoryLayout<Float>.size) else {
            throw RecognitionError.preprocessingFailed
        }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
        guard let pixelData = context.data else { throw RecognitionError.preprocessingFailed }

        let pixels = pixelData.bindMemory(to: UInt8.self, capacity: size * size * 4)
        let out = tensor.mutableBytes.bindMemory(to: Float.self, capacity: 3 * size * size)
        let mean: [Float] = [0.485, 0.456, 0.406]
        let std: [Float] = [0.229, 0.224, 0.225]
        let plane = size * size
        for i in 0..<plane {
            for c in 0..<3 {
                out[c * plane + i] = (Float(pixels[i * 4 + c]) / 255 - mean[c]) / std[c]
            }
        }
        return tensor
    }

    // MARK: Decoding

    static func decode(_ logits: Data) throws -> RecognitionResult {
        let classes = pieces.count
        guard logits.count == 64 * classes * MemoryLayout<Float>.size else {
            throw RecognitionError.inferenceFailed
        }
        var board = [Character](repeating: ".", count: 64)
        var confidenceSum: Float = 0

        logits.withUnsafeBytes { raw in
            let values = raw.bindMemory(to: Float.self)
            for square in 0..<64 {
                let row = Array(values[(square * classes)..<((square + 1) * classes)])
                let maxLogit = row.max() ?? 0
                let exps = row.map { exp($0 - maxLogit) }
                let total = exps.reduce(0, +)
                let best = exps.indices.max { exps[$0] < exps[$1] } ?? 0
                let confidence = exps[best] / total
                confidenceSum += confidence
                board[square] = pieces[best]
            }
        }

        guard confidenceSum / 64 >= minimumBoardConfidence else {
            throw RecognitionError.noBoardFound
        }
        return RecognitionResult(fen: fen(from: board))
    }

    /// Board in FEN order to a full FEN, granting only castling rights whose king
    /// and rook are on their home squares.
    static func fen(from board: [Character]) -> String {
        var ranks: [String] = []
        for r in 0..<8 {
            var row = "", empty = 0
            for c in board[(r * 8)..<(r * 8 + 8)] {
                if c == "." { empty += 1; continue }
                if empty > 0 { row += "\(empty)"; empty = 0 }
                row.append(c)
            }
            if empty > 0 { row += "\(empty)" }
            ranks.append(row)
        }
        func at(_ square: String) -> Character {
            let file = Int(square.first!.asciiValue! - 97), rank = Int(String(square.last!))!
            return board[(8 - rank) * 8 + file]
        }
        var castling = ""
        if at("e1") == "K" {
            if at("h1") == "R" { castling += "K" }
            if at("a1") == "R" { castling += "Q" }
        }
        if at("e8") == "k" {
            if at("h8") == "r" { castling += "k" }
            if at("a8") == "r" { castling += "q" }
        }
        return ranks.joined(separator: "/") + " w \(castling.isEmpty ? "-" : castling) - 0 1"
    }
}

// MARK: - Errors

enum RecognitionError: LocalizedError {
    case invalidImage
    case modelNotLoaded(String)
    case preprocessingFailed
    case inferenceFailed
    case noBoardFound

    var errorDescription: String? {
        switch self {
        case .invalidImage: return "Invalid image format"
        case .modelNotLoaded(let reason): return "Board recognition is unavailable: \(reason)"
        case .preprocessingFailed: return "Failed to prepare the image"
        case .inferenceFailed: return "Board recognition failed"
        case .noBoardFound: return "Couldn't find a chessboard. Try again with the whole board in view."
        }
    }
}
