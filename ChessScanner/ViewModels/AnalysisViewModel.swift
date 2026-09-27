import SwiftUI
import Combine

struct MoveHistoryEntry {
    let move: Move
    let san: String
    let fenBefore: String
    let fenAfter: String
}

@MainActor
class AnalysisViewModel: ObservableObject {
    @Published var currentPosition: Position
    @Published var selectedSquare: Square?
    @Published var legalMoveSquares: [Square] = []
    @Published var flipped: Bool = false
    @Published var moveHistory: [MoveHistoryEntry] = []
    @Published var currentMoveIndex: Int = -1

    let engine = ChessEngine(multiPV: 3)
    let initialFEN: String

    private var lastMove: Move?
    private var positionStack: [String] = []
    private var engineCancellable: AnyCancellable?

    init(fen: String) {
        self.initialFEN = fen
        self.currentPosition = Position(fen: fen)
        self.positionStack = [fen]

        // Forward engine's objectWillChange to our own so views observe engine state
        engineCancellable = engine.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }

    // MARK: - Current State

    var currentFEN: String {
        currentPosition.fen
    }

    var evalScore: Double {
        if let first = engine.lines.first {
            return first.scoreForBar
        }
        return 0.0
    }

    var lastMoveSquares: (from: Square, to: Square)? {
        guard let last = lastMove else { return nil }
        return (last.from, last.to)
    }

    // MARK: - Square Interaction

    func handleSquareTap(_ square: Square) {
        if let selected = selectedSquare {
            // Try to make a move
            let moves = currentPosition.legalMoves(from: selected)
            if let move = moves.first(where: { $0.to == square }) {
                makeMove(move)
                selectedSquare = nil
                legalMoveSquares = []
                return
            }

            // Deselect or select new piece
            if square == selected {
                selectedSquare = nil
                legalMoveSquares = []
                return
            }
        }

        // Select a piece
        if let piece = currentPosition.piece(at: square),
           piece.color == currentPosition.sideToMove {
            selectedSquare = square
            legalMoveSquares = currentPosition.legalMoves(from: square).map { $0.to }
        } else {
            selectedSquare = nil
            legalMoveSquares = []
        }
    }

    // MARK: - Making Moves

    func makeMove(_ move: Move) {
        let fenBefore = currentPosition.fen
        let san = currentPosition.san(for: move)

        // Truncate any future moves if we're not at the end
        if currentMoveIndex < moveHistory.count - 1 {
            moveHistory = Array(moveHistory.prefix(currentMoveIndex + 1))
        }

        let newPosition = currentPosition.makeMove(move)
        let fenAfter = newPosition.fen

        let entry = MoveHistoryEntry(
            move: move,
            san: san,
            fenBefore: fenBefore,
            fenAfter: fenAfter
        )

        moveHistory.append(entry)
        currentMoveIndex = moveHistory.count - 1
        lastMove = move

        currentPosition = newPosition
        positionStack.append(fenAfter)

        restartEngine()
    }

    // MARK: - Navigation

    func goToStart() {
        currentMoveIndex = -1
        currentPosition = Position(fen: initialFEN)
        lastMove = nil
        selectedSquare = nil
        legalMoveSquares = []
        restartEngine()
    }

    func goBack() {
        guard currentMoveIndex >= 0 else { return }
        currentMoveIndex -= 1
        if currentMoveIndex >= 0 {
            let entry = moveHistory[currentMoveIndex]
            currentPosition = Position(fen: entry.fenAfter)
            lastMove = entry.move
        } else {
            currentPosition = Position(fen: initialFEN)
            lastMove = nil
        }
        selectedSquare = nil
        legalMoveSquares = []
        restartEngine()
    }

    func goForward() {
        guard currentMoveIndex < moveHistory.count - 1 else { return }
        currentMoveIndex += 1
        let entry = moveHistory[currentMoveIndex]
        currentPosition = Position(fen: entry.fenAfter)
        lastMove = entry.move
        selectedSquare = nil
        legalMoveSquares = []
        restartEngine()
    }

    func goToEnd() {
        guard !moveHistory.isEmpty else { return }
        currentMoveIndex = moveHistory.count - 1
        let entry = moveHistory[currentMoveIndex]
        currentPosition = Position(fen: entry.fenAfter)
        lastMove = entry.move
        selectedSquare = nil
        legalMoveSquares = []
        restartEngine()
    }

    func goToMove(index: Int) {
        guard index >= 0, index < moveHistory.count else { return }
        currentMoveIndex = index
        let entry = moveHistory[index]
        currentPosition = Position(fen: entry.fenAfter)
        lastMove = entry.move
        selectedSquare = nil
        legalMoveSquares = []
        restartEngine()
    }

    func undoMove() {
        goBack()
    }

    // MARK: - Engine Control

    func startEngine() {
        engine.startAnalysis(position: currentPosition)
    }

    func stopEngine() {
        engine.stopAnalysis()
    }

    func shutdownEngine() {
        Task {
            await engine.shutdown()
        }
    }

    func restartEngine() {
        engine.startAnalysis(position: currentPosition)
    }

    // MARK: - Board Controls

    func flipBoard() {
        flipped.toggle()
    }

    func resetToStart() {
        moveHistory = []
        currentMoveIndex = -1
        currentPosition = Position(fen: initialFEN)
        lastMove = nil
        selectedSquare = nil
        legalMoveSquares = []
        positionStack = [initialFEN]
        restartEngine()
    }

    // MARK: - Play Engine Line

    func playLine(_ line: EngineLine) {
        guard let firstUCI = line.pv.first else { return }

        if let move = currentPosition.moveFromUCI(firstUCI) {
            makeMove(move)
        }
    }

    // MARK: - Material

    func capturedPieces(for color: PieceColor) -> [PieceType: Int] {
        // Calculate what pieces are missing compared to starting material
        let startPos = Position()
        let startCounts = startPos.pieceCounts(for: color)
        let currentCounts = currentPosition.pieceCounts(for: color)

        var captured: [PieceType: Int] = [:]
        for type in PieceType.allCases where type != .king {
            let diff = (startCounts[type] ?? 0) - (currentCounts[type] ?? 0)
            if diff > 0 {
                captured[type] = diff
            }
        }
        return captured
    }

    func materialAdvantage(for color: PieceColor) -> Int {
        let whiteMat = currentPosition.materialCount(for: .white) - 20000 // Remove king value
        let blackMat = currentPosition.materialCount(for: .black) - 20000
        let diff = whiteMat - blackMat
        if color == .white {
            return max(0, diff / 100)
        } else {
            return max(0, -diff / 100)
        }
    }
}
