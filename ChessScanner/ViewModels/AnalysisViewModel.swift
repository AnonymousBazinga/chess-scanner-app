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
    /// A pawn move waiting for the user to choose the promotion piece.
    @Published var pendingPromotion: (from: Square, to: Square)?
    @Published var engineEnabled = true {
        didSet {
            guard engineEnabled != oldValue else { return }
            engineEnabled ? startEngine() : stopEngine()
        }
    }

    let engine = ChessEngine(multiPV: 3)
    let initialFEN: String
    let startPosition: Position

    private var lastMove: Move?
    private var engineCancellable: AnyCancellable?

    init(fen: String) {
        self.initialFEN = fen
        self.currentPosition = Position(fen: fen)
        self.startPosition = Position(fen: fen)

        // Forward engine's objectWillChange to our own so views observe engine state
        engineCancellable = engine.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }

    // MARK: - Current State

    var currentFEN: String { currentPosition.fen }

    var lastMoveSquares: (from: Square, to: Square)? {
        guard let last = lastMove else { return nil }
        return (last.from, last.to)
    }

    var topLine: EngineLine? { engineEnabled ? engine.lines.first : nil }

    /// Arrow for the engine's best move, as Chess.com and Lichess show.
    var bestMoveArrows: [BoardArrow] {
        guard engineEnabled, let uci = engine.lines.first?.pv.first, uci.count >= 4,
              let from = Square.fromAlgebraic(String(uci.prefix(2))),
              let to = Square.fromAlgebraic(String(uci.dropFirst(2).prefix(2))) else { return [] }
        return [BoardArrow(from: from, to: to)]
    }

    var statusText: String? {
        if currentPosition.isCheckmate {
            return "Checkmate · \(currentPosition.sideToMove.opposite.name) wins"
        }
        if currentPosition.isStalemate { return "Stalemate" }
        return nil
    }

    var canGoBack: Bool { currentMoveIndex >= 0 }
    var canGoForward: Bool { currentMoveIndex < moveHistory.count - 1 }

    // MARK: - Square Interaction

    func handleSquareTap(_ square: Square) {
        if let selected = selectedSquare {
            if square == selected {
                clearSelection()
                return
            }
            if tryMove(from: selected, to: square) { return }
        }

        if let piece = currentPosition.piece(at: square), piece.color == currentPosition.sideToMove {
            Haptics.tap()
            withAnimation(Motion.snappy) {
                selectedSquare = square
                legalMoveSquares = currentPosition.legalMoves(from: square).map(\.to)
            }
        } else {
            clearSelection()
        }
    }

    func canDrag(from square: Square) -> Bool {
        currentPosition.piece(at: square)?.color == currentPosition.sideToMove
    }

    /// Plays `from`→`to` if legal. Promotions wait for the piece choice.
    @discardableResult
    func tryMove(from: Square, to: Square?) -> Bool {
        guard let to else { clearSelection(); return false }
        let candidates = currentPosition.legalMoves(from: from).filter { $0.to == to }
        guard let move = candidates.first else { return false }

        if candidates.count > 1 {
            clearSelection()
            withAnimation(Motion.snappy) { pendingPromotion = (from, to) }
            return false
        }
        makeMove(move)
        return true
    }

    func completePromotion(_ type: PieceType?) {
        defer { withAnimation(Motion.snappy) { pendingPromotion = nil } }
        guard let pending = pendingPromotion, let type else { return }
        if let move = currentPosition.legalMoves(from: pending.from)
            .first(where: { $0.to == pending.to && $0.promotion == type }) {
            makeMove(move)
        }
    }

    private func clearSelection() {
        withAnimation(Motion.snappy) {
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
        moveHistory.append(MoveHistoryEntry(move: move, san: san, fenBefore: fenBefore, fenAfter: newPosition.fen))
        currentMoveIndex = moveHistory.count - 1
        lastMove = move
        currentPosition = newPosition
        selectedSquare = nil
        legalMoveSquares = []
        Haptics.move()
        restartEngine()
    }

    // MARK: - Navigation

    func goToStart() {
        show(index: -1)
    }

    func goBack() {
        guard canGoBack else { return }
        show(index: currentMoveIndex - 1)
    }

    func goForward() {
        guard canGoForward else { return }
        show(index: currentMoveIndex + 1)
    }

    func goToEnd() {
        show(index: moveHistory.count - 1)
    }

    func goToMove(index: Int) {
        guard index >= -1, index < moveHistory.count else { return }
        show(index: index)
    }

    func undoMove() {
        goBack()
    }

    private func show(index: Int) {
        guard index != currentMoveIndex else { return }
        currentMoveIndex = index
        if index >= 0 {
            let entry = moveHistory[index]
            currentPosition = Position(fen: entry.fenAfter)
            lastMove = entry.move
        } else {
            currentPosition = Position(fen: initialFEN)
            lastMove = nil
        }
        selectedSquare = nil
        legalMoveSquares = []
        pendingPromotion = nil
        Haptics.tap()
        restartEngine()
    }

    // MARK: - Engine Control

    func startEngine() {
        guard engineEnabled else { return }
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
        startEngine()
    }

    // MARK: - Board Controls

    func flipBoard() {
        Haptics.tap()
        withAnimation(Motion.smooth) { flipped.toggle() }
    }

    func resetToStart() {
        moveHistory = []
        currentMoveIndex = -1
        currentPosition = Position(fen: initialFEN)
        lastMove = nil
        selectedSquare = nil
        legalMoveSquares = []
        restartEngine()
    }

    // MARK: - Play Engine Line

    func playLine(_ line: EngineLine) {
        guard let firstUCI = line.pv.first,
              let move = currentPosition.moveFromUCI(firstUCI) else { return }
        makeMove(move)
    }

    // MARK: - Material

    /// Pieces `color` has captured from the opponent, most valuable first.
    func capturedPieces(by color: PieceColor) -> [PieceType] {
        let start = Position().pieceCounts(for: color.opposite)
        let current = currentPosition.pieceCounts(for: color.opposite)
        var result: [PieceType] = []
        for type in [PieceType.queen, .rook, .bishop, .knight, .pawn] {
            let missing = (start[type] ?? 0) - (current[type] ?? 0)
            if missing > 0 { result += Array(repeating: type, count: missing) }
        }
        return result
    }

    /// Material lead in pawns for `color`, or 0 if not ahead.
    func materialAdvantage(for color: PieceColor) -> Int {
        let diff = currentPosition.materialCount(for: .white) - currentPosition.materialCount(for: .black)
        let pawns = diff / 100
        return color == .white ? max(0, pawns) : max(0, -pawns)
    }
}
