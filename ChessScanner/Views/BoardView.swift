import SwiftUI

/// An arrow drawn on the board, e.g. the engine's best move.
struct BoardArrow: Equatable {
    let from: Square
    let to: Square
    var color: Color = BoardColors.arrow
    var opacity: Double = 0.85
}

/// Chess board with animated pieces, tap and drag input, highlights and arrows.
struct BoardView: View {
    @ObservedObject var position: Position
    var flipped: Bool = false
    var selectedSquare: Square?
    var legalMoveSquares: [Square] = []
    var lastMove: (from: Square, to: Square)?
    var arrows: [BoardArrow] = []
    /// Squares flagged as problems (e.g. illegal pieces in the editor).
    var markedSquares: Set<Square> = []
    var showCoordinates = true
    var interactive = true
    var onSquareTap: ((Square) -> Void)?
    /// Called when a piece is dragged from one square to another (or off the board: `nil`).
    /// Returning false snaps the piece back.
    var onDrop: ((Square, Square?) -> Bool)?
    /// Whether the piece on a square may be picked up by dragging.
    var canDrag: ((Square) -> Bool)?

    @State private var placed: [PlacedPiece]
    @State private var nextID: Int
    @State private var dragFrom: Square?
    @State private var dragPoint: CGPoint = .zero
    @State private var dragStart: CGPoint?

    init(position: Position, flipped: Bool = false, selectedSquare: Square? = nil,
         legalMoveSquares: [Square] = [], lastMove: (from: Square, to: Square)? = nil,
         arrows: [BoardArrow] = [], markedSquares: Set<Square> = [],
         showCoordinates: Bool = true, interactive: Bool = true,
         onSquareTap: ((Square) -> Void)? = nil, onDrop: ((Square, Square?) -> Bool)? = nil,
         canDrag: ((Square) -> Bool)? = nil) {
        self.position = position
        self.flipped = flipped
        self.selectedSquare = selectedSquare
        self.legalMoveSquares = legalMoveSquares
        self.lastMove = lastMove
        self.arrows = arrows
        self.markedSquares = markedSquares
        self.showCoordinates = showCoordinates
        self.interactive = interactive
        self.onSquareTap = onSquareTap
        self.onDrop = onDrop
        self.canDrag = canDrag
        let initial = PlacedPiece.layout(for: position)
        _placed = State(initialValue: initial)
        _nextID = State(initialValue: initial.count)
    }

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let sq = side / 8

