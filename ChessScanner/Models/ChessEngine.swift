import Foundation
import ChessKitEngine

// MARK: - Engine Line

struct EngineLine: Identifiable {
    let id: Int
    var score: Int
    var mate: Int?
    var depth: Int
    var pv: [String]
    /// The principal variation in SAN, one entry per ply.
    var pvSAN: [String]
    var nodes: Int
    /// Move number and side of the position the line starts from, for numbering.
    var startMoveNumber = 1
    var startsWithBlack = false

    /// "1. e4 e5 2. Nf3" style text, as on Chess.com and Lichess.
    var numberedLine: String {
        var parts: [String] = []
        var number = startMoveNumber
        for (i, san) in pvSAN.enumerated() {
            let blackMove = startsWithBlack ? i % 2 == 0 : i % 2 == 1
            if !blackMove {
                parts.append("\(number). \(san)")
            } else {
                parts.append(i == 0 ? "\(number)... \(san)" : san)
                number += 1
            }
        }
        return parts.joined(separator: " ")
    }

    var scoreText: String {
        if let m = mate {
            return m > 0 ? "M\(m)" : "-M\(abs(m))"
        }
        let pawns = Double(score) / 100.0
        return String(format: "%+.1f", pawns)
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

    /// ChessKitEngine redirects the process's stdin/stdout to talk to Stockfish,
    /// so only one engine may exist, and it must never be stopped: after `stop()`
    /// closes the pipes, any later stdout write raises SIGPIPE and kills the app.
    static let shared = ChessEngine(multiPV: 3)

    private init(multiPV: Int = 3) {
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

    // MARK: - Analysis Control

    /// Commands are chained so rapid moves can't interleave stop/position/go.
    private var commandChain: Task<Void, Never>?
    /// The screen that started the current search; only it may pause it.
    private var owner: ObjectIdentifier?

    func startAnalysis(position: Position, owner: AnyObject? = nil) {
        self.owner = owner.map(ObjectIdentifier.init)
        currentPosition = position
        pendingLines = [:]
        lines = []
        currentDepth = 0
        nodesSearched = 0
        nps = 0
        isAnalyzing = true

        let fen = position.fen
        let previous = commandChain
        commandChain = Task {
            await previous?.value
            guard let engine = await readyEngine() else {
                isAnalyzing = false
                return
            }
            // Stockfish finishes the previous search before starting this `go`.
            await engine.send(command: .stop)
            await engine.send(command: .position(.fen(fen)))
            await engine.send(command: .go(infinite: true))
        }
    }

    func stopAnalysis(owner: AnyObject? = nil) {
        if let owner, self.owner != ObjectIdentifier(owner) { return }
        isAnalyzing = false
        let previous = commandChain
        commandChain = Task {
            await previous?.value
            await engine?.send(command: .stop)
        }
    }

    // MARK: - Response Handling

    private func handleResponse(_ response: EngineResponse) {
        switch response {
        case .readyok:
            engineReady = true

        case let .info(info):
            processInfo(info)

        case let .bestmove(move, _):
            // A superseded search's bestmove is usually illegal here; ignore it.
            if currentPosition?.moveFromUCI(move) != nil { isAnalyzing = false }

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

        // Only process lines with a PV that belongs to the current position.
        // ChessKitEngine delivers each output line in its own task, so output
        // from a superseded search can arrive after a new one starts, in any
        // order; its first move is almost never legal in the new position.
        guard let pvMoves = info.pv, let first = pvMoves.first,
              currentPosition?.moveFromUCI(first) != nil else { return }

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
        let sanMoves: [String]
        if let pos = currentPosition {
            sanMoves = pos.uciSequenceToSAN(Array(pvMoves.prefix(12))).split(separator: " ").map(String.init)
        } else {
            sanMoves = pvMoves
        }

        let line = EngineLine(
            id: pvIndex,
            score: scoreCp,
            mate: mateIn,
            depth: depth,
            pv: pvMoves,
            pvSAN: sanMoves,
            nodes: nodesSearched,
            startMoveNumber: currentPosition?.fullMoveNumber ?? 1,
            startsWithBlack: currentPosition?.sideToMove == .black
        )

        pendingLines[pvIndex] = line

        // Update current depth
        if depth > currentDepth {
            currentDepth = depth
        }

        // Stockfish ranks MultiPV lines best-first for the side to move; sorting by
        // White's score would list Black's best line last when Black is to move.
        let sortedLines = pendingLines.values.sorted { $0.id < $1.id }

        lines = sortedLines
    }
}
