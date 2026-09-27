import Foundation
import ChessKitEngine

// MARK: - Engine Line

struct EngineLine: Identifiable {
    let id: Int
    var score: Int
    var mate: Int?
    var depth: Int
    var pv: [String]
    var pvString: String
    var nodes: Int

    var scoreText: String {
        if let m = mate {
            return m > 0 ? "M\(m)" : "-M\(abs(m))"
        }
        let pawns = Double(score) / 100.0
        return String(format: "%+.1f", pawns)
    }

    var scoreForBar: Double {
        if let m = mate {
            return m > 0 ? 10.0 : -10.0
        }
        return max(-10.0, min(10.0, Double(score) / 100.0))
    }
}

// MARK: - Chess Engine (Stockfish Wrapper)

@MainActor
class ChessEngine: ObservableObject {
    @Published var isAnalyzing = false
    @Published var currentDepth: Int = 0
    @Published var lines: [EngineLine] = []
    @Published var nodesSearched: Int = 0
    @Published var engineReady = false
    @Published var nps: Int = 0

    let multiPV: Int

    private var engine: Engine?
    private var responseTask: Task<Void, Never>?
    private var currentPosition: Position?
    private var pendingLines: [Int: EngineLine] = [:]

    init(multiPV: Int = 3) {
        self.multiPV = multiPV
    }

    // MARK: - Engine Lifecycle

    /// Stockfish 17 networks, bundled by `scripts/fetch_nnue.sh`.
    static let evalFile = "nn-1111cefa1111"
    static let evalFileSmall = "nn-37f18f62d772"

    @Published var setupError: String?
    private var setupTask: Task<Engine?, Never>?

    /// Starts Stockfish once and waits for its UCI handshake; `Engine.send`
    /// silently drops commands until the engine reports it is running.
    private func readyEngine() async -> Engine? {
        if let setupTask { return await setupTask.value }
        let task = Task { () -> Engine? in
            guard let big = Bundle.main.url(forResource: Self.evalFile, withExtension: "nnue"),
                  let small = Bundle.main.url(forResource: Self.evalFileSmall, withExtension: "nnue") else {
                // Without its networks Stockfish 17 exits the whole process on `go`.
                setupError = "Stockfish network files are missing from the app bundle"
                return nil
            }

            let sfEngine = Engine(type: .stockfish)
            await sfEngine.start(coreCount: ProcessInfo.processInfo.activeProcessorCount, multipv: multiPV)
            if let stream = await sfEngine.responseStream {
                responseTask = Task { [weak self] in
                    for await response in stream {
                        self?.handleResponse(response)
                    }
                }
            }

            for _ in 0..<200 {
                if await sfEngine.isRunning { break }
                try? await Task.sleep(for: .milliseconds(25))
            }
            guard await sfEngine.isRunning else {
                setupError = "Stockfish failed to start"
                return nil
            }

            await sfEngine.send(command: .setoption(id: "EvalFile", value: big.path))
            await sfEngine.send(command: .setoption(id: "EvalFileSmall", value: small.path))
            engine = sfEngine
            engineReady = true
            return sfEngine
        }
        setupTask = task
        return await task.value
    }

    func initialize() async {
        _ = await readyEngine()
    }

    func shutdown() async {
        responseTask?.cancel()
        responseTask = nil
        setupTask = nil
        await engine?.stop()
        engine = nil
        engineReady = false
    }

    // MARK: - Analysis Control

    func startAnalysis(position: Position) {
        currentPosition = position
        pendingLines = [:]
        lines = []
        currentDepth = 0
        nodesSearched = 0
        nps = 0

        Task {
            guard let engine = await readyEngine() else { return }

            // The stopped search still reports its final info and bestmove;
            // drop those so they don't mix into the new position's lines.
            discardUntilBestmove = isAnalyzing
            await engine.send(command: .stop)
            await engine.send(command: .position(.fen(position.fen)))
            await engine.send(command: .go(infinite: true))
            isAnalyzing = true
        }
    }

    func stopAnalysis() {
        Task {
            guard let engine = engine else { return }
            await engine.send(command: .stop)
            isAnalyzing = false
        }
    }

    // MARK: - Response Handling

    private var discardUntilBestmove = false

    private func handleResponse(_ response: EngineResponse) {
        if discardUntilBestmove {
            if case .bestmove = response { discardUntilBestmove = false }
            return
        }
        switch response {
        case .readyok:
            engineReady = true

        case let .info(info):
            processInfo(info)

        case .bestmove:
            isAnalyzing = false

        default:
            break
        }
    }

    private func processInfo(_ info: EngineResponse.Info) {
        guard let depth = info.depth else { return }

        // Update nodes
        if let n = info.nodes {
            nodesSearched = n
        }
        if let n = info.nps {
            nps = n
        }

        // Only process lines with a PV
        guard let pvMoves = info.pv, !pvMoves.isEmpty else { return }

        let pvIndex = info.multipv ?? 1

        // Calculate score from engine's perspective (engine reports from side-to-move perspective)
        var scoreCp: Int = 0
        var mateIn: Int? = nil

        if let score = info.score {
            if let cp = score.cp {
                // Convert from side-to-move perspective to white's perspective
                scoreCp = currentPosition?.sideToMove == .black ? -Int(cp) : Int(cp)
            }
            if let mate = score.mate {
                mateIn = currentPosition?.sideToMove == .black ? -mate : mate
            }
        }

        // Convert UCI PV to SAN
        let sanString: String
        if let pos = currentPosition {
            sanString = pos.uciSequenceToSAN(pvMoves)
        } else {
            sanString = pvMoves.joined(separator: " ")
        }

        let line = EngineLine(
            id: pvIndex,
            score: scoreCp,
            mate: mateIn,
            depth: depth,
            pv: pvMoves,
            pvString: sanString,
            nodes: nodesSearched
        )

        pendingLines[pvIndex] = line

        // Update current depth
        if depth > currentDepth {
            currentDepth = depth
        }

        // Publish all lines for the current depth
        let sortedLines = pendingLines.values
            .sorted { a, b in
                if a.mate != nil || b.mate != nil {
                    if let am = a.mate, let bm = b.mate {
                        if am > 0 && bm > 0 { return am < bm }
                        if am < 0 && bm < 0 { return am > bm }
                        return am > bm
                    }
                    if a.mate != nil { return a.mate! > 0 }
                    return b.mate! < 0
                }
                return a.score > b.score
            }

        lines = sortedLines
    }

    // MARK: - Quick Eval

    var evalScore: Double {
        if let first = lines.first {
            return first.scoreForBar
        }
        return 0.0
    }
}
