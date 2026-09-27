import SwiftUI

struct AnalysisView: View {
    @StateObject private var viewModel: AnalysisViewModel
    @State private var copiedFEN = false

    init(fen: String) {
        _viewModel = StateObject(wrappedValue: AnalysisViewModel(fen: fen))
    }

    var body: some View {
        VStack(spacing: 10) {
            EngineLinesView(
                lines: viewModel.engine.lines,
                isAnalyzing: viewModel.engine.isAnalyzing,
                depth: viewModel.engine.currentDepth,
                errorMessage: viewModel.engine.setupError,
                engineOn: $viewModel.engineEnabled,
                onLineTap: { viewModel.playLine($0) }
            )

            boardSection

            moveStrip

            Spacer(minLength: 0)

            toolbar
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .padding(.bottom, 8)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Analysis")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        UIPasteboard.general.string = viewModel.currentFEN
                        Haptics.success()
                        copiedFEN = true
                    } label: {
                        Label("Copy FEN", systemImage: "doc.on.doc")
                    }
                    Link(destination: lichessURL) {
                        Label("Open in Lichess", systemImage: "safari")
                    }
                    Button {
                        viewModel.resetToStart()
                    } label: {
                        Label("Back to scanned position", systemImage: "arrow.counterclockwise")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(Theme.textPrimary)
                }
                .accessibilityIdentifier("analysis.menu")
            }
        }
        .overlay(alignment: .top) {
            if copiedFEN {
                Pill(text: "FEN copied", icon: "checkmark.circle.fill", color: Theme.accent)
                    .background(Theme.surface, in: Capsule())
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(for: .seconds(1.6))
                        withAnimation { copiedFEN = false }
                    }
            }
        }
        .animation(Motion.snappy, value: copiedFEN)
        .onAppear { viewModel.startEngine() }
        .onDisappear { viewModel.pauseEngine() }
    }

    private var lichessURL: URL {
        let fen = viewModel.currentFEN.replacingOccurrences(of: " ", with: "_")
        return URL(string: "https://lichess.org/analysis/\(fen)") ?? URL(string: "https://lichess.org/analysis")!
    }

    // MARK: - Board

    private var topColor: PieceColor { viewModel.flipped ? .white : .black }
    private var bottomColor: PieceColor { viewModel.flipped ? .black : .white }

    private var boardSection: some View {
        VStack(spacing: 6) {
            materialStrip(for: topColor)

            BoardView(
                    position: viewModel.currentPosition,
                    flipped: viewModel.flipped,
                    selectedSquare: viewModel.selectedSquare,
                    legalMoveSquares: viewModel.legalMoveSquares,
                    lastMove: viewModel.lastMoveSquares,
                    arrows: viewModel.bestMoveArrows,
                    onSquareTap: { viewModel.handleSquareTap($0) },
                    onDrop: { viewModel.tryMove(from: $0, to: $1) },
                    canDrag: { viewModel.canDrag(from: $0) }
                )
                .overlay { promotionOverlay }
                .padding(.leading, 24)
                .overlay(alignment: .leading) {
                    // As an overlay the bar always matches the board's height.
                    EvalBarView(line: viewModel.topLine, flipped: viewModel.flipped)
                        .frame(width: 18)
                        .opacity(viewModel.engineEnabled ? 1 : 0.35)
                        .animation(Motion.smooth, value: viewModel.engineEnabled)
                }

            materialStrip(for: bottomColor)
        }
    }

    private func materialStrip(for color: PieceColor) -> some View {
        let captured = viewModel.capturedPieces(by: color)
        let lead = viewModel.materialAdvantage(for: color)
        let toMove = viewModel.currentPosition.sideToMove == color
        return HStack(spacing: 6) {
            Circle()
                .fill(color == .white ? Theme.evalWhite : Theme.evalBlack)
                .overlay(Circle().strokeBorder(Color.white.opacity(0.25)))
                .frame(width: 10, height: 10)
            Text(color.name)
                .font(.caption.weight(.semibold))
                .foregroundStyle(toMove ? Theme.textPrimary : Theme.textTertiary)
            if toMove {
                Text("to move")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .transition(.opacity)
            }
            HStack(spacing: -3) {
                ForEach(Array(captured.enumerated()), id: \.offset) { _, type in
                    PieceView(piece: Piece(type: type, color: color.opposite))
                        .frame(width: 18, height: 18)
                }
            }
            .padding(.leading, 4)
            if lead > 0 {
                Text("+\(lead)")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
        }
        .frame(height: 20)
        .padding(.leading, 24)
        .animation(Motion.snappy, value: toMove)
    }

    @ViewBuilder
    private var promotionOverlay: some View {
        if viewModel.pendingPromotion != nil {
            ZStack {
                Color.black.opacity(0.45)
                    .onTapGesture { viewModel.completePromotion(nil) }
                HStack(spacing: 8) {
                    ForEach([PieceType.queen, .rook, .bishop, .knight], id: \.rawValue) { type in
                        Button {
                            viewModel.completePromotion(type)
                        } label: {
                            PieceView(piece: Piece(type: type, color: viewModel.currentPosition.sideToMove))
                                .padding(8)
                                .frame(width: 60, height: 60)
                                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityIdentifier("promote.\(type.fullName.lowercased())")
                    }
                }
                .padding(12)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
                .shadow(color: .black.opacity(0.4), radius: 20, y: 8)
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .transition(.opacity)
        }
    }

    // MARK: - Moves

    private var moveStrip: some View {
        Group {
            if let status = viewModel.statusText {
                Pill(text: status, icon: "flag.checkered", color: Theme.accent)
                    .frame(maxWidth: .infinity)
            } else if viewModel.moveHistory.isEmpty {
                Text("Drag or tap a piece to explore moves")
                    .font(.footnote)
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 2) {
                            ForEach(Array(viewModel.moveHistory.enumerated()), id: \.offset) { index, entry in
                                moveChip(index: index, san: entry.san).id(index)
                            }
                        }
                        .padding(.horizontal, 4)
                    }
                    .onChange(of: viewModel.currentMoveIndex) { _, index in
                        withAnimation(Motion.snappy) { proxy.scrollTo(max(index, 0), anchor: .center) }
                    }
                }
            }
        }
        .frame(height: 36)
        .animation(Motion.snappy, value: viewModel.moveHistory.count)
    }

    private func moveChip(index: Int, san: String) -> some View {
        let start = viewModel.startPosition
        let startBlack = start.sideToMove == .black
        let startNumber = start.fullMoveNumber
        let ply = index + (startBlack ? 1 : 0)
        let isWhiteMove = ply % 2 == 0
        let number = startNumber + ply / 2
        let current = index == viewModel.currentMoveIndex

        return Button {
            viewModel.goToMove(index: index)
        } label: {
            HStack(spacing: 3) {
                if isWhiteMove || index == 0 {
                    Text(isWhiteMove ? "\(number)." : "\(number)...")
                        .foregroundStyle(Theme.textTertiary)
                }
                Text(san)
                    .foregroundStyle(current ? Theme.textPrimary : Theme.textSecondary)
                    .fontWeight(current ? .bold : .medium)
            }
            .font(.system(size: 14).monospacedDigit())
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(current ? Theme.surfacePressed : Color.clear,
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("move.\(index)")
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: 8) {
            IconButton(icon: "arrow.up.arrow.down", label: "Flip board") { viewModel.flipBoard() }
                .accessibilityIdentifier("analysis.flip")
            IconButton(icon: "backward.end.fill", label: "First move") { viewModel.goToStart() }
                .disabled(!viewModel.canGoBack)
                .opacity(viewModel.canGoBack ? 1 : 0.4)
            navButton(icon: "chevron.left", label: "Previous move", enabled: viewModel.canGoBack) {
                viewModel.goBack()
            }
            .accessibilityIdentifier("analysis.back")
            navButton(icon: "chevron.right", label: "Next move", enabled: viewModel.canGoForward) {
                viewModel.goForward()
            }
            .accessibilityIdentifier("analysis.forward")
            IconButton(icon: "forward.end.fill", label: "Last move") { viewModel.goToEnd() }
                .disabled(!viewModel.canGoForward)
                .opacity(viewModel.canGoForward ? 1 : 0.4)
        }
    }

    private func navButton(icon: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }
}

#Preview {
    NavigationStack {
        AnalysisView(fen: Position.startFEN)
    }
    .preferredColorScheme(.dark)
}
