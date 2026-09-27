import SwiftUI
import CoreML
import CoreImage
import CoreImage.CIFilterBuiltins

@MainActor
class BoardRecognitionService: ObservableObject {
    @Published var isProcessing = false
    @Published var detectedFEN: String?
    @Published var error: String?

    private var processingTask: Task<Void, Never>?
    private var model: MLModel?

    init() {
        loadModel()
    }

    private func loadModel() {
        do {
            let config = MLModelConfiguration()
            config.computeUnits = .all
            let compiled = try FenifyChessRecognizer(configuration: config)
            model = compiled.model
            
            // Debug: Print model input/output specifications
            if let modelDesc = model?.modelDescription {
                print("=== FenifyChessRecognizer Model Info ===")
                print("Inputs:")
                for (name, desc) in modelDesc.inputDescriptionsByName {
                    print("  - \(name): \(desc)")
                    if let constraint = desc.multiArrayConstraint {
                        print("    Shape: \(constraint.shape)")
                        print("    DataType: \(constraint.dataType.rawValue)")
                    }
                }
                print("Outputs:")
                for (name, desc) in modelDesc.outputDescriptionsByName {
                    print("  - \(name): \(desc)")
                    if let constraint = desc.multiArrayConstraint {
                        print("    Shape: \(constraint.shape)")
                    }
                }
            }
        } catch {
            print("Failed to load FenifyChessRecognizer model: \(error)")
        }
    }

    func processImage(_ image: UIImage) {
        isProcessing = true
        detectedFEN = nil
        error = nil

        processingTask = Task {
            do {
                let fen = try await analyzeBoard(image: image)
                self.detectedFEN = fen
                self.isProcessing = false
            } catch {
                self.error = error.localizedDescription
                self.isProcessing = false
            }
        }
    }

    func cancel() {
        processingTask?.cancel()
        isProcessing = false
    }

    // MARK: - Board Analysis Pipeline

    private func analyzeBoard(image: UIImage) async throws -> String {
        guard let cgImage = image.cgImage else {
            throw RecognitionError.invalidImage
        }

        guard let model = model else {
            throw RecognitionError.modelNotLoaded
        }

        // Step 1: Preprocess the image (resize to 400x400, normalize with ImageNet stats)
        let inputArray = try preprocessImage(cgImage)

        // Step 2: Run CoreML inference
        let outputArray = try runInference(model: model, input: inputArray)

        // Step 3: Decode model output to FEN
        let fen = decodePrediction(output: outputArray)

        return fen
    }

    // MARK: - Image Preprocessing

