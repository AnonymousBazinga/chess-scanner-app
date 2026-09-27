import SwiftUI
import CoreML

@MainActor
class BoardRecognitionService: ObservableObject {
    @Published var isProcessing = false
    @Published var detectedFEN: String?
    @Published var error: String?

    private var processingTask: Task<Void, Never>?
    private let recognizer: BoardRecognizer?

    init() {
        do {
            recognizer = try BoardRecognizer()
        } catch {
            print("Failed to load FenifyChessRecognizer model: \(error)")
            recognizer = nil
        }
    }

    /// Recognizes the board in `image`. `cropToGuide` crops to the camera's
    /// on-screen board guide; gallery images are used whole, as fenify expects.
    func processImage(_ image: UIImage, cropToGuide: Bool = false) {
        processingTask?.cancel()
        isProcessing = true
        detectedFEN = nil
        error = nil

        let recognizer = recognizer
        processingTask = Task {
            do {
                guard let recognizer else { throw RecognitionError.modelNotLoaded }
                let fen = try await Task.detached(priority: .userInitiated) {
                    try recognizer.recognize(image, cropToGuide: cropToGuide)
                }.value
                guard !Task.isCancelled else { return }
                self.detectedFEN = fen
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

/// Runs the fenify-3D Core ML model. Preprocessing mirrors fenify's reference
/// `BoardPredictor`: resize to 400x400, RGB, ImageNet normalization.
final class BoardRecognizer: @unchecked Sendable {
    static let inputSize = 400
    /// Fraction of the photo's shorter side covered by the camera board guide.
    static let guideFraction: CGFloat = 0.8

    private let model: MLModel

    init() throws {
        let config = MLModelConfiguration()
        config.computeUnits = .all
        model = try FenifyChessRecognizer(configuration: config).model
    }

    func recognize(_ image: UIImage, cropToGuide: Bool) throws -> String {
        guard var cgImage = Self.uprightCGImage(image) else {
            throw RecognitionError.invalidImage
        }
        if cropToGuide {
            cgImage = try Self.centerSquareCrop(cgImage, fraction: Self.guideFraction)
        }
        let input = try Self.preprocess(cgImage)
        let output = try runInference(input)
        return Self.decode(output)
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

    static func centerSquareCrop(_ image: CGImage, fraction: CGFloat) throws -> CGImage {
        let side = CGFloat(min(image.width, image.height)) * fraction
        let rect = CGRect(x: (CGFloat(image.width) - side) / 2,
                          y: (CGFloat(image.height) - side) / 2,
                          width: side, height: side).integral
        guard let cropped = image.cropping(to: rect) else {
            throw RecognitionError.preprocessingFailed
        }
        return cropped
    }

    /// Returns a [1, 3, 400, 400] float32 tensor (CHW, ImageNet-normalized RGB).
    static func preprocess(_ image: CGImage) throws -> MLMultiArray {
        let size = inputSize
        guard let context = CGContext(
            data: nil,
            width: size,
            height: size,
            bitsPerComponent: 8,
            bytesPerRow: size * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else {
            throw RecognitionError.preprocessingFailed
        }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))

        guard let pixelData = context.data else {
            throw RecognitionError.preprocessingFailed
        }
        let pixels = pixelData.bindMemory(to: UInt8.self, capacity: size * size * 4)

        let array = try MLMultiArray(shape: [1, 3, NSNumber(value: size), NSNumber(value: size)],
                                     dataType: .float32)
        let out = array.dataPointer.bindMemory(to: Float.self, capacity: 3 * size * size)
        let mean: [Float] = [0.485, 0.456, 0.406]
        let std: [Float] = [0.229, 0.224, 0.225]
        let plane = size * size

        for i in 0..<plane {
            for c in 0..<3 {
                let value = Float(pixels[i * 4 + c]) / 255.0
                out[c * plane + i] = (value - mean[c]) / std[c]
            }
        }
        return array
    }

    // MARK: Inference

    private func runInference(_ input: MLMultiArray) throws -> MLMultiArray {
        let provider = try MLDictionaryFeatureProvider(
            dictionary: ["input_image": MLFeatureValue(multiArray: input)]
        )
        let result = try model.prediction(from: provider)
        guard let output = result.featureValue(for: "output")?.multiArrayValue else {
            throw RecognitionError.inferenceFailed
        }
        return output
    }

    // MARK: Decoding

    /// Decodes the (1, 64, 13) probabilities. Square index is rank * 8 + file
    /// (a1 = 0); classes are 0 = empty, 1-6 = PNBRQK, 7-12 = pnbrqk.
    static func decode(_ output: MLMultiArray) -> String {
        let pieceChars: [Character] = [".", "P", "N", "B", "R", "Q", "K",
                                       "p", "n", "b", "r", "q", "k"]
        let strides = output.strides.map(\.intValue)
        let squareStride = strides[strides.count - 2]
        let classStride = strides[strides.count - 1]

        var board = Array(repeating: Array(repeating: Character("."), count: 8), count: 8)
        for square in 0..<64 {
            var best = 0
            var bestScore = -Double.infinity
            for cls in 0..<13 {
                let score = output[square * squareStride + cls * classStride].doubleValue
                if score > bestScore {
                    bestScore = score
                    best = cls
                }
            }
            board[square / 8][square % 8] = pieceChars[best]
        }
        return boardToFEN(board)
    }

    static func boardToFEN(_ board: [[Character]]) -> String {
        var fen = ""
        for rank in stride(from: 7, through: 0, by: -1) {
            var empty = 0
            for file in 0..<8 {
                let c = board[rank][file]
                if c == "." {
                    empty += 1
                } else {
                    if empty > 0 {
                        fen += "\(empty)"
                        empty = 0
                    }
                    fen += String(c)
                }
            }
            if empty > 0 { fen += "\(empty)" }
            if rank > 0 { fen += "/" }
        }
        return fen + " w \(castlingRights(board)) - 0 1"
    }

    /// Only grant castling rights whose king and rook are on their home squares,
    /// so the engine never sees an impossible castle.
    static func castlingRights(_ board: [[Character]]) -> String {
        var rights = ""
        if board[0][4] == "K" {
            if board[0][7] == "R" { rights += "K" }
            if board[0][0] == "R" { rights += "Q" }
        }
        if board[7][4] == "k" {
            if board[7][7] == "r" { rights += "k" }
            if board[7][0] == "r" { rights += "q" }
        }
        return rights.isEmpty ? "-" : rights
    }
}

// MARK: - Errors

enum RecognitionError: LocalizedError {
    case invalidImage
    case modelNotLoaded
    case preprocessingFailed
    case inferenceFailed

    var errorDescription: String? {
        switch self {
        case .invalidImage: return "Invalid image format"
        case .modelNotLoaded: return "Chess recognition model failed to load"
        case .preprocessingFailed: return "Failed to preprocess the image"
        case .inferenceFailed: return "Model inference failed"
        }
    }
}
