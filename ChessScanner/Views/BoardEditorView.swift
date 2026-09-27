import SwiftUI

/// Lets the user correct a scanned position before analysis, Lichess-editor style:
/// pick a piece from the palette and tap squares, or drag pieces around.
struct BoardEditView: View {
    @StateObject private var position: Position
    @State private var tool: EditorTool = .move
    @State private var selected: Square?
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
            VStack(spacing: 14) {
                header
                board
                palette
                settings
                actions
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 16)
        }
        .scrollIndicators(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) { analyzeBar }
        .navigationTitle("Review Position")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $navigateToAnalysis) {
            AnalysisView(fen: finalFEN)
        }
        .overlay { photoOverlay }
        .animation(Motion.snappy, value: showPhoto)
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 12) {
            if let photo {
                Button {
                    showPhoto = true
                } label: {
                    Image(uiImage: photo)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 48, height: 48)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(4)
                                .background(.black.opacity(0.55), in: Circle())
                                .padding(3)
                        }
                }
                .buttonStyle(PressableStyle())
                .accessibilityIdentifier("editor.photo")
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Does this match your board?")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text("Pick a piece below and tap squares to fix mistakes, or drag pieces to move them.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: - Board

    private var board: some View {
        BoardView(
            position: position,
            flipped: flipped,
            selectedSquare: selected,
            onSquareTap: handleTap,
            onDrop: handleDrop
        )
        .shadow(color: .black.opacity(0.35), radius: 12, y: 6)
    }

    private func handleTap(_ square: Square) {
        switch tool {
        case .move:
            if let from = selected {
                if from != square { movePiece(from: from, to: square) }
                withAnimation(Motion.snappy) { selected = nil }
            } else if position.piece(at: square) != nil {
                Haptics.tap()
                withAnimation(Motion.snappy) { selected = square }
            }
        case .erase:
            guard position.piece(at: square) != nil else { return }
            edit { position.setPiece(nil, at: square) }
        case .place(let piece):
            let current = position.piece(at: square)
            edit { position.setPiece(current == piece ? nil : piece, at: square) }
        }
    }

    private func handleDrop(from: Square, to: Square?) -> Bool {
        selected = nil
        guard let to else {
            // Dragged off the board: remove the piece.
            edit { position.setPiece(nil, at: from) }
            return true
        }
        guard to != from else { return false }
        movePiece(from: from, to: to)
        return true
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

    // MARK: - Palette

    private var palette: some View {
        VStack(spacing: 8) {
            paletteRow(color: .white, leading: .move)
            paletteRow(color: .black, leading: .erase)
        }
        .padding(8)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func paletteRow(color: PieceColor, leading: EditorTool) -> some View {
        HStack(spacing: 6) {
            toolButton(leading) {
                Image(systemName: leading == .move ? "hand.draw" : "eraser")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(tool == leading ? Theme.textPrimary : Theme.textSecondary)
            }
            Rectangle().fill(Theme.stroke).frame(width: 1, height: 28)
            ForEach([PieceType.king, .queen, .rook, .bishop, .knight, .pawn], id: \.rawValue) { type in
                toolButton(.place(Piece(type: type, color: color))) {
                    PieceView(piece: Piece(type: type, color: color)).padding(5)
                }
            }
        }
    }

    private func toolButton<Label: View>(_ value: EditorTool, @ViewBuilder label: () -> Label) -> some View {
        let isOn = tool == value
        return Button {
            Haptics.tap()
            withAnimation(Motion.snappy) {
                tool = isOn && value != .move ? .move : value
                selected = nil
            }
        } label: {
            label()
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(isOn ? Theme.surfacePressed : Theme.surfaceRaised.opacity(0.5),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(isOn ? Theme.accent : .clear, lineWidth: 2))
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier(value.identifier)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    // MARK: - Settings

    private var settings: some View {
        let possible = position.possibleCastling()
        return VStack(spacing: 12) {
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

            HStack(alignment: .center) {
                Text("Castling")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    castlingRow(.white, possible: possible)
                    castlingRow(.black, possible: possible)
                }
            }
        }
        .padding(14)
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
            .frame(height: 34)
            .background(isOn ? Theme.surfacePressed : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("editor.side.\(color.name.lowercased())")
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private func castlingRow(_ color: PieceColor, possible: CastlingRights) -> some View {
        HStack(spacing: 6) {
            Text(color.name)
                .font(.caption.weight(.medium))
                .foregroundStyle(Theme.textTertiary)
                .frame(width: 40, alignment: .trailing)
            castlingChip("O-O", color: color, kingside: true, possible: possible)
            castlingChip("O-O-O", color: color, kingside: false, possible: possible)
        }
    }

    private func castlingChip(_ title: String, color: PieceColor, kingside: Bool, possible: CastlingRights) -> some View {
        let allowed = possible.allows(color: color, kingside: kingside)
        let isOn = allowed && castling.allows(color: color, kingside: kingside)
        return Button {
            Haptics.tap()
            castling.set(color: color, kingside: kingside, to: !isOn)
        } label: {
            Text(title)
                .font(.caption.weight(.semibold).monospaced())
                .foregroundStyle(isOn ? Color.white : (allowed ? Theme.textSecondary : Theme.textTertiary.opacity(0.6)))
                .frame(width: 62, height: 30)
                .background(isOn ? Theme.accent : Theme.surfaceRaised,
                            in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .disabled(!allowed)
        .accessibilityIdentifier("editor.castle.\(color.name.lowercased()).\(kingside ? "king" : "queen")")
    }

    // MARK: - Actions

    private var actions: some View {
        HStack(spacing: 8) {
            actionButton("Undo", icon: "arrow.uturn.backward", id: "editor.undo", enabled: !undoStack.isEmpty) {
                guard let last = undoStack.popLast() else { return }
                position.objectWillChange.send()
                position.loadFEN(last)
            }
            actionButton("Flip", icon: "arrow.up.arrow.down", id: "editor.flip") {
                withAnimation(Motion.smooth) { flipped.toggle() }
            }
            actionButton("Start", icon: "arrow.counterclockwise", id: "editor.reset") {
                edit { position.loadFEN(Position.startFEN) }
                sideToMove = .white
                castling = position.castlingRights
            }
            actionButton("Clear", icon: "trash", id: "editor.clear", tint: Theme.danger) {
                edit { position.clearBoard() }
            }
        }
    }

    private func actionButton(_ title: String, icon: String, id: String, enabled: Bool = true,
                              tint: Color = Theme.textPrimary, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 16, weight: .semibold))
                Text(title).font(.caption2.weight(.semibold))
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityIdentifier(id)
    }

    // MARK: - Analyze

    private var analyzeBar: some View {
        VStack(spacing: 8) {
            if let issue = issues.first {
                Pill(text: issue, icon: "exclamationmark.triangle.fill")
                    .accessibilityIdentifier("editor.issue")
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            PrimaryButton(title: "Analyze", icon: "bolt.fill", enabled: issues.isEmpty) {
                analyze()
            }
            .accessibilityIdentifier("editor.analyze")
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(Theme.background.opacity(0.96).ignoresSafeArea())
        .animation(Motion.snappy, value: issues.first)
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

// MARK: - Tools

enum EditorTool: Equatable {
    case move
    case erase
    case place(Piece)

    var identifier: String {
        switch self {
        case .move: return "tool.move"
        case .erase: return "tool.erase"
        case .place(let piece): return "palette.\(piece.assetName.dropFirst("piece-".count))"
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
