import SwiftUI

struct BoardEditView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var position: Position
    @State private var sideToMove: PieceColor = .white
    @State private var flipped = false
    @State private var appeared = false
    @State private var tappedSquare: Square?
    @State private var navigateToAnalysis = false
    @State private var finalFEN = ""

    let initialFEN: String
    var onAnalyze: ((String) -> Void)?

    init(initialFEN: String, onAnalyze: ((String) -> Void)? = nil) {
        self.initialFEN = initialFEN
        self.onAnalyze = onAnalyze
        _position = StateObject(wrappedValue: Position(fen: initialFEN))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                boardWithPicker
                    .slideUpAppear(delay: 0.05, trigger: $appeared)

                bottomControls
                    .slideUpAppear(delay: 0.15, trigger: $appeared)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .background(NotionTheme.background)
        .navigationTitle("Verify Position")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Analyze") {
                    position.sideToMove = sideToMove
                    finalFEN = position.fen
                    if let onAnalyze {
                        // The presenter navigates; pushing here too stacked two
                        // AnalysisViews, each running its own Stockfish.
                        onAnalyze(finalFEN)
                    } else {
                        navigateToAnalysis = true
                    }
                }
                .accessibilityIdentifier("editor.analyze")
                .fontWeight(.bold)
                .foregroundStyle(NotionTheme.accent)
            }
        }
        .navigationDestination(isPresented: $navigateToAnalysis) {
            AnalysisView(fen: finalFEN)
        }
        .onAppear {
            if !appeared {
                withAnimation { appeared = true }
            }
        }
        .onTapGesture {
            // Dismiss picker when tapping outside
            if tappedSquare != nil {
                withAnimation(.easeOut(duration: 0.15)) {
                    tappedSquare = nil
                }
            }
        }
    }

    // MARK: - Board with Picker Overlay

    private var boardWithPicker: some View {
        ZStack(alignment: .topLeading) {
            BoardView(
                position: position,
                flipped: flipped,
                onSquareTap: { square in
                    withAnimation(.easeOut(duration: 0.2)) {
                        if tappedSquare == square {
                            tappedSquare = nil
                        } else {
                            tappedSquare = square
                        }
                    }
                }
            )
            .padding(.horizontal, 8)

            // Piece picker popover
            if let square = tappedSquare {
                GeometryReader { geo in
                    let boardWidth = geo.size.width - 16 // account for padding
                    let squareSize = boardWidth / 8
                    let displayCol = flipped ? CGFloat(7 - square.file) : CGFloat(square.file)
                    let displayRow = flipped ? CGFloat(square.rank) : CGFloat(7 - square.rank)

                    let pickerWidth: CGFloat = 238
                    let pickerHeight: CGFloat = 86

                    let rawX = 8 + displayCol * squareSize + squareSize / 2 - pickerWidth / 2
                    let clampedX = max(4, min(rawX, geo.size.width - pickerWidth - 4))

                    let showBelow = displayRow <= 1
                    let yAbove = 0 + displayRow * squareSize - pickerHeight - 8
                    let yBelow = 0 + (displayRow + 1) * squareSize + 8
                    let pickerY = showBelow ? yBelow : yAbove

                    PiecePickerPopover(
                        currentPiece: position.piece(at: square),
                        onSelect: { piece in
                            position.setPiece(piece, at: square)
                            position.objectWillChange.send()
                            withAnimation(.easeOut(duration: 0.15)) {
                                tappedSquare = nil
                            }
                        },
                        onClear: {
                            position.setPiece(nil, at: square)
                            position.objectWillChange.send()
                            withAnimation(.easeOut(duration: 0.15)) {
                                tappedSquare = nil
                            }
                        }
                    )
                    .frame(width: pickerWidth, height: pickerHeight)
                    .offset(x: clampedX, y: pickerY)
                    .transition(.scale(scale: 0.8, anchor: showBelow ? .top : .bottom).combined(with: .opacity))
                }
            }
        }
    }

    // MARK: - Bottom Controls

    private var bottomControls: some View {
        VStack(spacing: 12) {
            // Side to move
            HStack {
                Text("Side to move")
                    .font(.subheadline)
                    .foregroundStyle(NotionTheme.textPrimary)
                Spacer()
                Picker("Side", selection: $sideToMove) {
                    Text("White").tag(PieceColor.white)
                    Text("Black").tag(PieceColor.black)
                }
                .pickerStyle(.segmented)
                .frame(width: 160)
            }
            .glassCard(cornerRadius: 10, padding: 14)

            // Action buttons
            HStack(spacing: 12) {
                Button {
                    withAnimation(.easeOut(duration: 0.15)) {
                        flipped.toggle()
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.up.arrow.down")
                        Text("Flip")
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(NotionTheme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(
                        NotionTheme.surfaceCard,
                        in: RoundedRectangle(cornerRadius: 10)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(NotionTheme.border, lineWidth: 1)
                    )
                }
                .buttonStyle(NotionCardButtonStyle())

                Button {
                    position.loadFEN(Position.startFEN)
                    position.objectWillChange.send()
                    sideToMove = .white
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.counterclockwise")
                        Text("Reset")
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(NotionTheme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(
                        NotionTheme.surfaceCard,
                        in: RoundedRectangle(cornerRadius: 10)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(NotionTheme.border, lineWidth: 1)
                    )
                }
                .buttonStyle(NotionCardButtonStyle())
                .accessibilityIdentifier("editor.reset")

                Button {
                    for rank in 0..<8 {
                        for file in 0..<8 {
                            position.board[rank][file] = nil
                        }
                    }
                    position.objectWillChange.send()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "trash")
                        Text("Clear")
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(NotionTheme.error)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(
                        NotionTheme.error.opacity(0.08),
                        in: RoundedRectangle(cornerRadius: 10)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(NotionTheme.error.opacity(0.15), lineWidth: 1)
                    )
                }
                .buttonStyle(NotionCardButtonStyle())
            }
        }
    }
}

// MARK: - Piece Picker Popover

struct PiecePickerPopover: View {
    let currentPiece: Piece?
    let onSelect: (Piece) -> Void
    let onClear: () -> Void

    private static let orderedWhite: [Piece] = [
        Piece(type: .king, color: .white),
        Piece(type: .queen, color: .white),
        Piece(type: .rook, color: .white),
        Piece(type: .bishop, color: .white),
        Piece(type: .knight, color: .white),
        Piece(type: .pawn, color: .white),
    ]

    private static let orderedBlack: [Piece] = [
        Piece(type: .king, color: .black),
        Piece(type: .queen, color: .black),
        Piece(type: .rook, color: .black),
        Piece(type: .bishop, color: .black),
        Piece(type: .knight, color: .black),
        Piece(type: .pawn, color: .black),
    ]

    var body: some View {
        VStack(spacing: 4) {
            // White pieces row + clear
            HStack(spacing: 3) {
                ForEach(Self.orderedWhite, id: \.type) { piece in
                    pieceCell(piece)
                }
                clearCell
            }

            // Black pieces row
            HStack(spacing: 3) {
                ForEach(Self.orderedBlack, id: \.type) { piece in
                    pieceCell(piece)
                }
                Color.clear.frame(width: 30, height: 30)
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(NotionTheme.surfaceCard)
                .shadow(color: .black.opacity(0.2), radius: 12, x: 0, y: 4)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(NotionTheme.border, lineWidth: 1)
        )
    }

    private func pieceCell(_ piece: Piece) -> some View {
        let isSelected = currentPiece == piece
        return Button {
            onSelect(piece)
        } label: {
            Text(piece.unicode)
                .font(.system(size: 22))
                .frame(width: 30, height: 30)
                .background(
                    isSelected ? NotionTheme.accent.opacity(0.15) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 5)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(
                            isSelected ? NotionTheme.accent.opacity(0.5) : Color.clear,
                            lineWidth: 1.5
                        )
                )
        }
        .buttonStyle(.plain)
    }

    private var clearCell: some View {
        Button {
            onClear()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(NotionTheme.textTertiary)
                .frame(width: 30, height: 30)
                .background(
                    currentPiece == nil ? NotionTheme.error.opacity(0.1) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 5)
                )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    NavigationStack {
        BoardEditView(initialFEN: Position.startFEN)
    }
}
