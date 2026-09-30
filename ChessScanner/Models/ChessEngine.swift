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
    /// Depth of the lines currently shown (the last fully completed iteration).
    @Published var currentDepth: Int = 0
    @Published var lines: [EngineLine] = []
    @Published var engineReady = false

    /// Searches stop here: deep enough for analysis, and saves battery.
    static let maxDepth = 24

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

    /// Stockfish 17 networks, bundled by `scripts/fetch_models.sh`.
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
            await sfEngine.send(command: .setoption(id: "Hash", value: "128"))
            // Loads the networks now rather than on the first `go`.
            await sfEngine.send(command: .isready)
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
    /// Lines per completed depth that make a full update (fewer when few legal moves).
    private var expectedLines = 3
    private var lastPublish = Date.distantPast
    /// Best completed result per position, so revisiting a move shows lines instantly.
    private var cache: [String: (depth: Int, lines: [EngineLine])] = [:]

    func startAnalysis(position: Position, owner: AnyObject? = nil) {
        self.owner = owner.map(ObjectIdentifier.init)
        currentPosition = position
        pendingLines = [:]
        let legal = position.legalMoves().count
        expectedLines = max(1, min(multiPV, legal))
        lastPublish = .distantPast
        guard legal > 0 else {
            // Checkmate or stalemate: nothing to search.
            lines = []
            currentDepth = 0
            isAnalyzing = false
            return
        }

        let key = Self.cacheKey(position.fen)
        if let cached = cache[key] {
            lines = cached.lines
            currentDepth = cached.depth
        } else {
            lines = []
            currentDepth = 0
        }
        isAnalyzing = currentDepth < Self.maxDepth

        guard isAnalyzing else { return }
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
            await engine.send(command: .go(depth: Self.maxDepth))
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

    /// Positions repeat via different move orders; ignore the move counters.
    private static func cacheKey(_ fen: String) -> String {
        fen.split(separator: " ").prefix(4).joined(separator: " ")
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
            if currentPosition?.moveFromUCI(move) != nil {
                publishPending(force: true)
                isAnalyzing = false
            }

        default:
            break
        }
    }

    /// Collects lines and publishes them only when a depth is complete for every
    /// line, the way Lichess and Chess.com do, so the ranking doesn't flicker while
    /// Stockfish is mid-iteration.
    private func processInfo(_ info: EngineResponse.Info) {
        guard let depth = info.depth, let position = currentPosition else { return }

        // Aspiration-window results are provisional bounds, not real scores.
        if info.score?.lowerbound == true || info.score?.upperbound == true { return }

        // Only accept lines that belong to the current position. ChessKitEngine
        // delivers each output line in its own task, so output from a superseded
        // search can arrive after a new one starts; its first move is almost never
        // legal in the new position.
        guard let pvMoves = info.pv, let first = pvMoves.first,
              position.moveFromUCI(first) != nil else { return }

        var scoreCp = 0
        var mateIn: Int?
        if let score = info.score {
            // Stockfish scores from the side to move; show White's perspective.
            let sign = position.sideToMove == .black ? -1 : 1
            if let cp = score.cp { scoreCp = sign * Int(cp) }
            if let mate = score.mate { mateIn = sign * mate }
        }

        let index = info.multipv ?? 1
        pendingLines[index] = EngineLine(
            id: index, score: scoreCp, mate: mateIn, depth: depth,
            pv: pvMoves, pvSAN: [], nodes: info.nodes ?? 0,
            startMoveNumber: position.fullMoveNumber,
            startsWithBlack: position.sideToMove == .black)

        if index == expectedLines { publishPending(force: false) }
    }

    private func publishPending(force: Bool) {
        guard let position = currentPosition else { return }
        let snapshot = (1...expectedLines).compactMap { pendingLines[$0] }
        guard let depth = snapshot.first?.depth,
              snapshot.count == expectedLines,
              snapshot.allSatisfy({ $0.depth == depth }),
              depth > currentDepth || force else { return }

        // Early depths arrive within milliseconds; don't redraw for each one.
        let now = Date()
        guard force || depth >= 12 || now.timeIntervalSince(lastPublish) > 0.25 else { return }
        lastPublish = now

        // SAN conversion is the expensive part, so it only runs for published lines.
        lines = snapshot.map { line in
            var line = line
            line.pvSAN = position.uciSequenceToSAN(Array(line.pv.prefix(10)))
                .split(separator: " ").map(String.init)
            return line
        }
        currentDepth = max(currentDepth, depth)
        cache[Self.cacheKey(position.fen)] = (currentDepth, lines)
    }
}