            ZStack(alignment: .topLeading) {
                squaresLayer(sq: sq)
                hintsLayer(sq: sq)
                piecesLayer(sq: sq)
                arrowsLayer(sq: sq)
                    .allowsHitTesting(false)
            }
            .frame(width: side, height: side)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
            .gesture(boardGesture(sq: sq), including: interactive ? .all : .subviews)
        }
        .aspectRatio(1, contentMode: .fit)
        .onChange(of: position.fen) { _, _ in sync() }
    }

    // MARK: Layers

    private func squaresLayer(sq: CGFloat) -> some View {
        VStack(spacing: 0) {
            ForEach(0..<8, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(0..<8, id: \.self) { col in
                        squareCell(square: square(row: row, col: col), row: row, col: col, sq: sq)
                    }
                }
            }
        }
    }

    private func squareCell(square: Square, row: Int, col: Int, sq: CGFloat) -> some View {
        let isLast = lastMove.map { $0.from == square || $0.to == square } ?? false
        let isSelected = selectedSquare == square
        let piece = position.piece(at: square)
        let inCheck = piece?.type == .king && piece?.color == position.sideToMove
            && position.isInCheck(color: position.sideToMove)

        return ZStack(alignment: .topLeading) {
            Rectangle().fill(square.isDark ? BoardColors.dark : BoardColors.light)
            if isLast || isSelected {
                Rectangle().fill(BoardColors.highlight.opacity(isSelected ? 0.62 : 0.45))
            }
            if markedSquares.contains(square) {
                Rectangle().fill(BoardColors.check.opacity(0.45))
                Rectangle().strokeBorder(BoardColors.check, lineWidth: 2)
            }
            if inCheck {
                RadialGradient(colors: [BoardColors.check, BoardColors.check.opacity(0)],
                               center: .center, startRadius: 0, endRadius: sq * 0.62)
            }
            if showCoordinates {
                coordinateLabels(square: square, row: row, col: col, sq: sq)
            }
        }
        .frame(width: sq, height: sq)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("square.\(square.algebraic)")
        .accessibilityLabel(square.algebraic)
        .accessibilityValue(piece.map { String($0.fenChar) } ?? "empty")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { if interactive { onSquareTap?(square) } }
    }

    @ViewBuilder
    private func coordinateLabels(square: Square, row: Int, col: Int, sq: CGFloat) -> some View {
        let color = square.isDark ? BoardColors.light : BoardColors.dark
        let font = Font.system(size: max(8, sq * 0.2), weight: .bold, design: .rounded)
        if col == 0 {
            Text("\(square.rank + 1)")
                .font(font).foregroundStyle(color)
                .padding(.leading, sq * 0.06).padding(.top, sq * 0.03)
        }
        if row == 7 {
            Text(String(UnicodeScalar(97 + square.file)!))
                .font(font).foregroundStyle(color)
                .frame(width: sq, height: sq, alignment: .bottomTrailing)
                .padding(.trailing, sq * 0.06).padding(.bottom, sq * 0.02)
                .frame(width: sq, height: sq)
        }
    }

    private func hintsLayer(sq: CGFloat) -> some View {
        ForEach(legalMoveSquares, id: \.self) { target in
            let center = point(for: target, sq: sq)
            Group {
                if position.piece(at: target) != nil {
                    Circle()
                        .strokeBorder(BoardColors.hint, lineWidth: sq * 0.09)
                        .frame(width: sq * 0.94, height: sq * 0.94)
                } else {
                    Circle()
                        .fill(BoardColors.hint)
                        .frame(width: sq * 0.32, height: sq * 0.32)
                }
            }
            .position(center)
            .transition(.opacity)
        }
        .allowsHitTesting(false)
    }

    private func piecesLayer(sq: CGFloat) -> some View {
        ForEach(placed) { item in
            let dragging = item.square == dragFrom
            PieceView(piece: item.piece)
                .frame(width: sq * 0.9, height: sq * 0.9)
                .scaleEffect(dragging ? 1.25 : 1)
                .position(dragging ? dragPoint : point(for: item.square, sq: sq))
                .zIndex(dragging ? 2 : 1)
                .transition(.opacity.combined(with: .scale(scale: 0.6)))
        }
        .allowsHitTesting(false)
    }

    private func arrowsLayer(sq: CGFloat) -> some View {
        Canvas { context, _ in
            for arrow in arrows {
                let a = point(for: arrow.from, sq: sq)
                let b = point(for: arrow.to, sq: sq)
                let dx = b.x - a.x, dy = b.y - a.y
                let length = max(1, sqrt(dx * dx + dy * dy))
                let ux = dx / length, uy = dy / length
                let head = sq * 0.42
                let shaft = sq * 0.16
                let start = CGPoint(x: a.x + ux * sq * 0.18, y: a.y + uy * sq * 0.18)
                let neck = CGPoint(x: b.x - ux * head, y: b.y - uy * head)

                var line = Path()
                line.move(to: start)
                line.addLine(to: neck)
                context.stroke(line, with: .color(arrow.color.opacity(arrow.opacity)),
                               style: StrokeStyle(lineWidth: shaft, lineCap: .round))

                var tip = Path()
                tip.move(to: b)
                tip.addLine(to: CGPoint(x: neck.x - uy * head * 0.62, y: neck.y + ux * head * 0.62))
                tip.addLine(to: CGPoint(x: neck.x + uy * head * 0.62, y: neck.y - ux * head * 0.62))
                tip.closeSubpath()
                context.fill(tip, with: .color(arrow.color.opacity(arrow.opacity)))
            }
        }
        .animation(Motion.smooth, value: arrows)
    }

    // MARK: Input

    private func boardGesture(sq: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                if dragStart == nil {
                    dragStart = value.startLocation
                }
                let moved = hypot(value.translation.width, value.translation.height) > sq * 0.2
                guard moved, onDrop != nil else { return }
                if dragFrom == nil, let from = squareAt(value.startLocation, sq: sq),
                   position.piece(at: from) != nil, canDrag?(from) ?? true {
                    dragFrom = from
                    Haptics.tap()
                }
                if dragFrom != nil { dragPoint = value.location }
            }
            .onEnded { value in
                defer { dragStart = nil }
                if let from = dragFrom {
                    let target = squareAt(value.location, sq: sq)
                    let accepted = onDrop?(from, target) ?? false
                    if accepted {
                        // Land the dragged piece on its target immediately, so the
                        // following sync doesn't slide it in from its origin.
                        var transaction = Transaction()
                        transaction.disablesAnimations = true
                        withTransaction(transaction) {
                            if let target, let i = placed.firstIndex(where: { $0.square == from }) {
                                placed[i].square = target
                            }
                            dragFrom = nil
                        }
                    } else {
                        withAnimation(Motion.snappy) { dragFrom = nil }
                    }
                } else if hypot(value.translation.width, value.translation.height) < sq * 0.3,
                          let square = squareAt(value.startLocation, sq: sq) {
                    onSquareTap?(square)
                }
            }
    }

    // MARK: Geometry

    private func square(row: Int, col: Int) -> Square {
        flipped ? Square(7 - col, row) : Square(col, 7 - row)
    }

    private func point(for square: Square, sq: CGFloat) -> CGPoint {
        let col = flipped ? 7 - square.file : square.file
        let row = flipped ? square.rank : 7 - square.rank
        return CGPoint(x: (CGFloat(col) + 0.5) * sq, y: (CGFloat(row) + 0.5) * sq)
    }

    private func squareAt(_ p: CGPoint, sq: CGFloat) -> Square? {
        let col = Int(floor(p.x / sq)), row = Int(floor(p.y / sq))
        guard (0..<8).contains(col), (0..<8).contains(row) else { return nil }
        return square(row: row, col: col)
    }

    // MARK: Piece tracking

    /// Re-keys pieces so ones that moved keep their identity and slide to the new square.
    private func sync() {
        let target = PlacedPiece.occupancy(of: position)
        var remaining = placed
        var result: [PlacedPiece] = []
        var unmatched: [(Square, Piece)] = []

        for (square, piece) in target {
            if let i = remaining.firstIndex(where: { $0.square == square && $0.piece == piece }) {
                result.append(remaining.remove(at: i))
            } else {
                unmatched.append((square, piece))
            }
        }
        for (square, piece) in unmatched {
            let candidates = remaining.indices.filter { remaining[$0].piece == piece }
            let promoting = remaining.indices.filter {
                remaining[$0].piece.type == .pawn && remaining[$0].piece.color == piece.color
            }
            let pool = candidates.isEmpty && piece.type != .pawn ? promoting : candidates
            if let i = pool.min(by: { remaining[$0].square.distance(to: square) < remaining[$1].square.distance(to: square) }) {
                var item = remaining.remove(at: i)
                item.square = square
                item.piece = piece
                result.append(item)
            } else {
                result.append(PlacedPiece(id: nextID, piece: piece, square: square))
                nextID += 1
            }
        }
        withAnimation(Motion.snappy) { placed = result }
    }
}

struct PlacedPiece: Identifiable, Equatable {
    let id: Int
    var piece: Piece
    var square: Square

    static func occupancy(of position: Position) -> [(Square, Piece)] {
        var result: [(Square, Piece)] = []
        for rank in 0..<8 {
            for file in 0..<8 {
                let square = Square(file, rank)
                if let piece = position.piece(at: square) { result.append((square, piece)) }
            }
        }
        return result
    }

    static func layout(for position: Position) -> [PlacedPiece] {
        occupancy(of: position).enumerated().map { PlacedPiece(id: $0.offset, piece: $0.element.1, square: $0.element.0) }
    }
}

extension Square {
    func distance(to other: Square) -> Int {
        max(abs(file - other.file), abs(rank - other.rank))
    }
}

#Preview {
    BoardView(position: Position(), arrows: [BoardArrow(from: Square(4, 1), to: Square(4, 3))])
        .padding()
        .background(Theme.background)
}