    private func preprocessImage(_ cgImage: CGImage) throws -> MLMultiArray {
        // Fenify expects 300x300 input (NOT 400x400)
        let targetSize = 300
        guard let context = CGContext(
            data: nil,
            width: targetSize,
            height: targetSize,
            bitsPerComponent: 8,
            bytesPerRow: targetSize * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw RecognitionError.preprocessingFailed
        }

        context.interpolationQuality = .high
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: targetSize, height: targetSize))

        guard let pixelData = context.data else {
            throw RecognitionError.preprocessingFailed
        }

        let data = pixelData.bindMemory(to: UInt8.self, capacity: targetSize * targetSize * 4)

        // Create MLMultiArray with shape [1, 3, 300, 300] (batch, channels, height, width)
        let shape: [NSNumber] = [1, 3, NSNumber(value: targetSize), NSNumber(value: targetSize)]
        let inputArray = try MLMultiArray(shape: shape, dataType: .float32)

        // ImageNet normalization constants
        let mean: [Float] = [0.485, 0.456, 0.406]
        let std: [Float] = [0.229, 0.224, 0.225]

        // Fill the array: convert RGBA pixels to normalized CHW float tensor
        // Fenify converts to grayscale first, then to 3-channel
        for y in 0..<targetSize {
            for x in 0..<targetSize {
                let pixelOffset = (y * targetSize + x) * 4
                let r = Float(data[pixelOffset]) / 255.0
                let g = Float(data[pixelOffset + 1]) / 255.0
                let b = Float(data[pixelOffset + 2]) / 255.0
                
                // Convert to grayscale (same as torchvision.transforms.Grayscale)
                // Uses ITU-R BT.601 luma coefficients: 0.299*R + 0.587*G + 0.114*B
                let gray = 0.299 * r + 0.587 * g + 0.114 * b

                // Channel-first layout: [batch, channel, height, width]
                // All 3 channels get the same grayscale value (Grayscale(num_output_channels=3))
                let rIdx = 0 * targetSize * targetSize + y * targetSize + x
                let gIdx = 1 * targetSize * targetSize + y * targetSize + x
                let bIdx = 2 * targetSize * targetSize + y * targetSize + x

                // Apply ImageNet normalization to the grayscale value
                inputArray[rIdx] = NSNumber(value: (gray - mean[0]) / std[0])
                inputArray[gIdx] = NSNumber(value: (gray - mean[1]) / std[1])
                inputArray[bIdx] = NSNumber(value: (gray - mean[2]) / std[2])
            }
        }

        return inputArray
    }

    // MARK: - CoreML Inference

    private func runInference(model: MLModel, input: MLMultiArray) throws -> MLMultiArray {
        // Get the actual input name from the model description
        guard let inputName = model.modelDescription.inputDescriptionsByName.keys.first else {
            throw RecognitionError.inferenceFailed
        }
        
        print("Using input name: \(inputName)")
        
        let provider = try MLDictionaryFeatureProvider(
            dictionary: [inputName: MLFeatureValue(multiArray: input)]
        )

        let result = try model.prediction(from: provider)
        
        // Get the actual output name from the model description
        guard let outputName = model.modelDescription.outputDescriptionsByName.keys.first,
              let output = result.featureValue(for: outputName)?.multiArrayValue else {
            // Try common output names as fallback
            for name in ["output", "var_1213", "logits", "predictions"] {
                if let output = result.featureValue(for: name)?.multiArrayValue {
                    print("Using output name: \(name)")
                    return output
                }
            }
            throw RecognitionError.inferenceFailed
        }
        
        print("Using output name: \(outputName)")
        return output
    }

    // MARK: - Decode Prediction to FEN

    private func decodePrediction(output: MLMultiArray) -> String {
        // Fenify output: 64 squares x 13 classes
        // Classes: 0=empty, 1=P, 2=N, 3=B, 4=R, 5=Q, 6=K, 7=p, 8=n, 9=b, 10=r, 11=q, 12=k

        let shape = output.shape.map { $0.intValue }
        let strides = output.strides.map { $0.intValue }
        print("=== Model Output ===")
        print("Shape: \(shape), Strides: \(strides), Count: \(output.count)")

        let pieceChars: [Character] = [
            ".", "P", "N", "B", "R", "Q", "K",
            "p", "n", "b", "r", "q", "k"
        ]

        // Determine which axis is squares (64) and which is classes (13)
        // Common shapes: [64, 13], [1, 64, 13], [13, 64], [1, 13, 64]
        var numSquares = 64
        var numClasses = 13
        var squaresFirst = true  // [.., 64, 13] vs [.., 13, 64]

        let dims = shape.filter { $0 > 1 }  // ignore batch dim of 1
        if dims.count >= 2 {
            let last = dims[dims.count - 1]
            let secondLast = dims[dims.count - 2]
            if last == 64 && secondLast == 13 {
                squaresFirst = false
                numSquares = 64
                numClasses = 13
                print("Detected layout: [13, 64] (classes-first)")
            } else if last == 13 && secondLast == 64 {
                squaresFirst = true
                numSquares = 64
                numClasses = 13
                print("Detected layout: [64, 13] (squares-first)")
            } else {
                print("Warning: unexpected dims \(dims), assuming [64, 13]")
            }
        }

        let ptr = output.dataPointer.bindMemory(to: Float.self, capacity: output.count)

        var board: [[Character]] = Array(repeating: Array(repeating: ".", count: 8), count: 8)

        for squareIdx in 0..<numSquares {
            let rank = squareIdx / 8
            let file = squareIdx % 8

            var bestClass = 0
            var bestScore: Float = -Float.infinity

            for classIdx in 0..<numClasses {
                // Use strides to compute the correct flat offset
                let flatIdx: Int
                if squaresFirst {
                    // Shape ends with [..., 64, 13]
                    flatIdx = squareIdx * strides[strides.count - 2] + classIdx * strides[strides.count - 1]
                } else {
                    // Shape ends with [..., 13, 64]
                    flatIdx = classIdx * strides[strides.count - 2] + squareIdx * strides[strides.count - 1]
                }

                let score = ptr[flatIdx]
                if score > bestScore {
                    bestScore = score
                    bestClass = classIdx
                }
            }

            board[rank][file] = pieceChars[min(bestClass, pieceChars.count - 1)]
        }

        // Debug: print decoded board
        print("Decoded board:")
        for rank in stride(from: 7, through: 0, by: -1) {
            print("  \(rank + 1): \(String(board[rank]))")
        }

        return boardToFEN(board)
    }

    // MARK: - Board to FEN

    private func boardToFEN(_ board: [[Character]]) -> String {
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
        fen += " w KQkq - 0 1"
        return fen
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
