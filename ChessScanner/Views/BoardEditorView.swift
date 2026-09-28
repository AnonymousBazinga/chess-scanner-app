import SwiftUI

/// Lets the user correct a scanned position before analysis, Chess.com-editor style:
/// drag pieces from the tray onto the board, drag them around, drag them off to
/// remove them. Tapping a tray piece selects it for placing several by tapping squares.
struct BoardEditView: View {
    @StateObject private var position: Position
    /// Tray piece selected for tap-to-place, if any.
    @State private var brush: Piece?
    /// Tray piece being dragged toward the board, and the finger location.
    @State private var trayDrag: Piece?
    @State private var trayDragPoint: CGPoint = .zero
    @State private var boardFrame: CGRect = .zero
    @State private var sideToMove: PieceColor
    @State private var castling: CastlingRights
    @State private var flipped = false
    @State private var undoStack: [String] = []
    @State private var showPhoto = false
    @State private var navigateToAnalysis = false
    @State private var finalFEN = ""

    let initialFEN: String
    var photo: UIImage?
    var onAnalyze: ((String) -> Void)?

    init(initialFEN: String, photo: UIImage? = nil, onAnalyze: ((String) -> Void)? = nil) {
        self.initialFEN = initialFEN
        self.photo = photo
        self.onAnalyze = onAnalyze
        let start = Position(fen: initialFEN)
        _position = StateObject(wrappedValue: start)
        _sideToMove = State(initialValue: start.sideToMove)
        _castling = State(initialValue: start.castlingRights)
    }

