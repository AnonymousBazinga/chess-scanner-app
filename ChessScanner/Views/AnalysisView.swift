import SwiftUI

struct AnalysisView: View {
    @StateObject private var viewModel: AnalysisViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var appeared = false

    init(fen: String) {
        _viewModel = StateObject(wrappedValue: AnalysisViewModel(fen: fen))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                boardSection
                    .slideUpAppear(delay: 0.05, trigger: $appeared)
                controlsSection
                    .slideUpAppear(delay: 0.15, trigger: $appeared)
                engineSection
                    .slideUpAppear(delay: 0.25, trigger: $appeared)
                moveListSection
                    .slideUpAppear(delay: 0.32, trigger: $appeared)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .background(NotionTheme.background)
        .navigationTitle("Analysis")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        viewModel.flipBoard()
                    } label: {
                        Label("Flip Board", systemImage: "arrow.up.arrow.down")
                    }

                    Button {
                        viewModel.resetToStart()
                    } label: {
                        Label("Reset Position", systemImage: "arrow.counterclockwise")
                    }

                    Button {
                        UIPasteboard.general.string = viewModel.currentFEN
                    } label: {
                        Label("Copy FEN", systemImage: "doc.on.doc")
                    }

                    if viewModel.engine.isAnalyzing {
                        Button {
                            viewModel.stopEngine()
                        } label: {
                            Label("Stop Engine", systemImage: "stop.circle")
                        }
                    } else {
                        Button {
                            viewModel.startEngine()
                        } label: {
                            Label("Start Engine", systemImage: "play.circle")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.body.weight(.medium))
                        .foregroundStyle(NotionTheme.textPrimary)
                }
            }
        }
        .onAppear {
            viewModel.startEngine()
            if !appeared {
                withAnimation { appeared = true }
            }
        }
        .onDisappear {
            viewModel.shutdownEngine()
        }
    }

    // MARK: - Board Section

    private var boardSection: some View {
        VStack(spacing: 8) {
            CapturedPiecesRow(
                pieces: viewModel.capturedPieces(for: viewModel.flipped ? .white : .black),
                color: viewModel.flipped ? .white : .black,
                advantage: viewModel.materialAdvantage(for: viewModel.flipped ? .white : .black)
            )
            .padding(.horizontal, 4)

            HStack(spacing: 6) {
                EvalBarView(
                    score: viewModel.evalScore,
                    isAnalyzing: viewModel.engine.isAnalyzing,
                    orientation: .vertical,
                    flipped: viewModel.flipped
                )
                .frame(width: 26)

                BoardView(
                    position: viewModel.currentPosition,
                    flipped: viewModel.flipped,
                    selectedSquare: viewModel.selectedSquare,
                    legalMoveSquares: viewModel.legalMoveSquares,
                    lastMove: viewModel.lastMoveSquares,
                    onSquareTap: { square in
                        viewModel.handleSquareTap(square)
                    }
                )
            }

            CapturedPiecesRow(
                pieces: viewModel.capturedPieces(for: viewModel.flipped ? .black : .white),
                color: viewModel.flipped ? .black : .white,
                advantage: viewModel.materialAdvantage(for: viewModel.flipped ? .black : .white)
            )
            .padding(.horizontal, 4)
        }
    }

    // MARK: - Controls Section

    private var controlsSection: some View {
        HStack(spacing: 12) {
            HStack(spacing: 2) {
                navButton(icon: "backward.end.fill", size: 13) {
                    viewModel.goToStart()
                }
                .disabled(viewModel.currentMoveIndex < 0)

                navButton(icon: "chevron.left", size: 15) {
                    viewModel.goBack()
                }
                .disabled(viewModel.currentMoveIndex < 0)

                navButton(icon: "chevron.right", size: 15) {
                    viewModel.goForward()
                }
                .disabled(viewModel.currentMoveIndex >= viewModel.moveHistory.count - 1)

                navButton(icon: "forward.end.fill", size: 13) {
                    viewModel.goToEnd()
                }
                .disabled(viewModel.currentMoveIndex >= viewModel.moveHistory.count - 1)
            }
            .glassCard(cornerRadius: 10, padding: 4)

            Spacer()

            HStack(spacing: 2) {
                navButton(icon: "arrow.up.arrow.down", size: 13) {
                    viewModel.flipBoard()
                }

                navButton(icon: "arrow.uturn.backward", size: 13) {
                    viewModel.undoMove()
                }
                .disabled(viewModel.currentMoveIndex < 0)
            }
            .glassCard(cornerRadius: 10, padding: 4)
        }
    }

    private func navButton(icon: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(NotionTheme.textPrimary)
                .frame(width: 44, height: 36)
        }
        .buttonStyle(NotionCardButtonStyle())
    }

    // MARK: - Engine Section

    private var engineSection: some View {
        EngineLinesView(
            lines: viewModel.engine.lines,
            isAnalyzing: viewModel.engine.isAnalyzing,
            depth: viewModel.engine.currentDepth,
            nodes: viewModel.engine.nodesSearched,
            nps: viewModel.engine.nps,
            onLineTap: { line in
                viewModel.playLine(line)
            }
        )
    }

    // MARK: - Move List Section

    @ViewBuilder
    private var moveListSection: some View {
        if !viewModel.moveHistory.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Moves")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(NotionTheme.textPrimary)
                    .padding(.horizontal, 4)

                moveListContent
            }
            .glassCard(cornerRadius: 10, padding: 12)
        }
    }

    private var moveListContent: some View {
        let moves = viewModel.moveHistory
        return FlowLayout(spacing: 4) {
            ForEach(Array(moves.enumerated()), id: \.offset) { index, entry in
                HStack(spacing: 2) {
                    if index % 2 == 0 {
                        Text("\(index / 2 + 1).")
                            .font(.caption)
                            .foregroundStyle(NotionTheme.textTertiary)
                    }
                    Text(entry.san)
                        .font(.system(size: 13,
                                      weight: index == viewModel.currentMoveIndex ? .bold : .regular,
                                      design: .monospaced))
                        .foregroundStyle(index == viewModel.currentMoveIndex ?
                                         NotionTheme.textPrimary : NotionTheme.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(
                            index == viewModel.currentMoveIndex ?
                            NotionTheme.accent.opacity(0.12) : Color.clear,
                            in: RoundedRectangle(cornerRadius: 5)
                        )
                        .onTapGesture {
                            viewModel.goToMove(index: index)
                        }
                }
            }
        }
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x,
                                               y: bounds.minY + position.y),
                                   proposal: .unspecified)
        }
    }

    private func arrangeSubviews(proposal: ProposedViewSize, subviews: Subviews)
        -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            maxX = max(maxX, x)
        }

        return (CGSize(width: maxX, height: y + rowHeight), positions)
    }
}

#Preview {
    NavigationStack {
        AnalysisView(fen: Position.startFEN)
    }
}