    private var issues: [String] { position.validationIssues(sideToMove: sideToMove) }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                board
                palette
                settings
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 12)
            .coordinateSpace(name: Self.space)
            .overlay(alignment: .topLeading) { trayDragGhost }
        }
        .scrollDisabled(trayDrag != nil)
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize)
        .background(Theme.background.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) { analyzeBar }
        .navigationTitle("Review Position")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(action: undo) {
                    Image(systemName: "arrow.uturn.backward")
                }
                .disabled(undoStack.isEmpty)
                .accessibilityLabel("Undo")
                .accessibilityIdentifier("editor.undo")

                Menu {
                    Button {
                        withAnimation(Motion.smooth) { flipped.toggle() }
                    } label: {
                        Label("Flip board", systemImage: "arrow.up.arrow.down")
                    }
                    Button(action: resetToStart) {
                        Label("Starting position", systemImage: "arrow.counterclockwise")
                    }
                    Button(role: .destructive) {
                        edit { position.clearBoard() }
                    } label: {
                        Label("Clear board", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("More")
                .accessibilityIdentifier("editor.menu")
            }
        }
        .navigationDestination(isPresented: $navigateToAnalysis) {
            AnalysisView(fen: finalFEN)
        }
        .overlay { photoOverlay }
        .animation(Motion.snappy, value: showPhoto)
    }

    // MARK: - Board

    private static let space = "editor"

    private var board: some View {
        BoardView(
            position: position,
            flipped: flipped,
            markedSquares: position.illegalSquares,
            onSquareTap: handleTap,
            onDrop: handleDrop
        )
        .background {
            GeometryReader { geo in
                Color.clear
                    .onAppear { boardFrame = geo.frame(in: .named(Self.space)) }
                    .onChange(of: geo.frame(in: .named(Self.space))) { _, frame in boardFrame = frame }
            }
        }
    }

    /// With a tray piece selected, tapping a square places it (or removes it if the
    /// same piece is already there). Otherwise taps do nothing; pieces are dragged.
    private func handleTap(_ square: Square) {
        guard let brush else { return }
        let current = position.piece(at: square)
        edit { position.setPiece(current == brush ? nil : brush, at: square) }
    }

    private func handleDrop(from: Square, to: Square?) -> Bool {
        guard let to else {
            // Dragged off the board: remove the piece.
            edit { position.setPiece(nil, at: from) }
            return true
        }
        guard to != from else { return false }
        movePiece(from: from, to: to)
        return true
    }

    /// The board square under a point in the editor's coordinate space.
    private func boardSquare(at point: CGPoint) -> Square? {
        guard boardFrame.width > 0, boardFrame.contains(point) else { return nil }
        let sq = boardFrame.width / 8
        let col = min(7, Int((point.x - boardFrame.minX) / sq))
        let row = min(7, Int((point.y - boardFrame.minY) / sq))
        return flipped ? Square(7 - col, row) : Square(col, 7 - row)
    }

    private func movePiece(from: Square, to: Square) {
        guard let piece = position.piece(at: from) else { return }
        edit {
            position.setPiece(nil, at: from)
            position.setPiece(piece, at: to)
        }
    }

    /// Applies a board edit with undo support, haptics and a published change.
    private func edit(_ change: () -> Void) {
        undoStack.append(position.fen)
        if undoStack.count > 100 { undoStack.removeFirst() }
        position.objectWillChange.send()
        change()
        Haptics.move()
    }

    // MARK: - Tray

    private var palette: some View {
        VStack(spacing: 6) {
            trayRow(.white)
            trayRow(.black)
        }
        .padding(8)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func trayRow(_ color: PieceColor) -> some View {
        HStack(spacing: 6) {
            ForEach([PieceType.king, .queen, .rook, .bishop, .knight, .pawn], id: \.rawValue) { type in
                trayPiece(Piece(type: type, color: color))
            }
        }
    }

    /// A tray piece: drag it onto the board, or tap it to select it for tap-to-place.
    private func trayPiece(_ piece: Piece) -> some View {
        let isOn = brush == piece
        return PieceView(piece: piece)
            .padding(5)
            .opacity(trayDrag == piece ? 0.35 : 1)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(isOn ? Theme.surfacePressed : Theme.surfaceRaised.opacity(0.5),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(isOn ? Theme.accent : .clear, lineWidth: 2))
            .contentShape(Rectangle())
            .highPriorityGesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
                    .onChanged { value in
                        guard hypot(value.translation.width, value.translation.height) > 6 else { return }
                        if trayDrag == nil { Haptics.tap() }
                        trayDrag = piece
                        trayDragPoint = value.location
                    }
                    .onEnded { value in
                        if trayDrag != nil {
                            if let square = boardSquare(at: value.location) {
                                edit { position.setPiece(piece, at: square) }
                            }
                            trayDrag = nil
                        } else {
                            Haptics.tap()
                            withAnimation(Motion.snappy) { brush = isOn ? nil : piece }
                        }
                    }
            )
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(piece.color.name) \(piece.type.fullName)")
            .accessibilityIdentifier("palette.\(piece.assetName.dropFirst("piece-".count))")
            .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
            .accessibilityAction { brush = isOn ? nil : piece }
    }

    /// The piece following the finger while dragging from the tray.
    @ViewBuilder
    private var trayDragGhost: some View {
        if let piece = trayDrag {
            let size = max(44, boardFrame.width / 8) * 1.2
            PieceView(piece: piece)
                .frame(width: size, height: size)
                .position(trayDragPoint)
                .allowsHitTesting(false)
        }
    }

    // MARK: - Settings

    private var settings: some View {
        let possible = position.possibleCastling()
        return VStack(spacing: 10) {
            HStack {
                Text("To move")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                HStack(spacing: 4) {
                    sideButton(.white)
                    sideButton(.black)
                }
                .padding(3)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            }

            Rectangle().fill(Theme.stroke).frame(height: 1)

            HStack(spacing: 6) {
                Text("Castling")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 4)
                castlingChip("O-O", color: .white, kingside: true, possible: possible)
                castlingChip("O-O-O", color: .white, kingside: false, possible: possible)
                castlingChip("O-O", color: .black, kingside: true, possible: possible)
                castlingChip("O-O-O", color: .black, kingside: false, possible: possible)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func sideButton(_ color: PieceColor) -> some View {
        let isOn = sideToMove == color
        return Button {
            Haptics.tap()
            withAnimation(Motion.snappy) { sideToMove = color }
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(color == .white ? Theme.evalWhite : Theme.evalBlack)
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.3)))
                    .frame(width: 12, height: 12)
                Text(color.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(isOn ? Theme.textPrimary : Theme.textSecondary)
            }
            .padding(.horizontal, 14)
            .frame(height: 30)
            .background(isOn ? Theme.surfacePressed : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("editor.side.\(color.name.lowercased())")
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private func castlingChip(_ title: String, color: PieceColor, kingside: Bool, possible: CastlingRights) -> some View {
        let allowed = possible.allows(color: color, kingside: kingside)
        let isOn = allowed && castling.allows(color: color, kingside: kingside)
        return Button {
            Haptics.tap()
            castling.set(color: color, kingside: kingside, to: !isOn)
        } label: {
            HStack(spacing: 4) {
                Circle()
                    .fill(color == .white ? Theme.evalWhite : Theme.evalBlack)
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.35)))
                    .frame(width: 7, height: 7)
                Text(title)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
            }
            .foregroundStyle(isOn ? Color.white : (allowed ? Theme.textSecondary : Theme.textTertiary.opacity(0.6)))
            .frame(width: kingside ? 50 : 62, height: 30)
            .background(isOn ? Theme.accent : Theme.surfaceRaised,
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .opacity(allowed ? 1 : 0.6)
        }
        .buttonStyle(PressableStyle())
        .disabled(!allowed)
        .accessibilityIdentifier("editor.castle.\(color.name.lowercased()).\(kingside ? "king" : "queen")")
    }

    // MARK: - Actions

    private func undo() {
        guard let last = undoStack.popLast() else { return }
        Haptics.tap()
        position.objectWillChange.send()
        position.loadFEN(last)
    }

    private func resetToStart() {
        edit { position.loadFEN(Position.startFEN) }
        sideToMove = .white
        castling = position.castlingRights
    }

    // MARK: - Analyze

    private var analyzeBar: some View {
        VStack(spacing: 8) {
            if let issue = issues.first {
                Pill(text: issue, icon: "exclamationmark.triangle.fill")
                    .accessibilityIdentifier("editor.issue")
                    .transition(.opacity)
            } else {
                Text(brush.map { "Tap squares to place the \($0.color.name.lowercased()) \($0.type.fullName.lowercased()). Tap it again to stop." }
                     ?? "Drag pieces onto the board. Drag them off to remove.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(minHeight: 33)
                    .transition(.opacity)
            }
            HStack(spacing: 10) {
                if let photo {
                    Button {
                        showPhoto = true
                    } label: {
                        Image(uiImage: photo)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 54, height: 54)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.stroke))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("Compare with photo")
                    .accessibilityIdentifier("editor.photo")
                }
                PrimaryButton(title: "Analyze", icon: "bolt.fill", enabled: issues.isEmpty) {
                    analyze()
                }
                .accessibilityIdentifier("editor.analyze")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background {
            Theme.background
                .ignoresSafeArea()
                .overlay(alignment: .top) { Rectangle().fill(Theme.stroke).frame(height: 1) }
        }
        .animation(Motion.snappy, value: issues.first)
        .animation(Motion.snappy, value: brush)
    }

    private func analyze() {
        let possible = position.possibleCastling()
        let result = Position(fen: position.fen)
        result.sideToMove = sideToMove
        result.castlingRights = CastlingRights(
            whiteKingside: castling.whiteKingside && possible.whiteKingside,
            whiteQueenside: castling.whiteQueenside && possible.whiteQueenside,
            blackKingside: castling.blackKingside && possible.blackKingside,
            blackQueenside: castling.blackQueenside && possible.blackQueenside)
        result.enPassantSquare = nil
        result.halfMoveClock = 0
        result.fullMoveNumber = 1
        finalFEN = result.fen
        Haptics.success()
        if let onAnalyze {
            // The presenter navigates; pushing here too would stack two AnalysisViews.
            onAnalyze(finalFEN)
        } else {
            navigateToAnalysis = true
        }
    }

    // MARK: - Photo

    @ViewBuilder
    private var photoOverlay: some View {
        if showPhoto, let photo {
            ZStack {
                Color.black.opacity(0.85).ignoresSafeArea()
                Image(uiImage: photo)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .padding(20)
            }
            .onTapGesture { showPhoto = false }
            .transition(.opacity)
            .accessibilityIdentifier("editor.photo.full")
        }
    }
}

extension CastlingRights {
    func allows(color: PieceColor, kingside: Bool) -> Bool {
        switch (color, kingside) {
        case (.white, true): return whiteKingside
        case (.white, false): return whiteQueenside
        case (.black, true): return blackKingside
        case (.black, false): return blackQueenside
        }
    }

    mutating func set(color: PieceColor, kingside: Bool, to value: Bool) {
        switch (color, kingside) {
        case (.white, true): whiteKingside = value
        case (.white, false): whiteQueenside = value
        case (.black, true): blackKingside = value
        case (.black, false): blackQueenside = value
        }
    }
}

extension Position {
    /// Validation using the side to move chosen in the editor.
    func validationIssues(sideToMove side: PieceColor) -> [String] {
        let probe = Position(fen: fen)
        probe.sideToMove = side
        return probe.validationIssues
    }
}

#Preview {
    NavigationStack {
        BoardEditView(initialFEN: Position.startFEN)
    }
    .preferredColorScheme(.dark)
}
